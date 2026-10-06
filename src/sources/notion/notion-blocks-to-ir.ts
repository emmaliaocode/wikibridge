import type { Block, Inline, Mark } from "@/ir/types";

type NBlock = {
  type: string;
  has_children?: boolean;
  children?: NBlock[];
  [k: string]: any;
};

export type NotionToIrResult = {
  blocks: Block[];
  warnings: string[];
  /** Image / file blocks collected for the caller to turn into Assets. */
  mediaRefs: Array<{
    blockId: string;
    kind: "image" | "file";
    url: string;
    filename?: string;
    mime?: string;
  }>;
};

const GROUPED_LIST: Record<string, "bulleted" | "numbered" | "todo"> = {
  bulleted_list_item: "bulleted",
  numbered_list_item: "numbered",
  to_do: "todo",
};

export function notionBlocksToIr(blocks: NBlock[]): NotionToIrResult {
  const warnings: string[] = [];
  const mediaRefs: NotionToIrResult["mediaRefs"] = [];
  const out: Block[] = [];

  let i = 0;
  while (i < blocks.length) {
    const cur = blocks[i];
    const listKind = GROUPED_LIST[cur.type];
    if (listKind) {
      const groupType = cur.type;
      const items: Block[][] = [];
      while (i < blocks.length && blocks[i].type === groupType) {
        items.push(itemBlocks(blocks[i], listKind, warnings, mediaRefs));
        i++;
      }
      out.push({
        type: "list",
        ordered: listKind === "numbered",
        items,
      });
      continue;
    }
    const b = blockToBlock(cur, warnings, mediaRefs);
    if (b) {
      if (Array.isArray(b)) out.push(...b);
      else out.push(b);
    }
    i++;
  }
  return { blocks: out, warnings, mediaRefs };
}

function itemBlocks(
  n: NBlock,
  kind: "bulleted" | "numbered" | "todo",
  _warnings: string[],
  _mediaRefs: NotionToIrResult["mediaRefs"],
): Block[] {
  const payload = n[n.type] ?? {};
  let inlines = richTextToInlines(payload.rich_text ?? []);
  if (kind === "todo") {
    const prefix = payload.checked ? "[x] " : "[ ] ";
    inlines = [{ type: "text", text: prefix }, ...inlines];
  }
  const first: Block = { type: "paragraph", inlines };
  const children = n.children ? notionBlocksToIr(n.children).blocks : [];
  return [first, ...children];
}

function blockToBlock(
  n: NBlock,
  warnings: string[],
  mediaRefs: NotionToIrResult["mediaRefs"],
): Block | Block[] | null {
  switch (n.type) {
    case "paragraph":
      return {
        type: "paragraph",
        inlines: richTextToInlines(n.paragraph?.rich_text ?? []),
      };
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = Number(n.type.slice(-1)) as 1 | 2 | 3;
      return {
        type: "heading",
        level,
        inlines: richTextToInlines(n[n.type]?.rich_text ?? []),
      };
    }
    case "code":
      return {
        type: "code",
        language: n.code?.language ?? undefined,
        text: (n.code?.rich_text ?? [])
          .map((r: any) => r.plain_text ?? "")
          .join(""),
      };
    case "quote": {
      const first: Block = {
        type: "paragraph",
        inlines: richTextToInlines(n.quote?.rich_text ?? []),
      };
      const children = n.children ? notionBlocksToIr(n.children).blocks : [];
      return { type: "quote", blocks: [first, ...children] };
    }
    case "divider":
      return { type: "divider" };
    case "callout":
      return calloutBlock(n);
    case "table":
      return tableBlock(n);
    case "image":
      return imageBlock(n, mediaRefs);
    case "file":
    case "pdf":
      return fileBlock(n, mediaRefs);
    case "toggle": {
      const summary: Block = {
        type: "paragraph",
        inlines: [
          { type: "text", text: "▸ " },
          ...richTextToInlines(n.toggle?.rich_text ?? []),
        ],
      };
      const children = n.children ? notionBlocksToIr(n.children).blocks : [];
      return { type: "quote", blocks: [summary, ...children] };
    }
    case "column_list":
    case "column": {
      warnings.push(`flattened ${n.type}`);
      const kids = n.children ? notionBlocksToIr(n.children).blocks : [];
      return kids;
    }
    default:
      warnings.push(`unsupported notion block: ${n.type}`);
      return {
        type: "paragraph",
        inlines: [{ type: "text", text: `[${n.type}]` }],
      };
  }
}

function calloutBlock(n: NBlock): Block {
  const color = String(n.callout?.color ?? "").toLowerCase();
  let variant: "info" | "note" | "warning" | "success" = "note";
  if (color.startsWith("blue")) variant = "info";
  else if (color.startsWith("yellow") || color.startsWith("orange"))
    variant = "warning";
  else if (color.startsWith("green")) variant = "success";
  const first: Block = {
    type: "paragraph",
    inlines: richTextToInlines(n.callout?.rich_text ?? []),
  };
  const children = n.children ? notionBlocksToIr(n.children).blocks : [];
  return { type: "callout", variant, blocks: [first, ...children] };
}

function tableBlock(n: NBlock): Block {
  const rows: Block[][][] = (n.children ?? [])
    .filter((c: NBlock) => c.type === "table_row")
    .map((row: NBlock) =>
      (row.table_row?.cells ?? []).map((cell: any[]) => [
        { type: "paragraph", inlines: richTextToInlines(cell) } as Block,
      ]),
    );
  return { type: "table", rows };
}

function imageBlock(
  n: NBlock,
  mediaRefs: NotionToIrResult["mediaRefs"],
): Block {
  const src =
    n.image?.type === "external"
      ? n.image.external?.url
      : n.image?.file?.url;
  if (!src) {
    return {
      type: "paragraph",
      inlines: [{ type: "text", text: "[image: missing source]" }],
    };
  }
  const id = `notion-${n.id ?? cryptoId()}`;
  mediaRefs.push({
    blockId: id,
    kind: "image",
    url: src,
    filename: notionFilename(src, id, "image"),
  });
  return { type: "image", assetId: id, alt: "" };
}

function fileBlock(
  n: NBlock,
  mediaRefs: NotionToIrResult["mediaRefs"],
): Block {
  const payload = n[n.type] ?? {};
  const src =
    payload.type === "external" ? payload.external?.url : payload.file?.url;
  if (!src) {
    return {
      type: "paragraph",
      inlines: [{ type: "text", text: `[${n.type}: missing source]` }],
    };
  }
  const id = `notion-${n.id ?? cryptoId()}`;
  const filename = notionFilename(src, id, "file");
  mediaRefs.push({ blockId: id, kind: "file", url: src, filename });
  return { type: "attachment", assetId: id, filename };
}

function notionFilename(
  url: string,
  fallbackId: string,
  kind: string,
): string {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(u.pathname.split("/").pop() ?? "");
    if (base) return base;
  } catch {}
  return `${fallbackId}.${kind === "image" ? "bin" : "file"}`;
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const MARK_KEY: Array<[string, Mark]> = [
  ["bold", "bold"],
  ["italic", "italic"],
  ["underline", "underline"],
  ["strikethrough", "strike"],
  ["code", "code"],
];

function richTextToInlines(rich: any[]): Inline[] {
  const out: Inline[] = [];
  for (const r of rich) {
    const text =
      r.type === "text"
        ? (r.text?.content ?? "")
        : r.type === "equation"
          ? (r.equation?.expression ?? "")
          : (r.plain_text ?? "");
    const marks: Mark[] = [];
    const ann = r.annotations ?? {};
    for (const [k, m] of MARK_KEY) {
      if (ann[k]) marks.push(m);
    }
    const href = r.href ?? r.text?.link?.url ?? null;
    const base: Inline = marks.length
      ? { type: "text", text, marks }
      : { type: "text", text };
    if (href) {
      out.push({ type: "link", href, inlines: [base] });
    } else {
      out.push(base);
    }
  }
  return out;
}
