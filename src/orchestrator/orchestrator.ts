import type { Page } from "@/ir/types";
import type { Source } from "@/sources/source";
import type {
  Destination,
  PublishResult,
} from "@/destinations/destination";
import { startKeepalive, stopKeepalive } from "./keepalive";
import type { LocalSourceParams } from "@/sources/local/local-source";
import { ConfluenceDestination } from "@/destinations/confluence/confluence-destination";
import type { ConfluenceCreds } from "@/destinations/confluence/confluence-write-api";

export type RunOptions = {
  pageId: string;
  source: Source;
  destination: Destination;
  onProgress: (message: string) => void;
};

export async function runCapture(
  opts: RunOptions,
): Promise<{ page: Page; result: PublishResult }> {
  startKeepalive();
  try {
    opts.onProgress("Fetching page");
    const page = await opts.source.fetchPage(opts.pageId);
    const result = await opts.destination.publish(page, {
      onProgress: opts.onProgress,
    });
    return { page, result };
  } finally {
    stopKeepalive();
  }
}

export async function fetchPageOnly(opts: {
  pageId: string;
  source: Source;
  onProgress: (message: string) => void;
}): Promise<Page> {
  startKeepalive();
  try {
    opts.onProgress("Fetching page");
    return await opts.source.fetchPage(opts.pageId);
  } finally {
    stopKeepalive();
  }
}

export type ImportRunCreds = {
  confluence: ConfluenceCreds;
  notionToken: string;
};

export type ImportRunInput = {
  sourceId: "local-file" | "local-folder" | "notion";
  sourceParams:
    | { kind: "local-file"; fileHandle: any }
    | { kind: "local-folder"; dirHandle: any }
    | { kind: "notion"; pageUrlOrId: string };
  destinationParams: { spaceId: string; parentPageId?: string };
};

export async function runImport(
  creds: ImportRunCreds,
  input: ImportRunInput,
  onProgress: (m: string) => void,
): Promise<PublishResult> {
  startKeepalive();
  try {
    let page;
    if (
      input.sourceId === "local-file" ||
      input.sourceId === "local-folder"
    ) {
      // Dynamic import: LocalSource pulls in gray-matter + remark, which
      // touch `document` at module-init time. We want that code to load only
      // when a local import actually runs (skipping it for notion imports
      // and for the entire export flow).
      const { LocalSource } = await import("@/sources/local/local-source");
      const src = new LocalSource();
      const params: LocalSourceParams =
        input.sourceParams.kind === "local-file"
          ? { kind: "file", fileHandle: input.sourceParams.fileHandle }
          : {
              kind: "folder",
              dirHandle: (input.sourceParams as any).dirHandle,
            };
      onProgress("Reading local source…");
      page = await src.fetchPage(params);
    } else {
      if (!creds.notionToken) {
        throw new Error("Notion token not configured");
      }
      const { NotionSource } = await import("@/sources/notion/notion-source");
      const src = new NotionSource(creds.notionToken);
      onProgress("Reading Notion page…");
      page = await src.fetchPage({
        pageUrlOrId: (input.sourceParams as any).pageUrlOrId,
      });
    }

    const dest = new ConfluenceDestination(
      creds.confluence,
      input.destinationParams,
    );
    return dest.publish(page, { onProgress });
  } finally {
    stopKeepalive();
  }
}
