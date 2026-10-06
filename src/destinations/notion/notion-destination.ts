import type { Block, Inline, Page } from "@/ir/types";
import type {
  Destination,
  Failure,
  PublishContext,
  PublishResult,
} from "@/destinations/destination";
import { NotionApi } from "./notion-api";
import { uploadFile } from "./file-uploads";
import { capNestingDepth, irToNotionBlocks, sanitizeLinks } from "./ir-to-notion";

export type NotionDestinationConfig = {
  token: string;
  parentPageId: string;
};

export class NotionDestination implements Destination {
  readonly id = "notion";
  readonly displayName = "Notion";

  constructor(private config: NotionDestinationConfig) {}

  async isConfigured(): Promise<boolean> {
    return Boolean(this.config.token && this.config.parentPageId);
  }

  async publish(page: Page, ctx: PublishContext): Promise<PublishResult> {
    const api = new NotionApi(this.config.token);
    const failures: Failure[] = [];

    ctx.onProgress("Creating Notion page");
    const created = await api.createPage(this.config.parentPageId, page.title);

    // Confluence pages routinely carry attachments that no block references:
    // Gliffy/draw.io diagram sources (application/gliffy+json), macro
    // artifacts, thumbnails. Uploading them is pointless, and some carry types
    // Notion's File Upload API rejects outright. Restrict uploads to assets a
    // block actually points at.
    const referencedIds = collectReferencedAssetIds(page.blocks);
    const assetsToUpload = page.assets.filter((a) => referencedIds.has(a.id));

    const uploadIds = new Map<string, string>();
    let i = 0;
    for (const asset of assetsToUpload) {
      i++;
      try {
        ctx.onProgress(
          `Uploading ${asset.filename} (${i}/${assetsToUpload.length})`,
        );
        const bytes = asset.bytes ?? (await asset.fetch!());
        const id = await uploadFile(
          this.config.token,
          asset.filename,
          asset.mimeType,
          bytes,
        );
        uploadIds.set(asset.id, id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({
          assetId: asset.id,
          reason: `${asset.filename || "(unnamed)"} [${asset.mimeType || "no content-type"}]: ${msg}`,
        });
      }
    }

    const resolve = (assetId: string): string => {
      const id = uploadIds.get(assetId);
      if (!id) {
        // No upload id (failed) — return an empty string; the block will likely
        // be rejected by Notion and we'll capture it as a block-level failure.
        return "";
      }
      return id;
    };

    // Drop blocks whose required asset failed to upload so we don't send invalid JSON.
    // The upload-loop already recorded a single failure entry; dropping the block is a
    // consequence of that failure, not a new failure, so we don't push an extra entry here.
    const usableBlocks = page.blocks.filter((b) => {
      if (b.type === "image" || b.type === "attachment") {
        if (!uploadIds.has(b.assetId)) return false;
      }
      return true;
    });

    // Resolve relative/anchor links against the source page URL and drop any
    // that still aren't Notion-valid, so one bad link can't fail the append.
    const linkedBlocks = sanitizeLinks(usableBlocks, page.sourceUrl);
    // Notion rejects blocks nested deeper than 2 levels in a single append
    // request; cap the depth so deeply nested Confluence lists still publish.
    const notionBlocks = capNestingDepth(irToNotionBlocks(linkedBlocks, resolve));
    ctx.onProgress(`Appending ${notionBlocks.length} blocks`);
    try {
      await api.appendChildren(created.id, notionBlocks);
    } catch (err) {
      failures.push({
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      ok: failures.length === 0,
      failures,
      destinationUrl: created.url,
    };
  }
}

/**
 * Walk the block tree (and inline content) and collect the ids of every asset
 * that is actually referenced. Used to avoid uploading orphan attachments that
 * no block points at.
 */
function collectReferencedAssetIds(blocks: Block[]): Set<string> {
  const ids = new Set<string>();

  const walkInline = (inline: Inline): void => {
    if (inline.type === "attachmentRef") {
      ids.add(inline.assetId);
      inline.inlines.forEach(walkInline);
    } else if (inline.type === "link") {
      inline.inlines.forEach(walkInline);
    }
  };

  const walkBlock = (block: Block): void => {
    switch (block.type) {
      case "image":
      case "attachment":
        ids.add(block.assetId);
        break;
      case "heading":
      case "paragraph":
        block.inlines.forEach(walkInline);
        break;
      case "list":
        block.items.forEach((item) => item.forEach(walkBlock));
        break;
      case "quote":
      case "callout":
      case "toggle":
        block.blocks.forEach(walkBlock);
        break;
      case "table":
        block.rows.forEach((row) =>
          row.forEach((cell) => cell.forEach(walkBlock)),
        );
        break;
      // code, divider: no asset references
    }
  };

  blocks.forEach(walkBlock);
  return ids;
}
