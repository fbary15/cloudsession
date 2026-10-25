// The built-in exercise catalog and the day routines. Each exercise has a
// muscle group and a picture pair in img/: `<img>-0.jpg` is the start of the
// movement and `<img>-1.jpg` the end. The photos come from the public domain
// Free Exercise DB; see img/CREDITS.txt.

export const EXERCISES = [
  // Chest
  { name: 'Bench press', img: 'bench-press', muscle: 'Chest' },
  { name: 'Incline bench press', img: 'incline-bench-press', muscle: 'Chest' },
  { name: 'Dumbbell bench press', img: 'dumbbell-bench-press', muscle: 'Chest' },
  { name: 'Incline dumbbell press', img: 'incline-dumbbell-press', muscle: 'Chest' },
  { name: 'Machine chest fly', img: 'machine-chest-fly', muscle: 'Chest' },
  { name: 'Dumbbell fly', img: 'dumbbell-fly', muscle: 'Chest' },
  { name: 'Push-up', img: 'push-up', muscle: 'Chest' },
  { name: 'Dip', img: 'dip', muscle: 'Chest, triceps' },
  // Shoulders
  { name: 'Overhead press', img: 'overhead-press', muscle: 'Shoulders' },
  { name: 'Dumbbell shoulder press', img: 'dumbbell-shoulder-press', muscle: 'Shoulders' },
  { name: 'Lateral raise', img: 'lateral-raise', muscle: 'Shoulders' },
  { name: 'Face pull', img: 'face-pull', muscle: 'Rear shoulders' },
  { name: 'Reverse fly', img: 'reverse-fly', muscle: 'Rear shoulders' },
  // Triceps
  { name: 'Triceps pushdown (rope)', img: 'triceps-pushdown', muscle: 'Triceps' },
  { name: 'Overhead triceps extension (rope)', img: 'overhead-triceps-extension', muscle: 'Triceps' },
  { name: 'Skull crusher', img: 'skull-crusher', muscle: 'Triceps' },
  // Back
  { name: 'Pull-up', img: 'pull-up', muscle: 'Back' },
  { name: 'Chin-up', img: 'chin-up', muscle: 'Back, biceps' },
  { name: 'Lat pulldown', img: 'lat-pulldown', muscle: 'Back' },
  { name: 'Seated cable row', img: 'seated-cable-row', muscle: 'Back' },
  { name: 'Barbell row', img: 'barbell-row', muscle: 'Back' },
  { name: 'Straight-arm pulldown', img: 'straight-arm-pulldown', muscle: 'Back' },
  { name: 'Back extension', img: 'back-extension', muscle: 'Lower back' },
  { name: 'Deadlift', img: 'deadlift', muscle: 'Back, legs' },
  // Biceps
  { name: 'Barbell curl', img: 'barbell-curl', muscle: 'Biceps' },
  { name: 'Incline dumbbell curl', img: 'incline-dumbbell-curl', muscle: 'Biceps' },
  { name: 'Cable curl', img: 'cable-curl', muscle: 'Biceps' },
  { name: 'Hammer curl', img: 'hammer-curl', muscle: 'Biceps' },
  // Legs
  { name: 'Squat', img: 'squat', muscle: 'Legs' },
  { name: 'Front squat', img: 'front-squat', muscle: 'Legs' },
  { name: 'Leg press', img: 'leg-press', muscle: 'Legs' },
  { name: 'Romanian deadlift', img: 'romanian-deadlift', muscle: 'Hamstrings' },
  { name: 'Leg extension', img: 'leg-extension', muscle: 'Quads' },
  { name: 'Leg curl', img: 'leg-curl', muscle: 'Hamstrings' },
  { name: 'Calf raise', img: 'calf-raise', muscle: 'Calves' },
  { name: 'Lunge', img: 'lunge', muscle: 'Legs' },
  { name: 'Hip thrust', img: 'hip-thrust', muscle: 'Glutes' },
];

/** Picture paths for a catalog entry, relative to the app folder. */
export const exerciseImages = (entry) => [`img/${entry.img}-0.jpg`, `img/${entry.img}-1.jpg`];

/**
 * The day routines a workout can start from. These are the defaults; the
 * app keeps a copy per user that can be updated from a finished workout.
 */
export const ROUTINES = [
  {
    id: 'push',
    name: 'Push day',
    muscles: 'Chest, shoulders, triceps',
    exercises: [
      'Bench press',
      'Incline bench press',
      'Machine chest fly',
      'Triceps pushdown (rope)',
      'Overhead triceps extension (rope)',
      'Lateral raise',
    ],
  },
  {
    id: 'pull',
    name: 'Pull day',
    muscles: 'Back, biceps',
    exercises: [
      'Pull-up',
      'Seated cable row',
      'Straight-arm pulldown',
      'Back extension',
      'Incline dumbbell curl',
      'Cable curl',
    ],
  },
  {
    id: 'legs',
    name: 'Leg day',
    muscles: 'Quads, hamstrings, glutes, calves',
    exercises: [
      'Squat',
      'Leg press',
      'Romanian deadlift',
      'Leg extension',
      'Leg curl',
      'Calf raise',
    ],
  },
];
