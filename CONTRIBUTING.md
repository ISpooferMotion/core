# Contributing to @ispoofermotion/core

Thanks for taking the time to help with the project. Keep changes focused, explain anything that is not obvious, and avoid mixing unrelated cleanup into the same pull request.

## Setup

1. Fork or clone the repository.
2. Install dependencies with `bun install`.
3. Install the browser test engines with `bunx playwright install --with-deps chromium firefox webkit`.
4. Create a branch from `main`.
5. Make your changes.
6. Run the authoritative gate before opening a pull request.

```bash
bun run check
```

Use `bun run dev` while working when you want the package to rebuild after source changes.

## Tests

Add or update tests when behavior changes. A bug fix should normally include a test that fails before the fix and passes after it.

Fast unit/integration tests live in `src/__tests__` and run through Vitest. Real-browser tests live in `tests/browser` and run through Playwright in Chromium, Firefox, and WebKit.

```bash
bun run test
bun run test:browser
```

Browser-facing behavior such as layers, pointer targeting, keyboard activation, focus, error recovery, and accessibility should include or update a Playwright regression test. Diagnostics should assert stable `ISM_*` codes rather than exact prose, and DevTools serializer changes must include adversarial cycle/budget coverage.

Use coverage when you are changing a larger part of the runtime.

```bash
bun run test:coverage
```

## Code style

Biome handles formatting and linting. Match the existing TypeScript style and keep comments focused on why something exists, not what the next line already says.

A commit hook runs Biome on staged source files. A push hook runs the fast typecheck and Vitest suite; `bun run check` is the authoritative pre-PR gate and runs core validation, the DevTools isolation guard, the real-browser suite, reproducible package validation, publint/ATTW, and clean packed-consumer fixtures. Use `bun run clean:all` when you need to remove coverage and browser-test artifacts in addition to normal build/docs output.

## Commit messages

Use a clear semantic prefix.

1. `feat:` for a new feature
2. `fix:` for a bug fix
3. `docs:` for documentation
4. `test:` for test changes
5. `chore:` for maintenance

Dependency updates use `chore(deps)`. Workflow updates use `chore(ci)`.

## Pull requests

Explain what changed, why it changed, and how you tested it. Mention any public API impact and link the related issue when one exists.

Keep generated files in sync when the source change affects them. Run `bun run build` for `dist` and `bun run docs` for the TypeDoc output.

## Respectful collaboration

Be direct without being rude. Review the code, not the person, and give enough context for someone else to understand your suggestion.

## Release preparation

A release commit must bump `package.json` and add a non-empty exact `## [x.y.z]` section to `CHANGELOG.md`. The release workflow checks the desired package version against npm and the matching GitHub release instead of relying on the immediately previous commit, so a failed version-bump run can be repaired and safely retried without another artificial version bump.

The npm package must configure `.github/workflows/release.yml` as its GitHub Actions trusted publisher. Releases use OIDC and must not use a long-lived `NPM_TOKEN`. The workflow builds one tarball, validates that exact file, emits an SPDX SBOM and SHA-256 digest, publishes only when that npm version is missing, and creates or updates the matching GitHub release as needed.

## Documentation changes

When changing a public contract:

1. update `README.md` when the normal usage path changes,
2. update `CHANGELOG.md`,
3. run `bun run docs` to build TypeDoc and validate local Markdown links,
4. run `bun run check` before pushing.

The package name and CLI executable differ. Documentation must use `bunx --package @ispoofermotion/core ism-core ...` or `npx --package @ispoofermotion/core ism-core ...` rather than relying on implicit package resolution.
