import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ConfluenceSource } from "@/sources/confluence/confluence-source";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ConfluenceSource", () => {
  it("returns a Page with blocks and lazy assets", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/pages/7", () =>
        HttpResponse.json({
          id: "7",
          title: "Doc",
          body: {
            atlas_doc_format: {
              value: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Hi" }],
                  },
                  {
                    type: "mediaSingle",
                    content: [
                      {
                        type: "media",
                        attrs: { id: "media-A", type: "file" },
                      },
                    ],
                  },
                ],
              }),
            },
          },
          _links: { webui: "/spaces/X/pages/7/Doc" },
        }),
      ),
      http.get(
        "https://x.atlassian.net/wiki/api/v2/pages/7/attachments",
        () =>
          HttpResponse.json({
            results: [
              {
                id: "att-A",
                title: "pic.png",
                mediaType: "image/png",
                fileId: "media-A",
              },
            ],
          }),
      ),
      http.get(
        "https://x.atlassian.net/wiki/rest/api/content/7/child/attachment/att-A/download",
        () =>
          new HttpResponse(new Uint8Array([1, 2, 3]), {
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );

    const src = new ConfluenceSource({
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      apiToken: "T",
    });
    const page = await src.fetchPage("7");

    expect(page.id).toBe("7");
    expect(page.title).toBe("Doc");
    expect(page.sourceUrl).toBe(
      "https://x.atlassian.net/wiki/spaces/X/pages/7/Doc",
    );
    expect(page.blocks).toHaveLength(2);
    expect(page.assets).toHaveLength(1);
    expect(page.assets[0].id).toBe("media-A");
    expect(page.assets[0].filename).toBe("pic.png");

    const bytes = await page.assets[0].fetch!();
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
