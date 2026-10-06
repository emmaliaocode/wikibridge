# WikiBridge — Design Spec

**Date:** 2026-05-21
**Status:** Approved (brainstorming)

## Overview

WikiBridge is a Chrome extension that captures a Confluence Cloud page and republishes it to one of several destinations — Notion (v1), local Markdown folder (v1), or a future adapter — while preserving heading hierarchy, inline styling (bold, italic, underline, strikethrough, hyperlinks, inline code), code blocks with language, tables, callouts, images, and non-image attachments.

The user works in Chrome's side panel: confirms the current page, picks a destination, hits Capture. Tokens live in `chrome.storage.local`. All conversion runs in the extension's MV3 service worker; no backend.

## Goals

- One-click capture of the currently-open Confluence Cloud page.
- High fidelity for headings, inline marks, links, lists, code blocks, callouts, tables, images, and attachments.
- Two destinations in v1: Notion and local Markdown folder.
- Clean adapter interface so a third destination (e.g., Obsidian, Joplin) requires only a new adapter, not a refactor.
- Tokens stored locally per machine. No cloud backend.

## Non-Goals (v1)

- Confluence Server / Data Center support.
- Recursive capture of a page subtree.
- Background or bulk capture.
- A runtime plugin system. The adapter interface is a code-level extension point, not a user-installable one.
- A hosted backend.

## Tech Stack

- **WXT** — Chrome extension framework (MV3, dev HMR, build, manifest generation). Project is laid out as a WXT app (`entrypoints/` for background, side panel, options).
- **React 18** — UI for the side panel and options page.
- **TypeScript** — strict mode throughout.
- **Vitest** — pure-function and adapter tests (Vite-native, integrates with WXT's Vite pipeline).
- **MSW (Mock Service Worker)** — HTTP fixtures for Confluence / Notion adapter tests.

The module layout in the "File / Module Layout" section below maps onto WXT's entrypoint conventions (`entrypoints/background.ts`, `entrypoints/sidepanel/`, `entrypoints/options/`); shared code lives under `src/`.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Chrome Extension (MV3)                                          │
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐  │
│  │   Side Panel     │ <-msg-> │  Service Worker (background) │  │
│  │   (React UI)     │         │                              │  │
│  │ - Capture button │         │  ┌────────────────────────┐  │  │
│  │ - Destination    │         │  │ Orchestrator           │  │  │
│  │ - Progress       │         │  │  Source -> IR ->       │  │  │
│  │ - Settings link  │         │  │  Destination           │  │  │
│  └──────────────────┘         │  └────────────────────────┘  │  │
│                               │                              │  │
│  ┌──────────────────┐         │  ┌────────────────────────┐  │  │
│  │  Options page    │ ──>     │  │ chrome.storage.local   │  │  │
│  │  (tokens form)   │         │  │  atlassian / notion /  │  │  │
│  └──────────────────┘         │  │  defaults              │  │  │
│                               │  └────────────────────────┘  │  │
│                               └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
        │                            │                    │
        ▼                            ▼                    ▼
  Confluence Cloud REST       Notion API (v1)     File System Access API
   GET /wiki/api/v2/pages/{id}  POST /v1/pages       showDirectoryPicker()
   GET .../attachments          POST /v1/file_uploads
                                PATCH /v1/blocks/{id}/children
```

Three layers with clean interfaces:

1. **UI layer** — side panel + options page. Renders state, sends user intent to the service worker. No business logic.
2. **Orchestrator** (service worker) — runs the pipeline `source.fetch` then `destination.publish`. Knows only the intermediate representation (IR).
3. **Adapters** — `ConfluenceSource` produces IR; `NotionDestination` and `LocalDestination` consume IR.

## Intermediate Representation (IR)

The contract between source and destinations. Every captured page becomes one `Page` object.

```ts
type Page = {
  id: string;                // Confluence page ID
  title: string;
  sourceUrl: string;         // back-link to original
  capturedAt: string;        // ISO timestamp
  blocks: Block[];
  assets: Asset[];
}

type Block =
  | { type: "heading"; level: 1|2|3|4|5|6; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Block[][] }
  | { type: "code"; language?: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "callout"; variant: "info"|"note"|"warning"|"success"; blocks: Block[] }
  | { type: "table"; rows: Block[][][] }   // rows × cells × blocks
  | { type: "image"; assetId: string; alt?: string; caption?: string }
  | { type: "attachment"; assetId: string; filename: string }
  | { type: "divider" }

type Inline =
  | { type: "text"; text: string; marks?: Mark[] }
  | { type: "link"; href: string; inlines: Inline[] }

type Mark = "bold" | "italic" | "underline" | "strike" | "code"

type Asset = {
  id: string;                  // stable id, referenced by blocks
  filename: string;
  mimeType: string;
  bytes?: Uint8Array;          // either eager bytes...
  fetch?: () => Promise<Uint8Array>;  // ...or a lazy fetcher
}
```

Notes:

- Hyperlinks are an inline type, not a mark, so `href` is first-class.
- Blocks reference assets by `assetId`, not URL. The local adapter resolves to a relative path; the Notion adapter resolves to a Notion file-upload ID.
- Asset fetchers are lazy. We don't download all images up front — destinations pull bytes during their publish step.
- The IR is intentionally close to common block models (Notion blocks, ProseMirror, Markdown AST). Confluence-specific macros we don't recognize degrade to a paragraph with the text content and a logged warning.

## Capture Pipeline

```
User clicks "Capture" in side panel
  │
  ▼
Orchestrator.run(pageId, destination)
  │
  ├── 1. ConfluenceSource.fetch(pageId)
  │       GET /wiki/api/v2/pages/{id}?body-format=atlas_doc_format
  │       GET /wiki/api/v2/pages/{id}/attachments
  │       returns Page IR (assets have lazy fetchers)
  │
  ├── 2. destination.publish(page, { onProgress })
  │       returns { ok, failures[], destinationUrl? }
  │
  └── 3. Side panel renders the summary
```

### ConfluenceSource

- Auth: HTTP Basic with the user's email + Atlassian API token.
- Body format: ADF (`atlas_doc_format`). Structured JSON, much cleaner than storage HTML.
- Walks the ADF tree, mapping each node type to an IR block. Unknown node types degrade to a paragraph plus a warning.
- Attachments are listed via the attachments endpoint and become `Asset` objects with a `fetch()` that hits `/wiki/api/v2/attachments/{id}/download`.
- Image references inside the ADF resolve to an `assetId` by matching the ADF `media` node's file ID against the attachment list.

### Destination interface

```ts
interface Destination {
  publish(
    page: Page,
    ctx: { onProgress: (msg: string) => void }
  ): Promise<{
    ok: boolean;
    failures: Failure[];
    destinationUrl?: string;
  }>
}

type Failure = { blockIndex?: number; assetId?: string; reason: string }
```

### NotionDestination

1. Create empty page under the user-chosen parent (`POST /v1/pages`).
2. For each image asset: call `asset.fetch()`, then `POST /v1/file_uploads` (multipart), then record the mapping `assetId -> fileUploadId`.
3. Convert IR blocks to Notion block JSON, resolving asset references. Append in chunks of 100 (Notion's per-call limit) via `PATCH /v1/blocks/{pageId}/children`.
4. Non-image attachments become Notion `file` blocks via the same upload flow.
5. Best-effort: a failed block or asset is collected into `failures[]` and the rest proceeds.

### LocalDestination

1. `showDirectoryPicker()` to get a `FileSystemDirectoryHandle`. (User picks per capture — explicit consent each time.)
2. Create a subfolder named `<slug(title)>-<YYYYMMDD-HHmm>` to avoid collisions.
3. Create `images/` and `attachments/` subdirs.
4. For each asset: call `asset.fetch()`, then write to the appropriate subdir as `<asset.filename>`.
5. Render IR blocks to Markdown. Image refs become `![alt](images/<filename>)`; attachments become `[<filename>](attachments/<filename>)`.
6. Write `README.md` at the folder root with YAML frontmatter (`title`, `sourceUrl`, `capturedAt`) followed by the rendered Markdown.

### Mark mappings

| IR mark / inline | Notion | Markdown |
|---|---|---|
| `bold`   | `annotations.bold`     | `**…**` |
| `italic` | `annotations.italic`   | `*…*` |
| `underline` | `annotations.underline` | `<u>…</u>` (Markdown has no underline; HTML fallback) |
| `strike` | `annotations.strikethrough` | `~~…~~` |
| `code` (inline) | `annotations.code` | `` `…` `` |
| `link` (inline) | `text.link.url` | `[…](url)` |

### Callout mappings

| IR variant | Notion | Markdown |
|---|---|---|
| `info`    | callout, blue, info icon    | `> [info] …` |
| `note`    | callout, gray, note icon    | `> [note] …` |
| `warning` | callout, yellow, warning icon | `> [warning] …` |
| `success` | callout, green, check icon   | `> [success] …` |

### Error handling

Best-effort. Continue past individual failures, collect them in `failures[]`, surface as a summary panel after the run with reason text per failure. The data model supports a future "Retry failed items" action without changes.

### Service worker keep-alive

MV3 service workers can suspend after ~30s of idle. The orchestrator:

- Sets a `chrome.alarms` heartbeat every 20s during a capture.
- Chunks asset uploads so any individual `await` is short (no single 60s download stalling the worker).
- The active fetch traffic itself keeps the worker alive; the alarm is belt-and-braces.

## Settings (options page)

Stored under `chrome.storage.local`:

```ts
{
  atlassian: {
    siteUrl: string;            // e.g. https://myorg.atlassian.net
    email: string;
    apiToken: string;
  },
  notion: {
    integrationToken: string;
  },
  defaults: {
    lastDestinationType?: "notion" | "local";
    lastNotionParentId?: string;
  }
}
```

Options page UI:

```
┌──────────────────────────────────────────────────────┐
│ WikiBridge — Settings                                │
├──────────────────────────────────────────────────────┤
│ Atlassian (Confluence Cloud)                         │
│   Site URL    [ https://myorg.atlassian.net    ]     │
│   Email       [ me@myorg.com                   ]     │
│   API Token   [ •••••••• ] [Show] [Test]             │
│   How to get one: (link)                             │
│                                                      │
│ Notion                                               │
│   Integration token [ •••••••• ] [Show] [Test]       │
│   How to get one: (link, mention adding the          │
│                     integration to workspace pages)  │
│                                                      │
│ [ Save ]                                             │
└──────────────────────────────────────────────────────┘
```

Behavior:

- `Test` buttons make a minimal authenticated call (Confluence: `GET /wiki/api/v2/spaces?limit=1`; Notion: `GET /v1/users/me`) and show inline green check / red error.
- Tokens shown masked by default with a "Show" toggle.
- Save is explicit (no autosave-while-typing).
- If either token is missing, the corresponding destination is disabled in the side panel with a "Configure" link.

## Side Panel UI

Single-screen layout (chosen over tabbed and wizard variants — fastest for the common case, no clicking through steps).

```
┌──────────────────────────────────┐
│ WikiBridge                  ⚙   │   (header w/ settings gear)
├──────────────────────────────────┤
│ CURRENT PAGE                     │
│ Design Doc — Auth v2             │   (auto-detected from tab)
│                                  │
│ SAVE TO                          │
│ [● Notion]  [○ Local file]       │   (segmented picker)
│                                  │
│ PARENT PAGE                      │   (Notion-only; hidden for Local)
│ [ Engineering Wiki        v ]    │
│                                  │
│ ┌──────────────────────────────┐ │
│ │      Capture page            │ │   (primary CTA)
│ └──────────────────────────────┘ │
│                                  │
│ (progress / summary area)        │
└──────────────────────────────────┘
```

- The "Save to" picker remembers the last choice (`defaults.lastDestinationType`).
- For Notion: parent dropdown is populated lazily by searching the user's accessible pages (`POST /v1/search` with the integration token). Last picked parent is remembered.
- For Local: no extra UI — `showDirectoryPicker` runs on capture.
- During capture: the CTA becomes a progress block showing the current step ("Uploading image 3 of 12…").
- After capture: success shows a link to the Notion page or an "Open folder" button; failures show an expandable summary list.
- A "History" tab is a planned v1.1 addition; the design leaves room without committing to it.

A polished visual mockup is generated separately via an image prompt (see `docs/superpowers/specs/2026-05-21-wikibridge-mockup-prompt.md` for the prompt text).

## Extensibility

The `Destination` interface is the extension point:

```ts
interface Destination {
  readonly id: string;        // "notion", "local", "obsidian", ...
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  publish(page: Page, ctx: PublishContext): Promise<PublishResult>;
}
```

Adding a third destination (Obsidian vault, Joplin, etc.) means writing a new class and registering it in a destinations registry. No orchestrator changes. The side panel discovers available destinations from the registry and renders them as picker options.

`ConfluenceSource` is similarly behind a `Source` interface, leaving room for a future Notion-as-source or Markdown-as-source adapter (not in v1 scope, but the seam exists).

## File / Module Layout (proposed, WXT conventions)

```
wikibridge/
├── wxt.config.ts                  // WXT config; declares MV3 manifest fields
├── package.json
├── tsconfig.json
├── entrypoints/
│   ├── background.ts              // service worker entry; wires orchestrator
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── main.tsx               // React root
│   │   └── App.tsx
│   └── options/
│       ├── index.html
│       ├── main.tsx
│       └── App.tsx
├── src/
│   ├── orchestrator/
│   │   ├── orchestrator.ts        // run(pageId, destinationId)
│   │   └── keepalive.ts           // chrome.alarms heartbeat
│   ├── ir/
│   │   └── types.ts               // Page, Block, Inline, Asset
│   ├── sources/
│   │   ├── source.ts              // Source interface
│   │   └── confluence/
│   │       ├── confluence-source.ts
│   │       ├── adf-to-ir.ts       // ADF node to IR block
│   │       └── attachments.ts
│   ├── destinations/
│   │   ├── destination.ts         // Destination interface
│   │   ├── registry.ts            // available destinations
│   │   ├── notion/
│   │   │   ├── notion-destination.ts
│   │   │   ├── ir-to-notion.ts
│   │   │   └── file-uploads.ts
│   │   └── local/
│   │       ├── local-destination.ts
│   │       └── ir-to-markdown.ts
│   ├── storage/
│   │   └── settings.ts            // chrome.storage.local wrapper
│   └── messaging/
│       └── protocol.ts            // typed message shapes between UI and worker
└── tests/
    ├── adf-to-ir.test.ts
    ├── ir-to-notion.test.ts
    └── ir-to-markdown.test.ts
```

## Testing Strategy

Three layers, each isolated by the IR boundary:

1. **Conversion tests** — pure functions, run in Node with Vitest. Given a known ADF JSON fixture, expect a known IR. Given a known IR, expect known Notion block JSON or known Markdown.
2. **Adapter integration tests** — hit recorded HTTP fixtures (using `msw` or similar) to verify `ConfluenceSource.fetch()` end-to-end and `NotionDestination.publish()` against a mock Notion API. No live network.
3. **Manual smoke test** — load the unpacked extension, capture a real page that exercises headings 1–6, bold/italic/underline/strike, links, an ordered+unordered list with nesting, a code block, all four callout variants, a table with merged headers, two images, one PDF attachment.

Fixtures live under `tests/fixtures/` and include the rich-content smoke-test page in both ADF and expected IR form, so a regression is one diff away from being obvious.

## Open Questions / Deferred

- Authenticated Confluence OAuth (instead of API tokens). Tokens are simpler for v1 and don't require registering an Atlassian app; OAuth is a v2 conversation.
- History view in the side panel — designed for, not built in v1.
- Subtree capture — explicit non-goal; revisit after v1 ships.
- Image format conversion (e.g., WebP to PNG for Notion compatibility) — only address if a real failure shows up in smoke testing.
