# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.1.0] - 2026-08-23

### Added

- Added branded `ism.config.json` icon assets derived from the official ISM monogram, with packaged dark/light variants for editor and documentation integrations.
- Added `CORE_VERSION`, a public package-version constant used by copied error diagnostics.
- Added a static DevTools isolation check that prevents the normal package entry from accidentally pulling inspector/protocol code back into the root bundle.
- Added `clean:all` for coverage/browser artifacts and expanded regression coverage for failed-then-successful recovery, production-safe disclosure, throwing hooks/fallbacks, lazy DevTools protocol installation, accessor-safe inspection, config drift, and no-op state updates.

### Changed

- Rebuilt the built-in error fallback around a compact Vercel-style neutral dark palette with a new Core error glyph, clearer hierarchy, `Error code` terminology, contextual recovery guidance, collapsed technical details, and a `Copy details` action.
- Error recovery now shows a visible `Retrying...` state, detects immediate re-failures, reports them inline, prevents duplicate attempts while retrying, and returns keyboard focus to the retry action after a failed attempt.
- DevTools now load as a real dynamic chunk and install their protocol only when the overlay mounts or a consumer explicitly calls `installDevToolsProtocol()` from the devtools subpath.
- DevTools visuals now use the same restrained neutral dark design language and purpose-built SVG controls instead of emoji glyphs.
- `ism-core init` now derives its scaffold from canonical runtime defaults, includes `stateRetentionFrames`, and references the published package schema.
- `schema.json` now uses draft 2020-12 metadata, tighter runtime-aligned constraints, clearer descriptions/examples, and is exported directly as `@ispoofermotion/core/schema.json`.
- Inspector serialization now clamps hostile/custom budgets and describes accessors without invoking getters or setters.
- Returning the exact existing value/reference from `setState` is now treated as a true no-op and avoids persistence, revision, memo-invalidation, and redraw work.
- Source packaging now prefers Git-tracked/non-ignored files, supports list-only review, blocks common secret/generated paths and oversized accidents, and avoids bundling transient coverage/Husky internals.
- Release automation now checks whether the target version already exists on npm/GitHub rather than requiring the previous commit to contain the version bump, making failed releases safely retryable.

### Fixed

- Error detail disclosure now fails closed when `process`/`NODE_ENV` is unavailable, preventing browser production builds from accidentally exposing exception messages or stacks.
- Throwing consumer `onError` handlers and custom fallback renderers can no longer replace or destroy Core's built-in last-resort error UI.
- Structured render/draw diagnostics preserve an existing `ISMError` code instead of unnecessarily flattening every caught failure to a generic render/draw code.
- DevTools inspection no longer executes user getters merely by opening the inspector.

## [4.0.0] - 2026-08-12

### Added

- TypeDoc now validates unresolved links for both the main and `devtools` entry points without writing over maintained source documentation.
- Deterministic generation-based state/memo retention with configurable `stateRetentionFrames`.
- Runtime scaling benchmarks for 500/1,000/5,000/10,000 widgets, 10k cleanup, and cached-subtree hits.
- Reviewable core/CLI/DevTools bundle-size and gzip regression budgets enforced in CI and release validation.
- Packed-artifact validation with pinned `publint` and `@arethetypeswrong/cli`, plus clean Node ESM/TypeScript, Node CJS, Vite/React 18, and Vite/React 19 consumer fixtures.
- Reproducible clean-build verification that requires byte-identical packed tarballs, plus SHA-256 metadata for release artifacts.
- Dependency-review and CodeQL security workflows, plus SPDX SBOM generation for GitHub releases.
- Stable `ISM_*` diagnostic/error codes, `ISMError`, the `onDiagnostic` sink, and `strictRuntime` invariant enforcement.
- `createApp` error hooks for `onError`, `renderErrorFallback`, and production-safe `showErrorDetails`.
- A dedicated `@ispoofermotion/core/devtools` subpath with bounded inspector serialization and a versioned read-only `Symbol.for("@ispoofermotion/core/devtools/v1")` protocol.

### Changed

- Public package metadata now bounds React/React DOM support to the tested `>=18 <20` majors and describes Tauri as a design target rather than a runtime dependency.
- The flagship quick-start examples no longer teach irreversible external mutation during the React draw phase.
- TypeDoc output moved to `.typedoc`.
- The dead Markdownlint configuration was removed; documentation verification now uses TypeDoc link validation plus a repository-local relative-link checker.
- Historical `npx ism-core init` / `bunx ism-core init` references are superseded by package-qualified invocation: `npx --package @ispoofermotion/core ism-core init` or `bunx --package @ispoofermotion/core ism-core init`.
- Historical global DevTools-hook, fixed-250ms inspector-throttle, `Runtime#registerExternalId`, and `Date.now()` GC notes describe their original releases only; the current contracts are the versioned `@ispoofermotion/core/devtools` protocol, bounded revision-based inspection, app-local/generated identity ownership, and generation-based retention.
- Frame recording now reuses double-buffered frame roots/pools without mutating the committed tree during speculative renders.
- Tree inspection fingerprints are lazy outside an active inspector, and deep runtime tree bookkeeping now uses iterative traversals.
- Removed unused per-widget `FrameEntry` fields from the hot recording path.
- Releases are version-driven and globally serialized, publish the exact validated tarball on Node 24, and authenticate to npm through OIDC instead of `NPM_TOKEN`.
- Release-note extraction now requires an exact non-empty changelog version section, and npm registry errors are distinguished from a genuine missing-version 404.
- Build post-processing now runs as an explicit deterministic step instead of a `tsup` configuration callback.
- Built-in DevTools now load lazily instead of being statically pulled into the normal core entry.
- DevTools state/tree inspection is cycle-safe and resource-bounded; this supersedes the older implementation notes about a fixed 250ms serialization throttle.
- The previously documented internal `Runtime#registerExternalId` hook is no longer part of the current runtime architecture; app-local ownership and generated DOM IDs now provide the supported identity/focus model.
- Production error fallbacks hide exception messages and stacks by default and show a stable error ID instead.

## [3.3.2] - 2026-08-08

### Fixed

- Made the error fallback panel vertically scroll within the viewport so long error messages and stack traces remain accessible instead of being clipped.

## [3.3.1] - 2026-08-02

### Fixed

- Made one-shot widget events idempotent under React StrictMode and delayed unmount cleanup so StrictMode's development remount cycle does not erase runtime state.
- Encoded every ID segment, reserved memoized subtree IDs, and resolved literal suffix collisions so structurally different widgets cannot share final IDs.
- Invalidated memo caches when contained widget state changes, assigned stable identities to repeated memo blocks, and restored scope, ID, context, layer, frame, state, and memo bookkeeping after failed captures.
- Rejected React hooks inside memoized closures, where cache hits would otherwise change hook order.
- Scoped DevTools inspection and DOM IDs to the owning runtime, made keyboard focus local to each tab list, captured the exact owning runtime for widget focus handlers, and moved snapshot retention to a weak runtime-keyed cache.
- Materialized accessibility descriptions in the DOM, rejected null-prototype and custom-prototype default state that cannot preserve its prototype through cloning, bounded cross-runtime collision warnings, and made the unused storage deletion capability optional.
- Corrected scoped ID composition and guaranteed unique final IDs, preventing state aliasing and duplicate React keys.
- Hardened memo-block cleanup, dependency snapshots, transient-state consumption, and queued render lifecycle handling.
- Validated `createApp` configuration at the runtime boundary and aligned generated configuration with `schema.json`.
- Reworked DevTools tabs for native keyboard accessibility and removed stale/global snapshot caching.
- Added build-safe publishing, retry-safe release logic, packed-package smoke validation, documentation checks, and expanded React 18/19 CI coverage.
- Replaced platform-specific cleanup commands and corrected public documentation and error rendering behavior.

### Changed

- Aligned `package.json` and `bun.lock` on TypeScript 5.8.3 and added a lock-consistency check.
- Bounded retained frame-pool capacity after large transient frames.

## [3.3.0] - 2026-07-29

### Added

- **`getFocusedId()`**: returns the currently focused widget id from within a draw pass.
- **`DEFAULT_LAYER_Z_INDEX`** and **`DEFAULT_SHOW_DEV_TOOLS`** exported from `config.ts` as the single source of truth for `IsmConfig`'s defaults, consumed by both `createApp`'s runtime fallback and the `ism-core init` CLI scaffold (and now kept in sync with `schema.json` by a regression test).
- **CLI**: `ism-core init` now supports `--help`/`-h`, `--version`/`-v`, and `--force` (overwrite an existing config), and returns proper process exit codes instead of always exiting 0. `runCli()`/`CliDeps` are now exported so the CLI itself has test coverage for the first time.
- **`makeInteractive`**: new `role`, `selected`, and `pressed` options, producing `role`, `aria-selected`, and `aria-pressed` respectively -- needed for correct `tab`/`option`/toggle-button ARIA patterns (used by DevTools' own tabs, see below).
- **`ErrorFallback`**: new optional `kind` (`"render" | "draw"`, replacing a fragile `title.includes("render")` check) and `onRetry` props; the boundary now shows a "Try again" button that resets the caught error and re-renders.
- `Runtime#registerExternalId`/`Runtime#ownsId` (internal), letting a widget register a hand-constructed sub-id (one that doesn't correspond to a separate widget instance) so `makeInteractive`'s focus/blur routing can resolve it via `getRuntimeForId`.
- Test coverage for `getRuntimeForId` (including the cross-runtime ownership and collision-warning paths), the CLI, and the `schema.json`/`config.ts` defaults-sync regression test.

### Fixed

- **Cross-runtime id ownership**: id-to-runtime ownership is now tracked per `Runtime` instance instead of in a single map shared by every mounted app. Previously, two independent `createApp()` roots that happened to produce the same composite id (e.g. same widget names, no `pushId`) would silently steal ownership from each other, breaking focus tracking for whichever app drew first in a frame. A genuine cross-app collision is now an explicit, once-per-id warning instead of a silent overwrite.
- **Persistent widgets never actually read from storage**: `defineWidget` wasn't forwarding its `persistent` flag to `runtime.getState()`, so `StorageAdapter.get()` was never consulted on a widget's first registration -- persistent widgets silently behaved as if `persistent` were always `false`. Also fixed the inverse leak: the automatic per-frame `consumeState` reset now writes through to storage for persistent widgets, so a saved value no longer silently drifts from what's actually in memory.
- **`memoBlock` cache leak**: cached subtrees for a dynamically-keyed `memoBlock` (e.g. one keyed by a list item's id) were never evicted once that key stopped appearing -- a long-lived app with a changing list leaked one cache entry per removed item. Now garbage-collected on the same TTL model as widget state.
- **Widgets inside layers (modals/tooltips) were unclickable**: `createApp` wraps non-default layers in a `pointer-events: none` container so clicks pass through empty areas, but that also disabled clicks on the actual widgets inside, since `pointer-events: none` is inherited. `.ism-widget` now explicitly opts back in.
- **DevTools focus tracking**: the Elements/State tab buttons and the close button now register their sub-ids with the owning runtime, so `makeInteractive`'s focus/blur handlers no longer silently no-op for them.
- **DevTools accessibility**: the tab/tabpanel relationship now uses proper `aria-controls`/`id`/`aria-labelledby` wiring instead of a bare text `aria-label` on the tabpanel.
- **DevTools performance**: snapshotting the live widget tree/state store now happens only for the visible tab, and is throttled to at most once per 250ms, instead of fully re-serializing everything on every host-app frame.
- **`defineWidget`**: `defaultState` is now validated with `structuredClone` at definition time, so a non-cloneable value (a nested function, class instance, DOM node, Symbol) throws immediately at the `defineWidget()` call site instead of failing confusingly the first time the widget is drawn.
- **`memoBlock`**: detects and reports when a memoized closure leaves the scope stack unbalanced (a scoped widget opened without a matching `end()`, or vice versa), instead of silently capturing an incorrect subtree.
- **Error fallback accessibility**: `ErrorFallback` now announces itself to assistive technology (`role="alert"`) and marks its decorative icon `aria-hidden`; its inline style objects are now hoisted constants instead of being reallocated on every render.
- **CLI Windows compatibility**: the entry-point check in `cli.ts` no longer breaks on Windows paths containing spaces or backslashes (now uses `pathToFileURL` for a normalized comparison instead of a raw string comparison against `import.meta.url`); also removed the unused `existsSync` dependency from `CliDeps` (the atomic `"wx"` write flag already handles the exists-check).
- Corrected README language overstating `createApp`'s capabilities (it does not perform React concurrent-mode initialization or IPC injection on your behalf) and fixed the README's flagship widget example, which was missing the required `getReturnValue` field and didn't demonstrate `widgetProps`.
- Reconciled the "stable since v1.0.0" stability claim with the `DevConsole` removal documented under `3.2.0` below; the guarantee is now correctly scoped as effective from `3.2.0` onwards.
- `WidgetProps.role`/`WidgetA11y.role` narrowed from `string` to React's `AriaRole` union, and `makeInteractive`'s `onKeyDown` handler is now typed against React's synthetic `KeyboardEvent` instead of the DOM's -- both are type-accuracy fixes, not behavior changes (see note below).

### Changed

- **License**: relicensed from proprietary to MIT.
- `package.json` gained `description`, `repository`, `bugs`, `homepage`, `keywords`, and an `engines.node >=20` constraint.
- CI now runs `test:coverage` instead of a plain test pass (enforcing the thresholds already configured in `vitest.config.ts`), and smoke-tests the built CLI under plain Node.
- The release workflow now publishes with npm provenance (`--provenance`) and verifies a `workflow_run` event actually originated from this repository (not a fork's PR) before checkout/build/publish.
- Split the Husky `pre-commit` hook (lint-staged only) from a new `pre-push` hook (full typecheck + test suite), so a slow test no longer blocks every local commit.
- Loosened `performance.test.ts`'s widget-draw timing assertion to include warm-up iterations and a median-of-several-runs measurement against a wider, still-meaningful margin, reducing CI flakiness from shared-runner timing variance.
- `defineConfig()` now throws for a non-finite `layerZIndex` or non-boolean `showDevTools` instead of silently accepting them (e.g. previously a `NaN` could reach a CSS `zIndex` property unnoticed).

**A note on the two type-level items above:** narrowing `role` to `AriaRole` and typing `onKeyDown` against React's event type are, strictly, changes to public type signatures. In practice neither changes runtime behavior, and both only affect code that was already passing an invalid ARIA role or relying on an inaccurate DOM-event type in place of the React event type it was actually receiving -- i.e., code that was already incorrect. `peerDependencies` remains `>=18.0.0` (no consumer-facing requirement changed); CI at that release exercised React 19 only; React 18 coverage is added in 3.3.1. On that basis this is released as a **minor** version rather than a major one -- see the version-bump rationale in the project's PR/release notes for the full reasoning.

## [3.2.0] - 2026-07-26

### Added

- **Configuration CLI & JSON Schema**: Introduced a dedicated configuration system via `IsmConfig` and `defineConfig`. Consumers can now manage app settings via `ism.config.json`, which can be bootstrapped instantly using the newly added CLI (`npx ism-core init`).
- **Enhanced ErrorBoundary UI**: Completely redesigned the internal error catch blocks (both React's `ISMCoreErrorBoundary` and the internal draw pass `drawError`). The new `<ErrorFallback>` component provides a polished, dark-themed diagnostic panel featuring full stack traces, file/line number extraction, and contextual troubleshooting instructions.
- **Stability Guarantee**: Added an explicit backward-compatibility and additive-only policy for public APIs.

### Changed

- Updated all internal block comments to adhere to standard `// --- ---` spacing conventions.

### Removed

- **DevConsole & Logger**: Completely removed the internal `DevConsole` widget and `logger.ts` module, as well as the Console tab from `DevTools`. Console interception is no longer handled by `@ispoofermotion/core`.

## [3.1.0] - 2026-07-25

### Added

- `layerZIndex` configuration property added to `AppOptions`, allowing consumers to specify the base z-index for non-default layers.

### Changed

- **Zero-Allocation Hot Path**: The engine's core draw loop is now strictly allocation-free.
  - `widgetProps` instances are now populated by mutating the pooled `entry.widgetProps` object instead of allocating a fresh dictionary on every widget call.
  - The React bridging `renderFn` closure in `defineWidget` is hoisted out of the hot path and only runs once on widget definition, completely eliminating per-widget closure allocation.
  - String allocations (`.join("/")`) have been removed from `buildId` and are now natively cached in the runtime via `idPrefix`.
- Enforced strict Type Safety by enabling `exactOptionalPropertyTypes` in `tsconfig.json` and adding `noExplicitAny` to Biome lint rules.

### Fixed

- **DevTools Crash**: Fixed an exception when accessing the Elements/State tabs caused by reading the active runtime during the React commit phase. (Now uses the safe `mountedRuntimes` set).
- **Runtime Leak Prevention**: Fixed a critical leak vulnerability in `withRuntime`. The draw pass is now strictly guarded by `try/finally` blocks ensuring global runtime state cleanup even when unexpected exceptions are thrown in widget code.
- **makeInteractive Bug**: `makeInteractive` no longer swallows all exceptions via bare catch blocks. Replaced with an explicit iteration over `mountedRuntimes` for out-of-band focus events.
- **memoBlock Isolation**: `memoBlock` collision/scoping issues resolved. It now correctly isolates its namespaces into `__memo__` using `buildMemoKey`, completely bypassing the ID collision counter to prevent user widget conflicts.
- Em-dashes were removed across all source files in accordance with ISpooferMotion engineering standards.

## [3.0.0] - 2026-07-04

### Changed

- **Standardized Naming (`ismlib` -> `ism`)**: Complete migration away from legacy `ismlib` naming conventions across the library.
  - DOM Data attributes updated: `data-ismlib-widget` -> `data-ism-widget`, `data-ismlib-id` -> `data-ism-id`, `data-ismlib-root` -> `data-ism-root`, `data-ismlib-error` -> `data-ism-error`, `data-ismlib-layer` -> `data-ism-layer`.
  - CSS class hooks updated: `.ismlib-widget` -> `.ism-widget`, `.ismlib-{name}` -> `.ism-{name}`.
  - Design tokens updated: `--ismlib-*` -> `--ism-*`.
  - Logging prefix updated from `[ismlib]` to `[ism]`.
  - Global DevTools discovery hook updated from `window.__ISMLIB_DEVTOOLS__` to `window.__ISM_DEVTOOLS__`.
  - Core components renamed from `ISMLib` / `ISMLibApp` to `ISMCore` / `ISMCoreApp`. Renamed `ISMLibErrorBoundary` to `ISMCoreErrorBoundary` (retaining `ISMLibErrorBoundary` as an export alias for backwards compatibility).
- **OKLCH Color System**: Upgraded default design system baseline in `styles.css` to use modern OKLCH color palettes with automatic `--background`, `--foreground`, and semantic token mappings for Light and Dark modes.

## [2.2.0] - 2026-07-03

### Changed

- **DevTools Redesign**: Replaced the basic `DevConsole` with a comprehensive, tabbed `DevTools` widget that correctly sizes itself dynamically (35vh fixed height when expanded, docked to bottom) and provides tabs for Console, Elements, and State.
- **Logger Extraction**: Extracted internal logging functions into a separate `logger.ts` module to prevent circular dependencies between the widget definitions and the core runtime.
- **Global `__ISMLIB_DEVTOOLS__` Hook**: Restored the global discovery hook to its original intent for external extension support, cleanly separating it from the internal in-app `DevTools` panel logging.

## [2.1.0] - 2026-07-02

### Added

- **DevConsole**: Added `attachDevConsole(limit?)`, `getDevLogs()`, and the `DevConsole` immediate-mode widget. Call `attachDevConsole()` once at startup to hook `console.log/warn/error` into a capped ring buffer; render `DevConsole()` anywhere in your draw function to get a floating, collapsible log panel. Zero cost in production - designed to be tree-shaken away behind `import.meta.env.DEV`.

## [2.0.0] - 2026-07-01

### Added

- **Storage Adapters**: Introduced `StorageAdapter` interface. Widgets can now be flagged with `persistent: true` to automatically restore state (e.g., from `localStorage`) across application restarts.
- **Environment Contexts**: Added `pushContext`, `popContext`, and `getContext` APIs for native immediate-mode dependency injection (similar to React Context).
- **Layering & Portals**: Added `pushLayer` and `popLayer` to render overlapping interfaces like tooltips and modals natively.
- **Scope Memoization**: Introduced `memoBlock(id, deps, drawClosure)` for aggressive CPU time reduction by deep-cloning subtrees dynamically when dependencies haven't changed.
- **Focus Management**: Integrated `FocusManager` into the runtime. `makeInteractive` now listens to focus events globally. Added `setFocus` and `isFocused`.
- **DevTools Hook**: The engine now securely mounts to `window.__ISMLIB_DEVTOOLS__`, allowing extensions to query internal layout buffers and the state store without polling.
- (7b9e80f) **Tests**: Fixed TypeScript type errors by providing missing layoutProps in test mocks.
- (b5c12c5) **Chore**: Configured package for `@ispoofermotion` organization release.

### Changed

- **Architectural Overhaul**: Removed the global `runtime` singleton. The engine now uses a React-style thread-local dispatcher pattern (`getActiveRuntime()`), supporting multiple independent `ismlib` instances on a single page.
- **Garbage Collection**: Replaced frame-count based state expiration with a robust, time-based GC using `Date.now()`.
- **Layout System**: Completely deleted absolute positional coordinate tracking (`cursorX`/`cursorY`). Layouts are now cleanly deferred to native CSS Flexbox and Grid.

### Removed

- Removed explicit layout properties (`layoutProps`) globally from the widget definitions, adopting a modern declarative DOM integration pattern.

## [1.0.0] - 2026-06-30

### Added

- Core widget factory `defineWidget` to standardize stateful React component generation.
- Virtual DOM to React runtime adapter in `runtime.ts` for IPC synchronization.
- Application mount wrapper `createApp.tsx` utilizing React 19 concurrent features.
- Global error boundary implementation tailored for Tauri error recovery.
- Automated bundler configuration using `tsup` for ESM, CJS, and DTS output generation.
- High-performance testing pipeline utilizing `vitest` and `happy-dom`.
- Initial baseline UI primitive definitions and CSS structural classes (`styles.css`).
