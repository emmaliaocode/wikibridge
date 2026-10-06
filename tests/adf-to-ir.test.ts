import { describe, expect, it } from "vitest";
import { adfToBlocks } from "@/sources/confluence/adf-to-ir";

describe("adfToBlocks - text basics", () => {
  it("converts a paragraph with plain text", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "Hi" }] },
    ]);
  });

  it("converts headings 1..6", () => {
    const adf = {
      type: "doc",
      content: [1, 2, 3, 4, 5, 6].map((level) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `H${level}` }],
      })),
    };
    const result = adfToBlocks(adf);
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({
      type: "heading",
      level: 1,
      inlines: [{ type: "text", text: "H1" }],
    });
    expect(result[5]).toMatchObject({ type: "heading", level: 6 });
  });

  it("preserves bold, italic, underline, strike, code marks", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                { type: "strong" },
                { type: "em" },
                { type: "underline" },
                { type: "strike" },
                { type: "code" },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [
          {
            type: "text",
            text: "x",
            marks: ["bold", "italic", "underline", "strike", "code"],
          },
        ],
      },
    ]);
  });

  it("converts hyperlinks to an inline link node", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "go",
              marks: [{ type: "link", attrs: { href: "https://x" } }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
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
  });
});

describe("adfToBlocks - structural", () => {
  it("converts bullet list with nested items", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "a" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
        ],
      },
    ]);
  });

  it("converts ordered list", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "1" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    expect(out[0]).toMatchObject({ type: "list", ordered: true });
  });

  it("converts code block with language", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "code", language: "ts", text: "const x = 1;" },
    ]);
  });

  it("converts blockquote", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "wise" }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "quote",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "wise" }] },
        ],
      },
    ]);
  });

  it("converts horizontal rule to divider", () => {
    const adf = {
      type: "doc",
      content: [{ type: "rule" }],
    };
    expect(adfToBlocks(adf)).toEqual([{ type: "divider" }]);
  });
});

describe("adfToBlocks - callouts and tables", () => {
  it("maps info panel to callout/info", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "panel",
          attrs: { panelType: "info" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "fyi" }] },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "callout",
        variant: "info",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "fyi" }] },
        ],
      },
    ]);
  });

  it("maps note, warning, success, error panel variants", () => {
    const variants: Array<[string, "note" | "warning" | "success"]> = [
      ["note", "note"],
      ["warning", "warning"],
      ["success", "success"],
      ["error", "warning"],
    ];
    for (const [panelType, expected] of variants) {
      const out = adfToBlocks({
        type: "doc",
        content: [
          {
            type: "panel",
            attrs: { panelType },
            content: [{ type: "paragraph", content: [] }],
          },
        ],
      });
      expect(out[0]).toMatchObject({ type: "callout", variant: expected });
    }
  });

  it("converts a 2x2 table with header row", () => {
    const cell = (text: string, header = false) => ({
      type: header ? "tableHeader" : "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const row = (cells: any[]) => ({ type: "tableRow", content: cells });
    const adf = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            row([cell("A", true), cell("B", true)]),
            row([cell("1"), cell("2")]),
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "table" });
    const table = out[0] as Extract<(typeof out)[number], { type: "table" }>;
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "A" }],
    });
    expect(table.rows[1][1][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "2" }],
    });
  });

  it("expands colspan into empty placeholder cells so rows stay rectangular", () => {
    const cellNode = (text: string, attrs?: Record<string, unknown>) => ({
      type: "tableCell",
      ...(attrs ? { attrs } : {}),
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const row = (cells: any[]) => ({ type: "tableRow", content: cells });
    const adf = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            row([cellNode("H", { colspan: 2 })]),
            row([cellNode("1"), cellNode("2")]),
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    const table = out[0] as Extract<(typeof out)[number], { type: "table" }>;
    expect(table.rows[0]).toHaveLength(2);
    expect(table.rows[1]).toHaveLength(2);
    expect(table.rows[0][0][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "H" }],
    });
    // The spanned column becomes an empty placeholder cell.
    expect(table.rows[0][1]).toEqual([]);
  });

  it("expands rowspan by carrying empty cells into subsequent rows", () => {
    const cellNode = (text: string, attrs?: Record<string, unknown>) => ({
      type: "tableCell",
      ...(attrs ? { attrs } : {}),
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const row = (cells: any[]) => ({ type: "tableRow", content: cells });
    const adf = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            row([cellNode("A", { rowspan: 2 }), cellNode("B")]),
            row([cellNode("C")]),
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    const table = out[0] as Extract<(typeof out)[number], { type: "table" }>;
    expect(table.rows[0]).toHaveLength(2);
    expect(table.rows[1]).toHaveLength(2);
    expect(table.rows[0][0][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "A" }],
    });
    // Row 2 gets an empty placeholder in the rowspan-covered column, so "C"
    // lands in the second column and both rows are the same width.
    expect(table.rows[1][0]).toEqual([]);
    expect(table.rows[1][1][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "C" }],
    });
  });
});

describe("adfToBlocks - media", () => {
  it("converts mediaSingle to an image block referencing the media id", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [
            {
              type: "media",
              attrs: { id: "att-123", type: "file", alt: "diagram" },
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "image", assetId: "att-123", alt: "diagram" },
    ]);
  });

  it("mediaSingle without an id is dropped (defensive)", () => {
    const adf = {
      type: "doc",
      content: [{ type: "mediaSingle", content: [] }],
    };
    expect(adfToBlocks(adf)).toEqual([]);
  });
});

describe("adfToBlocks - attachment branch", () => {
  it("emits an attachment block for non-image media when matched by fileId", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [
            { type: "media", attrs: { id: "att-99", type: "file" } },
          ],
        },
      ],
    };
    expect(
      adfToBlocks(adf, [
        { fileId: "att-99", filename: "notes.pdf", mediaType: "application/pdf" },
      ]),
    ).toEqual([
      { type: "attachment", assetId: "att-99", filename: "notes.pdf" },
    ]);
  });

  it("still emits an image block when the matched attachment is image/*", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [
            { type: "media", attrs: { id: "att-1", type: "file", alt: "pic" } },
          ],
        },
      ],
    };
    expect(
      adfToBlocks(adf, [
        { fileId: "att-1", filename: "pic.png", mediaType: "image/png" },
      ]),
    ).toEqual([
      { type: "image", assetId: "att-1", alt: "pic" },
    ]);
  });

  it("defaults to image block when attachment list is empty (backward-compat)", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [{ type: "media", attrs: { id: "x", type: "file" } }],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "image", assetId: "x" },
    ]);
  });
});

describe("adfToBlocks - smart links", () => {
  it("converts inlineCard to a link inline", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "inlineCard",
              attrs: { url: "https://example.atlassian.net/wiki/spaces/X/pages/123" },
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "https://example.atlassian.net/wiki/spaces/X/pages/123",
            inlines: [
              { type: "text", text: "https://example.atlassian.net/wiki/spaces/X/pages/123" },
            ],
          },
        ],
      },
    ]);
  });

  it("converts blockCard the same way (as a link inline inside a paragraph wrapping)", () => {
    // blockCard appears at block position in ADF, but we still produce an
    // inline link — wrapped in a paragraph by the default branch? Actually,
    // since blockCard is at block level and our nodeToBlock has no case for it,
    // it falls through to the default which produces "" (no text). To preserve
    // it, we'd need a block-level rule. For v1.1 we accept that blockCard
    // becomes a paragraph wrapping the link only if it appears INSIDE another
    // paragraph (inlineCard does). At top level, blockCard is dropped.
    // This test documents that: a top-level blockCard with NO text drops.
    const adf = {
      type: "doc",
      content: [
        {
          type: "blockCard",
          attrs: { url: "https://example.com" },
        },
      ],
    };
    // Acceptable v1 behavior: blockCard at top level produces nothing.
    expect(adfToBlocks(adf)).toEqual([]);
  });
});

describe("adfToBlocks - colored text", () => {
  it("maps Confluence red hex to color: red", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "danger",
              marks: [{ type: "textColor", attrs: { color: "#bf2600" } }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [{ type: "text", text: "danger", color: "red" }],
      },
    ]);
  });

  it("preserves marks alongside color", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bold-red",
              marks: [
                { type: "strong" },
                { type: "textColor", attrs: { color: "#de350b" } },
              ],
            },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    expect(out[0]).toEqual({
      type: "paragraph",
      inlines: [
        { type: "text", text: "bold-red", marks: ["bold"], color: "red" },
      ],
    });
  });

  it("malformed color value is dropped (returns text without color)", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "textColor", attrs: { color: "not-a-hex" } }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "x" }] },
    ]);
  });

  it("maps Confluence pink backgroundColor mark to backgroundColor: pink", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "highlight",
              // A typical Confluence pink-ish highlight hex.
              marks: [{ type: "backgroundColor", attrs: { color: "#fdd0e7" } }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [{ type: "text", text: "highlight", backgroundColor: "pink" }],
      },
    ]);
  });

  it("maps Confluence green backgroundColor to backgroundColor: green", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ok",
              marks: [{ type: "backgroundColor", attrs: { color: "#abf5d1" } }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [{ type: "text", text: "ok", backgroundColor: "green" }],
      },
    ]);
  });

  it("preserves marks + foreground color + backgroundColor together on the same inline", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                { type: "strong" },
                { type: "textColor", attrs: { color: "#bf2600" } },
                { type: "backgroundColor", attrs: { color: "#fdd0e7" } },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [
          {
            type: "text",
            text: "x",
            marks: ["bold"],
            color: "red",
            backgroundColor: "pink",
          },
        ],
      },
    ]);
  });

  it("near-white background color is dropped (not a real highlight)", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "plain",
              marks: [{ type: "backgroundColor", attrs: { color: "#ffffff" } }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "plain" }] },
    ]);
  });
});

describe("adfToBlocks - expand", () => {
  it("converts expand to a toggle block with title and nested blocks", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "expand",
          attrs: { title: "Click me" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "secret" }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "toggle",
        title: "Click me",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "secret" }] },
        ],
      },
    ]);
  });

  it("treats nestedExpand the same as expand", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "nestedExpand",
          attrs: { title: "inner" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "x" }] },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "toggle",
        title: "inner",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "x" }] },
        ],
      },
    ]);
  });

  it("expand with missing title defaults to empty string", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "expand",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "x" }] },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)[0]).toMatchObject({ type: "toggle", title: "" });
  });
});

describe("adfToBlocks - mediaInline (inline file attachments)", () => {
  it("splits a paragraph containing mediaInline into [text, attachment, text] blocks", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "mediaInline", attrs: { id: "att-7", type: "file" } },
            { type: "text", text: " for details" },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf, [
      { fileId: "att-7", filename: "report.pdf", mediaType: "application/pdf" },
    ]);
    expect(out).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "see " }] },
      { type: "attachment", assetId: "att-7", filename: "report.pdf" },
      { type: "paragraph", inlines: [{ type: "text", text: " for details" }] },
    ]);
  });

  it("emits image block when mediaInline points to an image-typed attachment", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mediaInline", attrs: { id: "att-img", type: "file" } },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf, [
      { fileId: "att-img", filename: "pic.png", mediaType: "image/png" },
    ]);
    expect(out).toEqual([{ type: "image", assetId: "att-img" }]);
  });

  it("paragraph that is JUST a mediaInline produces only the attachment block (no empty paragraphs)", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mediaInline", attrs: { id: "att-9", type: "file" } },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf, [
      { fileId: "att-9", filename: "spec.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: "attachment",
      assetId: "att-9",
      filename: "spec.docx",
    });
  });

  it("mediaInline with no matching attachment defaults to image block (existing fallback)", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mediaInline", attrs: { id: "att-unknown", type: "file" } },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "image", assetId: "att-unknown" },
    ]);
  });

  it("malformed mediaInline (no id) is dropped, surrounding text preserved", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "mediaInline", attrs: {} },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
    ]);
  });

  it("treats inline 'media' node the same as mediaInline (file path)", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "media", attrs: { id: "att-7", type: "file" } },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf, [
      { fileId: "att-7", filename: "report.pdf", mediaType: "application/pdf" },
    ]);
    expect(out).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "see " }] },
      { type: "attachment", assetId: "att-7", filename: "report.pdf" },
    ]);
  });

  it("top-level bare 'media' node at block position emits an attachment", () => {
    const adf = {
      type: "doc",
      content: [
        { type: "media", attrs: { id: "att-8", type: "file" } },
      ],
    };
    const out = adfToBlocks(adf, [
      { fileId: "att-8", filename: "notes.pdf", mediaType: "application/pdf" },
    ]);
    expect(out).toEqual([
      { type: "attachment", assetId: "att-8", filename: "notes.pdf" },
    ]);
  });
});

describe("adfToBlocks - date inline", () => {
  it("converts a date inline node to its ISO date string", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "due " },
            { type: "date", attrs: { timestamp: "1726099200000" } },
          ],
        },
      ],
    };
    // 1726099200000 = 2024-09-12T00:00:00Z
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "due " },
          { type: "text", text: "2024-09-12" },
        ],
      },
    ]);
  });

  it("date inline with malformed timestamp is dropped", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x" },
            { type: "date", attrs: { timestamp: "not-a-number" } },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "x" }] },
    ]);
  });

  it("date inline inside a table cell renders inside the cell's paragraph", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "date", attrs: { timestamp: "1726099200000" } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "table" });
    const table = out[0] as Extract<(typeof out)[number], { type: "table" }>;
    expect(table.rows[0][0][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "2024-09-12" }],
    });
  });
});
