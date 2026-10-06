import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NotionSource } from "@/sources/notion/notion-source";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("NotionSource.fetchPage", () => {
  it("returns Page with blocks, assets, and lazy fetch", async () => {
    server.use(
      http.get(
        "https://api.notion.com/v1/pages/abcdef0123456789abcdef0123456789",
        () =>
          HttpResponse.json({
            properties: {
              Name: { type: "title", title: [{ plain_text: "Doc" }] },
            },
          }),
      ),
      http.get(
        "https://api.notion.com/v1/blocks/abcdef0123456789abcdef0123456789/children",
        () =>
          HttpResponse.json({
            results: [
              {
                id: "p1",
                type: "paragraph",
                paragraph: {
                  rich_text: [
                    {
                      type: "text",
                      plain_text: "hi",
                      text: { content: "hi" },
                      annotations: {},
                    },
                  ],
                },
              },
              {
                id: "img1",
                type: "image",
                image: {
                  type: "file",
                  file: { url: "https://files.notion/pic.png" },
                },
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
      ),
      http.get(
        "https://files.notion/pic.png",
        () =>
          new HttpResponse(new Uint8Array([1, 2]), {
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );

    const src = new NotionSource("secret_T");
    const page = await src.fetchPage({
      pageUrlOrId:
        "https://www.notion.so/Doc-abcdef0123456789abcdef0123456789",
    });
    expect(page.title).toBe("Doc");
    expect(page.blocks).toHaveLength(2);
    expect(page.assets).toHaveLength(1);

    const bytes = await page.assets[0].fetch!();
    expect(Array.from(bytes)).toEqual([1, 2]);
  });
});
