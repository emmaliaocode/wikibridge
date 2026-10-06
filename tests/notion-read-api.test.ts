import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  NotionReadApi,
  extractPageId,
} from "@/sources/notion/notion-read-api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("extractPageId", () => {
  it("extracts the trailing 32-hex id from a URL", () => {
    const id = extractPageId(
      "https://www.notion.so/My-Page-abcdef0123456789abcdef0123456789",
    );
    expect(id).toBe("abcdef0123456789abcdef0123456789");
  });

  it("accepts a bare id", () => {
    const id = extractPageId("abcdef0123456789abcdef0123456789");
    expect(id).toBe("abcdef0123456789abcdef0123456789");
  });

  it("accepts dashed UUID format", () => {
    const id = extractPageId("abcdef01-2345-6789-abcd-ef0123456789");
    expect(id).toBe("abcdef0123456789abcdef0123456789");
  });

  it("rejects garbage", () => {
    expect(() => extractPageId("nope")).toThrow();
  });
});

const api = new NotionReadApi("secret_TEST");

describe("NotionReadApi.getPageTitle", () => {
  it("returns the title property value", async () => {
    server.use(
      http.get("https://api.notion.com/v1/pages/abc", () =>
        HttpResponse.json({
          properties: {
            Name: {
              type: "title",
              title: [
                { plain_text: "Hello " },
                { plain_text: "World" },
              ],
            },
          },
        }),
      ),
    );
    expect(await api.getPageTitle("abc")).toBe("Hello World");
  });

  it("falls back to Untitled when no title property", async () => {
    server.use(
      http.get("https://api.notion.com/v1/pages/abc", () =>
        HttpResponse.json({ properties: {} }),
      ),
    );
    expect(await api.getPageTitle("abc")).toBe("Untitled");
  });
});

describe("NotionReadApi.getBlockTree", () => {
  it("paginates children and recurses into has_children", async () => {
    server.use(
      http.get(
        "https://api.notion.com/v1/blocks/root/children",
        ({ request }) => {
          const cursor = new URL(request.url).searchParams.get(
            "start_cursor",
          );
          if (!cursor) {
            return HttpResponse.json({
              results: [
                {
                  id: "p1",
                  type: "paragraph",
                  paragraph: { rich_text: [] },
                  has_children: false,
                },
              ],
              has_more: true,
              next_cursor: "C",
            });
          }
          return HttpResponse.json({
            results: [
              {
                id: "q1",
                type: "quote",
                quote: { rich_text: [] },
                has_children: true,
              },
            ],
            has_more: false,
            next_cursor: null,
          });
        },
      ),
      http.get("https://api.notion.com/v1/blocks/q1/children", () =>
        HttpResponse.json({
          results: [
            {
              id: "qp1",
              type: "paragraph",
              paragraph: { rich_text: [] },
              has_children: false,
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      ),
    );

    const tree = await api.getBlockTree("root");
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe("p1");
    expect(tree[1].id).toBe("q1");
    expect((tree[1] as any).children).toHaveLength(1);
  });
});

describe("NotionReadApi.downloadAsset", () => {
  it("returns bytes", async () => {
    server.use(
      http.get(
        "https://files.notion/x",
        () =>
          new HttpResponse(new Uint8Array([7, 8, 9]), {
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );
    const bytes = await api.downloadAsset("https://files.notion/x");
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });
});
