# Minecraft Checker Builder

Herramienta web estática para crear verificadores automáticos de ejercicios de **Minecraft Education** (curso Algoritmika · Minecraft Global).

🌐 **Demo:** https://faintkom.github.io/mc-edu-checker-builder/

## Para metodólogos — cómo crear un checker

1. Abre el **[Builder](https://faintkom.github.io/mc-edu-checker-builder/teacher-ui.html)**.
2. Rellena los datos del urok (título, descripción).
3. En el catálogo, selecciona las comprobaciones que quieres validar:
   - **🌍 Mundo** (`.mcworld`): nombre, gamemode, NPCs, entidades, signs, etc.
   - **💻 Código** (`.mkcd`): comandos de chat, bucles, llamadas API, identificadores, etc.
4. Ajusta los parámetros de cada check (ej. `agent.interact` llamado mínimo 1 vez).
5. Pulsa **Export ZIP** y guarda el archivo con el nombre del ejercicio:
   - Ejemplo: `m2l4-task2-completando-primer-nivel.zip`
6. Sube el ZIP a la carpeta Drive del urok. El equipo de ensamblaje LMS lo cargará como nivel `frame_box`.

## Catálogo de comprobaciones disponibles

### Mundo (`.mcworld`)

- `world.valid`, `world.named`, `world.name_contains`
- `world.gamemode_is`, `world.difficulty_is`, `world.seed_set`
- `world.education_enabled`, `world.cheats_enabled`
- `npc.min_count`, `npc.exact_count`, `npc.all_named`, `npc.all_have_dialogue`
- `npc.dialogue_min_length`, `npc.uses_format_codes`, `npc.has_button_with_url`
- `npc.min_buttons_total`, `npc.dialogue_contains`, `npc.unique_skins`
- `entity.min_count_of`, `entity.total_min`, `entity.unique_types_min`
- `sign.min_count`, `sign.contains_text`

### Código (`.mkcd`)

- `code.valid` — el código compila
- `code.chat_command` — comando de chat existe
- `code.has_loop`, `code.nested_loops`, `code.loop_contains`
- `code.api_call_min` — función X llamada ≥ N veces (p. ej. `agent.interact ≥ 1`)
- `code.uses_block` — `agent.setItem` con bloque específico
- `code.assist_set` — `agent.setAssist` con flag
- `code.spawn_mob` — `mobs.spawn` con criatura
- `code.has_if`, `code.total_forward_min`, `code.uses_identifier`, `code.min_lines`

## Arquitectura

- **100% estático** — corre en el navegador, sin backend.
- Dependencias externas (todas vía CDN, ya incluidas en `teacher-ui.html`):
  - [`jszip`](https://stuk.github.io/jszip/) — leer/escribir `.mcworld` y empaquetar ZIPs
  - [`pako`](https://github.com/nodeca/pako) — decompresión zlib
  - [`lzma-min`](https://github.com/LZMA-JS/LZMA-JS) — decompresión LZMA de `.mkcd`
  - [`acorn`](https://github.com/acornjs/acorn) — parser AST de TypeScript/JavaScript
- Dependencias internas (inline en `teacher-ui.html`):
  - **BedrockNBT parser** — lee NBT de `level.dat` y entradas LevelDB
  - **LevelDB reader** — lee archivos `.ldb`/`.sst`/`.log` de Bedrock
  - **MkcdEngine** — descomprime `.mkcd` y parsea `main.ts` con `acorn`

## Archivos del repo

| Archivo | Para qué |
|---|---|
| `index.html` | Landing con enlaces a Builder y Runner |
| `teacher-ui.html` | **Builder** — herramienta principal para crear checkers |
| `runner.html` | Standalone runner con presets hardcoded (M2L1 barn/house, agent-fence, etc.) |
| `engine.js` | API del motor de parser de código (`MkcdEngine`) — usado por `runner.html` |
| `presets.js` | Presets de ejercicios hardcoded para el Runner |
| `samples/` | Archivos `.mkcd` de ejemplo para probar |

## Para desarrolladores

Para añadir un nuevo tipo de check, edita `teacher-ui.html` y agrega una entrada al `CHECK_REGISTRY` (a partir de la línea ~1236):

```js
CHECK_REGISTRY['code.mi_nueva_check'] = {
  category: 'code', target: 'code',
  label: {es:'Mi nueva comprobación', ru:'Моя новая проверка', en:'My new check'},
  description: {es:'...', ru:'...', en:'...'},
  params: [{key:'foo', type:'text', default:'bar'}],
  defaultLabel: {es:p => '...', ru:p => '...', en:p => '...'},
  defaultHint: {es:p => '...', ru:p => '...', en:p => '...'},
  evaluator: function(code, p) { /* return true|false */ }
};
```

El target `'code'` recibe el `MkcdEngine` API (ver `engine.js`). El target `'world'` recibe `{metadata, npcs, allEntities, signs}` parseado de `.mcworld`.

## Licencia

Uso interno de Algoritmika. Contacto: [@FaintKom](https://github.com/FaintKom).
