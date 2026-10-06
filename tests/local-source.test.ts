import { describe, expect, it } from "vitest";
import { LocalSource } from "@/sources/local/local-source";
import { makeDir, makeFile } from "./helpers/fake-filesystem";

describe("LocalSource — file mode", () => {
  it("imports a single .md with frontmatter title", async () => {
    const file = makeFile(
      "doc.md",
      "---\ntitle: Frontmatter Title\n---\n\n# Body Heading\n\nhello",
    );
    const src = new LocalSource();
    const page = await src.fetchPage({
      kind: "file",
      fileHandle: file as any,
    });
    expect(page.title).toBe("Frontmatter Title");
    expect(page.assets).toEqual([]);
    expect(page.blocks[0]).toEqual({
      type: "heading",
      level: 1,
      inlines: [{ type: "text", text: "Body Heading" }],
    });
  });

  it("falls back to first H1 then file basename for title", async () => {
    const file = makeFile("MY-DOC.md", "# From H1\n\ntext");
    const src = new LocalSource();
    const page = await src.fetchPage({
      kind: "file",
      fileHandle: file as any,
    });
    expect(page.title).toBe("From H1");

    const file2 = makeFile("Other.md", "text only");
    const page2 = await src.fetchPage({
      kind: "file",
      fileHandle: file2 as any,
    });
    expect(page2.title).toBe("Other");
  });

  it("warns on relative image reference when no assets available", async () => {
    const file = makeFile("doc.md", "![alt](images/missing.png)");
    const src = new LocalSource();
    const page = await src.fetchPage({
      kind: "file",
      fileHandle: file as any,
    });
    expect(page.blocks[0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "alt" }],
    });
  });
});

describe("LocalSource — folder mode", () => {
  it("imports the single .md and matches relative image", async () => {
    const dir = makeDir("project", {
      "README.md": {
        bytes: new TextEncoder().encode(
          "---\ntitle: Project Doc\n---\n\n![shot](images/a.png)\n",
        ),
      },
      images: {
        "a.png": { bytes: new Uint8Array([10]) },
      },
    });
    const src = new LocalSource();
    const page = await src.fetchPage({
      kind: "folder",
      dirHandle: dir as any,
    });
    expect(page.title).toBe("Project Doc");
    expect(page.assets).toHaveLength(1);
    expect(page.assets[0].id).toBe("images/a.png");
    expect(page.blocks).toEqual([
      { type: "image", assetId: "images/a.png", alt: "shot" },
    ]);
  });

  it("uses folder name as title when no frontmatter / H1", async () => {
    const dir = makeDir("My Folder", {
      "notes.md": { bytes: new TextEncoder().encode("just text") },
    });
    const src = new LocalSource();
    const page = await src.fetchPage({
      kind: "folder",
      dirHandle: dir as any,
    });
    expect(page.title).toBe("My Folder");
  });

  it("rejects folder without any .md", async () => {
    const dir = makeDir("empty", {});
    const src = new LocalSource();
    await expect(
      src.fetchPage({ kind: "folder", dirHandle: dir as any }),
    ).rejects.toThrow(/exactly one \.md/i);
  });

  it("rejects folder with multiple .md", async () => {
    const dir = makeDir("multi", {
      "a.md": { bytes: new TextEncoder().encode("a") },
      "b.md": { bytes: new TextEncoder().encode("b") },
    });
    const src = new LocalSource();
    await expect(
      src.fetchPage({ kind: "folder", dirHandle: dir as any }),
    ).rejects.toThrow(/exactly one \.md/i);
  });
});
