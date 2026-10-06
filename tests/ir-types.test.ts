import { describe, expect, it } from "vitest";
import type { Page, Block, Inline, Asset, Mark } from "@/ir/types";

describe("IR types", () => {
  it("Page accepts a minimal value", () => {
    const page: Page = {
      id: "p1",
      title: "Hello",
      sourceUrl: "https://example.atlassian.net/wiki/spaces/X/pages/1",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [],
      assets: [],
    };
    expect(page.title).toBe("Hello");
  });

  it("Block discriminated union covers all v1 types", () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, inlines: [{ type: "text", text: "T" }] },
      { type: "paragraph", inlines: [] },
      { type: "list", ordered: true, items: [] },
      { type: "code", text: "x = 1" },
      { type: "quote", blocks: [] },
      { type: "callout", variant: "info", blocks: [] },
      { type: "toggle", title: "T", blocks: [] },
      { type: "table", rows: [] },
      { type: "image", assetId: "a1" },
      { type: "attachment", assetId: "a2", filename: "f.pdf" },
      { type: "divider" },
    ];
    expect(blocks.length).toBe(11);
  });

  it("Inline link carries href and nested inlines", () => {
    const inline: Inline = {
      type: "link",
      href: "https://x",
      inlines: [{ type: "text", text: "click" }],
    };
    expect(inline.href).toBe("https://x");
  });

  it("Inline attachmentRef carries assetId and nested inlines", () => {
    const inline: Inline = {
      type: "attachmentRef",
      assetId: "attachments/foo.txt",
      inlines: [{ type: "text", text: "see log" }],
    };
    expect(inline.assetId).toBe("attachments/foo.txt");
  });

  it("Mark covers the 5 expected marks", () => {
    const marks: Mark[] = ["bold", "italic", "underline", "strike", "code"];
    expect(marks.length).toBe(5);
  });

  it("Asset supports lazy fetch", async () => {
    const a: Asset = {
      id: "x",
      filename: "x.png",
      mimeType: "image/png",
      fetch: async () => new Uint8Array([1, 2, 3]),
    };
    const bytes = await a.fetch!();
    expect(bytes.length).toBe(3);
  });
});
