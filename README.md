# cloudsession

A project that lives in Claude Code cloud sessions: the code, the terminal and the
agent all run in a cloud container, not on a laptop. Close the lid, pick the
session up again on your phone, and it is still where you left it.

## Continuing on your phone

1. Open the Claude app (iOS or Android) or go to <https://claude.ai/code>.
2. Open the **Code** tab and pick the session for this repository.
3. Keep typing. The same container, files and conversation carry on.

A session keeps running while Claude is working. If you stop sending messages
for a while the container is reclaimed, so anything worth keeping must be
committed and pushed. Claude does that at the end of each task.

## How the branches work

Each cloud session works on its own branch (for this one:
`claude/dazzling-wright-5f0ru5`) and pushes there. Open a pull request from
that branch when you want the work on the default branch.

## Session start hook

`.claude/hooks/session-start.sh` runs when a cloud session starts. It installs
dependencies for whichever manifests exist in the repo (`package.json`,
`requirements.txt`, `pyproject.toml`), so tests and linters work immediately.
With no manifest present it does nothing. It is registered in
`.claude/settings.json` and only runs in cloud sessions.

More on cloud sessions: <https://code.claude.com/docs/en/claude-code-on-the-web>
