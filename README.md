An immediate-mode UI runtime for React, designed with Tauri applications in mind. It does not depend on Tauri, create IPC bindings, or manage native application state for you.

The current hardened line supports React 18 and React 19, Node 22 and Node 24, and browser behavior verified in Chromium, Firefox, and WebKit.

## Install

```bash
bun add @ispoofermotion/core react react-dom
```

Import the structural stylesheet once near your application entry point.

```ts
import "@ispoofermotion/core/styles.css";
```

## Quick start

Keep state changes inside widget event handlers or another commit-safe state source. The draw function should describe the current frame rather than perform irreversible external mutations.

```tsx
import { createApp, defineWidget } from "@ispoofermotion/core";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const Counter = defineWidget<number, [label: string], void>({
  name: "Counter",
  defaultState: 0,
  a11y: {
    role: "button",
    label: ([label]) => label,
  },
  render: ({ state, args, setState, widgetProps }) =>
    createElement(
      "button",
      {
        type: "button",
        ...widgetProps,
        onClick: () => setState((value) => value + 1),
      },
      `${args[0]}: ${state}`,
    ),
  getReturnValue: () => undefined,
});

function draw() {
  Counter("Count");
}

const App = createApp(draw);
const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root element");
}

createRoot(container).render(createElement(App));
```

`createApp` returns a React component with app-local control methods such as `App.markDirty()`, `App.setFocus()`, and persistence reset helpers.

## Transactional rendering

Every draw is speculative until React commits it. Runtime state, one-shot consumption, memo ownership, and persistence mutations are rolled back when a frame is abandoned or fails.

That guarantee applies to state owned by `@ispoofermotion/core`. It cannot undo arbitrary external I/O or mutations that user code performs directly inside `draw()`. Avoid network requests, file writes, global mutations, analytics events, and similar irreversible work during the draw pass.

## Widget identity

Logical identity is separate from DOM identity. Widget names must match:

```text
^[A-Za-z][A-Za-z0-9_-]*$
```

Use `withId` when repeated widgets could otherwise produce the same logical ID.

```ts
for (const user of users) {
  withId(user.id, () => {
    UserRow(user.name);
  });
}
```

Enable `strictIds: true` in development so duplicate logical IDs fail instead of receiving compatibility suffixes.

Do not parse or persist generated DOM IDs. They are an implementation detail and use a separate compact encoding.

## Scoped widgets and stack-safe helpers

Scoped widgets stay open until `end()`.

```ts
Panel("Settings");
Text("Account");
end();
```

Prefer the closure-based helpers when possible because they restore their stacks with `try/finally`:

```ts
withId("account", () => {
  withContext("theme", theme, () => {
    withLayer("modal", () => {
      Dialog("Account");
    });
  });
});
```

The manual `pushId`/`popId`, `pushContext`/`popContext`, and `pushLayer`/`popLayer` APIs remain available for compatibility.

## External state

When an external event changes state outside the widget runtime, use the app-local handle to redraw only the owning app.

```ts
let connected = false;

function draw() {
  Status(connected ? "Connected" : "Disconnected");
}

const App = createApp(draw);

const stop = listen("connection_changed", (event) => {
  connected = event.payload;
  App.markDirty();
});
```

External event handlers run outside React rendering, so this is different from mutating external state inside `draw()`.

The app handle also exposes:

- `App.setFocus(id)`
- `App.isFocused(id)`
- `App.getFocusedId()`
- `App.resetState(id)`
- `App.clearPersistentState()`
- `App.clearStorageNamespace()`

Global dirty/focus helpers remain compatibility conveniences, but app-local methods are preferred for multi-root applications.

## Persistent widget state

Persistence uses a synchronous adapter plus a required stable application namespace.

```ts
const memory = new Map<string, unknown>();

const App = createApp(draw, {
  storageNamespace: "settings-window",
  storage: {
    has: (key) => memory.has(key),
    get: (key) => memory.get(key),
    set: (key, value) => memory.set(key, value),
    delete: (key) => memory.delete(key),
    keys: () => memory.keys(),
  },
  onStorageError: ({ operation, key, error }) => {
    console.error("Persistence failure", { operation, key, error });
  },
});
```

A widget opts in with `persistent: true`. `has()` is separate from `get()`, so stored `null` and `undefined` remain distinguishable from a missing key.

Persistent state can also define `storageVersion`, `validateStoredState`, `migrateStoredState`, `serialize`, and `deserialize` hooks.

Storage writes are deferred until frame commit. Async adapters are not supported because persistent state is read while widgets are registered.

## Layers

Named layers render through a real layer host.

- `layerMode: "root"` uses absolute positioning relative to the app layer host.
- `layerMode: "viewport"` uses fixed positioning relative to the viewport.
- Nondefault layers use `layerZIndex`.
- Empty named-layer space uses `pointer-events: none`, while widget roots restore interaction inline.

```ts
const App = createApp(draw, {
  layerMode: "root",
  layerZIndex: 200,
});
```

Use `withLayer` to route a subtree safely.

```ts
withLayer("modal", () => {
  Dialog("Delete account");
});
```

## Accessibility and interaction

Prefer native controls whenever possible.

```tsx
createElement("button", {
  type: "button",
  onClick: onActivate,
});
```

`makeInteractive` is only for custom controls that need button-like keyboard behavior, such as a `div` with `role="button"`.

```tsx
createElement(
  "div",
  {
    ...widgetProps,
    ...makeInteractive(onActivate, { id, role: "button" }),
  },
  "Open",
);
```

Do not spread `makeInteractive` onto native `button`, `input`, `select`, or `textarea` elements.

## Memoization

`memoBlock` reuses a recorded widget subtree while its dependency values remain equal.

```ts
memoBlock("user-list", [users], () => {
  for (const user of users) {
    withId(user.id, () => UserRow(user.name));
  }
});
```

Do not call `useReactContext` inside a `memoBlock`. A cache hit skips the closure and would change React hook order.

Memo and state retention use committed frame generations, not wall-clock timers. `stateRetentionFrames` controls how many missing committed frames are retained before cleanup.

Widget state should be treated as immutable. Returning the exact current value/reference from `setState` is a no-op and intentionally skips persistence, inspection revision changes, memo invalidation, and redraw scheduling.

## Configuration

```ts
const App = createApp(draw, {
  layerZIndex: 200,
  layerMode: "root",
  strictIds: true,
  strictRuntime: true,
  stateRetentionFrames: 1,
  showDevTools: false,
  storage,
  storageNamespace: "main-window",
});
```

Key defaults:

- `layerZIndex`: `100`
- `layerMode`: `"root"`
- `strictIds`: `false`
- `strictRuntime`: `false`
- `stateRetentionFrames`: `1`
- `showDevTools`: `false`

`strictRuntime` turns unbalanced scope, ID, context, and layer operations into coded frame-aborting errors. It is recommended for development and tests.

`showDevTools` lazy-loads the built-in inspector so normal core consumers do not statically include the inspector implementation or install the DevTools protocol until the overlay is actually mounted.

The package exports its JSON Schema at `@ispoofermotion/core/schema.json`. The `ism-core init` scaffold references the matching published schema and is generated from the same canonical public defaults used by the runtime.

### Config file icon

Core ships the official ISM monogram as config-file assets:

- `@ispoofermotion/core/assets/ism-config.png` for a self-contained dark tile
- `@ispoofermotion/core/assets/ism-config-dark.png` for dark editor surfaces
- `@ispoofermotion/core/assets/ism-config-light.png` for light editor surfaces

These assets are intended for `ism.config.json` integrations, docs, and file-icon themes. Core does not force an editor-wide icon theme or change the JSON language mode just to brand one filename; editors remain in control of Explorer/file icons.

## Diagnostics and errors

Runtime diagnostics use stable `ISM_*` codes.

```ts
const App = createApp(draw, {
  strictRuntime: true,
  onDiagnostic: (diagnostic) => {
    reportDiagnostic(diagnostic.code, diagnostic);
  },
  onError: (error, info) => {
    reportError(error, info);
  },
});
```

Thrown runtime errors with a stable identity use `ISMError`. Prefer `error.code` over exact message matching.

The built-in fallback uses a compact Vercel-style neutral dark surface with a restrained error accent. Retry actions visibly enter a `Retrying...` state, report an immediate re-failure instead of appearing unresponsive, and restore keyboard focus to **Try again** when recovery fails. **Copy details** copies the stable Core version/code/source and includes messages or stacks only when detailed disclosure is enabled. Technical details stay collapsed by default.

Exception messages, stacks, and component stacks fail closed by default unless Core can positively identify a non-production Node-style environment. Set `showErrorDetails: true` only when exposing those details is appropriate. A throwing consumer `onError` hook or `renderErrorFallback` cannot destroy Core's built-in last-resort fallback.

## DevTools

Set `showDevTools: true` to lazy-load the built-in overlay.

Advanced inspector APIs use the dedicated subpath:

```ts
import {
  DEVTOOLS_PROTOCOL_SYMBOL,
  installDevToolsProtocol,
  serializeInspectorState,
} from "@ispoofermotion/core/devtools";

const protocol = installDevToolsProtocol();
console.log(protocol.listRuntimes());
```

The v1 protocol uses `Symbol.for("@ispoofermotion/core/devtools/v1")` and returns bounded serialized snapshots rather than live `Runtime` objects. Importing the normal package root does not install this protocol. `createApp({ showDevTools: true })` installs it when the lazily loaded overlay mounts, while direct users of the `devtools` subpath can install it explicitly. Inspector serialization does not invoke object getters.

## CLI

The npm package name and executable name are different, so specify the package explicitly.

Create `ism.config.json` with Bun:

```bash
bunx --package @ispoofermotion/core ism-core init
```

Or with npm:

```bash
npx --package @ispoofermotion/core ism-core init
```

Use `--force` to replace an existing file. The scaffold includes every public runtime config key, including `stateRetentionFrames`, and points at the published JSON Schema. The runtime does not automatically load `ism.config.json`; import it through your application tooling and pass its values to `createApp`.

## Support matrix

| Surface | Supported / verified |
| --- | --- |
| React | 18 and 19 |
| `react-dom` | 18 and 19 |
| Node.js | 22 compatibility, 24 primary/release |
| Bun | 1.3.14 for repository tooling |
| Browsers | Chromium, Firefox, WebKit through the pinned Playwright suite |
| Tauri | Designed for Tauri-hosted React apps; no Tauri API/IPC dependency |
| Operating systems in CI | Ubuntu and Windows |

The package intentionally does not claim compatibility with untested future React majors.

## Development

Install dependencies and browser engines:

```bash
bun install
bunx playwright install --with-deps chromium firefox webkit
```

Run the authoritative verification gate:

```bash
bun run check
```

Useful commands:

- `bun run check:core` runs lock verification, lint, TypeScript, the DevTools isolation guard, Vitest coverage, build, size checks, and documentation checks.
- `bun run test:browser` runs Playwright in Chromium, Firefox, and WebKit with axe accessibility checks.
- `bun run benchmark:runtime` runs the scalable runtime benchmark suite.
- `bun run package:check` verifies reproducibility, package metadata/types, clean consumer fixtures, and the exact tarball.
- `bun run docs` generates TypeDoc output and validates local documentation links.
- `bun run clean` removes normal build/docs output; `bun run clean:all` also removes coverage and browser-test artifacts.

## License

This project uses the MIT License. See [LICENSE](./LICENSE).
