export function detectConfluencePageId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.endsWith(".atlassian.net")) return null;
    if (!url.pathname.startsWith("/wiki/")) return null;

    const m = url.pathname.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/|$)/);
    if (m) return m[1];

    const pid = url.searchParams.get("pageId");
    if (pid && /^\d+$/.test(pid)) return pid;

    return null;
  } catch {
    return null;
  }
}
