export function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Strip C0 control chars (except tab/newline/cr), then escape entities.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

export function escapeAttr(s: string): string {
  const cleaned = s.replace(CONTROL_CHARS, "");
  return escapeText(cleaned);
}

export function escapeCdata(s: string): string {
  return s.replace(/]]>/g, "]]]]><![CDATA[>");
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeUrl(s: string): string {
  try {
    const u = new URL(s);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return "#";
    return u.toString();
  } catch {
    return "#";
  }
}

export function safeFilename(s: string): string {
  if (s.includes("/") || s.includes("\\")) {
    throw new Error(`unsafe filename: ${s}`);
  }
  return escapeAttr(s);
}
