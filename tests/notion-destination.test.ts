import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NotionDestination } from "@/destinations/notion/notion-destination";
import type { Page } from "@/ir/types";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("NotionDestination", () => {
  it("creates a page, uploads images, appends blocks; returns destinationUrl", async () => {
    server.use(
      http.post("https://api.notion.com/v1/pages", () =>
        HttpResponse.json({ id: "new-1", url: "https://notion.so/new-1" }),
      ),
      http.post("https://api.notion.com/v1/file_uploads", () =>
        HttpResponse.json({
          id: "fu-A",
          upload_url: "https://files.notion.com/upload/fu-A",
        }),
      ),
      http.post("https://files.notion.com/upload/fu-A", () =>
        HttpResponse.json({ status: "uploaded" }),
      ),
      http.patch("https://api.notion.com/v1/blocks/new-1/children", () =>
        HttpResponse.json({ results: [] }),
      ),
    );

    const page: Page = {
      id: "1",
      title: "Hello",
      sourceUrl: "https://x/y",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [
        { type: "paragraph", inlines: [{ type: "text", text: "Hi" }] },
        { type: "image", assetId: "img-A", alt: "" },
      ],
      assets: [
        {
          id: "img-A",
          filename: "x.png",
          mimeType: "image/png",
          fetch: async () => new Uint8Array([1]),
        },
      ],
    };

    const dest = new NotionDestination({
      token: "secret_t",
      parentPageId: "parent-1",
    });
    const result = await dest.publish(page, { onProgress: () => {} });
    expect(result.ok).toBe(true);
    expect(result.destinationUrl).toBe("https://notion.so/new-1");
  });

  it("collects failures when an image upload fails but continues", async () => {
    server.use(
      http.post("https://api.notion.com/v1/pages", () =>
        HttpResponse.json({ id: "new-2", url: "https://notion.so/new-2" }),
      ),
      http.post("https://api.notion.com/v1/file_uploads", () =>
        new HttpResponse("nope", { status: 500 }),
      ),
      http.patch("https://api.notion.com/v1/blocks/new-2/children", () =>
        HttpResponse.json({ results: [] }),
      ),
    );

    const page: Page = {
      id: "2",
      title: "Bad",
      sourceUrl: "https://x/y",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [{ type: "image", assetId: "img-X", alt: "" }],
      assets: [
        {
          id: "img-X",
          filename: "x.png",
          mimeType: "image/png",
          fetch: async () => new Uint8Array([1]),
        },
      ],
    };

    const dest = new NotionDestination({
      token: "secret_t",
      parentPageId: "parent-1",
    });
    const result = await dest.publish(page, { onProgress: () => {} });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].assetId).toBe("img-X");
    expect(result.destinationUrl).toBe("https://notion.so/new-2");
  });

  it("does not upload attachments that no block references", async () => {
    server.use(
      http.post("https://api.notion.com/v1/pages", () =>
        HttpResponse.json({ id: "new-3", url: "https://notion.so/new-3" }),
      ),
      http.patch("https://api.notion.com/v1/blocks/new-3/children", () =>
        HttpResponse.json({ results: [] }),
      ),
      // Intentionally no file_uploads handler: with onUnhandledRequest:"error"
      // this test fails if the orphan attachment is uploaded.
    );

    const page: Page = {
      id: "3",
      title: "Orphans",
      sourceUrl: "https://x/y",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [
        { type: "paragraph", inlines: [{ type: "text", text: "Hi" }] },
      ],
      assets: [
        {
          // e.g. a Gliffy diagram source that the page never renders as a block
          id: "gliffy-1",
          filename: "sae bucket event to TCP",
          mimeType: "application/gliffy+json",
          fetch: async () => new Uint8Array([1]),
        },
      ],
    };

    const dest = new NotionDestination({
      token: "secret_t",
      parentPageId: "parent-1",
    });
    const result = await dest.publish(page, { onProgress: () => {} });
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.destinationUrl).toBe("https://notion.so/new-3");
  });
});
