import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERS, VALID_WORDS } from '../puzzle/words.js';

const valid = new Set(VALID_WORDS.split(' '));

test('every answer is five lowercase letters', () => {
  for (const word of ANSWERS) assert.match(word, /^[a-z]{5}$/, word);
});

test('answers have no repeats, so no word comes back before the list wraps', () => {
  assert.equal(new Set(ANSWERS).size, ANSWERS.length);
});

test('every answer is also an accepted guess', () => {
  const missing = ANSWERS.filter((word) => !valid.has(word));
  assert.deepEqual(missing, []);
});

test('the guess list is large and clean', () => {
  assert.ok(valid.size > 10_000, `only ${valid.size} accepted guesses`);
  for (const word of valid) assert.match(word, /^[a-z]{5}$/, word);
});

test('there are enough answers to rarely repeat', () => {
  assert.ok(ANSWERS.length >= 730, `only ${ANSWERS.length} answers`);
});
