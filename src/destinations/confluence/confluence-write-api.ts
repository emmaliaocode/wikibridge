export type ConfluenceCreds = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

export type SpaceSummary = { id: string; key: string; name: string };
export type PageSummary = { id: string; title: string };

export type CreatePageInput = {
  spaceId: string;
  title: string;
  parentPageId?: string;
};

export type CreatedPage = { id: string; webuiUrl: string };

export type AttachmentInput = {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
};

export class ConfluenceWriteApi {
  constructor(private creds: ConfluenceCreds) {}

  private base(): string {
    return this.creds.siteUrl.replace(/\/+$/, "");
  }

  private authHeader(): string {
    const raw = `${this.creds.email}:${this.creds.apiToken}`;
    return `Basic ${btoa(raw)}`;
  }

  private async jsonRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const res = await fetch(`${this.base()}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path}: ${res.status} ${text}`);
    }
    return res.json();
  }

  async listSpaces(): Promise<SpaceSummary[]> {
    const out: SpaceSummary[] = [];
    let path: string | null = "/wiki/api/v2/spaces?limit=250";
    // v2 returns at most `limit` rows per call and a relative cursor in
    // `_links.next`. Walk it so the picker can show every space the
    // authenticated user has access to.
    while (path) {
      const r: any = await this.jsonRequest("GET", path);
      for (const s of r.results ?? []) {
        out.push({ id: String(s.id), key: s.key, name: s.name });
      }
      const next: string | undefined = r._links?.next;
      path = next ? (next.startsWith("/") ? next : `/${next}`) : null;
    }
    return out;
  }

  async listRootPages(spaceId: string): Promise<PageSummary[]> {
    const r = await this.jsonRequest(
      "GET",
      `/wiki/api/v2/pages?space-id=${encodeURIComponent(spaceId)}&limit=50`,
    );
    return (r.results ?? [])
      .filter((p: any) => p.parentId == null)
      .map((p: any) => ({ id: String(p.id), title: p.title }));
  }

  async createPage(input: CreatePageInput): Promise<CreatedPage> {
    const body = {
      spaceId: input.spaceId,
      status: "current",
      title: input.title,
      body: { representation: "storage", value: "" },
      ...(input.parentPageId ? { parentId: input.parentPageId } : {}),
    };
    const r = await this.jsonRequest("POST", "/wiki/api/v2/pages", body);
    return {
      id: String(r.id),
      webuiUrl: `${this.base()}/wiki${r._links?.webui ?? ""}`,
    };
  }

  async updatePageBody(
    pageId: string,
    title: string,
    storageXhtml: string,
  ): Promise<void> {
    await this.jsonRequest("PUT", `/wiki/api/v2/pages/${pageId}`, {
      id: pageId,
      status: "current",
      title,
      version: { number: 2 },
      body: { representation: "storage", value: storageXhtml },
    });
  }

  async uploadAttachment(
    pageId: string,
    input: AttachmentInput,
  ): Promise<string> {
    const form = new FormData();
    // Copy into a fresh ArrayBuffer to satisfy strict BlobPart typing
    // (Uint8Array<SharedArrayBuffer> is not assignable to BlobPart).
    const buf = new ArrayBuffer(input.bytes.byteLength);
    new Uint8Array(buf).set(input.bytes);
    const blob = new Blob([buf], { type: input.mimeType });
    form.append("file", blob, input.filename);
    form.append("minorEdit", "true");
    const res = await fetch(
      `${this.base()}/wiki/rest/api/content/${pageId}/child/attachment`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader(),
          "X-Atlassian-Token": "no-check",
          Accept: "application/json",
        },
        body: form,
      },
    );
    if (!res.ok) {
      throw new Error(
        `upload ${input.filename}: ${res.status} ${await res.text()}`,
      );
    }
    const json: any = await res.json();
    const title = json?.results?.[0]?.title;
    if (typeof title !== "string") {
      throw new Error(
        `upload ${input.filename}: unexpected response shape`,
      );
    }
    return title;
  }
}
