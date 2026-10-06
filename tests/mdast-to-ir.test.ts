import { describe, expect, it } from "vitest";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { mdastToIr } from "@/sources/local/mdast-to-ir";

function parse(md: string) {
  const tree = remark().use(remarkGfm).parse(md);
  return mdastToIr(tree as any, { assetIds: new Set() });
}

describe("mdastToIr — inline & headings", () => {
  it("renders a paragraph with bold + italic + strike + inline code", () => {
    const { blocks, warnings } = parse("**a** *b* ~~c~~ `d`");
    expect(warnings).toEqual([]);
    expect(blocks).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "a", marks: ["bold"] },
          { type: "text", text: " " },
          { type: "text", text: "b", marks: ["italic"] },
          { type: "text", text: " " },
          { type: "text", text: "c", marks: ["strike"] },
          { type: "text", text: " " },
          { type: "text", text: "d", marks: ["code"] },
        ],
      },
    ]);
  });

  it("renders headings 1..6", () => {
    const { blocks } = parse(
      "# h1\n\n## h2\n\n### h3\n\n#### h4\n\n##### h5\n\n###### h6",
    );
    expect(blocks).toHaveLength(6);
    expect(blocks.map((b: any) => b.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("renders a link with safe http url", () => {
    const { blocks } = parse("[click](https://x.com)");
    expect((blocks[0] as any).inlines[0]).toEqual({
      type: "link",
      href: "https://x.com",
      inlines: [{ type: "text", text: "click" }],
    });
  });

  it("recognises <u>…</u> raw HTML as underline mark", () => {
    const { blocks } = parse("<u>under</u>");
    const inlines = (blocks[0] as any).inlines;
    const hasUnderline = inlines.some((i: any) =>
      i.marks?.includes("underline"),
    );
    expect(hasUnderline).toBe(true);
  });

  it("warns and falls back to text for non-<u> raw HTML", () => {
    const { warnings, blocks } = parse("<div>nope</div>");
    expect(warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(blocks)).toContain("nope");
  });
});

describe("mdastToIr — blocks", () => {
  it("renders unordered list", () => {
    const { blocks } = parse("- a\n- b");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
        ],
      },
    ]);
  });

  it("renders ordered list", () => {
    const { blocks } = parse("1. a\n2. b");
    expect((blocks[0] as any).ordered).toBe(true);
  });

  it("renders fenced code with language", () => {
    const { blocks } = parse("```ts\nconst x=1;\n```");
    expect(blocks[0]).toEqual({
      type: "code",
      language: "ts",
      text: "const x=1;",
    });
  });

  it("renders fenced code without language", () => {
    const { blocks } = parse("```\nplain\n```");
    expect(blocks[0]).toEqual({ type: "code", text: "plain" });
  });

  it("renders blockquote", () => {
    const { blocks } = parse("> quoted");
    expect(blocks).toEqual([
      {
        type: "quote",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "quoted" }] },
        ],
      },
    ]);
  });

  it("renders thematic break", () => {
    const { blocks } = parse("---");
    expect(blocks).toEqual([{ type: "divider" }]);
  });

  it("renders GFM table", () => {
    const { blocks } = parse("| h1 | h2 |\n|---|---|\n| a | b |");
    expect(blocks).toEqual([
      {
        type: "table",
        rows: [
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "h1" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "h2" }] }],
          ],
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
          ],
        ],
      },
    ]);
  });

  it("renders task list as text-prefixed list items", () => {
    const { blocks } = parse("- [x] done\n- [ ] todo");
    const items = (blocks[0] as any).items;
    const firstText = items[0][0].inlines.map((i: any) => i.text).join("");
    expect(firstText).toMatch(/^\[x\] done/);
  });
});

describe("mdastToIr — assets", () => {
  it("matches relative image to an asset id", () => {
    const tree = remark().use(remarkGfm).parse("![shot](images/foo.png)");
    const { blocks, warnings } = mdastToIr(tree as any, {
      assetIds: new Set(["images/foo.png"]),
    });
    expect(warnings).toEqual([]);
    expect(blocks).toEqual([
      { type: "image", assetId: "images/foo.png", alt: "shot" },
    ]);
  });

  it("strips ./ prefix on relative paths", () => {
    const tree = remark().use(remarkGfm).parse("![](./images/foo.png)");
    const { blocks } = mdastToIr(tree as any, {
      assetIds: new Set(["images/foo.png"]),
    });
    expect((blocks[0] as any).assetId).toBe("images/foo.png");
  });

  it("warns and degrades when image asset missing", () => {
    const tree = remark()
      .use(remarkGfm)
      .parse("![alt](images/missing.png)");
    const { blocks, warnings } = mdastToIr(tree as any, {
      assetIds: new Set(),
    });
    expect(warnings.length).toBe(1);
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "alt" }] },
    ]);
  });

  it("treats external https image as ext: synthetic asset", () => {
    const tree = remark()
      .use(remarkGfm)
      .parse("![x](https://example.com/y.png)");
    const { blocks } = mdastToIr(tree as any, { assetIds: new Set() });
    expect(blocks).toEqual([
      {
        type: "image",
        assetId: "ext:https://example.com/y.png",
        alt: "x",
      },
    ]);
  });

  it("treats attachments/ relative link as inline attachmentRef", () => {
    const tree = remark()
      .use(remarkGfm)
      .parse("see [log](attachments/log.txt) here");
    const { blocks } = mdastToIr(tree as any, {
      assetIds: new Set(["attachments/log.txt"]),
    });
    const inlines = (blocks[0] as any).inlines;
    expect(inlines.some((i: any) => i.type === "attachmentRef")).toBe(true);
  });

  it("warns when attachments/ link asset is missing", () => {
    const tree = remark()
      .use(remarkGfm)
      .parse("[log](attachments/missing.txt)");
    const { warnings, blocks } = mdastToIr(tree as any, {
      assetIds: new Set(),
    });
    expect(warnings.length).toBe(1);
    const inlines = (blocks[0] as any).inlines;
    expect(inlines.every((i: any) => i.type === "text")).toBe(true);
  });
});
