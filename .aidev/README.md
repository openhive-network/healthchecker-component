# healthchecker-component under AIDEV

AIDEV verifies changes to this library through the slots in `project.yaml`, integrates
them into `aidev/integration`, and people merge that into `develop` through merge
requests (as in hive/denser). GitLab CI doesn't run for AIDEV branches; see
`.gitlab-ci.yml` `workflow:`.

## Suites

`.aidev/run-checks.sh <suite> <step>...` runs the named steps and writes
`test-results/<suite>/junit.xml`, one test case per step, with the step's log tail as
the failure body.

| Step | What |
|---|---|
| `lint` | ESLint, `--max-warnings 0` (package.json `lint`) |
| `typecheck` | `tsc --noEmit` |
| `test` | the render tests in `tests/` under React 18 and 19; junit in `render-tests.xml` |
| `build` | the published artifact: `tsc && vite build` |
| `dist-exports` | (after `build`) the files package.json `exports`/`types` name exist in `dist/` |
| `no-bundled-react` | (after `build`) `dist/` imports React (`react/jsx-runtime` included) from the consumer rather than carrying a copy |

| Slot | Steps |
|---|---|
| quick, full, canary | lint, typecheck, test, build |
| static | lint, typecheck |
| baseline, coverage, system | build |

The render tests mount `HealthCheckerComponent` and its dialogs with `@hiveio/wax`'s
`HealthChecker` stubbed, and fail on any console error or warning. Each React they run
under is a workspace package (`tests/react18`, `tests/react19`) that installs `react`,
`react-dom` and `@testing-library/react`; `vitest.config.ts` has one project per package
aliasing those names to it.

## The test runtime image (`runtime/`)

The suites run in a container with `--network none` and your uid. The image carries
Node 24, pnpm (from package.json `packageManager`, through corepack) and a pnpm store
filled with `pnpm fetch`. `pnpm-deps.sh` installs `node_modules` offline from it.

When `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `packageManager` or
`runtime/Dockerfile` change, rebuild and re-pin **in the same commit**:

```bash
.aidev/runtime/build.sh --push   # registry digest if aidev-<input hash> exists, else build + push
# put the printed repo@sha256:<digest> into project.yaml environment.image
```

Run a suite by hand the same way AIDEV does:

```bash
docker run --rm --network none --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD":/work -w /work <environment.image> .aidev/run-checks.sh quick lint typecheck build
```
