import { describe, expect, it } from "vitest";
import { detectConfluencePageId } from "@/sources/confluence/detect-page-id";

describe("detectConfluencePageId", () => {
  it("extracts from /wiki/spaces/.../pages/<id>/Title", () => {
    expect(
      detectConfluencePageId(
        "https://x.atlassian.net/wiki/spaces/ENG/pages/12345/Hello-World",
      ),
    ).toBe("12345");
  });

  it("extracts from a pageId query string", () => {
    expect(
      detectConfluencePageId(
        "https://x.atlassian.net/wiki/display/page.action?pageId=98765",
      ),
    ).toBe("98765");
  });

  it("returns null for unrelated URLs", () => {
    expect(detectConfluencePageId("https://google.com")).toBeNull();
    expect(
      detectConfluencePageId("https://x.atlassian.net/jira/your-work"),
    ).toBeNull();
  });
});
