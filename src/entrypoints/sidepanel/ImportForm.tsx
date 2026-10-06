import React, { useEffect, useState } from "react";
import { LocalSource } from "@/sources/local/local-source";
import type { Page, Asset } from "@/ir/types";
import { Combobox, type ComboboxItem, textInputStyle } from "./Combobox";

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

type SourceKind = "local-file" | "local-folder" | "notion";

type Space = { id: string; key: string; name: string };
type PageSummary = { id: string; title: string };

type PickedLocal =
  | { kind: "file"; handle: FileSystemFileHandle; label: string }
  | { kind: "folder"; handle: FileSystemDirectoryHandle; label: string };

type Status =
  | { state: "idle" }
  | { state: "running"; message: string }
  | {
      state: "done";
      ok: boolean;
      url?: string;
      failures: Array<{ reason: string }>;
    }
  | { state: "error"; message: string };

export function ImportForm() {
  const [sourceKind, setSourceKind] = useState<SourceKind>("local-folder");
  const [picked, setPicked] = useState<PickedLocal | null>(null);
  const [notionUrl, setNotionUrl] = useState("");
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [spaceId, setSpaceId] = useState<string>("");
  const [spaceQuery, setSpaceQuery] = useState<string>("");
  const [rootPages, setRootPages] = useState<PageSummary[] | null>(null);
  const [parentId, setParentId] = useState<string>("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "list-spaces" }, (r) => {
      if (r?.type === "list-spaces-result") setSpaces(r.spaces);
    });
  }, []);

  useEffect(() => {
    if (!spaceId) {
      setRootPages(null);
      setParentId("");
      return;
    }
    chrome.runtime.sendMessage(
      { type: "list-root-pages", spaceId },
      (r) => {
        if (r?.type === "list-root-pages-result") setRootPages(r.pages);
      },
    );
  }, [spaceId]);

  useEffect(() => {
    const listener = (msg: any) => {
      if (msg?.type === "progress")
        setStatus({ state: "running", message: msg.message });
      else if (msg?.type === "done")
        setStatus({
          state: "done",
          ok: msg.ok,
          url: msg.destinationUrl,
          failures: msg.failures ?? [],
        });
      else if (msg?.type === "error")
        setStatus({ state: "error", message: msg.message });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const isLocal = sourceKind !== "notion";

  async function pickFile() {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          { description: "Markdown", accept: { "text/markdown": [".md"] } },
        ],
      });
      setPicked({ kind: "file", handle, label: handle.name });
      setSourceKind("local-file");
    } catch {
      /* user cancelled */
    }
  }

  async function pickFolder() {
    try {
      const handle = await (window as any).showDirectoryPicker();
      setPicked({ kind: "folder", handle, label: handle.name });
      setSourceKind("local-folder");
    } catch {
      /* user cancelled */
    }
  }

  async function startImport() {
    setStatus({ state: "running", message: "Starting…" });
    const destinationParams = {
      spaceId,
      parentPageId: parentId || undefined,
    };

    if (sourceKind === "notion") {
      // Notion is a pure REST source; let the worker fetch + publish.
      chrome.runtime.sendMessage({
        type: "import-notion",
        pageUrlOrId: notionUrl,
        destinationParams,
      });
      return;
    }
    if (!picked) {
      setStatus({ state: "error", message: "Pick a file or folder first." });
      return;
    }

    // Local sources have to be read here — FileSystem Access API is not
    // available in MV3 service workers, and FileSystem*Handle is not
    // JSON-cloneable across chrome.runtime.sendMessage. So we build the
    // Page IR locally, eagerly download every asset's bytes, base64-encode
    // them, and hand the prebuilt page to the worker.
    try {
      setStatus({ state: "running", message: "Reading local source…" });
      const src = new LocalSource();
      const page =
        picked.kind === "file"
          ? await src.fetchPage({
              kind: "file",
              fileHandle: picked.handle,
            })
          : await src.fetchPage({
              kind: "folder",
              dirHandle: picked.handle,
            });

      const prepared = await prepareAssetsForTransport(page, (m) =>
        setStatus({ state: "running", message: m }),
      );

      chrome.runtime.sendMessage({
        type: "import-prebuilt",
        page: prepared,
        destinationParams,
      });
    } catch (e) {
      setStatus({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const canStart =
    !!spaceId &&
    (sourceKind === "notion" ? notionUrl.trim().length > 0 : !!picked);

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <section>
        <Label>SOURCE</Label>
        <div style={{ display: "flex", gap: 8 }}>
          <SourceButton
            selected={isLocal}
            onClick={() => setSourceKind("local-folder")}
          >
            Local
          </SourceButton>
          <SourceButton
            selected={!isLocal}
            onClick={() => setSourceKind("notion")}
          >
            Notion
          </SourceButton>
        </div>
      </section>

      {isLocal && (
        <section style={{ marginTop: 16 }}>
          <Label>LOCAL FILE</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={pickerButtonStyle} onClick={pickFile}>
              Pick .md file
            </button>
            <button style={pickerButtonStyle} onClick={pickFolder}>
              Pick folder
            </button>
          </div>
          {picked ? (
            <p style={{ margin: "8px 0 0", fontSize: 13 }}>
              Selected: <strong>{picked.label}</strong>{" "}
              <button
                onClick={() => setPicked(null)}
                style={clearButtonStyle}
                aria-label="Clear selection"
                title="Clear selection"
              >
                ✕
              </button>
            </p>
          ) : (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#888" }}>
              Pick a single .md file or a folder containing one .md file with
              optional images/ and attachments/ subfolders.
            </p>
          )}
        </section>
      )}

      {!isLocal && (
        <section style={{ marginTop: 16 }}>
          <Label>NOTION PAGE URL</Label>
          <input
            type="text"
            value={notionUrl}
            onChange={(e) => setNotionUrl(e.target.value)}
            placeholder="https://www.notion.so/..."
            style={textInputStyle}
          />
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        <Label>CONFLUENCE SPACE</Label>
        <Combobox
          query={spaceQuery}
          onQueryChange={(q) => {
            setSpaceQuery(q);
            if (spaceId) setSpaceId("");
          }}
          items={filterSpaces(spaces ?? [], spaceQuery).map(
            (s): ComboboxItem => ({
              id: s.id,
              primary: s.name,
              secondary: s.key,
            }),
          )}
          onPick={(item) => {
            const s = (spaces ?? []).find((sp) => sp.id === item.id);
            if (!s) return;
            setSpaceId(s.id);
            setSpaceQuery(`${s.name} (${s.key})`);
          }}
          loading={spaces === null}
          loadingText="Loading spaces…"
          placeholder="Search spaces by name or key…"
          emptyText="No matching spaces."
        />
        {spaceId && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#666" }}>
            Selected:{" "}
            <strong>
              {spaces?.find((s) => s.id === spaceId)?.name ?? spaceId}
            </strong>
          </p>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        <Label>PARENT PAGE</Label>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          disabled={!spaceId}
          style={selectStyle}
        >
          <option value="">(space root)</option>
          {(rootPages ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </section>

      <button
        onClick={startImport}
        disabled={!canStart || status.state === "running"}
        style={primaryButtonStyle(canStart && status.state !== "running")}
      >
        Import page
      </button>

      <StatusView status={status} />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "#777",
        letterSpacing: 0.5,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

async function prepareAssetsForTransport(
  page: Page,
  onProgress: (m: string) => void,
): Promise<Page> {
  const assets: Asset[] = [];
  for (let i = 0; i < page.assets.length; i++) {
    const a = page.assets[i];
    let bytes = a.bytes;
    if (!bytes && a.fetch) {
      onProgress(
        `Reading ${a.filename} (${i + 1}/${page.assets.length})…`,
      );
      bytes = await a.fetch();
    }
    if (bytes) {
      const next = {
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        bytesBase64: uint8ArrayToBase64(bytes),
      } as Asset & { bytesBase64: string };
      assets.push(next);
    } else {
      // No bytes available; pass through without fetch (worker will skip).
      assets.push({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
      });
    }
  }
  return { ...page, assets };
}

function filterSpaces(spaces: Space[], query: string): Space[] {
  const q = query.trim().toLowerCase();
  if (!q) return spaces.slice(0, 50);
  const matched = spaces.filter(
    (s) =>
      s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q),
  );
  return matched.slice(0, 50);
}

function SourceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: 8,
        border: `2px solid ${selected ? "#0a7d6a" : "#ccc"}`,
        background: "white",
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      {selected ? "● " : "○ "}
      {children}
    </button>
  );
}

const pickerButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: 8,
  border: "1px solid #ccc",
  background: "white",
  borderRadius: 6,
  cursor: "pointer",
};

const clearButtonStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: "0 6px",
  border: "1px solid #ccc",
  background: "white",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 11,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: 6,
  border: "1px solid #ccc",
  borderRadius: 6,
  background: "white",
  fontSize: 13,
};

function primaryButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    marginTop: 24,
    width: "100%",
    padding: 12,
    background: enabled ? "#0a7d6a" : "#9ec1b9",
    color: "white",
    border: 0,
    borderRadius: 6,
    cursor: enabled ? "pointer" : "not-allowed",
    fontSize: 14,
  };
}

function StatusView({ status }: { status: Status }) {
  if (status.state === "idle") return null;
  if (status.state === "running")
    return (
      <p style={{ marginTop: 16, color: "#444" }}>{status.message}…</p>
    );
  if (status.state === "error")
    return (
      <p style={{ marginTop: 16, color: "crimson" }}>
        Error: {status.message}
      </p>
    );
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ color: status.ok ? "green" : "darkorange" }}>
        {status.ok ? "Import complete." : "Import finished with issues."}
      </p>
      {status.url && (
        <p>
          <a href={status.url} target="_blank" rel="noreferrer">
            Open page in Confluence
          </a>
        </p>
      )}
      {status.failures.length > 0 && (
        <details>
          <summary>{status.failures.length} issue(s)</summary>
          <ul>
            {status.failures.map((f, i) => (
              <li key={i}>{f.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
