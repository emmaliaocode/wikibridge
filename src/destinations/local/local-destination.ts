import type { Page } from "@/ir/types";
import type {
  Destination,
  Failure,
  PublishContext,
  PublishResult,
} from "@/destinations/destination";
import { renderMarkdown } from "./ir-to-markdown";
import {
  slugify,
  timestampFolderSuffix,
  writeBinaryFile,
  writeTextFile,
} from "./filesystem";

export type LocalPublishOptions = PublishContext & {
  now?: () => Date;
};

export class LocalDestination implements Destination {
  readonly id = "local";
  readonly displayName = "Local file (Markdown)";

  async isConfigured(): Promise<boolean> {
    return true; // local needs no token; permission is granted at capture time
  }

  async publish(_page: Page, _ctx: PublishContext): Promise<PublishResult> {
    throw new Error(
      "LocalDestination.publish requires a FileSystemDirectoryHandle; " +
        "call publishToHandle from the side panel after showDirectoryPicker().",
    );
  }

  async publishToHandle(
    root: FileSystemDirectoryHandle,
    page: Page,
    ctx: LocalPublishOptions,
  ): Promise<PublishResult> {
    const now = ctx.now?.() ?? new Date();
    const folderName = `${slugify(page.title)}-${timestampFolderSuffix(now)}`;
    const folder = await root.getDirectoryHandle(folderName, { create: true });
    const failures: Failure[] = [];

    const isImage = (mime: string) => mime.startsWith("image/");
    const imageAssets = page.assets.filter((a) => isImage(a.mimeType));
    const fileAssets = page.assets.filter((a) => !isImage(a.mimeType));

    let imagesDir: FileSystemDirectoryHandle | null = null;
    let attachmentsDir: FileSystemDirectoryHandle | null = null;
    if (imageAssets.length > 0) {
      imagesDir = await folder.getDirectoryHandle("images", { create: true });
    }
    if (fileAssets.length > 0) {
      attachmentsDir = await folder.getDirectoryHandle("attachments", {
        create: true,
      });
    }

    const assetSubdir = new Map<string, "images" | "attachments">();
    for (const a of imageAssets) assetSubdir.set(a.id, "images");
    for (const a of fileAssets) assetSubdir.set(a.id, "attachments");

    for (const asset of page.assets) {
      try {
        ctx.onProgress(`Writing ${asset.filename}`);
        const bytes = asset.bytes ?? (await asset.fetch!());
        const dir = assetSubdir.get(asset.id) === "images" ? imagesDir : attachmentsDir;
        if (!dir) throw new Error("destination dir not created");
        await writeBinaryFile(dir, asset.filename, bytes);
      } catch (err) {
        failures.push({
          assetId: asset.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const md = renderMarkdown(page.blocks, {
      resolveAssetPath: (id) => {
        const a = page.assets.find((x) => x.id === id);
        if (!a) return id;
        const sub = assetSubdir.get(a.id);
        return `${sub}/${a.filename}`;
      },
    });

    const frontmatter =
      `---\n` +
      `title: ${page.title}\n` +
      `sourceUrl: ${page.sourceUrl}\n` +
      `capturedAt: ${page.capturedAt}\n` +
      `---\n\n`;
    const titleHeading = `# ${page.title}\n\n`;

    await writeTextFile(folder, "README.md", frontmatter + titleHeading + md);

    return {
      ok: failures.length === 0,
      failures,
      destinationUrl: undefined,
    };
  }
}
