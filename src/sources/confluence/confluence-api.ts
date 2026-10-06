export type ConfluenceCreds = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

export type ConfluencePage = {
  id: string;
  title: string;
  adf: unknown;
  webUiPath: string;
};

export type ConfluenceAttachment = {
  id: string;
  fileId: string; // matches ADF media node `attrs.id`
  filename: string;
  mediaType: string;
};

export class ConfluenceApi {
  constructor(private creds: ConfluenceCreds) {}

  private authHeader(): string {
    const raw = `${this.creds.email}:${this.creds.apiToken}`;
    return `Basic ${btoa(raw)}`;
  }

  private base(): string {
    return this.creds.siteUrl.replace(/\/+$/, "");
  }

  async getPage(pageId: string): Promise<ConfluencePage> {
    const url = `${this.base()}/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader(), Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Confluence getPage ${pageId} failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      id: string;
      title: string;
      body: { atlas_doc_format: { value: string } };
      _links: { webui: string };
    };
    return {
      id: body.id,
      title: body.title,
      adf: JSON.parse(body.body.atlas_doc_format.value),
      webUiPath: body._links.webui,
    };
  }

  async listAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    const url = `${this.base()}/wiki/api/v2/pages/${pageId}/attachments`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader(), Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Confluence listAttachments ${pageId} failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      results: Array<{
        id: string;
        title: string;
        mediaType: string;
        fileId: string;
      }>;
    };
    return body.results.map((r) => ({
      id: r.id,
      fileId: r.fileId,
      filename: r.title,
      mediaType: r.mediaType,
    }));
  }

  async downloadAttachment(pageId: string, attachmentId: string): Promise<Uint8Array> {
    const url = `${this.base()}/wiki/rest/api/content/${pageId}/child/attachment/${attachmentId}/download`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader() },
      // Atlassian responds with a 302 to a presigned S3 URL; follow it but DO NOT
      // forward our auth header to the redirected host. fetch() handles the
      // redirect for us, and the presigned URL doesn't need our auth.
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(
        `Confluence downloadAttachment failed: ${res.status} (page ${pageId}, attachment ${attachmentId})`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
