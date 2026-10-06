// Must come first: stubs `document` in the MV3 service worker before any
// transitive import (notably the remark/micromark chain) touches it.
import "@/polyfill-document";
import { ConfluenceSource } from "@/sources/confluence/confluence-source";
import { NotionDestination } from "@/destinations/notion/notion-destination";
import { NotionApi } from "@/destinations/notion/notion-api";
import { runCapture, fetchPageOnly } from "@/orchestrator/orchestrator";
import { ConfluenceDestination } from "@/destinations/confluence/confluence-destination";
import { ConfluenceWriteApi } from "@/destinations/confluence/confluence-write-api";
import { NotionSource } from "@/sources/notion/notion-source";
import { isKeepaliveAlarm, startKeepalive, stopKeepalive } from "@/orchestrator/keepalive";
import { getSettings } from "@/storage/settings";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@/messaging/protocol";
import type { Asset, Page } from "@/ir/types";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default defineBackground({
  main() {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (isKeepaliveAlarm(alarm.name)) {
        // no-op
      }
    });

    chrome.runtime.onMessage.addListener((msg: WorkerRequest, _sender, sendResponse) => {
      let finalSent = false;
      const reply = (resp: WorkerResponse) => {
        if (resp.type === "progress") {
          // Streaming update: broadcast so the side panel's onMessage listener fires.
          chrome.runtime.sendMessage(resp).catch(() => {});
          return;
        }
        // Terminal reply. Deliver via BOTH sendResponse (for callers that
        // passed a callback) AND a broadcast (for callers that only listen via
        // onMessage — the import flow does). Side-effect-free if either has no
        // receiver.
        if (finalSent) return;
        finalSent = true;
        try {
          sendResponse(resp);
        } catch {
          /* sender went away */
        }
        chrome.runtime.sendMessage(resp).catch(() => {});
      };
      handle(msg, reply).catch((err) => {
        reply({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        } satisfies WorkerResponse);
      });
      return true; // keep channel open for async terminal response
    });
  },
});

async function handle(
  msg: WorkerRequest,
  reply: (resp: WorkerResponse) => void,
): Promise<void> {
  const settings = await getSettings();

  switch (msg.type) {
    case "capture": {
      if (!settings.atlassian) throw new Error("Atlassian not configured");
      const source = new ConfluenceSource(settings.atlassian);
      if (msg.destination.kind === "notion") {
        if (!settings.notion) throw new Error("Notion not configured");
        const destination = new NotionDestination({
          token: settings.notion.integrationToken,
          parentPageId: msg.destination.parentPageId,
        });
        const { result } = await runCapture({
          pageId: msg.pageId,
          source,
          destination,
          onProgress: (m) => reply({ type: "progress", message: m }),
        });
        reply({
          type: "done",
          ok: result.ok,
          failures: result.failures,
          destinationUrl: result.destinationUrl,
        });
        return;
      }
      throw new Error(
        "local-deferred capture must be handled by the side panel, not the worker",
      );
    }
    case "fetch-page": {
      if (!settings.atlassian) throw new Error("Atlassian not configured");
      const source = new ConfluenceSource(settings.atlassian);
      const page = await fetchPageOnly({
        pageId: msg.pageId,
        source,
        onProgress: (m) => reply({ type: "progress", message: m }),
      });
      for (const asset of page.assets) {
        let bytes = asset.bytes;
        if (!bytes && asset.fetch) {
          reply({
            type: "progress",
            message: `Downloading ${asset.filename}`,
          });
          bytes = await asset.fetch();
        }
        if (bytes) {
          (asset as Asset & { bytesBase64?: string }).bytesBase64 =
            uint8ArrayToBase64(bytes);
        }
        delete (asset as { bytes?: unknown }).bytes;
        delete (asset as { fetch?: unknown }).fetch;
      }
      reply({ type: "fetch-page-result", page });
      return;
    }
    case "search-notion-parents": {
      if (!settings.notion) throw new Error("Notion not configured");
      const results = await new NotionApi(
        settings.notion.integrationToken,
      ).searchParents(msg.query);
      reply({ type: "search-notion-parents-result", results });
      return;
    }
    case "list-spaces": {
      if (!settings.atlassian) throw new Error("Atlassian not configured");
      const api = new ConfluenceWriteApi(settings.atlassian);
      const spaces = await api.listSpaces();
      reply({ type: "list-spaces-result", spaces });
      return;
    }
    case "list-root-pages": {
      if (!settings.atlassian) throw new Error("Atlassian not configured");
      const api = new ConfluenceWriteApi(settings.atlassian);
      const pages = await api.listRootPages(msg.spaceId);
      reply({ type: "list-root-pages-result", pages });
      return;
    }
    case "import-notion": {
      if (!settings.atlassian) throw new Error("Atlassian not configured");
      if (!settings.notion?.integrationToken)
        throw new Error("Notion not configured");
      startKeepalive();
      try {
        reply({ type: "progress", message: "Reading Notion page…" });
        const src = new NotionSource(settings.notion.integrationToken);
        const page = await src.fetchPage({ pageUrlOrId: msg.pageUrlOrId });
        const dest = new ConfluenceDestination(
          settings.atlassian,
          msg.destinationParams,
        );
        const result = await dest.publish(page, {
          onProgress: (m) => reply({ type: "progress", message: m }),
        });
        reply({
          type: "done",
          ok: result.ok,
          failures: result.failures,
          destinationUrl: result.destinationUrl,
        });
      } finally {
        stopKeepalive();
      }
      return;
    }
    case "import-prebuilt": {
      if (!settings.atlassian) throw new Error("Atlassian not configured");
      startKeepalive();
      try {
        // Decode any base64-encoded asset bytes shipped from the side panel
        // back into Uint8Arrays so the destination can upload them.
        const page = decodePageAssets(msg.page);
        const dest = new ConfluenceDestination(
          settings.atlassian,
          msg.destinationParams,
        );
        const result = await dest.publish(page, {
          onProgress: (m) => reply({ type: "progress", message: m }),
        });
        reply({
          type: "done",
          ok: result.ok,
          failures: result.failures,
          destinationUrl: result.destinationUrl,
        });
      } finally {
        stopKeepalive();
      }
      return;
    }
  }
}

function decodePageAssets(page: Page): Page {
  const assets = page.assets.map((a) => {
    const enc = (a as Asset & { bytesBase64?: string }).bytesBase64;
    if (typeof enc === "string") {
      const out: Asset = {
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        bytes: base64ToUint8Array(enc),
      };
      return out;
    }
    return a;
  });
  return { ...page, assets };
}
