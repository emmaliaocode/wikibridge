import type { Asset } from "@/ir/types";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
};

export function inferMimeType(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = filename.slice(dot + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

// Structural duck-typing — works for the real DOM FileSystem*Handle AND the test fake.
type AnyFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
};

type AnyDirectoryHandle = {
  kind: "directory";
  name: string;
  entries(): AsyncIterable<[string, AnyFileHandle | AnyDirectoryHandle]>;
  getDirectoryHandle?(name: string): Promise<AnyDirectoryHandle>;
};

export async function readAllBytes(
  handle: AnyFileHandle,
): Promise<Uint8Array> {
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

async function collectFromSubdir(
  parent: AnyDirectoryHandle,
  subdirName: "images" | "attachments",
): Promise<Asset[]> {
  let subdir: AnyDirectoryHandle | undefined;
  for await (const [name, handle] of parent.entries()) {
    if (name === subdirName && handle.kind === "directory") {
      subdir = handle;
      break;
    }
  }
  if (!subdir) return [];
  const assets: Asset[] = [];
  for await (const [name, handle] of subdir.entries()) {
    if (handle.kind !== "file") continue;
    const id = `${subdirName}/${name}`;
    assets.push({
      id,
      filename: name,
      mimeType: inferMimeType(name),
      fetch: () => readAllBytes(handle),
    });
  }
  return assets;
}

export async function collectAssets(
  dir: AnyDirectoryHandle,
): Promise<Asset[]> {
  const [images, attachments] = await Promise.all([
    collectFromSubdir(dir, "images"),
    collectFromSubdir(dir, "attachments"),
  ]);
  return [...images, ...attachments];
}
