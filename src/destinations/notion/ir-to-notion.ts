import type { Block, Inline, Mark } from "@/ir/types";

export type AssetResolver = (assetId: string) => string;

type NotionRichText = {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: Partial<{
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    code: boolean;
    color: string;
  }>;
};

// Notion's code block `language` must be one of a fixed enum; anything else
// (e.g. Confluence's "plaintext") fails the append with a validation_error.
const NOTION_CODE_LANGUAGES = new Set<string>([
  "abap", "abc", "agda", "arduino", "ascii art", "assembly", "bash", "basic",
  "bnf", "c", "c#", "c++", "clojure", "coffeescript", "coq", "css", "dart",
  "dhall", "diff", "docker", "ebnf", "elixir", "elm", "erlang", "f#", "flow",
  "fortran", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "hcl",
  "html", "idris", "java", "javascript", "json", "julia", "kotlin", "latex",
  "less", "lisp", "livescript", "llvm ir", "lua", "makefile", "markdown",
  "markup", "matlab", "mermaid", "nix", "notion formula", "objective-c",
  "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog",
  "protobuf", "purescript", "python", "r", "racket", "reason", "ruby", "rust",
  "sass", "scala", "scheme", "scss", "shell", "smalltalk", "solidity", "sql",
  "swift", "toml", "typescript", "vb.net", "verilog", "vhdl", "visual basic",
  "webassembly", "xml", "yaml", "java/c/c++/c#",
]);

// Aliases from common Confluence (and other) code-language identifiers to the
// Notion enum value. Keys are matched case-insensitively.
const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  jsx: "javascript",
  tsx: "typescript",
  py: "python",
  py3: "python",
  sh: "shell",
  zsh: "shell",
  console: "shell",
  cmd: "shell",
  bat: "shell",
  plaintext: "plain text",
  text: "plain text",
  txt: "plain text",
  none: "plain text",
  cpp: "c++",
  "c++": "c++",
  cs: "c#",
  csharp: "c#",
  objc: "objective-c",
  "obj-c": "objective-c",
  golang: "go",
  kt: "kotlin",
  rb: "ruby",
  yml: "yaml",
  md: "markdown",
  tex: "latex",
  vb: "visual basic",
  vbnet: "vb.net",
  "vb.net": "vb.net",
  ps: "powershell",
  posh: "powershell",
  "html/xml": "html",
  htm: "html",
  wasm: "webassembly",
};

/**
 * Map an arbitrary code-language string to a Notion-accepted enum value,
 * falling back to "plain text" for anything unrecognized.
 */
function notionCodeLanguage(lang: string | undefined): string {
  const raw = (lang ?? "").trim().toLowerCase();
  if (!raw) return "plain text";
  const mapped = LANGUAGE_MAP[raw] ?? raw;
  return NOTION_CODE_LANGUAGES.has(mapped) ? mapped : "plain text";
}

const CALLOUT_COLOR: Record<
  "info" | "note" | "warning" | "success",
  string
> = {
  info: "blue_background",
  note: "gray_background",
  warning: "yellow_background",
  success: "green_background",
};

const CALLOUT_ICON: Record<
  "info" | "note" | "warning" | "success",
  string
> = {
  info: "ℹ️",
  note: "📝",
  warning: "⚠️",
  success: "✅",
};

export function irToNotionBlocks(
  blocks: Block[],
  resolve: AssetResolver,
): { type: string; [k: string]: unknown }[] {
  const hoisted: Block[] = [];
  const labelCounts = new Map<string, number>();
  const out = blocks.flatMap((b) =>
    blockToNotion(b, resolve, hoisted, labelCounts),
  );
  if (hoisted.length > 0) {
    out.push({ type: "divider", divider: {} });
    out.push({
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Attachments" } }],
      },
    });
    for (const h of hoisted) {
      // Recurse with a fresh accumulator + fresh label counter to avoid
      // double-hoisting/double-counting (defensive; hoisted blocks are always
      // image/attachment which don't hoist further).
      out.push(...blockToNotion(h, resolve, [], new Map()));
    }
  }
  return out;
}

function blockToNotion(
  block: Block,
  resolve: AssetResolver,
  hoisted: Block[],
  labelCounts: Map<string, number>,
): { type: string; [k: string]: unknown }[] {
  switch (block.type) {
    case "heading": {
      // Notion supports heading_1..heading_4 (heading_4 was added to the API
      // in April 2026). H5/H6 collapse to heading_4.
      const level = Math.min(block.level, 4) as 1 | 2 | 3 | 4;
      const key = `heading_${level}` as const;
      return [
        {
          type: key,
          [key]: { rich_text: inlinesToRichText(block.inlines) },
        },
      ];
    }
    case "paragraph":
      return [
        {
          type: "paragraph",
          paragraph: { rich_text: inlinesToRichText(block.inlines) },
        },
      ];
    case "list": {
      if (block.ordered && orderedListNeedsManualNumbering(block.items)) {
        return manualNumberedList(block.items, resolve);
      }
      return block.items.flatMap((itemBlocks) => {
        const [first, ...rest] = itemBlocks;
        const firstInlines =
          first && first.type === "paragraph"
            ? first.inlines
            : [{ type: "text", text: "" } as Inline];
        const childBlocks =
          first && first.type !== "paragraph" ? itemBlocks : rest;
        const key = block.ordered
          ? ("numbered_list_item" as const)
          : ("bulleted_list_item" as const);
        return [
          {
            type: key,
            [key]: {
              rich_text: inlinesToRichText(firstInlines),
              children:
                childBlocks.length > 0
                  ? irToNotionBlocks(childBlocks, resolve)
                  : undefined,
            },
          },
        ];
      });
    }
    case "code":
      return [
        {
          type: "code",
          code: {
            language: notionCodeLanguage(block.language),
            rich_text: splitTextForNotion(block.text).map((chunk) => ({
              type: "text",
              text: { content: chunk },
            })),
          },
        },
      ];
    case "quote":
      return [
        {
          type: "quote",
          quote: {
            rich_text: [{ type: "text", text: { content: "" } }],
            children: irToNotionBlocks(block.blocks, resolve),
          },
        },
      ];
    case "callout":
      return [
        {
          type: "callout",
          callout: {
            rich_text: [{ type: "text", text: { content: "" } }],
            icon: { type: "emoji", emoji: CALLOUT_ICON[block.variant] },
            color: CALLOUT_COLOR[block.variant],
            children: irToNotionBlocks(block.blocks, resolve),
          },
        },
      ];
    case "table":
      return [tableBlock(block.rows, hoisted, labelCounts)];
    case "image":
      return [
        {
          type: "image",
          image: {
            type: "file_upload",
            file_upload: { id: resolve(block.assetId) },
            caption: block.caption
              ? [{ type: "text", text: { content: block.caption } }]
              : [],
          },
        },
      ];
    case "attachment":
      return [
        {
          type: "file",
          file: {
            type: "file_upload",
            file_upload: { id: resolve(block.assetId) },
            name: block.filename,
          },
        },
      ];
    case "toggle":
      return [
        {
          type: "toggle",
          toggle: {
            rich_text:
              block.title.length > 0
                ? [{ type: "text", text: { content: block.title } }]
                : [],
            children: irToNotionBlocks(block.blocks, resolve),
          },
        },
      ];
    case "divider":
      return [{ type: "divider", divider: {} }];
  }
}

// Notion's block-append API allows a block tree to be at most this many levels
// of children deep in a single request ("up to two levels of nesting").
// Blocks deeper than that are rejected with
// "…children should be not present". Confluence pages with deeply nested lists
// routinely exceed this.
const MAX_CHILD_NESTING = 2;

// Block payload keys that carry a nestable `children` array (as produced by
// blockToNotion). Note: `table` is intentionally excluded — its children are
// table_row objects that must stay inline and never exceed the limit anyway.
const CONTAINER_KEYS = [
  "bulleted_list_item",
  "numbered_list_item",
  "toggle",
  "quote",
  "callout",
] as const;

type NotionBlock = { type: string; [k: string]: unknown };

function childContainerKey(block: NotionBlock): string | null {
  for (const key of CONTAINER_KEYS) {
    const payload = block[key] as { children?: unknown } | undefined;
    if (payload && Array.isArray(payload.children)) return key;
  }
  return null;
}

/**
 * Enforce Notion's per-request nesting limit. `budget` is how many further
 * levels of children are still allowed below the given blocks. When the budget
 * runs out, a block's children are stripped and re-emitted as trailing
 * siblings at the same (deepest allowed) level, so no content is lost — only
 * one level of indentation.
 */
export function capNestingDepth(
  blocks: NotionBlock[],
  budget: number = MAX_CHILD_NESTING,
): NotionBlock[] {
  const out: NotionBlock[] = [];
  for (const block of blocks) {
    const key = childContainerKey(block);
    if (!key) {
      out.push(block);
      continue;
    }
    const payload = block[key] as { children: NotionBlock[] };
    const children = payload.children;

    if (budget > 0) {
      out.push(
        children.length > 0
          ? {
              ...block,
              [key]: { ...payload, children: capNestingDepth(children, budget - 1) },
            }
          : block,
      );
    } else {
      // At the depth limit: this block may not carry children. Strip them and
      // hoist the (recursively capped) descendants up as siblings.
      const strippedPayload = { ...payload } as { children?: unknown };
      delete strippedPayload.children;
      out.push({ ...block, [key]: strippedPayload });
      if (children.length > 0) out.push(...capNestingDepth(children, 0));
    }
  }
  return out;
}

// URL schemes Notion accepts for a rich_text link. Anything else (relative
// paths, bare anchors, empty strings, javascript:, confluence-internal
// schemes) triggers "Invalid URL for link" and fails the whole append.
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Return a Notion-safe absolute URL for a link, or null if it can't be made
 * valid. Already-valid absolute URLs are returned verbatim. Relative URLs and
 * bare anchors are resolved against `baseUrl` (the source page URL) when
 * provided — e.g. "/wiki/x" → "https://site/wiki/x", "#sec" → ".../page#sec".
 */
function resolveLinkUrl(
  href: string | undefined,
  baseUrl?: string,
): string | null {
  const raw = (href ?? "").trim();
  if (!raw) return null;
  try {
    // Absolute URL: keep the original string to avoid surprising normalization.
    const u = new URL(raw);
    return LINK_SCHEMES.has(u.protocol) ? raw : null;
  } catch {
    /* not absolute — fall through to base resolution */
  }
  if (baseUrl) {
    try {
      const u = new URL(raw, baseUrl);
      return LINK_SCHEMES.has(u.protocol) ? u.toString() : null;
    } catch {
      /* unresolvable */
    }
  }
  return null;
}

/**
 * Rewrite link URLs across an IR block tree so they're safe for Notion:
 * relative/anchor links are resolved against the source page URL, and links
 * that still can't be made valid are unwrapped to plain text (content kept,
 * link dropped). Run before irToNotionBlocks so a single bad link never fails
 * the whole page.
 */
export function sanitizeLinks(blocks: Block[], baseUrl?: string): Block[] {
  return blocks.map((b) => sanitizeBlockLinks(b, baseUrl));
}

function sanitizeBlockLinks(block: Block, baseUrl?: string): Block {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return { ...block, inlines: sanitizeInlineLinks(block.inlines, baseUrl) };
    case "list":
      return {
        ...block,
        items: block.items.map((item) =>
          item.map((b) => sanitizeBlockLinks(b, baseUrl)),
        ),
      };
    case "quote":
    case "callout":
    case "toggle":
      return {
        ...block,
        blocks: block.blocks.map((b) => sanitizeBlockLinks(b, baseUrl)),
      };
    case "table":
      return {
        ...block,
        rows: block.rows.map((row) =>
          row.map((cell) => cell.map((b) => sanitizeBlockLinks(b, baseUrl))),
        ),
      };
    default:
      return block; // code, image, attachment, divider carry no links
  }
}

function sanitizeInlineLinks(inlines: Inline[], baseUrl?: string): Inline[] {
  return inlines.flatMap((inline) => {
    if (inline.type === "link") {
      const inner = sanitizeInlineLinks(inline.inlines, baseUrl);
      const url = resolveLinkUrl(inline.href, baseUrl);
      // Unresolvable link: unwrap to its inner inlines so the text survives.
      return url ? [{ type: "link", href: url, inlines: inner }] : inner;
    }
    if (inline.type === "attachmentRef") {
      return [{ ...inline, inlines: sanitizeInlineLinks(inline.inlines, baseUrl) }];
    }
    return [inline];
  });
}

function inlinesToRichText(inlines: Inline[]): NotionRichText[] {
  return inlines.flatMap(inlineToRichText);
}

function inlineToRichText(inline: Inline): NotionRichText[] {
  if (inline.type === "link") {
    const url = resolveLinkUrl(inline.href);
    return inline.inlines.flatMap((child) => {
      const parts = inlineToRichText(child);
      // Drop links Notion would reject (relative/empty/unsupported scheme)
      // while keeping their visible text. sanitizeLinks() upstream resolves
      // most relative URLs to absolute first; this is the final safety net.
      if (!url) return parts;
      return parts.map((p) => ({
        ...p,
        text: { ...p.text, link: { url } },
      }));
    });
  }
  if (inline.type === "attachmentRef") {
    // Notion has no inline-attachment equivalent; render the label text as a fallback.
    return inline.inlines.flatMap(inlineToRichText);
  }
  const annotations: NotionRichText["annotations"] = {};
  for (const m of inline.marks ?? []) {
    Object.assign(annotations, markToAnnotation(m));
  }
  // Notion annotations.color is a single value (foreground OR background).
  // Background wins when both are set — it's the visually dominant signal.
  if (inline.backgroundColor && inline.backgroundColor !== "default") {
    (annotations as { color?: string }).color = `${inline.backgroundColor}_background`;
  } else if (inline.color && inline.color !== "default") {
    (annotations as { color?: string }).color = inline.color;
  }
  // Notion limits each rich_text element's `text.content` to 2000 characters.
  // Split long text into multiple rich_text spans that inherit annotations.
  return splitTextForNotion(inline.text).map((chunk) => {
    const rt: NotionRichText = {
      type: "text",
      text: { content: chunk },
    };
    if (Object.keys(annotations).length > 0) rt.annotations = { ...annotations };
    return rt;
  });
}

const NOTION_RICH_TEXT_LIMIT = 2000;

function splitTextForNotion(text: string): string[] {
  if (text.length <= NOTION_RICH_TEXT_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > NOTION_RICH_TEXT_LIMIT) {
    // Prefer a newline boundary (best for code blocks) near the limit.
    let cut = remaining.lastIndexOf("\n", NOTION_RICH_TEXT_LIMIT);
    if (cut < NOTION_RICH_TEXT_LIMIT * 0.5) {
      // No good newline -- try space (best for prose).
      cut = remaining.lastIndexOf(" ", NOTION_RICH_TEXT_LIMIT);
    }
    if (cut < NOTION_RICH_TEXT_LIMIT * 0.5) {
      // No good word boundary either -- hard cut at the limit.
      cut = NOTION_RICH_TEXT_LIMIT;
    } else {
      // Include the boundary character in the previous chunk so reassembly is lossless.
      cut += 1;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function markToAnnotation(mark: Mark): NotionRichText["annotations"] {
  switch (mark) {
    case "bold":
      return { bold: true };
    case "italic":
      return { italic: true };
    case "underline":
      return { underline: true };
    case "strike":
      return { strikethrough: true };
    case "code":
      return { code: true };
  }
}

function cellToRichText(
  cell: Block[],
  hoisted: Block[],
  labelCounts: Map<string, number>,
): NotionRichText[] {
  // Notion table cells only accept inline rich_text — no block-level children
  // (lists, quotes, etc.). We flatten a cell's block content into a single
  // rich_text run: paragraphs join with spaces, and lists become newline-
  // separated lines prefixed with a bullet/number marker (indented for nested
  // lists). Dropping lists here previously left cells blank.
  const inlines: NotionRichText[] = [];
  const pushSep = (sep: string) => {
    if (inlines.length > 0) inlines.push({ type: "text", text: { content: sep } });
  };

  const walk = (blocks: Block[], depth: number) => {
    for (const b of blocks) {
      switch (b.type) {
        case "paragraph":
        case "heading":
          pushSep(" ");
          inlines.push(...inlinesToRichText(b.inlines));
          break;
        case "code":
          pushSep(" ");
          inlines.push({
            type: "text",
            text: { content: b.text },
            annotations: { code: true },
          });
          break;
        case "list": {
          b.items.forEach((itemBlocks, i) => {
            pushSep("\n");
            const marker = b.ordered ? `${i + 1}. ` : "• ";
            const indent = depth > 0 ? "    ".repeat(depth) : "";
            inlines.push({ type: "text", text: { content: `${indent}${marker}` } });
            const [first, ...rest] = itemBlocks;
            if (first && (first.type === "paragraph" || first.type === "heading")) {
              inlines.push(...inlinesToRichText(first.inlines));
              if (rest.length > 0) walk(rest, depth + 1);
            } else {
              walk(itemBlocks, depth + 1);
            }
          });
          break;
        }
        case "quote":
        case "callout":
          // No cell-level equivalent in Notion; inline the text so it survives.
          walk(b.blocks, depth);
          break;
        case "toggle":
          pushSep(" ");
          if (b.title.length > 0)
            inlines.push({ type: "text", text: { content: b.title } });
          walk(b.blocks, depth);
          break;
        case "attachment": {
          const label = disambiguate(b.filename, labelCounts);
          // Shallow-copy so we don't mutate the source IR; the bottom
          // Attachments section renders this copy with the disambiguated name.
          hoisted.push({ ...b, filename: label });
          pushSep(" ");
          inlines.push({
            type: "text",
            text: { content: `[${label}]` },
            annotations: { italic: true },
          });
          break;
        }
        case "image": {
          const base = b.alt && b.alt.length > 0 ? b.alt : "image";
          const label = disambiguate(base, labelCounts);
          hoisted.push({ ...b, alt: label });
          pushSep(" ");
          inlines.push({
            type: "text",
            text: { content: `[${label}]` },
            annotations: { italic: true },
          });
          break;
        }
        // table-in-cell / divider: nothing sensible to inline; skip.
      }
    }
  };

  walk(cell, 0);

  if (inlines.length === 0) {
    // Notion requires every cell to have at least one rich_text element.
    return [{ type: "text", text: { content: "" } }];
  }
  return inlines;
}

function disambiguate(name: string, counts: Map<string, number>): string {
  const seen = counts.get(name) ?? 0;
  counts.set(name, seen + 1);
  if (seen === 0) return name;
  return `${name} (${seen + 1})`;
}

function tableBlock(
  rows: Block[][][],
  hoisted: Block[],
  labelCounts: Map<string, number>,
): { type: string; [k: string]: unknown } {
  // A table with no rows can't be a valid Notion table (table_width >= 1 and at
  // least one row are required); emit an empty paragraph instead of a 400.
  if (rows.length === 0) {
    return { type: "paragraph", paragraph: { rich_text: [] } };
  }

  // Notion requires EVERY table_row to have exactly `table_width` cells. Ragged
  // rows (from colspan/rowspan or malformed source tables) otherwise trigger
  // "Number of cells in table row must match the table width of the parent
  // table". Size the table to the widest row, then pad short rows with empty
  // cells and truncate any over-long row.
  const width = Math.max(
    1,
    rows.reduce((max, row) => Math.max(max, row.length), 0),
  );
  const emptyCell = (): NotionRichText[] => [
    { type: "text", text: { content: "" } },
  ];

  return {
    type: "table",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: rows.map((row) => {
        const cells = row.map((cell) =>
          cellToRichText(cell, hoisted, labelCounts),
        );
        while (cells.length < width) cells.push(emptyCell());
        if (cells.length > width) cells.length = width;
        return { type: "table_row", table_row: { cells } };
      }),
    },
  };
}

// Notion's `numbered_list_item` visually resets numbering whenever a sibling
// block (image, code, extra paragraph at the same outline level) sits between
// two items. When the IR has such "fat" items, we fall back to rendering each
// step as a manually-numbered paragraph so users see 1./2./3. correctly.
function orderedListNeedsManualNumbering(items: Block[][]): boolean {
  for (const item of items) {
    if (item.length === 0) continue;
    if (item.length > 1) return true;
    if (item[0].type !== "paragraph") return true;
  }
  return false;
}

function manualNumberedList(
  items: Block[][],
  resolve: AssetResolver,
): { type: string; [k: string]: unknown }[] {
  const out: { type: string; [k: string]: unknown }[] = [];
  items.forEach((itemBlocks, i) => {
    const prefix = `${i + 1}. `;
    if (itemBlocks.length === 0) {
      out.push({
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: prefix } }],
        },
      });
      return;
    }
    const [first, ...rest] = itemBlocks;
    if (first.type === "paragraph") {
      out.push({
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: prefix } },
            ...inlinesToRichText(first.inlines),
          ],
        },
      });
      if (rest.length > 0) {
        out.push(...irToNotionBlocks(rest, resolve));
      }
    } else {
      out.push({
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: prefix } }],
        },
      });
      out.push(...irToNotionBlocks(itemBlocks, resolve));
    }
  });
  return out;
}
