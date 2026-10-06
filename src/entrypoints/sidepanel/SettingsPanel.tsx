import React, { useEffect, useState } from "react";
import {
  getSettings,
  saveSettings,
  type Settings,
} from "@/storage/settings";
import { ConfluenceApi } from "@/sources/confluence/confluence-api";
import { NotionApi } from "@/destinations/notion/notion-api";
import { textInputStyle } from "./Combobox";

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid #ccc",
  background: "white",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#0a7d6a",
  color: "white",
  border: 0,
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

// Matches Capture page / Import page: full-width primary action button.
const fullWidthPrimaryStyle: React.CSSProperties = {
  marginTop: 24,
  width: "100%",
  padding: 12,
  background: "#0a7d6a",
  color: "white",
  border: 0,
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

type TestStatus = "idle" | "ok" | "fail";

export type SettingsPanelProps = {
  // When true (default), wraps content in the standalone options-page layout
  // (heavy padding, fixed max width, large heading). When false, renders
  // compactly for embedding inside the side panel.
  standalone?: boolean;
};

export function SettingsPanel({ standalone = true }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showAtlToken, setShowAtlToken] = useState(false);
  const [showNotionToken, setShowNotionToken] = useState(false);
  const [atlStatus, setAtlStatus] = useState<TestStatus>("idle");
  const [atlMsg, setAtlMsg] = useState("");
  const [notionStatus, setNotionStatus] = useState<TestStatus>("idle");
  const [notionMsg, setNotionMsg] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  if (!settings) return <p>Loading…</p>;

  const updateAtl = (patch: Partial<NonNullable<Settings["atlassian"]>>) => {
    setSettings((s) => {
      if (!s) return s;
      const cur = s.atlassian ?? { siteUrl: "", email: "", apiToken: "" };
      return { ...s, atlassian: { ...cur, ...patch } };
    });
  };

  const updateNotion = (patch: Partial<NonNullable<Settings["notion"]>>) => {
    setSettings((s) => {
      if (!s) return s;
      const cur = s.notion ?? { integrationToken: "" };
      return { ...s, notion: { ...cur, ...patch } };
    });
  };

  const testAtlassian = async () => {
    if (!settings.atlassian) return;
    setAtlStatus("idle");
    try {
      // ConfluenceApi import keeps tree-shake friendly access to the same lib
      // the export flow uses; we still hit the v2 spaces endpoint directly to
      // exercise email+token auth path.
      void ConfluenceApi;
      const url = `${settings.atlassian.siteUrl.replace(/\/+$/, "")}/wiki/api/v2/spaces?limit=1`;
      const res = await fetch(url, {
        headers: {
          Authorization:
            "Basic " +
            btoa(
              `${settings.atlassian.email}:${settings.atlassian.apiToken}`,
            ),
        },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setAtlStatus("ok");
      setAtlMsg("Connected");
    } catch (e) {
      setAtlStatus("fail");
      setAtlMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const testNotion = async () => {
    if (!settings.notion) return;
    setNotionStatus("idle");
    try {
      const me = await new NotionApi(
        settings.notion.integrationToken,
      ).whoami();
      setNotionStatus("ok");
      setNotionMsg(`Connected as ${me.name || me.id}`);
    } catch (e) {
      setNotionStatus("fail");
      setNotionMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const outerStyle: React.CSSProperties = standalone
    ? { fontFamily: "system-ui", padding: 24, maxWidth: 640 }
    : { fontFamily: "system-ui", padding: 16 };

  return (
    <div style={outerStyle}>
      {standalone && <h1>WikiBridge — Settings</h1>}

      <section style={{ marginTop: standalone ? 0 : 8 }}>
        <SectionHeading standalone={standalone}>
          Atlassian (Confluence Cloud)
        </SectionHeading>
        <Field label="Site URL" standalone={standalone}>
          <input
            value={settings.atlassian?.siteUrl ?? ""}
            placeholder="https://myorg.atlassian.net"
            onChange={(e) => updateAtl({ siteUrl: e.target.value })}
            style={textInputStyle}
          />
        </Field>
        <Field label="Email" standalone={standalone}>
          <input
            value={settings.atlassian?.email ?? ""}
            placeholder="me@myorg.com"
            onChange={(e) => updateAtl({ email: e.target.value })}
            style={textInputStyle}
          />
        </Field>
        <Field label="API Token" standalone={standalone}>
          <input
            type={showAtlToken ? "text" : "password"}
            value={settings.atlassian?.apiToken ?? ""}
            onChange={(e) => updateAtl({ apiToken: e.target.value })}
            style={textInputStyle}
          />
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 6,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              style={secondaryButtonStyle}
              onClick={() => setShowAtlToken((v) => !v)}
            >
              {showAtlToken ? "Hide" : "Show"}
            </button>
            <button style={secondaryButtonStyle} onClick={testAtlassian}>
              Test
            </button>
            <Status status={atlStatus} message={atlMsg} />
          </div>
        </Field>
        <p style={{ fontSize: 12 }}>
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
          >
            Get an Atlassian API token
          </a>
        </p>
      </section>

      <section style={{ marginTop: 16 }}>
        <SectionHeading standalone={standalone}>Notion</SectionHeading>
        <Field label="Integration Token" standalone={standalone}>
          <input
            type={showNotionToken ? "text" : "password"}
            value={settings.notion?.integrationToken ?? ""}
            onChange={(e) =>
              updateNotion({ integrationToken: e.target.value })
            }
            style={textInputStyle}
          />
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 6,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              style={secondaryButtonStyle}
              onClick={() => setShowNotionToken((v) => !v)}
            >
              {showNotionToken ? "Hide" : "Show"}
            </button>
            <button style={secondaryButtonStyle} onClick={testNotion}>
              Test
            </button>
            <Status status={notionStatus} message={notionMsg} />
          </div>
        </Field>
        <p style={{ fontSize: 12 }}>
          <a
            href="https://www.notion.so/my-integrations"
            target="_blank"
            rel="noreferrer"
          >
            Create a Notion integration
          </a>
          . Then share each parent page with the integration.
        </p>
      </section>

      {standalone ? (
        <div style={{ marginTop: 16 }}>
          <button onClick={save} style={primaryButtonStyle}>
            Save
          </button>
          {saved && (
            <span style={{ marginLeft: 12, color: "green" }}>Saved.</span>
          )}
        </div>
      ) : (
        <>
          <button onClick={save} style={fullWidthPrimaryStyle}>
            Save
          </button>
          {saved && (
            <p style={{ margin: "8px 0 0", color: "green", fontSize: 13 }}>
              Saved.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeading({
  children,
  standalone,
}: {
  children: React.ReactNode;
  standalone: boolean;
}) {
  if (standalone) return <h2>{children}</h2>;
  return (
    <h3
      style={{
        fontSize: 13,
        margin: "0 0 8px",
        color: "#222",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {children}
    </h3>
  );
}

function Field({
  label,
  standalone,
  children,
}: {
  label: string;
  standalone: boolean;
  children: React.ReactNode;
}) {
  if (!standalone) {
    // Side-panel layout: label stacked above content (Import/Export style).
    return (
      <div style={{ margin: "10px 0" }}>
        <div
          style={{
            fontSize: 11,
            color: "#777",
            letterSpacing: 0.5,
            marginBottom: 6,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        margin: "8px 0",
      }}
    >
      <label
        style={{
          minWidth: 120,
          fontSize: 13,
          color: "#444",
          paddingTop: 6,
        }}
      >
        {label}
      </label>
      <div
        style={{
          display: "flex",
          gap: 8,
          flex: 1,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Status({
  status,
  message,
}: {
  status: TestStatus;
  message: string;
}) {
  if (status === "idle") return null;
  return (
    <span
      style={{
        color: status === "ok" ? "green" : "crimson",
        fontSize: 12,
        flexBasis: "100%",
      }}
    >
      {status === "ok" ? "✓" : "✗"} {message}
    </span>
  );
}
