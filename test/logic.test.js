import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFor,
  currentStreak,
  emptyStats,
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

test('puzzleNumber starts at 1 on 16 October 2026 and counts local days', () => {
  assert.equal(puzzleNumber(new Date(2026, 9, 16, 0, 0, 1)), 1);
  assert.equal(puzzleNumber(new Date(2026, 9, 16, 23, 59, 59)), 1);
  assert.equal(puzzleNumber(new Date(2026, 9, 17, 0, 0, 0)), 2);
  // Daylight saving ends in late October in many zones; the count must not skip.
  assert.equal(puzzleNumber(new Date(2026, 10, 1, 12)), 17);
  assert.equal(puzzleNumber(new Date(2027, 9, 16, 12)), 366);
});

test('answerFor walks the list in order and wraps around', () => {
  const list = ['alpha', 'bravo', 'charl'];
  assert.equal(answerFor(1, list), 'alpha');
  assert.equal(answerFor(3, list), 'charl');
  assert.equal(answerFor(4, list), 'alpha');
  assert.equal(answerFor(0, list), 'charl');
});

test('recordResult counts wins, losses and streaks', () => {
  let stats = emptyStats();
  stats = recordResult(stats, 1, true, 3);
  stats = recordResult(stats, 2, true, 4);
  assert.equal(stats.streak, 2);
  assert.equal(stats.maxStreak, 2);
  assert.deepEqual(stats.distribution, [0, 0, 1, 1, 0, 0]);

  stats = recordResult(stats, 3, false, 6);
  assert.equal(stats.streak, 0);
  assert.equal(stats.maxStreak, 2);

  stats = recordResult(stats, 5, true, 2);
  assert.equal(stats.streak, 1, 'a skipped day restarts the streak');
  assert.equal(stats.played, 4);
  assert.equal(stats.wins, 3);
  assert.equal(winRate(stats), 75);
});

test('recordResult ignores a second result for the same puzzle', () => {
  const once = recordResult(emptyStats(), 7, true, 4);
  assert.equal(recordResult(once, 7, true, 4), once);
});

test('currentStreak drops to zero once a day is missed', () => {
  const stats = recordResult(recordResult(emptyStats(), 1, true, 3), 2, true, 3);
  assert.equal(currentStreak(stats, 2), 2);
  assert.equal(currentStreak(stats, 3), 2, 'today is not finished yet');
  assert.equal(currentStreak(stats, 4), 0);
  assert.equal(currentStreak(emptyStats(), 1), 0);
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

test('shareText shows the grid without revealing letters', () => {
  const scores = [[A, P, A, A, C], [C, C, C, C, C]];
  assert.equal(shareText(12, scores, true), 'Daily Word No. 12 2/6\n\n⬜🟨⬜⬜🟩\n🟩🟩🟩🟩🟩');
  assert.match(shareText(12, scores, false), /^Daily Word No\. 12 X\/6/);
  assert.match(shareText(12, scores, true, 'https://example.com/'), /\n\nhttps:\/\/example\.com\/$/);
});

test('countdown reaches the next local midnight', () => {
  const now = new Date(2026, 9, 16, 23, 0, 0);
  assert.equal(msUntilNextPuzzle(now), 60 * 60 * 1000);
  assert.equal(formatCountdown(msUntilNextPuzzle(now)), '01:00:00');
  assert.equal(formatCountdown(3_723_000), '01:02:03');
  assert.equal(formatCountdown(-5), '00:00:00');
});
