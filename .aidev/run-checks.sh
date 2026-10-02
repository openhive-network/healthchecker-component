#!/usr/bin/env bash
# The checks AIDEV's verification slots run (.aidev/project.yaml), as one junit
# report per suite: each named step is a test case, its log the failure body.
#
#   .aidev/run-checks.sh <suite> <step>...     steps: lint typecheck test build
#
#   lint       ESLint with --max-warnings 0 (package.json `lint`)
#   typecheck  tsc --noEmit for the library and its config files
#   test       the render tests (tests/) under React 18 and 19, junit in
#              test-results/<suite>/render-tests.xml
#   build      the published artifact: `tsc && vite build`, then the files
#              package.json `exports` / `types` point at must exist in dist/,
#              and dist/ must not carry a copy of React (it comes from the consumer)
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

# React's internals, its element tag and the jsx-runtime license header only reach dist/
# when a react entry point is bundled instead of imported from the consumer.
check_no_bundled_react() {
    local js=(dist/*.js) found=0
    for marker in __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED 'react-jsx-runtime' 'Symbol.for("react.element")'; do
        if grep -lF -- "$marker" "${js[@]}"; then echo "dist/ bundles React: found $marker" >&2; found=1; fi
    done
    grep -qF 'from "react/jsx-runtime"' "${js[@]}" || { echo "dist/ does not import react/jsx-runtime" >&2; found=1; }
    [ "$found" -eq 0 ] && echo "dist/ imports React from the consumer"
}

for s in "$@"; do
    case "$s" in
        lint) step lint pnpm exec eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0 ;;
        typecheck) step typecheck pnpm exec tsc --noEmit ;;
        test) step test pnpm exec vitest run --reporter=default --reporter=junit --outputFile.junit="$out/render-tests.xml" ;;
        build) step build bash -c 'rm -rf dist && pnpm exec tsc && pnpm exec vite build' && step dist-exports check_dist && step no-bundled-react check_no_bundled_react ;;
        *) echo "unknown step: $s" >&2; exit 2 ;;
    esac
done
junit_write_cases "$out/junit.xml" "$suite" "$cases"
exit "$status"
