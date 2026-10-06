import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/sources/local/frontmatter";

describe("parseFrontmatter", () => {
  it("returns empty data and original body when no leading ---", () => {
    const r = parseFrontmatter("# heading\n\nbody");
    expect(r.data).toEqual({});
    expect(r.body).toBe("# heading\n\nbody");
  });

  it("extracts simple key/value pairs", () => {
    const r = parseFrontmatter(
      "---\ntitle: Hello World\nsourceUrl: https://x/y\n---\n# Heading\nbody",
    );
    expect(r.data).toEqual({
      title: "Hello World",
      sourceUrl: "https://x/y",
    });
    expect(r.body).toBe("# Heading\nbody");
  });

  it("strips matching single or double quotes", () => {
    const r = parseFrontmatter(
      "---\ntitle: \"Quoted title\"\ntag: 'plain'\n---\n",
    );
    expect(r.data.title).toBe("Quoted title");
    expect(r.data.tag).toBe("plain");
  });

  it("skips blank and comment lines", () => {
    const r = parseFrontmatter(
      "---\n# a comment\n\ntitle: T\n---\nbody\n",
    );
    expect(r.data).toEqual({ title: "T" });
  });

  it("treats malformed frontmatter (no closing ---) as no frontmatter", () => {
    const input = "---\ntitle: lonely\nbody continues";
    const r = parseFrontmatter(input);
    expect(r.data).toEqual({});
    expect(r.body).toBe(input);
  });

  it("handles CRLF line endings", () => {
    const r = parseFrontmatter("---\r\ntitle: Win\r\n---\r\nbody");
    expect(r.data).toEqual({ title: "Win" });
    expect(r.body).toBe("body");
  });
});
