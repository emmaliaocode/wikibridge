import type { Block, Inline, Mark } from "@/ir/types";

export type MarkdownRenderOptions = {
  resolveAssetPath: (assetId: string) => string;
};

export function renderMarkdown(
  blocks: Block[],
  opts: MarkdownRenderOptions,
): string {
  return blocks.map((b) => renderBlock(b, opts)).join("\n\n") + "\n";
}

function renderBlock(block: Block, opts: MarkdownRenderOptions): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${renderInlines(block.inlines)}`;
    case "paragraph":
      return renderInlines(block.inlines);
    case "list": {
      const lines = block.items.map((itemBlocks, i) => {
        const inner = itemBlocks
          .map((b) => renderBlock(b, opts))
          .join("\n\n")
          .replace(/^/gm, "  ")
          .trimStart();
        const prefix = block.ordered ? `${i + 1}. ` : "- ";
        return prefix + inner;
      });
      return lines.join("\n");
    }
    case "code":
      return "```" + (block.language ?? "") + "\n" + block.text + "\n```";
    case "quote":
      return block.blocks
        .map((b) => renderBlock(b, opts))
        .join("\n\n")
        .replace(/^/gm, "> ");
    case "callout": {
      const inner = block.blocks
        .map((b) => renderBlock(b, opts))
        .join("\n\n");
      return inner.replace(/^/gm, `> [${block.variant}] `);
    }
    case "table":
      return renderTable(block.rows, opts);
    case "toggle": {
      const inner = block.blocks
        .map((b) => renderBlock(b, opts))
        .join("\n\n");
      const summary = block.title.length > 0 ? block.title : "Details";
      return `<details>\n<summary>${summary}</summary>\n\n${inner}\n\n</details>`;
    }
    case "image": {
      const path = opts.resolveAssetPath(block.assetId);
      return `![${block.alt ?? ""}](${path})`;
    }
    case "attachment": {
      const path = opts.resolveAssetPath(block.assetId);
      return `[${block.filename}](${path})`;
    }
    case "divider":
      return "---";
  }
}

function renderInlines(inlines: Inline[]): string {
  return inlines.map(renderInline).join("");
}

function renderInline(inline: Inline): string {
  if (inline.type === "link") {
    return `[${renderInlines(inline.inlines)}](${inline.href})`;
  }
  if (inline.type === "attachmentRef") {
    return `[${renderInlines(inline.inlines)}](${inline.assetId})`;
  }
  let text = inline.text;
  for (const m of inline.marks ?? []) {
    text = applyMark(text, m);
  }
  const styleParts: string[] = [];
  if (inline.color && inline.color !== "default") {
    styleParts.push(`color:${inline.color}`);
  }
  if (inline.backgroundColor && inline.backgroundColor !== "default") {
    // Markdown rendering can layer foreground + background simultaneously,
    // unlike Notion. Use a CSS color keyword (the Notion palette name doubles
    // as a valid CSS color for the basic names — and even for the others, most
    // Markdown viewers handle them via CSS fallback).
    styleParts.push(`background-color:${inline.backgroundColor}`);
  }
  if (styleParts.length > 0) {
    text = `<span style="${styleParts.join(";")}">${text}</span>`;
  }
  return text;
}

function applyMark(text: string, mark: Mark): string {
  switch (mark) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "underline":
      return `<u>${text}</u>`;
    case "strike":
      return `~~${text}~~`;
    case "code":
      return `\`${text}\``;
  }
}

function renderTable(
  rows: Block[][][],
  opts: MarkdownRenderOptions,
): string {
  if (rows.length === 0) return "";
  const cellToText = (cell: Block[]) =>
    cell.map((b) => renderBlock(b, opts)).join(" ").replace(/\|/g, "\\|");
  const lines: string[] = [];
  const header = rows[0].map(cellToText);
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(1)) {
    lines.push(`| ${row.map(cellToText).join(" | ")} |`);
  }
  return lines.join("\n");
}
