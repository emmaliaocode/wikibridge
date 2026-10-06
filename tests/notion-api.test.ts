import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NotionApi } from "@/destinations/notion/notion-api";
import {
  normalizeFileMeta,
  uploadFile,
} from "@/destinations/notion/file-uploads";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("NotionApi", () => {
  it("creates a page under a parent", async () => {
    server.use(
      http.post("https://api.notion.com/v1/pages", async ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer secret_t");
        expect(request.headers.get("Notion-Version")).toBe("2026-03-11");
        const body = (await request.json()) as any;
        expect(body.parent).toEqual({ type: "page_id", page_id: "parent-X" });
        expect(body.properties.title.title[0].text.content).toBe("Hello");
        return HttpResponse.json({ id: "new-page-1", url: "https://notion.so/new-page-1" });
      }),
    );
    const api = new NotionApi("secret_t");
    const page = await api.createPage("parent-X", "Hello");
    expect(page.id).toBe("new-page-1");
    expect(page.url).toBe("https://notion.so/new-page-1");
  });

  it("appends children in chunks of 100", async () => {
    let calls = 0;
    server.use(
      http.patch(
        "https://api.notion.com/v1/blocks/p/children",
        async ({ request }) => {
          calls++;
          const body = (await request.json()) as any;
          expect(body.children.length).toBeLessThanOrEqual(100);
          return HttpResponse.json({ results: [] });
        },
      ),
    );
    const api = new NotionApi("secret_t");
    const children = Array.from({ length: 250 }, () => ({ type: "divider", divider: {} }));
    await api.appendChildren("p", children);
    expect(calls).toBe(3); // 100 + 100 + 50
  });
});

describe("uploadFile", () => {
  it("creates an upload, sends bytes, returns the id", async () => {
    server.use(
      http.post(
        "https://api.notion.com/v1/file_uploads",
        async ({ request }) => {
          const body = (await request.json()) as any;
          expect(body.filename).toBe("pic.png");
          return HttpResponse.json({
            id: "fu-1",
            upload_url: "https://files.notion.com/upload/fu-1",
          });
        },
      ),
      http.post(
        "https://files.notion.com/upload/fu-1",
        async ({ request }) => {
          // multipart should include a "file" field
          const ct = request.headers.get("content-type") ?? "";
          expect(ct).toMatch(/multipart\/form-data/);
          return HttpResponse.json({ status: "uploaded" });
        },
      ),
    );
    const id = await uploadFile(
      "secret_t",
      "pic.png",
      "image/png",
      new Uint8Array([1, 2, 3]),
    );
    expect(id).toBe("fu-1");
  });

  it("infers an extension from the content type when the filename lacks one", async () => {
    let sentFilename: unknown;
    let sentContentType: unknown;
    server.use(
      http.post(
        "https://api.notion.com/v1/file_uploads",
        async ({ request }) => {
          const body = (await request.json()) as any;
          sentFilename = body.filename;
          sentContentType = body.content_type;
          return HttpResponse.json({
            id: "fu-2",
            upload_url: "https://files.notion.com/upload/fu-2",
          });
        },
      ),
      http.post("https://files.notion.com/upload/fu-2", () =>
        HttpResponse.json({ status: "uploaded" }),
      ),
    );
    const id = await uploadFile(
      "secret_t",
      "pasted-image",
      "image/png",
      new Uint8Array([1]),
    );
    expect(id).toBe("fu-2");
    expect(sentFilename).toBe("pasted-image.png");
    expect(sentContentType).toBe("image/png");
  });
});

describe("normalizeFileMeta", () => {
  it("leaves a well-formed filename + content type untouched", () => {
    expect(normalizeFileMeta("pic.png", "image/png")).toEqual({
      filename: "pic.png",
      contentType: "image/png",
    });
  });

  it("infers content type from the filename extension when the type is blank", () => {
    expect(normalizeFileMeta("report.pdf", "")).toEqual({
      filename: "report.pdf",
      contentType: "application/pdf",
    });
  });

  it("appends an extension inferred from the content type", () => {
    expect(normalizeFileMeta("diagram", "image/svg+xml")).toEqual({
      filename: "diagram.svg",
      contentType: "image/svg+xml",
    });
  });

  it("strips content-type parameters before matching", () => {
    expect(normalizeFileMeta("notes", "text/plain; charset=utf-8")).toEqual({
      filename: "notes.txt",
      contentType: "text/plain",
    });
  });

  it("falls back to a generic binary file when nothing is known", () => {
    expect(normalizeFileMeta("mystery", "")).toEqual({
      filename: "mystery.bin",
      contentType: "application/octet-stream",
    });
  });

  it("handles a missing/empty filename", () => {
    expect(normalizeFileMeta("", "image/png")).toEqual({
      filename: "file.png",
      contentType: "image/png",
    });
  });
});
