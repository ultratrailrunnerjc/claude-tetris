# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Tetris en JavaScript vanilla + HTML5 Canvas. Sin `package.json`, sin dependencias, sin build, sin linter ni tests. Toda la lógica está en `game.js` (~300 líneas); `index.html` define el DOM y `style.css` el tema oscuro.

## Ejecutar

Abrir `index.html` directamente o servir la carpeta con cualquier servidor estático:

```bash
python3 -m http.server 8000   # luego http://localhost:8000
```

## Arquitectura (`game.js`)

- Todo el estado es global a nivel de módulo (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, ...) y se reinicia en `init()`, que también sirve de reinicio desde el botón de Game Over.
- `board` es una matriz `ROWS × COLS` con `0` (vacía) o un índice 1–8 (8 = tuerca 3×3 con hueco central) que indexa a la vez `COLORS` y `PIECES` (índice 0 = `null` en ambos). Las piezas guardan su propio índice en cada celda de `shape`.
- Flujo de una pieza: `loop` (rAF, acumula `dropAccum` hasta `dropInterval`) o `softDrop`/`hardDrop` → `lockPiece()` → `isTSpin()` → `merge()` → `clearLines()` (líneas, nivel y `dropInterval` se recalculan aquí; devuelve el nº de líneas) → `applyScore()` (puntuación, combo, B2B, Perfect Clear, popups y sonido) → `spawn()`. Si la pieza nueva ya colisiona, `spawn()` llama a `endGame()`.
- Modos: `MODES` define Clásico + 5 desafíos (`sprint`, `garbage`, `fixed`, `invisible`, `reverse`) con `name`/`desc`, `progress()`, `won()`, `failed()`, `setup()` y flags (`garbageEvery`, `invisible`, `reverseFrom`) que leen el estado global. El juego arranca en `showMenu()` (con `gameOver = true` para bloquear teclado) y `init(key)` elige el modo; `restartBtn` repite el actual y `menuBtn` vuelve al menú. `checkGoal()` (desde `loop` y `lockPiece`) llama a `endGame(won)`. `elapsed` solo avanza en `loop`, así que la pausa no cuenta. Los índices 9 (basura) y 10 (bloques fijos) existen solo en `COLORS`, no en `PIECES`.
- Rotación: `rotateCW`/`rotateCCW` + `tryRotate` (antihoraria si `isReversed()`) con wall kicks horizontales `[0, -1, 1, -2, 2]` (no hay kicks verticales ni rotación antihoraria).
- Pausa y Game Over comparten el mismo `#overlay`; ambos cancelan el rAF (`cancelAnimationFrame(animId)`) y `togglePause` lo reanuda llamando a `loop` manualmente.
- El handler de `keydown` usa `e.code` (`ArrowLeft`, `KeyX`, `Space`, `KeyP`...), no `e.key`.

## Acoplamientos a tener en cuenta

- Si cambias `COLS`, `ROWS` o `BLOCK`, ajusta `width`/`height` de `<canvas id="board">` en `index.html` (`COLS × BLOCK` por `ROWS × BLOCK`; actualmente 300×600). El canvas de la vista previa (`#next-canvas`) usa un tamaño de bloque fijo (`NB = 30`) dentro de `drawNext`, con una cuadrícula 4×4.
- Los ids del DOM usados desde `game.js` (`board`, `next-canvas`, `score`, `lines`, `level`, `overlay`, `overlay-title`, `overlay-score`, `restart-btn`, `menu-btn`, `mode-menu`, `mode-name`, `goal`, `combo`, `b2b`) deben existir en `index.html`.
- La velocidad de caída está duplicada: `1000` inicial en `init()` y la fórmula `max(100, 1000 - (level - 1) * 90)` en `clearLines()`.
- Puntuación (`applyScore`, todo × `level` previo a la limpieza): base `LINE_SCORES` o `TSPIN_SCORES` (T-spin = pieza T con rotación como último movimiento y ≥3 esquinas ocupadas; `lastMoveRotate` se pone a `false` en cualquier traslación), × 1.5 si B2B (Tetris/T-spin tras otro "difícil"), × `combo` (locks consecutivos que limpian), + `PC_SCORES` si el tablero queda vacío. Soft drop suma 1 por fila y hard drop 2 por celda.
- Efectos: flash y popups se dibujan en `drawEffects()` (canvas, con `performance.now()`); el sonido se sintetiza con Web Audio (`tone`/`playSfx`), el `AudioContext` se crea en el primer `keydown`, y `KeyM` silencia (persistido en `localStorage`).
