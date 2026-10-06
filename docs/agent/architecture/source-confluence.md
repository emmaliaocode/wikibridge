# Source: Confluence

Directory: [`src/sources/confluence/`](../../../src/sources/confluence/). Implements [`Source`](../../../src/sources/source.ts).

| File | Role |
|------|------|
| `confluence-api.ts` | Thin REST client over `fetch`. Owns auth + URL building. |
| `confluence-source.ts` | Glue: calls API, runs ADF parser, builds `Page` IR with lazy assets. |
| `adf-to-ir.ts` | Pure converter, ADF JSON → IR `Block[]`. The bulk of the source. |
| `detect-page-id.ts` | Extracts numeric page id from `https://*.atlassian.net/wiki/spaces/.../pages/<id>/...` and the legacy `?pageId=` variant. |

## REST endpoints used

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /wiki/api/v2/pages/{id}?body-format=atlas_doc_format` | Fetch page metadata + ADF body. | Basic (email:apiToken) |
| `GET /wiki/api/v2/pages/{id}/attachments` | List page-level attachments. | Basic |
| `GET /wiki/rest/api/content/{pageId}/child/attachment/{attachmentId}/download` | Download attachment bytes. **v1 path, not v2**. | Basic on initial request; 302 redirects to presigned S3 URL without auth. |

The v2 attachment `downloadLink` is deprecated and returns 404 on most Cloud tenants. Use the v1 endpoint above. `fetch({ redirect: "follow" })` handles the 302 transparently — the auth header is only forwarded on same-origin redirects, so the presigned URL gets called without our token. See [the deprecation thread](https://community.developer.atlassian.com/t/deprecation-of-download-attachments-apis/94448).

## ADF → IR mapping

### Block-level nodes

| ADF type | IR block | Notes |
|----------|----------|-------|
| `paragraph` | `paragraph` | Split into multiple blocks if contains `mediaInline` or bare `media` — see below. |
| `heading` | `heading` (level clamped to 1..6) | Non-numeric level defaults to 1. |
| `bulletList` | `list { ordered: false }` | |
| `orderedList` | `list { ordered: true }` | |
| `codeBlock` | `code` | `attrs.language` preserved. |
| `blockquote` | `quote` | |
| `rule` | `divider` | |
| `panel` | `callout` | `panelType`: `info`→info, `note`→note, `warning`/`error`→warning, `success`→success. |
| `expand` / `nestedExpand` | `toggle` | `attrs.title` becomes IR `title`. |
| `table` | `table` | `tableHeader` and `tableCell` flattened into `Block[][][]`. |
| `mediaSingle` / `mediaGroup` / `media` (block) | `image` or `attachment` | See media routing. |
| anything else | `paragraph` of collected text | Graceful degradation. Empty text → dropped. |

### Inline nodes

| ADF type | IR inline | Notes |
|----------|-----------|-------|
| `text` | `text` with marks/colors | See marks table below. |
| `inlineCard` / `blockCard` | `link` with `href = attrs.url`, display text = the URL | Confluence smart links to other pages, Jira tickets, etc. |
| `mediaInline` / `media` (inline) | **block break** | Paragraph splits at this point. The media becomes its own `image` or `attachment` block. |
| `date` | `text` with `text = YYYY-MM-DD` | Parsed from `attrs.timestamp` (Unix millis as string). |
| anything else | dropped | Including `mention`, `emoji`, `status`. |

### Marks

| ADF mark | IR mark / field |
|----------|-----------------|
| `strong` | `bold` |
| `em` | `italic` |
| `underline` | `underline` |
| `strike` | `strike` |
| `code` | `code` |
| `link` | wraps text in `Inline.link { href, inlines }`; other marks propagate inside |
| `textColor` | `Inline.text.color` (resolved via RGB nearest-distance) |
| `backgroundColor` | `Inline.text.backgroundColor` (same resolver) |

## Media routing

Confluence's "/" → "File" inline embed uses several ADF shapes depending on version and context:

- `mediaSingle { content: [media] }` — block-level image embed.
- `mediaGroup { content: [media, ...] }` — block-level grouped media.
- `mediaInline` — inline media node inside a paragraph.
- bare `media` — sometimes appears either inline or at block position.

The converter:

1. Looks up the `media.attrs.id` in the attachments list (matched against the v2 attachment's `fileId`).
2. If the matched attachment's `mediaType` starts with `image/`: emit `Block.image { assetId }`.
3. Otherwise: emit `Block.attachment { assetId, filename }`.
4. If no matched attachment: default to `image` (preserves the ref; the upload may still succeed by id).

For inline-positioned media in a paragraph, the paragraph is split: `[text-before, attachment-block, text-after]`. See `paragraphToBlocks` in `adf-to-ir.ts`.

## Color resolution

Confluence's color palette drifts across versions. We map ADF hex values to Notion's 10-color palette via **RGB nearest-distance matching** against `NOTION_COLOR_RGB`. The reference RGB values are hand-tuned so that saturated reds (`#bf2600`), pastel pinks (`#fdd0e7`), and the rest of Confluence's default palette land in sensible Notion buckets.

Near-white inputs (all channels ≥ 240) are dropped — they're typically a "no highlight" signal misencoded as a color.

To re-tune: edit `NOTION_COLOR_RGB` in `adf-to-ir.ts`. Run `pnpm test tests/adf-to-ir.test.ts` to ensure the named-color tests still pass.

## Edge cases handled

- H5/H6 from ADF preserved as 5/6 in IR; Notion clamps to 4 downstream, Markdown emits exact.
- Unknown ADF node types degrade to paragraph of collected text (lossy, never throws).
- Malformed `attrs.id` on media → node dropped.
- Empty paragraphs after splitting around inline media → not emitted (no empty paragraph artifacts).
- `link` mark with empty `href` → link wrapper still emitted with empty href; downstream renderers handle empty links gracefully.

## When to touch this

- New ADF node type appears in Confluence → add a `case` to `nodeToBlock` or `nodeToInlines`.
- New mark in Confluence → add to `MARK_MAP` or extend the mark detection in `nodeToInlines`.
- Color palette drift → re-tune `NOTION_COLOR_RGB`.
- New REST endpoint needed → add a method to `ConfluenceApi` with its MSW test in `tests/confluence-api.test.ts`.
