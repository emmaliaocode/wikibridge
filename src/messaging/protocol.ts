import type { Failure } from "@/destinations/destination";

export type CaptureRequest = {
  type: "capture";
  pageId: string;
  destination:
    | { kind: "notion"; parentPageId: string }
    | { kind: "local-deferred" }; // local writes happen in the side panel (needs the user-picked dir handle)
};

export type CaptureProgress = {
  type: "progress";
  message: string;
};

export type CaptureDone = {
  type: "done";
  ok: boolean;
  failures: Failure[];
  destinationUrl?: string;
};

export type CaptureError = {
  type: "error";
  message: string;
};

export type SearchNotionParentsRequest = {
  type: "search-notion-parents";
  query: string;
};

export type SearchNotionParentsResponse = {
  type: "search-notion-parents-result";
  results: Array<{ id: string; title: string; url: string }>;
};

export type FetchPageOnlyRequest = {
  // For local destination: side panel asks the worker for the IR, then writes
  // files itself using the FileSystemDirectoryHandle (which can't cross runtimes).
  type: "fetch-page";
  pageId: string;
};

export type FetchPageOnlyResponse = {
  type: "fetch-page-result";
  page: import("@/ir/types").Page;
};

// --- Import direction ---

// Local sources are read in the side panel (the service worker has no
// FileSystem Access API context and FileSystem*Handle isn't JSON-cloneable
// across chrome.runtime.sendMessage anyway). The Notion source still runs
// inside the worker because it's pure REST.

export type ImportNotionRequest = {
  type: "import-notion";
  pageUrlOrId: string;
  destinationParams: {
    spaceId: string;
    parentPageId?: string;
  };
};

// Side panel prebuilds the Page IR (assets bytes base64-encoded) and hands it
// to the worker for the Confluence write side.
export type ImportPrebuiltRequest = {
  type: "import-prebuilt";
  page: import("@/ir/types").Page;
  destinationParams: {
    spaceId: string;
    parentPageId?: string;
  };
};

export type ListSpacesRequest = { type: "list-spaces" };
export type ListSpacesResponse = {
  type: "list-spaces-result";
  spaces: Array<{ id: string; key: string; name: string }>;
};

export type ListRootPagesRequest = {
  type: "list-root-pages";
  spaceId: string;
};
export type ListRootPagesResponse = {
  type: "list-root-pages-result";
  pages: Array<{ id: string; title: string }>;
};

export type WorkerRequest =
  | CaptureRequest
  | SearchNotionParentsRequest
  | FetchPageOnlyRequest
  | ImportNotionRequest
  | ImportPrebuiltRequest
  | ListSpacesRequest
  | ListRootPagesRequest;

export type WorkerResponse =
  | CaptureProgress
  | CaptureDone
  | CaptureError
  | SearchNotionParentsResponse
  | FetchPageOnlyResponse
  | ListSpacesResponse
  | ListRootPagesResponse;
