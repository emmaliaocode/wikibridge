import { describe, expect, it } from "vitest";
import {
  escapeText,
  escapeAttr,
  escapeCdata,
  safeUrl,
  safeFilename,
} from "@/destinations/confluence/escape";

describe("escapeText", () => {
  it("escapes the five XML entities", () => {
    expect(escapeText(`<a href="x">&"'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&quot;&apos;&lt;/a&gt;",
    );
  });

  it("passes plain text through", () => {
    expect(escapeText("hello world")).toBe("hello world");
  });
});

describe("escapeAttr", () => {
  it("escapes quotes and control chars", () => {
    expect(escapeAttr(`a"bc`)).toBe("a&quot;bc");
  });
});

describe("escapeCdata", () => {
  it("splits ]]> across CDATA boundaries", () => {
    expect(escapeCdata("foo]]>bar")).toBe("foo]]]]><![CDATA[>bar");
  });

  it("passes safe code through", () => {
    expect(escapeCdata("const x = 1;")).toBe("const x = 1;");
  });
});

describe("safeUrl", () => {
  it("allows http/https/mailto", () => {
    expect(safeUrl("https://x.com")).toBe("https://x.com/");
    expect(safeUrl("http://x.com")).toBe("http://x.com/");
    expect(safeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("rejects javascript: and data: URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>")).toBe("#");
  });

  it("rejects malformed URLs", () => {
    expect(safeUrl("not a url")).toBe("#");
  });
});

describe("safeFilename", () => {
  it("rejects path separators", () => {
    expect(() => safeFilename("../etc/passwd")).toThrow();
    expect(() => safeFilename("a/b")).toThrow();
    expect(() => safeFilename("a\\b")).toThrow();
  });

  it("escapes quotes for attribute value", () => {
    expect(safeFilename(`a"b.txt`)).toBe("a&quot;b.txt");
  });
});
