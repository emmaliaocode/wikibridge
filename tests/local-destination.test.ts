import { describe, expect, it } from "vitest";
import { LocalDestination } from "@/destinations/local/local-destination";
import type { Page } from "@/ir/types";

class FakeFile {
  data: Uint8Array<ArrayBufferLike> = new Uint8Array();
}

class FakeDir {
  name: string;
  children: Map<string, FakeDir | FakeFile> = new Map();
  constructor(name: string) {
    this.name = name;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    if (!this.children.has(name)) {
      if (!opts?.create) throw new Error("missing");
      this.children.set(name, new FakeDir(name));
    }
    return this.children.get(name) as FakeDir;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.children.has(name)) {
      if (!opts?.create) throw new Error("missing");
      this.children.set(name, new FakeFile());
    }
    const file = this.children.get(name) as FakeFile;
    return {
      createWritable: async () => ({
        // Mirror real Chrome: only Blob (or a WriteParams object) is accepted.
        // Bare Uint8Array / string would throw in production.
        write: async (chunk: Blob) => {
          if (!(chunk instanceof Blob)) {
            throw new Error(
              "FakeDir.write expected Blob (real FileSystemWritableFileStream requires Blob or WriteParams)",
            );
          }
          file.data = new Uint8Array(await chunk.arrayBuffer());
        },
        close: async () => {},
      }),
    };
  }
}

describe("LocalDestination", () => {
  it("writes README.md, images/, and attachments/", async () => {
    const root = new FakeDir("root");
    const page: Page = {
      id: "1",
      title: "Hello World",
      sourceUrl: "https://x.atlassian.net/wiki/spaces/X/pages/1/Hello-World",
      capturedAt: "2026-05-21T00:00:00.000Z",
      blocks: [
        { type: "heading", level: 1, inlines: [{ type: "text", text: "Hi" }] },
        { type: "image", assetId: "img-1", alt: "pic" },
        { type: "attachment", assetId: "doc-1", filename: "notes.pdf" },
      ],
      assets: [
        {
          id: "img-1",
          filename: "diagram.png",
          mimeType: "image/png",
          fetch: async () => new Uint8Array([1, 2]),
        },
        {
          id: "doc-1",
          filename: "notes.pdf",
          mimeType: "application/pdf",
          fetch: async () => new Uint8Array([3, 4]),
        },
      ],
    };

    const dest = new LocalDestination();
    const result = await dest.publishToHandle(root as any, page, {
      onProgress: () => {},
      now: () => new Date("2026-05-21T10:30:00Z"),
    });

    expect(result.ok).toBe(true);
    const folderName = [...root.children.keys()][0];
    expect(folderName).toMatch(/^hello-world-20260521-1030$/);

    const folder = root.children.get(folderName) as FakeDir;
    expect(folder.children.has("README.md")).toBe(true);
    expect(folder.children.has("images")).toBe(true);
    expect(folder.children.has("attachments")).toBe(true);

    const images = folder.children.get("images") as FakeDir;
    expect(images.children.has("diagram.png")).toBe(true);

    const attachments = folder.children.get("attachments") as FakeDir;
    expect(attachments.children.has("notes.pdf")).toBe(true);

    const readme = folder.children.get("README.md") as FakeFile;
    const text = new TextDecoder().decode(readme.data);
    expect(text).toContain("# Hi");
    expect(text).toContain("![pic](images/diagram.png)");
    expect(text).toContain("[notes.pdf](attachments/notes.pdf)");
    expect(text).toContain("title: Hello World");
    // Page title rendered as an H1 above the body content (after frontmatter).
    expect(text).toMatch(/---\s*\n# Hello World\n/);
  });

  it("collects failures when an asset fetch throws", async () => {
    const root = new FakeDir("root");
    const page: Page = {
      id: "2",
      title: "Bad",
      sourceUrl: "https://x/y",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [{ type: "image", assetId: "boom", alt: "" }],
      assets: [
        {
          id: "boom",
          filename: "boom.png",
          mimeType: "image/png",
          fetch: async () => {
            throw new Error("disk on fire");
          },
        },
      ],
    };
    const dest = new LocalDestination();
    const result = await dest.publishToHandle(root as any, page, {
      onProgress: () => {},
      now: () => new Date("2026-05-21T10:30:00Z"),
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].assetId).toBe("boom");
    expect(result.failures[0].reason).toMatch(/disk on fire/);
  });
});
