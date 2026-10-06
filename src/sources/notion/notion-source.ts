import type { Asset, Page } from "@/ir/types";
import { NotionReadApi, extractPageId } from "./notion-read-api";
import { notionBlocksToIr } from "./notion-blocks-to-ir";

export type NotionSourceParams = { pageUrlOrId: string };

export class NotionSource {
  readonly id = "notion";
  private api: NotionReadApi;

  constructor(token: string) {
    this.api = new NotionReadApi(token);
  }

  async fetchPage(params: NotionSourceParams): Promise<Page> {
    const id = extractPageId(params.pageUrlOrId);
    const [title, tree] = await Promise.all([
      this.api.getPageTitle(id),
      this.api.getBlockTree(id),
    ]);
    const { blocks, mediaRefs } = notionBlocksToIr(tree);

    const assets: Asset[] = mediaRefs.map((m) => ({
      id: m.blockId,
      filename: m.filename ?? `${m.blockId}.bin`,
      mimeType: m.mime ?? "application/octet-stream",
      fetch: () => this.api.downloadAsset(m.url),
    }));

    return {
      id,
      title,
      sourceUrl: params.pageUrlOrId,
      capturedAt: new Date().toISOString(),
      blocks,
      assets,
    };
  }
}
