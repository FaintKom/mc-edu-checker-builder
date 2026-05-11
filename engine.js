// AST rule engine for MakeCode-Minecraft TypeScript code (plain JS subset).
// Pure: no I/O, no globals. Browser + Node compatible.
//
// API:
//   const eng = createEngine(mainTsSource);
//   eng.parsed              -> true/false
//   eng.parseError          -> Error | null
//   eng.evaluate(checks)    -> [{id,label,passed,detail}, ...]
//
// Each check is { id, label, test: (api) => boolean | {passed, detail} }
// `api` is the EngineApi defined below.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const acorn = require('acorn');
    module.exports = factory(acorn);
  } else {
    root.MkcdEngine = factory(root.acorn);
  }
}(typeof self !== 'undefined' ? self : this, function (acorn) {

// ---------- AST walking ----------

const SKIP_KEYS = new Set(['loc','start','end','range','parent','sourceType','raw']);

function walk(node, visit, parent) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit, parent);
    return;
  }
  if (typeof node.type === 'string') {
    visit(node, parent);
  }
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (v && typeof v === 'object') walk(v, visit, node);
  }
}

// Walk that gives every visited node its full ancestor stack (root-first).
function walkAncestors(root, visit) {
  function rec(n, stack) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const c of n) rec(c, stack); return; }
    if (typeof n.type === 'string') visit(n, stack);
    const next = (typeof n.type === 'string') ? stack.concat([n]) : stack;
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (v && typeof v === 'object') rec(v, next);
    }
  }
  rec(root, []);
}

// Estimate iteration count of a `for (let i = 0; i < N; i++)` style loop.
// Returns integer when bounds are constant, null when unknown.
function staticIterCount(forNode) {
  if (forNode.type === 'WhileStatement' || forNode.type === 'DoWhileStatement' || forNode.type === 'ForOfStatement' || forNode.type === 'ForInStatement') return null;
  if (forNode.type !== 'ForStatement') return null;
  const init = forNode.init, test = forNode.test, upd = forNode.update;
  if (!init || !test || !upd) return null;
  // init: VariableDeclaration `let X = K`
  let startVal = null, varName = null;
  if (init.type === 'VariableDeclaration' && init.declarations.length === 1) {
    const d = init.declarations[0];
    if (d.id && d.id.type === 'Identifier' && d.init) {
      varName = d.id.name;
      const v = literalValue(d.init);
      if (typeof v === 'number') startVal = v;
    }
  }
  if (varName == null || startVal == null) return null;
  // test: X < N or X <= N
  if (test.type !== 'BinaryExpression') return null;
  if (!(test.operator === '<' || test.operator === '<=')) return null;
  if (!(test.left && test.left.type === 'Identifier' && test.left.name === varName)) return null;
  const endVal = literalValue(test.right);
  if (typeof endVal !== 'number') return null;
  // update: X++ or X += 1 (simple step of 1)
  let step = null;
  if (upd.type === 'UpdateExpression' && upd.operator === '++') step = 1;
  else if (upd.type === 'AssignmentExpression' && upd.operator === '+=' && literalValue(upd.right) === 1) step = 1;
  if (step !== 1) return null;
  const iters = (test.operator === '<') ? (endVal - startVal) : (endVal - startVal + 1);
  return Math.max(0, iters | 0);
}

function memberName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    const obj = memberName(node.object);
    const prop = node.computed ? null : (node.property && node.property.name);
    if (!obj || !prop) return null;
    return obj + '.' + prop;
  }
  return null;
}

function callName(call) {
  if (!call || call.type !== 'CallExpression') return null;
  return memberName(call.callee);
}

function literalValue(node) {
  if (!node) return undefined;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map(q => q.value.cooked).join('');
  }
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal') {
    return -node.argument.value;
  }
  return undefined;
}

function identName(node) {
  return node && node.type === 'Identifier' ? node.name : null;
}

// ---------- Engine ----------

function parse(src) {
  return acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true
  });
}

function createEngine(source) {
  let ast = null, err = null;
  try { ast = parse(source); }
  catch (e) { err = e; }

  // Pre-collect frequently needed views
  const allCalls = [];
  const loops = [];
  const chatHandlers = [];   // {name, body, node}
  const identifiers = new Set();

  if (ast) {
    walk(ast, (n) => {
      if (n.type === 'CallExpression') {
        allCalls.push(n);
        const name = callName(n);
        if (name === 'player.onChat' && n.arguments.length >= 2) {
          const cmd = literalValue(n.arguments[0]);
          const fn  = n.arguments[1];
          if (typeof cmd === 'string' && fn && (fn.type === 'FunctionExpression' || fn.type === 'ArrowFunctionExpression')) {
            chatHandlers.push({ name: cmd, body: fn.body, node: n });
          }
        }
      }
      if (n.type === 'ForStatement' || n.type === 'WhileStatement' || n.type === 'DoWhileStatement' || n.type === 'ForOfStatement' || n.type === 'ForInStatement') {
        loops.push(n);
      }
      if (n.type === 'Identifier') identifiers.add(n.name);
    });
  }

  function callsByName(name, scope) {
    const root = scope || ast;
    const out = [];
    if (!root) return out;
    walk(root, n => { if (n.type === 'CallExpression' && callName(n) === name) out.push(n); });
    return out;
  }

  function callsMatching(predicateOnName, scope) {
    const root = scope || ast;
    const out = [];
    if (!root) return out;
    walk(root, n => {
      if (n.type === 'CallExpression') {
        const cn = callName(n);
        if (cn && predicateOnName(cn)) out.push(n);
      }
    });
    return out;
  }

  function loopDepth(node, depth) {
    depth = depth || 0;
    let max = depth;
    walk(node, (n, parent) => {
      if (n === node) return;
      if (n.type === 'ForStatement' || n.type === 'WhileStatement' || n.type === 'DoWhileStatement') {
        const inner = loopDepth(n, depth + 1);
        if (inner > max) max = inner;
      }
    });
    return max;
  }

  // ---------- Predicate API exposed to checks ----------
  const api = {
    ast,
    callName, memberName, literalValue, identName, walk,

    // Boolean / count helpers
    hasChatCommand(name) {
      return chatHandlers.some(h => h.name === name);
    },
    chatCommandNames() {
      return chatHandlers.map(h => h.name);
    },
    chatHandler(name) {
      return chatHandlers.find(h => h.name === name) || null;
    },

    callsByName,
    callsMatching,
    countCalls(name, scope) { return callsByName(name, scope).length; },

    hasAnyLoop() { return loops.length > 0; },
    loopCount() { return loops.length; },
    maxLoopDepth() {
      let max = 0;
      for (const l of loops) {
        // count this loop + nested
        const d = 1 + loopDepth(l);
        if (d > max) max = d;
      }
      return max;
    },

    // Check that AT LEAST ONE loop's body contains every name in `requiredCalls`.
    hasLoopWithCalls(requiredCalls, scope) {
      const list = scope ? collectLoopsIn(scope) : loops;
      for (const l of list) {
        const inside = new Set();
        walk(l, n => { if (n.type === 'CallExpression') { const cn = callName(n); if (cn) inside.add(cn); } });
        if (requiredCalls.every(c => inside.has(c))) return true;
      }
      return false;
    },

    // Sum of integer args at position `argIdx` for a given call name (matching constants only).
    sumNumericArg(callMatch, argIdx) {
      const matcher = typeof callMatch === 'function' ? callMatch : (n => n === callMatch);
      let total = 0;
      walk(ast, n => {
        if (n.type !== 'CallExpression') return;
        const cn = callName(n);
        if (!cn || !matcher(cn)) return;
        const a = n.arguments[argIdx];
        const v = literalValue(a);
        if (typeof v === 'number') total += v;
      });
      return total;
    },

    // Total agent-forward distance: sums second arg of agent.move(FORWARD, N),
    // multiplied by static iteration count of every enclosing for-loop with
    // constant bounds. If a wrapping loop has unknown bounds, the call counts as 1×.
    totalAgentForward() {
      let total = 0;
      walkAncestors(ast, (n, stack) => {
        if (n.type !== 'CallExpression') return;
        if (callName(n) !== 'agent.move') return;
        const dir = identName(n.arguments[0]);
        const dist = literalValue(n.arguments[1]);
        if (dir !== 'FORWARD' || typeof dist !== 'number') return;
        let mult = 1;
        for (const a of stack) {
          if (a.type === 'ForStatement') {
            const k = staticIterCount(a);
            if (k != null) mult *= k;
          }
        }
        total += dist * mult;
      });
      return total;
    },

    // Iteration multiplier for `node` based on enclosing static for-loops.
    iterMultiplier(node) {
      let mult = 1;
      walkAncestors(ast, (n, stack) => {
        if (n !== node) return;
        for (const a of stack) {
          if (a.type === 'ForStatement') {
            const k = staticIterCount(a);
            if (k != null) mult *= k;
          }
        }
      });
      return mult;
    },

    // Returns true if any agent.setItem(BLOCK, ...) BLOCK identifier matches.
    callsSetItemMatching(blockMatch) {
      const re = blockMatch instanceof RegExp ? blockMatch : null;
      for (const c of callsByName('agent.setItem')) {
        const id = identName(c.arguments[0]);
        if (!id) continue;
        if (re ? re.test(id) : id === blockMatch) return true;
      }
      return false;
    },

    // setItem block identifiers used.
    setItemBlocks() {
      return callsByName('agent.setItem').map(c => identName(c.arguments[0])).filter(Boolean);
    },

    // agent.setAssist(FLAG, true|false)
    setsAssist(flag, value) {
      for (const c of callsByName('agent.setAssist')) {
        const f = identName(c.arguments[0]);
        const v = literalValue(c.arguments[1]);
        if (f === flag && (value === undefined || v === value)) return true;
      }
      return false;
    },

    // mobs.spawn(MOB, ...)
    spawnsMob(mob) {
      const re = mob instanceof RegExp ? mob : null;
      for (const c of callsByName('mobs.spawn')) {
        const m = identName(c.arguments[0]);
        if (!m) continue;
        if (re ? re.test(m) : m === mob) return true;
      }
      return false;
    },

    // Identifier appears anywhere
    usesIdentifier(name) { return identifiers.has(name); },

    // Source-line count helpers
    lineCount() { return source.split(/\r?\n/).length; },
    sourceContains(substr) { return source.indexOf(substr) >= 0; },
  };

  function collectLoopsIn(scope) {
    const out = [];
    walk(scope, n => {
      if (n.type === 'ForStatement' || n.type === 'WhileStatement' || n.type === 'DoWhileStatement' || n.type === 'ForOfStatement' || n.type === 'ForInStatement') out.push(n);
    });
    return out;
  }

  function evaluate(checks) {
    if (!ast) {
      return checks.map(c => ({
        id: c.id, label: c.label, passed: false,
        detail: 'Парсинг не удался: ' + (err && err.message)
      }));
    }
    return checks.map(c => {
      let res;
      try { res = c.test(api); }
      catch (e) { return { id: c.id, label: c.label, passed: false, detail: 'Ошибка чека: ' + e.message }; }
      if (typeof res === 'boolean') return { id: c.id, label: c.label, passed: res, detail: '' };
      return { id: c.id, label: c.label, passed: !!(res && res.passed), detail: (res && res.detail) || '' };
    });
  }

  return {
    parsed: !!ast,
    parseError: err,
    api,
    evaluate
  };
}

return { createEngine, walk, callName, memberName, literalValue, identName };

}));
