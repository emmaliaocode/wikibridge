import { describe, expect, it } from "vitest";
import {
  capNestingDepth,
  irToNotionBlocks,
  sanitizeLinks,
} from "@/destinations/notion/ir-to-notion";
import type { Block } from "@/ir/types";

const resolve = (id: string) => `upload-${id}`;

describe("irToNotionBlocks - inlines and basics", () => {
  it("renders heading_1..heading_4; H5/H6 collapse to heading_4", () => {
    const blocks: Block[] = [1, 2, 3, 4, 5, 6].map((n) => ({
      type: "heading",
      level: n as 1 | 2 | 3 | 4 | 5 | 6,
      inlines: [{ type: "text", text: `H${n}` }],
    })) as Block[];
    const out = irToNotionBlocks(blocks, resolve);
    expect(out[0].type).toBe("heading_1");
    expect(out[1].type).toBe("heading_2");
    expect(out[2].type).toBe("heading_3");
    expect(out[3].type).toBe("heading_4");
    // H5/H6 collapse to heading_4
    expect(out[4].type).toBe("heading_4");
    expect(out[5].type).toBe("heading_4");
  });

  it("renders rich_text with annotations for marks", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "paragraph",
          inlines: [
            { type: "text", text: "b", marks: ["bold"] },
            { type: "text", text: "i", marks: ["italic"] },
            { type: "text", text: "u", marks: ["underline"] },
            { type: "text", text: "s", marks: ["strike"] },
            { type: "text", text: "c", marks: ["code"] },
          ],
        },
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text;
    expect(rt[0].annotations).toMatchObject({ bold: true });
    expect(rt[1].annotations).toMatchObject({ italic: true });
    expect(rt[2].annotations).toMatchObject({ underline: true });
    expect(rt[3].annotations).toMatchObject({ strikethrough: true });
    expect(rt[4].annotations).toMatchObject({ code: true });
  });

  it("renders link via text.link.url", () => {
    const out = irToNotionBlocks(
      [
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
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text[0];
    expect(rt.text.content).toBe("go");
    expect(rt.text.link).toEqual({ url: "https://x" });
  });

  it("renders bulleted_list_item / numbered_list_item", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: false,
          items: [
            [
              {
                type: "paragraph",
                inlines: [{ type: "text", text: "a" }],
              },
            ],
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              {
                type: "paragraph",
                inlines: [{ type: "text", text: "1" }],
              },
            ],
          ],
        },
      ],
      resolve,
    );
    expect(out[0].type).toBe("bulleted_list_item");
    expect(out[1].type).toBe("numbered_list_item");
  });

  it("text-only ordered list still uses Notion numbered_list_item blocks", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: true,
          items: [
            [{ type: "paragraph", inlines: [{ type: "text", text: "first" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "second" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "third" }] }],
          ],
        },
      ],
      resolve,
    );
    expect(out).toHaveLength(3);
    expect(out[0].type).toBe("numbered_list_item");
    expect(out[1].type).toBe("numbered_list_item");
    expect(out[2].type).toBe("numbered_list_item");
  });

  it("ordered list with an image inside an item falls back to manual numbering", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: true,
          items: [
            [
              { type: "paragraph", inlines: [{ type: "text", text: "First step." }] },
              { type: "image", assetId: "img-A", alt: "diagram" },
            ],
            [
              { type: "paragraph", inlines: [{ type: "text", text: "Second step." }] },
            ],
          ],
        },
      ],
      resolve,
    );
    expect(out).toHaveLength(3);
    expect(out[0].type).toBe("paragraph");
    expect(
      ((out[0] as any).paragraph.rich_text as Array<{ text: { content: string } }>)
        .map((rt) => rt.text.content)
        .join(""),
    ).toBe("1. First step.");
    expect(out[1].type).toBe("image");
    expect(out[2].type).toBe("paragraph");
    expect(
      ((out[2] as any).paragraph.rich_text as Array<{ text: { content: string } }>)
        .map((rt) => rt.text.content)
        .join(""),
    ).toBe("2. Second step.");
  });

  it("ordered list with a code-block item falls back to manual numbering", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: true,
          items: [
            [
              { type: "paragraph", inlines: [{ type: "text", text: "Run:" }] },
              { type: "code", language: "sh", text: "echo hi" },
            ],
            [{ type: "paragraph", inlines: [{ type: "text", text: "Done." }] }],
          ],
        },
      ],
      resolve,
    );
    expect(out).toHaveLength(3);
    expect(out[0].type).toBe("paragraph");
    expect(out[1].type).toBe("code");
    expect(out[2].type).toBe("paragraph");
    expect(
      ((out[2] as any).paragraph.rich_text as Array<{ text: { content: string } }>)
        .map((rt) => rt.text.content)
        .join(""),
    ).toBe("2. Done.");
  });

  it("manual numbering preserves leading-text annotations on first inline", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: true,
          items: [
            [
              {
                type: "paragraph",
                inlines: [
                  { type: "text", text: "Bold", marks: ["bold"] },
                  { type: "text", text: " rest." },
                ],
              },
              { type: "image", assetId: "img-1", alt: "" },
            ],
          ],
        },
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text as Array<{
      text: { content: string };
      annotations?: { bold?: boolean };
    }>;
    expect(rt[0].text.content).toBe("1. ");
    expect(rt[0].annotations).toBeUndefined();
    expect(rt[1].text.content).toBe("Bold");
    expect(rt[1].annotations).toMatchObject({ bold: true });
    expect(rt[2].text.content).toBe(" rest.");
  });

  it("bulleted list with an image inside an item is unaffected", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: false,
          items: [
            [
              { type: "paragraph", inlines: [{ type: "text", text: "first" }] },
              { type: "image", assetId: "img-X", alt: "" },
            ],
            [{ type: "paragraph", inlines: [{ type: "text", text: "second" }] }],
          ],
        },
      ],
      resolve,
    );
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("bulleted_list_item");
    expect(out[1].type).toBe("bulleted_list_item");
    const item0Children = (out[0] as any).bulleted_list_item.children;
    expect(item0Children).toHaveLength(1);
    expect(item0Children[0].type).toBe("image");
  });

  it("maps unknown/aliased code languages to valid Notion enum values", () => {
    const lang = (input: string | undefined) =>
      (
        irToNotionBlocks(
          [{ type: "code", language: input, text: "x" } as Block],
          resolve,
        )[0] as any
      ).code.language;

    // Confluence's "plaintext" must become Notion's "plain text".
    expect(lang("plaintext")).toBe("plain text");
    expect(lang("text")).toBe("plain text");
    // Unrecognized languages fall back to plain text rather than 400-ing.
    expect(lang("actionscript3")).toBe("plain text");
    expect(lang(undefined)).toBe("plain text");
    expect(lang("")).toBe("plain text");
    // Aliases resolve to their Notion names.
    expect(lang("cpp")).toBe("c++");
    expect(lang("yml")).toBe("yaml");
    expect(lang("CSharp")).toBe("c#");
    // Already-valid values pass through untouched.
    expect(lang("python")).toBe("python");
    expect(lang("c#")).toBe("c#");
  });

  it("renders code block with language", () => {
    const out = irToNotionBlocks(
      [{ type: "code", language: "ts", text: "x" }],
      resolve,
    );
    expect(out[0]).toMatchObject({
      type: "code",
      code: { language: "typescript", rich_text: [{ text: { content: "x" } }] },
    });
  });

  it("renders callout variants", () => {
    const variants: Array<["info" | "note" | "warning" | "success", string]> = [
      ["info", "blue_background"],
      ["note", "gray_background"],
      ["warning", "yellow_background"],
      ["success", "green_background"],
    ];
    for (const [v, color] of variants) {
      const out = irToNotionBlocks(
        [
          {
            type: "callout",
            variant: v,
            blocks: [
              {
                type: "paragraph",
                inlines: [{ type: "text", text: "x" }],
              },
            ],
          },
        ],
        resolve,
      );
      expect(out[0].type).toBe("callout");
      expect((out[0] as any).callout.color).toBe(color);
    }
  });

  it("renders divider", () => {
    expect(
      irToNotionBlocks([{ type: "divider" }], resolve)[0],
    ).toMatchObject({ type: "divider" });
  });

  it("renders image block referencing the resolved file upload id", () => {
    const out = irToNotionBlocks(
      [{ type: "image", assetId: "asset-A", alt: "x" }],
      resolve,
    );
    expect(out[0]).toMatchObject({
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: "upload-asset-A" },
      },
    });
  });

  it("renders file block for attachment", () => {
    const out = irToNotionBlocks(
      [{ type: "attachment", assetId: "asset-B", filename: "doc.pdf" }],
      resolve,
    );
    expect(out[0]).toMatchObject({
      type: "file",
      file: {
        type: "file_upload",
        file_upload: { id: "upload-asset-B" },
      },
    });
  });

  it("emits annotations.color when text is colored", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "paragraph",
          inlines: [{ type: "text", text: "danger", color: "red" }],
        },
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text[0];
    expect(rt.annotations).toMatchObject({ color: "red" });
  });

  it("emits annotations.color = '<name>_background' when text has a background color", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "paragraph",
          inlines: [{ type: "text", text: "hl", backgroundColor: "pink" }],
        },
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text[0];
    expect(rt.annotations).toMatchObject({ color: "pink_background" });
  });

  it("background color wins over foreground color when both are present", () => {
    const out = irToNotionBlocks(
      [
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
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text[0];
    expect(rt.annotations).toMatchObject({ color: "yellow_background" });
  });

  it("splits text longer than 2000 chars into multiple rich_text spans", () => {
    const long = "word ".repeat(600); // 3000 chars
    const out = irToNotionBlocks(
      [
        {
          type: "paragraph",
          inlines: [{ type: "text", text: long, marks: ["bold"] }],
        },
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text as Array<{
      text: { content: string };
      annotations?: { bold?: boolean };
    }>;
    expect(rt.length).toBeGreaterThan(1);
    for (const span of rt) {
      expect(span.text.content.length).toBeLessThanOrEqual(2000);
      // Annotations propagate to each chunk.
      expect(span.annotations).toMatchObject({ bold: true });
    }
    // Concatenated content equals the original input.
    expect(rt.map((s) => s.text.content).join("")).toBe(long);
  });

  it("does not split text that is exactly at or below 2000 chars", () => {
    const exact = "a".repeat(2000);
    const out = irToNotionBlocks(
      [{ type: "paragraph", inlines: [{ type: "text", text: exact }] }],
      resolve,
    );
    expect((out[0] as any).paragraph.rich_text).toHaveLength(1);
  });

  it("renders toggle block with title in rich_text and nested children", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "toggle",
          title: "More",
          blocks: [
            { type: "paragraph", inlines: [{ type: "text", text: "hidden" }] },
          ],
        },
      ],
      resolve,
    );
    expect(out[0]).toMatchObject({
      type: "toggle",
      toggle: {
        rich_text: [{ text: { content: "More" } }],
        children: [
          {
            type: "paragraph",
            paragraph: { rich_text: [{ text: { content: "hidden" } }] },
          },
        ],
      },
    });
  });

  it("toggle with empty title produces empty rich_text array", () => {
    const out = irToNotionBlocks(
      [{ type: "toggle", title: "", blocks: [] }],
      resolve,
    );
    expect((out[0] as any).toggle.rich_text).toEqual([]);
  });

  it("splits long code block text across multiple rich_text spans", () => {
    // 600 lines of code totaling ~3600 chars
    const longCode = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
    const out = irToNotionBlocks(
      [{ type: "code", language: "ts", text: longCode }],
      resolve,
    );
    const rt = (out[0] as any).code.rich_text as Array<{
      text: { content: string };
    }>;
    expect(rt.length).toBeGreaterThan(1);
    for (const span of rt) {
      expect(span.text.content.length).toBeLessThanOrEqual(2000);
    }
    // Reassembled content equals the original.
    expect(rt.map((s) => s.text.content).join("")).toBe(longCode);
  });

  it("short code block stays as a single rich_text span", () => {
    const out = irToNotionBlocks(
      [{ type: "code", language: "ts", text: "const x = 1;" }],
      resolve,
    );
    expect((out[0] as any).code.rich_text).toHaveLength(1);
  });

  it("hoists attachments out of table cells and appends them under an Attachments section at page bottom", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "paragraph",
          inlines: [{ type: "text", text: "intro" }],
        },
        {
          type: "table",
          rows: [
            [
              // header row
              [{ type: "paragraph", inlines: [{ type: "text", text: "Doc" }] }],
              [{ type: "paragraph", inlines: [{ type: "text", text: "Owner" }] }],
            ],
            [
              // body row
              [
                { type: "paragraph", inlines: [{ type: "text", text: "see " }] },
                { type: "attachment", assetId: "att-A", filename: "report.pdf" },
              ],
              [{ type: "paragraph", inlines: [{ type: "text", text: "Alice" }] }],
            ],
          ],
        },
      ],
      resolve,
    );

    // 1. Page-top blocks: paragraph, table.
    expect(out[0].type).toBe("paragraph");
    expect(out[1].type).toBe("table");

    // 2. Cell that held the attachment now references it as italic [filename] text.
    const table = out[1] as any;
    const cellWithAttachment = table.table.children[1].table_row.cells[0];
    const concatenated = cellWithAttachment
      .map((rt: any) => rt.text.content)
      .join("");
    expect(concatenated).toContain("see");
    expect(concatenated).toContain("[report.pdf]");

    // 3. After the table comes divider + heading + the hoisted file block.
    expect(out[2]).toMatchObject({ type: "divider" });
    expect(out[3]).toMatchObject({
      type: "heading_2",
      heading_2: {
        rich_text: [{ text: { content: "Attachments" } }],
      },
    });
    expect(out[4]).toMatchObject({
      type: "file",
      file: { type: "file_upload", file_upload: { id: "upload-att-A" } },
    });
  });

  it("hoists images out of table cells and labels them by alt text", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [{ type: "paragraph", inlines: [{ type: "text", text: "Pic" }] }],
            ],
            [
              [{ type: "image", assetId: "img-Q", alt: "diagram" }],
            ],
          ],
        },
      ],
      resolve,
    );

    const cell = (out[0] as any).table.children[1].table_row.cells[0];
    const concatenated = cell.map((rt: any) => rt.text.content).join("");
    expect(concatenated).toBe("[diagram]");

    expect(out[1].type).toBe("divider");
    expect(out[2].type).toBe("heading_2");
    expect(out[3]).toMatchObject({
      type: "image",
      image: { type: "file_upload", file_upload: { id: "upload-img-Q" } },
    });
  });

  it("does NOT add an Attachments section when no table contains hoistable blocks", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [{ type: "paragraph", inlines: [{ type: "text", text: "A" }] }],
              [{ type: "paragraph", inlines: [{ type: "text", text: "B" }] }],
            ],
          ],
        },
      ],
      resolve,
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("table");
  });

  it("falls back to image label 'image' when alt is empty", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [{ type: "image", assetId: "img-X", alt: "" }],
            ],
          ],
        },
      ],
      resolve,
    );
    const cell = (out[0] as any).table.children[0].table_row.cells[0];
    const concatenated = cell.map((rt: any) => rt.text.content).join("");
    expect(concatenated).toBe("[image]");
  });

  it("disambiguates duplicate attachment filenames with (2), (3) suffixes", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [{ type: "paragraph", inlines: [{ type: "text", text: "h" }] }],
            ],
            [
              [{ type: "attachment", assetId: "att-1", filename: "screenshot.png" }],
            ],
            [
              [{ type: "attachment", assetId: "att-2", filename: "screenshot.png" }],
            ],
            [
              [{ type: "attachment", assetId: "att-3", filename: "screenshot.png" }],
            ],
          ],
        },
      ],
      resolve,
    );

    const table = out[0] as any;
    const cell1 = table.table.children[1].table_row.cells[0];
    const cell2 = table.table.children[2].table_row.cells[0];
    const cell3 = table.table.children[3].table_row.cells[0];

    expect(cell1.map((rt: any) => rt.text.content).join("")).toBe("[screenshot.png]");
    expect(cell2.map((rt: any) => rt.text.content).join("")).toBe("[screenshot.png (2)]");
    expect(cell3.map((rt: any) => rt.text.content).join("")).toBe("[screenshot.png (3)]");

    // Bottom Attachments section: three file blocks with matching names.
    // Layout: out[0]=table, out[1]=divider, out[2]=heading, out[3..5]=file blocks
    expect((out[3] as any).file.name).toBe("screenshot.png");
    expect((out[4] as any).file.name).toBe("screenshot.png (2)");
    expect((out[5] as any).file.name).toBe("screenshot.png (3)");

    // file_upload IDs still come from the original assetIds.
    expect((out[3] as any).file.file_upload.id).toBe("upload-att-1");
    expect((out[4] as any).file.file_upload.id).toBe("upload-att-2");
    expect((out[5] as any).file.file_upload.id).toBe("upload-att-3");
  });

  it("disambiguates duplicate image labels (alt-based) with (2), (3)", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [{ type: "image", assetId: "img-A", alt: "diagram" }],
              [{ type: "image", assetId: "img-B", alt: "diagram" }],
            ],
          ],
        },
      ],
      resolve,
    );
    const row = (out[0] as any).table.children[0].table_row;
    expect(row.cells[0].map((rt: any) => rt.text.content).join("")).toBe("[diagram]");
    expect(row.cells[1].map((rt: any) => rt.text.content).join("")).toBe("[diagram (2)]");
  });

  it("disambiguates empty-alt images via the 'image' fallback label", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [{ type: "image", assetId: "img-1", alt: "" }],
              [{ type: "image", assetId: "img-2", alt: "" }],
            ],
          ],
        },
      ],
      resolve,
    );
    const row = (out[0] as any).table.children[0].table_row;
    expect(row.cells[0].map((rt: any) => rt.text.content).join("")).toBe("[image]");
    expect(row.cells[1].map((rt: any) => rt.text.content).join("")).toBe("[image (2)]");
  });

  it("does not modify a unique attachment filename", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [{ type: "attachment", assetId: "att-only", filename: "report.pdf" }],
            ],
          ],
        },
      ],
      resolve,
    );
    const cell = (out[0] as any).table.children[0].table_row.cells[0];
    expect(cell.map((rt: any) => rt.text.content).join("")).toBe("[report.pdf]");
    // Bottom file block uses the un-suffixed name.
    expect((out[3] as any).file.name).toBe("report.pdf");
  });

  it("pads ragged rows so every row matches table_width", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            // A short header row (e.g. from a merged/colspan cell)...
            [[{ type: "paragraph", inlines: [{ type: "text", text: "H" }] }]],
            // ...and a wider body row.
            [
              [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
              [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
              [{ type: "paragraph", inlines: [{ type: "text", text: "c" }] }],
            ],
          ],
        },
      ],
      resolve,
    );
    const table = out[0] as any;
    expect(table.table.table_width).toBe(3);
    for (const child of table.table.children) {
      expect(child.table_row.cells).toHaveLength(3);
    }
    // Padding cells are valid (single empty rich_text element).
    const headerCells = table.table.children[0].table_row.cells;
    expect(headerCells[1]).toEqual([{ type: "text", text: { content: "" } }]);
    expect(headerCells[2]).toEqual([{ type: "text", text: { content: "" } }]);
  });

  it("emits an empty paragraph (not a 0-width table) for a table with no rows", () => {
    const out = irToNotionBlocks([{ type: "table", rows: [] }], resolve);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("paragraph");
  });
});

describe("capNestingDepth - Notion 2-level nesting limit", () => {
  // Build a bulleted list nested 4 levels deep: L0 > L1 > L2 > L3.
  const deepList: Block = {
    type: "list",
    ordered: false,
    items: [
      [
        { type: "paragraph", inlines: [{ type: "text", text: "L0" }] },
        {
          type: "list",
          ordered: false,
          items: [
            [
              { type: "paragraph", inlines: [{ type: "text", text: "L1" }] },
              {
                type: "list",
                ordered: false,
                items: [
                  [
                    {
                      type: "paragraph",
                      inlines: [{ type: "text", text: "L2" }],
                    },
                    {
                      type: "list",
                      ordered: false,
                      items: [
                        [
                          {
                            type: "paragraph",
                            inlines: [{ type: "text", text: "L3" }],
                          },
                        ],
                      ],
                    },
                  ],
                ],
              },
            ],
          ],
        },
      ],
    ],
  };

  const text = (block: any): string =>
    block.bulleted_list_item.rich_text.map((rt: any) => rt.text.content).join("");

  it("keeps blocks within the limit unchanged", () => {
    const raw = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: false,
          items: [
            [
              { type: "paragraph", inlines: [{ type: "text", text: "a" }] },
              {
                type: "list",
                ordered: false,
                items: [
                  [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
                ],
              },
            ],
          ],
        },
      ],
      resolve,
    );
    // Within the 2-level limit (top + 1 nested): capping is a no-op.
    expect(capNestingDepth(raw)).toEqual(raw);
  });

  it("flattens nesting deeper than 2 levels without dropping content", () => {
    const capped = capNestingDepth(irToNotionBlocks([deepList], resolve));

    // Top level: single L0 item.
    expect(capped).toHaveLength(1);
    expect(text(capped[0])).toBe("L0");

    // L0 > L1 (depth 1) still nested.
    const l1 = (capped[0] as any).bulleted_list_item.children;
    expect(l1).toHaveLength(1);
    expect(text(l1[0])).toBe("L1");

    // L1's children: L2 was at the depth limit, so L3 is hoisted to sit
    // alongside L2 instead of nested beneath it.
    const l1Children = l1[0].bulleted_list_item.children;
    expect(l1Children.map(text)).toEqual(["L2", "L3"]);

    // Neither L2 nor L3 carries a children array (would exceed the limit).
    expect(l1Children[0].bulleted_list_item.children).toBeUndefined();
    expect(l1Children[1].bulleted_list_item.children).toBeUndefined();
  });
});

describe("sanitizeLinks - Notion URL validation", () => {
  const para = (inlines: any[]): Block => ({ type: "paragraph", inlines });
  const link = (href: string): Block =>
    para([{ type: "link", href, inlines: [{ type: "text", text: "T" }] }]);
  const base = "https://acme.atlassian.net/wiki/spaces/X/pages/1/Page";

  const firstInline = (blocks: Block[]): any =>
    (blocks[0] as any).inlines[0];

  it("keeps absolute http(s) links unchanged", () => {
    const out = sanitizeLinks([link("https://example.com/a")], base);
    expect(firstInline(out)).toMatchObject({
      type: "link",
      href: "https://example.com/a",
    });
  });

  it("resolves a root-relative link against the source page URL", () => {
    const out = sanitizeLinks([link("/wiki/spaces/Y/pages/9")], base);
    expect(firstInline(out).href).toBe(
      "https://acme.atlassian.net/wiki/spaces/Y/pages/9",
    );
  });

  it("resolves a bare anchor against the source page URL", () => {
    const out = sanitizeLinks([link("#section-2")], base);
    expect(firstInline(out).href).toBe(`${base}#section-2`);
  });

  it("unwraps an unresolvable/empty link but keeps its text", () => {
    const out = sanitizeLinks([link("")], base);
    const inline = firstInline(out);
    expect(inline.type).toBe("text");
    expect(inline.text).toBe("T");
  });

  it("drops unsupported schemes (e.g. javascript:) but keeps text", () => {
    const out = sanitizeLinks([link("javascript:alert(1)")], base);
    expect(firstInline(out).type).toBe("text");
  });

  it("recurses into list items, tables, and nested blocks", () => {
    const out = sanitizeLinks(
      [
        {
          type: "table",
          rows: [[[link("/wiki/deep")]]],
        },
      ],
      base,
    );
    const cellBlock = (out[0] as any).rows[0][0][0];
    expect(cellBlock.inlines[0].href).toBe(
      "https://acme.atlassian.net/wiki/deep",
    );
  });

  it("guards at render time: irToNotionBlocks drops an invalid link, keeps text", () => {
    // No sanitizeLinks pass here — exercise the inlineToRichText safety net.
    const out = irToNotionBlocks(
      [para([{ type: "link", href: "/relative", inlines: [{ type: "text", text: "go" }] }])],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text[0];
    expect(rt.text.content).toBe("go");
    expect(rt.text.link).toBeUndefined();
  });
});

describe("cellToRichText - block content inside table cells", () => {
  const cellText = (out: any): string =>
    out[0].table.children[0].table_row.cells[0]
      .map((rt: any) => rt.text.content)
      .join("");

  it("renders a bullet list inside a cell as newline-separated bullet text", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [
                {
                  type: "list",
                  ordered: false,
                  items: [
                    [
                      {
                        type: "paragraph",
                        inlines: [{ type: "text", text: "service.name" }],
                      },
                    ],
                    [
                      {
                        type: "paragraph",
                        inlines: [{ type: "text", text: "host.id" }],
                      },
                    ],
                  ],
                },
              ],
            ],
          ],
        },
      ],
      resolve,
    );
    const text = cellText(out);
    expect(text).toBe("• service.name\n• host.id");
  });

  it("uses numeric markers for ordered lists in a cell", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [
                {
                  type: "list",
                  ordered: true,
                  items: [
                    [{ type: "paragraph", inlines: [{ type: "text", text: "one" }] }],
                    [{ type: "paragraph", inlines: [{ type: "text", text: "two" }] }],
                  ],
                },
              ],
            ],
          ],
        },
      ],
      resolve,
    );
    expect(cellText(out)).toBe("1. one\n2. two");
  });

  it("indents nested lists inside a cell", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "table",
          rows: [
            [
              [
                {
                  type: "list",
                  ordered: false,
                  items: [
                    [
                      {
                        type: "paragraph",
                        inlines: [{ type: "text", text: "parent" }],
                      },
                      {
                        type: "list",
                        ordered: false,
                        items: [
                          [
                            {
                              type: "paragraph",
                              inlines: [{ type: "text", text: "child" }],
                            },
                          ],
                        ],
                      },
                    ],
                  ],
                },
              ],
            ],
          ],
        },
      ],
      resolve,
    );
    expect(cellText(out)).toBe("• parent\n    • child");
  });

  it("still returns an empty rich_text element for an empty cell", () => {
    const out = irToNotionBlocks(
      [{ type: "table", rows: [[[]]] }],
      resolve,
    );
    expect(cellText(out)).toBe("");
  });
});
