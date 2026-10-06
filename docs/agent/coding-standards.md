# Coding Standards

## TypeScript

- Strict mode is on (extended from `.wxt/tsconfig.json`). Do not weaken it.
- Path alias `@/*` resolves to `./src/*`. Always use it for imports — never `../../../`.
- `any` is allowed only at isolated external-JSON boundaries (ADF input, Notion API response shapes). Cast at the boundary, narrow into typed structures immediately. Do not let `any` propagate.
- Prefer discriminated unions over class hierarchies for content types (see `Block` in [`src/ir/types.ts`](../../src/ir/types.ts)).
- Avoid `enum`. Use string-literal unions (`type Foo = "a" | "b"`).
- Function signatures over interface contracts when defining one-shot callbacks (e.g. `AssetResolver`).

## React

- React 19, functional components only. No class components.
- Hooks at top of component; no conditional hooks.
- Inline styles are acceptable for the side panel and options page — the UI surface is small and there is no design-system constraint. Do not introduce a CSS framework.

## File layout

- Source under `src/`. Tests under `tests/`. One test file per source file when possible.
- Source-specific code lives in `src/sources/<source>/`, destination code in `src/destinations/<destination>/`.
- Entry points live under `src/entrypoints/` (WXT convention with `srcDir: "src"`).

## Comments

- Document **why**, not what. Function signatures already say what.
- Document the non-obvious: API quirks, off-by-one workarounds, Chrome bugs we work around.
- Do not write changelog-style comments in code. Use git history for that.

## Errors

- Throw `Error` with a descriptive message for unexpected conditions.
- Catch at the orchestrator boundary (`runCapture`, `publish`) and collect into `failures[]` — see [scope-and-principles.md](scope-and-principles.md) on best-effort error handling.
- Never swallow an error silently. Either rethrow, push to `failures`, or log via `ctx.onProgress`.

## Imports order

1. External packages (`react`, `wxt`, `vitest`)
2. `@/...` internal modules
3. Relative imports (`./foo`)

WXT's default ESLint config enforces this if applied — but the project does not currently enforce a linter beyond `tsc --noEmit`.

## Tests

- Vitest. `import { describe, expect, it } from "vitest"`.
- Tests are co-located by feature under `tests/<name>.test.ts`, not nested.
- HTTP tested via MSW (`import { http, HttpResponse } from "msw"; import { setupServer } from "msw/node"`).
- See [testing-strategy.md](testing-strategy.md) for layering.

## No external runtime dependencies beyond what's installed

The only runtime deps are `react` and `react-dom`. Adding any other runtime dep needs explicit justification (size, security, scope creep).
