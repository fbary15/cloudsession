import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStats,
  gameStatus,
  normalizeStats,
  pickAnswer,
  recordResult,
  rememberAnswer,
  scoreGuess,
  shareText,
  updateKeyStates,
  winRate,
} from '../puzzle/logic.js';

const C = 'correct';
const P = 'present';
const A = 'absent';

test('scoreGuess marks exact, misplaced and missing letters', () => {
  assert.deepEqual(scoreGuess('crane', 'crane'), [C, C, C, C, C]);
  assert.deepEqual(scoreGuess('nacre', 'crane'), [P, P, P, P, C]);
  assert.deepEqual(scoreGuess('fluid', 'crane'), [A, A, A, A, A]);
});

test('scoreGuess only marks a repeated letter as often as the answer has it', () => {
  // The answer's only E is matched exactly, so the earlier E's get nothing.
  assert.deepEqual(scoreGuess('geese', 'those'), [A, A, A, C, C]);
  assert.deepEqual(scoreGuess('eerie', 'crane'), [A, A, P, A, C]);
  // Two L's in the answer allow two misplaced L's.
  assert.deepEqual(scoreGuess('llama', 'hello'), [P, P, A, A, A]);
  assert.deepEqual(scoreGuess('allot', 'hello'), [A, P, C, P, A]);
  // An exact match uses up the letter before an earlier copy can claim it.
  assert.deepEqual(scoreGuess('llama', 'plant'), [A, C, C, A, A]);
});

test('updateKeyStates never downgrades a key', () => {
  let keys = updateKeyStates({}, 'crane', [C, A, P, A, A]);
  assert.deepEqual(keys, { c: C, r: A, a: P, n: A, e: A });
  keys = updateKeyStates(keys, 'acorn', [C, P, A, A, A]);
  assert.equal(keys.a, C, 'present upgrades to correct');
  assert.equal(keys.c, C, 'correct stays correct');
});

test('gameStatus reports a win, a loss, or a game in progress', () => {
  assert.equal(gameStatus([], 'crane'), 'playing');
  assert.equal(gameStatus(['fluid', 'crane'], 'crane'), 'won');
  assert.equal(gameStatus(Array(6).fill('fluid'), 'crane'), 'lost');
  assert.equal(gameStatus([...Array(5).fill('fluid'), 'crane'], 'crane'), 'won');
});

test('pickAnswer skips words that came up recently', () => {
  const list = ['alpha', 'bravo', 'charl', 'delta'];
  const first = () => 0;
  assert.equal(pickAnswer(list, [], first), 'alpha');
  assert.equal(pickAnswer(list, ['alpha', 'bravo'], first), 'charl');
  assert.equal(pickAnswer(list, ['alpha', 'bravo'], () => 0.99), 'delta');
});

test('pickAnswer falls back to the whole list once every word is recent', () => {
  const list = ['alpha', 'bravo'];
  assert.equal(pickAnswer(list, ['alpha', 'bravo'], () => 0.6), 'bravo');
});

test('rememberAnswer keeps the newest words and no repeats', () => {
  assert.deepEqual(rememberAnswer(['a', 'b'], 'c', 3), ['a', 'b', 'c']);
  assert.deepEqual(rememberAnswer(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
  assert.deepEqual(rememberAnswer(['a', 'b', 'c'], 'a', 3), ['b', 'c', 'a']);
});

test('recordResult counts wins, losses and wins in a row', () => {
  let stats = emptyStats();
  stats = recordResult(stats, 1, true, 3);
  stats = recordResult(stats, 2, true, 4);
  assert.equal(stats.streak, 2);
  assert.equal(stats.maxStreak, 2);
  assert.deepEqual(stats.distribution, [0, 0, 1, 1, 0, 0]);

  stats = recordResult(stats, 3, false, 6);
  assert.equal(stats.streak, 0);
  assert.equal(stats.maxStreak, 2);

  stats = recordResult(stats, 4, true, 2);
  assert.equal(stats.streak, 1);
  assert.equal(stats.played, 4);
  assert.equal(stats.wins, 3);
  assert.equal(winRate(stats), 75);
});

test('recordResult ignores a second result for the same game', () => {
  const once = recordResult(emptyStats(), 7, true, 4);
  assert.equal(recordResult(once, 7, true, 4), once);
});

test('normalizeStats keeps good fields and repairs bad ones', () => {
  assert.deepEqual(normalizeStats(null), emptyStats());
  assert.deepEqual(normalizeStats('junk'), emptyStats());
  const fixed = normalizeStats({ played: 4, wins: -1, streak: 'two', distribution: [1, 2] });
  assert.equal(fixed.played, 4);
  assert.equal(fixed.wins, 0);
  assert.equal(fixed.streak, 0);
  assert.deepEqual(fixed.distribution, [0, 0, 0, 0, 0, 0]);
});

test('normalizeStats keeps stats saved by the daily version', () => {
  const old = { played: 3, wins: 2, streak: 1, maxStreak: 2, lastWon: 2, lastPlayed: 3, distribution: [0, 1, 1, 0, 0, 0] };
  const kept = normalizeStats(old);
  assert.equal(kept.played, 3);
  assert.equal(kept.maxStreak, 2);
  assert.deepEqual(kept.distribution, [0, 1, 1, 0, 0, 0]);
});

test('shareText shows the grid without revealing letters', () => {
  const scores = [[A, P, A, A, C], [C, C, C, C, C]];
  assert.equal(shareText(scores, true), 'Word Tiles 2/6\n\n⬜🟨⬜⬜🟩\n🟩🟩🟩🟩🟩');
  assert.match(shareText(scores, false), /^Word Tiles X\/6/);
  assert.match(shareText(scores, true, 'https://example.com/'), /\n\nhttps:\/\/example\.com\/$/);
});
