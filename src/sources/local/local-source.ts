import { remark } from "remark";
import remarkGfm from "remark-gfm";
import type { Block, Page } from "@/ir/types";
import { mdastToIr } from "./mdast-to-ir";
import { collectAssets, readAllBytes } from "./filesystem-read";
import { parseFrontmatter } from "./frontmatter";

export type LocalSourceParams =
  | { kind: "file"; fileHandle: any /* FileSystemFileHandle */ }
  | { kind: "folder"; dirHandle: any /* FileSystemDirectoryHandle */ };

export class LocalSource {
  readonly id = "local";

  async fetchPage(params: LocalSourceParams): Promise<Page> {
    if (params.kind === "file") {
      return this.fromFile(params.fileHandle);
    }
    return this.fromFolder(params.dirHandle);
  }

  private async fromFile(fileHandle: any): Promise<Page> {
    const bytes = await readAllBytes(fileHandle);
    const text = new TextDecoder().decode(bytes);
    const { title, blocks } = parseMarkdown(text, new Set());
    const fileName: string = fileHandle.name ?? "Untitled.md";
    return finalisePage({
      title: title ?? stripExt(fileName),
      blocks,
      assets: [],
      sourceUrl: `local-file:${fileName}`,
    });
  }

  private async fromFolder(dirHandle: any): Promise<Page> {
    const mdHandles: any[] = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "file" && /\.md$/i.test(name)) {
        mdHandles.push(handle);
      }
    }
    if (mdHandles.length !== 1) {
      throw new Error(
        "Folder must contain exactly one .md file at its root.",
      );
    }
    const mdHandle = mdHandles[0];

    const assets = await collectAssets(dirHandle);
    const assetIds = new Set(assets.map((a) => a.id));

    const bytes = await readAllBytes(mdHandle);
    const text = new TextDecoder().decode(bytes);
    const { title, blocks } = parseMarkdown(text, assetIds);

    return finalisePage({
      title: title ?? dirHandle.name ?? stripExt(mdHandle.name),
      blocks,
      assets,
      sourceUrl: `local-folder:${dirHandle.name ?? ""}`,
    });
  }
}

function parseMarkdown(
  text: string,
  assetIds: Set<string>,
): { title: string | null; blocks: Block[] } {
  const { data, body } = parseFrontmatter(text);
  const frontTitle = typeof data.title === "string" ? data.title : null;

  const tree = remark().use(remarkGfm).parse(body);
  const { blocks } = mdastToIr(tree as any, { assetIds });

  let title = frontTitle;
  if (!title) {
    const h1 = blocks.find(
      (b): b is Extract<Block, { type: "heading" }> =>
        b.type === "heading" && b.level === 1,
    );
    if (h1) {
      const collected = h1.inlines
        .map((i) => ("text" in i ? i.text : ""))
        .join("")
        .trim();
      if (collected) title = collected;
    }
  }
  return { title, blocks };
}

function stripExt(name: string): string {
  return name.replace(/\.md$/i, "");
}

function finalisePage(partial: Omit<Page, "id" | "capturedAt">): Page {
  return {
    id: cryptoRandomId(),
    capturedAt: new Date().toISOString(),
    ...partial,
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
