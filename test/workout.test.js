import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXERCISES,
  backupText,
  beatsRecord,
  bestSet,
  cleanName,
  displayMax,
  emptyData,
  estimateMax,
  exerciseInfo,
  finishWorkout,
  formatSet,
  formatWeight,
  fromDisplay,
  lastSets,
  niceTicks,
  normalizeData,
  parseBackup,
  progressSeries,
  recentExerciseNames,
  recentRecords,
  records,
  routineChanged,
  saveRoutineFrom,
  sessionsFor,
  startWorkout,
  suggestExercises,
  toDisplay,
  weekSummary,
  workoutSummary,
  workoutsInLastWeek,
} from '../workout/logic.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 17);
const workout = (id, day, exercises, minutes = 50) => ({
  id,
  startedAt: T0 + day * DAY,
  finishedAt: T0 + day * DAY + minutes * 60000,
  exercises,
});
const sets = (...pairs) => pairs.map(([kg, reps]) => ({ kg, reps }));

const history = [
  workout('a', 0, [{ name: 'Bench press', sets: sets([60, 8], [60, 8], [60, 6]) }, { name: 'Pull-up', sets: sets([0, 8], [0, 6]) }]),
  workout('b', 3, [{ name: 'Squat', sets: sets([80, 5], [80, 5]) }]),
  workout('c', 7, [{ name: 'bench  press', sets: sets([62.5, 8], [62.5, 7]) }, { name: 'Pull-up', sets: sets([0, 9]) }]),
];

test('weights convert between kg and lb without drifting', () => {
  assert.equal(toDisplay(60, 'kg'), 60);
  assert.equal(toDisplay(61.25, 'kg'), 61.25);
  assert.equal(toDisplay(fromDisplay(135, 'lb'), 'lb'), 135);
  assert.equal(toDisplay(100, 'lb'), 220.5);
  assert.equal(formatWeight(80, 'kg'), '80 kg');
});

test('formatSet shows load × reps, or BW for bodyweight', () => {
  assert.equal(formatSet({ kg: 60, reps: 8 }, 'kg'), '60 × 8');
  assert.equal(formatSet({ kg: 0, reps: 12 }, 'kg'), 'BW × 12');
  assert.equal(formatSet({ kg: 70, reps: 8 }, 'kg', true), '70 kg × 8');
  assert.equal(displayMax(88.6666, 'kg'), 88.7);
});

test('estimateMax uses Epley, with one rep as its own max', () => {
  assert.equal(estimateMax({ kg: 100, reps: 1 }), 100);
  assert.equal(estimateMax({ kg: 60, reps: 10 }), 80);
  assert.equal(estimateMax({ kg: 0, reps: 10 }), 0);
});

test('bestSet picks the highest estimated max, or most reps for bodyweight', () => {
  assert.deepEqual(bestSet(sets([60, 8], [65, 5], [55, 12])), { kg: 55, reps: 12 });
  assert.deepEqual(bestSet(sets([0, 8], [0, 11], [0, 9]), true), { kg: 0, reps: 11 });
  assert.equal(bestSet([]), null);
});

test('exercise names match regardless of spacing and capitals', () => {
  assert.equal(cleanName('  bench   press '), 'bench press');
  const sessions = sessionsFor(history, 'BENCH PRESS');
  assert.equal(sessions.length, 2);
  assert.deepEqual(lastSets(history, 'Bench press'), sets([62.5, 8], [62.5, 7]));
  assert.deepEqual(lastSets(history, 'Deadlift'), []);
});

test('recent exercises come newest first, then suggestions fill in common ones', () => {
  assert.deepEqual(recentExerciseNames(history), ['bench  press', 'Pull-up', 'Squat']);
  const all = suggestExercises('', history, ['Squat']);
  assert.deepEqual(all.slice(0, 2), ['bench  press', 'Pull-up']);
  assert.ok(!all.some((n) => n.toLowerCase() === 'squat'), 'skips exercises already in the workout');
  assert.ok(!all.includes('Bench press'), 'no duplicate of a logged name');
  assert.deepEqual(suggestExercises('curl', []), ['Barbell curl', 'Incline dumbbell curl', 'Cable curl', 'Hammer curl', 'Leg curl']);
});

test('the catalog gives every built-in exercise a picture and muscle group', () => {
  for (const name of DEFAULT_EXERCISES) {
    const info = exerciseInfo(name);
    assert.ok(info && info.img && info.muscle, `${name} is in the catalog`);
  }
  assert.equal(exerciseInfo('  bench   PRESS ').img, 'bench-press');
  assert.equal(exerciseInfo('Zumba'), null);
});

test('the default routines only use catalog exercises', () => {
  const { routines } = emptyData();
  assert.deepEqual(routines.map((r) => r.id), ['push', 'pull', 'legs']);
  for (const routine of routines) {
    assert.ok(routine.exercises.length >= 4, `${routine.name} has exercises`);
    for (const name of routine.exercises) assert.ok(exerciseInfo(name), `${name} in ${routine.name} is in the catalog`);
  }
});

test('startWorkout adds a routine\'s exercises, or none for an empty workout', () => {
  const data = emptyData();
  const pull = startWorkout(data, 'pull', T0);
  assert.equal(pull.active.routine, 'pull');
  assert.equal(pull.active.startedAt, T0);
  assert.deepEqual(pull.active.exercises.map((e) => e.name), data.routines[1].exercises);
  assert.ok(pull.active.exercises.every((e) => e.sets.length === 0));
  const empty = startWorkout(data, null, T0);
  assert.deepEqual(empty.active.exercises, []);
  assert.equal('routine' in empty.active, false);
  assert.equal('routine' in startWorkout(data, 'nope', T0).active, false);
});

test('a routine can be updated from what was actually done', () => {
  const data = emptyData();
  const push = data.routines[0];
  const asPlanned = { routine: 'push', exercises: push.exercises.map((name) => ({ name, sets: sets([50, 8]) })) };
  assert.equal(routineChanged(data, asPlanned), false);
  const skipped = { routine: 'push', exercises: asPlanned.exercises.map((e, i) => (i === 2 ? { ...e, sets: [] } : e)) };
  assert.equal(routineChanged(data, skipped), true);
  const extra = { routine: 'push', exercises: [...asPlanned.exercises, { name: 'Dip', sets: sets([0, 10]) }] };
  assert.equal(routineChanged(data, extra), true);
  assert.equal(routineChanged(data, { exercises: asPlanned.exercises }), false, 'an empty workout has no routine');

  const updated = saveRoutineFrom(data, extra);
  assert.deepEqual(updated.routines[0].exercises, [...push.exercises, 'Dip']);
  assert.deepEqual(updated.routines[1], data.routines[1], 'other routines untouched');
  assert.equal(saveRoutineFrom(data, { routine: 'push', exercises: [] }), data, 'nothing done, nothing saved');
});

test('progressSeries plots e1RM per session, or reps for bodyweight work', () => {
  const bench = progressSeries(history, 'Bench press');
  assert.equal(bench.metric, 'max');
  assert.equal(bench.points.length, 2);
  assert.equal(bench.points[0].value, 76);
  assert.deepEqual(bench.points[1].top, { kg: 62.5, reps: 8 });

  const pullups = progressSeries(history, 'Pull-up');
  assert.equal(pullups.metric, 'reps');
  assert.deepEqual(pullups.points.map((p) => p.value), [8, 9]);
});

test('records find the heaviest set and best estimated max', () => {
  const r = records(history, 'Bench press');
  assert.equal(r.sessions, 2);
  assert.equal(r.setCount, 5);
  assert.deepEqual([r.heaviest.kg, r.heaviest.reps], [62.5, 8]);
  assert.equal(r.bestMax.t, T0 + 7 * DAY);
  assert.equal(records(history, 'Pull-up').bodyweight, true);
});

test('beatsRecord only flags a set that tops all earlier history', () => {
  assert.equal(beatsRecord(history, 'Bench press', { kg: 62.5, reps: 8 }), false, 'a tie is not a record');
  assert.equal(beatsRecord(history, 'Bench press', { kg: 65, reps: 8 }), true);
  assert.equal(beatsRecord(history, 'Deadlift', { kg: 140, reps: 5 }), false, 'nothing to beat the first time');
  assert.equal(beatsRecord(history, 'Pull-up', { kg: 0, reps: 10 }), true);
});

test('workoutSummary counts exercises, sets, volume and minutes', () => {
  assert.deepEqual(workoutSummary(history[0]), { exerciseCount: 2, setCount: 5, volumeKg: 1320, minutes: 50 });
});

test('workoutsInLastWeek counts recent workouts', () => {
  assert.equal(workoutsInLastWeek(history, T0 + 8 * DAY), 2);
});

test('weekSummary totals the last seven days', () => {
  assert.deepEqual(weekSummary(history, T0 + 8 * DAY), { workouts: 2, sets: 5, volumeKg: 1737.5 });
  assert.deepEqual(weekSummary([], T0), { workouts: 0, sets: 0, volumeKg: 0 });
});

test('recentRecords lists each exercise\'s best, newest first', () => {
  const bests = recentRecords(history);
  assert.deepEqual(bests.map((b) => b.name), ['bench  press', 'Pull-up', 'Squat']);
  assert.deepEqual(bests[0].set, { kg: 62.5, reps: 8 });
  assert.equal(bests[0].t, T0 + 7 * DAY);
  assert.equal(bests[1].metric, 'reps');
  assert.deepEqual(bests[1].set, { kg: 0, reps: 9 });
  assert.equal(recentRecords(history, 1).length, 1);
  assert.deepEqual(recentRecords([]), []);
});

test('finishWorkout saves sets and drops empty workouts', () => {
  const data = { ...emptyData(), active: { id: 'x', startedAt: T0, exercises: [{ name: 'Squat', sets: sets([100, 5]) }, { name: 'Lunge', sets: [] }] } };
  const done = finishWorkout(data, T0 + 3600000);
  assert.equal(done.active, null);
  assert.equal(done.workouts.length, 1);
  assert.deepEqual(done.workouts[0].exercises.map((e) => e.name), ['Squat']);
  assert.equal(done.workouts[0].finishedAt, T0 + 3600000);

  const empty = { ...emptyData(), active: { id: 'y', startedAt: T0, exercises: [{ name: 'Squat', sets: [] }] } };
  assert.deepEqual(finishWorkout(empty).workouts, []);

  const resting = { ...emptyData(), active: { id: 'z', startedAt: T0, lastSetAt: T0 + 60000, exercises: [{ name: 'Squat', sets: sets([100, 5]) }] } };
  assert.equal('lastSetAt' in finishWorkout(resting).workouts[0], false, 'the rest timer does not go into history');
});

test('normalizeData keeps the rest timer of a running workout', () => {
  const data = normalizeData({ workouts: [], active: { id: 'a', startedAt: T0, lastSetAt: T0 + 90000, exercises: [] } });
  assert.equal(data.active.lastSetAt, T0 + 90000);
  assert.equal('lastSetAt' in normalizeData({ workouts: [], active: { id: 'a', startedAt: T0, exercises: [] } }).active, false);
});

test('normalizeData drops malformed sets, workouts and duplicates', () => {
  const data = normalizeData({
    unit: 'lb',
    workouts: [
      history[1],
      { id: 'bad', startedAt: 'yesterday', exercises: [] },
      { ...history[0], exercises: [{ name: 'Bench press', sets: [{ kg: -5, reps: 8 }, { kg: 60, reps: 2.5 }, { kg: 60, reps: 8 }] }] },
      history[1],
    ],
    active: 'nope',
  });
  assert.equal(data.unit, 'lb');
  assert.deepEqual(data.workouts.map((w) => w.id), ['a', 'b']);
  assert.deepEqual(data.workouts[0].exercises[0].sets, sets([60, 8]));
  assert.equal(data.active, null);
  assert.deepEqual(normalizeData(null), emptyData());
});

test('normalizeData keeps saved routines and a workout\'s routine', () => {
  const data = normalizeData({
    workouts: [{ ...history[1], routine: 'legs' }, { ...history[0], routine: 'bogus' }],
    active: { id: 'x', startedAt: T0, routine: 'push', exercises: [] },
    routines: [{ id: 'push', exercises: [' Dip ', '', 'Push-up'] }, { id: 'bogus', exercises: ['Nope'] }, { id: 'legs', exercises: [] }],
  });
  assert.deepEqual(data.routines.map((r) => r.id), ['push', 'pull', 'legs']);
  assert.deepEqual(data.routines[0].exercises, ['Dip', 'Push-up']);
  assert.deepEqual(data.routines[1].exercises, emptyData().routines[1].exercises, 'untouched routine keeps its default');
  assert.deepEqual(data.routines[2].exercises, emptyData().routines[2].exercises, 'an emptied routine falls back to its default');
  assert.equal(data.workouts.find((w) => w.id === 'b').routine, 'legs');
  assert.equal('routine' in data.workouts.find((w) => w.id === 'a'), false, 'an unknown routine is dropped');
  assert.equal(data.active.routine, 'push');
  assert.deepEqual(normalizeData({ workouts: [] }).routines, emptyData().routines);
});

test('a backup round-trips and bad text gets a readable error', () => {
  const data = normalizeData({ workouts: history });
  assert.deepEqual(parseBackup(backupText(data)).workouts, data.workouts);
  assert.throws(() => parseBackup('hello'), /doesn't look like a backup/);
  assert.throws(() => parseBackup('{"foo": 1}'), /no workouts/);
});

test('niceTicks gives round, evenly spaced values covering the data', () => {
  assert.deepEqual(niceTicks(76, 83.3, 5), [76, 78, 80, 82, 84]);
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  const flat = niceTicks(80, 80);
  assert.ok(flat[0] < 80 && flat[flat.length - 1] > 80, 'a flat line still gets a range');
  for (const [lo, hi] of [[3, 17], [61.2, 64.9], [120, 180]]) {
    const ticks = niceTicks(lo, hi);
    assert.ok(ticks[0] <= lo && ticks[ticks.length - 1] >= hi, `${lo}-${hi} covered`);
    assert.ok(ticks.length >= 3 && ticks.length <= 7, `${lo}-${hi} has a sensible count`);
  }
});
