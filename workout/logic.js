// Pure logic for the workout log. Nothing here touches the page, so it runs
// in the browser and in the Node test suite.
//
// Weights are always stored in kilograms and converted for display, so
// switching between kg and lb never changes a saved workout.

import { EXERCISES, ROUTINES } from './exercises.js';

export const KG_PER_LB = 0.45359237;
export const UNITS = {
  kg: { step: 2.5 },
  lb: { step: 5 },
};

export const DEFAULT_EXERCISES = EXERCISES.map((e) => e.name);

/* Units */

const roundTo = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Kilograms to the number shown on screen in the chosen unit. */
export function toDisplay(kg, unit) {
  return unit === 'lb' ? roundTo(kg / KG_PER_LB, 1) : roundTo(kg, 2);
}

/** A number typed in the chosen unit, back to kilograms. */
export function fromDisplay(value, unit) {
  return unit === 'lb' ? value * KG_PER_LB : value;
}

export function formatWeight(kg, unit) {
  return `${toDisplay(kg, unit)} ${unit}`;
}

/** "60 × 8" (or "60 kg × 8" with the unit), or "BW × 12" for a bodyweight set. */
export function formatSet(set, unit, withUnit = false) {
  if (!(set.kg > 0)) return `BW × ${set.reps}`;
  return `${toDisplay(set.kg, unit)}${withUnit ? ` ${unit}` : ''} × ${set.reps}`;
}

/** An estimated max for display: one decimal is precise enough. */
export function displayMax(kg, unit) {
  return roundTo(toDisplay(kg, unit), 1);
}

/* Strength maths */

/**
 * Estimated one-rep max (e1RM) with the Epley formula. A single rep is its
 * own max. Bodyweight sets have no load, so they estimate to zero.
 */
export function estimateMax(set) {
  if (!(set.kg > 0) || !(set.reps > 0)) return 0;
  if (set.reps === 1) return set.kg;
  return set.kg * (1 + set.reps / 30);
}

/** The strongest set: highest e1RM, or most reps for bodyweight work. */
export function bestSet(sets, byReps = false) {
  let best = null;
  for (const set of sets) {
    if (!best) {
      best = set;
    } else if (byReps) {
      if (set.reps > best.reps || (set.reps === best.reps && set.kg > best.kg)) best = set;
    } else {
      const a = estimateMax(set);
      const b = estimateMax(best);
      if (a > b || (a === b && set.kg > best.kg)) best = set;
    }
  }
  return best;
}

/* Exercise names */

export function cleanName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

export const nameKey = (name) => cleanName(name).toLowerCase();

/** The catalog entry (picture, muscle group) for an exercise name, or null. */
export function exerciseInfo(name) {
  const key = nameKey(name);
  return EXERCISES.find((e) => nameKey(e.name) === key) ?? null;
}

/* Routines */

export function defaultRoutines() {
  return ROUTINES.map((r) => ({ id: r.id, name: r.name, muscles: r.muscles, exercises: [...r.exercises] }));
}

export const routineById = (data, id) => data.routines.find((r) => r.id === id) ?? null;

/** Starts a workout, with a routine's exercises already in it when one is given. */
export function startWorkout(data, routineId = null, now = Date.now()) {
  const routine = routineById(data, routineId);
  const active = {
    id: newId(now),
    startedAt: now,
    exercises: routine ? routine.exercises.map((name) => ({ name, sets: [] })) : [],
  };
  if (routine) active.routine = routine.id;
  return { ...data, active };
}

const doneNames = (workout) => workout.exercises.filter((e) => e.sets.length > 0).map((e) => e.name);

/** Whether the exercises actually done in a workout differ from its routine. */
export function routineChanged(data, workout) {
  const routine = routineById(data, workout.routine);
  if (!routine) return false;
  const done = doneNames(workout).map(nameKey);
  const saved = routine.exercises.map(nameKey);
  return done.length > 0 && (done.length !== saved.length || done.some((name, i) => name !== saved[i]));
}

/** Makes what was done in a workout the new exercise list of its routine. */
export function saveRoutineFrom(data, workout) {
  const done = doneNames(workout);
  if (!done.length || !routineById(data, workout.routine)) return data;
  return { ...data, routines: data.routines.map((r) => (r.id === workout.routine ? { ...r, exercises: done } : r)) };
}

/** Every exercise ever logged, most recently used first. */
export function recentExerciseNames(workouts) {
  const seen = new Map();
  const newestFirst = [...workouts].sort((a, b) => b.startedAt - a.startedAt);
  for (const workout of newestFirst) {
    for (const exercise of workout.exercises) {
      const key = nameKey(exercise.name);
      if (key && !seen.has(key)) seen.set(key, exercise.name);
    }
  }
  return [...seen.values()];
}

/**
 * Names to offer when adding an exercise: the player's own exercises first,
 * then common ones, filtered by what they have typed and skipping any already
 * in today's workout.
 */
export function suggestExercises(query, workouts, exclude = [], defaults = DEFAULT_EXERCISES) {
  const q = nameKey(query);
  const skip = new Set(exclude.map(nameKey));
  const out = [];
  for (const name of [...recentExerciseNames(workouts), ...defaults]) {
    const key = nameKey(name);
    if (skip.has(key) || (q && !key.includes(q))) continue;
    skip.add(key);
    out.push(name);
  }
  return out;
}

/* History */

/** Each finished session of one exercise, oldest first, sets merged per workout. */
export function sessionsFor(workouts, name) {
  const key = nameKey(name);
  return [...workouts]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((workout) => ({
      workoutId: workout.id,
      t: workout.startedAt,
      sets: workout.exercises.filter((e) => nameKey(e.name) === key).flatMap((e) => e.sets),
    }))
    .filter((session) => session.sets.length > 0);
}

/** The sets from the last time this exercise was done, for "Last time" hints. */
export function lastSets(workouts, name) {
  const sessions = sessionsFor(workouts, name);
  return sessions.length ? sessions[sessions.length - 1].sets : [];
}

const isBodyweight = (sessions) => sessions.length > 0
  && sessions.every((s) => s.sets.every((set) => !(set.kg > 0)));

/**
 * The numbers the progress chart plots: e1RM of the best set per session, or
 * the most reps per session for a bodyweight exercise.
 */
export function progressSeries(workouts, name) {
  const sessions = sessionsFor(workouts, name);
  const byReps = isBodyweight(sessions);
  return {
    metric: byReps ? 'reps' : 'max',
    points: sessions.map((session) => {
      const top = bestSet(session.sets, byReps);
      return { t: session.t, workoutId: session.workoutId, top, value: byReps ? top.reps : estimateMax(top) };
    }),
  };
}

/** Personal records for one exercise. */
export function records(workouts, name) {
  const sessions = sessionsFor(workouts, name);
  let heaviest = null;
  let bestMax = null;
  let mostReps = null;
  let setCount = 0;
  for (const session of sessions) {
    for (const set of session.sets) {
      setCount += 1;
      if (!heaviest || set.kg > heaviest.kg || (set.kg === heaviest.kg && set.reps > heaviest.reps)) {
        heaviest = { ...set, t: session.t };
      }
      const max = estimateMax(set);
      if (max > 0 && (!bestMax || max > bestMax.value)) bestMax = { ...set, value: max, t: session.t };
      if (!mostReps || set.reps > mostReps.reps) mostReps = { ...set, t: session.t };
    }
  }
  return { sessions: sessions.length, setCount, heaviest, bestMax, mostReps, bodyweight: isBodyweight(sessions) };
}

/**
 * Whether a new set beats everything logged before for that exercise. Nothing
 * counts as a record the first time, since there is nothing to beat yet.
 */
export function beatsRecord(workouts, name, set) {
  const sessions = sessionsFor(workouts, name);
  if (sessions.length === 0) return false;
  const previous = sessions.flatMap((s) => s.sets);
  if (isBodyweight(sessions) && !(set.kg > 0)) {
    return set.reps > Math.max(...previous.map((p) => p.reps));
  }
  const best = Math.max(...previous.map(estimateMax));
  return estimateMax(set) > best + 1e-9;
}

export function workoutSummary(workout) {
  const done = workout.exercises.filter((e) => e.sets.length > 0);
  const sets = done.flatMap((e) => e.sets);
  const end = workout.finishedAt ?? workout.startedAt;
  return {
    exerciseCount: done.length,
    setCount: sets.length,
    volumeKg: sets.reduce((sum, s) => sum + s.kg * s.reps, 0),
    minutes: Math.max(0, Math.round((end - workout.startedAt) / 60000)),
  };
}

export function workoutsInLastWeek(workouts, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  return workouts.filter((w) => w.startedAt >= since).length;
}

/** Workouts, sets and kilograms lifted in the last seven days. */
export function weekSummary(workouts, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const recent = workouts.filter((w) => w.startedAt >= since);
  const sets = recent.flatMap((w) => w.exercises.flatMap((e) => e.sets));
  return {
    workouts: recent.length,
    sets: sets.length,
    volumeKg: sets.reduce((sum, s) => sum + s.kg * s.reps, 0),
  };
}

/**
 * The best ever set of each exercise, newest first: estimated max for loaded
 * work, most reps for bodyweight work.
 */
export function recentRecords(workouts, limit = 3) {
  return recentExerciseNames(workouts)
    .map((name) => {
      const r = records(workouts, name);
      const best = r.bodyweight ? r.mostReps : r.bestMax;
      if (!best) return null;
      return { name, set: { kg: best.kg, reps: best.reps }, t: best.t, metric: r.bodyweight ? 'reps' : 'max' };
    })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
}

/* Saving */

export function emptyData() {
  return { version: 1, unit: 'kg', workouts: [], active: null, routines: defaultRoutines() };
}

export function newId(now = Date.now(), random = Math.random) {
  return `w${now.toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** Moves the active workout into history. A workout with no sets is dropped. */
export function finishWorkout(data, now = Date.now()) {
  if (!data.active) return data;
  const exercises = data.active.exercises.filter((e) => e.sets.length > 0);
  if (exercises.length === 0) return { ...data, active: null };
  const finished = { ...data.active, exercises, finishedAt: now };
  delete finished.lastSetAt; // Only matters while the workout is running.
  return { ...data, active: null, workouts: [...data.workouts, finished] };
}

function cleanSet(raw) {
  const kg = Number(raw?.kg);
  const reps = Number(raw?.reps);
  if (!Number.isFinite(kg) || kg < 0 || kg > 2000) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > 1000) return null;
  return { kg, reps };
}

function cleanExercise(raw) {
  const name = cleanName(raw?.name);
  if (!name) return null;
  const sets = Array.isArray(raw.sets) ? raw.sets.map(cleanSet).filter(Boolean) : [];
  return { name, sets };
}

function cleanWorkout(raw, finished) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.startedAt)) return null;
  const exercises = Array.isArray(raw.exercises) ? raw.exercises.map(cleanExercise).filter(Boolean) : [];
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : newId(raw.startedAt);
  const workout = { id, startedAt: raw.startedAt, exercises };
  if (ROUTINES.some((r) => r.id === raw.routine)) workout.routine = raw.routine;
  if (finished) {
    workout.finishedAt = Number.isFinite(raw.finishedAt) ? raw.finishedAt : raw.startedAt;
  } else if (Number.isFinite(raw.lastSetAt)) {
    workout.lastSetAt = raw.lastSetAt; // When the last set was logged, for the rest timer.
  }
  return workout;
}

/** Repairs data from storage or a backup, dropping anything malformed. */
export function normalizeData(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  if (raw.unit === 'lb') data.unit = 'lb';
  const ids = new Set();
  data.workouts = (Array.isArray(raw.workouts) ? raw.workouts : [])
    .map((w) => cleanWorkout(w, true))
    .filter((w) => w && w.exercises.some((e) => e.sets.length > 0) && !ids.has(w.id) && ids.add(w.id))
    .sort((a, b) => a.startedAt - b.startedAt);
  data.active = cleanWorkout(raw.active, false);
  data.routines = cleanRoutines(raw.routines);
  return data;
}

/** The built-in routines, each with its saved exercise list when there is one. */
function cleanRoutines(raw) {
  const defaults = defaultRoutines();
  if (!Array.isArray(raw)) return defaults;
  return defaults.map((routine) => {
    const saved = raw.find((r) => r && r.id === routine.id);
    if (!saved || !Array.isArray(saved.exercises)) return routine;
    const exercises = saved.exercises.map(cleanName).filter(Boolean);
    return exercises.length ? { ...routine, exercises } : routine;
  });
}

export function backupText(data, now = Date.now()) {
  return JSON.stringify({ app: 'workout-log', exportedAt: new Date(now).toISOString(), ...data }, null, 1);
}

/** Reads a pasted or uploaded backup. Throws an Error with a readable message. */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like a backup. Paste the whole text you copied.");
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.workouts)) {
    throw new Error('That text has no workouts in it.');
  }
  return normalizeData(raw);
}

/* Chart scale */

function niceNumber(x, round) {
  const exponent = Math.floor(Math.log10(x));
  const fraction = x / 10 ** exponent;
  let nice;
  if (round) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/** Evenly spaced round tick values that cover min..max. */
export function niceTicks(min, max, maxTicks = 5) {
  let lo = min;
  let hi = max;
  if (hi - lo < 1e-9) {
    const pad = Math.max(1, Math.abs(lo) * 0.05);
    lo -= pad;
    hi += pad;
  }
  const step = niceNumber(niceNumber(hi - lo, false) / (maxTicks - 1), true);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(roundTo(v, 6));
  return ticks;
}
