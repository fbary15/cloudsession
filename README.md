# cloudsession

Small web projects built from Claude Code cloud sessions. The code, the terminal
and the agent all run in a cloud container, so you can close your laptop and
keep going from your phone.

## Projects

| Project | Folder | Status |
| --- | --- | --- |
| Daily Word | `puzzle/` | Playable |
| Workout Log | | Up next |
| Spending Tracker | | Planned |
| Morning Dashboard | | Planned |

`index.html` at the root is a home page that links them all.

### Daily Word

A daily five-letter word puzzle with six guesses. Everyone gets the same word
on the same day, counted from puzzle No. 1 on 16 October 2026 in the player's
own time zone.

- `puzzle/logic.js` holds the rules: scoring, puzzle numbers, streaks and the
  share text. It never touches the page, so it is fully tested.
- `puzzle/game.js` draws the board and keyboard and saves progress in the
  browser.
- `puzzle/words.js` holds the answer schedule and the list of accepted
  guesses. Add new answers at the end of the list only, or future puzzles
  shift.

## Playing it on your phone

The site is plain HTML, CSS and JavaScript with no build step, so GitHub Pages
can host it straight from this repository:

1. On GitHub, open **Settings**, then **Pages**.
2. Under **Build and deployment**, set the source to **Deploy from a branch**.
3. Pick the branch and the `/ (root)` folder, then save.
4. After a minute the site is live at `https://fbary15.github.io/cloudsession/`.

Every push to that branch updates the live site.

## Working on it

```sh
npm install          # installs the linter; the session hook does this for you
npm test             # runs the tests with Node's built-in test runner
npm run lint         # runs ESLint
```

To try the site locally, serve the folder and open `/puzzle/`:

```sh
python3 -m http.server 8000
```

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
