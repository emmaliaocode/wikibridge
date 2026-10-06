import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { runImport } from "@/orchestrator/orchestrator";
import { makeFile } from "./helpers/fake-filesystem";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("runImport — local file → Confluence", () => {
  it("creates page, PUTs body, returns destinationUrl", async () => {
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", () =>
        HttpResponse.json({
          id: "p1",
          _links: { webui: "/spaces/ENG/pages/p1/Hi" },
        }),
      ),
      http.put("https://x.atlassian.net/wiki/api/v2/pages/p1", () =>
        HttpResponse.json({ id: "p1" }),
      ),
    );

    const file = makeFile("hi.md", "# Hi\n\nbody");
    const messages: string[] = [];
    const r = await runImport(
      {
        confluence: {
          siteUrl: "https://x.atlassian.net",
          email: "u@x.com",
          apiToken: "T",
        },
        notionToken: "",
      },
      {
        sourceId: "local-file",
        sourceParams: { kind: "local-file", fileHandle: file as any },
        destinationParams: { spaceId: "100" },
      },
      (m) => messages.push(m),
    );

    expect(r.ok).toBe(true);
    expect(r.destinationUrl).toContain("/wiki/spaces/ENG/pages/p1/Hi");
    expect(messages.some((m) => /Creating page/i.test(m))).toBe(true);
  });
});
