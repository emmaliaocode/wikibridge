import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ConfluenceWriteApi } from "@/destinations/confluence/confluence-write-api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const api = new ConfluenceWriteApi({
  siteUrl: "https://x.atlassian.net",
  email: "u@x.com",
  apiToken: "T",
});

describe("ConfluenceWriteApi.listSpaces", () => {
  it("returns id+key+name for each space", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/spaces", () =>
        HttpResponse.json({
          results: [
            { id: "100", key: "ENG", name: "Engineering" },
            { id: "200", key: "DOC", name: "Docs" },
          ],
        }),
      ),
    );
    const spaces = await api.listSpaces();
    expect(spaces).toEqual([
      { id: "100", key: "ENG", name: "Engineering" },
      { id: "200", key: "DOC", name: "Docs" },
    ]);
  });
});

describe("ConfluenceWriteApi.listRootPages", () => {
  it("filters to top-level pages of the given space", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/pages", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("space-id")).toBe("100");
        return HttpResponse.json({
          results: [
            { id: "1", title: "Home", parentId: null },
            { id: "2", title: "Child", parentId: "1" },
          ],
        });
      }),
    );
    const pages = await api.listRootPages("100");
    expect(pages).toEqual([{ id: "1", title: "Home" }]);
  });
});

describe("ConfluenceWriteApi.createPage", () => {
  it("POSTs an empty page and returns id + webui link", async () => {
    server.use(
      http.post(
        "https://x.atlassian.net/wiki/api/v2/pages",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.spaceId).toBe("100");
          expect(body.title).toBe("My Page");
          expect(body.parentId).toBe("42");
          return HttpResponse.json({
            id: "999",
            _links: { webui: "/spaces/ENG/pages/999/My+Page" },
          });
        },
      ),
    );
    const r = await api.createPage({
      spaceId: "100",
      title: "My Page",
      parentPageId: "42",
    });
    expect(r).toEqual({
      id: "999",
      webuiUrl: "https://x.atlassian.net/wiki/spaces/ENG/pages/999/My+Page",
    });
  });
});

describe("ConfluenceWriteApi.uploadAttachment", () => {
  it("POSTs multipart and returns the resulting filename", async () => {
    server.use(
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        async ({ request }) => {
          expect(request.headers.get("x-atlassian-token")).toBe("no-check");
          return HttpResponse.json({
            results: [{ title: "pic.png" }],
          });
        },
      ),
    );
    const filename = await api.uploadAttachment("999", {
      filename: "pic.png",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(filename).toBe("pic.png");
  });
});

describe("ConfluenceWriteApi.updatePageBody", () => {
  it("PUTs the storage body with version 2", async () => {
    server.use(
      http.put(
        "https://x.atlassian.net/wiki/api/v2/pages/999",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body).toMatchObject({
            id: "999",
            status: "current",
            title: "My Page",
            version: { number: 2 },
            body: { representation: "storage", value: "<p>hi</p>" },
          });
          return HttpResponse.json({ id: "999" });
        },
      ),
    );
    await api.updatePageBody("999", "My Page", "<p>hi</p>");
  });
});
