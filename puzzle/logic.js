// Pure game logic for Word Tiles. Nothing here touches the page, so the same
// code runs in the browser and in the Node test suite.

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

// How many recent answers to avoid when picking the next word.
export const RECENT_LIMIT = 300;

/**
 * Picks a random answer that has not come up recently. Once every word has
 * been used recently, any word can come up again.
 */
export function pickAnswer(answers, recent = [], random = Math.random) {
  const skip = new Set(recent);
  const fresh = answers.filter((word) => !skip.has(word));
  const pool = fresh.length > 0 ? fresh : answers;
  return pool[Math.floor(random() * pool.length)];
}

/** Adds an answer to the recent list, keeping only the newest ones. */
export function rememberAnswer(recent, answer, limit = RECENT_LIMIT) {
  return [...recent.filter((word) => word !== answer), answer].slice(-limit);
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
    lastPlayed: null,
    distribution: Array(MAX_GUESSES).fill(0),
  };
}

const isCount = (value) => Number.isInteger(value) && value >= 0;

/** Repairs stats loaded from storage, dropping any field that looks wrong. */
export function normalizeStats(raw) {
  const stats = emptyStats();
  if (!raw || typeof raw !== 'object') return stats;
  for (const key of ['played', 'wins', 'streak', 'maxStreak']) {
    if (isCount(raw[key])) stats[key] = raw[key];
  }
  if (Number.isInteger(raw.lastPlayed)) stats.lastPlayed = raw.lastPlayed;
  if (Array.isArray(raw.distribution) && raw.distribution.length === MAX_GUESSES
    && raw.distribution.every(isCount)) {
    stats.distribution = [...raw.distribution];
  }
  return stats;
}

/**
 * Adds one finished game to the stats. The streak counts wins in a row.
 * Recording the same game twice changes nothing, so a reload right after the
 * last guess cannot double count.
 */
export function recordResult(stats, gameId, won, guessCount) {
  if (stats.lastPlayed === gameId) return stats;
  const next = { ...stats, distribution: [...stats.distribution] };
  next.played += 1;
  next.lastPlayed = gameId;
  if (won) {
    next.wins += 1;
    next.streak = stats.streak + 1;
    next.maxStreak = Math.max(next.maxStreak, next.streak);
    next.distribution[guessCount - 1] += 1;
  } else {
    next.streak = 0;
  }
  return next;
}

export function winRate(stats) {
  return stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
}

const SQUARES = { correct: '🟩', present: '🟨', absent: '⬜' };

/** The spoiler-free result grid people paste into a chat. */
export function shareText(scores, won, url = '') {
  const tally = won ? scores.length : 'X';
  const grid = scores.map((row) => row.map((s) => SQUARES[s]).join('')).join('\n');
  const text = `Word Tiles ${tally}/${MAX_GUESSES}\n\n${grid}`;
  return url ? `${text}\n\n${url}` : text;
}
