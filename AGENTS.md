# WikiBridge — Agent Onboarding

Read this first. Then jump to the doc that matches your task via [docs/agent/README.md](../docs/agent/README.md).

## 1. Project overview

WikiBridge is a Chrome MV3 extension that captures Confluence Cloud pages and republishes them to **Notion** or **local Markdown**. Built with WXT + React 19 + TypeScript. 100+ tests, all green.

Pipeline:

```
Confluence ADF → IR (src/ir/types.ts) → Notion blocks | Markdown
```

The IR is the contract. Sources produce it. Destinations consume it. Orchestrator composes them.

## 2. Non-negotiable rules

- **Tokens are local-only.** `chrome.storage.local` only. Never `chrome.storage.sync`, never logged, never sent to any host outside `*.atlassian.net` / `api.notion.com`.
- **Long captures need keepalive.** Wrap multi-second work in `chrome.alarms` keepalive (already done by `runCapture`). Don't sidestep it.
- **Best-effort error handling.** Per-asset and per-block failures collect into `PublishResult.failures[]`. Do not throw to abort a capture.
- **Commit author**: `emmaliaocode <wanyuliao4@gmail.com>`. No `Co-Authored-By`. No AI attribution. Use `git -c user.email="..." -c user.name="..." commit -m "..."` if your global git config differs.
- **Conventional commits.** `feat: / fix: / refactor: / chore: / docs: / test:` with optional scope (`feat(adf): ...`).
- **Don't disable tests.** Don't bypass pre-commit checks. If a test is wrong, fix the test in the same commit.

## 3. Essential commands

```bash
pnpm install         # install deps; runs `wxt prepare` postinstall
pnpm build           # builds .output/chrome-mv3/  (load this folder as unpacked in Chrome)
pnpm test            # vitest run (~600ms)
pnpm test:watch      # watch mode
pnpm tsc --noEmit    # type-check only
pnpm compile         # alias for tsc --noEmit
```

After every change of substance:

```bash
pnpm test && pnpm tsc --noEmit && pnpm build
```

Then **reload the extension** in `chrome://extensions` (click the reload icon on the extension card). Chrome does not auto-reload.

## 4. Project structure

```
src/
├── entrypoints/
│   ├── background.ts        ◄── service worker entry: message router, base64 transport, keepalive
│   ├── sidepanel/           ◄── React side panel (capture flow, local-file branch)
│   └── options/             ◄── React options page (token form, Test buttons)
├── ir/types.ts              ◄── intermediate representation; the contract
├── messaging/protocol.ts    ◄── typed request/response shapes
├── orchestrator/            ◄── runCapture / fetchPageOnly + keepalive
├── sources/
│   ├── source.ts            ◄── Source interface
│   └── confluence/          ◄── REST client, ADF parser, page-id detector
├── destinations/
│   ├── destination.ts       ◄── Destination interface
│   ├── notion/              ◄── REST client, file uploads, IR → Notion blocks
│   └── local/               ◄── filesystem writes, IR → Markdown
└── storage/settings.ts      ◄── chrome.storage.local wrapper

tests/                       ◄── one test file per source file, MSW for HTTP

docs/
├── agent/                   ◄── *these docs* — agent-facing architecture and features
└── superpowers/
    ├── specs/               ◄── original design spec (partially stale)
    ├── plans/               ◄── historical implementation plan
    └── qa/
        ├── smoke-checklist.md   ◄── manual end-to-end test
        └── known-issues.md      ◄── open issues with repro
```

## 5. Documentation navigation

| Task | Doc |
|------|-----|
| Set up locally for the first time | [docs/agent/quickstart.md](../docs/agent/quickstart.md) |
| Understand the layered architecture | [docs/agent/architecture/overview.md](../docs/agent/architecture/overview.md) |
| Add a new ADF node type | [docs/agent/architecture/source-confluence.md](../docs/agent/architecture/source-confluence.md) |
| Fix a Notion API quirk | [docs/agent/architecture/destination-notion.md](../docs/agent/architecture/destination-notion.md) |
| Change Markdown output | [docs/agent/architecture/destination-local.md](../docs/agent/architecture/destination-local.md) |
| Modify side-panel UI | [docs/agent/architecture/side-panel.md](../docs/agent/architecture/side-panel.md) |
| Change the message protocol | [docs/agent/architecture/messaging.md](../docs/agent/architecture/messaging.md) |
| Add an Obsidian / Joplin / etc. destination | [docs/agent/features/extending-with-new-destination.md](../docs/agent/features/extending-with-new-destination.md) |
| Write a test | [docs/agent/testing-strategy.md](../docs/agent/testing-strategy.md) |
| Commit / PR conventions | [docs/agent/workflow.md](../docs/agent/workflow.md) |
| What's in/out of scope | [docs/agent/scope-and-principles.md](../docs/agent/scope-and-principles.md) |
| MV3 manifest, permissions, quirks | [docs/agent/extension-manifest.md](../docs/agent/extension-manifest.md) |

## 6. Code patterns

### Adapter pattern

`Source` and `Destination` are the two boundaries. The orchestrator only knows about the interfaces. New adapters slot in without orchestrator changes.

### IR pipeline

```ts
// source side
const blocks: Block[] = adfToBlocks(adf, attachments);
const page: Page = { id, title, sourceUrl, capturedAt, blocks, assets };

// destination side (Notion example)
const uploadIds = new Map<string, string>();
for (const asset of page.assets) {
  uploadIds.set(asset.id, await uploadFile(token, asset.filename, asset.mimeType, await asset.fetch!()));
}
const notionBlocks = irToNotionBlocks(page.blocks, (id) => uploadIds.get(id)!);
await api.appendChildren(pageId, notionBlocks);
```

### Long-text chunking

Notion limits `rich_text[].text.content` to 2000 chars. `splitTextForNotion` chunks anywhere a `rich_text` is emitted (paragraphs, headings, code blocks, table cells). Prefer newline boundaries (good for code), fall back to space (good for prose), then hard cut.

### Hoisting blocks out of table cells

Notion forbids block-level content in table cells. The Notion converter walks each cell, replaces `attachment`/`image` blocks with italic `[filename]` rich-text references, and pushes the original blocks onto a `hoisted` accumulator. After all blocks convert, the accumulator is appended below the table under a `divider` + `## Attachments` heading.

### Best-effort failure collection

```ts
for (const asset of page.assets) {
  try {
    const bytes = await asset.fetch();
    await upload(bytes);
  } catch (err) {
    failures.push({ assetId: asset.id, reason: err.message });
    // continue
  }
}
return { ok: failures.length === 0, failures, destinationUrl };
```

## 7. Testing strategy

Three test layers (all under `pnpm test`) + manual smoke.

| Layer | Files | Run by |
|-------|-------|--------|
| Pure unit | `adf-to-ir.test.ts`, `ir-to-notion.test.ts`, `ir-to-markdown.test.ts`, `ir-types.test.ts`, `detect-page-id.test.ts`, `settings.test.ts` | Vitest |
| HTTP (MSW) | `confluence-api.test.ts`, `confluence-source.test.ts`, `notion-api.test.ts`, `notion-destination.test.ts` | Vitest + msw |
| Filesystem (FakeDir) | `local-destination.test.ts` | Vitest |
| Manual smoke | [smoke-checklist.md](../docs/superpowers/qa/smoke-checklist.md) | Real Confluence + Notion |

See [docs/agent/testing-strategy.md](../docs/agent/testing-strategy.md) for the anti-theater rule and the gates before commit.

## 8. Definition of done

A change is done when **all** of:

- `pnpm test` passes (all tests, not a subset).
- `pnpm tsc --noEmit` is clean.
- `pnpm build` succeeds without errors.
- If UI or content conversion changed: the relevant section of [smoke-checklist.md](../docs/superpowers/qa/smoke-checklist.md) is verified manually with extension reloaded.
- New code has corresponding tests in the appropriate layer.
- Architecture docs updated if a new component or pattern was introduced.

## 9. Out of scope

See [docs/agent/scope-and-principles.md](../docs/agent/scope-and-principles.md) for the full list. Highlights:

- Confluence Data Center / Server.
- Recursive or bulk capture.
- Runtime user-installable plugins.
- Hosted backend.
- Real-time sync.

## 10. Known gotchas

| Gotcha | Where | What to do |
|--------|-------|------------|
| `chrome.runtime.sendMessage` is JSON, not structured clone. `Uint8Array` becomes `{}`. | Crossing worker ↔ side panel | We encode asset bytes as base64 in the worker and decode in the side panel. See [background-service-worker.md](../docs/agent/architecture/background-service-worker.md). |
| `FileSystemWritableFileStream.write()` rejects bare `Uint8Array` with a cryptic "type" error. | Local destination | Wrap in `new Blob([bytes])`. The test `FakeDir` enforces this. |
| Service worker suspends after ~30s idle. | Long captures | `chrome.alarms` ~24s keepalive in the orchestrator. |
| Confluence v2 attachment `downloadLink` is deprecated and 404s. | `confluence-api.ts:downloadAttachment` | Use v1 path: `/wiki/rest/api/content/{pageId}/child/attachment/{id}/download`. |
| Notion: 100 blocks per `appendChildren`, 2000 chars per `rich_text.content`, no blocks in table cells, H4 max. | `ir-to-notion.ts` | Each limit has a documented workaround in [destination-notion.md](../docs/agent/architecture/destination-notion.md). |
| Side panel doesn't re-detect page on tab change in some scenarios. | `App.tsx` | Open issue logged in [known-issues.md](../docs/superpowers/qa/known-issues.md). |
| `showDirectoryPicker` requires user gesture, handle non-transferable. | Local capture | The local-file branch runs in the side panel, not the worker. See [capture-to-local.md](../docs/agent/features/capture-to-local.md). |
