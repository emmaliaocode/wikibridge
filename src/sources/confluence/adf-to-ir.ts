import type { Block, Inline, Mark, TextColor } from "@/ir/types";

type AdfNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
  text?: string;
};

export type AttachmentInfo = {
  fileId: string;
  filename: string;
  mediaType: string;
};

const MARK_MAP: Record<string, Mark> = {
  strong: "bold",
  em: "italic",
  underline: "underline",
  strike: "strike",
  code: "code",
};

// Reference RGB values for Notion's 10 base colors. Tuned so that both
// saturated Confluence text-color values (e.g. #bf2600 red, #00875a green)
// AND pastel highlight values (e.g. #fdd0e7 pink, #abf5d1 green) land in the
// right bucket under nearest-distance matching. The exact swatches don't have
// to match Notion's own — only the relative spacing matters for the resolver.
const NOTION_COLOR_RGB: Record<Exclude<TextColor, "default">, [number, number, number]> = {
  gray:   [140, 140, 140],
  brown:  [160, 110, 80],
  orange: [240, 130, 50],
  yellow: [240, 200, 60],
  green:  [100, 180, 130],
  blue:   [90, 150, 220],
  purple: [160, 110, 200],
  pink:   [230, 110, 175],
  red:    [220, 60, 60],
};

function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().toLowerCase().match(/^#?([0-9a-f]{6})$/);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function nearestNotionColor(hex: string): TextColor | undefined {
  const rgb = parseHex(hex);
  if (!rgb) return undefined;
  // Whitish / near-white inputs (typical default text/bg) are treated as "no color"
  // so we don't emit spurious annotations. Threshold: all channels >= 240.
  if (rgb[0] >= 240 && rgb[1] >= 240 && rgb[2] >= 240) return undefined;
  let best: TextColor | undefined;
  let bestDist = Infinity;
  for (const [name, ref] of Object.entries(NOTION_COLOR_RGB) as [
    Exclude<TextColor, "default">,
    [number, number, number],
  ][]) {
    const d =
      (rgb[0] - ref[0]) ** 2 +
      (rgb[1] - ref[1]) ** 2 +
      (rgb[2] - ref[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

export function mapTextColor(hex: string | undefined): TextColor | undefined {
  if (typeof hex !== "string") return undefined;
  return nearestNotionColor(hex);
}

export function adfToBlocks(
  doc: AdfNode,
  attachments: AttachmentInfo[] = [],
): Block[] {
  if (!doc.content) return [];

  const attachmentById = new Map<string, AttachmentInfo>();
  for (const a of attachments) attachmentById.set(a.fileId, a);

  function nodeToBlock(node: AdfNode): Block[] {
    switch (node.type) {
      case "paragraph":
        return paragraphToBlocks(node);
      case "heading": {
        const level = clampLevel(node.attrs?.level);
        return [{ type: "heading", level, inlines: childrenToInlines(node) }];
      }
      case "bulletList":
        return [{ type: "list", ordered: false, items: listItems(node) }];
      case "orderedList":
        return [{ type: "list", ordered: true, items: listItems(node) }];
      case "codeBlock": {
        const text = collectText(node);
        const language =
          typeof node.attrs?.language === "string" ? node.attrs.language : undefined;
        return [{ type: "code", language, text }];
      }
      case "blockquote":
        return [{ type: "quote", blocks: childrenAsBlocks(node) }];
      case "rule":
        return [{ type: "divider" }];
      case "panel": {
        const raw =
          typeof node.attrs?.panelType === "string" ? node.attrs.panelType : "info";
        const variant: "info" | "note" | "warning" | "success" =
          raw === "note"
            ? "note"
            : raw === "warning" || raw === "error"
            ? "warning"
            : raw === "success"
            ? "success"
            : "info";
        return [{ type: "callout", variant, blocks: childrenAsBlocks(node) }];
      }
      case "expand":
      case "nestedExpand": {
        const title =
          typeof node.attrs?.title === "string" ? node.attrs.title : "";
        return [{ type: "toggle", title, blocks: childrenAsBlocks(node) }];
      }
      case "table":
        return [{ type: "table", rows: tableRows(node) }];
      case "mediaSingle":
      case "mediaGroup": {
        const media = node.content?.find((c) => c.type === "media");
        const id = typeof media?.attrs?.id === "string" ? media.attrs.id : null;
        if (!id) return [];
        const alt =
          typeof media?.attrs?.alt === "string" ? media.attrs.alt : undefined;
        const attachment = attachmentById.get(id);
        if (attachment && !attachment.mediaType.startsWith("image/")) {
          return [
            {
              type: "attachment",
              assetId: id,
              filename: attachment.filename,
            },
          ];
        }
        return [{ type: "image", assetId: id, alt }];
      }
      case "media": {
        // A stray block-level "media" node (not wrapped in mediaSingle /
        // mediaGroup). Some Confluence ADF outputs emit this for inline file
        // embeds that land at block position.
        const id = typeof node.attrs?.id === "string" ? node.attrs.id : null;
        if (!id) return [];
        const alt =
          typeof node.attrs?.alt === "string" ? node.attrs.alt : undefined;
        const attachment = attachmentById.get(id);
        if (attachment && !attachment.mediaType.startsWith("image/")) {
          return [
            {
              type: "attachment",
              assetId: id,
              filename: attachment.filename,
            },
          ];
        }
        return [{ type: "image", assetId: id, alt }];
      }
      default: {
        const text = collectText(node);
        if (text === "") return [];
        return [{ type: "paragraph", inlines: [{ type: "text", text }] }];
      }
    }
  }

  function paragraphToBlocks(node: AdfNode): Block[] {
    const out: Block[] = [];
    let buffer: Inline[] = [];

    const flush = () => {
      if (buffer.length > 0) {
        out.push({ type: "paragraph", inlines: buffer });
        buffer = [];
      }
    };

    for (const child of node.content ?? []) {
      if (child.type === "mediaInline" || child.type === "media") {
        const id =
          typeof child.attrs?.id === "string" ? child.attrs.id : null;
        if (!id) continue; // defensive: drop malformed
        flush();
        const attachment = attachmentById.get(id);
        if (attachment && !attachment.mediaType.startsWith("image/")) {
          out.push({
            type: "attachment",
            assetId: id,
            filename: attachment.filename,
          });
        } else {
          // image-typed (or unknown) mediaInline: emit as image block
          out.push({ type: "image", assetId: id });
        }
        continue;
      }
      // Anything else gets pushed through the existing inline-to-IR path.
      buffer.push(...nodeToInlines(child));
    }

    flush();
    return out;
  }

  function childrenAsBlocks(node: AdfNode): Block[] {
    if (!node.content) return [];
    return node.content.flatMap(nodeToBlock);
  }

  function listItems(node: AdfNode): Block[][] {
    if (!node.content) return [];
    return node.content
      .filter((c) => c.type === "listItem")
      .map((li) => childrenAsBlocks(li));
  }

  function tableRows(node: AdfNode): Block[][][] {
    if (!node.content) return [];
    const rawRows = node.content.filter((r) => r.type === "tableRow");

    const result: Block[][][] = [];
    // rowspanCarry[col] = how many more rows this column stays occupied by a
    // rowspan that began in an earlier row. Notion has no merged cells, so we
    // expand spans into a rectangular grid: the origin cell keeps its content
    // and the covered columns/rows become empty placeholder cells. This also
    // guarantees every row ends up the same width, which Notion requires.
    const rowspanCarry: number[] = [];

    for (const rawRow of rawRows) {
      const cellNodes = (rawRow.content ?? []).filter(
        (c) => c.type === "tableCell" || c.type === "tableHeader",
      );
      const outRow: Block[][] = [];
      let col = 0;

      const fillCarried = () => {
        while ((rowspanCarry[col] ?? 0) > 0) {
          rowspanCarry[col] -= 1;
          outRow.push([]);
          col += 1;
        }
      };

      fillCarried();
      for (const cellNode of cellNodes) {
        const colspan = positiveIntAttr(cellNode.attrs?.colspan);
        const rowspan = positiveIntAttr(cellNode.attrs?.rowspan);
        const content = childrenAsBlocks(cellNode);
        for (let k = 0; k < colspan; k++) {
          outRow.push(k === 0 ? content : []);
          if (rowspan > 1) rowspanCarry[col] = rowspan - 1;
          col += 1;
        }
        fillCarried();
      }

      result.push(outRow);
    }

    return result;
  }

  return doc.content.flatMap(nodeToBlock);
}

function positiveIntAttr(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
      ? parseInt(raw, 10)
      : 1;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function clampLevel(raw: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const n = typeof raw === "number" ? raw : 1;
  return (Math.min(6, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5 | 6);
}

function childrenToInlines(node: AdfNode): Inline[] {
  if (!node.content) return [];
  return node.content.flatMap(nodeToInlines);
}

function nodeToInlines(node: AdfNode): Inline[] {
  // ADF "date" inline node carries a Unix-ms timestamp in attrs.timestamp.
  // Without this, the node would be silently dropped, leaving table cells
  // that contain only a date visually empty.
  if (node.type === "date") {
    const ts = node.attrs?.timestamp;
    if (typeof ts !== "string") return [];
    const millis = Number(ts);
    if (!Number.isFinite(millis)) return [];
    const iso = new Date(millis).toISOString().slice(0, 10); // YYYY-MM-DD
    return [{ type: "text", text: iso }];
  }

  // inlineCard / blockCard / embedCard — smart links Confluence uses for
  // cross-page references. Preserve the URL as a link inline.
  if (node.type === "inlineCard" || node.type === "blockCard") {
    const href = typeof node.attrs?.url === "string" ? node.attrs.url : "";
    if (!href) return [];
    return [
      {
        type: "link",
        href,
        inlines: [{ type: "text", text: href }],
      },
    ];
  }

  if (node.type !== "text" || typeof node.text !== "string") return [];

  const linkMark = node.marks?.find((m) => m.type === "link");
  if (linkMark) {
    const href =
      typeof linkMark.attrs?.href === "string" ? linkMark.attrs.href : "";
    const inner = nodeToInlines({ ...node, marks: node.marks?.filter((m) => m.type !== "link") });
    return [{ type: "link", href, inlines: inner }];
  }

  const marks = (node.marks ?? [])
    .map((m) => MARK_MAP[m.type])
    .filter((m): m is Mark => Boolean(m));

  const textColorMark = node.marks?.find((m) => m.type === "textColor");
  const color = textColorMark
    ? mapTextColor(textColorMark.attrs?.color as string | undefined)
    : undefined;

  const bgMark = node.marks?.find((m) => m.type === "backgroundColor");
  const backgroundColor = bgMark
    ? mapTextColor(bgMark.attrs?.color as string | undefined)
    : undefined;

  const inline: Inline =
    marks.length || color || backgroundColor
      ? {
          type: "text",
          text: node.text,
          ...(marks.length ? { marks } : {}),
          ...(color ? { color } : {}),
          ...(backgroundColor ? { backgroundColor } : {}),
        }
      : { type: "text", text: node.text };
  return [inline];
}

function collectText(node: AdfNode): string {
  if (node.type === "text") return node.text ?? "";
  if (!node.content) return "";
  return node.content.map(collectText).join("");
}
