import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { Page } from "@/ir/types";
import { ConfluenceDestination } from "@/destinations/confluence/confluence-destination";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const creds = {
  siteUrl: "https://x.atlassian.net",
  email: "u@x.com",
  apiToken: "T",
};

const samplePage: Page = {
  id: "src",
  title: "Imported Page",
  sourceUrl: "file:///local",
  capturedAt: "2026-06-09T00:00:00Z",
  blocks: [
    { type: "heading", level: 1, inlines: [{ type: "text", text: "Hello" }] },
    { type: "image", assetId: "img-1", alt: "shot" },
    { type: "attachment", assetId: "att-1", filename: "log.txt" },
  ],
  assets: [
    {
      id: "img-1",
      filename: "shot.png",
      mimeType: "image/png",
      fetch: async () => new Uint8Array([1, 2, 3]),
    },
    {
      id: "att-1",
      filename: "log.txt",
      mimeType: "text/plain",
      fetch: async () => new Uint8Array([9]),
    },
  ],
};

describe("ConfluenceDestination.publish", () => {
  it("creates page, uploads assets, PUTs body, returns webui URL", async () => {
    const requests: string[] = [];
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", async () => {
        requests.push("create");
        return HttpResponse.json({
          id: "999",
          _links: { webui: "/spaces/ENG/pages/999/Imported+Page" },
        });
      }),
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        async ({ request }) => {
          requests.push("upload");
          const form = await request.formData();
          const file = form.get("file") as File;
          return HttpResponse.json({ results: [{ title: file.name }] });
        },
      ),
      http.put(
        "https://x.atlassian.net/wiki/api/v2/pages/999",
        async ({ request }) => {
          const body = (await request.json()) as any;
          requests.push("put");
          expect(body.body.value).toContain("<h1>Hello</h1>");
          expect(body.body.value).toContain('ri:filename="shot.png"');
          expect(body.body.value).toContain('ri:filename="log.txt"');
          return HttpResponse.json({ id: "999" });
        },
      ),
    );

    const dest = new ConfluenceDestination(creds, {
      spaceId: "100",
      parentPageId: "42",
    });
    const progress: string[] = [];
    const r = await dest.publish(samplePage, {
      onProgress: (m) => progress.push(m),
    });

    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.destinationUrl).toBe(
      "https://x.atlassian.net/wiki/spaces/ENG/pages/999/Imported+Page",
    );
    expect(requests).toEqual(["create", "upload", "upload", "put"]);
    expect(progress.some((m) => /Creating page/i.test(m))).toBe(true);
    expect(progress.some((m) => /Uploading/i.test(m))).toBe(true);
  });

  it("collects per-asset failures and still PUTs body", async () => {
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", () =>
        HttpResponse.json({
          id: "999",
          _links: { webui: "/spaces/X/pages/999/x" },
        }),
      ),
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        () => HttpResponse.text("nope", { status: 500 }),
      ),
      http.put("https://x.atlassian.net/wiki/api/v2/pages/999", async () =>
        HttpResponse.json({ id: "999" }),
      ),
    );
    const dest = new ConfluenceDestination(creds, { spaceId: "100" });
    const r = await dest.publish(samplePage, { onProgress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0].assetId).toBe("img-1");
    expect(r.destinationUrl).toContain("/wiki/spaces/X/pages/999/x");
  });

  it("returns critical failure if page-create fails", async () => {
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", () =>
        HttpResponse.text("boom", { status: 500 }),
      ),
    );
    const dest = new ConfluenceDestination(creds, { spaceId: "100" });
    const r = await dest.publish(samplePage, { onProgress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.failures[0].reason).toMatch(/create page/i);
    expect(r.destinationUrl).toBeUndefined();
  });

  it("returns critical failure if PUT body fails (page already exists)", async () => {
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", () =>
        HttpResponse.json({
          id: "999",
          _links: { webui: "/spaces/X/pages/999/x" },
        }),
      ),
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        async ({ request }) => {
          const form = await request.formData();
          const file = form.get("file") as File;
          return HttpResponse.json({ results: [{ title: file.name }] });
        },
      ),
      http.put("https://x.atlassian.net/wiki/api/v2/pages/999", () =>
        HttpResponse.text("body too big", { status: 400 }),
      ),
    );
    const dest = new ConfluenceDestination(creds, { spaceId: "100" });
    const r = await dest.publish(samplePage, { onProgress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => /body upload failed/i.test(f.reason))).toBe(
      true,
    );
    expect(r.destinationUrl).toContain("/wiki/spaces/X/pages/999/x");
  });
});
