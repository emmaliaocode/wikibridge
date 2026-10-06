import { describe, expect, it } from "vitest";
import { notionBlocksToIr } from "@/sources/notion/notion-blocks-to-ir";

function rt(text: string, ann: Record<string, boolean> = {}, link?: string) {
  return {
    type: "text",
    text: { content: text, link: link ? { url: link } : null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      ...ann,
    },
    plain_text: text,
    href: link ?? null,
  };
}

describe("notionBlocksToIr — inline & headings", () => {
  it("renders paragraph with marks and link", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            rt("plain "),
            rt("bold", { bold: true }),
            rt(" "),
            rt("link", {}, "https://x.com"),
          ],
        },
      },
    ]);
    expect(blocks).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "plain " },
          { type: "text", text: "bold", marks: ["bold"] },
          { type: "text", text: " " },
          {
            type: "link",
            href: "https://x.com",
            inlines: [{ type: "text", text: "link" }],
          },
        ],
      },
    ]);
  });

  it("renders heading_1/2/3", () => {
    const { blocks } = notionBlocksToIr([
      { type: "heading_1", heading_1: { rich_text: [rt("H1")] } },
      { type: "heading_2", heading_2: { rich_text: [rt("H2")] } },
      { type: "heading_3", heading_3: { rich_text: [rt("H3")] } },
    ]);
    expect(blocks.map((b: any) => b.level)).toEqual([1, 2, 3]);
  });
});

describe("notionBlocksToIr — lists", () => {
  it("groups consecutive bulleted_list_item into one list", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [rt("a")] },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [rt("b")] },
      },
      { type: "paragraph", paragraph: { rich_text: [rt("p")] } },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [rt("c")] },
      },
    ]);
    expect(blocks).toHaveLength(3);
    expect((blocks[0] as any).ordered).toBe(false);
    expect((blocks[0] as any).items).toHaveLength(2);
    expect((blocks[2] as any).items).toHaveLength(1);
  });

  it("renders numbered list", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [rt("1")] },
      },
    ]);
    expect((blocks[0] as any).ordered).toBe(true);
  });

  it("renders to_do as text-prefixed list", () => {
    const { blocks } = notionBlocksToIr([
      { type: "to_do", to_do: { rich_text: [rt("done")], checked: true } },
      { type: "to_do", to_do: { rich_text: [rt("todo")], checked: false } },
    ]);
    const items = (blocks[0] as any).items;
    expect(JSON.stringify(items[0])).toContain("[x] ");
    expect(JSON.stringify(items[1])).toContain("[ ] ");
  });
});

describe("notionBlocksToIr — misc blocks", () => {
  it("renders code with language", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "code",
        code: { rich_text: [rt("const x=1")], language: "typescript" },
      },
    ]);
    expect(blocks[0]).toEqual({
      type: "code",
      language: "typescript",
      text: "const x=1",
    });
  });

  it("renders quote with nested children", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "quote",
        quote: { rich_text: [rt("quoted")] },
        children: [
          { type: "paragraph", paragraph: { rich_text: [rt("inside")] } },
        ],
      },
    ]);
    expect(blocks[0]).toMatchObject({
      type: "quote",
      blocks: [
        { type: "paragraph", inlines: [{ type: "text", text: "quoted" }] },
        { type: "paragraph", inlines: [{ type: "text", text: "inside" }] },
      ],
    });
  });

  it("renders divider", () => {
    const { blocks } = notionBlocksToIr([{ type: "divider", divider: {} }]);
    expect(blocks).toEqual([{ type: "divider" }]);
  });
});

describe("notionBlocksToIr — callouts & table", () => {
  it.each([
    ["blue_background", "info"],
    ["yellow_background", "warning"],
    ["green_background", "success"],
    ["red_background", "note"],
  ])("maps callout color %s → variant %s", (color, variant) => {
    const { blocks } = notionBlocksToIr([
      {
        type: "callout",
        callout: { rich_text: [rt("hi")], color },
      },
    ]);
    expect((blocks[0] as any).variant).toBe(variant);
  });

  it("renders a 2x2 table from table_row children", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "table",
        table: { table_width: 2, has_column_header: true },
        children: [
          {
            type: "table_row",
            table_row: {
              cells: [[rt("h1")], [rt("h2")]],
            },
          },
          {
            type: "table_row",
            table_row: {
              cells: [[rt("a")], [rt("b")]],
            },
          },
        ],
      },
    ]);
    expect(blocks[0]).toEqual({
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
    });
  });
});

describe("notionBlocksToIr — media", () => {
  it("creates an image block and a mediaRef", () => {
    const { blocks, mediaRefs } = notionBlocksToIr([
      {
        id: "blk-1",
        type: "image",
        image: {
          type: "file",
          file: { url: "https://files.notion/abc/pic.png" },
        },
      },
    ]);
    expect(blocks).toEqual([
      { type: "image", assetId: "notion-blk-1", alt: "" },
    ]);
    expect(mediaRefs).toEqual([
      {
        blockId: "notion-blk-1",
        kind: "image",
        url: "https://files.notion/abc/pic.png",
        filename: "pic.png",
      },
    ]);
  });

  it("creates an attachment block and mediaRef for pdf", () => {
    const { blocks, mediaRefs } = notionBlocksToIr([
      {
        id: "blk-2",
        type: "pdf",
        pdf: {
          type: "external",
          external: { url: "https://example.com/doc.pdf" },
        },
      },
    ]);
    expect(blocks).toEqual([
      { type: "attachment", assetId: "notion-blk-2", filename: "doc.pdf" },
    ]);
    expect(mediaRefs[0].kind).toBe("file");
  });

  it("falls back when image has no source", () => {
    const { blocks } = notionBlocksToIr([
      { id: "x", type: "image", image: { type: "file" } },
    ]);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "[image: missing source]" }],
    });
  });
});

describe("notionBlocksToIr — fallbacks", () => {
  it("renders unknown block as [type] paragraph + warning", () => {
    const { blocks, warnings } = notionBlocksToIr([
      { type: "synced_block", synced_block: {} },
    ]);
    expect(warnings).toContain("unsupported notion block: synced_block");
    expect(blocks[0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "[synced_block]" }],
    });
  });
});
