#!/usr/bin/env bash
# End-to-end smoke test: real Postgres + real backend (regex mode, no ML), then
# the benchmark, the CLI and the pre-commit hook against it.
#
# Expects an EMPTY database reachable with DB_HOST / DB_PORT / DB_NAME /
# DB_USER / DB_PASSWORD (CI provides a Postgres service). With ML_SERVICE_URL
# set to a running ML service, the repository self-scan runs in HYBRID mode.
# Usage:
#   DB_NAME=promptguard_ci [ML_SERVICE_URL=http://127.0.0.1:8000] scripts/e2e-smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${E2E_PORT:-4555}"
API="http://127.0.0.1:${PORT}"
WORK="$(mktemp -d)"
# Made-up key, written in two pieces so secret scanners do not flag this file
KEY="AKIA""Q7XR2MZP4KD8NW3T"
export PGPASSWORD="${DB_PASSWORD:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" -d "${DB_NAME:-dlp_db}")

step() { printf '\n▶ %s\n' "$*"; }
fail() { printf '✖ %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

step "Schema, migrations and built-in rules"
"${PSQL[@]}" -f "$ROOT/apps/backend/src/db/schema.sql"
(cd "$ROOT/apps/backend" && node src/db/migrate.js && node src/patterns/seedPatterns.js) > "$WORK/setup.log"
RULES=$("${PSQL[@]}" -tAc "SELECT COUNT(*) FROM scan_patterns")
[[ "$RULES" -ge 20 ]] || fail "expected the built-in rules, found $RULES"
echo "  $RULES rules"

ML_URL="${ML_SERVICE_URL:-}"
step "Backend (ML service: ${ML_URL:-disabled})"
# exec, so $! is node itself and cleanup really stops it
(cd "$ROOT/apps/backend" && PORT="$PORT" ML_SERVICE_URL="$ML_URL" exec node src/app.js > "$WORK/backend.log" 2>&1) &
BACKEND_PID=$!
for _ in $(seq 1 30); do
  curl -sf "$API/api/health" > /dev/null && break
  sleep 1
done
curl -sf "$API/api/health" > /dev/null || { cat "$WORK/backend.log"; fail "backend did not start"; }

step "Benchmark smoke run"
python3 "$ROOT/eval/run_benchmark.py" --api "$API" --modes REGEX --skip-injection --limit 80 --out-dir "$WORK/bench" > "$WORK/bench.log"
python3 - "$WORK/bench/latest.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))["modes"]["REGEX"]
cards = r["byCategory"].get("CREDIT_CARD", {}).get("f1", 0)
print(f"  REGEX F1 {r['lenient']['f1']:.3f}, credit cards F1 {cards:.3f}, p95 {r['latencyMs']['p95']} ms")
assert r["lenient"]["tp"] > 0 and cards > 0.5, "regex rules found nothing"
PY

CLI=(node "$ROOT/packages/cli/bin/promptguard.js")

step "CLI: a key fails the scan, a clean file passes"
mkdir -p "$WORK/project"
printf 'export const key = "%s";\n' "$KEY" > "$WORK/project/config.js"
set +e
"${CLI[@]}" scan --api "$API" --mode REGEX --no-color "$WORK/project" > "$WORK/scan.txt"
code=$?
set -e
cat "$WORK/scan.txt"
[[ $code -eq 1 ]] || fail "expected exit 1 for a key, got $code"
grep -q "$KEY" "$WORK/scan.txt" && fail "the key was printed unmasked"
printf 'export const n = 1;\n' > "$WORK/project/config.js"
"${CLI[@]}" scan --api "$API" --mode REGEX "$WORK/project" > /dev/null || fail "clean project should pass"
echo "  ok"

step "Pre-commit hook blocks a commit with a key"
REPO="$WORK/repo"
mkdir -p "$REPO" && cd "$REPO"
git init -q && git config user.email ci@example.com && git config user.name CI && git config commit.gpgsign false
"${CLI[@]}" hook install --api "$API" --mode REGEX > /dev/null
printf 'AWS_ACCESS_KEY_ID=%s\n' "$KEY" > secrets.env
git add secrets.env
if git commit -q -m "add key" > "$WORK/commit.txt" 2>&1; then
  fail "the commit with a key went through"
fi
grep -q "Commit blocked" "$WORK/commit.txt" || { cat "$WORK/commit.txt"; fail "no block message"; }
echo "  blocked as expected"

if [[ -n "$ML_URL" ]]; then
  # HYBRID: the ML validator drops look-alikes (example SSNs, order IDs, hashes)
  # that regex rules alone would flag in source code
  step "PromptGuard scans this repository (HYBRID)"
  cd "$ROOT"
  "${CLI[@]}" scan --api "$API" --mode HYBRID --no-color || fail "this repository has findings at or above HIGH"
else
  step "Repository self-scan skipped (needs ML_SERVICE_URL for HYBRID mode)"
fi

printf '\n✔ End-to-end smoke test passed\n'
