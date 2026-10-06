import type { Page } from "@/ir/types";
import type {
  Destination,
  PublishContext,
  PublishResult,
  Failure,
} from "@/destinations/destination";
import {
  ConfluenceWriteApi,
  type ConfluenceCreds,
} from "./confluence-write-api";
import { irToStorage } from "./ir-to-storage";

export type ConfluenceDestinationParams = {
  spaceId: string;
  parentPageId?: string;
};

export class ConfluenceDestination implements Destination {
  readonly id = "confluence";
  readonly displayName = "Confluence";

  private api: ConfluenceWriteApi;

  constructor(
    private creds: ConfluenceCreds,
    private params: ConfluenceDestinationParams,
  ) {
    this.api = new ConfluenceWriteApi(creds);
  }

  async isConfigured(): Promise<boolean> {
    return Boolean(
      this.creds.siteUrl && this.creds.email && this.creds.apiToken,
    );
  }

  async publish(page: Page, ctx: PublishContext): Promise<PublishResult> {
    const failures: Failure[] = [];

    ctx.onProgress(`Creating page "${page.title}"…`);
    let created: { id: string; webuiUrl: string };
    try {
      created = await this.api.createPage({
        spaceId: this.params.spaceId,
        parentPageId: this.params.parentPageId,
        title: page.title,
      });
    } catch (e: any) {
      return {
        ok: false,
        failures: [{ reason: `create page: ${e?.message ?? e}` }],
      };
    }

    const assetMap = new Map<string, string | null>();
    for (let i = 0; i < page.assets.length; i++) {
      const asset = page.assets[i];
      ctx.onProgress(
        `Uploading ${asset.filename} (${i + 1}/${page.assets.length})…`,
      );
      try {
        const bytes =
          asset.bytes ?? (asset.fetch ? await asset.fetch() : null);
        if (!bytes) throw new Error("no bytes available");
        const uploadedName = await this.api.uploadAttachment(created.id, {
          filename: asset.filename,
          bytes,
          mimeType: asset.mimeType,
        });
        assetMap.set(asset.id, uploadedName);
      } catch (e: any) {
        assetMap.set(asset.id, null);
        failures.push({
          assetId: asset.id,
          reason: `upload ${asset.filename}: ${e?.message ?? e}`,
        });
      }
    }

    ctx.onProgress("Rendering page body…");
    const xhtml = irToStorage(page.blocks, {
      assetResolver: (id) => assetMap.get(id) ?? null,
    });

    ctx.onProgress("Publishing…");
    try {
      await this.api.updatePageBody(created.id, page.title, xhtml);
    } catch (e: any) {
      failures.push({
        reason: `body upload failed; page created but empty: ${created.webuiUrl}`,
      });
      return {
        ok: false,
        failures,
        destinationUrl: created.webuiUrl,
      };
    }

    return {
      ok: failures.length === 0,
      failures,
      destinationUrl: created.webuiUrl,
    };
  }
}
