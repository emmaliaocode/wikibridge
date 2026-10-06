const ID_RE = /[0-9a-f]{32}/i;
const DASHED_ID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractPageId(input: string): string {
  const dashed = input.match(DASHED_ID_RE);
  if (dashed) return dashed[0].replace(/-/g, "").toLowerCase();
  const flat = input.match(ID_RE);
  if (flat) return flat[0].toLowerCase();
  throw new Error(`could not extract Notion page id from: ${input}`);
}

type NBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  children?: NBlock[];
  [k: string]: any;
};

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export class NotionReadApi {
  constructor(private token: string) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Notion-Version": NOTION_VERSION,
      Accept: "application/json",
    };
  }

  async getPageTitle(pageId: string): Promise<string> {
    const r = await fetch(`${NOTION_BASE}/pages/${pageId}`, {
      headers: this.headers(),
    });
    if (!r.ok) throw new Error(notionErrorMessage("getPage", pageId, r));
    const json: any = await r.json();
    const props = json.properties ?? {};
    for (const value of Object.values<any>(props)) {
      if (value?.type === "title") {
        const parts = (value.title ?? [])
          .map((t: any) => t.plain_text ?? "")
          .join("");
        return parts || "Untitled";
      }
    }
    return "Untitled";
  }

  async getBlockTree(blockId: string, depth = 0): Promise<NBlock[]> {
    if (depth > 5) return [];
    const all: NBlock[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(`${NOTION_BASE}/blocks/${blockId}/children`);
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("start_cursor", cursor);
      const r = await fetch(url.toString(), { headers: this.headers() });
      if (!r.ok)
        throw new Error(notionErrorMessage("getChildren", blockId, r));
      const json: any = await r.json();
      for (const block of json.results as NBlock[]) {
        if (block.has_children) {
          block.children = await this.getBlockTree(block.id, depth + 1);
        }
        all.push(block);
      }
      cursor = json.has_more ? json.next_cursor : undefined;
    } while (cursor);
    return all;
  }

  async downloadAsset(url: string): Promise<Uint8Array> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`download ${url}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

function notionErrorMessage(
  op: string,
  id: string,
  res: Response,
): string {
  if (res.status === 404) {
    return (
      `${op} ${id}: 404 — page not accessible. ` +
      `In Notion, open the page → "•••" → Connections → add your integration, ` +
      `then try again.`
    );
  }
  if (res.status === 401) {
    return `${op} ${id}: 401 — Notion integration token invalid. Check Settings.`;
  }
  return `${op} ${id}: ${res.status}`;
}
