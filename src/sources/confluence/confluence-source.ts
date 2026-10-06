import type { Asset, Page } from "@/ir/types";
import type { Source } from "@/sources/source";
import { ConfluenceApi, type ConfluenceCreds } from "./confluence-api";
import { adfToBlocks } from "./adf-to-ir";

export class ConfluenceSource implements Source {
  readonly id = "confluence-cloud";
  private api: ConfluenceApi;
  private creds: ConfluenceCreds;

  constructor(creds: ConfluenceCreds) {
    this.creds = creds;
    this.api = new ConfluenceApi(creds);
  }

  async fetchPage(pageId: string): Promise<Page> {
    const [pageData, attachments] = await Promise.all([
      this.api.getPage(pageId),
      this.api.listAttachments(pageId),
    ]);

    const assets: Asset[] = attachments.map((a) => ({
      id: a.fileId,
      filename: a.filename,
      mimeType: a.mediaType,
      fetch: () => this.api.downloadAttachment(pageId, a.id),
    }));

    const blocks = adfToBlocks(
      pageData.adf as any,
      attachments.map((a) => ({
        fileId: a.fileId,
        filename: a.filename,
        mediaType: a.mediaType,
      })),
    );

    return {
      id: pageData.id,
      title: pageData.title,
      sourceUrl: `${this.creds.siteUrl.replace(/\/+$/, "")}/wiki${pageData.webUiPath}`,
      capturedAt: new Date().toISOString(),
      blocks,
      assets,
    };
  }
}
