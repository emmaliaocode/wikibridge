import { describe, expect, it } from "vitest";
import {
  readAllBytes,
  inferMimeType,
  collectAssets,
} from "@/sources/local/filesystem-read";
import {
  makeDir,
  makeFile,
  FakeDirectoryHandle,
} from "./helpers/fake-filesystem";

describe("inferMimeType", () => {
  it.each([
    ["foo.png", "image/png"],
    ["foo.jpg", "image/jpeg"],
    ["foo.jpeg", "image/jpeg"],
    ["foo.gif", "image/gif"],
    ["foo.webp", "image/webp"],
    ["foo.svg", "image/svg+xml"],
    ["foo.pdf", "application/pdf"],
    ["foo.txt", "text/plain"],
    ["foo.md", "text/markdown"],
    ["foo.bin", "application/octet-stream"],
    ["weird", "application/octet-stream"],
  ])("infers %s as %s", (name, expected) => {
    expect(inferMimeType(name)).toBe(expected);
  });
});

describe("readAllBytes", () => {
  it("reads bytes from a fake file handle", async () => {
    const fh = makeFile("x.txt", "hi");
    const bytes = await readAllBytes(fh);
    expect(new TextDecoder().decode(bytes)).toBe("hi");
  });
});

describe("collectAssets", () => {
  it("collects images/ and attachments/ files into assets", async () => {
    const dir = makeDir("root", {
      "README.md": { bytes: new TextEncoder().encode("# t") },
      images: {
        "a.png": { bytes: new Uint8Array([1]) },
        "b.jpg": { bytes: new Uint8Array([2]) },
      },
      attachments: {
        "log.txt": { bytes: new TextEncoder().encode("hi") },
      },
    }) as unknown as FakeDirectoryHandle;
    const assets = await collectAssets(dir);
    const ids = assets.map((a) => a.id).sort();
    expect(ids).toEqual([
      "attachments/log.txt",
      "images/a.png",
      "images/b.jpg",
    ]);
    const log = assets.find((a) => a.id === "attachments/log.txt")!;
    expect(log.filename).toBe("log.txt");
    expect(log.mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(await log.fetch!())).toBe("hi");
  });

  it("returns [] when no subdirs present", async () => {
    const dir = makeDir("root", {
      "README.md": { bytes: new TextEncoder().encode("# t") },
    }) as unknown as FakeDirectoryHandle;
    const assets = await collectAssets(dir);
    expect(assets).toEqual([]);
  });
});
