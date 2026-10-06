# WikiBridge Import — Design Spec

**Date:** 2026-06-08
**Status:** Approved (brainstorming)
**Builds on:** `2026-05-21-wikibridge-design.md`

## Overview

Adds an **Import** direction to WikiBridge. Users can pick a local Markdown file or a local folder (with optional `images/` and `attachments/` subfolders) **or** a single Notion page, and publish it as a new Confluence Cloud page under a chosen space and optional parent.

The existing Export flow (Confluence → Notion / Local) is unchanged. A new mode switch at the top of the side panel toggles between Export and Import. All adapters plug into the same `Source` / `Destination` interfaces; the orchestrator stays direction-agnostic.

## Goals

- Import a single page from one of three sources: **local .md file**, **local folder** (one .md + optional `images/` + `attachments/`), or **a single Notion page** (no children).
- Publish to Confluence Cloud as a **new page** under a user-chosen space and optional parent.
- Preserve headings, inline marks (bold/italic/underline/strike/inline code), links, lists, code blocks (with language), callouts, tables, images, attachments, dividers.
- Upload all referenced images and attachments to Confluence as page attachments; reference them by attachment filename in the page body.
- Keep the existing Export flow untouched; reuse `Source` / `Destination` interfaces and the `Page` IR.

## Non-Goals (v1)

- Recursive import of Notion subpages or Notion databases.
- Recursive import of nested local folders (only one .md at the chosen folder's root).
- Updating an existing Confluence page (idempotent / dedupe import). v1 always creates a new page; Confluence's own title-collision behaviour applies.
- Subpage trees on import (only a single page per import run).
- Front-matter dialects beyond YAML.
- A `child_page` or `synced_block` recursion on the Notion side — surfaced as warning + plain paragraph fallback.

## Tech Stack Additions

- **gray-matter** — YAML frontmatter parser for local .md files.
- **remark** + **remark-parse** + **remark-gfm** — CommonMark + GFM parser producing mdast.
- (Notion read uses hand-written `fetch`, consistent with existing write client. No `@notionhq/client` dependency.)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Chrome Extension (MV3)                                          │
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐  │
│  │   Side Panel     │ <-msg-> │  Service Worker (background) │  │
│  │   (React UI)     │         │                              │  │
│  │ mode: Export |   │         │  ┌────────────────────────┐  │  │
│  │       Import     │         │  │ Orchestrator           │  │  │
│  │                  │         │  │  source.fetch() →      │  │  │
│  │                  │         │  │  Page IR →             │  │  │
│  │                  │         │  │  destination.publish() │  │  │
│  └──────────────────┘         │  └────────────────────────┘  │  │
│                               │                              │  │
│                               │  Sources registry:           │  │
│                               │   confluence, local-file,    │  │
│                               │   local-folder, notion       │  │
│                               │                              │  │
│                               │  Destinations registry:      │  │
│                               │   notion, local, confluence  │  │
│                               └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                          │                    │
                          ▼                    ▼
            Confluence Cloud REST       Notion API (v1)
              v2 read + write             read: blocks/children
              v1 attachment upload        read: pages/{id}
```

The `Page` IR from the existing spec is the contract. Nothing in `src/ir/types.ts` changes.

## Direction & Mode

```ts
type Mode = "export" | "import";
```

- **Export** (existing): source = Confluence (current tab), destinations = Notion or Local.
- **Import** (new): sources = Local file, Local folder, or Notion; destination = Confluence.

The mode is a UI concept. The orchestrator does not branch on it — it only sees a `(source, destination)` pair pulled from the registries.

## New Sources

### LocalSource

Two entry points, one adapter; both produce a single `Page` IR.

```ts
type LocalSourceParams =
  | { kind: "file"; fileHandle: FileSystemFileHandle }
  | { kind: "folder"; dirHandle: FileSystemDirectoryHandle };
```

#### File mode (`kind: "file"`)

1. UI calls `showOpenFilePicker({ types: [{ accept: { "text/markdown": [".md"] } }] })` and hands the handle to the worker.
2. Read the file text; parse with `gray-matter` to split YAML frontmatter from body.
3. Parse body with `remark` + `remark-gfm` → mdast.
4. Walk mdast → IR `Block[]` via `mdast-to-ir.ts`.
5. Title resolution order: `frontmatter.title` → first `# H1` in body → file basename (without `.md`).
6. No assets are loaded. Any `images/...` or `attachments/...` relative reference encountered in the markdown becomes a warning in `failures[]`; the image becomes a plain text placeholder (alt text or filename), the attachment link becomes plain text.
7. External `http(s)` URLs are preserved as-is (inline links / external `<img>` references — see "External images" below).

#### Folder mode (`kind: "folder"`)

1. UI calls `showDirectoryPicker()` and hands the handle to the worker.
2. Enumerate root entries. Find exactly one file ending in `.md` (case-insensitive). If zero or more than one, fail with: *"Folder must contain exactly one .md file at its root."*
3. Read that file; same frontmatter + mdast parsing as file mode.
4. Title resolution order: `frontmatter.title` → first `# H1` → folder name.
5. Walk root entries for `images/` and `attachments/` subdirectories (both optional). For each file inside, build an `Asset`:
   - `id` = relative path from folder root, e.g. `images/Screenshot 2026-04-08 at 10.53.28 AM.png`
   - `filename` = bare filename
   - `mimeType` = inferred from extension (small lookup table for png/jpg/gif/webp/svg/pdf/txt/...; unknown → `application/octet-stream`)
   - `fetch()` = lazy reader over the `FileSystemFileHandle`
6. While walking mdast, asset lookup rules:
   - `![alt](images/foo.png)` and `![alt](./images/foo.png)` — strip leading `./`, look up exact match in the asset map. Hit → emit `{ type: "image", assetId, alt }`. Miss → warning, emit paragraph with alt-as-text.
   - `[label](attachments/bar.txt)` and `[label](./attachments/bar.txt)` — same lookup. Hit → emit `{ type: "attachment", assetId, filename }` wrapped if necessary (see "Attachment inside inline context" below). Miss → warning, emit inline text.
   - URLs starting with `http://`, `https://`, `mailto:` → preserved as inline `link` (or external image — see below).
   - Other relative paths (e.g. `../foo`, `sibling.md`) → warning, rendered as plain text.

#### External images

If markdown contains `![alt](https://example.com/foo.png)`:
- v1 strategy: emit `image` block with a synthetic asset whose `fetch()` does `fetch(url)` at publish time. If the fetch fails (CORS, 404, timeout), record a warning and fall back to an inline `<a>` link to the URL with the alt text.
- This keeps round-tripping with the LocalDestination's external-link behaviour predictable.

#### Frontmatter handling

The example folder shows:

```yaml
---
title: <page title>
sourceUrl: <original page URL>
capturedAt: <ISO timestamp>
---
```

- `title` → page title (highest priority).
- `sourceUrl`, `capturedAt`, any other keys → ignored in v1 (they don't have a Confluence equivalent that's worth surfacing yet).
- Frontmatter is **stripped** from the body before parsing — it doesn't leak into the rendered page.

#### Markdown dialect support matrix

Implemented via remark + remark-gfm. mdast nodes mapped to IR:

| mdast node | IR block / inline |
|---|---|
| `heading` (depth 1–6) | `heading` level 1–6 |
| `paragraph` | `paragraph` |
| `list` (ordered/unordered) | `list` with `ordered` flag; nested `listItem`s become `Block[][]` |
| `listItem` | inner blocks |
| `code` (fenced, with lang) | `code` with `language` |
| `inlineCode` | inline `text` with `code` mark |
| `blockquote` | `quote` |
| `table` (GFM) | `table` rows × cells × blocks |
| `thematicBreak` | `divider` |
| `image` | `image` (asset lookup or external) |
| `link` | inline `link` (or asset `attachment` if href matches `attachments/...`) |
| `strong` / `emphasis` / `delete` (GFM) | marks `bold` / `italic` / `strike` |
| `html` (raw `<u>`) | inline `text` with `underline` mark, only for the `<u>…</u>` / `</u>` pattern; other raw HTML degrades to plain text with warning |
| GFM task list | `list` with leading `[x]` / `[ ]` rendered as plain text prefix in v1 (Confluence's task macro is deferred) |

`html` raw nodes other than `<u>` recognition fall back to text + warning. This is intentionally conservative; widening dialect support is a v2 conversation.

#### Attachment inside inline context

Markdown allows `[label](attachments/foo.txt)` *inside a paragraph*. Confluence's storage format allows `<ac:link>` inside `<p>`, so this maps cleanly. IR-wise, treat it as an inline `link` whose `href` resolves to an `attachmentRef`:

```ts
type Inline =
  | { type: "text"; text: string; marks?: Mark[] }
  | { type: "link"; href: string; inlines: Inline[] }
  | { type: "attachmentRef"; assetId: string; inlines: Inline[] }    // NEW
```

This is the only IR change. The Notion destination ignores `attachmentRef` (no inline-attachment equivalent — falls back to link text), the local destination renders it as `[label](attachments/...)`, the Confluence destination renders `<ac:link>`. Existing adapters that don't handle `attachmentRef` log a warning and degrade to plain text — additive change.

### NotionSource

```ts
type NotionSourceParams = { pageUrlOrId: string };
```

1. Extract page ID from URL: take the last 32 hex chars (with or without dashes) after the last `/`. Reject if not parseable.
2. `GET https://api.notion.com/v1/pages/{id}` — pull `properties` and find the title (first property of type `title`). If page has no title property accessible, fall back to "Untitled".
3. `GET https://api.notion.com/v1/blocks/{id}/children?page_size=100` — paginate via `next_cursor` until exhausted.
4. For each child block that itself has children (e.g. `toggle`, `quote`, `callout`, `column_list`, list items with nested blocks), recurse with `GET /v1/blocks/{block_id}/children`. Depth limit: 5 (defensive).
5. Walk the block tree → IR via `notion-blocks-to-ir.ts`.

#### Block mapping

| Notion type | IR block |
|---|---|
| `heading_1` / `heading_2` / `heading_3` | `heading` level 1 / 2 / 3 |
| `paragraph` | `paragraph` |
| `bulleted_list_item` (consecutive) | `list` with `ordered: false` |
| `numbered_list_item` (consecutive) | `list` with `ordered: true` |
| `to_do` (consecutive) | `list` with `[x]` / `[ ]` text prefix (matches markdown task-list approach) |
| `quote` | `quote` |
| `callout` | `callout`, icon→variant mapping below |
| `code` | `code` (language passed through; if unsupported by Confluence code macro, default to `none`) |
| `table` (+ `table_row` children) | `table` |
| `image` | `image` + lazy `Asset` (see asset handling) |
| `file`, `pdf` | `attachment` + lazy `Asset` |
| `divider` | `divider` |
| `toggle` | `quote` containing children + a synthetic first paragraph for the toggle summary, prefixed `▸ ` (no native Confluence equivalent in v1) |
| `column_list`, `column` | flatten children, warning logged |
| `child_page`, `child_database`, `synced_block`, `embed`, `bookmark`, `link_preview`, `equation`, `breadcrumb`, `table_of_contents` | paragraph fallback with the block's plain-text or URL representation; warning logged |

Notion list items are siblings, not nested. The walker groups consecutive list items of the same type into a single IR `list` block.

#### Callout icon → variant

Notion callouts carry an emoji icon and a color. Mapping:

| Notion color (with any icon) | IR variant |
|---|---|
| `blue`, `blue_background` | `info` |
| `yellow`, `yellow_background`, `orange`, `orange_background` | `warning` |
| `green`, `green_background` | `success` |
| anything else | `note` |

#### Inline rich text

Notion `rich_text` array elements map per element:
- `annotations.bold` → `bold` mark
- `annotations.italic` → `italic` mark
- `annotations.underline` → `underline` mark
- `annotations.strikethrough` → `strike` mark
- `annotations.code` → `code` mark
- `text.link.url` (when present) → wrap the element in an inline `link`
- `type: "mention"` → render `plain_text` as text; if the mention has a URL (user/page/date links), wrap in `link`
- `type: "equation"` → render `expression` text wrapped in inline `code` mark + warning

#### Notion image / file assets

Notion image and file blocks include either `type: "file"` (Notion-hosted, signed URL with short expiry) or `type: "external"` (URL is permanent).

- Notion-hosted: `Asset.fetch()` immediately downloads bytes when called (which will be at publish time, within seconds). If the URL has already expired (rare in practice given the short window between fetch and publish), record warning and skip.
- External: same as the local source's external-image strategy — `fetch()` downloads at publish time; failure → warning + link fallback.

`Asset.id` for Notion: `notion-<blockId>`. `filename`: from URL path basename (URL-decoded), or `notion-asset-<blockId>.bin` if not derivable. `mimeType`: from URL extension or response `Content-Type` at fetch time.

## New Destination: ConfluenceDestination

```ts
type ConfluenceDestinationParams = {
  spaceId: string;          // numeric space ID from v2 API
  parentPageId?: string;    // optional; if omitted, page goes to space root
};
```

### Publish flow

1. **Create empty page** (so we have a `pageId` to attach to):
   ```
   POST /wiki/api/v2/pages
   {
     "spaceId": "<spaceId>",
     "status": "current",
     "title": "<page.title>",
     "parentId": "<parentPageId?>",
     "body": { "representation": "storage", "value": "" }
   }
   ```
   Returns `{ id, _links }`. Capture `id` as `pageId`, `_links.webui` for the success URL.

2. **Upload each asset** sequentially (parallel uploads risk worker churn; sequential keeps progress reporting honest):
   ```
   POST /wiki/rest/api/content/{pageId}/child/attachment
   multipart: file=<bytes>, minorEdit=true
   header: X-Atlassian-Token: no-check
   ```
   Build a map `assetId → uploadedFilename`. On individual failure, record in `failures[]`, mark assetId as failed in the map (sentinel value), continue.
   - v2 has no attachment-upload endpoint as of writing; v1 REST is the supported path.
   - Conflict on duplicate filename within a page: append `minorEdit=true` and use the returned filename from the response (Confluence may suffix `_1`, `_2`).

3. **Render IR → storage XHTML** via `ir-to-storage.ts`, resolving each asset reference against the map. Failed assets render as a placeholder span (`<p><em>[Failed to upload: filename]</em></p>` for blocks; plain text for inline `attachmentRef`).

4. **PUT the body**:
   ```
   PUT /wiki/api/v2/pages/{pageId}
   {
     "id": "<pageId>",
     "status": "current",
     "title": "<page.title>",
     "version": { "number": 2 },
     "body": { "representation": "storage", "value": "<xhtml>" }
   }
   ```
   If this PUT fails, the page exists but is empty. Surface a clear message in the failure summary: *"Page created but body upload failed. Open the page to delete it manually: <url>"*. Do not attempt auto-cleanup (DELETE could mask a transient error and lose work if the body actually did land).

5. Return `{ ok: failures.length === 0, failures, destinationUrl: <_links.webui resolved against site URL> }`.

### IR → Storage format mapping

Confluence storage format is XHTML with `ac:` (Atlassian Confluence) and `ri:` (resource identifier) custom elements.

| IR | Storage XHTML |
|---|---|
| `heading` level N | `<h{N}>…inlines…</h{N}>` |
| `paragraph` | `<p>…inlines…</p>` |
| `list` ordered | `<ol><li>…blocks…</li>…</ol>` |
| `list` unordered | `<ul><li>…blocks…</li>…</ul>` |
| `code` | `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">{lang}</ac:parameter><ac:plain-text-body><![CDATA[{text}]]></ac:plain-text-body></ac:structured-macro>` |
| `quote` | `<blockquote>…blocks…</blockquote>` |
| `callout` info | `<ac:structured-macro ac:name="info"><ac:rich-text-body>…blocks…</ac:rich-text-body></ac:structured-macro>` |
| `callout` note | `<ac:structured-macro ac:name="note">…</ac:structured-macro>` |
| `callout` warning | `<ac:structured-macro ac:name="warning">…</ac:structured-macro>` |
| `callout` success | `<ac:structured-macro ac:name="tip">…</ac:structured-macro>` |
| `table` | `<table><tbody><tr><td>…blocks…</td>…</tr>…</tbody></table>` (no `<thead>` in v1 — IR doesn't distinguish header rows; existing IR has rows × cells × blocks only) |
| `image` (asset) | `<ac:image ac:alt="{alt}"><ri:attachment ri:filename="{uploadedFilename}"/></ac:image>` |
| `image` (external) | `<ac:image ac:alt="{alt}"><ri:url ri:value="{url}"/></ac:image>` |
| `attachment` block | `<p><ac:link><ri:attachment ri:filename="{uploadedFilename}"/><ac:plain-text-link-body><![CDATA[{label}]]></ac:plain-text-link-body></ac:link></p>` |
| `divider` | `<hr/>` |
| Inline `text` with marks | nested `<strong>` / `<em>` / `<u>` / `<s>` / `<code>` |
| Inline `link` | `<a href="{href}">…</a>` |
| Inline `attachmentRef` | `<ac:link><ri:attachment ri:filename="{uploadedFilename}"/><ac:link-body>…inlines…</ac:link-body></ac:link>` |

### HTML safety / escaping

All user text crosses the IR→storage boundary, so a dedicated `escape.ts` module handles:

- **Text escape**: `&` `<` `>` `"` `'` → entities. Applied to all text content in tags and attribute values.
- **Attribute escape**: as above, also strip raw control chars.
- **URL validation**: only allow `http`, `https`, `mailto`. Anything else (including `javascript:`, `data:`) is replaced with `#` and a warning is recorded.
- **CDATA escape**: split any `]]>` in code-block content into `]]]]><![CDATA[>` so it can't terminate the CDATA section.
- **Filename safety**: attachment filenames are escaped as attribute values; additionally reject filenames containing path separators (defence in depth — shouldn't occur given how we build them).

Centralised so every test case (`escape.test.ts`) covers every output adapter in one place.

## UI Changes

### Side panel layout (with mode switch)

```
┌──────────────────────────────────┐
│ WikiBridge                  ⚙   │
├──────────────────────────────────┤
│ [● Export]  [○ Import]           │
├──────────────────────────────────┤
│                                  │
│  (mode === "export") — existing  │
│  CURRENT PAGE / SAVE TO / …      │
│                                  │
│  ─ or ─                          │
│                                  │
│  (mode === "import") — new       │
│  SOURCE                          │
│  [● Local]  [○ Notion]           │
│                                  │
│  -- if Local --                  │
│  [ Pick .md file ] [ Pick folder]│
│  Selected: <name>  ✕             │
│                                  │
│  -- if Notion --                 │
│  Page URL                        │
│  [ https://notion.so/…         ] │
│                                  │
│  DESTINATION (Confluence)        │
│  Space   [ Engineering      v ]  │
│  Parent  [ (space root)     v ]  │
│                                  │
│  ┌──────────────────────────────┐│
│  │      Import page             ││
│  └──────────────────────────────┘│
│                                  │
│  (progress / summary)            │
└──────────────────────────────────┘
```

- Mode default: whichever was last used (`defaults.lastMode`, defaults to `"export"` on first run).
- Local picker buttons call the picker APIs from the side panel context (UI thread — service workers can't open pickers). The handle is serialised via `chrome.runtime.connect` port and held in memory in the worker for the duration of the run.
- Space dropdown: populated once per session via `GET /wiki/api/v2/spaces?limit=250`. If a token isn't configured, the dropdown is replaced by *"Configure Confluence token in settings →"*.
- Parent dropdown: populated when a space is picked, via `GET /wiki/api/v2/pages?space-id=<id>&limit=50` (first 50 root pages — sufficient for v1 ergonomics; future: search box).
- Last-chosen space / parent persisted in `defaults.lastImportSpaceId` / `defaults.lastImportParentId`.

### Settings

No changes. Existing Confluence Atlassian token (email + API token) is reused for both read and write.

## Messaging Protocol Update

`src/messaging/protocol.ts`:

```ts
type RunRequest =
  | {
      kind: "export";
      sourcePageId: string;       // Confluence page ID from current tab
      destinationId: "notion" | "local";
      destinationParams: NotionExportParams | LocalExportParams;
    }
  | {
      kind: "import";
      sourceId: "local-file" | "local-folder" | "notion";
      sourceParams: LocalFileParams | LocalFolderParams | NotionImportParams;
      destinationParams: ConfluenceDestinationParams;
    };

type LocalFileParams = { fileHandleToken: string };       // handle held in worker
type LocalFolderParams = { dirHandleToken: string };
type NotionImportParams = { pageUrlOrId: string };
```

Handle tokens: side panel transfers handles to the worker via `port.postMessage({ handle })`. The worker stores them in an in-memory map keyed by an opaque token (UUID) and includes the token in the `RunRequest`. The map entry is cleared when the run completes.

## Service Worker Keep-Alive

No new mechanism. Existing `chrome.alarms` 20s heartbeat covers the import flow. Asset upload to Confluence is sequential and individual requests are short.

## Error Handling

Same best-effort model as Export:

- Per-block / per-asset errors collected into `failures[]`.
- The run continues unless a critical step fails (page create, body PUT).
- Side panel renders a summary list after the run; each failure has a reason string.

Critical failures:

- **Page create fails** → abort; surface raw error message.
- **Body PUT fails after page exists** → surface special message including the page URL so the user can clean up.

Non-critical (collected as warnings, run continues):

- Asset upload failure → block renders as placeholder.
- Notion external URL fetch failure → image renders as a link to the URL.
- Markdown asset reference miss → renders as plain text.
- Unknown Notion block type → paragraph fallback.
- Unknown markdown raw HTML → text fallback.

## File / Module Layout (delta on top of existing)

```
src/
├── sources/
│   ├── local/                              # NEW
│   │   ├── local-source.ts                 # Source impl; dispatches file vs folder
│   │   ├── mdast-to-ir.ts                  # mdast → IR Block / Inline
│   │   ├── filesystem-read.ts              # FileSystem*Handle helpers, mime lookup
│   │   └── asset-lookup.ts                 # relative-path → assetId resolver
│   └── notion/                             # NEW
│       ├── notion-source.ts                # Source impl
│       ├── notion-api.ts                   # read endpoints: pages/{id}, blocks/{id}/children
│       └── notion-blocks-to-ir.ts          # block tree → IR Block / Inline
├── destinations/
│   └── confluence/                         # NEW
│       ├── confluence-destination.ts       # Destination impl
│       ├── confluence-write-api.ts         # POST page, attachment upload, PUT body, list spaces/pages
│       ├── ir-to-storage.ts                # IR → storage XHTML
│       └── escape.ts                       # text / attr / URL / CDATA safety
├── ir/
│   └── types.ts                            # MODIFIED: add Inline `attachmentRef`
├── messaging/
│   └── protocol.ts                         # MODIFIED: RunRequest now union over export/import
└── orchestrator/
    └── orchestrator.ts                     # MODIFIED: read (source, destination) from request, dispatch via registries

entrypoints/
└── sidepanel/
    ├── App.tsx                             # MODIFIED: mode switch, import form
    └── (new) ImportForm.tsx                # extracted for clarity
```

## Testing Strategy

Pure-function vitest tests at each conversion boundary:

1. `mdast-to-ir.test.ts` — fixture .md (covering all dialect rows above) → expected IR. Includes the `tmp/group-1-common-infra-...` example as a real-world fixture.
2. `local-source.test.ts` — mock `FileSystemDirectoryHandle` / `FileSystemFileHandle` (small in-memory polyfill in `tests/helpers/`); covers file mode, folder mode, missing assets, multi-md folder error, frontmatter title precedence.
3. `notion-blocks-to-ir.test.ts` — fixture block-tree JSON covering all mapped types and the consecutive-list-item grouping.
4. `notion-source.test.ts` — MSW fixtures for `/pages/{id}` and `/blocks/{id}/children` (including pagination and recursion).
5. `ir-to-storage.test.ts` — fixture IR → expected storage XHTML string. Snapshot-friendly.
6. `escape.test.ts` — adversarial inputs (`<script>`, `javascript:` URLs, `]]>` in code blocks, control chars).
7. `confluence-destination.test.ts` — MSW for create-page, attachment upload, PUT body; verifies asset-map resolution and body PUT payload.

Manual smoke test:

- Use the `tmp/group-1-common-infra-...` folder → expect a Confluence page in a chosen space with the screenshot inline, attachment links resolved, and the long table preserved.
- Use a Notion page that exercises headings, callouts (one per colour mapping), a numbered + bulleted list, a code block, an image, and a PDF file → expect the same page in Confluence with all assets uploaded.
- Use a single .md file (no folder) that references `images/foo.png` → expect the page in Confluence with a warning surfaced for the missing image and the alt text rendered in its place.

## Open Questions / Deferred

- Updating an existing Confluence page (idempotent re-import) — v2.
- Notion subtree / database import — v2.
- Markdown task-list → Confluence task macro — v2 (currently text prefix).
- Toggle / column_list — currently degrades; native Confluence equivalents (`expand` macro for toggle) are a v2 polish.
- Frontmatter `sourceUrl` displayed in the published page footer — not in v1; ask if needed.
- Drag-and-drop of file / folder onto the side panel — pickers only in v1.
