import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ConfluenceApi } from "@/sources/confluence/confluence-api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ConfluenceApi", () => {
  it("fetches a page in ADF body format with Basic auth", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/pages/42", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("body-format")).toBe("atlas_doc_format");
        expect(request.headers.get("Authorization")).toBe(
          // base64("u@x.com:T")
          "Basic " + btoa("u@x.com:T"),
        );
        return HttpResponse.json({
          id: "42",
          title: "Hello",
          body: { atlas_doc_format: { value: '{"type":"doc","content":[]}' } },
          _links: { webui: "/spaces/X/pages/42/Hello" },
        });
      }),
    );

    const api = new ConfluenceApi({
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      apiToken: "T",
    });
    const page = await api.getPage("42");
    expect(page.title).toBe("Hello");
    expect(page.adf).toEqual({ type: "doc", content: [] });
    expect(page.webUiPath).toBe("/spaces/X/pages/42/Hello");
  });

  it("lists attachments", async () => {
    server.use(
      http.get(
        "https://x.atlassian.net/wiki/api/v2/pages/42/attachments",
        () =>
          HttpResponse.json({
            results: [
              {
                id: "att-1",
                title: "diagram.png",
                mediaType: "image/png",
                fileId: "media-1",
              },
            ],
          }),
      ),
    );

    const api = new ConfluenceApi({
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      apiToken: "T",
    });
    const list = await api.listAttachments("42");
    expect(list).toHaveLength(1);
    expect(list[0].fileId).toBe("media-1");
  });

  it("downloads an attachment by page+attachment id", async () => {
    server.use(
      http.get(
        "https://x.atlassian.net/wiki/rest/api/content/7/child/attachment/att-A/download",
        ({ request }) => {
          expect(request.headers.get("Authorization")).toBe(
            "Basic " + btoa("u@x.com:T"),
          );
          return new HttpResponse(new Uint8Array([9, 8, 7]), {
            headers: { "Content-Type": "image/png" },
          });
        },
      ),
    );
    const api = new ConfluenceApi({
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      apiToken: "T",
    });
    const bytes = await api.downloadAttachment("7", "att-A");
    expect(Array.from(bytes)).toEqual([9, 8, 7]);
  });
});
