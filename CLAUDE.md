# CLAUDE.md - healthchecker-component

## Project Overview

A reusable React component library for monitoring Hive API endpoint health. Integrates with `@hiveio/wax` to:
- Monitor and score multiple API providers/nodes
- Display health status, latency, and validation errors
- Allow users to add/remove custom API providers
- Automatically switch to the best performing provider
- Persist provider preferences in localStorage

Published as `@hiveio/healthchecker-component` to GitLab package registry and npm.js.

## Tech Stack

- **Language:** TypeScript 5.9 (ccc `typescript-toolset`, strict mode)
- **Framework:** React 18.2+ or 19 (peer dependency; never bundled, `vite.config.ts` externalises every peer subpath such as `react/jsx-runtime`)
- **Build:** Vite 5.2.0 (library mode, ES modules only)
- **Styling:** Tailwind CSS 4 (ccc `tailwind-toolset`), shadcn/ui components, Radix UI primitives
- **Icons:** Lucide React
- **Core Dependency:** @hiveio/wax (health checking library)
- **Package Manager:** pnpm 10.13.1+

## Directory Structure

```
src/
├── index.ts                     # Main entry, exports public API
├── engine.ts                    # `/engine` subpath: the API-set engine without React (servers, SSR)
├── apisets/                     # Headless API-set engine (no React, no window)
│   ├── ApiSetEngine.ts          # Per-set eligibility, defaults, rankings, user choice
│   ├── defaults.ts              # Pure, deterministic default-node choice (preference, stickiness, groups)
│   ├── probes.ts                # Capability probes: JSON-RPC namespace/method, REST path
│   ├── transport.ts             # ApiTransport (fetch by default), TransportError, isApiNotFound
│   ├── nodeUrl.ts               # Node URL normalisation (scheme/host case, trailing slash)
│   ├── selection.ts             # Cookie-safe serialize/parse of the user's choices
│   ├── snapshot.ts              # Validating reader of an engine's health snapshot (SSR → browser)
│   ├── storage.ts               # SelectionStorage adapters (memory, localStorage)
│   ├── stats.ts                 # Rolling latency/outcome samples
│   └── types.ts                 # ApiSet, NodeRanking, options and events
└── components/healthchecker/
    ├── healthchecker.tsx        # Main component (~300 lines)
    ├── HealthCheckerService.ts  # Service class, state management (~290 lines)
    ├── ProviderCard.tsx         # Individual provider display
    ├── ProviderAddition.tsx     # Add custom provider form
    ├── ValidationErrorDialog.tsx # Error detail modal
    ├── ConfirmationSwitchDialog.tsx # Provider switch confirmation
    ├── ApiSetsComponent.tsx     # Renders an ApiSetEngine, one tab per API set
    ├── ApiSetNodeCard.tsx       # One node of a set's ranking
    ├── utils.ts                 # cn() classname utility
    ├── index.ts                 # Component exports
    └── shad/                    # shadcn/ui implementations
        ├── button.tsx
        ├── card.tsx
        ├── dialog.tsx
        ├── badge.tsx
        ├── input.tsx
        └── toggle.tsx
```

## Working in an AIDEV workflow
When AIDEV runs you on an issue, no one is there to answer questions. GitLab CI doesn't run for AIDEV branches; the checks below are the verification.

- **Check your change:** run `aidev test run --slot quick` once, after your last edit. It runs ESLint (`--max-warnings 0`), `tsc --noEmit` and the library build (`tsc && vite build`), and checks that the files package.json `exports`/`types` name exist in `dist/`.
- **Iterate:** `.aidev/run-checks.sh dev lint` (or `typecheck` / `build`) runs one step.
- **Consumers:** hive/denser (blog and wallet, Next.js 16 / React 19) uses this package through its pnpm catalog. Keep the public API (`src/index.ts`) compatible, or say in the issue what consumers must change.
- **Dependencies:** a change to `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `.npmrc`, or a new ccc `node-test-tools:develop` (Node/pnpm bump), needs a new test image. Run `.aidev/runtime/build.sh --push` and put the printed reference in `.aidev/project.yaml` `environment.image` in the same commit (see `.aidev/README.md`).

## Development Commands

```bash
pnpm install         # Install dependencies
pnpm dev             # Start Vite dev server with HMR
pnpm build           # TypeScript check + Vite library build (outputs to dist/)
pnpm lint            # Run ESLint (max-warnings 0)
pnpm test            # Engine (Node) and render tests (tests/) under React 18 and 19
pnpm preview         # Preview production build
```

**Build Output:** `dist/healthchecker-component.es.js` + `dist/index.d.ts`; the `/engine` subpath is `dist/engine.es.js` + `dist/engine.d.ts` (`.aidev/check-engine-entry.mjs` checks it imports in Node without React)

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main entry point, public API exports |
| `src/components/healthchecker/healthchecker.tsx` | Main React component |
| `src/components/healthchecker/HealthCheckerService.ts` | EventTarget-based service class |
| `vite.config.ts` | Library build config (ESM only, externals) |
| `tsconfig.json` | TypeScript strict mode config |
| `pnpm-workspace.yaml` | Test workspace packages + ccc's catalogs (merged from `npm-common-config`) |
| `.npmrc` | GitLab package registry for @hiveio scope |

## Coding Conventions

**Architecture:**
- `HealthCheckerComponent` - React FC managing UI state, subscribes to service events
- `HealthCheckerService` - EventTarget-based class, manages health checker, emits state changes
- `ApiSetEngine` - framework-free EventTarget: per API set, which nodes serve it (probe), the default node (operator preference, then latency, stickiness, soft groups, freshness), rankings and the user's choice. Must not touch `window` at import or construction (storage goes through a `SelectionStorage` adapter); tests in `tests/apiSetEngine.test.ts` run it under Node. `ApiSetsComponent` renders one. See README "API sets".

**TypeScript:**
- Interface-based props (`HealthCheckerComponentProps`, etc.)
- Strict null checking, no unused variables/parameters
- Type exports for consumers: `ApiChecker`, `HealthCheckerFields`, `ValidationErrorDetails`

**React:**
- Functional components with React.FC<Props>
- Event-driven state via custom events on service class
- React.forwardRef for shadcn wrappers

**Styling:**
- `cn()` utility (clsx + tailwind-merge) for conditional classes
- class-variance-authority for component variants
- Dark mode support (dark: prefix)

**State:**
- Service extends EventTarget, emits `stateChange-${serviceKey}` events
- localStorage persistence with key `localProviders-${serviceKey}`
- Immutable updates using structuredClone() for Maps

## CI/CD Notes

**GitLab CI** (`.gitlab-ci.yml`):

| Stage | Job | Purpose |
|-------|-----|---------|
| .pre | lint | ESLint check |
| build | build | TypeScript + Vite build, generate version from git |
| deploy | deploy_dev_package | Publish to GitLab registry |
| deploy | deploy_production_public_npm | Publish to npm.js (production) |

**Key Details:**
- Inherits templates from `hive/common-ci-configuration`
- Auto-generates version from git tags/commits
- Dual deployment: GitLab registry (dev) + npm.js (production)
- Runner: `public-runner-docker`
- Artifacts: `dist/`, `package.json` (1 week retention)

**Protected Branches:** `master` (requires MR)
