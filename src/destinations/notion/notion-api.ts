const NOTION_VERSION = "2026-03-11";
const BASE = "https://api.notion.com";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

export type NotionParentSearchResult = {
  id: string;
  title: string;
  url: string;
};

export class NotionApi {
  constructor(private token: string) {}

  async createPage(parentPageId: string, title: string): Promise<{ id: string; url: string }> {
    const res = await fetch(`${BASE}/v1/pages`, {
      method: "POST",
      headers: headers(this.token),
      body: JSON.stringify({
        parent: { type: "page_id", page_id: parentPageId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: title } }],
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Notion createPage failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { id: string; url: string };
    return { id: body.id, url: body.url };
  }

  async appendChildren(blockId: string, children: unknown[]): Promise<void> {
    const CHUNK = 100;
    for (let i = 0; i < children.length; i += CHUNK) {
      const chunk = children.slice(i, i + CHUNK);
      const res = await fetch(`${BASE}/v1/blocks/${blockId}/children`, {
        method: "PATCH",
        headers: headers(this.token),
        body: JSON.stringify({ children: chunk }),
      });
      if (!res.ok) {
        throw new Error(
          `Notion appendChildren failed: ${res.status} ${await res.text()}`,
        );
      }
    }
  }

  async searchParents(query: string): Promise<NotionParentSearchResult[]> {
    const res = await fetch(`${BASE}/v1/search`, {
      method: "POST",
      headers: headers(this.token),
      body: JSON.stringify({
        query,
        filter: { value: "page", property: "object" },
        page_size: 20,
      }),
    });
    if (!res.ok) {
      throw new Error(`Notion search failed: ${res.status}`);
    }
    const body = (await res.json()) as { results: any[] };
    return body.results.map((r) => ({
      id: r.id,
      title:
        r.properties?.title?.title?.[0]?.plain_text ??
        r.properties?.Name?.title?.[0]?.plain_text ??
        "(untitled)",
      url: r.url,
    }));
  }

  async whoami(): Promise<{ name: string; id: string }> {
    const res = await fetch(`${BASE}/v1/users/me`, {
      method: "GET",
      headers: headers(this.token),
    });
    if (!res.ok) throw new Error(`Notion whoami failed: ${res.status}`);
    const body = (await res.json()) as { id: string; name?: string };
    return { id: body.id, name: body.name ?? "" };
  }
}
