export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "page";
}

export function timestampFolderSuffix(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    "-" +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes())
  );
}

export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  text: string,
): Promise<void> {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([text], { type: "text/markdown" }));
  await w.close();
}

export async function writeBinaryFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([bytes as BlobPart]));
  await w.close();
}
