'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Colores de piezas (I, O, T, S, Z, J, L, N) definidos en style.css como --c1..--c8;
// --c9 (basura) y --c10 (bloques fijos) solo existen en COLORS, no en PIECES
let COLORS = [null];
let gridColor = '#22222e';
let highlightColor = 'rgba(255,255,255,0.12)';
let accentColor = '#7aa2f7';
let bgColor = '#0f0f17';

function readThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  COLORS = [null];
  for (let i = 1; i <= 10; i++) COLORS.push(cs.getPropertyValue(`--c${i}`).trim());
  gridColor = cs.getPropertyValue('--grid').trim();
  highlightColor = cs.getPropertyValue('--highlight').trim();
  accentColor = cs.getPropertyValue('--accent').trim();
  bgColor = cs.getPropertyValue('--bg').trim();
}

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [400, 800, 1200, 1600];
const PC_SCORES = [0, 800, 1200, 1800, 2000];

const GARBAGE = 9;
const FIXED = 10;
const FIXED_LAYOUT = [
  '#...##...#',
  '##..##..##',
  '#.#....#.#',
  '###.##.###',
  '#.######.#',
  '####..####',
];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const comboEl = document.getElementById('combo');
const b2bEl = document.getElementById('b2b');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const menuBtn = document.getElementById('menu-btn');
const modeMenu = document.getElementById('mode-menu');
const modeNameEl = document.getElementById('mode-name');
const goalEl = document.getElementById('goal');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, b2b, lastMoveRotate, popups, flashRows;
let muted = false, audioCtx = null;
try { muted = localStorage.getItem('muted') === '1'; } catch (e) {}

let modeKey, mode, elapsed, garbageAccum, lockFade, reverseAnnounced, reveal;

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function countCells(v) {
  return board.reduce((n, row) => n + row.filter(x => x === v).length, 0);
}

function isReversed() {
  return !!mode.reverseFrom && level >= mode.reverseFrom;
}

function placeFixed() {
  const top = ROWS - FIXED_LAYOUT.length;
  FIXED_LAYOUT.forEach((row, i) => {
    [...row].forEach((ch, c) => { if (ch === '#') board[top + i][c] = FIXED; });
  });
}

// progress/won/failed leen el estado global; setup prepara el tablero inicial
const MODES = {
  classic: {
    name: 'Clásico',
    desc: 'Sin límite: consigue la máxima puntuación',
  },
  sprint: {
    name: '40 líneas',
    desc: 'Limpia 40 líneas en 2:00',
    progress: () => `${lines}/40 · ${fmtTime(120000 - elapsed)}`,
    won: () => lines >= 40,
    failed: () => elapsed >= 120000,
  },
  garbage: {
    name: 'Basura',
    desc: 'Sobrevive 2:00; sube basura cada 10 s',
    garbageEvery: 10000,
    progress: () => `${fmtTime(120000 - elapsed)} · basura en ${Math.ceil((10000 - garbageAccum) / 1000)}s`,
    won: () => elapsed >= 120000,
  },
  fixed: {
    name: 'Bloques fijos',
    desc: 'Elimina todos los bloques fijos',
    setup: placeFixed,
    progress: () => `Fijos: ${countCells(FIXED)}`,
    won: () => countCells(FIXED) === 0,
  },
  invisible: {
    name: 'Invisible',
    desc: 'Las piezas desaparecen al fijarse. Limpia 20 líneas',
    invisible: true,
    progress: () => `${lines}/20`,
    won: () => lines >= 20,
  },
  reverse: {
    name: 'Rotación inversa',
    desc: 'Desde el nivel 5 la rotación se invierte. Llega al nivel 10',
    reverseFrom: 5,
    progress: () => `Nivel ${level}/10${isReversed() ? ' · ⟲' : ''}`,
    won: () => level >= 10,
  },
};

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function rotateCCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[cols - 1 - c][r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = isReversed() ? rotateCCW(current.shape) : rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveRotate = true;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  const full = [];
  for (let r = 0; r < ROWS; r++) if (board[r].every(v => v !== 0)) full.push(r);
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    const t0 = performance.now();
    flashRows = full.map(r => ({ r, t0 }));
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  if (gy > current.y) lastMoveRotate = false;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastMoveRotate = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

// T-spin de 3 esquinas: la T debe haber rotado como último movimiento
function isTSpin() {
  if (current.type !== 3 || !lastMoveRotate) return false;
  const corners = [[0, 0], [2, 0], [0, 2], [2, 2]];
  const filled = corners.filter(([dx, dy]) => collide([[1]], current.x + dx, current.y + dy));
  return filled.length >= 3;
}

// ci: índice en COLORS; 0 = color de acento
function addPopup(text, ci = 0) {
  const now = performance.now();
  const slot = popups.filter(p => now - p.t0 < 900).length;
  popups.push({ text, ci, slot, t0: now });
}

function shake() {
  canvas.classList.remove('shake');
  void canvas.offsetWidth; // reinicia la animación
  canvas.classList.add('shake');
}

function initAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('muted', muted ? '1' : '0'); } catch (e) {}
}

function tone(freq, dur, type = 'square', delay = 0) {
  if (muted || !audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function playSfx(kind, n = 0) {
  switch (kind) {
    case 'clear':
      tone(440, 0.12);
      break;
    case 'combo':
      tone(440 * 2 ** (Math.min(n, 12) / 12), 0.15, 'triangle');
      break;
    case 'tspin':
      tone(330, 0.12);
      tone(495, 0.2, 'square', 0.1);
      break;
    case 'tetris':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'triangle', i * 0.07));
      break;
    case 'b2b':
      tone(1319, 0.2, 'sine', 0.3);
      break;
    case 'perfect':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'square', i * 0.1));
      break;
    case 'garbage':
      tone(110, 0.2, 'sawtooth');
      break;
    case 'win':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'triangle', i * 0.09));
      break;
    case 'lose':
      tone(392, 0.2, 'sawtooth');
      tone(262, 0.35, 'sawtooth', 0.18);
      break;
    case 'reverse':
      tone(659, 0.12, 'triangle');
      tone(440, 0.2, 'triangle', 0.1);
      break;
  }
}

// Sube una fila de basura con un hueco aleatorio
function addGarbage() {
  if (board[0].some(v => v)) { endGame(false); return; }
  const hole = Math.floor(Math.random() * COLS);
  board.shift();
  board.push(Array.from({ length: COLS }, (_, c) => (c === hole ? 0 : GARBAGE)));
  if (collide(current.shape, current.x, current.y)) {
    current.y--;
    if (collide(current.shape, current.x, current.y)) { endGame(false); return; }
  }
  shake();
  playSfx('garbage');
  addPopup('¡BASURA!', GARBAGE);
}

function checkGoal() {
  if (mode.won?.()) { endGame(true); return; }
  if (mode.failed?.()) { endGame(false); return; }
  if (isReversed() && !reverseAnnounced) {
    reverseAnnounced = true;
    addPopup('¡ROTACIÓN INVERSA!', 5);
    playSfx('reverse');
  }
}

function applyScore(cleared, tspin, lvl) {
  const names = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];
  if (!cleared) {
    combo = 0;
    if (tspin) {
      const pts = TSPIN_SCORES[0] * lvl;
      score += pts;
      addPopup('T-SPIN', 3);
      addPopup(`+${pts.toLocaleString()}`);
      playSfx('tspin');
    }
    updateHUD();
    return;
  }

  combo++;
  const hard = tspin || cleared === 4;
  const b2bBonus = hard && b2b;
  b2b = hard; // una limpieza normal (1–3 líneas sin T-spin) rompe el B2B
  const base = tspin ? TSPIN_SCORES[cleared] : LINE_SCORES[cleared];
  const perfect = board.every(row => row.every(v => !v));
  const pts = (Math.round(base * (b2bBonus ? 1.5 : 1) * combo) + (perfect ? PC_SCORES[cleared] : 0)) * lvl;
  score += pts;

  if (tspin) addPopup(`T-SPIN ${names[cleared]}`, 3);
  else if (cleared === 4) addPopup('TETRIS');
  if (b2bBonus) addPopup('B2B', 1);
  if (combo >= 2) addPopup(`COMBO x${combo}`);
  if (perfect) addPopup('PERFECT CLEAR!', 2);
  addPopup(`+${pts.toLocaleString()}`);

  if (perfect) playSfx('perfect');
  else if (tspin) playSfx('tspin');
  else if (cleared === 4) playSfx('tetris');
  else if (combo >= 2) playSfx('combo', combo);
  else playSfx('clear');
  if (b2bBonus) playSfx('b2b');
  if (perfect || cleared === 4) shake();
  updateHUD();
}

function lockPiece() {
  const tspin = isTSpin();
  const lvl = level; // la puntuación usa el nivel previo a la limpieza
  if (mode.invisible) {
    const cells = [];
    current.shape.forEach((row, r) => row.forEach((v, c) => {
      if (v) cells.push([current.x + c, current.y + r, v]);
    }));
    lockFade = { cells, t0: performance.now() };
  }
  merge();
  const cleared = clearLines();
  applyScore(cleared, tspin, lvl);
  checkGoal();
  if (gameOver) return;
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = combo >= 2 ? `x${combo}` : '—';
  b2bEl.classList.toggle('b2b-on', b2b);
  modeNameEl.textContent = mode.name;
  updateGoal();
}

function updateGoal() {
  const text = mode.progress?.() ?? '—';
  if (goalEl.textContent !== text) goalEl.textContent = text;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = highlightColor;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board (en modo invisible solo se revela al terminar)
  if (!mode.invisible || reveal)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  drawEffects();
}

function drawEffects() {
  const now = performance.now();

  // flash de las filas recién limpiadas
  flashRows = flashRows.filter(f => now - f.t0 < 200);
  ctx.fillStyle = '#fff';
  for (const f of flashRows) {
    ctx.globalAlpha = 0.6 * (1 - (now - f.t0) / 200);
    ctx.fillRect(0, f.r * BLOCK, COLS * BLOCK, BLOCK);
  }
  ctx.globalAlpha = 1;

  // fundido de la pieza recién fijada (modo invisible)
  if (lockFade) {
    const age = (now - lockFade.t0) / 400;
    if (age >= 1) lockFade = null;
    else for (const [x, y, ci] of lockFade.cells) drawBlock(ctx, x, y, ci, BLOCK, 1 - age);
  }

  // textos flotantes
  popups = popups.filter(p => now - p.t0 < 900);
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  for (const p of popups) {
    const age = (now - p.t0) / 900;
    const x = canvas.width / 2;
    const y = canvas.height / 3 + p.slot * 28 - age * 30;
    ctx.globalAlpha = Math.min(1, 2 * (1 - age));
    ctx.strokeStyle = bgColor;
    ctx.strokeText(p.text, x, y);
    ctx.fillStyle = p.ci ? COLORS[p.ci] : accentColor;
    ctx.fillText(p.text, x, y);
  }
  ctx.globalAlpha = 1;
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame(won = false) {
  gameOver = true;
  cancelAnimationFrame(animId);
  const classic = modeKey === 'classic';
  if (mode.invisible) { reveal = true; draw(); }
  overlayTitle.textContent = won ? '¡DESAFÍO SUPERADO!' : classic ? 'GAME OVER' : 'DESAFÍO FALLIDO';
  overlayTitle.classList.toggle('win', won);
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}` + (classic ? '' : ` · ${fmtTime(elapsed)}`);
  modeMenu.classList.add('hidden');
  restartBtn.classList.remove('hidden');
  menuBtn.classList.remove('hidden');
  overlay.classList.remove('hidden');
  if (!classic) playSfx(won ? 'win' : 'lose');
}

function showMenu() {
  gameOver = true; // bloquea teclado y pausa mientras se elige modo
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'ELIGE MODO';
  overlayTitle.classList.remove('win');
  overlayScore.textContent = '';
  modeMenu.classList.remove('hidden');
  restartBtn.classList.add('hidden');
  menuBtn.classList.add('hidden');
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  // los relojes del modo ignoran saltos largos (pestaña en segundo plano)
  const tdt = Math.min(dt, 250);
  elapsed += tdt;
  if (mode.garbageEvery) {
    garbageAccum += tdt;
    if (garbageAccum >= mode.garbageEvery) {
      garbageAccum = 0;
      addGarbage();
      if (gameOver) return;
    }
  }
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      lastMoveRotate = false;
    } else {
      lockPiece();
    }
  }
  if (!gameOver) checkGoal();
  if (gameOver) return;
  updateGoal();
  draw();
  animId = requestAnimationFrame(loop);
}

function init(key = modeKey) {
  modeKey = key;
  mode = MODES[key];
  board = createBoard();
  mode.setup?.();
  elapsed = 0;
  garbageAccum = 0;
  lockFade = null;
  reverseAnnounced = false;
  reveal = false;
  overlayTitle.classList.remove('win');
  modeMenu.classList.add('hidden');
  restartBtn.classList.remove('hidden');
  menuBtn.classList.remove('hidden');
  combo = 0;
  b2b = false;
  lastMoveRotate = false;
  popups = [];
  flashRows = [];
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  initAudio();
  if (e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastMoveRotate = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastMoveRotate = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => init());
menuBtn.addEventListener('click', showMenu);

for (const [key, m] of Object.entries(MODES)) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const name = document.createElement('strong');
  name.textContent = m.name;
  const desc = document.createElement('small');
  desc.textContent = m.desc;
  btn.append(name, desc);
  btn.addEventListener('click', () => { btn.blur(); init(key); });
  modeMenu.append(btn);
}

const themeToggle = document.getElementById('theme-toggle');

function applyTheme(theme) {
  const light = theme === 'light';
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  themeToggle.setAttribute('aria-pressed', String(light));
  themeToggle.setAttribute('aria-label', light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  themeToggle.textContent = light ? '☾ Oscuro' : '☀ Claro';
  readThemeColors();
  // Redibuja también en pausa / game over, cuando el loop no corre
  if (current && next) { draw(); drawNext(); }
}

themeToggle.addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
  applyTheme(light ? 'light' : 'dark');
  themeToggle.blur(); // evita que Space/teclas del juego activen el botón
});

let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch (e) {}
applyTheme(savedTheme === 'light' ? 'light' : 'dark');

showMenu();
