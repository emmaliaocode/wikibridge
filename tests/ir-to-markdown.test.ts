import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/destinations/local/ir-to-markdown";
import type { Block } from "@/ir/types";

const render = (blocks: Block[]) =>
  renderMarkdown(blocks, { resolveAssetPath: (id) => `images/${id}.png` });

describe("renderMarkdown - inlines", () => {
  it("renders plain text paragraph", () => {
    const out = render([
      { type: "paragraph", inlines: [{ type: "text", text: "hi" }] },
    ]);
    expect(out.trim()).toBe("hi");
  });

  it("renders all 5 marks", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "b", marks: ["bold"] },
          { type: "text", text: " " },
          { type: "text", text: "i", marks: ["italic"] },
          { type: "text", text: " " },
          { type: "text", text: "u", marks: ["underline"] },
          { type: "text", text: " " },
          { type: "text", text: "s", marks: ["strike"] },
          { type: "text", text: " " },
          { type: "text", text: "c", marks: ["code"] },
        ],
      },
    ]);
    expect(out.trim()).toBe("**b** *i* <u>u</u> ~~s~~ `c`");
  });

  it("renders link", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "https://x",
            inlines: [{ type: "text", text: "go" }],
          },
        ],
      },
    ]);
    expect(out.trim()).toBe("[go](https://x)");
  });

  it("wraps colored text in a span", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [{ type: "text", text: "warn", color: "red" }],
      },
    ]);
    expect(out.trim()).toBe('<span style="color:red">warn</span>');
  });

  it("wraps colored + highlighted text in a span with both styles", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          {
            type: "text",
            text: "x",
            color: "red",
            backgroundColor: "yellow",
          },
        ],
      },
    ]);
    expect(out.trim()).toBe(
      '<span style="color:red;background-color:yellow">x</span>',
    );
  });

  it("wraps highlight-only text in a span with background-color only", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [{ type: "text", text: "x", backgroundColor: "pink" }],
      },
    ]);
    expect(out.trim()).toBe('<span style="background-color:pink">x</span>');
  });
});

describe("renderMarkdown - blocks", () => {
  it("renders headings 1..6", () => {
    const blocks: Block[] = [1, 2, 3, 4, 5, 6].map(
      (n) =>
        ({
          type: "heading",
          level: n as 1 | 2 | 3 | 4 | 5 | 6,
          inlines: [{ type: "text", text: `H${n}` }],
        }) as Block,
    );
    expect(render(blocks).trim()).toBe(
      "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6",
    );
  });

  it("renders unordered and ordered lists", () => {
    const out = render([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "x" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "y" }] }],
        ],
      },
    ]);
    expect(out).toContain("- a\n- b");
    expect(out).toContain("1. x\n2. y");
  });

  it("renders code block with language fence", () => {
    const out = render([{ type: "code", language: "ts", text: "const x = 1;" }]);
    expect(out.trim()).toBe("```ts\nconst x = 1;\n```");
  });

  it("renders callout variants with bracketed prefix", () => {
    const out = render([
      {
        type: "callout",
        variant: "warning",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "watch out" }] },
        ],
      },
    ]);
    expect(out.trim()).toBe("> [warning] watch out");
  });

  it("renders divider", () => {
    expect(render([{ type: "divider" }]).trim()).toBe("---");
  });

  it("renders image with resolved path", () => {
    const out = render([{ type: "image", assetId: "abc", alt: "diagram" }]);
    expect(out.trim()).toBe("![diagram](images/abc.png)");
  });

  it("renders toggle as <details> with title in <summary>", () => {
    const out = render([
      {
        type: "toggle",
        title: "Click me",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "secret" }] },
        ],
      },
    ]);
    expect(out).toContain("<details>");
    expect(out).toContain("<summary>Click me</summary>");
    expect(out).toContain("secret");
    expect(out).toContain("</details>");
  });

  it("uses 'Details' as default summary when title is empty", () => {
    const out = render([
      { type: "toggle", title: "", blocks: [] },
    ]);
    expect(out).toContain("<summary>Details</summary>");
  });
});
