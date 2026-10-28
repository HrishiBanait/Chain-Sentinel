#!/usr/bin/env bash
# Usage: scripts/push-milestone.sh <number> "commit message"
set -euo pipefail

if [ $# -lt 2 ]; then
  echo 'usage: scripts/push-milestone.sh <number> "commit message"'
  exit 1
fi
N="$1"; MSG="$2"
cd "$(git rev-parse --show-toplevel)"

echo "== gates =="
(cd contracts && forge test -q)
(cd backend && npx tsc --noEmit)
echo "gates passed"

git add -A

echo "== safety checks on staged files =="
BAD=$(git diff --cached --name-only \
  | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$|keystore|\.db$|\.sqlite3?$|node_modules/' \
  | grep -v '\.env\.example$' || true)
if [ -n "$BAD" ]; then
  echo "REFUSING: sensitive-looking files are staged:"; echo "$BAD"
  echo "(nothing committed; fix .gitignore or unstage them)"; exit 1
fi

# Heuristic only: flags added lines pairing a secret-ish word with a 64-hex value.
LEAK=$(git diff --cached -U0 | grep -E '^\+' \
  | grep -iE '(private|secret|mnemonic|seed|passw)[^0-9a-fA-F]*[=:][^0-9a-fA-Fx]{0,4}(0x)?[0-9a-fA-F]{64}' || true)
if [ -n "$LEAK" ]; then
  echo "REFUSING: staged lines look like they contain a private key:"; echo "$LEAK"; exit 1
fi

if git diff --cached --quiet; then
  echo "Nothing to commit."; exit 0
fi

git diff --cached --stat
read -r -p "Commit, tag milestone-$N and push? [y/N] " ans
[ "$ans" = "y" ] || { echo "Aborted (changes remain staged)."; exit 1; }

git commit -m "$MSG"
git tag -a "milestone-$N" -m "Milestone $N: $MSG"
git push origin main --follow-tags
echo "Pushed milestone-$N."
