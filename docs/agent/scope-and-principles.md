# Scope and Principles

Canonical statement of what WikiBridge is and is not. Reference this when proposing changes.

## In scope

- Source: **Confluence Cloud** pages, fetched as ADF (Atlassian Document Format) via REST v2.
- Destinations: **Notion** (via API) and **local Markdown folder** (via File System Access API).
- UI: Chrome MV3 side panel + options page.
- One page per capture (the currently-active tab).
- Best-effort content fidelity: headings, marks, links, lists, code, callouts, tables, images, attachments, expand/toggle, color, background highlight, dates.

## Out of scope (v1)

- Confluence Data Center / Server. We do not support self-hosted Atlassian.
- Recursive subtree capture or bulk capture. One page at a time.
- Runtime user-installable plugins. Adapters are code-level extension points only.
- Hosted backend. All work happens in the extension; tokens never leave the user's machine.
- Browsers other than Chrome (Firefox build target exists in `package.json` but is untested).
- Real-time sync. Capture is a one-shot snapshot, not a live mirror.

## Mandatory constraints

### Token handling

- Tokens live only in `chrome.storage.local`. Never `chrome.storage.sync`, never logged, never transmitted to any host outside `*.atlassian.net` and `api.notion.com`.
- No telemetry of any kind in v1.

### MV3 service worker

- Long-running operations (capture) must be wrapped in `chrome.alarms`-based keepalive.
- Asset bytes must round-trip the side-panel boundary as base64 — typed arrays do not survive `chrome.runtime.sendMessage`.
- All MV3 quirks and the workarounds we apply are documented in [extension-manifest.md](extension-manifest.md).

### Manifest

- Do not edit `wxt.config.ts` manifest fields without verifying the generated `.output/chrome-mv3/manifest.json` afterward. `pnpm build` writes the real manifest; spot-check it.
- Permissions are intentionally minimal: `storage`, `sidePanel`, `alarms`, `activeTab`. Adding a permission requires justification in the commit message.
- `host_permissions` are scoped: `https://*.atlassian.net/*`, `https://api.notion.com/*`. Adding a host requires justification.

### IR is the contract

- New content types are added in [`src/ir/types.ts`](../../src/ir/types.ts) and flow through ADF parser → Notion / Markdown converters. Never add a content type to one converter only.
- Discriminated unions, no escape hatches (`[key: string]: unknown` not allowed on `Block` or `Inline`).

### Error handling

- Best-effort. A single failed asset upload, a single failed block append, or a single malformed ADF node must not abort the entire capture.
- Collect failures into `PublishResult.failures[]` with `{ assetId?, blockIndex?, reason }`.
- Surface failures to the user via the side panel's expandable summary.

## Forbidden

- Synchronous `XMLHttpRequest` or any other blocking I/O.
- Storing tokens in `localStorage` (web context) or any persistent state outside `chrome.storage.local`.
- Adding analytics, crash reporting, or any third-party SDK that phones home.
- Disabling tests to make a commit pass.
- Hardcoding a Confluence or Notion API key in source.
- Editing `.output/` directly (it's a build artifact).

## Out-of-scope but considered

When proposing one of these, link this section in the PR and discuss before implementing:

- New destination adapters (Obsidian, Joplin, Bear): code-level. Follow [features/extending-with-new-destination.md](features/extending-with-new-destination.md).
- Subtree capture: would require changing the orchestrator's input from `pageId` to `pageId[]` plus dedupe logic on the destination side.
- History view in the side panel: planned as v1.1 in the original spec. Not implemented.
- OAuth instead of API tokens: requires registering an Atlassian app. Deferred.
