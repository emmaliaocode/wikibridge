# Intermediate Representation (IR)

Defined in [`src/ir/types.ts`](../../../src/ir/types.ts). The contract between every source and every destination.

## Top-level shape

```ts
type Page = {
  id: string;          // Source-specific id (Confluence page id)
  title: string;
  sourceUrl: string;   // Back-link to the original (rendered into Markdown frontmatter / Notion meta)
  capturedAt: string;  // ISO 8601 timestamp
  blocks: Block[];     // Document body
  assets: Asset[];     // Images and attachments referenced by blocks
};
```

## Block taxonomy

| Block | Fields | Notes |
|-------|--------|-------|
| `heading` | `level: 1..6`, `inlines` | Notion clamps to H1-H4; Markdown emits exact level. |
| `paragraph` | `inlines` | |
| `list` | `ordered: boolean`, `items: Block[][]` | Each item is an array of blocks (typically one paragraph + optional nested lists). |
| `code` | `language?`, `text` | Notion: text chunks at 2000 chars; Markdown: fenced block. |
| `quote` | `blocks` | Blockquote, nested-block-aware. |
| `callout` | `variant: info\|note\|warning\|success`, `blocks` | Notion: callout with icon/color; Markdown: blockquote prefixed `> [variant]`. |
| `toggle` | `title: string`, `blocks` | From Confluence `expand`/`nestedExpand`. Notion: toggle; Markdown: `<details><summary>...</summary>`. |
| `table` | `rows: Block[][][]` | rows × cells × blocks. First row treated as header by both renderers. |
| `image` | `assetId`, `alt?`, `caption?` | References `Asset` by id. |
| `attachment` | `assetId`, `filename` | Non-image file. References `Asset` by id. |
| `divider` | — | Horizontal rule. |

## Inline taxonomy

```ts
type Mark = "bold" | "italic" | "underline" | "strike" | "code";

type TextColor =
  | "default" | "gray" | "brown" | "orange" | "yellow"
  | "green" | "blue" | "purple" | "pink" | "red";

type Inline =
  | { type: "text"; text: string; marks?: Mark[]; color?: TextColor; backgroundColor?: TextColor }
  | { type: "link"; href: string; inlines: Inline[] };
```

| Field | Notes |
|-------|-------|
| `marks` | Composable; bold + italic + underline + strike + code can co-occur on the same span. |
| `color` | Foreground color, mapped from Confluence `textColor` via RGB nearest-distance. See [source-confluence.md](source-confluence.md). |
| `backgroundColor` | Highlight color. In Notion, foreground and background are mutually exclusive on a single rich_text element — background wins. In Markdown, both can stack via inline `<span style="color:X;background-color:Y">`. |
| `link.inlines` | Nested inlines, allowing marks and color inside a link. Avoid links-within-links (the recursion overwrites the outer URL). |

`link` does **not** carry `color` / `backgroundColor` directly — the color lives on the inner text inlines.

## Asset

```ts
type Asset = {
  id: string;          // Stable id used by Block.image / Block.attachment to reference
  filename: string;
  mimeType: string;
  bytes?: Uint8Array;       // Eager (set after download)
  fetch?: () => Promise<Uint8Array>;  // Lazy
};
```

Sources produce `Asset` with `fetch` set (lazy). Destinations call `asset.fetch()` only for assets they actually need.

For the local destination, the side panel receives `Asset` with `bytes` set (base64-decoded; see [background-service-worker.md](background-service-worker.md)).

## Recursion bounds

Block recursion is unbounded by type but bounded by Confluence's own ADF schema:
- `quote.blocks`, `callout.blocks`, `toggle.blocks` may contain any block including each other.
- `list.items` may contain any block.
- `table.rows[r][c]` may contain any block, **but** the Notion destination flattens non-text cells (Notion limitation) and hoists attachment/image blocks to a footer Attachments section.

`Inline.link.inlines` is recursive but practically bounded — Confluence does not emit links-within-links.

## Asset id matching

The `assetId` on `Block.image` and `Block.attachment` matches `Asset.id`, which is set to the Confluence attachment's `fileId` (the value referenced by ADF `media.attrs.id`). The Confluence v2 attachment object has both `id` and `fileId`; we use `fileId` for IR matching and `id` for the actual download endpoint.

## What is NOT in the IR

- Source-specific metadata (Confluence space key, page version).
- Destination-specific affordances (Notion comments, Markdown frontmatter — those are emitted by destinations from `Page.title` / `sourceUrl` / `capturedAt`).
- Layout (column widths, alignment). v1 keeps content semantic; visual structure is the destination's call.

## When adding a new block or inline variant

Update in this order:

1. `src/ir/types.ts` — add the variant to the discriminated union.
2. `tests/ir-types.test.ts` — extend the round-trip test.
3. `src/sources/confluence/adf-to-ir.ts` — parse the ADF node into the new variant.
4. `src/destinations/notion/ir-to-notion.ts` — render to Notion.
5. `src/destinations/local/ir-to-markdown.ts` — render to Markdown.
6. Tests at every layer: `tests/adf-to-ir.test.ts`, `tests/ir-to-notion.test.ts`, `tests/ir-to-markdown.test.ts`.
7. This doc — update the relevant table.
