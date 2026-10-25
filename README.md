# cloudsession

Small web projects built from Claude Code cloud sessions. The code, the terminal
and the agent all run in a cloud container, so you can close your laptop and
keep going from your phone.

## Projects

| Project | Folder | Status |
| --- | --- | --- |
| Word Tiles | `puzzle/` | Playable |
| Workout Log | `workout/` | Installable |
| Spending Tracker | | Up next |
| Morning Dashboard | | Planned |

`index.html` at the root is a home page that links them all.

### Word Tiles

A five-letter word puzzle with six guesses. Play as many words as you like:
each game picks a random common word and avoids ones you've had recently. The
arrow button gives up on the current word and starts a new one.

- `puzzle/logic.js` holds the rules: scoring, picking words, streaks and the
  share text. It never touches the page, so it is fully tested.
- `puzzle/game.js` draws the board and keyboard and saves progress in the
  browser.
- `puzzle/words.js` holds the possible answers and the list of accepted
  guesses.

### Workout Log

Log a workout set by set at the gym, then see your history and progress.

- **Log**: between workouts, this week's workouts, sets and weight lifted at
  a glance, your recent bests, and your last workout. During one, a card that
  stays in reach with the clock and a rest timer that restarts with every
  set, exercise cards with big steppers for weight and reps, and last time's
  sets as chips you tap to reuse their numbers. Any set that beats your best
  ever gets a badge.
- **Day routines**: start a Push day, Pull day or Leg day and the usual
  exercises are already in the workout. Adjust them as you train and tick
  "Save these exercises" when you finish to make that the new routine. An
  empty workout is always one tap away too.
- **Pictures**: every built-in exercise has two photos, the start and the end
  of the movement, in the picker and on its card, so you can recognise one
  without knowing its name.
- **History**: every finished workout, newest first. Tap one to see every set.
- **Progress**: per exercise, your best estimated one-rep max (e1RM) each
  session as a chart, plus records and a table of sessions. Bodyweight
  exercises chart reps instead.
- **Settings**: kg or lb, and a backup you can copy, download or restore.
- **On your phone**: it is a web app you can install. Open the live site on
  your phone, then use **Install app** in Settings (Android), or Share, then
  **Add to Home Screen** (iPhone). It then opens full screen from your home
  screen with its own icon and works with no connection. When a new version is
  published, the app offers a reload.

Workouts are saved in the browser on your phone, with no account or server.
Weights are stored in kilograms, so switching units never changes old data.
The installed app has its own storage, separate from the browser tab, so
install it before logging, or move workouts across with a backup.

- `workout/logic.js` holds the maths: unit conversion, e1RM (Epley formula),
  best sets, records, the weekly summary, routines, and checking backups. It
  is fully tested.
- `workout/exercises.js` is the exercise catalog (name, muscle group,
  picture) and the default day routines. The photos live in `workout/img/`.
- `workout/chart.js` draws the progress chart as SVG.
- `workout/app.js` draws the tabs and saves to the browser.
- `workout/sw.js` is the service worker: it caches the app so it opens
  offline, refreshes the files in the background and tells the page when a
  newer version is ready.
- `workout/manifest.webmanifest` and `workout/icons/` are what a phone needs
  to install it. `node scripts/make-icons.mjs` redraws the icons from the
  design in that script; it uses the Playwright that cloud sessions have
  pre-installed, so the finished PNGs are committed.

## Publishing with GitHub Pages

The site is plain HTML, CSS and JavaScript with no build step, so GitHub Pages
can host it straight from this repository:

1. On GitHub, open **Settings**, then **Pages**.
2. Under **Build and deployment**, set the source to **Deploy from a branch**.
3. Pick the branch and the `/ (root)` folder, then save.
4. After a minute the site is live at `https://fbary15.github.io/cloudsession/`.

Pages is already turned on for this repository.

Every push to that branch updates the live site.

## Working on it

```sh
npm install          # installs the linter; the session hook does this for you
npm test             # runs the tests with Node's built-in test runner
npm run lint         # runs ESLint
```

To try the site locally, serve the folder and open `/puzzle/` or `/workout/`:

```sh
python3 -m http.server 8000
```

The workout app's service worker only runs over HTTPS or on `localhost`, so a
local server like this one is enough to try installing it.

`npm run build:artifact` writes a copy of the puzzle page to `dist/` in the
shape a claude.ai artifact expects. That copy is not committed.

## Continuing on your phone

1. Open the Claude app or go to <https://claude.ai/code>.
2. Open the **Code** tab and pick the session for this repository.
3. Keep typing. The same container, files and conversation carry on.

A session keeps running while Claude is working. If you stop sending messages
for a while the container is reclaimed, so anything worth keeping must be
committed and pushed. Claude does that at the end of each task.

## Session start hook

`.claude/hooks/session-start.sh` runs when a cloud session starts. It installs
dependencies for whichever manifests exist in the repo, so tests and the linter
work immediately. It is registered in `.claude/settings.json` and only runs in
cloud sessions.

More on cloud sessions: <https://code.claude.com/docs/en/claude-code-on-the-web>

## Credits

Accepted guesses come from
[an-array-of-english-words](https://github.com/words/an-array-of-english-words)
by Zeke Sikelianos, under the MIT License. See `puzzle/WORDLIST-LICENSE.txt`.

Exercise photos come from the
[Free Exercise DB](https://github.com/yuhonas/free-exercise-db), released
under the Unlicense (public domain). See `workout/img/CREDITS.txt`.
