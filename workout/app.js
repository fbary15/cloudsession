// The page side of the workout log. All the maths lives in logic.js and the
// chart in chart.js; this file draws the three tabs and saves to the browser.

import {
  UNITS,
  backupText,
  beatsRecord,
  bestSet,
  cleanName,
  displayMax,
  emptyData,
  estimateMax,
  finishWorkout,
  formatSet,
  fromDisplay,
  lastSets,
  nameKey,
  newId,
  normalizeData,
  parseBackup,
  progressSeries,
  recentExerciseNames,
  recentRecords,
  records,
  sessionsFor,
  suggestExercises,
  toDisplay,
  weekSummary,
  workoutSummary,
} from './logic.js';
import { drawLineChart } from './chart.js';

const STORAGE_KEY = 'workout-log:v1';
const PICK_KEY = 'workout-log:progress-exercise';
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_TIMER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10v3.5l2.5 1.5M9.5 3.5h5M12 3.5v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8Z" fill="currentColor"/></svg>';

const byId = (id) => document.getElementById(id);
const views = { log: byId('view-log'), history: byId('view-history'), progress: byId('view-progress') };
const dialogs = { add: byId('add-exercise'), finish: byId('finish'), settings: byId('settings') };

let data = emptyData();
let currentView = 'log';
let stopChart = null;
let warnedStorage = false;
let restDismissed = 0; // The lastSetAt whose rest timer was tapped away.

/* Saving */

function load() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return emptyData();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    if (!warnedStorage) {
      warnedStorage = true;
      toast("This browser isn't saving your workouts", 4000);
    }
  }
}

function readPick() {
  try { return localStorage.getItem(PICK_KEY) ?? ''; } catch { return ''; }
}

function writePick(name) {
  try { localStorage.setItem(PICK_KEY, name); } catch { /* Only a convenience. */ }
}

/* Small helpers */

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // Only used for our own icon markup.
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for') node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const unit = () => data.unit;
const dayLabel = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const monthLabel = (t) => new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const timeLabel = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const volumeNumber = (kg) => Math.round(toDisplay(kg, unit())).toLocaleString();
const volumeLabel = (kg) => `${volumeNumber(kg)} ${unit()}`;

function minutesLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function toast(message, ms = 1800) {
  const note = h('div', { class: 'toast', text: message });
  byId('toasts').prepend(note);
  setTimeout(() => note.remove(), ms);
}

/** Two-tap confirmation for destructive buttons, since confirm() is unreliable. */
function confirmTap(button, armedText, action) {
  if (button.dataset.armed === '1') {
    action();
    return;
  }
  const original = button.textContent;
  button.dataset.armed = '1';
  button.textContent = armedText;
  setTimeout(() => {
    if (!button.isConnected) return;
    delete button.dataset.armed;
    button.textContent = original;
  }, 3000);
}

function openDialog(dialog) {
  for (const other of Object.values(dialogs)) if (other !== dialog && other.open) other.close();
  if (!dialog.open) dialog.showModal();
}

/* Log tab */

function renderLog() {
  if (!data.active) {
    renderHome();
    return;
  }
  const view = views.log;
  const active = data.active;
  const cards = active.exercises.map((exercise, index) => exerciseCard(exercise, index));
  const resting = Number.isFinite(active.lastSetAt) && active.lastSetAt !== restDismissed;
  view.replaceChildren(
    h('div', { class: 'session' },
      h('div', { class: 'session-row' },
        h('div', {},
          h('p', { class: 'eyebrow live' }, h('span', { class: 'dot' }), 'Workout in progress'),
          h('p', { class: 'session-time' }, h('span', { id: 'elapsed', text: elapsedText() }), h('small', { text: ` · started ${timeLabel(active.startedAt)}` }))),
        h('button', { type: 'button', class: 'primary', 'data-action': 'finish', text: 'Finish' })),
      resting ? h('button', { type: 'button', class: 'rest', 'data-action': 'rest-dismiss', html: ICON_TIMER, title: 'Tap to hide' },
        h('span', { text: 'Rest since your last set' }),
        h('span', { class: 'rest-time', id: 'rest-time', text: restText() })) : null,
    ),
    cards.length
      ? h('ol', { class: 'exercise-list' }, cards)
      : h('div', { class: 'empty' },
        h('strong', { text: 'Add your first exercise' }),
        h('span', { text: 'Pick from your usual exercises or type a new one.' })),
    cards.length
      ? h('button', { type: 'button', class: 'add-ex', 'data-action': 'add-exercise', html: ICON_PLUS }, 'Add exercise')
      : h('button', { type: 'button', class: 'primary wide', 'data-action': 'add-exercise', text: 'Add exercise' }),
  );
}

/** The Log tab between workouts: this week at a glance, recent bests, last time. */
function renderHome() {
  const view = views.log;
  const last = data.workouts[data.workouts.length - 1];
  const week = weekSummary(data.workouts);
  const bests = recentRecords(data.workouts, 3);
  const stat = (value, label) => h('div', { class: 'hstat' },
    h('span', { class: 'hstat-value' }, value),
    h('span', { class: 'hstat-label', text: label }));
  const bestValue = (b) => (b.metric === 'reps' ? plural(b.set.reps, 'rep') : `${displayMax(estimateMax(b.set), unit())} ${unit()}`);

  view.replaceChildren(...[
    h('section', { class: 'hero', 'aria-label': 'Start a workout' },
      h('p', { class: 'hero-date', text: dayLabel(Date.now()) }),
      h('h2', { text: last ? 'Ready for the next one?' : 'Log your first workout' }),
      last ? h('p', { class: 'hero-kicker', text: 'Last 7 days' }) : null,
      last
        ? h('div', { class: 'hero-stats' },
          stat(String(week.workouts), plural(week.workouts, 'workout').replace(/^\d+ /, '')),
          stat(String(week.sets), plural(week.sets, 'set').replace(/^\d+ /, '')),
          stat(volumeNumber(week.volumeKg), `${unit()} lifted`))
        : h('p', { class: 'hero-sub', text: 'Add exercises and log each set as you go. Everything stays on this phone.' }),
      h('button', { type: 'button', class: 'hero-cta', 'data-action': 'start', html: ICON_PLUS }, 'Start workout'),
      isStandalone() ? null : h('button', { type: 'button', class: 'text-btn', 'data-action': 'install-hint', text: 'Add to your home screen' }),
    ),
    last ? null : h('ol', { class: 'steps', 'aria-label': 'How it works' },
      h('li', {}, h('div', {}, h('strong', { text: 'Start a workout' }), h('span', { text: 'One tap and the clock is running.' }))),
      h('li', {}, h('div', {}, h('strong', { text: 'Add your exercises' }), h('span', { text: 'Pick from the list or type your own.' }))),
      h('li', {}, h('div', {}, h('strong', { text: 'Log every set' }), h('span', { text: 'Weight and reps. Next time you see what you did and can beat it.' }))),
    ),
    bests.length ? h('section', {},
      h('h3', { class: 'section-title', text: 'Recent bests' }),
      h('ul', { class: 'bests' }, bests.map((b) => h('li', { class: 'best' },
        h('span', { class: 'best-icon', html: ICON_STAR }),
        h('span', { class: 'best-main' },
          h('span', { class: 'best-name', text: b.name }),
          h('span', { class: 'best-sub', text: b.metric === 'reps' ? 'Most reps in a set' : `Est. max from ${formatSet(b.set, unit(), true)}` })),
        h('span', { class: 'best-value' },
          h('span', { text: bestValue(b) }),
          h('span', { class: 'best-date', text: shortDate(b.t) })))))) : null,
    last ? h('section', {}, h('h3', { class: 'section-title', text: 'Last workout' }), workoutCard(last, false)) : null,
  ].filter(Boolean)); // replaceChildren would print a null as the word "null".
}

function elapsedText() {
  return data.active ? minutesLabel(Math.max(0, Math.floor((Date.now() - data.active.startedAt) / 60000))) : '';
}

function restText() {
  const seconds = Math.max(0, Math.floor((Date.now() - data.active.lastSetAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function exerciseCard(exercise, index) {
  const before = lastSets(data.workouts, exercise.name);
  const latest = exercise.sets[exercise.sets.length - 1] ?? before[0];
  const weightValue = latest && latest.kg > 0 ? toDisplay(latest.kg, unit()) : '';
  const repsValue = latest ? latest.reps : 8;

  const setRows = exercise.sets.map((set, setIndex) => h('li', { class: 'set' },
    h('span', { class: 'set-no', text: setIndex + 1 }),
    h('span', { class: 'set-val' },
      set.kg > 0 ? `${toDisplay(set.kg, unit())} ` : 'BW ',
      set.kg > 0 ? h('span', { class: 'set-unit', text: `${unit()} ` }) : null,
      `× ${set.reps}`),
    h('span', {}, beatsRecord(data.workouts, exercise.name, set) ? h('span', { class: 'badge', text: 'Best ever' }) : null),
    h('button', {
      type: 'button',
      class: 'icon-btn',
      'data-action': 'remove-set',
      'data-index': index,
      'data-set': setIndex,
      'aria-label': `Delete set ${setIndex + 1}`,
      html: ICON_X,
    }),
  ));

  const weightId = `weight-${index}`;
  const repsId = `reps-${index}`;
  const lastTime = before.length
    ? h('div', { class: 'last-time' },
      h('span', { class: 'last-label', text: before.some((s) => s.kg > 0) ? `Last time · ${unit()}` : 'Last time' }),
      before.map((s) => h('button', {
        type: 'button', class: 'chip', 'data-action': 'fill', 'data-index': index, 'data-kg': s.kg, 'data-reps': s.reps,
        title: 'Use these numbers', text: formatSet(s, unit()),
      })))
    : h('p', { class: 'last-time first', text: 'First time logging this one.' });

  return h('li', { class: 'exercise', 'data-index': index },
    h('div', { class: 'exercise-head' },
      h('h3', { text: exercise.name }),
      h('button', { type: 'button', class: 'text-btn subtle', 'data-action': 'remove-exercise', 'data-index': index, text: 'Remove' }),
    ),
    lastTime,
    setRows.length ? h('ol', { class: 'sets' }, setRows) : null,
    h('div', { class: 'entry' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: weightId, text: `Weight (${unit()})` }),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', 'data-action': 'step', 'data-target': weightId, 'data-dir': -1, 'aria-label': 'Less weight', text: '−' }),
          h('input', { id: weightId, type: 'number', inputMode: 'decimal', min: 0, step: 'any', placeholder: 'BW', value: weightValue }),
          h('button', { type: 'button', 'data-action': 'step', 'data-target': weightId, 'data-dir': 1, 'aria-label': 'More weight', text: '+' }),
        ),
      ),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: repsId, text: 'Reps' }),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', 'data-action': 'step', 'data-target': repsId, 'data-dir': -1, 'aria-label': 'Fewer reps', text: '−' }),
          h('input', { id: repsId, type: 'number', inputMode: 'numeric', min: 1, step: 1, value: repsValue }),
          h('button', { type: 'button', 'data-action': 'step', 'data-target': repsId, 'data-dir': 1, 'aria-label': 'More reps', text: '+' }),
        ),
      ),
      h('button', { type: 'button', class: 'primary', 'data-action': 'add-set', 'data-index': index, text: `Add set ${exercise.sets.length + 1}` }),
    ),
  );
}

function startWorkout() {
  data.active = { id: newId(), startedAt: Date.now(), exercises: [] };
  save();
  renderLog();
  openAddExercise();
}

function stepInput(button) {
  const input = byId(button.dataset.target);
  const dir = Number(button.dataset.dir);
  const isWeight = input.id.startsWith('weight');
  const step = isWeight ? UNITS[unit()].step : 1;
  const current = Number(input.value) || 0;
  const next = Math.max(isWeight ? 0 : 1, Math.round((current + dir * step) * 100) / 100);
  input.value = isWeight && next === 0 ? '' : next;
}

function addSet(index) {
  const exercise = data.active.exercises[index];
  const weightText = byId(`weight-${index}`).value.trim();
  const weight = weightText === '' ? 0 : Number(weightText);
  const reps = Number(byId(`reps-${index}`).value);
  if (!Number.isFinite(weight) || weight < 0) {
    toast('Enter a weight of 0 or more');
    return;
  }
  if (!Number.isInteger(reps) || reps < 1 || reps > 1000) {
    toast('Enter a whole number of reps');
    return;
  }
  const kg = fromDisplay(weight, unit());
  if (kg > 2000) {
    toast('That weight looks too heavy to be right');
    return;
  }
  const set = { kg, reps };
  // Announce a record once, not again for every later set that also beats it.
  const record = beatsRecord(data.workouts, exercise.name, set)
    && exercise.sets.every((earlier) => isStronger(set, earlier));
  exercise.sets.push(set);
  data.active.lastSetAt = Date.now();
  restDismissed = 0;
  save();
  renderLog();
  views.log.querySelector(`.exercise[data-index="${index}"] .set:last-child`)?.classList.add('is-new');
  navigator.vibrate?.(record ? [15, 40, 15] : 12);
  if (record) toast(`New best for ${exercise.name}`);
}

/** A "last time" chip fills the steppers with that set. */
function fillFromChip(button) {
  const kg = Number(button.dataset.kg);
  byId(`weight-${button.dataset.index}`).value = kg > 0 ? toDisplay(kg, unit()) : '';
  byId(`reps-${button.dataset.index}`).value = button.dataset.reps;
}

function dismissRest() {
  restDismissed = data.active.lastSetAt;
  renderLog();
}

function isStronger(a, b) {
  if (a.kg > 0 || b.kg > 0) return estimateMax(a) > estimateMax(b);
  return a.reps > b.reps;
}

function removeSet(index, setIndex) {
  data.active.exercises[index].sets.splice(setIndex, 1);
  save();
  renderLog();
}

function removeExercise(button) {
  const index = Number(button.dataset.index);
  const exercise = data.active.exercises[index];
  const remove = () => {
    data.active.exercises.splice(index, 1);
    save();
    renderLog();
  };
  if (exercise.sets.length === 0) remove();
  else confirmTap(button, 'Tap again to remove', remove);
}

function openFinish() {
  const summary = workoutSummary({ ...data.active, finishedAt: Date.now() });
  byId('finish-summary').textContent = summary.setCount === 0
    ? "You haven't logged any sets, so there's nothing to save yet."
    : `${plural(summary.exerciseCount, 'exercise')} · ${plural(summary.setCount, 'set')} · ${minutesLabel(summary.minutes)}`;
  byId('finish-confirm').textContent = summary.setCount === 0 ? 'End workout' : 'Finish';
  openDialog(dialogs.finish);
}

function finish() {
  const hadSets = data.active.exercises.some((e) => e.sets.length > 0);
  const bests = countBests(data.active);
  data = finishWorkout(data);
  save();
  dialogs.finish.close();
  renderAll();
  if (!hadSets) toast('Workout ended. Nothing was logged.');
  else toast(bests ? `Workout saved · ${plural(bests, 'new best')}` : 'Workout saved');
}

function countBests(workout) {
  return workout.exercises.filter((e) => e.sets.some((s) => beatsRecord(data.workouts, e.name, s))).length;
}

function discard(button) {
  confirmTap(button, 'Tap again to discard', () => {
    data.active = null;
    save();
    dialogs.finish.close();
    renderAll();
    toast('Workout discarded');
  });
}

/* Add-exercise panel */

function openAddExercise() {
  const search = byId('ex-search');
  search.value = '';
  renderSuggestions();
  openDialog(dialogs.add);
  search.focus();
}

function renderSuggestions() {
  const query = cleanName(byId('ex-search').value);
  const inWorkout = data.active ? data.active.exercises.map((e) => e.name) : [];
  const recent = new Set(recentExerciseNames(data.workouts).map(nameKey));
  const names = suggestExercises(query, data.workouts, inWorkout);
  const items = [];
  const exact = names.some((n) => nameKey(n) === nameKey(query))
    || inWorkout.some((n) => nameKey(n) === nameKey(query));
  if (query && !exact) {
    items.push(h('li', {}, h('button', { type: 'button', 'data-name': query },
      h('span', { class: 'is-new', text: `Add "${query}"` }),
      h('span', { class: 'ex-meta', text: 'New exercise' }))));
  }
  const item = (name) => {
    const sessions = recent.has(nameKey(name)) ? sessionsFor(data.workouts, name) : [];
    const meta = sessions.length ? `Last ${shortDate(sessions[sessions.length - 1].t)}` : '';
    return h('li', {}, h('button', { type: 'button', 'data-name': name },
      h('span', { class: 'ex-name', text: name }),
      meta ? h('span', { class: 'ex-meta', text: meta }) : null,
      h('span', { class: 'ex-add', html: ICON_PLUS })));
  };
  const own = names.filter((n) => recent.has(nameKey(n)));
  const common = names.filter((n) => !recent.has(nameKey(n))).slice(0, 40);
  if (own.length) items.push(h('li', { class: 'ex-group', text: 'Your exercises' }), ...own.map(item));
  if (common.length) items.push(h('li', { class: 'ex-group', text: 'Common exercises' }), ...common.map(item));
  byId('ex-list').replaceChildren(...items);
}

function addExercise(name) {
  const clean = cleanName(name);
  if (!clean || !data.active) return;
  data.active.exercises.push({ name: clean, sets: [] });
  save();
  dialogs.add.close();
  renderLog();
  const cards = views.log.querySelectorAll('.exercise');
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* History tab */

function workoutCard(workout, withDelete = true) {
  const summary = workoutSummary(workout);
  const date = new Date(workout.startedAt);
  const lines = workout.exercises.map((exercise) => {
    const byReps = !exercise.sets.some((s) => s.kg > 0);
    const top = bestSet(exercise.sets, byReps);
    return h('li', {},
      h('span', { text: exercise.name }),
      h('span', { text: `${plural(exercise.sets.length, 'set')} · ${formatSet(top, unit())}` }));
  });
  const details = workout.exercises.map((exercise) => h('div', { class: 'wc-ex' },
    h('h4', { text: exercise.name }),
    h('div', { class: 'wc-sets' }, exercise.sets.map((s) => h('span', { class: 'chip', text: formatSet(s, unit()) })))));

  return h('details', { class: 'workout-card' },
    h('summary', {},
      h('span', { class: 'wc-date' },
        h('span', { class: 'wc-day', text: String(date.getDate()) }),
        h('span', { class: 'wc-mon', text: date.toLocaleDateString(undefined, { month: 'short' }) })),
      h('div', { class: 'wc-body' },
        h('div', { class: 'wc-head' },
          h('span', { class: 'wc-title', text: `${date.toLocaleDateString(undefined, { weekday: 'long' })} · ${timeLabel(workout.startedAt)}` }),
          h('span', { class: 'wc-meta', text: minutesLabel(summary.minutes) })),
        h('ul', { class: 'wc-lines' }, lines)),
      h('span', { class: 'wc-chev', html: ICON_CHEVRON })),
    h('div', { class: 'wc-detail' },
      details,
      h('p', { class: 'wc-total' },
        h('span', { text: `${plural(summary.exerciseCount, 'exercise')} · ${plural(summary.setCount, 'set')}` }),
        h('span', { text: `Lifted ${volumeLabel(summary.volumeKg)}` })),
      withDelete ? h('button', { type: 'button', class: 'text-btn danger', 'data-action': 'delete-workout', 'data-id': workout.id, text: 'Delete workout' }) : null),
  );
}

function renderHistory() {
  const view = views.history;
  const header = h('div', {},
    h('h2', { class: 'view-title', text: 'History' }),
    h('p', { class: 'view-sub', text: data.workouts.length ? plural(data.workouts.length, 'workout') + ' logged' : 'Nothing logged yet' }));
  if (!data.workouts.length) {
    view.replaceChildren(header, h('div', { class: 'empty' },
      h('strong', { text: 'Your finished workouts show up here' }),
      h('span', { text: 'Start one from the Log tab. Tap a workout later to see every set.' })));
    return;
  }
  const groups = new Map();
  for (const workout of [...data.workouts].reverse()) {
    const month = monthLabel(workout.startedAt);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(workout);
  }
  view.replaceChildren(header, ...[...groups].map(([month, workouts]) => h('section', {},
    h('h3', { class: 'section-title month', text: month }),
    h('ol', { class: 'workout-list' }, workouts.map((w) => h('li', {}, workoutCard(w)))))));
}

function deleteWorkout(button) {
  confirmTap(button, 'Tap again to delete', () => {
    data.workouts = data.workouts.filter((w) => w.id !== button.dataset.id);
    save();
    renderAll();
    toast('Workout deleted');
  });
}

/* Progress tab */

function renderProgress() {
  stopChart?.();
  stopChart = null;
  const view = views.progress;
  const names = recentExerciseNames(data.workouts);
  const header = h('div', {}, h('h2', { class: 'view-title', text: 'Progress' }));
  if (!names.length) {
    view.replaceChildren(header, h('div', { class: 'empty' },
      h('strong', { text: 'Your progress charts live here' }),
      h('span', { text: 'Finish a workout and each exercise gets its own chart and records.' })));
    return;
  }

  const saved = readPick();
  const name = names.find((n) => nameKey(n) === nameKey(saved)) ?? names[0];
  const select = h('select', { id: 'exercise-pick' }, names.map((n) => h('option', { value: n, text: n, selected: n === name })));
  const series = progressSeries(data.workouts, name);
  const rec = records(data.workouts, name);
  const byReps = series.metric === 'reps';
  const u = unit();

  const tile = (label, value, note) => h('div', { class: 'tile' },
    h('span', { class: 'tile-label', text: label }),
    h('span', { class: 'tile-value' }, value),
    note ? h('span', { class: 'tile-note', text: note }) : null);
  const weightValue = (value, suffix = '') => [String(value), h('small', { text: ` ${u}${suffix}` })];

  const tiles = byReps
    ? [
      tile('Most reps', String(rec.mostReps.reps), shortDate(rec.mostReps.t)),
      tile('Sessions', String(rec.sessions)),
      tile('Sets logged', String(rec.setCount)),
    ]
    : [
      tile('Best est. max', weightValue(displayMax(rec.bestMax.value, u)), shortDate(rec.bestMax.t)),
      tile('Heaviest set', weightValue(toDisplay(rec.heaviest.kg, u), ` × ${rec.heaviest.reps}`), shortDate(rec.heaviest.t)),
      tile('Sessions', String(rec.sessions)),
    ];

  const formatValue = (v) => (byReps ? plural(v, 'rep') : `${displayMax(v, u)} ${u}`);
  const chartHost = h('div', { class: 'chart' });
  const bestValue = Math.max(...series.points.map((p) => p.value));
  const rows = [...series.points].reverse().map((p) => h('tr', { class: p.value === bestValue ? 'is-best' : '' },
    h('td', { text: dayLabel(p.t) }),
    h('td', { text: formatSet(p.top, u) }),
    h('td', { text: byReps ? String(p.value) : String(displayMax(p.value, u)) })));

  view.replaceChildren(
    header,
    h('div', { class: 'picker' },
      h('label', { class: 'field-label', for: 'exercise-pick', text: 'Exercise' }),
      h('div', { class: 'select' }, select, h('span', { class: 'select-chev', html: ICON_CHEVRON }))),
    h('div', { class: 'tiles' }, tiles),
    h('figure', { class: 'chart-card' },
      h('figcaption', {},
        h('h3', { text: byReps ? 'Most reps per session' : 'Estimated max per session' }),
        h('p', { text: byReps
          ? 'Your best set each time you did this exercise.'
          : 'Your best set each session, worked out as a one-rep max (e1RM).' })),
      chartHost),
    h('section', {},
      h('h3', { class: 'section-title', text: 'Sessions' }),
      h('div', { class: 'table-wrap card' },
        h('table', { class: 'sessions' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', text: 'Date' }),
            h('th', { scope: 'col', text: `Best set${byReps ? '' : ` (${u})`}` }),
            h('th', { scope: 'col', text: byReps ? 'Reps' : `e1RM (${u})` }))),
          h('tbody', {}, rows)))),
  );

  stopChart = drawLineChart(chartHost, {
    points: series.points.map((p) => ({
      t: p.t,
      value: byReps ? p.value : displayMax(p.value, u),
      detail: `Best set ${formatSet(p.top, u, true)}`,
    })),
    formatValue: (v) => (byReps ? plural(v, 'rep') : `${v} ${u}`),
    formatTick: (v) => String(Math.round(v * 10) / 10),
    formatDate: (t, long) => (long ? dayLabel(t) : shortDate(t)),
    label: `${byReps ? 'Most reps' : 'Estimated max'} for ${name} across ${plural(series.points.length, 'session')}, latest ${formatValue(series.points[series.points.length - 1].value)}. The table below lists every session.`,
  });
}

/* Settings */

function openSettings() {
  byId(`unit-${unit()}`).checked = true;
  byId('restore-text').value = '';
  setRestoreMessage('');
  renderInstall();
  openDialog(dialogs.settings);
}

function setRestoreMessage(text, isError = false) {
  const msg = byId('restore-msg');
  msg.textContent = text;
  msg.classList.toggle('is-error', isError);
}

async function copyBackup(button) {
  const text = backupText(data);
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    byId('restore-text').value = text;
    byId('restore-text').select();
    button.textContent = 'Select and copy';
  }
  setTimeout(() => { button.textContent = 'Copy backup'; }, 2000);
}

function downloadBackup() {
  const blob = new Blob([backupText(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `workout-log-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function restore(button) {
  let incoming;
  try {
    incoming = parseBackup(byId('restore-text').value);
  } catch (error) {
    setRestoreMessage(error.message, true);
    return;
  }
  setRestoreMessage(`Found ${plural(incoming.workouts.length, 'workout')}. This replaces everything saved now.`);
  confirmTap(button, 'Tap to replace', () => {
    data = incoming;
    save();
    renderAll();
    setRestoreMessage(`Restored ${plural(data.workouts.length, 'workout')}.`);
    delete button.dataset.armed;
    button.textContent = 'Restore';
  });
}

/* Install and offline */

let installPrompt = null;
let updateTimer = 0;

/** True when opened from the home screen rather than in a browser tab. */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** iPhones and iPads, where Safari has no install prompt, only the Share menu. */
function isApplePhone() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function renderInstall() {
  let text;
  if (isStandalone()) {
    text = 'Installed. It opens from your home screen and works with no connection.';
  } else if (installPrompt) {
    text = 'Put it on your home screen like any other app. It opens full screen and works with no connection.';
  } else if (isApplePhone()) {
    text = 'In Safari, tap Share, then "Add to Home Screen". It opens full screen and works with no connection.';
  } else {
    text = 'In your browser menu, choose "Install app" or "Add to Home Screen". It opens full screen and works with no connection.';
  }
  byId('install-text').textContent = text;
  byId('install-btn').hidden = !installPrompt || isStandalone();
  byId('install-note').hidden = isStandalone() || data.workouts.length === 0;
}

async function install() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null; // The browser only lets a prompt be shown once.
  try {
    await prompt.prompt();
  } catch {
    // The browser declined to show its prompt; the hint text still helps.
  }
  renderInstall();
}

/** The service worker fetched a newer copy of the app. */
function offerUpdate() {
  clearTimeout(updateTimer);
  // Files update one by one, so wait a moment and a reload gets all of them.
  updateTimer = setTimeout(() => { byId('update').hidden = false; }, 1500);
}

/* Navigation */

function show(view) {
  currentView = view;
  for (const [key, section] of Object.entries(views)) section.hidden = key !== view;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  renderView();
  window.scrollTo({ top: 0 });
}

function renderView() {
  if (currentView === 'log') renderLog();
  else if (currentView === 'history') renderHistory();
  else renderProgress();
}

function renderAll() {
  renderView();
}

/* Wiring */

views.log.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'start') startWorkout();
  else if (action === 'finish') openFinish();
  else if (action === 'add-exercise') openAddExercise();
  else if (action === 'step') stepInput(button);
  else if (action === 'add-set') addSet(Number(button.dataset.index));
  else if (action === 'remove-set') removeSet(Number(button.dataset.index), Number(button.dataset.set));
  else if (action === 'remove-exercise') removeExercise(button);
  else if (action === 'fill') fillFromChip(button);
  else if (action === 'rest-dismiss') dismissRest();
  else if (action === 'install-hint') openSettings();
});

views.history.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="delete-workout"]');
  if (button) deleteWorkout(button);
});

views.progress.addEventListener('change', (event) => {
  if (event.target.id !== 'exercise-pick') return;
  writePick(event.target.value);
  renderProgress();
});

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => show(tab.dataset.view));
}

byId('ex-search').addEventListener('input', renderSuggestions);
byId('ex-search').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const first = byId('ex-list').querySelector('[data-name]');
  if (first) addExercise(first.dataset.name);
});
byId('ex-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-name]');
  if (button) addExercise(button.dataset.name);
});

byId('finish-confirm').addEventListener('click', finish);
byId('discard-btn').addEventListener('click', (event) => discard(event.currentTarget));
byId('settings-btn').addEventListener('click', openSettings);
byId('copy-backup').addEventListener('click', (event) => copyBackup(event.currentTarget));
byId('download-backup').addEventListener('click', downloadBackup);
byId('restore-btn').addEventListener('click', (event) => restore(event.currentTarget));
byId('restore-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  byId('restore-text').value = await file.text();
  event.target.value = '';
  setRestoreMessage('Backup file loaded. Tap Restore to use it.');
});
for (const radio of document.querySelectorAll('input[name="unit"]')) {
  radio.addEventListener('change', () => {
    data.unit = radio.value;
    save();
    renderAll();
  });
}

for (const dialog of Object.values(dialogs)) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
}

byId('install-btn').addEventListener('click', install);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  if (dialogs.settings.open) renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  if (dialogs.settings.open) renderInstall();
  if (currentView === 'log') renderLog();
  toast('Added to your home screen');
});

byId('update-btn').addEventListener('click', () => location.reload());
byId('update-close').addEventListener('click', () => { byId('update').hidden = true; });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // The app still works, just not offline.
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'updated') offerUpdate();
  });
}

setInterval(() => {
  if (!data.active) return;
  const elapsed = byId('elapsed');
  if (elapsed) elapsed.textContent = elapsedText();
  const rest = byId('rest-time');
  if (rest && Number.isFinite(data.active.lastSetAt)) rest.textContent = restText();
}, 1000);

data = load();
renderAll();
