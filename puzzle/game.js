// The page side of Word Tiles: board, keyboard, panels and saving progress.
// All the rules live in logic.js.

import {
  MAX_GUESSES,
  WORD_LENGTH,
  gameStatus,
  normalizeStats,
  pickAnswer,
  recordResult,
  rememberAnswer,
  scoreGuess,
  shareText,
  updateKeyStates,
  winRate,
} from './logic.js';
import { ANSWERS, VALID_WORDS } from './words.js';

// The key keeps its original name so stats from the daily version carry over.
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

const answerSet = new Set(ANSWERS);
const validWords = new Set(VALID_WORDS.split(' '));
for (const word of ANSWERS) validWords.add(word);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const byId = (id) => document.getElementById(id);
const el = {
  board: byId('board'),
  keyboard: byId('keyboard'),
  toasts: byId('toasts'),
  gameNo: byId('game-no'),
  streakLine: byId('streak-line'),
  help: byId('help'),
  stats: byId('stats'),
  giveup: byId('giveup'),
  resultLine: byId('result-line'),
  played: byId('st-played'),
  rate: byId('st-rate'),
  streak: byId('st-streak'),
  best: byId('st-best'),
  distribution: byId('distribution'),
  shareBtn: byId('share-btn'),
  shareLabel: byId('share-label'),
  fallbackWrap: byId('share-fallback-wrap'),
  fallback: byId('share-fallback'),
};
const panels = [el.help, el.stats, el.giveup];

let saved = { stats: normalizeStats(null), game: null, recent: [], seenHelp: false };
let game = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const motionOn = () => !reducedMotion.matches;
const isOver = () => game.status !== 'playing';

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
  saved.game = {
    id: game.id,
    number: game.number,
    answer: game.answer,
    guesses: [...game.guesses],
  };
  persist();
}

/** A saved game is usable only if it has an id, a known answer and real guesses. */
function isRestorable(prior) {
  return Boolean(prior)
    && Number.isInteger(prior.id)
    && answerSet.has(prior.answer)
    && Array.isArray(prior.guesses)
    && prior.guesses.every((g) => typeof g === 'string' && /^[a-z]{5}$/.test(g));
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
  if (r >= MAX_GUESSES || isOver()) return;
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
      } else if (key === 'backspace') {
        button.innerHTML = BACKSPACE_ICON;
        button.classList.add('wide');
        button.setAttribute('aria-label', 'Delete letter');
      } else {
        button.textContent = key;
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
    if (key === 'enter') {
      // Once a game ends, Enter starts the next one.
      button.textContent = isOver() ? 'Next' : 'Enter';
      button.setAttribute('aria-label', isOver() ? 'New word' : 'Submit guess');
      continue;
    }
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

/* Header */

function renderHeader() {
  el.gameNo.textContent = `Game ${game.number}`;
  el.streakLine.textContent = `Streak ${saved.stats.streak}`;
}

/* Playing */

function press(key) {
  if (!game || game.busy) return;
  if (isOver()) {
    if (key === 'enter') newGame();
    return;
  }
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
  if (game !== current) return; // The player started a new word mid-reveal.

  current.keys = updateKeyStates(current.keys, guess, score);
  current.status = gameStatus(current.guesses, current.answer);
  current.busy = false;
  renderKeys();
  if (isOver()) await finish(current);
}

function record(current) {
  saved.stats = recordResult(saved.stats, current.id, current.status === 'won', current.guesses.length);
  persist();
  renderHeader();
}

async function finish(current) {
  record(current);
  if (current.status === 'won') {
    toast(WIN_MESSAGES[current.guesses.length - 1]);
    await bounceRow(current.guesses.length - 1);
    await wait(500);
  } else {
    toast(`The word was ${current.answer.toUpperCase()}`, 3500);
    await wait(2200);
  }
  if (game === current && isOver()) openStats();
}

function giveUp() {
  if (isOver()) return;
  game.status = 'lost';
  record(game);
  toast(`The word was ${game.answer.toUpperCase()}`, 3500);
  newGame();
}

function toast(message, ms = 1500) {
  const note = document.createElement('div');
  note.className = 'toast';
  note.textContent = message;
  el.toasts.prepend(note);
  setTimeout(() => note.remove(), ms);
}

/* Games */

/** Sets up a game: the saved one if it is still usable, otherwise a fresh word. */
function startGame(prior) {
  const restoring = isRestorable(prior);
  const answer = restoring ? prior.answer : pickAnswer(ANSWERS, saved.recent);
  game = {
    id: restoring ? prior.id : Date.now(),
    number: restoring && Number.isInteger(prior.number) ? prior.number : saved.stats.played + 1,
    answer,
    guesses: [],
    scores: [],
    typed: '',
    keys: {},
    status: 'playing',
    busy: false,
  };
  if (!restoring) saved.recent = rememberAnswer(saved.recent, answer);

  buildBoard();
  if (restoring) {
    for (const guess of prior.guesses.slice(0, MAX_GUESSES)) {
      const score = scoreGuess(guess, answer);
      game.guesses.push(guess);
      game.scores.push(score);
      game.keys = updateKeyStates(game.keys, guess, score);
      paintRow(game.guesses.length - 1, guess, score);
      if (guess === answer) break;
    }
  }
  game.status = gameStatus(game.guesses, answer);
  // Covers a reload that happened between the last guess and saving the stats.
  if (isOver()) record(game);

  saveProgress();
  renderHeader();
  renderKeys();
  renderTyping();
  return isOver();
}

function newGame() {
  for (const panel of panels) if (panel.open) panel.close();
  startGame(null);
}

function requestNewGame() {
  if (game.busy) return;
  if (isOver() || game.guesses.length === 0) newGame();
  else openPanel(el.giveup);
}

/* Panels */

function openPanel(dialog) {
  for (const other of panels) {
    if (other !== dialog && other.open) other.close();
  }
  if (!dialog.open) dialog.showModal();
}

function renderStats() {
  const stats = saved.stats;
  el.played.textContent = stats.played;
  el.rate.textContent = `${winRate(stats)}%`;
  el.streak.textContent = stats.streak;
  el.best.textContent = stats.maxStreak;

  if (game.status === 'won') {
    el.resultLine.textContent = `Solved in ${game.guesses.length} of ${MAX_GUESSES}.`;
  } else if (game.status === 'lost') {
    el.resultLine.textContent = `The word was ${game.answer.toUpperCase()}.`;
  } else {
    const left = MAX_GUESSES - game.guesses.length;
    el.resultLine.textContent = `Game in progress. You have ${left} ${left === 1 ? 'guess' : 'guesses'} left.`;
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

  el.shareBtn.hidden = !isOver();
  el.shareLabel.textContent = 'Share result';
  el.fallbackWrap.hidden = true;
}

function openStats() {
  renderStats();
  openPanel(el.stats);
}

async function share() {
  const framed = window.self !== window.top;
  const url = !framed && /^https?:$/.test(location.protocol) ? location.href.split('#')[0] : '';
  const text = shareText(game.scores, game.status === 'won', url);

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

/* Start */

function start(data) {
  const stored = loadSaved();
  saved = {
    stats: normalizeStats(stored.stats),
    game: stored.game ?? null,
    recent: Array.isArray(stored.recent) ? stored.recent.filter((w) => answerSet.has(w)) : [],
    seenHelp: stored.seenHelp === true,
  };
  if (data?.game) saved.game = data.game;

  buildKeyboard();
  const finished = startGame(saved.game);
  if (!saved.seenHelp) {
    saved.seenHelp = true;
    persist();
    openPanel(el.help);
  } else if (finished) {
    openStats();
  }

  try {
    window.claude?.hot?.snapshot?.(() => ({ game: saved.game }));
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

byId('new-btn').addEventListener('click', requestNewGame);
byId('help-btn').addEventListener('click', () => openPanel(el.help));
byId('stats-btn').addEventListener('click', openStats);
byId('next-btn').addEventListener('click', requestNewGame);
byId('giveup-btn').addEventListener('click', giveUp);
el.shareBtn.addEventListener('click', share);

for (const dialog of panels) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
