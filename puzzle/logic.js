// Pure game logic for Daily Word. Nothing here touches the page, so the same
// code runs in the browser and in the Node test suite.

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

// Puzzle No. 1 is 16 October 2026, counted in the player's own time zone.
const FIRST_DAY_UTC = Date.UTC(2026, 9, 16);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The puzzle number for the player's local calendar date. */
export function puzzleNumber(date = new Date()) {
  const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((localDay - FIRST_DAY_UTC) / DAY_MS) + 1;
}

/** The answer for a puzzle number, cycling through the list. */
export function answerFor(number, answers) {
  const count = answers.length;
  return answers[(((number - 1) % count) + count) % count];
}

/**
 * Colors a guess against the answer. Exact matches are marked first, then
 * letters in the wrong spot, so a repeated letter is only marked as often as
 * it appears in the answer.
 */
export function scoreGuess(guess, answer) {
  const result = Array.from(guess, () => 'absent');
  const unmatched = new Map();

  for (let i = 0; i < answer.length; i += 1) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      unmatched.set(answer[i], (unmatched.get(answer[i]) ?? 0) + 1);
    }
  }

  for (let i = 0; i < guess.length; i += 1) {
    const left = unmatched.get(guess[i]) ?? 0;
    if (result[i] !== 'correct' && left > 0) {
      result[i] = 'present';
      unmatched.set(guess[i], left - 1);
    }
  }

  return result;
}

const RANK = { absent: 1, present: 2, correct: 3 };

/** Keyboard colors: each key keeps the best result it has had so far. */
export function updateKeyStates(keys, guess, score) {
  const next = { ...keys };
  for (let i = 0; i < guess.length; i += 1) {
    const letter = guess[i];
    if (!next[letter] || RANK[score[i]] > RANK[next[letter]]) {
      next[letter] = score[i];
    }
  }
  return next;
}

export function gameStatus(guesses, answer) {
  if (guesses.includes(answer)) return 'won';
  if (guesses.length >= MAX_GUESSES) return 'lost';
  return 'playing';
}

export function emptyStats() {
  return {
    played: 0,
    wins: 0,
    streak: 0,
    maxStreak: 0,
    lastWon: null,
    lastPlayed: null,
    distribution: Array(MAX_GUESSES).fill(0),
  };
}

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isDay = (value) => value === null || Number.isInteger(value);

/** Repairs stats loaded from storage, dropping any field that looks wrong. */
export function normalizeStats(raw) {
  const stats = emptyStats();
  if (!raw || typeof raw !== 'object') return stats;
  for (const key of ['played', 'wins', 'streak', 'maxStreak']) {
    if (isCount(raw[key])) stats[key] = raw[key];
  }
  for (const key of ['lastWon', 'lastPlayed']) {
    if (isDay(raw[key])) stats[key] = raw[key];
  }
  if (Array.isArray(raw.distribution) && raw.distribution.length === MAX_GUESSES
    && raw.distribution.every(isCount)) {
    stats.distribution = [...raw.distribution];
  }
  return stats;
}

/**
 * Adds one finished puzzle to the stats. Recording the same puzzle twice
 * changes nothing, so a reload after the last guess cannot double count.
 */
export function recordResult(stats, number, won, guessCount) {
  if (stats.lastPlayed === number) return stats;
  const next = { ...stats, distribution: [...stats.distribution] };
  next.played += 1;
  next.lastPlayed = number;
  if (won) {
    next.wins += 1;
    next.streak = stats.lastWon === number - 1 ? stats.streak + 1 : 1;
    next.maxStreak = Math.max(next.maxStreak, next.streak);
    next.lastWon = number;
    next.distribution[guessCount - 1] += 1;
  } else {
    next.streak = 0;
  }
  return next;
}

/** The streak still counts if the last win was today or yesterday. */
export function currentStreak(stats, today) {
  return stats.lastWon !== null && stats.lastWon >= today - 1 ? stats.streak : 0;
}

export function winRate(stats) {
  return stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
}

const SQUARES = { correct: '🟩', present: '🟨', absent: '⬜' };

/** The spoiler-free result grid people paste into a chat. */
export function shareText(number, scores, won, url = '') {
  const tally = won ? scores.length : 'X';
  const grid = scores.map((row) => row.map((s) => SQUARES[s]).join('')).join('\n');
  const text = `Daily Word No. ${number} ${tally}/${MAX_GUESSES}\n\n${grid}`;
  return url ? `${text}\n\n${url}` : text;
}

/** Milliseconds until the next local midnight, when a new word arrives. */
export function msUntilNextPuzzle(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((n) => String(n).padStart(2, '0')).join(':');
}
