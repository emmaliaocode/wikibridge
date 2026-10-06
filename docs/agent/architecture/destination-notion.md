# Destination: Notion

Directory: [`src/destinations/notion/`](../../../src/destinations/notion/). Implements [`Destination`](../../../src/destinations/destination.ts).

| File | Role |
|------|------|
| `notion-api.ts` | Thin REST client: `createPage`, `appendChildren` (chunked), `searchParents`, `whoami`. |
| `file-uploads.ts` | Multipart upload to `/v1/file_uploads` (create → put bytes → return id). |
| `ir-to-notion.ts` | Pure converter, IR `Block[]` → Notion block JSON. The bulk of the destination. |
| `notion-destination.ts` | Pipeline glue: page create → uploads → block append. |

## API version

`Notion-Version: 2026-03-11` (constant in `notion-api.ts` and `file-uploads.ts`). Bump and re-test if Notion publishes a newer stable version.

## Publish pipeline

```
NotionDestination.publish(page, ctx)
  1. api.createPage(parentPageId, page.title)           ──► destinationUrl
  2. for each asset:
       bytes = asset.bytes ?? await asset.fetch()
       uploadId = await uploadFile(token, filename, mime, bytes)
       record assetId → uploadId
       (failures collected, others continue)
  3. usableBlocks = drop image/attachment blocks whose asset failed to upload
  4. notionBlocks = irToNotionBlocks(usableBlocks, resolveByAssetId)
  5. api.appendChildren(pageId, notionBlocks)
       (chunks of 100 internally)
  6. return { ok, failures, destinationUrl }
```

Best-effort throughout. A failed upload drops its block but does not abort.

## Notion API limits we handle

| Limit | Where it's enforced | Where we work around |
|-------|---------------------|----------------------|
| 100 children per `appendChildren` call | `notion-api.ts:appendChildren` | Slice into chunks. |
| 2000 chars per `rich_text[].text.content` | All rich_text emission | `splitTextForNotion` in `ir-to-notion.ts`. Prefers newline boundaries (good for code), falls back to space, then hard cut. Annotations and links propagate to every chunk. |
| Table cells accept only `rich_text` (no nested blocks) | `cellToRichText` in `ir-to-notion.ts` | Attachments and images in cells are **hoisted** to a footer "Attachments" section (divider + H2 + file blocks). The cell shows an italic `[filename]` reference. |
| Headings cap at `heading_4` | `case "heading"` in `blockToNotion` | H5 / H6 from IR collapse to `heading_4`. (Notion API added H4 in April 2026.) |
| `annotations.color` is one value (foreground OR background) | `inlineToRichText` | Background wins when both are set on a single inline. Markdown can stack both — only Notion forces the choice. |

## Block mapping

| IR block | Notion block | Notes |
|----------|--------------|-------|
| `heading` | `heading_1..4` | H5/H6 → H4. |
| `paragraph` | `paragraph` | |
| `list { ordered: false }` | `bulleted_list_item` | One per item. Item's first paragraph becomes `rich_text`; further blocks become `children`. |
| `list { ordered: true }` | `numbered_list_item` | Same shape. Notion renumbers automatically. |
| `code` | `code` | `block.text` chunked into multiple `rich_text` elements ≤ 2000 chars each. Language passed through (subject to Notion's allowed-language list; unknown values fall back to `plain text`). |
| `quote` | `quote` | `block.blocks` become `children`. |
| `callout` | `callout` | Variant maps to icon (ℹ️/📝/⚠️/✅) and color (`blue_background`/`gray_background`/`yellow_background`/`green_background`). Inner blocks become `children`. |
| `toggle` | `toggle` | `title` → `rich_text`; `blocks` → `children`. |
| `table` | `table` | See below. |
| `image` | `image { type: "file_upload", file_upload: { id } }` | id is the upload id from step 2. |
| `attachment` | `file { type: "file_upload", file_upload: { id }, name: filename }` | |
| `divider` | `divider` | |

## Table cell hoisting

When a `table` cell contains an `attachment` or `image` block (Notion forbids these in cells), the converter:

1. Replaces the cell content with an italic `[filename]` (or `[alt]` for images) rich-text reference.
2. Pushes the original block onto a `hoisted` accumulator (scoped to the current `irToNotionBlocks` call).
3. After all top-level blocks convert, appends:
   - A `divider`.
   - An H2 `heading_2` titled "Attachments".
   - One file/image block per hoisted entry.

Nested toggles / callouts containing tables get their own hoisted section at the END of the container's children (the nested `irToNotionBlocks` call has its own accumulator). This is intentional — the attachments live where the table they came from lives.

## Duplicate filename disambiguation

Multiple cells referencing the same filename would render as identical `[screenshot.png]` text without telling which is which. A `labelCounts: Map<string, number>` per `irToNotionBlocks` call assigns:

- 1st occurrence: `screenshot.png`
- 2nd: `screenshot.png (2)`
- 3rd: `screenshot.png (3)`

Both the cell reference text **and** the hoisted file block's displayed name use the suffixed string. Single-occurrence names stay un-suffixed. The original IR is not mutated — labels are applied via shallow-copied blocks.

## Color mapping

| IR field | Notion annotation |
|----------|-------------------|
| `Inline.text.color = "red"` | `annotations.color = "red"` |
| `Inline.text.backgroundColor = "pink"` | `annotations.color = "pink_background"` |
| Both set | Background wins (Notion API can't represent both on one rich_text element). |
| `"default"` value | Treated as no color (no annotation emitted). |

## Failure handling

`PublishResult.failures` collects:

- Per-asset upload failures with `{ assetId, reason }`.
- A single block-append failure if `appendChildren` throws (rare; typically a 400 from a content-validation issue Notion didn't anticipate).

The side panel shows the failure list in an expandable summary after capture.

## When to touch this

- New IR block variant → add a `case` to `blockToNotion`.
- New Notion API limit hit (e.g. caption length) → add to `splitTextForNotion` or a new chunker.
- New language for code blocks → extend `LANGUAGE_MAP`.
- Add `_background` color for a new highlight color → IR `TextColor` first, then both renderers.
