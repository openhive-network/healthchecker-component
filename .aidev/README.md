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
| `build` | the published artifact: `tsc && vite build` |
| `dist-exports` | (after `build`) the files package.json `exports`/`types` name exist in `dist/` |

| Slot | Steps |
|---|---|
| quick, full, canary | lint, typecheck, build |
| static | lint, typecheck |
| baseline, coverage, system | build |

The library has no tests yet; adding them (rendering the component against the React
versions its consumers use) is the first thing to bind into `quick`/`full`.

## The test runtime image (`runtime/`)

The suites run in a container with `--network none` and your uid. The image carries
Node 22, pnpm (from package.json `packageManager`, through corepack) and a pnpm store
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
