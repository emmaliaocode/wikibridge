import type { Block, Inline, Mark } from "@/ir/types";
import {
  escapeText,
  escapeAttr,
  escapeCdata,
  safeUrl,
  safeFilename,
} from "./escape";

export type AssetResolver = (assetId: string) => string | null;

export type RenderOptions = {
  assetResolver: AssetResolver;
};

const MARK_TAGS: Record<Mark, [string, string]> = {
  bold: ["<strong>", "</strong>"],
  italic: ["<em>", "</em>"],
  underline: ["<u>", "</u>"],
  strike: ["<s>", "</s>"],
  code: ["<code>", "</code>"],
};

// Wrap order: marks listed first become the innermost tags. Bold is innermost,
// italic wraps it, then underline, etc. — matches the IR.test expectation
// `<em><strong>world</strong></em>` for ["bold", "italic"].
const MARK_ORDER: Mark[] = ["bold", "italic", "underline", "strike", "code"];

function renderInline(inline: Inline, opts: RenderOptions): string {
  switch (inline.type) {
    case "text": {
      let out = escapeText(inline.text);
      const marks = inline.marks ?? [];
      for (const m of MARK_ORDER) {
        if (marks.includes(m)) {
          const [open, close] = MARK_TAGS[m];
          out = `${open}${out}${close}`;
        }
      }
      return out;
    }
    case "link": {
      const href = escapeAttr(safeUrl(inline.href));
      const body = inline.inlines.map((i) => renderInline(i, opts)).join("");
      return `<a href="${href}">${body}</a>`;
    }
    case "attachmentRef": {
      const filename = opts.assetResolver(inline.assetId);
      const body = inline.inlines.map((i) => renderInline(i, opts)).join("");
      if (!filename) return body;
      return `<ac:link><ri:attachment ri:filename="${safeFilename(filename)}"/><ac:link-body>${body}</ac:link-body></ac:link>`;
    }
  }
}

function renderInlines(inlines: Inline[], opts: RenderOptions): string {
  return inlines.map((i) => renderInline(i, opts)).join("");
}

function renderBlock(block: Block, opts: RenderOptions): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${renderInlines(block.inlines, opts)}</h${block.level}>`;
    case "paragraph":
      return `<p>${renderInlines(block.inlines, opts)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map(
          (itemBlocks) =>
            `<li>${itemBlocks.map((b) => renderBlock(b, opts)).join("")}</li>`,
        )
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "code": {
      const lang = escapeText(block.language ?? "none");
      const body = `<![CDATA[${escapeCdata(block.text)}]]>`;
      return (
        `<ac:structured-macro ac:name="code">` +
        `<ac:parameter ac:name="language">${lang}</ac:parameter>` +
        `<ac:plain-text-body>${body}</ac:plain-text-body>` +
        `</ac:structured-macro>`
      );
    }
    case "quote":
      return `<blockquote>${block.blocks.map((b) => renderBlock(b, opts)).join("")}</blockquote>`;
    case "callout": {
      const macro = block.variant === "success" ? "tip" : block.variant;
      const inner = block.blocks.map((b) => renderBlock(b, opts)).join("");
      return `<ac:structured-macro ac:name="${macro}"><ac:rich-text-body>${inner}</ac:rich-text-body></ac:structured-macro>`;
    }
    case "table": {
      const rows = block.rows
        .map((row) => {
          const cells = row
            .map(
              (cellBlocks) =>
                `<td>${cellBlocks.map((b) => renderBlock(b, opts)).join("")}</td>`,
            )
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table><tbody>${rows}</tbody></table>`;
    }
    case "image": {
      const resolved = opts.assetResolver(block.assetId);
      const alt = escapeAttr(block.alt ?? "");
      if (resolved) {
        return `<ac:image ac:alt="${alt}"><ri:attachment ri:filename="${safeFilename(resolved)}"/></ac:image>`;
      }
      if (block.assetId.startsWith("ext:")) {
        const url = escapeAttr(safeUrl(block.assetId.slice(4)));
        return `<ac:image ac:alt="${alt}"><ri:url ri:value="${url}"/></ac:image>`;
      }
      return `<p><em>[Failed to upload image: ${escapeText(block.alt ?? block.assetId)}]</em></p>`;
    }
    case "attachment": {
      const resolved = opts.assetResolver(block.assetId);
      if (!resolved) {
        return `<p><em>[Failed to upload attachment: ${escapeText(block.filename)}]</em></p>`;
      }
      const fname = safeFilename(resolved);
      return `<p><ac:link><ri:attachment ri:filename="${fname}"/><ac:plain-text-link-body><![CDATA[${escapeCdata(block.filename)}]]></ac:plain-text-link-body></ac:link></p>`;
    }
    case "toggle": {
      // No native Confluence equivalent in v1; render summary + body as a
      // blockquote with the title as a leading paragraph (matches the
      // notion-source toggle handling described in the spec).
      const summary = block.title.length > 0 ? block.title : "Details";
      const inner =
        `<p>▸ ${escapeText(summary)}</p>` +
        block.blocks.map((b) => renderBlock(b, opts)).join("");
      return `<blockquote>${inner}</blockquote>`;
    }
    case "divider":
      return "<hr/>";
  }
}

export function irToStorage(blocks: Block[], opts: RenderOptions): string {
  return blocks.map((b) => renderBlock(b, opts)).join("");
}
