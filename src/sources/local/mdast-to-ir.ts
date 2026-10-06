import type { Block, Inline, Mark } from "@/ir/types";

type MNode = {
  type: string;
  value?: string;
  children?: MNode[];
  [k: string]: any;
};

export type MdastToIrOptions = {
  assetIds: Set<string>;
};

export type MdastToIrResult = {
  blocks: Block[];
  warnings: string[];
};

export function mdastToIr(
  root: MNode,
  opts: MdastToIrOptions,
): MdastToIrResult {
  const warnings: string[] = [];
  const blocks = childrenToBlocks(root.children ?? [], opts, warnings);
  return { blocks, warnings };
}

function childrenToBlocks(
  nodes: MNode[],
  opts: MdastToIrOptions,
  warnings: string[],
): Block[] {
  const blocks: Block[] = [];
  for (const n of nodes) {
    const b = nodeToBlock(n, opts, warnings);
    if (Array.isArray(b)) blocks.push(...b);
    else if (b) blocks.push(b);
  }
  return blocks;
}

function nodeToBlock(
  n: MNode,
  opts: MdastToIrOptions,
  warnings: string[],
): Block | Block[] | null {
  switch (n.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(n.depth) || 1, 1), 6) as
        | 1
        | 2
        | 3
        | 4
        | 5
        | 6;
      return {
        type: "heading",
        level,
        inlines: inlinesFromChildren(n.children ?? [], opts, warnings, []),
      };
    }
    case "paragraph": {
      const kids = n.children ?? [];
      if (kids.length === 1 && kids[0].type === "image") {
        return nodeToBlock(kids[0], opts, warnings);
      }
      return {
        type: "paragraph",
        inlines: inlinesFromChildren(kids, opts, warnings, []),
      };
    }
    case "html": {
      warnings.push(`raw HTML block dropped to text: ${n.value ?? ""}`);
      return {
        type: "paragraph",
        inlines: [{ type: "text", text: String(n.value ?? "") }],
      };
    }
    case "list": {
      const items: Block[][] = (n.children ?? []).map((li) =>
        listItemToBlocks(li, opts, warnings),
      );
      return { type: "list", ordered: !!n.ordered, items };
    }
    case "code": {
      const block: Block = n.lang
        ? {
            type: "code",
            language: String(n.lang),
            text: String(n.value ?? ""),
          }
        : { type: "code", text: String(n.value ?? "") };
      return block;
    }
    case "blockquote":
      return {
        type: "quote",
        blocks: childrenToBlocks(n.children ?? [], opts, warnings),
      };
    case "thematicBreak":
      return { type: "divider" };
    case "table": {
      const rows: Block[][][] = (n.children ?? []).map((row) =>
        (row.children ?? []).map((cell) => [
          {
            type: "paragraph",
            inlines: inlinesFromChildren(
              cell.children ?? [],
              opts,
              warnings,
              [],
            ),
          } as Block,
        ]),
      );
      return { type: "table", rows };
    }
    case "image": {
      const url = String(n.url ?? "");
      const alt = String(n.alt ?? "");
      if (isExternal(url)) {
        return { type: "image", assetId: `ext:${url}`, alt };
      }
      const key = normaliseRelative(url);
      if (opts.assetIds.has(key)) {
        return { type: "image", assetId: key, alt };
      }
      warnings.push(`missing image asset: ${url}`);
      return { type: "paragraph", inlines: [{ type: "text", text: alt }] };
    }
    default:
      if (n.children) {
        return childrenToBlocks(n.children, opts, warnings);
      }
      return null;
  }
}

function inlinesFromChildren(
  nodes: MNode[],
  opts: MdastToIrOptions,
  warnings: string[],
  marks: Mark[],
): Inline[] {
  const out: Inline[] = [];
  let underlineActive = false;

  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push({
          type: "text",
          text: String(n.value ?? ""),
          ...(marks.length || underlineActive
            ? {
                marks: [
                  ...marks,
                  ...(underlineActive ? (["underline"] as Mark[]) : []),
                ],
              }
            : {}),
        });
        break;
      case "inlineCode":
        out.push({
          type: "text",
          text: String(n.value ?? ""),
          marks: [...marks, "code"],
        });
        break;
      case "strong":
        out.push(
          ...inlinesFromChildren(n.children ?? [], opts, warnings, [
            ...marks,
            "bold",
          ]),
        );
        break;
      case "emphasis":
        out.push(
          ...inlinesFromChildren(n.children ?? [], opts, warnings, [
            ...marks,
            "italic",
          ]),
        );
        break;
      case "delete":
        out.push(
          ...inlinesFromChildren(n.children ?? [], opts, warnings, [
            ...marks,
            "strike",
          ]),
        );
        break;
      case "link": {
        const url = String(n.url ?? "#");
        if (!isExternal(url)) {
          const key = normaliseRelative(url);
          if (opts.assetIds.has(key)) {
            out.push({
              type: "attachmentRef",
              assetId: key,
              inlines: inlinesFromChildren(
                n.children ?? [],
                opts,
                warnings,
                marks,
              ),
            });
            break;
          }
          warnings.push(`missing attachment asset: ${url}`);
          out.push(
            ...inlinesFromChildren(n.children ?? [], opts, warnings, marks),
          );
          break;
        }
        out.push({
          type: "link",
          href: url,
          inlines: inlinesFromChildren(
            n.children ?? [],
            opts,
            warnings,
            marks,
          ),
        });
        break;
      }
      case "html": {
        const v = String(n.value ?? "").trim().toLowerCase();
        if (v === "<u>") {
          underlineActive = true;
        } else if (v === "</u>") {
          underlineActive = false;
        } else {
          warnings.push(`raw inline HTML dropped to text: ${n.value ?? ""}`);
          out.push({ type: "text", text: String(n.value ?? "") });
        }
        break;
      }
      case "break":
        out.push({ type: "text", text: "\n" });
        break;
      default:
        if (typeof n.value === "string") {
          out.push({ type: "text", text: n.value });
        } else if (n.children) {
          out.push(
            ...inlinesFromChildren(n.children, opts, warnings, marks),
          );
        }
    }
  }
  return out;
}

function listItemToBlocks(
  li: MNode,
  opts: MdastToIrOptions,
  warnings: string[],
): Block[] {
  const checked = li.checked;
  const inner = childrenToBlocks(li.children ?? [], opts, warnings);
  if (typeof checked === "boolean" && inner[0]?.type === "paragraph") {
    const prefix = checked ? "[x] " : "[ ] ";
    inner[0] = {
      type: "paragraph",
      inlines: [{ type: "text", text: prefix }, ...inner[0].inlines],
    };
  }
  return inner;
}

function normaliseRelative(href: string): string {
  return href.replace(/^\.\//, "");
}

function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}
