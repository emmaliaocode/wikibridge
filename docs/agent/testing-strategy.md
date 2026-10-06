# Testing Strategy

Four layers, fast at the bottom, slow at the top. All four must be green before declaring a change done.

## Layer 1 — Pure unit tests

Vitest, Node environment. Cover pure transformer functions:

| Test file | What it covers |
|-----------|----------------|
| `tests/ir-types.test.ts` | IR type round-trip; ensures discriminated union compiles. |
| `tests/adf-to-ir.test.ts` | ADF → IR for every supported node type, plus edge cases (mediaInline, date, expand, color marks). |
| `tests/ir-to-notion.test.ts` | IR → Notion blocks for every block type. Includes hoisting, chunking, disambiguation. |
| `tests/ir-to-markdown.test.ts` | IR → Markdown rendering. |
| `tests/detect-page-id.test.ts` | URL parsing for active-tab detection. |

Run: `pnpm test`. These finish in ~600ms total.

## Layer 2 — HTTP integration via MSW

Same Vitest run. Mock Service Worker stubs Confluence and Notion REST.

| Test file | What it covers |
|-----------|----------------|
| `tests/confluence-api.test.ts` | `getPage`, `listAttachments`, `downloadAttachment` against fake Confluence Cloud. |
| `tests/confluence-source.test.ts` | End-to-end ADF fetch + asset list build into a `Page`. |
| `tests/notion-api.test.ts` | `createPage`, `appendChildren` chunking. |
| `tests/notion-destination.test.ts` | Full pipeline: page create → upload → append. |

## Layer 3 — Filesystem fake

| Test file | What it covers |
|-----------|----------------|
| `tests/local-destination.test.ts` | Uses `FakeDir` shape-compatible with `FileSystemDirectoryHandle`. Verifies folder layout, README contents, image and attachment file placement. |

`FakeDir.write` only accepts `Blob` (mirrors real Chrome behavior). If you regress to writing bare `Uint8Array`, this test catches it.

## Layer 4 — Manual smoke test

Real Confluence page, real Notion workspace. See [`docs/superpowers/qa/smoke-checklist.md`](../superpowers/qa/smoke-checklist.md). Run after any change that touches:

- UI (side panel or options).
- Content conversion (ADF parser or either IR-to-X renderer).
- Service worker messaging.
- Manifest.

## Anti-theater rules

- A passing test must fail when its target code path breaks. If a test passes because it never reaches the assertion, fix it.
- No mocked-out behavior masquerading as real coverage. Notion API tests use MSW; do not stub the converter under test itself.
- When fixing a bug, write the failing test first, watch it fail, then fix.

## Gates before commit

```bash
pnpm test          # all layers 1-3, must pass 100%
pnpm tsc --noEmit  # must be clean
pnpm build         # must produce .output/chrome-mv3/ without errors
```

For UI / content changes, run the relevant section of the smoke checklist manually and link the result in the PR description.

## When tests are not appropriate

The service worker entry (`src/entrypoints/background.ts`) and React components (`src/entrypoints/*/App.tsx`) have no unit tests. They are integration-tested via Layer 4. Adding unit tests for them would require a heavy Chrome-runtime mock with little payoff. Don't.
