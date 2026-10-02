#!/usr/bin/env bash
# The checks AIDEV's verification slots run (.aidev/project.yaml), as one junit
# report per suite: each named step is a test case, its log the failure body.
#
#   .aidev/run-checks.sh <suite> <step>...     steps: lint typecheck build
#
#   lint       ESLint with --max-warnings 0 (package.json `lint`)
#   typecheck  tsc --noEmit for the library and its config files
#   build      the published artifact: `tsc && vite build`, then the files
#              package.json `exports` / `types` point at must exist in dist/
set -uo pipefail
cd "$(dirname "$0")/.."

suite="${1:?usage: $0 <suite> <step>...}"; shift
out="test-results/$suite"
rm -rf "$out"; mkdir -p "$out"
cases="$out/cases.tsv"; : > "$cases"

# shellcheck source=pnpm-deps.sh
if ! source .aidev/pnpm-deps.sh; then
    printf 'case\tinstall\tfail\t0\tpnpm install --offline failed\n' >> "$cases"
    source .aidev/junit-helpers.sh; junit_write_cases "$out/junit.xml" "$suite" "$cases"
    exit 1
fi
source .aidev/junit-helpers.sh

status=0
step() {
    local name="$1"; shift
    local log="$out/$name.log" t0=$SECONDS rc=0
    echo "== $name" >&2
    "$@" > "$log" 2>&1 < /dev/null || rc=$?
    if [ "$rc" -eq 0 ]; then
        printf 'case\t%s\tpass\t%s\t\n' "$name" "$((SECONDS - t0))" >> "$cases"
    else
        status=1; tail -40 "$log" >&2
        printf 'case\t%s\tfail\t%s\texit %s\t%s\n' "$name" "$((SECONDS - t0))" "$rc" "$log" >> "$cases"
    fi
}

check_dist() {
    node -e '
const fs = require("fs");
const pkg = require("./package.json");
const want = [pkg.types, ...Object.values(pkg.exports || {}).flatMap((e) => typeof e === "string" ? [e] : Object.values(e))];
const missing = want.filter((f) => f && !fs.existsSync(f));
if (missing.length) { console.error("missing from the build:", missing.join(", ")); process.exit(1); }
console.log("dist provides", want.join(", "));'
}

for s in "$@"; do
    case "$s" in
        lint) step lint pnpm exec eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0 ;;
        typecheck) step typecheck pnpm exec tsc --noEmit ;;
        build) step build bash -c 'rm -rf dist && pnpm exec tsc && pnpm exec vite build' && step dist-exports check_dist ;;
        *) echo "unknown step: $s" >&2; exit 2 ;;
    esac
done
junit_write_cases "$out/junit.xml" "$suite" "$cases"
exit "$status"
