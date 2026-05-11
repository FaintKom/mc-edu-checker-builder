// Hard-coded presets for the prototype.
// Each preset is bound to a specific lesson task. CHECK_REGISTRY for the
// teacher-builder will reuse the same predicate library (engine.js api).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MkcdPresets = factory();
}(typeof self !== 'undefined' ? self : this, function () {

const PRESETS = {

  'agent-fence': {
    title: 'Agent Fence — забор 8×8',
    intro: 'Запрограммируй агента построить забор-квадрат 8×8 по команде в чате.',
    checks: [
      { id: 'chat.run',
        label: 'Заведена команда чата "run"',
        test: api => api.hasChatCommand('run') ||
                     ({ passed: false,
                        detail: 'Команды нет. Нашёл: ' + (api.chatCommandNames().join(', ') || '—') }) },

      { id: 'fence.block',
        label: 'В инвентаре агента блок типа *_FENCE',
        test: api => api.callsSetItemMatching(/_FENCE$/) ||
                     ({ passed: false,
                        detail: 'agent.setItem с блоком забора не найден. Использованы: ' +
                                (api.setItemBlocks().join(', ') || '—') }) },

      { id: 'assist.destroy',
        label: 'Включён DESTROY_OBSTACLES',
        test: api => api.setsAssist('DESTROY_OBSTACLES', true) },

      { id: 'loop.any',
        label: 'Использован хотя бы один цикл',
        test: api => api.hasAnyLoop() ||
                     ({ passed: false, detail: 'Циклов нет — забор скорее всего собран копипастой' }) },

      { id: 'loop.turn-move',
        label: 'В цикле есть поворот И движение',
        test: api => api.hasLoopWithCalls(['agent.turn', 'agent.move']) },

      { id: 'distance.32',
        label: 'Агент проходит ≥ 32 блоков вперёд',
        test: api => {
          const d = api.totalAgentForward();
          return { passed: d >= 32, detail: 'Считая статичные FORWARD-вызовы: ' + d };
        } },
    ]
  },

  // M2L1 — three independent chat commands (barn, house, farm). Each is a
  // separate preset because LMS task likely covers one at a time.

  'm2l1-barn': {
    title: 'M2L1 — амбар',
    intro: 'Команда "barn" строит амбар для лошади.',
    checks: [
      { id: 'chat.barn',     label: 'Команда "barn" заведена',
        test: api => api.hasChatCommand('barn') },
      { id: 'planks',         label: 'Используются доски (PLANKS_*)',
        test: api => api.callsSetItemMatching(/^PLANKS_/) },
      { id: 'fence',          label: 'Используется забор',
        test: api => api.callsSetItemMatching(/_FENCE$/) },
      { id: 'hay',            label: 'Используется сено (HAY_BLOCK)',
        test: api => api.callsSetItemMatching('HAY_BLOCK') },
      { id: 'nested',         label: 'Вложенные циклы (глубина ≥ 2)',
        test: api => {
          const d = api.maxLoopDepth();
          return { passed: d >= 2, detail: 'Максимум: ' + d };
        } },
      { id: 'horse',          label: 'Заспаунен HORSE',
        test: api => api.spawnsMob('HORSE') },
      { id: 'destroy',        label: 'Включён DESTROY_OBSTACLES',
        test: api => api.setsAssist('DESTROY_OBSTACLES', true) },
    ]
  },

  'm2l1-house': {
    title: 'M2L1 — дом',
    intro: 'Команда "house" строит дом параметрической высоты и ширины.',
    checks: [
      { id: 'chat.house', label: 'Команда "house" с двумя параметрами',
        test: api => {
          const h = api.chatHandler('house');
          if (!h) return { passed: false, detail: 'Команды нет' };
          const fn = h.node.arguments[1];
          const argc = (fn && fn.params || []).length;
          return { passed: argc >= 2, detail: 'Параметров у функции: ' + argc };
        } },
      { id: 'builder.tracePath', label: 'Используется builder.tracePath',
        test: api => api.countCalls('builder.tracePath') > 0 },
      { id: 'while',      label: 'Цикл while по слоям',
        test: api => api.callsByName('builder.shift').length > 0 || api.loopCount() >= 2 },
      { id: 'condition',  label: 'Есть if/else (для чётной/нечётной ширины)',
        test: api => {
          let hit = false;
          api.walk(api.ast, n => { if (n.type === 'IfStatement') hit = true; });
          return hit;
        } },
      { id: 'glass',      label: 'Размещается стекло (GLASS)',
        test: api => api.usesIdentifier('GLASS') },
    ]
  },

  'm2l1-farm': {
    title: 'M2L1 — ферма',
    intro: 'Команда "farm" вспахивает грядки и сажает семена.',
    checks: [
      { id: 'chat.farm',  label: 'Команда "farm" заведена',
        test: api => api.hasChatCommand('farm') },
      { id: 'till',       label: 'Используется agent.till',
        test: api => api.countCalls('agent.till') > 0 },
      { id: 'seeds',      label: 'В инвентаре SEEDS',
        test: api => api.callsSetItemMatching('SEEDS') },
      { id: 'fence',      label: 'Загорожена забором',
        test: api => api.callsSetItemMatching(/_FENCE$/) },
      { id: 'nested',     label: 'Вложенные циклы (≥ 2)',
        test: api => api.maxLoopDepth() >= 2 },
    ]
  },

};

return { PRESETS };

}));
