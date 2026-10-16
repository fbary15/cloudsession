// The page side of Daily Word: board, keyboard, panels and saving progress.
// All the rules live in logic.js.

import {
  MAX_GUESSES,
  WORD_LENGTH,
  answerFor,
  currentStreak,
  formatCountdown,
  gameStatus,
  msUntilNextPuzzle,
  normalizeStats,
  puzzleNumber,
  recordResult,
  scoreGuess,
  shareText,
  updateKeyStates,
  winRate,
} from './logic.js';
import { ANSWERS, VALID_WORDS } from './words.js';

const STORAGE_KEY = 'daily-word:v1';
const FLIP_MS = 500;
const STAGGER_MS = 280;
const BOUNCE_STAGGER_MS = 100;
const WIN_MESSAGES = ['First try!', 'Brilliant', 'Sharp', 'Nice one', 'Solid', 'Close call'];
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', ['enter', ...'zxcvbnm', 'backspace']];
const STATE_LABEL = {
  correct: 'in the right spot',
  present: 'in the word, wrong spot',
  absent: 'not in the word',
};
const BACKSPACE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m12 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const validWords = new Set(VALID_WORDS.split(' '));
for (const word of ANSWERS) validWords.add(word);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const byId = (id) => document.getElementById(id);
const el = {
  board: byId('board'),
  keyboard: byId('keyboard'),
  toasts: byId('toasts'),
  number: byId('puzzle-no'),
  date: byId('puzzle-date'),
  help: byId('help'),
  stats: byId('stats'),
  todayLine: byId('today-line'),
  played: byId('st-played'),
  rate: byId('st-rate'),
  streak: byId('st-streak'),
  best: byId('st-best'),
  distribution: byId('distribution'),
  countdown: byId('countdown'),
  shareBtn: byId('share-btn'),
  shareLabel: byId('share-label'),
  fallbackWrap: byId('share-fallback-wrap'),
  fallback: byId('share-fallback'),
};

let saved = { stats: normalizeStats(null), game: null, seenHelp: false };
let game = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const motionOn = () => !reducedMotion.matches;

/* Saving */

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch {
    // Storage is blocked or holds something unreadable: start fresh.
  }
  return {};
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage is unavailable. The game still works, it just won't remember.
  }
}

function saveProgress() {
  saved.game = { number: game.number, guesses: [...game.guesses] };
  persist();
}

/* Board */

function buildBoard() {
  const rows = [];
  for (let r = 0; r < MAX_GUESSES; r += 1) {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `Guess ${r + 1} of ${MAX_GUESSES}`);
    for (let c = 0; c < WORD_LENGTH; c += 1) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.setAttribute('role', 'img');
      tile.setAttribute('aria-label', 'empty');
      row.append(tile);
    }
    rows.push(row);
  }
  el.board.replaceChildren(...rows);
}

const rowAt = (r) => el.board.children[r];
const tilesOf = (r) => [...rowAt(r).children];

function paintTile(tile, letter, state) {
  tile.textContent = letter ?? '';
  tile.classList.toggle('is-filled', Boolean(letter));
  if (state) tile.dataset.state = state;
  else delete tile.dataset.state;
  const label = letter ? letter.toUpperCase() : 'empty';
  tile.setAttribute('aria-label', state ? `${label}, ${STATE_LABEL[state]}` : label);
}

function paintRow(r, guess, score) {
  tilesOf(r).forEach((tile, i) => paintTile(tile, guess[i], score[i]));
}

function replay(node, className) {
  node.classList.remove(className);
  void node.offsetWidth; // Restart the animation if it is already applied.
  node.classList.add(className);
  node.addEventListener('animationend', () => node.classList.remove(className), { once: true });
}

function renderTyping(popIndex = -1) {
  const r = game.guesses.length;
  if (r >= MAX_GUESSES) return;
  tilesOf(r).forEach((tile, i) => {
    paintTile(tile, game.typed[i], null);
    if (i === popIndex && motionOn()) replay(tile, 'pop');
  });
}

async function revealRow(r, guess, score) {
  if (!motionOn()) {
    paintRow(r, guess, score);
    return;
  }
  tilesOf(r).forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.add('flip');
      setTimeout(() => paintTile(tile, guess[i], score[i]), FLIP_MS / 2);
      setTimeout(() => tile.classList.remove('flip'), FLIP_MS);
    }, i * STAGGER_MS);
  });
  await wait((WORD_LENGTH - 1) * STAGGER_MS + FLIP_MS);
}

async function bounceRow(r) {
  if (!motionOn()) return;
  tilesOf(r).forEach((tile, i) => setTimeout(() => replay(tile, 'bounce'), i * BOUNCE_STAGGER_MS));
  await wait((WORD_LENGTH - 1) * BOUNCE_STAGGER_MS + 900);
}

/* Keyboard */

function buildKeyboard() {
  const rows = KEY_ROWS.map((keys) => {
    const row = document.createElement('div');
    row.className = 'key-row';
    for (const key of keys) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key';
      button.dataset.key = key;
      if (key === 'enter') {
        button.textContent = 'Enter';
        button.classList.add('wide');
        button.setAttribute('aria-label', 'Submit guess');
      } else if (key === 'backspace') {
        button.innerHTML = BACKSPACE_ICON;
        button.classList.add('wide');
        button.setAttribute('aria-label', 'Delete letter');
      } else {
        button.textContent = key;
        button.setAttribute('aria-label', key.toUpperCase());
      }
      row.append(button);
    }
    return row;
  });
  el.keyboard.replaceChildren(...rows);
}

function renderKeys() {
  for (const button of el.keyboard.querySelectorAll('[data-key]')) {
    const key = button.dataset.key;
    if (key.length !== 1) continue;
    const state = game.keys[key];
    if (state) {
      button.dataset.state = state;
      button.setAttribute('aria-label', `${key.toUpperCase()}, ${STATE_LABEL[state]}`);
    } else {
      delete button.dataset.state;
      button.setAttribute('aria-label', key.toUpperCase());
    }
  }
}

/* Playing */

function press(key) {
  if (!game || game.status !== 'playing' || game.busy) return;
  if (key === 'enter') {
    submit();
  } else if (key === 'backspace') {
    if (game.typed) {
      game.typed = game.typed.slice(0, -1);
      renderTyping();
    }
  } else if (/^[a-z]$/.test(key) && game.typed.length < WORD_LENGTH) {
    game.typed += key;
    renderTyping(game.typed.length - 1);
  }
}

function reject(message) {
  if (motionOn()) replay(rowAt(game.guesses.length), 'shake');
  toast(message);
}

async function submit() {
  const guess = game.typed;
  if (guess.length < WORD_LENGTH) {
    reject('Not enough letters');
    return;
  }
  if (!validWords.has(guess)) {
    reject('Not in the word list');
    return;
  }

  const current = game;
  const r = current.guesses.length;
  const score = scoreGuess(guess, current.answer);
  current.guesses.push(guess);
  current.scores.push(score);
  current.typed = '';
  current.busy = true;
  saveProgress();

  await revealRow(r, guess, score);
  if (game !== current) return; // A new day started while the tiles turned.

  current.keys = updateKeyStates(current.keys, guess, score);
  renderKeys();
  current.status = gameStatus(current.guesses, current.answer);
  current.busy = false;
  if (current.status !== 'playing') await finish(current);
}

async function finish(current) {
  const won = current.status === 'won';
  saved.stats = recordResult(saved.stats, current.number, won, current.guesses.length);
  persist();
  if (won) {
    toast(WIN_MESSAGES[current.guesses.length - 1]);
    await bounceRow(current.guesses.length - 1);
    await wait(500);
  } else {
    toast(`The word was ${current.answer.toUpperCase()}`, 3500);
    await wait(2200);
  }
  if (game === current) openStats();
}

function toast(message, ms = 1500) {
  const note = document.createElement('div');
  note.className = 'toast';
  note.textContent = message;
  el.toasts.prepend(note);
  setTimeout(() => note.remove(), ms);
}

/* Panels */

function openPanel(dialog) {
  for (const other of [el.help, el.stats]) {
    if (other !== dialog && other.open) other.close();
  }
  if (!dialog.open) dialog.showModal();
}

function renderStats() {
  const stats = saved.stats;
  el.played.textContent = stats.played;
  el.rate.textContent = `${winRate(stats)}%`;
  el.streak.textContent = currentStreak(stats, game.number);
  el.best.textContent = stats.maxStreak;

  if (game.status === 'won') {
    el.todayLine.textContent = `Solved in ${game.guesses.length} of ${MAX_GUESSES}.`;
  } else if (game.status === 'lost') {
    el.todayLine.textContent = `Today's word was ${game.answer.toUpperCase()}.`;
  } else {
    el.todayLine.textContent = `Today's word is still waiting. You have ${MAX_GUESSES - game.guesses.length} guesses left.`;
  }

  const most = Math.max(1, ...stats.distribution);
  const solvedIn = game.status === 'won' ? game.guesses.length : 0;
  el.distribution.replaceChildren(...stats.distribution.map((count, i) => {
    const item = document.createElement('li');
    item.setAttribute('aria-label', `${count} ${count === 1 ? 'win' : 'wins'} in ${i + 1}`);
    const label = document.createElement('span');
    label.className = 'dist-label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = i + 1;
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.textContent = count;
    bar.style.setProperty('--w', `${Math.max(8, (count / most) * 100)}%`);
    bar.classList.toggle('is-today', solvedIn === i + 1);
    item.append(label, bar);
    return item;
  }));

  el.shareBtn.hidden = game.status === 'playing';
  el.shareLabel.textContent = 'Share result';
  el.fallbackWrap.hidden = true;
  updateCountdown();
}

function openStats() {
  renderStats();
  openPanel(el.stats);
}

function updateCountdown() {
  el.countdown.textContent = formatCountdown(msUntilNextPuzzle());
}

async function share() {
  const framed = window.self !== window.top;
  const url = !framed && /^https?:$/.test(location.protocol) ? location.href.split('#')[0] : '';
  const text = shareText(game.number, game.scores, game.status === 'won', url);

  if (!framed && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    el.shareLabel.textContent = 'Copied';
    setTimeout(() => { el.shareLabel.textContent = 'Share result'; }, 1800);
  } catch {
    el.fallback.value = text;
    el.fallbackWrap.hidden = false;
    el.fallback.focus();
    el.fallback.select();
  }
}

/* Days */

function renderHeader() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  el.number.textContent = `No. ${game.number}`;
  el.date.dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  el.date.textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Sets up today's puzzle, restoring earlier guesses. Returns true if it is already over. */
function startDay() {
  const number = puzzleNumber();
  game = {
    number,
    answer: answerFor(number, ANSWERS),
    guesses: [],
    scores: [],
    typed: '',
    keys: {},
    status: 'playing',
    busy: false,
  };
  buildBoard();
  renderHeader();

  const prior = saved.game;
  if (prior && prior.number === number && Array.isArray(prior.guesses)) {
    for (const guess of prior.guesses.slice(0, MAX_GUESSES)) {
      if (typeof guess !== 'string' || !/^[a-z]{5}$/.test(guess)) break;
      const score = scoreGuess(guess, game.answer);
      game.guesses.push(guess);
      game.scores.push(score);
      game.keys = updateKeyStates(game.keys, guess, score);
      paintRow(game.guesses.length - 1, guess, score);
      if (guess === game.answer) break;
    }
  }
  saveProgress();
  renderKeys();
  renderTyping();

  game.status = gameStatus(game.guesses, game.answer);
  if (game.status === 'playing') return false;
  // Covers a reload that happened between the last guess and saving the stats.
  saved.stats = recordResult(saved.stats, number, game.status === 'won', game.guesses.length);
  persist();
  return true;
}

function start(data) {
  const stored = loadSaved();
  saved = {
    stats: normalizeStats(stored.stats),
    game: stored.game ?? null,
    seenHelp: stored.seenHelp === true,
  };
  if (data?.game) saved.game = data.game;

  buildKeyboard();
  const finished = startDay();
  if (!saved.seenHelp) {
    saved.seenHelp = true;
    persist();
    openPanel(el.help);
  } else if (finished) {
    openStats();
  }

  try {
    window.claude?.hot?.snapshot?.(() => ({ game: { number: game.number, guesses: [...game.guesses] } }));
  } catch {
    // Live updates are only available inside the Claude viewer.
  }
}

/* Wiring */

el.keyboard.addEventListener('click', (event) => {
  const button = event.target.closest('[data-key]');
  if (button) press(button.dataset.key);
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  let key = event.key.toLowerCase();
  if (event.key === 'Enter') key = 'enter';
  if (event.key === 'Backspace') key = 'backspace';
  if (key === 'enter' || key === 'backspace' || /^[a-z]$/.test(key)) {
    event.preventDefault();
    press(key);
  }
});

byId('help-btn').addEventListener('click', () => openPanel(el.help));
byId('stats-btn').addEventListener('click', openStats);
el.shareBtn.addEventListener('click', share);

for (const dialog of [el.help, el.stats]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
}

setInterval(() => {
  if (!game) return;
  if (puzzleNumber() !== game.number && !game.busy) {
    if (el.stats.open) el.stats.close();
    startDay();
    return;
  }
  if (el.stats.open) updateCountdown();
}, 1000);

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
