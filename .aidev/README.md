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
| `typecheck-wax2` | (after `typecheck`) `tsc --noEmit -p tests/wax2`: the library and tests against npmjs's `@hiveio/wax` 2.x |
| `test` | the render tests in `tests/` under React 18 and 19, each with ccc's catalog wax and with wax 2.x; junit in `render-tests.xml` |
| `build` | the published artifact: `tsc && vite build` |
| `dist-exports` | (after `build`) the files package.json `exports`/`types` name exist in `dist/` |
| `literal-peers` | (after `build`) package.json `peerDependencies` are literal ranges npm can resolve, not pnpm `catalog:`/`workspace:` references |
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
aliasing those names to it. `tests/wax2` installs npmjs's `@hiveio/wax` 2.x; the
`react18-wax2` and `react19-wax2` projects alias `@hiveio/wax` to it, and
`tests/wax2/tsconfig.json` maps it the same way for `typecheck-wax2`, compiling `src/`
and the render tests against wax 2.x instead of the ccc-catalog version the root
`tsconfig.json` resolves. The package's wax peer range accepts the GitLab 1.28.6 release
candidate, ccc's 1.28.8 `-stable` builds and npmjs's 2.x.

## Catalogs

`pnpm-workspace.yaml` carries common-ci-configuration's pnpm catalogs between its
`BEGIN`/`END common-ci-configuration catalogs` markers, merged from the `npm-common-config`
submodule (ccc `develop`). After a ccc catalog bump, update the submodule and re-merge:

```bash
git submodule update --remote npm-common-config
python3 npm-common-config/scripts/python/pnpm-catalog-sync.py
pnpm install   # then rebuild and re-pin the runtime image (below)
```

## The test runtime image (`runtime/`)

The suites run in a container with `--network none` and your uid. The image is built
on common-ci-configuration's `node-test-tools:develop`, the image CI runs, so Node and
pnpm are the versions ccc's `docker-bake.hcl` defines (this repository pins neither),
and adds a pnpm store filled with `pnpm fetch`. `pnpm-deps.sh` installs `node_modules`
offline from it.

When `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` or `runtime/Dockerfile` change,
or `node-test-tools:develop` moves (a ccc Node or pnpm bump), rebuild and re-pin **in
the same commit**:

```bash
.aidev/runtime/build.sh --push   # registry digest if aidev-<input hash> exists, else build + push
# put the printed repo@sha256:<digest> into project.yaml environment.image
```

Run a suite by hand the same way AIDEV does:

```bash
docker run --rm --network none --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD":/work -w /work <environment.image> .aidev/run-checks.sh quick lint typecheck build
```
