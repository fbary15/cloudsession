#!/bin/bash
# SessionStart hook: install project dependencies in Claude Code cloud sessions.
# Idempotent and non-interactive. Does nothing outside a cloud session and
# nothing when the repo has no dependency manifest yet.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ -f package.json ]; then
  echo "session-start: installing npm dependencies"
  npm install --no-audit --no-fund
fi

if [ -f requirements.txt ]; then
  echo "session-start: installing Python requirements"
  python3 -m pip install --quiet -r requirements.txt
fi

if [ -f pyproject.toml ] && [ ! -f requirements.txt ]; then
  echo "session-start: installing Python project"
  python3 -m pip install --quiet -e .
fi

echo "session-start: done"
