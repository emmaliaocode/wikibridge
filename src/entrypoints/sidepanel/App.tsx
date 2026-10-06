import React, { useEffect, useState } from "react";
import { detectConfluencePageId } from "@/sources/confluence/detect-page-id";
import {
  getSettings,
  saveSettings,
  type Settings,
} from "@/storage/settings";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@/messaging/protocol";
import { LocalDestination } from "@/destinations/local/local-destination";
import { ImportForm } from "./ImportForm";
import { Combobox, type ComboboxItem } from "./Combobox";
import { SettingsPanel } from "./SettingsPanel";

type Mode = "import" | "export" | "settings";

// `lastMode` was previously typed as "export" | "import"; widen the runtime
// check so an unknown stored value falls back cleanly.
const VALID_MODES: Mode[] = ["import", "export", "settings"];

export function App() {
  const [mode, setMode] = useState<Mode>("import");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      const saved = s?.defaults?.lastMode as Mode | undefined;
      if (saved && VALID_MODES.includes(saved)) setMode(saved);
      setReady(true);
    });
  }, []);

  async function setAndPersistMode(next: Mode) {
    setMode(next);
    const s = await getSettings();
    await saveSettings({
      ...s,
      defaults: { ...(s.defaults ?? {}), lastMode: next },
    });
  }

  if (!ready) return <p>Loading…</p>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px 0",
          borderBottom: "1px solid #eee",
        }}
      >
        <ModeButton
          active={mode === "import"}
          onClick={() => setAndPersistMode("import")}
        >
          Import
        </ModeButton>
        <ModeButton
          active={mode === "export"}
          onClick={() => setAndPersistMode("export")}
        >
          Export
        </ModeButton>
        <ModeButton
          active={mode === "settings"}
          onClick={() => setAndPersistMode("settings")}
        >
          Settings
        </ModeButton>
      </div>

      {mode === "import" && <ImportForm />}
      {mode === "export" && <ExportPanel />}
      {mode === "settings" && <SettingsPanel standalone={false} />}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        background: active ? "#0a7d6a" : "transparent",
        color: active ? "white" : "#333",
        border: 0,
        borderRadius: "6px 6px 0 0",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

type DestKind = "notion" | "local";
type Phase =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | {
      kind: "done";
      ok: boolean;
      destinationUrl?: string;
      failures: { reason: string }[];
    }
  | { kind: "error"; message: string };

function ExportPanel() {
  const [pageId, setPageId] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState<string>("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [destKind, setDestKind] = useState<DestKind>("notion");
  const [parents, setParents] = useState<
    { id: string; title: string; url: string }[]
  >([]);
  const [parentId, setParentId] = useState<string>("");
  const [parentQuery, setParentQuery] = useState<string>("");
  const [parentLoading, setParentLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      if (s.defaults.lastDestinationType) setDestKind(s.defaults.lastDestinationType);
      if (s.defaults.lastNotionParentId) setParentId(s.defaults.lastNotionParentId);
    });

    const refreshActiveTab = async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      const nextPageId = tab?.url ? detectConfluencePageId(tab.url) : null;
      const nextTitle = tab?.title ?? "";
      setPageId((prev) => {
        // Reset any stale "done" / "error" phase when the page actually changes
        // so the user isn't looking at the previous capture's result.
        if (prev !== nextPageId) setPhase({ kind: "idle" });
        return nextPageId;
      });
      setPageTitle(nextTitle);
    };

    refreshActiveTab();

    const onActivated = () => {
      refreshActiveTab();
    };
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; title?: string; status?: string },
      tab: chrome.tabs.Tab,
    ) => {
      // Only react when the active tab in the current window changes URL/title.
      if (!tab.active) return;
      if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
        refreshActiveTab();
      }
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // Server-side Notion parent search. Refires (debounced) when the user types
  // into the parent combobox. Initial query is "" → returns the default
  // recently-accessed list from the Notion search API.
  useEffect(() => {
    if (destKind !== "notion" || !settings?.notion) return;
    setParentLoading(true);
    const timer = setTimeout(() => {
      sendMessage({
        type: "search-notion-parents",
        query: parentQuery,
      })
        .then((resp) => {
          if (resp.type === "search-notion-parents-result") {
            setParents(resp.results);
          }
        })
        .finally(() => setParentLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [destKind, settings?.notion, parentQuery]);

  // When the saved lastNotionParentId is loaded and the result list arrives,
  // resolve it to a friendly label in the input so the user sees the name
  // rather than the raw id.
  useEffect(() => {
    if (!parentId || parentQuery) return;
    const match = parents.find((p) => p.id === parentId);
    if (match) setParentQuery(match.title);
  }, [parentId, parents, parentQuery]);

  if (!settings) return <p>Loading…</p>;

  const notionConfigured = Boolean(settings.notion?.integrationToken);
  const atlConfigured = Boolean(settings.atlassian?.apiToken);

  const onCapture = async () => {
    if (!pageId) return;
    setPhase({ kind: "working", message: "Starting…" });
    await saveSettings({
      ...settings,
      defaults: {
        ...settings.defaults,
        lastDestinationType: destKind,
        lastNotionParentId:
          destKind === "notion" ? parentId : settings.defaults.lastNotionParentId,
      },
    });

    if (destKind === "notion") {
      try {
        const resp = await sendWithProgress(
          {
            type: "capture",
            pageId,
            destination: { kind: "notion", parentPageId: parentId },
          },
          (msg) => setPhase({ kind: "working", message: msg }),
        );
        if (resp.type === "done") {
          setPhase({
            kind: "done",
            ok: resp.ok,
            destinationUrl: resp.destinationUrl,
            failures: resp.failures.map((f) => ({ reason: f.reason })),
          });
        } else if (resp.type === "error") {
          setPhase({ kind: "error", message: resp.message });
        }
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    // Local: fetch page in worker, then write files here (need a user gesture for showDirectoryPicker).
    // Request `readwrite` up front so the permission grant happens *inside* the click's
    // transient user activation. Without this the picker only grants read, and the later
    // `getDirectoryHandle({ create: true })` call — which happens after the long
    // `fetch-page` round-trip — needs to prompt for write permission but by then the
    // activation has expired, producing:
    //   "Failed to execute 'getDirectoryHandle' on 'FileSystemDirectoryHandle':
    //    User activation is required to request permissions."
    try {
      const dir = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      const fetched = await sendWithProgress(
        { type: "fetch-page", pageId },
        (msg) => setPhase({ kind: "working", message: msg }),
      );
      if (fetched.type !== "fetch-page-result") {
        if (fetched.type === "error") {
          setPhase({ kind: "error", message: fetched.message });
        }
        return;
      }
      // Worker inlined asset bytes as base64 strings (MV3 messaging JSON-
      // serializes, which corrupts Uint8Array). Decode each asset's bytes back
      // to a real Uint8Array before handing the page to LocalDestination.
      for (const asset of fetched.page.assets) {
        const enc = (asset as { bytesBase64?: string }).bytesBase64;
        if (typeof enc === "string") {
          asset.bytes = base64ToUint8Array(enc);
          delete (asset as { bytesBase64?: string }).bytesBase64;
        }
      }
      const dest = new LocalDestination();
      const result = await dest.publishToHandle(dir, fetched.page, {
        onProgress: (m) => setPhase({ kind: "working", message: m }),
      });
      setPhase({
        kind: "done",
        ok: result.ok,
        destinationUrl: undefined,
        failures: result.failures.map((f) => ({ reason: f.reason })),
      });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <section>
        <Label>CURRENT PAGE</Label>
        {pageId ? (
          <p style={{ margin: "4px 0" }}>{pageTitle || pageId}</p>
        ) : (
          <p style={{ color: "#888" }}>
            Open a Confluence page in the active tab to capture it.
          </p>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        <Label>SAVE TO</Label>
        <div style={{ display: "flex", gap: 8 }}>
          <DestButton
            selected={destKind === "notion"}
            disabled={!notionConfigured}
            onClick={() => setDestKind("notion")}
          >
            Notion
          </DestButton>
          <DestButton
            selected={destKind === "local"}
            onClick={() => setDestKind("local")}
          >
            Local file
          </DestButton>
        </div>
        {!notionConfigured && destKind === "notion" && (
          <p style={{ fontSize: 12 }}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                chrome.runtime.openOptionsPage();
              }}
            >
              Configure Notion to enable this option
            </a>
          </p>
        )}
      </section>

      {destKind === "notion" && (
        <section style={{ marginTop: 16 }}>
          <Label>PARENT PAGE</Label>
          <Combobox
            query={parentQuery}
            onQueryChange={(q) => {
              setParentQuery(q);
              if (parentId) setParentId("");
            }}
            items={parents.map(
              (p): ComboboxItem => ({ id: p.id, primary: p.title }),
            )}
            onPick={(item) => {
              setParentId(item.id);
              setParentQuery(item.primary);
            }}
            loading={parentLoading && parents.length === 0}
            loadingText="Loading parents…"
            placeholder="Search Notion pages…"
            emptyText="No matching pages."
          />
          {parentId && (
            <p
              style={{ margin: "6px 0 0", fontSize: 12, color: "#666" }}
            >
              Selected:{" "}
              <strong>
                {parents.find((p) => p.id === parentId)?.title ?? parentId}
              </strong>
            </p>
          )}
        </section>
      )}

      <button
        onClick={onCapture}
        disabled={
          !pageId ||
          !atlConfigured ||
          phase.kind === "working" ||
          (destKind === "notion" && (!notionConfigured || !parentId))
        }
        style={{
          marginTop: 24,
          width: "100%",
          padding: 12,
          background: "#0a7d6a",
          color: "white",
          border: 0,
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Capture page
      </button>

      <PhaseView phase={phase} />
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

function DestButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: 8,
        border: `2px solid ${selected ? "#0a7d6a" : "#ccc"}`,
        background: "white",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {selected ? "● " : "○ "}
      {children}
    </button>
  );
}

function PhaseView({ phase }: { phase: Phase }) {
  if (phase.kind === "idle") return null;
  if (phase.kind === "working")
    return <p style={{ marginTop: 16, color: "#444" }}>{phase.message}…</p>;
  if (phase.kind === "error")
    return (
      <p style={{ marginTop: 16, color: "crimson" }}>Error: {phase.message}</p>
    );
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ color: phase.ok ? "green" : "darkorange" }}>
        {phase.ok ? "Capture complete." : "Capture finished with issues."}
      </p>
      {phase.destinationUrl && (
        <p>
          <a href={phase.destinationUrl} target="_blank" rel="noreferrer">
            Open in Notion
          </a>
        </p>
      )}
      {phase.failures.length > 0 && (
        <details>
          <summary>{phase.failures.length} issue(s)</summary>
          <ul>
            {phase.failures.map((f, i) => (
              <li key={i}>{f.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function sendMessage(req: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(req, (resp: WorkerResponse) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

function sendWithProgress(
  req: WorkerRequest,
  onProgress: (msg: string) => void,
): Promise<WorkerResponse> {
  // The worker may send multiple responses ("progress" then "done"). We use
  // chrome.runtime.onMessage as a stream, with a unique request id.
  return new Promise((resolve, reject) => {
    const listener = (msg: WorkerResponse) => {
      if (msg.type === "progress") {
        onProgress(msg.message);
      } else {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage(req, (resp: WorkerResponse) => {
      const err = chrome.runtime.lastError;
      if (err) {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error(err.message));
      } else if (resp.type !== "progress") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(resp);
      }
    });
  });
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
