import { describe, expect, it } from "vitest";
import type { Block } from "@/ir/types";
import { irToStorage } from "@/destinations/confluence/ir-to-storage";

const resolver = (assetId: string) => `${assetId}.png`;

function render(blocks: Block[]): string {
  return irToStorage(blocks, { assetResolver: resolver });
}

describe("irToStorage — inline & headings", () => {
  it("renders a paragraph with bold and italic", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "hello " },
          { type: "text", text: "world", marks: ["bold", "italic"] },
        ],
      },
    ]);
    expect(out).toBe("<p>hello <em><strong>world</strong></em></p>");
  });

  it("renders headings h1..h6", () => {
    const blocks: Block[] = [1, 2, 3, 4, 5, 6].map((level) => ({
      type: "heading",
      level: level as 1 | 2 | 3 | 4 | 5 | 6,
      inlines: [{ type: "text", text: `H${level}` }],
    }));
    const out = render(blocks);
    expect(out).toBe(
      "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>",
    );
  });

  it("renders inline link with escaping", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "https://x.com/a?b=1&c=<>",
            inlines: [{ type: "text", text: "link & co" }],
          },
        ],
      },
    ]);
    expect(out).toContain(`<a href="https://x.com/a?b=1&amp;c=%3C%3E">`);
    expect(out).toContain("link &amp; co");
  });

  it("drops dangerous URLs to #", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "javascript:alert(1)",
            inlines: [{ type: "text", text: "x" }],
          },
        ],
      },
    ]);
    expect(out).toContain(`<a href="#">`);
  });

  it("escapes text content", () => {
    const out = render([
      { type: "paragraph", inlines: [{ type: "text", text: "<script>" }] },
    ]);
    expect(out).toBe("<p>&lt;script&gt;</p>");
  });
});

describe("irToStorage — blocks", () => {
  it("renders unordered nested list", () => {
    const out = render([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
          [
            { type: "paragraph", inlines: [{ type: "text", text: "b" }] },
            {
              type: "list",
              ordered: false,
              items: [
                [{ type: "paragraph", inlines: [{ type: "text", text: "b1" }] }],
              ],
            },
          ],
        ],
      },
    ]);
    expect(out).toBe(
      "<ul><li><p>a</p></li><li><p>b</p><ul><li><p>b1</p></li></ul></li></ul>",
    );
  });

  it("renders ordered list", () => {
    const out = render([
      {
        type: "list",
        ordered: true,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "1" }] }],
        ],
      },
    ]);
    expect(out).toBe("<ol><li><p>1</p></li></ol>");
  });

  it("renders code block with language and CDATA escape", () => {
    const out = render([
      { type: "code", language: "ts", text: "const x = `]]>`;" },
    ]);
    expect(out).toBe(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[const x = `]]]]><![CDATA[>`;]]></ac:plain-text-body></ac:structured-macro>',
    );
  });

  it("renders code block without language", () => {
    const out = render([{ type: "code", text: "x" }]);
    expect(out).toContain(
      '<ac:parameter ac:name="language">none</ac:parameter>',
    );
  });

  it("renders blockquote", () => {
    const out = render([
      {
        type: "quote",
        blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "q" }] }],
      },
    ]);
    expect(out).toBe("<blockquote><p>q</p></blockquote>");
  });

  it("renders divider", () => {
    expect(render([{ type: "divider" }])).toBe("<hr/>");
  });
});

describe("irToStorage — callouts & tables", () => {
  it.each([
    ["info", "info"],
    ["note", "note"],
    ["warning", "warning"],
    ["success", "tip"],
  ] as const)("renders %s callout as %s macro", (variant, macroName) => {
    const out = render([
      {
        type: "callout",
        variant,
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "x" }] },
        ],
      },
    ]);
    expect(out).toBe(
      `<ac:structured-macro ac:name="${macroName}"><ac:rich-text-body><p>x</p></ac:rich-text-body></ac:structured-macro>`,
    );
  });

  it("renders a 2x2 table", () => {
    const out = render([
      {
        type: "table",
        rows: [
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
          ],
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "c" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "d" }] }],
          ],
        ],
      },
    ]);
    expect(out).toBe(
      "<table><tbody>" +
        "<tr><td><p>a</p></td><td><p>b</p></td></tr>" +
        "<tr><td><p>c</p></td><td><p>d</p></td></tr>" +
        "</tbody></table>",
    );
  });
});

describe("irToStorage — assets", () => {
  it("renders image asset by resolved filename", () => {
    const out = irToStorage(
      [{ type: "image", assetId: "media-A", alt: "shot" }],
      { assetResolver: () => "screenshot.png" },
    );
    expect(out).toBe(
      `<ac:image ac:alt="shot"><ri:attachment ri:filename="screenshot.png"/></ac:image>`,
    );
  });

  it("renders external image when resolver returns null", () => {
    const out = irToStorage(
      [
        {
          type: "image",
          assetId: "ext:https://example.com/x.png",
          alt: "x",
        },
      ],
      { assetResolver: () => null },
    );
    expect(out).toBe(
      `<ac:image ac:alt="x"><ri:url ri:value="https://example.com/x.png"/></ac:image>`,
    );
  });

  it("renders image placeholder when resolver returns null and no URL prefix", () => {
    const out = irToStorage(
      [{ type: "image", assetId: "media-B", alt: "missing" }],
      { assetResolver: () => null },
    );
    expect(out).toBe(
      "<p><em>[Failed to upload image: missing]</em></p>",
    );
  });

  it("renders attachment block with label", () => {
    const out = irToStorage(
      [{ type: "attachment", assetId: "attachments/log.txt", filename: "log.txt" }],
      { assetResolver: () => "log.txt" },
    );
    expect(out).toBe(
      `<p><ac:link><ri:attachment ri:filename="log.txt"/><ac:plain-text-link-body><![CDATA[log.txt]]></ac:plain-text-link-body></ac:link></p>`,
    );
  });

  it("renders attachment placeholder on failed upload", () => {
    const out = irToStorage(
      [{ type: "attachment", assetId: "x", filename: "log.txt" }],
      { assetResolver: () => null },
    );
    expect(out).toBe("<p><em>[Failed to upload attachment: log.txt]</em></p>");
  });

  it("renders inline attachmentRef", () => {
    const out = irToStorage(
      [
        {
          type: "paragraph",
          inlines: [
            {
              type: "attachmentRef",
              assetId: "attachments/log.txt",
              inlines: [{ type: "text", text: "see log" }],
            },
          ],
        },
      ],
      { assetResolver: () => "log.txt" },
    );
    expect(out).toBe(
      `<p><ac:link><ri:attachment ri:filename="log.txt"/><ac:link-body>see log</ac:link-body></ac:link></p>`,
    );
  });
});
