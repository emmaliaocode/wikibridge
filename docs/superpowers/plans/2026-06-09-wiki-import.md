# WikiBridge Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Import direction to WikiBridge: publish a local Markdown file, a local folder (one .md + optional `images/`/`attachments/`), or a single Notion page as a new Confluence Cloud page under a chosen space and optional parent.

**Architecture:** Three new adapters plug into the existing `Source` / `Destination` interfaces — `LocalSource` (file + folder), `NotionSource`, `ConfluenceDestination`. The `Page` IR gets one additive change (`Inline.attachmentRef`). The orchestrator becomes direction-agnostic (export + import share the same `source → IR → destination` pipeline). The side panel gains a mode switch (Export | Import) at the top.

**Tech Stack:** WXT, React 18, TypeScript (strict), Vitest, MSW. New deps: `gray-matter`, `remark`, `remark-parse`, `remark-gfm`. Package manager: `pnpm`.

**Spec:** `docs/superpowers/specs/2026-06-08-wiki-import-design.md`

**Prerequisite:** Tasks 1–26 of `docs/superpowers/plans/2026-05-21-wikibridge.md` (export plan) must be completed. This plan continues with Task 27 onwards and builds on the IR, Source/Destination interfaces, orchestrator, messaging protocol, side panel shell, and Confluence read client already in place.

---

## File Structure (delta)

```
wikibridge/
├── package.json                                # MODIFIED: add gray-matter, remark, remark-parse, remark-gfm
├── src/
│   ├── ir/
│   │   └── types.ts                            # MODIFIED: add Inline.attachmentRef
│   ├── messaging/
│   │   └── protocol.ts                         # MODIFIED: add Import* request/response shapes
│   ├── orchestrator/
│   │   └── orchestrator.ts                     # MODIFIED: accept Source+Destination by id
│   ├── sources/
│   │   ├── registry.ts                         # NEW: source factory by id
│   │   ├── local/                              # NEW
│   │   │   ├── local-source.ts                 # Source impl; dispatches file vs folder
│   │   │   ├── mdast-to-ir.ts                  # mdast → IR Block / Inline
│   │   │   ├── filesystem-read.ts              # FileSystemHandle helpers; mime lookup
│   │   │   └── asset-lookup.ts                 # relative path → assetId resolver
│   │   └── notion/                             # NEW
│   │       ├── notion-source.ts                # Source impl
│   │       ├── notion-read-api.ts              # GET /v1/pages/{id}, /v1/blocks/{id}/children
│   │       └── notion-blocks-to-ir.ts          # block tree → IR Block / Inline
│   └── destinations/
│       ├── registry.ts                         # MODIFIED: register "confluence"
│       └── confluence/                         # NEW
│           ├── confluence-destination.ts       # Destination impl
│           ├── confluence-write-api.ts         # POST page, attachment upload, PUT body, list spaces/pages
│           ├── ir-to-storage.ts                # IR → Confluence storage XHTML
│           └── escape.ts                       # text / attr / URL / CDATA safety
├── entrypoints/
│   └── sidepanel/
│       ├── App.tsx                             # MODIFIED: mode switch + ImportForm wiring
│       └── ImportForm.tsx                      # NEW: Local/Notion source picker + space/parent picker
└── tests/
    ├── escape.test.ts                          # NEW
    ├── ir-to-storage.test.ts                   # NEW
    ├── confluence-destination.test.ts          # NEW (MSW)
    ├── mdast-to-ir.test.ts                     # NEW
    ├── local-source.test.ts                    # NEW (in-memory FileSystem*Handle polyfill)
    ├── notion-blocks-to-ir.test.ts             # NEW
    ├── notion-source.test.ts                   # NEW (MSW)
    ├── orchestrator-import.test.ts             # NEW
    └── helpers/
        └── fake-filesystem.ts                  # NEW: in-memory FileSystemFileHandle / DirectoryHandle
```

---

## Conventions

- All commands run from repo root unless noted.
- Package manager: **pnpm**. Node ≥ 20.
- TDD: failing test first, then implementation, run, commit. Skip the test step only for type-only or trivial registry edits where there's no behaviour to test (the plan calls those out explicitly).
- `@/` alias for `src/` (already wired in the export plan's Task 1).
- Commit messages: Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`). No Claude Code attribution.

---

## Task 27: Install Markdown parsing dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
cd /Users/emma_liao/Documents/playground/wikibridge
pnpm add gray-matter remark remark-parse remark-gfm
```

- [ ] **Step 2: Install dev type deps**

```bash
pnpm add -D @types/mdast unified
```

`unified` is a transitive of `remark` but we import its types directly in `mdast-to-ir.ts`; pinning it explicitly avoids version drift.

- [ ] **Step 3: Verify install**

```bash
pnpm list gray-matter remark remark-parse remark-gfm @types/mdast
```

Expected: all five listed with versions.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add markdown parsing deps for local source"
```

---

## Task 28: Extend IR with inline `attachmentRef`

**Files:**
- Modify: `src/ir/types.ts`
- Modify: `tests/ir-types.test.ts`

Why: `[label](attachments/foo.txt)` inside a paragraph needs to round-trip to Confluence's `<ac:link><ri:attachment/></ac:link>` which can appear in inline context. Existing destinations that don't know about it will warn-and-degrade.

- [ ] **Step 1: Extend the failing test**

Open `tests/ir-types.test.ts` and add this case after the existing `Inline link` test:

```ts
it("Inline attachmentRef carries assetId and nested inlines", () => {
  const inline: Inline = {
    type: "attachmentRef",
    assetId: "attachments/foo.txt",
    inlines: [{ type: "text", text: "see log" }],
  };
  expect(inline.assetId).toBe("attachments/foo.txt");
});
```

- [ ] **Step 2: Run, expect a type error**

```bash
pnpm test tests/ir-types.test.ts
```

Expected: FAIL — `attachmentRef` not in `Inline` union.

- [ ] **Step 3: Add the variant**

In `src/ir/types.ts`, change the `Inline` union to:

```ts
export type Inline =
  | { type: "text"; text: string; marks?: Mark[] }
  | { type: "link"; href: string; inlines: Inline[] }
  | { type: "attachmentRef"; assetId: string; inlines: Inline[] };
```

- [ ] **Step 4: Run tests; fix exhaustive switches if any break**

```bash
pnpm test
```

Expected: any existing renderer (ir-to-markdown, ir-to-notion) that uses an exhaustive switch on `inline.type` will now have a TS error or runtime fall-through. Patch each:

- `src/destinations/local/ir-to-markdown.ts` — in the inline switch, add:
  ```ts
  case "attachmentRef":
    // Markdown destination: render as a relative link (round-trips with LocalSource)
    return `[${renderInlines(inline.inlines)}](${inline.assetId})`;
  ```
- `src/destinations/notion/ir-to-notion.ts` — in the inline rich-text builder, add:
  ```ts
  case "attachmentRef":
    // Notion has no inline attachment; render as plain text fallback
    return inline.inlines.flatMap(toNotionRichText);
  ```

Re-run `pnpm test` until green.

- [ ] **Step 5: Commit**

```bash
git add src/ir/types.ts src/destinations/local/ir-to-markdown.ts src/destinations/notion/ir-to-notion.ts tests/ir-types.test.ts
git commit -m "feat(ir): add Inline.attachmentRef for inline attachment links"
```

---

## Task 29: Source registry

**Files:**
- Create: `src/sources/registry.ts`

The orchestrator needs to look up sources by string id (the import request carries `sourceId: "local-file" | "local-folder" | "notion"`). The Confluence source registers itself the same way.

- [ ] **Step 1: Write the failing test**

Create `tests/source-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSource, registerSource } from "@/sources/registry";
import type { Source } from "@/sources/source";

class FakeSource implements Source {
  readonly id = "fake";
  async fetchPage() {
    return {
      id: "x",
      title: "x",
      sourceUrl: "x",
      capturedAt: "x",
      blocks: [],
      assets: [],
    };
  }
}

describe("source registry", () => {
  it("registers and retrieves a source by id", () => {
    registerSource("fake", () => new FakeSource());
    const s = getSource("fake");
    expect(s.id).toBe("fake");
  });

  it("throws for unknown id", () => {
    expect(() => getSource("nope")).toThrow(/unknown source/i);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/source-registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Create `src/sources/registry.ts`:

```ts
import type { Source } from "./source";

type SourceFactory = () => Source;

const factories = new Map<string, SourceFactory>();

export function registerSource(id: string, factory: SourceFactory): void {
  factories.set(id, factory);
}

export function getSource(id: string): Source {
  const factory = factories.get(id);
  if (!factory) throw new Error(`unknown source: ${id}`);
  return factory();
}

export function listSources(): string[] {
  return [...factories.keys()];
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/source-registry.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/registry.ts tests/source-registry.test.ts
git commit -m "feat(sources): add string-id source registry"
```

---

## Task 30: Confluence storage escape helpers

**Files:**
- Create: `src/destinations/confluence/escape.ts`
- Create: `tests/escape.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/escape.test.ts`:

```ts
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
    expect(escapeAttr(`a"bc`)).toBe("a&quot;bc");
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
    expect(safeUrl("https://x.com")).toBe("https://x.com");
    expect(safeUrl("http://x.com")).toBe("http://x.com");
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
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/escape.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/destinations/confluence/escape.ts`:

```ts
export function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function escapeAttr(s: string): string {
  // Strip C0 control chars (except tab/newline/cr), then escape entities
  const cleaned = s.replace(/[ --]/g, "");
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
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/escape.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/confluence/escape.ts tests/escape.test.ts
git commit -m "feat(confluence): add storage-format escape helpers"
```

---

## Task 31: IR → Confluence storage XHTML (block layer)

**Files:**
- Create: `src/destinations/confluence/ir-to-storage.ts`
- Create: `tests/ir-to-storage.test.ts`

Renders IR blocks to a Confluence storage XHTML string. Assets are resolved through an injected `assetResolver` because the resolver depends on whether the upload succeeded (set up in Task 35).

- [ ] **Step 1: Write the failing test (paragraphs, marks, headings, links)**

Create `tests/ir-to-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Block } from "@/ir/types";
import { irToStorage } from "@/destinations/confluence/ir-to-storage";

const resolver = (assetId: string) => `${assetId}.png`;

function render(blocks: Block[]): string {
  return irToStorage(blocks, { assetResolver: resolver });
}

describe("irToStorage — inline & headings", () => {
  it("renders a paragraph with bold and italic", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "hello " },
          { type: "text", text: "world", marks: ["bold", "italic"] },
        ],
      },
    ]);
    expect(out).toBe("<p>hello <em><strong>world</strong></em></p>");
  });

  it("renders headings h1..h6", () => {
    const blocks: Block[] = [1, 2, 3, 4, 5, 6].map((level) => ({
      type: "heading",
      level: level as 1 | 2 | 3 | 4 | 5 | 6,
      inlines: [{ type: "text", text: `H${level}` }],
    }));
    const out = render(blocks);
    expect(out).toBe(
      "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>",
    );
  });

  it("renders inline link with escaping", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "https://x.com/a?b=1&c=<>",
            inlines: [{ type: "text", text: "link & co" }],
          },
        ],
      },
    ]);
    expect(out).toContain(`<a href="https://x.com/a?b=1&amp;c=%3C%3E">`);
    expect(out).toContain("link &amp; co");
  });

  it("drops dangerous URLs to #", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "javascript:alert(1)",
            inlines: [{ type: "text", text: "x" }],
          },
        ],
      },
    ]);
    expect(out).toContain(`<a href="#">`);
  });

  it("escapes text content", () => {
    const out = render([
      { type: "paragraph", inlines: [{ type: "text", text: "<script>" }] },
    ]);
    expect(out).toBe("<p>&lt;script&gt;</p>");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/ir-to-storage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the inline + heading path**

Create `src/destinations/confluence/ir-to-storage.ts`:

```ts
import type { Block, Inline, Mark } from "@/ir/types";
import { escapeText, safeUrl, safeFilename } from "./escape";

export type AssetResolver = (assetId: string) => string | null; // returns uploaded filename or null

export type RenderOptions = {
  assetResolver: AssetResolver;
};

const MARK_TAGS: Record<Mark, [string, string]> = {
  bold: ["<strong>", "</strong>"],
  italic: ["<em>", "</em>"],
  underline: ["<u>", "</u>"],
  strike: ["<s>", "</s>"],
  code: ["<code>", "</code>"],
};

const MARK_ORDER: Mark[] = ["bold", "italic", "underline", "strike", "code"];

function renderInline(inline: Inline, opts: RenderOptions): string {
  switch (inline.type) {
    case "text": {
      let out = escapeText(inline.text);
      // Wrap inside-out so outermost mark is last in the array
      const marks = inline.marks ?? [];
      for (const m of MARK_ORDER) {
        if (marks.includes(m)) {
          const [open, close] = MARK_TAGS[m];
          out = `${open}${out}${close}`;
        }
      }
      return out;
    }
    case "link": {
      const href = safeUrl(inline.href);
      const body = inline.inlines.map((i) => renderInline(i, opts)).join("");
      return `<a href="${href}">${body}</a>`;
    }
    case "attachmentRef": {
      const filename = opts.assetResolver(inline.assetId);
      const body = inline.inlines.map((i) => renderInline(i, opts)).join("");
      if (!filename) return body; // failed upload: degrade to plain inlines
      return `<ac:link><ri:attachment ri:filename="${safeFilename(filename)}"/><ac:link-body>${body}</ac:link-body></ac:link>`;
    }
  }
}

function renderInlines(inlines: Inline[], opts: RenderOptions): string {
  return inlines.map((i) => renderInline(i, opts)).join("");
}

function renderBlock(block: Block, opts: RenderOptions): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${renderInlines(block.inlines, opts)}</h${block.level}>`;
    case "paragraph":
      return `<p>${renderInlines(block.inlines, opts)}</p>`;
    default:
      // Subsequent tasks fill in the rest
      return "";
  }
}

export function irToStorage(blocks: Block[], opts: RenderOptions): string {
  return blocks.map((b) => renderBlock(b, opts)).join("");
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/ir-to-storage.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/confluence/ir-to-storage.ts tests/ir-to-storage.test.ts
git commit -m "feat(confluence): render headings, paragraphs, inline marks/links to storage XHTML"
```

---

## Task 32: IR → storage — lists, code blocks, quotes, dividers

**Files:**
- Modify: `src/destinations/confluence/ir-to-storage.ts`
- Modify: `tests/ir-to-storage.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `tests/ir-to-storage.test.ts`:

```ts
describe("irToStorage — blocks", () => {
  it("renders unordered nested list", () => {
    const out = render([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
          [
            { type: "paragraph", inlines: [{ type: "text", text: "b" }] },
            {
              type: "list",
              ordered: false,
              items: [
                [{ type: "paragraph", inlines: [{ type: "text", text: "b1" }] }],
              ],
            },
          ],
        ],
      },
    ]);
    expect(out).toBe(
      "<ul><li><p>a</p></li><li><p>b</p><ul><li><p>b1</p></li></ul></li></ul>",
    );
  });

  it("renders ordered list", () => {
    const out = render([
      {
        type: "list",
        ordered: true,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "1" }] }],
        ],
      },
    ]);
    expect(out).toBe("<ol><li><p>1</p></li></ol>");
  });

  it("renders code block with language and CDATA escape", () => {
    const out = render([
      { type: "code", language: "ts", text: "const x = `]]>`;" },
    ]);
    expect(out).toBe(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[const x = `]]]]><![CDATA[>`;]]></ac:plain-text-body></ac:structured-macro>',
    );
  });

  it("renders code block without language", () => {
    const out = render([{ type: "code", text: "x" }]);
    expect(out).toContain(
      '<ac:parameter ac:name="language">none</ac:parameter>',
    );
  });

  it("renders blockquote", () => {
    const out = render([
      {
        type: "quote",
        blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "q" }] }],
      },
    ]);
    expect(out).toBe("<blockquote><p>q</p></blockquote>");
  });

  it("renders divider", () => {
    expect(render([{ type: "divider" }])).toBe("<hr/>");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/ir-to-storage.test.ts
```

Expected: new cases FAIL.

- [ ] **Step 3: Extend the renderer**

In `src/destinations/confluence/ir-to-storage.ts`, replace the `renderBlock` switch with:

```ts
function renderBlock(block: Block, opts: RenderOptions): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${renderInlines(block.inlines, opts)}</h${block.level}>`;
    case "paragraph":
      return `<p>${renderInlines(block.inlines, opts)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map(
          (itemBlocks) =>
            `<li>${itemBlocks.map((b) => renderBlock(b, opts)).join("")}</li>`,
        )
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "code": {
      const lang = escapeText(block.language ?? "none");
      const body = `<![CDATA[${(function () {
        // Inline import to avoid breaking the module structure
        return require("./escape").escapeCdata(block.text);
      })()}]]>`;
      return (
        `<ac:structured-macro ac:name="code">` +
        `<ac:parameter ac:name="language">${lang}</ac:parameter>` +
        `<ac:plain-text-body>${body}</ac:plain-text-body>` +
        `</ac:structured-macro>`
      );
    }
    case "quote":
      return `<blockquote>${block.blocks.map((b) => renderBlock(b, opts)).join("")}</blockquote>`;
    case "divider":
      return "<hr/>";
    default:
      return "";
  }
}
```

Then at the top of the file, replace the inline `require` with a proper import. Change the imports line to:

```ts
import { escapeText, escapeCdata, safeUrl, safeFilename } from "./escape";
```

…and rewrite the `code` case to:

```ts
case "code": {
  const lang = escapeText(block.language ?? "none");
  const body = `<![CDATA[${escapeCdata(block.text)}]]>`;
  return (
    `<ac:structured-macro ac:name="code">` +
    `<ac:parameter ac:name="language">${lang}</ac:parameter>` +
    `<ac:plain-text-body>${body}</ac:plain-text-body>` +
    `</ac:structured-macro>`
  );
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/ir-to-storage.test.ts
```

Expected: all tests in this file pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/confluence/ir-to-storage.ts tests/ir-to-storage.test.ts
git commit -m "feat(confluence): render lists, code blocks, quotes, dividers"
```

---

## Task 33: IR → storage — callouts and tables

**Files:**
- Modify: `src/destinations/confluence/ir-to-storage.ts`
- Modify: `tests/ir-to-storage.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `tests/ir-to-storage.test.ts`:

```ts
describe("irToStorage — callouts & tables", () => {
  it.each([
    ["info", "info"],
    ["note", "note"],
    ["warning", "warning"],
    ["success", "tip"],
  ] as const)("renders %s callout as %s macro", (variant, macroName) => {
    const out = render([
      {
        type: "callout",
        variant,
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "x" }] },
        ],
      },
    ]);
    expect(out).toBe(
      `<ac:structured-macro ac:name="${macroName}"><ac:rich-text-body><p>x</p></ac:rich-text-body></ac:structured-macro>`,
    );
  });

  it("renders a 2x2 table", () => {
    const out = render([
      {
        type: "table",
        rows: [
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
          ],
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "c" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "d" }] }],
          ],
        ],
      },
    ]);
    expect(out).toBe(
      "<table><tbody>" +
        "<tr><td><p>a</p></td><td><p>b</p></td></tr>" +
        "<tr><td><p>c</p></td><td><p>d</p></td></tr>" +
        "</tbody></table>",
    );
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/ir-to-storage.test.ts
```

- [ ] **Step 3: Extend the renderer**

Add the `callout` and `table` cases to the `renderBlock` switch in `src/destinations/confluence/ir-to-storage.ts`:

```ts
case "callout": {
  const macro = block.variant === "success" ? "tip" : block.variant;
  const inner = block.blocks.map((b) => renderBlock(b, opts)).join("");
  return `<ac:structured-macro ac:name="${macro}"><ac:rich-text-body>${inner}</ac:rich-text-body></ac:structured-macro>`;
}
case "table": {
  const rows = block.rows
    .map((row) => {
      const cells = row
        .map(
          (cellBlocks) =>
            `<td>${cellBlocks.map((b) => renderBlock(b, opts)).join("")}</td>`,
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table><tbody>${rows}</tbody></table>`;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/ir-to-storage.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/destinations/confluence/ir-to-storage.ts tests/ir-to-storage.test.ts
git commit -m "feat(confluence): render callouts and tables"
```

---

## Task 34: IR → storage — images and attachments (asset resolution)

**Files:**
- Modify: `src/destinations/confluence/ir-to-storage.ts`
- Modify: `tests/ir-to-storage.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `tests/ir-to-storage.test.ts`:

```ts
describe("irToStorage — assets", () => {
  it("renders image asset by resolved filename", () => {
    const out = irToStorage(
      [{ type: "image", assetId: "media-A", alt: "shot" }],
      { assetResolver: () => "screenshot.png" },
    );
    expect(out).toBe(
      `<ac:image ac:alt="shot"><ri:attachment ri:filename="screenshot.png"/></ac:image>`,
    );
  });

  it("renders external image when resolver returns null", () => {
    const out = irToStorage(
      [
        {
          type: "image",
          assetId: "ext:https://example.com/x.png",
          alt: "x",
        },
      ],
      { assetResolver: () => null },
    );
    // External image carries the URL in the assetId after "ext:" prefix
    expect(out).toBe(
      `<ac:image ac:alt="x"><ri:url ri:value="https://example.com/x.png"/></ac:image>`,
    );
  });

  it("renders image placeholder when resolver returns null and no URL prefix", () => {
    const out = irToStorage(
      [{ type: "image", assetId: "media-B", alt: "missing" }],
      { assetResolver: () => null },
    );
    expect(out).toBe(
      "<p><em>[Failed to upload image: missing]</em></p>",
    );
  });

  it("renders attachment block with label", () => {
    const out = irToStorage(
      [{ type: "attachment", assetId: "attachments/log.txt", filename: "log.txt" }],
      { assetResolver: () => "log.txt" },
    );
    expect(out).toBe(
      `<p><ac:link><ri:attachment ri:filename="log.txt"/><ac:plain-text-link-body><![CDATA[log.txt]]></ac:plain-text-link-body></ac:link></p>`,
    );
  });

  it("renders attachment placeholder on failed upload", () => {
    const out = irToStorage(
      [{ type: "attachment", assetId: "x", filename: "log.txt" }],
      { assetResolver: () => null },
    );
    expect(out).toBe("<p><em>[Failed to upload attachment: log.txt]</em></p>");
  });

  it("renders inline attachmentRef", () => {
    const out = irToStorage(
      [
        {
          type: "paragraph",
          inlines: [
            {
              type: "attachmentRef",
              assetId: "attachments/log.txt",
              inlines: [{ type: "text", text: "see log" }],
            },
          ],
        },
      ],
      { assetResolver: () => "log.txt" },
    );
    expect(out).toBe(
      `<p><ac:link><ri:attachment ri:filename="log.txt"/><ac:link-body>see log</ac:link-body></ac:link></p>`,
    );
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/ir-to-storage.test.ts
```

- [ ] **Step 3: Extend the renderer with image + attachment cases**

Add to `renderBlock`:

```ts
case "image": {
  const resolved = opts.assetResolver(block.assetId);
  const alt = escapeAttr(block.alt ?? "");
  if (resolved) {
    return `<ac:image ac:alt="${alt}"><ri:attachment ri:filename="${safeFilename(resolved)}"/></ac:image>`;
  }
  if (block.assetId.startsWith("ext:")) {
    const url = safeUrl(block.assetId.slice(4));
    return `<ac:image ac:alt="${alt}"><ri:url ri:value="${url}"/></ac:image>`;
  }
  return `<p><em>[Failed to upload image: ${escapeText(block.alt ?? block.assetId)}]</em></p>`;
}
case "attachment": {
  const resolved = opts.assetResolver(block.assetId);
  if (!resolved) {
    return `<p><em>[Failed to upload attachment: ${escapeText(block.filename)}]</em></p>`;
  }
  const fname = safeFilename(resolved);
  return `<p><ac:link><ri:attachment ri:filename="${fname}"/><ac:plain-text-link-body><![CDATA[${escapeCdata(block.filename)}]]></ac:plain-text-link-body></ac:link></p>`;
}
```

Also update the imports at the top of the file:

```ts
import { escapeText, escapeAttr, escapeCdata, safeUrl, safeFilename } from "./escape";
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/ir-to-storage.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/destinations/confluence/ir-to-storage.ts tests/ir-to-storage.test.ts
git commit -m "feat(confluence): render image/attachment blocks and inline attachmentRef"
```

---

## Task 35: Confluence write API client

**Files:**
- Create: `src/destinations/confluence/confluence-write-api.ts`
- Create: `tests/confluence-write-api.test.ts`

Thin REST client wrapping the four endpoints we need:
- `POST /wiki/api/v2/pages` (create empty page)
- `PUT /wiki/api/v2/pages/{id}` (set body)
- `POST /wiki/rest/api/content/{id}/child/attachment` (upload attachment, v1 REST)
- `GET /wiki/api/v2/spaces` (list spaces)
- `GET /wiki/api/v2/pages?space-id=…` (list root pages)

- [ ] **Step 1: Write the failing test**

Create `tests/confluence-write-api.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ConfluenceWriteApi } from "@/destinations/confluence/confluence-write-api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const api = new ConfluenceWriteApi({
  siteUrl: "https://x.atlassian.net",
  email: "u@x.com",
  apiToken: "T",
});

describe("ConfluenceWriteApi.listSpaces", () => {
  it("returns id+key+name for each space", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/spaces", () =>
        HttpResponse.json({
          results: [
            { id: "100", key: "ENG", name: "Engineering" },
            { id: "200", key: "DOC", name: "Docs" },
          ],
        }),
      ),
    );
    const spaces = await api.listSpaces();
    expect(spaces).toEqual([
      { id: "100", key: "ENG", name: "Engineering" },
      { id: "200", key: "DOC", name: "Docs" },
    ]);
  });
});

describe("ConfluenceWriteApi.listRootPages", () => {
  it("filters to top-level pages of the given space", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/pages", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("space-id")).toBe("100");
        return HttpResponse.json({
          results: [
            { id: "1", title: "Home", parentId: null },
            { id: "2", title: "Child", parentId: "1" },
          ],
        });
      }),
    );
    const pages = await api.listRootPages("100");
    expect(pages).toEqual([{ id: "1", title: "Home" }]);
  });
});

describe("ConfluenceWriteApi.createPage", () => {
  it("POSTs an empty page and returns id + webui link", async () => {
    server.use(
      http.post(
        "https://x.atlassian.net/wiki/api/v2/pages",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.spaceId).toBe("100");
          expect(body.title).toBe("My Page");
          expect(body.parentId).toBe("42");
          return HttpResponse.json({
            id: "999",
            _links: { webui: "/spaces/ENG/pages/999/My+Page" },
          });
        },
      ),
    );
    const r = await api.createPage({
      spaceId: "100",
      title: "My Page",
      parentPageId: "42",
    });
    expect(r).toEqual({
      id: "999",
      webuiUrl: "https://x.atlassian.net/wiki/spaces/ENG/pages/999/My+Page",
    });
  });
});

describe("ConfluenceWriteApi.uploadAttachment", () => {
  it("POSTs multipart and returns the resulting filename", async () => {
    server.use(
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        async ({ request }) => {
          expect(request.headers.get("x-atlassian-token")).toBe("no-check");
          return HttpResponse.json({
            results: [{ title: "pic.png" }],
          });
        },
      ),
    );
    const filename = await api.uploadAttachment("999", {
      filename: "pic.png",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(filename).toBe("pic.png");
  });
});

describe("ConfluenceWriteApi.updatePageBody", () => {
  it("PUTs the storage body with version 2", async () => {
    server.use(
      http.put(
        "https://x.atlassian.net/wiki/api/v2/pages/999",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body).toMatchObject({
            id: "999",
            status: "current",
            title: "My Page",
            version: { number: 2 },
            body: { representation: "storage", value: "<p>hi</p>" },
          });
          return HttpResponse.json({ id: "999" });
        },
      ),
    );
    await api.updatePageBody("999", "My Page", "<p>hi</p>");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/confluence-write-api.test.ts
```

- [ ] **Step 3: Implement**

Create `src/destinations/confluence/confluence-write-api.ts`:

```ts
export type ConfluenceCreds = {
  siteUrl: string;       // https://x.atlassian.net (no trailing slash)
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
    // btoa is available in service workers and browser contexts
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
    const r = await this.jsonRequest("GET", "/wiki/api/v2/spaces?limit=250");
    return (r.results ?? []).map((s: any) => ({
      id: String(s.id),
      key: s.key,
      name: s.name,
    }));
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
    const blob = new Blob([input.bytes], { type: input.mimeType });
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
    // Confluence returns { results: [{ title: "actual-filename" }] }
    const title = json?.results?.[0]?.title;
    if (typeof title !== "string") {
      throw new Error(
        `upload ${input.filename}: unexpected response shape`,
      );
    }
    return title;
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/confluence-write-api.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/confluence/confluence-write-api.ts tests/confluence-write-api.test.ts
git commit -m "feat(confluence): write-side REST client (create/PUT/upload/list)"
```

---

## Task 36: ConfluenceDestination

**Files:**
- Create: `src/destinations/confluence/confluence-destination.ts`
- Create: `tests/confluence-destination.test.ts`
- Modify: `src/destinations/registry.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/confluence-destination.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { Page } from "@/ir/types";
import { ConfluenceDestination } from "@/destinations/confluence/confluence-destination";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const creds = {
  siteUrl: "https://x.atlassian.net",
  email: "u@x.com",
  apiToken: "T",
};

const samplePage: Page = {
  id: "src",
  title: "Imported Page",
  sourceUrl: "file:///local",
  capturedAt: "2026-06-09T00:00:00Z",
  blocks: [
    { type: "heading", level: 1, inlines: [{ type: "text", text: "Hello" }] },
    { type: "image", assetId: "img-1", alt: "shot" },
    { type: "attachment", assetId: "att-1", filename: "log.txt" },
  ],
  assets: [
    {
      id: "img-1",
      filename: "shot.png",
      mimeType: "image/png",
      fetch: async () => new Uint8Array([1, 2, 3]),
    },
    {
      id: "att-1",
      filename: "log.txt",
      mimeType: "text/plain",
      fetch: async () => new Uint8Array([9]),
    },
  ],
};

describe("ConfluenceDestination.publish", () => {
  it("creates page, uploads assets, PUTs body, returns webui URL", async () => {
    const requests: string[] = [];
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", async () => {
        requests.push("create");
        return HttpResponse.json({
          id: "999",
          _links: { webui: "/spaces/ENG/pages/999/Imported+Page" },
        });
      }),
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        async ({ request }) => {
          requests.push("upload");
          const form = await request.formData();
          const file = form.get("file") as File;
          return HttpResponse.json({ results: [{ title: file.name }] });
        },
      ),
      http.put(
        "https://x.atlassian.net/wiki/api/v2/pages/999",
        async ({ request }) => {
          const body = (await request.json()) as any;
          requests.push("put");
          expect(body.body.value).toContain("<h1>Hello</h1>");
          expect(body.body.value).toContain(
            'ri:filename="shot.png"',
          );
          expect(body.body.value).toContain(
            'ri:filename="log.txt"',
          );
          return HttpResponse.json({ id: "999" });
        },
      ),
    );

    const dest = new ConfluenceDestination(creds, {
      spaceId: "100",
      parentPageId: "42",
    });
    const progress: string[] = [];
    const r = await dest.publish(samplePage, {
      onProgress: (m) => progress.push(m),
    });

    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.destinationUrl).toBe(
      "https://x.atlassian.net/wiki/spaces/ENG/pages/999/Imported+Page",
    );
    expect(requests).toEqual(["create", "upload", "upload", "put"]);
    expect(progress.some((m) => /Creating page/i.test(m))).toBe(true);
    expect(progress.some((m) => /Uploading/i.test(m))).toBe(true);
  });

  it("collects per-asset failures and still PUTs body", async () => {
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", () =>
        HttpResponse.json({
          id: "999",
          _links: { webui: "/spaces/X/pages/999/x" },
        }),
      ),
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        () => HttpResponse.text("nope", { status: 500 }),
      ),
      http.put("https://x.atlassian.net/wiki/api/v2/pages/999", async () =>
        HttpResponse.json({ id: "999" }),
      ),
    );
    const dest = new ConfluenceDestination(creds, { spaceId: "100" });
    const r = await dest.publish(samplePage, { onProgress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0].assetId).toBe("img-1");
    expect(r.destinationUrl).toContain("/wiki/spaces/X/pages/999/x");
  });

  it("returns critical failure if page-create fails", async () => {
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", () =>
        HttpResponse.text("boom", { status: 500 }),
      ),
    );
    const dest = new ConfluenceDestination(creds, { spaceId: "100" });
    const r = await dest.publish(samplePage, { onProgress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.failures[0].reason).toMatch(/create page/i);
    expect(r.destinationUrl).toBeUndefined();
  });

  it("returns critical failure if PUT body fails (page already exists)", async () => {
    server.use(
      http.post("https://x.atlassian.net/wiki/api/v2/pages", () =>
        HttpResponse.json({
          id: "999",
          _links: { webui: "/spaces/X/pages/999/x" },
        }),
      ),
      http.post(
        "https://x.atlassian.net/wiki/rest/api/content/999/child/attachment",
        async ({ request }) => {
          const form = await request.formData();
          const file = form.get("file") as File;
          return HttpResponse.json({ results: [{ title: file.name }] });
        },
      ),
      http.put("https://x.atlassian.net/wiki/api/v2/pages/999", () =>
        HttpResponse.text("body too big", { status: 400 }),
      ),
    );
    const dest = new ConfluenceDestination(creds, { spaceId: "100" });
    const r = await dest.publish(samplePage, { onProgress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => /body upload failed/i.test(f.reason))).toBe(
      true,
    );
    expect(r.destinationUrl).toContain("/wiki/spaces/X/pages/999/x");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/confluence-destination.test.ts
```

- [ ] **Step 3: Implement the destination**

Create `src/destinations/confluence/confluence-destination.ts`:

```ts
import type { Page } from "@/ir/types";
import type {
  Destination,
  PublishContext,
  PublishResult,
  Failure,
} from "@/destinations/destination";
import {
  ConfluenceWriteApi,
  type ConfluenceCreds,
} from "./confluence-write-api";
import { irToStorage } from "./ir-to-storage";

export type ConfluenceDestinationParams = {
  spaceId: string;
  parentPageId?: string;
};

export class ConfluenceDestination implements Destination {
  readonly id = "confluence";
  readonly displayName = "Confluence";

  private api: ConfluenceWriteApi;

  constructor(
    private creds: ConfluenceCreds,
    private params: ConfluenceDestinationParams,
  ) {
    this.api = new ConfluenceWriteApi(creds);
  }

  async isConfigured(): Promise<boolean> {
    return Boolean(
      this.creds.siteUrl && this.creds.email && this.creds.apiToken,
    );
  }

  async publish(
    page: Page,
    ctx: PublishContext,
  ): Promise<PublishResult> {
    const failures: Failure[] = [];

    // 1. Create empty page
    ctx.onProgress(`Creating page "${page.title}"…`);
    let created: { id: string; webuiUrl: string };
    try {
      created = await this.api.createPage({
        spaceId: this.params.spaceId,
        parentPageId: this.params.parentPageId,
        title: page.title,
      });
    } catch (e: any) {
      return {
        ok: false,
        failures: [{ reason: `create page: ${e?.message ?? e}` }],
      };
    }

    // 2. Upload each asset sequentially; collect failures
    const assetMap = new Map<string, string | null>();
    for (let i = 0; i < page.assets.length; i++) {
      const asset = page.assets[i];
      ctx.onProgress(
        `Uploading ${asset.filename} (${i + 1}/${page.assets.length})…`,
      );
      try {
        const bytes =
          asset.bytes ?? (asset.fetch ? await asset.fetch() : null);
        if (!bytes) throw new Error("no bytes available");
        const uploadedName = await this.api.uploadAttachment(created.id, {
          filename: asset.filename,
          bytes,
          mimeType: asset.mimeType,
        });
        assetMap.set(asset.id, uploadedName);
      } catch (e: any) {
        assetMap.set(asset.id, null);
        failures.push({
          assetId: asset.id,
          reason: `upload ${asset.filename}: ${e?.message ?? e}`,
        });
      }
    }

    // 3. Render body
    ctx.onProgress("Rendering page body…");
    const xhtml = irToStorage(page.blocks, {
      assetResolver: (id) => assetMap.get(id) ?? null,
    });

    // 4. PUT body
    ctx.onProgress("Publishing…");
    try {
      await this.api.updatePageBody(created.id, page.title, xhtml);
    } catch (e: any) {
      failures.push({
        reason: `body upload failed; page created but empty: ${created.webuiUrl}`,
      });
      return {
        ok: false,
        failures,
        destinationUrl: created.webuiUrl,
      };
    }

    return {
      ok: failures.length === 0,
      failures,
      destinationUrl: created.webuiUrl,
    };
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/confluence-destination.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Register the destination**

Open `src/destinations/registry.ts` (created in the export plan). Append a registration block. Final structure:

```ts
// (existing imports for NotionDestination, LocalDestination registration left untouched)
import { ConfluenceDestination } from "./confluence/confluence-destination";
import type { ConfluenceCreds } from "./confluence/confluence-write-api";
import type { ConfluenceDestinationParams } from "./confluence/confluence-destination";

// existing factory map and helpers — append:
export function buildConfluenceDestination(
  creds: ConfluenceCreds,
  params: ConfluenceDestinationParams,
): ConfluenceDestination {
  return new ConfluenceDestination(creds, params);
}
```

We expose `buildConfluenceDestination` (rather than via the same `getDestination(id)` factory) because Confluence needs creds + per-run params; the orchestrator constructs it explicitly.

- [ ] **Step 6: Commit**

```bash
git add src/destinations/confluence/confluence-destination.ts src/destinations/registry.ts tests/confluence-destination.test.ts
git commit -m "feat(confluence): destination that creates page, uploads assets, sets body"
```

---

## Task 37: Markdown (mdast) → IR — paragraphs, marks, headings, links

**Files:**
- Create: `src/sources/local/mdast-to-ir.ts`
- Create: `tests/mdast-to-ir.test.ts`

The renderer is split across three tasks to keep diffs reviewable: this one covers the inline and heading path.

- [ ] **Step 1: Write the failing test**

Create `tests/mdast-to-ir.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { mdastToIr } from "@/sources/local/mdast-to-ir";

function parse(md: string) {
  const tree = remark().use(remarkGfm).parse(md);
  return mdastToIr(tree as any, { assetIds: new Set() });
}

describe("mdastToIr — inline & headings", () => {
  it("renders a paragraph with bold + italic + strike + inline code", () => {
    const { blocks, warnings } = parse(
      "**a** *b* ~~c~~ `d`",
    );
    expect(warnings).toEqual([]);
    expect(blocks).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "a", marks: ["bold"] },
          { type: "text", text: " " },
          { type: "text", text: "b", marks: ["italic"] },
          { type: "text", text: " " },
          { type: "text", text: "c", marks: ["strike"] },
          { type: "text", text: " " },
          { type: "text", text: "d", marks: ["code"] },
        ],
      },
    ]);
  });

  it("renders headings 1..6", () => {
    const { blocks } = parse(
      "# h1\n\n## h2\n\n### h3\n\n#### h4\n\n##### h5\n\n###### h6",
    );
    expect(blocks).toHaveLength(6);
    expect(blocks.map((b: any) => b.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("renders a link with safe http url", () => {
    const { blocks } = parse("[click](https://x.com)");
    expect((blocks[0] as any).inlines[0]).toEqual({
      type: "link",
      href: "https://x.com",
      inlines: [{ type: "text", text: "click" }],
    });
  });

  it("recognises <u>…</u> raw HTML as underline mark", () => {
    const { blocks } = parse("<u>under</u>");
    const inlines = (blocks[0] as any).inlines;
    // Implementations may wrap or interleave: assert the underline mark appears
    const hasUnderline = inlines.some((i: any) =>
      i.marks?.includes("underline"),
    );
    expect(hasUnderline).toBe(true);
  });

  it("warns and falls back to text for non-<u> raw HTML", () => {
    const { warnings, blocks } = parse("<div>nope</div>");
    expect(warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(blocks)).toContain("nope");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/mdast-to-ir.test.ts
```

- [ ] **Step 3: Implement the inline + heading path**

Create `src/sources/local/mdast-to-ir.ts`:

```ts
import type { Block, Inline, Mark } from "@/ir/types";

// Loose mdast types (use @types/mdast for stricter typing if desired)
type MNode = { type: string; value?: string; children?: MNode[]; [k: string]: any };

export type MdastToIrOptions = {
  assetIds: Set<string>; // for asset lookup in Tasks 38–39 (unused here)
};

export type MdastToIrResult = {
  blocks: Block[];
  warnings: string[];
};

export function mdastToIr(
  root: MNode,
  opts: MdastToIrOptions,
): MdastToIrResult {
  const warnings: string[] = [];
  const blocks = childrenToBlocks(root.children ?? [], opts, warnings);
  return { blocks, warnings };
}

function childrenToBlocks(
  nodes: MNode[],
  opts: MdastToIrOptions,
  warnings: string[],
): Block[] {
  const blocks: Block[] = [];
  for (const n of nodes) {
    const b = nodeToBlock(n, opts, warnings);
    if (Array.isArray(b)) blocks.push(...b);
    else if (b) blocks.push(b);
  }
  return blocks;
}

function nodeToBlock(
  n: MNode,
  opts: MdastToIrOptions,
  warnings: string[],
): Block | Block[] | null {
  switch (n.type) {
    case "heading": {
      const level = (Math.min(Math.max(Number(n.depth) || 1, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6);
      return {
        type: "heading",
        level,
        inlines: inlinesFromChildren(n.children ?? [], opts, warnings, []),
      };
    }
    case "paragraph":
      return {
        type: "paragraph",
        inlines: inlinesFromChildren(n.children ?? [], opts, warnings, []),
      };
    case "html": {
      // Recognise <u> opening/closing for underline mark via an in-paragraph pass instead.
      // At block level, fall back to text.
      warnings.push(`raw HTML block dropped to text: ${n.value ?? ""}`);
      return {
        type: "paragraph",
        inlines: [{ type: "text", text: String(n.value ?? "") }],
      };
    }
    default:
      // Subsequent tasks add cases; until then, descend into children if possible
      if (n.children) {
        return childrenToBlocks(n.children, opts, warnings);
      }
      return null;
  }
}

function inlinesFromChildren(
  nodes: MNode[],
  opts: MdastToIrOptions,
  warnings: string[],
  marks: Mark[],
): Inline[] {
  const out: Inline[] = [];
  let underlineActive = false;

  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push({
          type: "text",
          text: String(n.value ?? ""),
          ...(marks.length || underlineActive
            ? {
                marks: [
                  ...marks,
                  ...(underlineActive ? (["underline"] as Mark[]) : []),
                ],
              }
            : {}),
        });
        break;
      case "inlineCode":
        out.push({
          type: "text",
          text: String(n.value ?? ""),
          marks: [...marks, "code"],
        });
        break;
      case "strong":
        out.push(
          ...inlinesFromChildren(n.children ?? [], opts, warnings, [
            ...marks,
            "bold",
          ]),
        );
        break;
      case "emphasis":
        out.push(
          ...inlinesFromChildren(n.children ?? [], opts, warnings, [
            ...marks,
            "italic",
          ]),
        );
        break;
      case "delete":
        out.push(
          ...inlinesFromChildren(n.children ?? [], opts, warnings, [
            ...marks,
            "strike",
          ]),
        );
        break;
      case "link":
        out.push({
          type: "link",
          href: String(n.url ?? "#"),
          inlines: inlinesFromChildren(n.children ?? [], opts, warnings, marks),
        });
        break;
      case "html": {
        const v = String(n.value ?? "").trim().toLowerCase();
        if (v === "<u>") {
          underlineActive = true;
        } else if (v === "</u>") {
          underlineActive = false;
        } else {
          warnings.push(`raw inline HTML dropped to text: ${n.value ?? ""}`);
          out.push({ type: "text", text: String(n.value ?? "") });
        }
        break;
      }
      case "break":
        out.push({ type: "text", text: "\n" });
        break;
      default:
        // Unknown inline: render text representation if present
        if (typeof n.value === "string") {
          out.push({ type: "text", text: n.value });
        } else if (n.children) {
          out.push(
            ...inlinesFromChildren(n.children, opts, warnings, marks),
          );
        }
    }
  }
  return out;
}

// Exported for tests in later tasks
export const _internal = { inlinesFromChildren };
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/mdast-to-ir.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/local/mdast-to-ir.ts tests/mdast-to-ir.test.ts
git commit -m "feat(local): mdast → IR for paragraphs, marks, headings, links"
```

---

## Task 38: mdast → IR — lists, code, quotes, dividers, tables

**Files:**
- Modify: `src/sources/local/mdast-to-ir.ts`
- Modify: `tests/mdast-to-ir.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `tests/mdast-to-ir.test.ts`:

```ts
describe("mdastToIr — blocks", () => {
  it("renders unordered list", () => {
    const { blocks } = parse("- a\n- b");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
        ],
      },
    ]);
  });

  it("renders ordered list", () => {
    const { blocks } = parse("1. a\n2. b");
    expect((blocks[0] as any).ordered).toBe(true);
  });

  it("renders fenced code with language", () => {
    const { blocks } = parse("```ts\nconst x=1;\n```");
    expect(blocks[0]).toEqual({ type: "code", language: "ts", text: "const x=1;" });
  });

  it("renders fenced code without language", () => {
    const { blocks } = parse("```\nplain\n```");
    expect(blocks[0]).toEqual({ type: "code", text: "plain" });
  });

  it("renders blockquote", () => {
    const { blocks } = parse("> quoted");
    expect(blocks).toEqual([
      {
        type: "quote",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "quoted" }] },
        ],
      },
    ]);
  });

  it("renders thematic break", () => {
    const { blocks } = parse("---");
    expect(blocks).toEqual([{ type: "divider" }]);
  });

  it("renders GFM table", () => {
    const { blocks } = parse("| h1 | h2 |\n|---|---|\n| a | b |");
    expect(blocks).toEqual([
      {
        type: "table",
        rows: [
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "h1" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "h2" }] }],
          ],
          [
            [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
            [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
          ],
        ],
      },
    ]);
  });

  it("renders task list as text-prefixed list items", () => {
    const { blocks } = parse("- [x] done\n- [ ] todo");
    const items = (blocks[0] as any).items;
    const firstText = items[0][0].inlines.map((i: any) => i.text).join("");
    expect(firstText).toMatch(/^\[x\] done/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/mdast-to-ir.test.ts
```

- [ ] **Step 3: Extend `nodeToBlock`**

In `src/sources/local/mdast-to-ir.ts`, replace the `default` branch of `nodeToBlock` with these new cases and a smaller `default`:

```ts
case "list": {
  const items: Block[][] = (n.children ?? []).map((li: MNode) =>
    listItemToBlocks(li, opts, warnings),
  );
  return { type: "list", ordered: !!n.ordered, items };
}
case "code": {
  const block: Block = n.lang
    ? { type: "code", language: String(n.lang), text: String(n.value ?? "") }
    : { type: "code", text: String(n.value ?? "") };
  return block;
}
case "blockquote":
  return {
    type: "quote",
    blocks: childrenToBlocks(n.children ?? [], opts, warnings),
  };
case "thematicBreak":
  return { type: "divider" };
case "table": {
  const rows: Block[][][] = (n.children ?? []).map((row: MNode) =>
    (row.children ?? []).map((cell: MNode) => [
      {
        type: "paragraph",
        inlines: inlinesFromChildren(cell.children ?? [], opts, warnings, []),
      } as Block,
    ]),
  );
  return { type: "table", rows };
}
```

And add the helper at the bottom of the file:

```ts
function listItemToBlocks(
  li: MNode,
  opts: MdastToIrOptions,
  warnings: string[],
): Block[] {
  const checked = li.checked;
  const inner = childrenToBlocks(li.children ?? [], opts, warnings);
  if (typeof checked === "boolean" && inner[0]?.type === "paragraph") {
    const prefix = checked ? "[x] " : "[ ] ";
    inner[0] = {
      type: "paragraph",
      inlines: [{ type: "text", text: prefix }, ...inner[0].inlines],
    };
  }
  return inner;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/mdast-to-ir.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sources/local/mdast-to-ir.ts tests/mdast-to-ir.test.ts
git commit -m "feat(local): mdast → IR for lists, code, quotes, dividers, tables"
```

---

## Task 39: mdast → IR — images, attachment refs, asset lookup

**Files:**
- Modify: `src/sources/local/mdast-to-ir.ts`
- Modify: `tests/mdast-to-ir.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `tests/mdast-to-ir.test.ts`:

```ts
describe("mdastToIr — assets", () => {
  it("matches relative image to an asset id", () => {
    const tree = remark().use(remarkGfm).parse("![shot](images/foo.png)");
    const { blocks, warnings } = mdastToIr(tree as any, {
      assetIds: new Set(["images/foo.png"]),
    });
    expect(warnings).toEqual([]);
    // images appear as their own block; markdown wraps in a paragraph,
    // so the renderer hoists images to top-level
    expect(blocks).toEqual([
      { type: "image", assetId: "images/foo.png", alt: "shot" },
    ]);
  });

  it("strips ./ prefix on relative paths", () => {
    const tree = remark().use(remarkGfm).parse("![](./images/foo.png)");
    const { blocks } = mdastToIr(tree as any, {
      assetIds: new Set(["images/foo.png"]),
    });
    expect((blocks[0] as any).assetId).toBe("images/foo.png");
  });

  it("warns and degrades when image asset missing", () => {
    const tree = remark().use(remarkGfm).parse("![alt](images/missing.png)");
    const { blocks, warnings } = mdastToIr(tree as any, {
      assetIds: new Set(),
    });
    expect(warnings.length).toBe(1);
    // Falls back to a paragraph with alt text
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "alt" }] },
    ]);
  });

  it("treats external https image as ext: synthetic asset", () => {
    const tree = remark()
      .use(remarkGfm)
      .parse("![x](https://example.com/y.png)");
    const { blocks } = mdastToIr(tree as any, { assetIds: new Set() });
    expect(blocks).toEqual([
      {
        type: "image",
        assetId: "ext:https://example.com/y.png",
        alt: "x",
      },
    ]);
  });

  it("treats attachments/ relative link as inline attachmentRef", () => {
    const tree = remark()
      .use(remarkGfm)
      .parse("see [log](attachments/log.txt) here");
    const { blocks } = mdastToIr(tree as any, {
      assetIds: new Set(["attachments/log.txt"]),
    });
    const inlines = (blocks[0] as any).inlines;
    expect(inlines.some((i: any) => i.type === "attachmentRef")).toBe(true);
  });

  it("warns when attachments/ link asset is missing", () => {
    const tree = remark()
      .use(remarkGfm)
      .parse("[log](attachments/missing.txt)");
    const { warnings, blocks } = mdastToIr(tree as any, {
      assetIds: new Set(),
    });
    expect(warnings.length).toBe(1);
    const inlines = (blocks[0] as any).inlines;
    expect(inlines.every((i: any) => i.type === "text")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/mdast-to-ir.test.ts
```

- [ ] **Step 3: Implement asset lookup**

In `src/sources/local/mdast-to-ir.ts`:

1. Add a helper:

```ts
function normaliseRelative(href: string): string {
  return href.replace(/^\.\//, "");
}

function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}
```

2. Add the `image` case to `nodeToBlock`:

```ts
case "image": {
  const url = String(n.url ?? "");
  const alt = String(n.alt ?? "");
  if (isExternal(url)) {
    return { type: "image", assetId: `ext:${url}`, alt };
  }
  const key = normaliseRelative(url);
  if (opts.assetIds.has(key)) {
    return { type: "image", assetId: key, alt };
  }
  warnings.push(`missing image asset: ${url}`);
  return { type: "paragraph", inlines: [{ type: "text", text: alt }] };
}
```

3. The mdast paragraph wrapping behaviour: if a paragraph contains exactly one child that is an `image`, hoist the image out. In the `paragraph` case, replace it with:

```ts
case "paragraph": {
  const kids = n.children ?? [];
  if (kids.length === 1 && kids[0].type === "image") {
    return nodeToBlock(kids[0], opts, warnings);
  }
  return {
    type: "paragraph",
    inlines: inlinesFromChildren(kids, opts, warnings, []),
  };
}
```

4. Extend the `link` case inside `inlinesFromChildren` to detect attachment refs:

Replace the existing `case "link":` block with:

```ts
case "link": {
  const url = String(n.url ?? "#");
  if (!isExternal(url)) {
    const key = normaliseRelative(url);
    if (opts.assetIds.has(key)) {
      out.push({
        type: "attachmentRef",
        assetId: key,
        inlines: inlinesFromChildren(n.children ?? [], opts, warnings, marks),
      });
      break;
    }
    // Relative but unresolved → warn, degrade to inline text
    warnings.push(`missing attachment asset: ${url}`);
    out.push(
      ...inlinesFromChildren(n.children ?? [], opts, warnings, marks),
    );
    break;
  }
  out.push({
    type: "link",
    href: url,
    inlines: inlinesFromChildren(n.children ?? [], opts, warnings, marks),
  });
  break;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/mdast-to-ir.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sources/local/mdast-to-ir.ts tests/mdast-to-ir.test.ts
git commit -m "feat(local): mdast → IR asset lookup (image/attachmentRef)"
```

---

## Task 40: In-memory FileSystem* polyfill for tests

**Files:**
- Create: `tests/helpers/fake-filesystem.ts`

The browser FileSystem Access API isn't available in vitest's jsdom env. We need a small in-memory polyfill exposing the surface `LocalSource` consumes: `FileSystemDirectoryHandle` (with `kind`, `name`, async iterator over entries, `getFileHandle`, `getDirectoryHandle`) and `FileSystemFileHandle` (with `kind`, `name`, `getFile()` returning a `File`-like with `arrayBuffer()` and `text()`).

- [ ] **Step 1: Write the helper**

Create `tests/helpers/fake-filesystem.ts`:

```ts
export type FakeFile = {
  bytes: Uint8Array;
};

export type FakeTree = {
  [name: string]: FakeFile | FakeTree;
};

function isFile(x: FakeFile | FakeTree): x is FakeFile {
  return (x as FakeFile).bytes instanceof Uint8Array;
}

export class FakeFileHandle {
  readonly kind = "file" as const;
  constructor(
    readonly name: string,
    private data: Uint8Array,
  ) {}
  async getFile() {
    const bytes = this.data;
    return {
      name: this.name,
      size: bytes.byteLength,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async text() {
        return new TextDecoder().decode(bytes);
      },
    };
  }
}

export class FakeDirectoryHandle {
  readonly kind = "directory" as const;
  constructor(
    readonly name: string,
    private tree: FakeTree,
  ) {}

  async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    for (const [name, value] of Object.entries(this.tree)) {
      if (isFile(value)) yield [name, new FakeFileHandle(name, value.bytes)];
      else yield [name, new FakeDirectoryHandle(name, value)];
    }
  }

  async getFileHandle(name: string): Promise<FakeFileHandle> {
    const v = this.tree[name];
    if (!v || !isFile(v)) throw new Error(`no file: ${name}`);
    return new FakeFileHandle(name, v.bytes);
  }

  async getDirectoryHandle(name: string): Promise<FakeDirectoryHandle> {
    const v = this.tree[name];
    if (!v || isFile(v)) throw new Error(`no directory: ${name}`);
    return new FakeDirectoryHandle(name, v);
  }
}

export function makeDir(name: string, tree: FakeTree): FakeDirectoryHandle {
  return new FakeDirectoryHandle(name, tree);
}

export function makeFile(name: string, contents: string | Uint8Array): FakeFileHandle {
  const bytes =
    typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  return new FakeFileHandle(name, bytes);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/fake-filesystem.ts
git commit -m "test: in-memory FileSystem* polyfill for local-source tests"
```

---

## Task 41: Filesystem read helpers + mime lookup

**Files:**
- Create: `src/sources/local/filesystem-read.ts`
- Create: `tests/filesystem-read.test.ts`

Used by `LocalSource` to walk a folder and produce `{ filename, mimeType, bytesFetcher }` entries.

- [ ] **Step 1: Write the failing test**

Create `tests/filesystem-read.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  readAllBytes,
  inferMimeType,
  collectAssets,
} from "@/sources/local/filesystem-read";
import { makeDir, makeFile, FakeDirectoryHandle } from "./helpers/fake-filesystem";

describe("inferMimeType", () => {
  it.each([
    ["foo.png", "image/png"],
    ["foo.jpg", "image/jpeg"],
    ["foo.jpeg", "image/jpeg"],
    ["foo.gif", "image/gif"],
    ["foo.webp", "image/webp"],
    ["foo.svg", "image/svg+xml"],
    ["foo.pdf", "application/pdf"],
    ["foo.txt", "text/plain"],
    ["foo.md", "text/markdown"],
    ["foo.bin", "application/octet-stream"],
    ["weird", "application/octet-stream"],
  ])("infers %s as %s", (name, expected) => {
    expect(inferMimeType(name)).toBe(expected);
  });
});

describe("readAllBytes", () => {
  it("reads bytes from a fake file handle", async () => {
    const fh = makeFile("x.txt", "hi");
    const bytes = await readAllBytes(fh);
    expect(new TextDecoder().decode(bytes)).toBe("hi");
  });
});

describe("collectAssets", () => {
  it("collects images/ and attachments/ files into assets", async () => {
    const dir = makeDir("root", {
      "README.md": { bytes: new TextEncoder().encode("# t") },
      images: {
        "a.png": { bytes: new Uint8Array([1]) },
        "b.jpg": { bytes: new Uint8Array([2]) },
      },
      attachments: {
        "log.txt": { bytes: new TextEncoder().encode("hi") },
      },
    }) as unknown as FakeDirectoryHandle;
    const assets = await collectAssets(dir);
    const ids = assets.map((a) => a.id).sort();
    expect(ids).toEqual([
      "attachments/log.txt",
      "images/a.png",
      "images/b.jpg",
    ]);
    const log = assets.find((a) => a.id === "attachments/log.txt")!;
    expect(log.filename).toBe("log.txt");
    expect(log.mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(await log.fetch!())).toBe("hi");
  });

  it("returns [] when no subdirs present", async () => {
    const dir = makeDir("root", {
      "README.md": { bytes: new TextEncoder().encode("# t") },
    }) as unknown as FakeDirectoryHandle;
    const assets = await collectAssets(dir);
    expect(assets).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/filesystem-read.test.ts
```

- [ ] **Step 3: Implement**

Create `src/sources/local/filesystem-read.ts`:

```ts
import type { Asset } from "@/ir/types";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
};

export function inferMimeType(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = filename.slice(dot + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

// Structural duck-typing — works for the real DOM FileSystem*Handle AND the test fake.
type AnyFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
};

type AnyDirectoryHandle = {
  kind: "directory";
  name: string;
  entries(): AsyncIterable<[string, AnyFileHandle | AnyDirectoryHandle]>;
  getDirectoryHandle?(name: string): Promise<AnyDirectoryHandle>;
};

export async function readAllBytes(handle: AnyFileHandle): Promise<Uint8Array> {
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

async function collectFromSubdir(
  parent: AnyDirectoryHandle,
  subdirName: "images" | "attachments",
): Promise<Asset[]> {
  let subdir: AnyDirectoryHandle | undefined;
  for await (const [name, handle] of parent.entries()) {
    if (name === subdirName && handle.kind === "directory") {
      subdir = handle;
      break;
    }
  }
  if (!subdir) return [];
  const assets: Asset[] = [];
  for await (const [name, handle] of subdir.entries()) {
    if (handle.kind !== "file") continue;
    const id = `${subdirName}/${name}`;
    assets.push({
      id,
      filename: name,
      mimeType: inferMimeType(name),
      fetch: () => readAllBytes(handle),
    });
  }
  return assets;
}

export async function collectAssets(
  dir: AnyDirectoryHandle,
): Promise<Asset[]> {
  const [images, attachments] = await Promise.all([
    collectFromSubdir(dir, "images"),
    collectFromSubdir(dir, "attachments"),
  ]);
  return [...images, ...attachments];
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/filesystem-read.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/local/filesystem-read.ts tests/filesystem-read.test.ts
git commit -m "feat(local): filesystem read helpers + mime lookup"
```

---

## Task 42: LocalSource

**Files:**
- Create: `src/sources/local/local-source.ts`
- Create: `tests/local-source.test.ts`

`LocalSource.fetchPage()` accepts either a file handle or a folder handle (via the params object), parses Markdown via remark+gfm with `gray-matter` for frontmatter, and produces a `Page`.

- [ ] **Step 1: Write the failing test**

Create `tests/local-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LocalSource } from "@/sources/local/local-source";
import { makeDir, makeFile } from "./helpers/fake-filesystem";

describe("LocalSource — file mode", () => {
  it("imports a single .md with frontmatter title", async () => {
    const file = makeFile(
      "doc.md",
      "---\ntitle: Frontmatter Title\n---\n\n# Body Heading\n\nhello",
    );
    const src = new LocalSource();
    const page = await src.fetchPage({ kind: "file", fileHandle: file as any });
    expect(page.title).toBe("Frontmatter Title");
    expect(page.assets).toEqual([]);
    expect(page.blocks[0]).toEqual({
      type: "heading",
      level: 1,
      inlines: [{ type: "text", text: "Body Heading" }],
    });
  });

  it("falls back to first H1 then file basename for title", async () => {
    const file = makeFile("MY-DOC.md", "# From H1\n\ntext");
    const src = new LocalSource();
    const page = await src.fetchPage({ kind: "file", fileHandle: file as any });
    expect(page.title).toBe("From H1");

    const file2 = makeFile("Other.md", "text only");
    const page2 = await src.fetchPage({
      kind: "file",
      fileHandle: file2 as any,
    });
    expect(page2.title).toBe("Other");
  });

  it("warns on relative image reference when no assets available", async () => {
    const file = makeFile("doc.md", "![alt](images/missing.png)");
    const src = new LocalSource();
    const page = await src.fetchPage({ kind: "file", fileHandle: file as any });
    // Image degrades to a paragraph with alt text
    expect(page.blocks[0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "alt" }],
    });
  });
});

describe("LocalSource — folder mode", () => {
  it("imports the single .md and matches relative image", async () => {
    const dir = makeDir("project", {
      "README.md": {
        bytes: new TextEncoder().encode(
          "---\ntitle: Project Doc\n---\n\n![shot](images/a.png)\n",
        ),
      },
      images: {
        "a.png": { bytes: new Uint8Array([10]) },
      },
    });
    const src = new LocalSource();
    const page = await src.fetchPage({ kind: "folder", dirHandle: dir as any });
    expect(page.title).toBe("Project Doc");
    expect(page.assets).toHaveLength(1);
    expect(page.assets[0].id).toBe("images/a.png");
    expect(page.blocks).toEqual([
      { type: "image", assetId: "images/a.png", alt: "shot" },
    ]);
  });

  it("uses folder name as title when no frontmatter / H1", async () => {
    const dir = makeDir("My Folder", {
      "notes.md": { bytes: new TextEncoder().encode("just text") },
    });
    const src = new LocalSource();
    const page = await src.fetchPage({ kind: "folder", dirHandle: dir as any });
    expect(page.title).toBe("My Folder");
  });

  it("rejects folder without any .md", async () => {
    const dir = makeDir("empty", {});
    const src = new LocalSource();
    await expect(
      src.fetchPage({ kind: "folder", dirHandle: dir as any }),
    ).rejects.toThrow(/exactly one \.md/i);
  });

  it("rejects folder with multiple .md", async () => {
    const dir = makeDir("multi", {
      "a.md": { bytes: new TextEncoder().encode("a") },
      "b.md": { bytes: new TextEncoder().encode("b") },
    });
    const src = new LocalSource();
    await expect(
      src.fetchPage({ kind: "folder", dirHandle: dir as any }),
    ).rejects.toThrow(/exactly one \.md/i);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/local-source.test.ts
```

- [ ] **Step 3: Implement `LocalSource`**

Create `src/sources/local/local-source.ts`:

```ts
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import type { Asset, Block, Page } from "@/ir/types";
import type { Source } from "@/sources/source";
import { mdastToIr } from "./mdast-to-ir";
import { collectAssets, readAllBytes } from "./filesystem-read";

export type LocalSourceParams =
  | { kind: "file"; fileHandle: any /* FileSystemFileHandle */ }
  | { kind: "folder"; dirHandle: any /* FileSystemDirectoryHandle */ };

export class LocalSource implements Source {
  readonly id = "local";

  async fetchPage(params: LocalSourceParams): Promise<Page> {
    if (params.kind === "file") {
      return this.fromFile(params.fileHandle);
    }
    return this.fromFolder(params.dirHandle);
  }

  private async fromFile(fileHandle: any): Promise<Page> {
    const bytes = await readAllBytes(fileHandle);
    const text = new TextDecoder().decode(bytes);
    const { title, blocks } = parseMarkdown(text, new Set());
    const fileName: string = fileHandle.name ?? "Untitled.md";
    return finalisePage({
      title: title ?? stripExt(fileName),
      blocks,
      assets: [],
      sourceUrl: `local-file:${fileName}`,
    });
  }

  private async fromFolder(dirHandle: any): Promise<Page> {
    // 1. Find exactly one .md at root
    const mdHandles: any[] = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "file" && /\.md$/i.test(name)) {
        mdHandles.push(handle);
      }
    }
    if (mdHandles.length !== 1) {
      throw new Error(
        "Folder must contain exactly one .md file at its root.",
      );
    }
    const mdHandle = mdHandles[0];

    // 2. Collect assets first so the mdast walker can resolve refs
    const assets = await collectAssets(dirHandle);
    const assetIds = new Set(assets.map((a) => a.id));

    // 3. Parse the markdown
    const bytes = await readAllBytes(mdHandle);
    const text = new TextDecoder().decode(bytes);
    const { title, blocks } = parseMarkdown(text, assetIds);

    return finalisePage({
      title: title ?? dirHandle.name ?? stripExt(mdHandle.name),
      blocks,
      assets,
      sourceUrl: `local-folder:${dirHandle.name ?? ""}`,
    });
  }
}

function parseMarkdown(
  text: string,
  assetIds: Set<string>,
): { title: string | null; blocks: Block[] } {
  const parsed = matter(text);
  const body = parsed.content;
  const frontTitle =
    typeof parsed.data?.title === "string" ? parsed.data.title : null;

  const tree = remark().use(remarkGfm).parse(body);
  const { blocks } = mdastToIr(tree as any, { assetIds });

  let title = frontTitle;
  if (!title) {
    const h1 = blocks.find(
      (b): b is Extract<Block, { type: "heading" }> =>
        b.type === "heading" && b.level === 1,
    );
    if (h1) {
      title = h1.inlines.map((i) => ("text" in i ? i.text : "")).join("").trim();
      if (!title) title = null;
    }
  }
  return { title, blocks };
}

function stripExt(name: string): string {
  return name.replace(/\.md$/i, "");
}

function finalisePage(
  partial: Omit<Page, "id" | "capturedAt">,
): Page {
  return {
    id: cryptoRandomId(),
    capturedAt: new Date().toISOString(),
    ...partial,
  };
}

function cryptoRandomId(): string {
  // crypto.randomUUID is available in workers and modern browsers
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/local-source.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/local/local-source.ts tests/local-source.test.ts
git commit -m "feat(local): LocalSource for single .md and folder modes"
```

---

## Task 43: Notion blocks → IR — text, headings, lists, code, quote, divider

**Files:**
- Create: `src/sources/notion/notion-blocks-to-ir.ts`
- Create: `tests/notion-blocks-to-ir.test.ts`

A Notion block tree is `{ type, [type]: { rich_text, ... }, has_children, children? }`. We pass already-expanded trees (children pre-fetched) to keep this layer pure.

- [ ] **Step 1: Write the failing test**

Create `tests/notion-blocks-to-ir.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { notionBlocksToIr } from "@/sources/notion/notion-blocks-to-ir";

function rt(text: string, ann: Record<string, boolean> = {}, link?: string) {
  return {
    type: "text",
    text: { content: text, link: link ? { url: link } : null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      ...ann,
    },
    plain_text: text,
    href: link ?? null,
  };
}

describe("notionBlocksToIr — inline & headings", () => {
  it("renders paragraph with marks and link", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            rt("plain "),
            rt("bold", { bold: true }),
            rt(" "),
            rt("link", {}, "https://x.com"),
          ],
        },
      },
    ]);
    expect(blocks).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "plain " },
          { type: "text", text: "bold", marks: ["bold"] },
          { type: "text", text: " " },
          {
            type: "link",
            href: "https://x.com",
            inlines: [{ type: "text", text: "link" }],
          },
        ],
      },
    ]);
  });

  it("renders heading_1/2/3", () => {
    const { blocks } = notionBlocksToIr([
      { type: "heading_1", heading_1: { rich_text: [rt("H1")] } },
      { type: "heading_2", heading_2: { rich_text: [rt("H2")] } },
      { type: "heading_3", heading_3: { rich_text: [rt("H3")] } },
    ]);
    expect(blocks.map((b: any) => b.level)).toEqual([1, 2, 3]);
  });
});

describe("notionBlocksToIr — lists", () => {
  it("groups consecutive bulleted_list_item into one list", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [rt("a")] },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [rt("b")] },
      },
      { type: "paragraph", paragraph: { rich_text: [rt("p")] } },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [rt("c")] },
      },
    ]);
    expect(blocks).toHaveLength(3);
    expect((blocks[0] as any).ordered).toBe(false);
    expect((blocks[0] as any).items).toHaveLength(2);
    expect((blocks[2] as any).items).toHaveLength(1);
  });

  it("renders numbered list", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [rt("1")] },
      },
    ]);
    expect((blocks[0] as any).ordered).toBe(true);
  });

  it("renders to_do as text-prefixed list", () => {
    const { blocks } = notionBlocksToIr([
      { type: "to_do", to_do: { rich_text: [rt("done")], checked: true } },
      { type: "to_do", to_do: { rich_text: [rt("todo")], checked: false } },
    ]);
    const items = (blocks[0] as any).items;
    expect(JSON.stringify(items[0])).toContain("[x] ");
    expect(JSON.stringify(items[1])).toContain("[ ] ");
  });
});

describe("notionBlocksToIr — misc blocks", () => {
  it("renders code with language", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "code",
        code: { rich_text: [rt("const x=1")], language: "typescript" },
      },
    ]);
    expect(blocks[0]).toEqual({
      type: "code",
      language: "typescript",
      text: "const x=1",
    });
  });

  it("renders quote with nested children", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "quote",
        quote: { rich_text: [rt("quoted")] },
        children: [
          { type: "paragraph", paragraph: { rich_text: [rt("inside")] } },
        ],
      },
    ]);
    expect(blocks[0]).toMatchObject({
      type: "quote",
      blocks: [
        { type: "paragraph", inlines: [{ type: "text", text: "quoted" }] },
        { type: "paragraph", inlines: [{ type: "text", text: "inside" }] },
      ],
    });
  });

  it("renders divider", () => {
    const { blocks } = notionBlocksToIr([{ type: "divider", divider: {} }]);
    expect(blocks).toEqual([{ type: "divider" }]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/notion-blocks-to-ir.test.ts
```

- [ ] **Step 3: Implement**

Create `src/sources/notion/notion-blocks-to-ir.ts`:

```ts
import type { Block, Inline, Mark } from "@/ir/types";

type NBlock = {
  type: string;
  has_children?: boolean;
  children?: NBlock[];
  [k: string]: any;
};

export type NotionToIrResult = {
  blocks: Block[];
  warnings: string[];
  /** Image / file blocks collected for the caller to turn into Assets. */
  mediaRefs: Array<{ blockId: string; kind: "image" | "file"; url: string; filename?: string; mime?: string }>;
};

const GROUPED_LIST: Record<string, "bulleted" | "numbered" | "todo"> = {
  bulleted_list_item: "bulleted",
  numbered_list_item: "numbered",
  to_do: "todo",
};

export function notionBlocksToIr(blocks: NBlock[]): NotionToIrResult {
  const warnings: string[] = [];
  const mediaRefs: NotionToIrResult["mediaRefs"] = [];
  const out: Block[] = [];

  let i = 0;
  while (i < blocks.length) {
    const cur = blocks[i];
    const listKind = GROUPED_LIST[cur.type];
    if (listKind) {
      const groupType = cur.type;
      const items: Block[][] = [];
      while (i < blocks.length && blocks[i].type === groupType) {
        items.push(itemBlocks(blocks[i], listKind, warnings, mediaRefs));
        i++;
      }
      out.push({
        type: "list",
        ordered: listKind === "numbered",
        items,
      });
      continue;
    }
    const b = blockToBlock(cur, warnings, mediaRefs);
    if (b) {
      if (Array.isArray(b)) out.push(...b);
      else out.push(b);
    }
    i++;
  }
  return { blocks: out, warnings, mediaRefs };
}

function itemBlocks(
  n: NBlock,
  kind: "bulleted" | "numbered" | "todo",
  warnings: string[],
  mediaRefs: NotionToIrResult["mediaRefs"],
): Block[] {
  const payload = n[n.type] ?? {};
  let inlines = richTextToInlines(payload.rich_text ?? []);
  if (kind === "todo") {
    const prefix = payload.checked ? "[x] " : "[ ] ";
    inlines = [{ type: "text", text: prefix }, ...inlines];
  }
  const first: Block = { type: "paragraph", inlines };
  const children = n.children
    ? notionBlocksToIr(n.children).blocks
    : [];
  return [first, ...children];
}

function blockToBlock(
  n: NBlock,
  warnings: string[],
  mediaRefs: NotionToIrResult["mediaRefs"],
): Block | Block[] | null {
  switch (n.type) {
    case "paragraph":
      return {
        type: "paragraph",
        inlines: richTextToInlines(n.paragraph?.rich_text ?? []),
      };
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = Number(n.type.slice(-1)) as 1 | 2 | 3;
      return {
        type: "heading",
        level,
        inlines: richTextToInlines(n[n.type]?.rich_text ?? []),
      };
    }
    case "code":
      return {
        type: "code",
        language: n.code?.language ?? undefined,
        text: (n.code?.rich_text ?? [])
          .map((r: any) => r.plain_text ?? "")
          .join(""),
      };
    case "quote": {
      const first: Block = {
        type: "paragraph",
        inlines: richTextToInlines(n.quote?.rich_text ?? []),
      };
      const children = n.children
        ? notionBlocksToIr(n.children).blocks
        : [];
      return { type: "quote", blocks: [first, ...children] };
    }
    case "divider":
      return { type: "divider" };
    case "callout":
      return calloutBlock(n, warnings);
    case "table":
      return tableBlock(n, warnings);
    case "image":
      return imageBlock(n, mediaRefs);
    case "file":
    case "pdf":
      return fileBlock(n, mediaRefs);
    case "toggle": {
      // No native equivalent: render as a quote with a leading ▸ summary line
      const summary: Block = {
        type: "paragraph",
        inlines: [
          { type: "text", text: "▸ " },
          ...richTextToInlines(n.toggle?.rich_text ?? []),
        ],
      };
      const children = n.children
        ? notionBlocksToIr(n.children).blocks
        : [];
      return { type: "quote", blocks: [summary, ...children] };
    }
    case "column_list":
    case "column": {
      warnings.push(`flattened ${n.type}`);
      const kids = n.children ? notionBlocksToIr(n.children).blocks : [];
      return kids;
    }
    default:
      warnings.push(`unsupported notion block: ${n.type}`);
      return {
        type: "paragraph",
        inlines: [{ type: "text", text: `[${n.type}]` }],
      };
  }
}

function calloutBlock(n: NBlock, warnings: string[]): Block {
  const color = String(n.callout?.color ?? "").toLowerCase();
  let variant: "info" | "note" | "warning" | "success" = "note";
  if (color.startsWith("blue")) variant = "info";
  else if (color.startsWith("yellow") || color.startsWith("orange"))
    variant = "warning";
  else if (color.startsWith("green")) variant = "success";
  const first: Block = {
    type: "paragraph",
    inlines: richTextToInlines(n.callout?.rich_text ?? []),
  };
  const children = n.children
    ? notionBlocksToIr(n.children).blocks
    : [];
  return { type: "callout", variant, blocks: [first, ...children] };
}

function tableBlock(n: NBlock, warnings: string[]): Block {
  const rows: Block[][][] = (n.children ?? [])
    .filter((c: NBlock) => c.type === "table_row")
    .map((row: NBlock) =>
      (row.table_row?.cells ?? []).map((cell: any[]) => [
        { type: "paragraph", inlines: richTextToInlines(cell) } as Block,
      ]),
    );
  return { type: "table", rows };
}

function imageBlock(
  n: NBlock,
  mediaRefs: NotionToIrResult["mediaRefs"],
): Block {
  const src =
    n.image?.type === "external"
      ? n.image.external?.url
      : n.image?.file?.url;
  if (!src) {
    return {
      type: "paragraph",
      inlines: [{ type: "text", text: "[image: missing source]" }],
    };
  }
  const id = `notion-${n.id ?? cryptoId()}`;
  mediaRefs.push({
    blockId: id,
    kind: "image",
    url: src,
    filename: notionFilename(src, id, "image"),
  });
  return { type: "image", assetId: id, alt: "" };
}

function fileBlock(
  n: NBlock,
  mediaRefs: NotionToIrResult["mediaRefs"],
): Block {
  const payload = n[n.type] ?? {};
  const src =
    payload.type === "external" ? payload.external?.url : payload.file?.url;
  if (!src) {
    return {
      type: "paragraph",
      inlines: [{ type: "text", text: `[${n.type}: missing source]` }],
    };
  }
  const id = `notion-${n.id ?? cryptoId()}`;
  const filename = notionFilename(src, id, "file");
  mediaRefs.push({ blockId: id, kind: "file", url: src, filename });
  return { type: "attachment", assetId: id, filename };
}

function notionFilename(url: string, fallbackId: string, kind: string): string {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(u.pathname.split("/").pop() ?? "");
    if (base) return base;
  } catch {}
  return `${fallbackId}.${kind === "image" ? "bin" : "file"}`;
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const MARK_KEY: Array<[string, Mark]> = [
  ["bold", "bold"],
  ["italic", "italic"],
  ["underline", "underline"],
  ["strikethrough", "strike"],
  ["code", "code"],
];

function richTextToInlines(rich: any[]): Inline[] {
  const out: Inline[] = [];
  for (const r of rich) {
    const text =
      r.type === "text"
        ? (r.text?.content ?? "")
        : r.type === "equation"
          ? (r.equation?.expression ?? "")
          : (r.plain_text ?? "");
    const marks: Mark[] = [];
    const ann = r.annotations ?? {};
    for (const [k, m] of MARK_KEY) {
      if (ann[k]) marks.push(m);
    }
    const href = r.href ?? r.text?.link?.url ?? null;
    const base: Inline = marks.length
      ? { type: "text", text, marks }
      : { type: "text", text };
    if (href) {
      out.push({ type: "link", href, inlines: [base] });
    } else {
      out.push(base);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/notion-blocks-to-ir.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/notion/notion-blocks-to-ir.ts tests/notion-blocks-to-ir.test.ts
git commit -m "feat(notion): block tree → IR (text, headings, lists, code, quote, divider, etc.)"
```

---

## Task 44: Notion blocks → IR — callouts, tables, images, files

The test cases for callouts, tables, image and file blocks belong here; the implementation in Task 43 already covers them (it's small enough to keep in one module). This task adds the assertions.

**Files:**
- Modify: `tests/notion-blocks-to-ir.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/notion-blocks-to-ir.test.ts`:

```ts
describe("notionBlocksToIr — callouts & table", () => {
  it.each([
    ["blue_background", "info"],
    ["yellow_background", "warning"],
    ["green_background", "success"],
    ["red_background", "note"],
  ])("maps callout color %s → variant %s", (color, variant) => {
    const { blocks } = notionBlocksToIr([
      {
        type: "callout",
        callout: { rich_text: [rt("hi")], color },
      },
    ]);
    expect((blocks[0] as any).variant).toBe(variant);
  });

  it("renders a 2x2 table from table_row children", () => {
    const { blocks } = notionBlocksToIr([
      {
        type: "table",
        table: { table_width: 2, has_column_header: true },
        children: [
          {
            type: "table_row",
            table_row: {
              cells: [[rt("h1")], [rt("h2")]],
            },
          },
          {
            type: "table_row",
            table_row: {
              cells: [[rt("a")], [rt("b")]],
            },
          },
        ],
      },
    ]);
    expect(blocks[0]).toEqual({
      type: "table",
      rows: [
        [
          [{ type: "paragraph", inlines: [{ type: "text", text: "h1" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "h2" }] }],
        ],
        [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
        ],
      ],
    });
  });
});

describe("notionBlocksToIr — media", () => {
  it("creates an image block and a mediaRef", () => {
    const { blocks, mediaRefs } = notionBlocksToIr([
      {
        id: "blk-1",
        type: "image",
        image: {
          type: "file",
          file: { url: "https://files.notion/abc/pic.png" },
        },
      },
    ]);
    expect(blocks).toEqual([
      { type: "image", assetId: "notion-blk-1", alt: "" },
    ]);
    expect(mediaRefs).toEqual([
      {
        blockId: "notion-blk-1",
        kind: "image",
        url: "https://files.notion/abc/pic.png",
        filename: "pic.png",
      },
    ]);
  });

  it("creates an attachment block and mediaRef for pdf", () => {
    const { blocks, mediaRefs } = notionBlocksToIr([
      {
        id: "blk-2",
        type: "pdf",
        pdf: {
          type: "external",
          external: { url: "https://example.com/doc.pdf" },
        },
      },
    ]);
    expect(blocks).toEqual([
      { type: "attachment", assetId: "notion-blk-2", filename: "doc.pdf" },
    ]);
    expect(mediaRefs[0].kind).toBe("file");
  });

  it("falls back when image has no source", () => {
    const { blocks } = notionBlocksToIr([
      { id: "x", type: "image", image: { type: "file" } },
    ]);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "[image: missing source]" }],
    });
  });
});

describe("notionBlocksToIr — fallbacks", () => {
  it("renders unknown block as [type] paragraph + warning", () => {
    const { blocks, warnings } = notionBlocksToIr([
      { type: "synced_block", synced_block: {} },
    ]);
    expect(warnings).toContain("unsupported notion block: synced_block");
    expect(blocks[0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "[synced_block]" }],
    });
  });
});
```

- [ ] **Step 2: Run, expect pass**

```bash
pnpm test tests/notion-blocks-to-ir.test.ts
```

Expected: all tests pass (the implementation in Task 43 already handles these cases).

- [ ] **Step 3: Commit**

```bash
git add tests/notion-blocks-to-ir.test.ts
git commit -m "test(notion): callouts, tables, media, fallback assertions"
```

---

## Task 45: Notion read API client

**Files:**
- Create: `src/sources/notion/notion-read-api.ts`
- Create: `tests/notion-read-api.test.ts`

Endpoints:
- `GET /v1/pages/{id}` (for the page title)
- `GET /v1/blocks/{id}/children?page_size=100&start_cursor=…` (paginated)

The fetcher should also expose downloading an asset URL (used later by the Notion source's lazy `Asset.fetch`).

- [ ] **Step 1: Write the failing test**

Create `tests/notion-read-api.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NotionReadApi, extractPageId } from "@/sources/notion/notion-read-api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("extractPageId", () => {
  it("extracts the trailing 32-hex id from a URL", () => {
    const id = extractPageId(
      "https://www.notion.so/My-Page-abcdef0123456789abcdef0123456789",
    );
    expect(id).toBe("abcdef0123456789abcdef0123456789");
  });

  it("accepts a bare id", () => {
    const id = extractPageId("abcdef0123456789abcdef0123456789");
    expect(id).toBe("abcdef0123456789abcdef0123456789");
  });

  it("accepts dashed UUID format", () => {
    const id = extractPageId("abcdef01-2345-6789-abcd-ef0123456789");
    expect(id).toBe("abcdef012345678" + "9abcdef0123456789");
  });

  it("rejects garbage", () => {
    expect(() => extractPageId("nope")).toThrow();
  });
});

const api = new NotionReadApi("secret_TEST");

describe("NotionReadApi.getPageTitle", () => {
  it("returns the title property value", async () => {
    server.use(
      http.get("https://api.notion.com/v1/pages/abc", () =>
        HttpResponse.json({
          properties: {
            Name: {
              type: "title",
              title: [
                { plain_text: "Hello " },
                { plain_text: "World" },
              ],
            },
          },
        }),
      ),
    );
    expect(await api.getPageTitle("abc")).toBe("Hello World");
  });

  it("falls back to Untitled when no title property", async () => {
    server.use(
      http.get("https://api.notion.com/v1/pages/abc", () =>
        HttpResponse.json({ properties: {} }),
      ),
    );
    expect(await api.getPageTitle("abc")).toBe("Untitled");
  });
});

describe("NotionReadApi.getBlockTree", () => {
  it("paginates children and recurses into has_children", async () => {
    server.use(
      http.get(
        "https://api.notion.com/v1/blocks/root/children",
        ({ request }) => {
          const cursor = new URL(request.url).searchParams.get("start_cursor");
          if (!cursor) {
            return HttpResponse.json({
              results: [
                {
                  id: "p1",
                  type: "paragraph",
                  paragraph: { rich_text: [] },
                  has_children: false,
                },
              ],
              has_more: true,
              next_cursor: "C",
            });
          }
          return HttpResponse.json({
            results: [
              {
                id: "q1",
                type: "quote",
                quote: { rich_text: [] },
                has_children: true,
              },
            ],
            has_more: false,
            next_cursor: null,
          });
        },
      ),
      http.get("https://api.notion.com/v1/blocks/q1/children", () =>
        HttpResponse.json({
          results: [
            {
              id: "qp1",
              type: "paragraph",
              paragraph: { rich_text: [] },
              has_children: false,
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      ),
    );

    const tree = await api.getBlockTree("root");
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe("p1");
    expect(tree[1].id).toBe("q1");
    expect((tree[1] as any).children).toHaveLength(1);
  });
});

describe("NotionReadApi.downloadAsset", () => {
  it("returns bytes", async () => {
    server.use(
      http.get("https://files.notion/x", () =>
        new HttpResponse(new Uint8Array([7, 8, 9]), {
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );
    const bytes = await api.downloadAsset("https://files.notion/x");
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/notion-read-api.test.ts
```

- [ ] **Step 3: Implement**

Create `src/sources/notion/notion-read-api.ts`:

```ts
const ID_RE = /[0-9a-f]{32}/i;
const DASHED_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
    if (!r.ok) throw new Error(`getPage ${pageId}: ${r.status}`);
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
    if (depth > 5) return []; // defensive
    const all: NBlock[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(`${NOTION_BASE}/blocks/${blockId}/children`);
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("start_cursor", cursor);
      const r = await fetch(url.toString(), { headers: this.headers() });
      if (!r.ok)
        throw new Error(`getChildren ${blockId}: ${r.status} ${await r.text()}`);
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
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/notion-read-api.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/notion/notion-read-api.ts tests/notion-read-api.test.ts
git commit -m "feat(notion): read API client (page title, paginated block tree, asset download)"
```

---

## Task 46: NotionSource (assemble Page IR)

**Files:**
- Create: `src/sources/notion/notion-source.ts`
- Create: `tests/notion-source.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/notion-source.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NotionSource } from "@/sources/notion/notion-source";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("NotionSource.fetchPage", () => {
  it("returns Page with blocks, assets, and lazy fetch", async () => {
    server.use(
      http.get(
        "https://api.notion.com/v1/pages/abcdef0123456789abcdef0123456789",
        () =>
          HttpResponse.json({
            properties: {
              Name: { type: "title", title: [{ plain_text: "Doc" }] },
            },
          }),
      ),
      http.get(
        "https://api.notion.com/v1/blocks/abcdef0123456789abcdef0123456789/children",
        () =>
          HttpResponse.json({
            results: [
              {
                id: "p1",
                type: "paragraph",
                paragraph: { rich_text: [{ type: "text", plain_text: "hi", text: { content: "hi" }, annotations: {} }] },
              },
              {
                id: "img1",
                type: "image",
                image: {
                  type: "file",
                  file: { url: "https://files.notion/pic.png" },
                },
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
      ),
      http.get("https://files.notion/pic.png", () =>
        new HttpResponse(new Uint8Array([1, 2]), {
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    const src = new NotionSource("secret_T");
    const page = await src.fetchPage({
      pageUrlOrId:
        "https://www.notion.so/Doc-abcdef0123456789abcdef0123456789",
    });
    expect(page.title).toBe("Doc");
    expect(page.blocks).toHaveLength(2);
    expect(page.assets).toHaveLength(1);

    const bytes = await page.assets[0].fetch!();
    expect(Array.from(bytes)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/notion-source.test.ts
```

- [ ] **Step 3: Implement**

Create `src/sources/notion/notion-source.ts`:

```ts
import type { Asset, Page } from "@/ir/types";
import type { Source } from "@/sources/source";
import { NotionReadApi, extractPageId } from "./notion-read-api";
import { notionBlocksToIr } from "./notion-blocks-to-ir";

export type NotionSourceParams = { pageUrlOrId: string };

export class NotionSource implements Source {
  readonly id = "notion";
  private api: NotionReadApi;

  constructor(token: string) {
    this.api = new NotionReadApi(token);
  }

  async fetchPage(params: NotionSourceParams): Promise<Page> {
    const id = extractPageId(params.pageUrlOrId);
    const [title, tree] = await Promise.all([
      this.api.getPageTitle(id),
      this.api.getBlockTree(id),
    ]);
    const { blocks, mediaRefs } = notionBlocksToIr(tree);

    const assets: Asset[] = mediaRefs.map((m) => ({
      id: m.blockId,
      filename: m.filename ?? `${m.blockId}.bin`,
      mimeType: m.mime ?? "application/octet-stream",
      fetch: () => this.api.downloadAsset(m.url),
    }));

    return {
      id,
      title,
      sourceUrl: params.pageUrlOrId,
      capturedAt: new Date().toISOString(),
      blocks,
      assets,
    };
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/notion-source.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sources/notion/notion-source.ts tests/notion-source.test.ts
git commit -m "feat(notion): NotionSource assembles Page IR with lazy asset fetchers"
```

---

## Task 47: Extend messaging protocol for import

**Files:**
- Modify: `src/messaging/protocol.ts`

- [ ] **Step 1: Add new request/response shapes**

Open `src/messaging/protocol.ts` and add the following types (placed alongside the existing `CaptureRequest` family):

```ts
// --- Import direction ---

export type ImportRequest = {
  type: "import";
  sourceId: "local-file" | "local-folder" | "notion";
  sourceParams:
    | { kind: "local-file"; handleToken: string }
    | { kind: "local-folder"; handleToken: string }
    | { kind: "notion"; pageUrlOrId: string };
  destinationParams: {
    spaceId: string;
    parentPageId?: string;
  };
};

export type ListSpacesRequest = { type: "list-spaces" };
export type ListSpacesResponse = {
  type: "list-spaces-result";
  spaces: Array<{ id: string; key: string; name: string }>;
};

export type ListRootPagesRequest = {
  type: "list-root-pages";
  spaceId: string;
};
export type ListRootPagesResponse = {
  type: "list-root-pages-result";
  pages: Array<{ id: string; title: string }>;
};

// The side panel hands a FileSystem* handle to the worker by sending it once;
// the worker stores it under an opaque token and includes the token in
// subsequent ImportRequest payloads.
export type RegisterHandleRequest = {
  type: "register-handle";
  kind: "file" | "directory";
  handle: any; // structured-cloneable FileSystem*Handle
};
export type RegisterHandleResponse = {
  type: "register-handle-result";
  token: string;
};
```

And extend the existing `WorkerRequest` / `WorkerResponse` unions to include these new variants:

```ts
export type WorkerRequest =
  | CaptureRequest
  | SearchNotionParentsRequest
  | FetchPageOnlyRequest
  | ImportRequest
  | ListSpacesRequest
  | ListRootPagesRequest
  | RegisterHandleRequest;

export type WorkerResponse =
  | CaptureProgress
  | CaptureDone
  | CaptureError
  | SearchNotionParentsResponse
  | FetchPageOnlyResponse
  | ListSpacesResponse
  | ListRootPagesResponse
  | RegisterHandleResponse;
```

The existing `CaptureProgress`, `CaptureDone`, `CaptureError` events are reused for import progress / completion / errors — same shapes.

- [ ] **Step 2: Verify it compiles**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/messaging/protocol.ts
git commit -m "feat(messaging): add import request, list-spaces, list-root-pages, register-handle"
```

---

## Task 48: Orchestrator — handle import request

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Create: `tests/orchestrator-import.test.ts`

The export plan's orchestrator currently runs the Confluence-to-(Notion|Local) pipeline. We extend it with an `import` entry point that picks a source (Local or Notion) and runs ConfluenceDestination.

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator-import.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/orchestrator-import.test.ts
```

- [ ] **Step 3: Add `runImport` to orchestrator**

In `src/orchestrator/orchestrator.ts`, add:

```ts
import { LocalSource, type LocalSourceParams } from "@/sources/local/local-source";
import { NotionSource } from "@/sources/notion/notion-source";
import { ConfluenceDestination } from "@/destinations/confluence/confluence-destination";
import type { PublishResult } from "@/destinations/destination";
import type { ConfluenceCreds } from "@/destinations/confluence/confluence-write-api";

export type ImportRunCreds = {
  confluence: ConfluenceCreds;
  notionToken: string;
};

export type ImportRunInput = {
  sourceId: "local-file" | "local-folder" | "notion";
  sourceParams:
    | { kind: "local-file"; fileHandle: any }
    | { kind: "local-folder"; dirHandle: any }
    | { kind: "notion"; pageUrlOrId: string };
  destinationParams: { spaceId: string; parentPageId?: string };
};

export async function runImport(
  creds: ImportRunCreds,
  input: ImportRunInput,
  onProgress: (m: string) => void,
): Promise<PublishResult> {
  // Build source
  let page;
  if (input.sourceId === "local-file" || input.sourceId === "local-folder") {
    const src = new LocalSource();
    const params: LocalSourceParams =
      input.sourceParams.kind === "local-file"
        ? { kind: "file", fileHandle: input.sourceParams.fileHandle }
        : { kind: "folder", dirHandle: (input.sourceParams as any).dirHandle };
    onProgress("Reading local source…");
    page = await src.fetchPage(params);
  } else {
    if (!creds.notionToken) {
      throw new Error("Notion token not configured");
    }
    const src = new NotionSource(creds.notionToken);
    onProgress("Reading Notion page…");
    page = await src.fetchPage({
      pageUrlOrId: (input.sourceParams as any).pageUrlOrId,
    });
  }

  // Build destination
  const dest = new ConfluenceDestination(
    creds.confluence,
    input.destinationParams,
  );
  return dest.publish(page, { onProgress });
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/orchestrator-import.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts tests/orchestrator-import.test.ts
git commit -m "feat(orchestrator): runImport dispatches LocalSource/NotionSource → ConfluenceDestination"
```

---

## Task 49: Background service worker — wire import handlers

**Files:**
- Modify: `entrypoints/background.ts`

The existing background entry already handles the capture (export) messages. Add handlers for `import`, `list-spaces`, `list-root-pages`, `register-handle`.

- [ ] **Step 1: Open `entrypoints/background.ts` and add handlers**

After the existing message router, add:

```ts
import { runImport } from "@/orchestrator/orchestrator";
import { ConfluenceWriteApi } from "@/destinations/confluence/confluence-write-api";
import { getSettings } from "@/storage/settings";

// In-memory handle registry (lives as long as the service worker)
const handles = new Map<string, any>();

function newToken(): string {
  return (crypto as any).randomUUID();
}

// Inside the existing onMessage handler / router, add cases:

// case "register-handle":
//   {
//     const token = newToken();
//     handles.set(token, msg.handle);
//     sendResponse({ type: "register-handle-result", token });
//   }
//   return true;

// case "list-spaces":
//   {
//     const s = await getSettings();
//     const api = new ConfluenceWriteApi(s.atlassian);
//     const spaces = await api.listSpaces();
//     sendResponse({ type: "list-spaces-result", spaces });
//   }
//   return true;

// case "list-root-pages":
//   {
//     const s = await getSettings();
//     const api = new ConfluenceWriteApi(s.atlassian);
//     const pages = await api.listRootPages(msg.spaceId);
//     sendResponse({ type: "list-root-pages-result", pages });
//   }
//   return true;

// case "import":
//   {
//     const s = await getSettings();
//     const sourceParams =
//       msg.sourceParams.kind === "notion"
//         ? msg.sourceParams
//         : msg.sourceParams.kind === "local-file"
//           ? {
//               kind: "local-file" as const,
//               fileHandle: handles.get(msg.sourceParams.handleToken),
//             }
//           : {
//               kind: "local-folder" as const,
//               dirHandle: handles.get(msg.sourceParams.handleToken),
//             };
//     try {
//       const r = await runImport(
//         { confluence: s.atlassian, notionToken: s.notion?.integrationToken ?? "" },
//         {
//           sourceId: msg.sourceId,
//           sourceParams,
//           destinationParams: msg.destinationParams,
//         },
//         (m) => chrome.runtime.sendMessage({ type: "progress", message: m }),
//       );
//       chrome.runtime.sendMessage({
//         type: "done",
//         ok: r.ok,
//         failures: r.failures,
//         destinationUrl: r.destinationUrl,
//       });
//     } catch (e: any) {
//       chrome.runtime.sendMessage({
//         type: "error",
//         message: e?.message ?? String(e),
//       });
//     } finally {
//       // Free any handle tokens used by this run
//       if ("handleToken" in msg.sourceParams) {
//         handles.delete((msg.sourceParams as any).handleToken);
//       }
//     }
//   }
//   return true;
```

Uncomment the cases inline within the existing `chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => { ... })` block; the comment markers above are because the export plan's structure isn't replicated here verbatim. Match the existing switch/if structure for the file.

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/background.ts
git commit -m "feat(background): handle import, list-spaces, list-root-pages, register-handle"
```

---

## Task 50: Settings — record mode/source/space/parent defaults

**Files:**
- Modify: `src/storage/settings.ts`
- Modify: `tests/settings.test.ts`

Extend `defaults` so the side panel can remember the last import context.

- [ ] **Step 1: Extend the failing test**

In `tests/settings.test.ts`, add:

```ts
it("persists mode and import defaults", async () => {
  await saveSettings({
    atlassian: { siteUrl: "s", email: "e", apiToken: "t" },
    notion: { integrationToken: "n" },
    defaults: {
      lastMode: "import",
      lastImportSourceId: "local-folder",
      lastImportSpaceId: "100",
      lastImportParentId: "42",
    },
  });
  const s = await getSettings();
  expect(s.defaults?.lastMode).toBe("import");
  expect(s.defaults?.lastImportSourceId).toBe("local-folder");
  expect(s.defaults?.lastImportSpaceId).toBe("100");
  expect(s.defaults?.lastImportParentId).toBe("42");
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/settings.test.ts
```

- [ ] **Step 3: Extend the `Settings` type**

In `src/storage/settings.ts`, change the `defaults` block of the `Settings` type to:

```ts
defaults?: {
  lastDestinationType?: "notion" | "local";
  lastNotionParentId?: string;
  lastMode?: "export" | "import";
  lastImportSourceId?: "local-file" | "local-folder" | "notion";
  lastImportSpaceId?: string;
  lastImportParentId?: string;
};
```

(No runtime logic change — settings is a passthrough wrapper.)

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/settings.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/storage/settings.ts tests/settings.test.ts
git commit -m "feat(settings): persist last mode and import defaults"
```

---

## Task 51: Side panel — Import form component

**Files:**
- Create: `entrypoints/sidepanel/ImportForm.tsx`

Renders the import form: source picker (Local / Notion), local file/folder buttons, Notion URL input, space + parent dropdowns, Import button, progress / result panel.

- [ ] **Step 1: Implement the component**

Create `entrypoints/sidepanel/ImportForm.tsx`:

```tsx
import { useEffect, useState } from "react";

type SourceKind = "local-file" | "local-folder" | "notion";

type Space = { id: string; key: string; name: string };
type PageSummary = { id: string; title: string };

type PickedLocal =
  | { kind: "file"; handle: FileSystemFileHandle; label: string }
  | { kind: "folder"; handle: FileSystemDirectoryHandle; label: string };

type Status =
  | { state: "idle" }
  | { state: "running"; message: string }
  | { state: "done"; ok: boolean; url?: string; failures: Array<{ reason: string }> }
  | { state: "error"; message: string };

export function ImportForm() {
  const [sourceKind, setSourceKind] = useState<SourceKind>("local-folder");
  const [picked, setPicked] = useState<PickedLocal | null>(null);
  const [notionUrl, setNotionUrl] = useState("");
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [spaceId, setSpaceId] = useState<string>("");
  const [rootPages, setRootPages] = useState<PageSummary[] | null>(null);
  const [parentId, setParentId] = useState<string>("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  // Load spaces once
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "list-spaces" }, (r) => {
      if (r?.type === "list-spaces-result") setSpaces(r.spaces);
    });
  }, []);

  // Reload root pages when space changes
  useEffect(() => {
    if (!spaceId) {
      setRootPages(null);
      setParentId("");
      return;
    }
    chrome.runtime.sendMessage(
      { type: "list-root-pages", spaceId },
      (r) => {
        if (r?.type === "list-root-pages-result") setRootPages(r.pages);
      },
    );
  }, [spaceId]);

  // Subscribe to progress / done / error messages
  useEffect(() => {
    const listener = (msg: any) => {
      if (msg?.type === "progress")
        setStatus({ state: "running", message: msg.message });
      else if (msg?.type === "done")
        setStatus({
          state: "done",
          ok: msg.ok,
          url: msg.destinationUrl,
          failures: msg.failures ?? [],
        });
      else if (msg?.type === "error")
        setStatus({ state: "error", message: msg.message });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function pickFile() {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [
        {
          description: "Markdown",
          accept: { "text/markdown": [".md"] },
        },
      ],
    });
    setPicked({ kind: "file", handle, label: handle.name });
    setSourceKind("local-file");
  }

  async function pickFolder() {
    const handle = await (window as any).showDirectoryPicker();
    setPicked({ kind: "folder", handle, label: handle.name });
    setSourceKind("local-folder");
  }

  async function startImport() {
    setStatus({ state: "running", message: "Starting…" });
    if (sourceKind === "notion") {
      chrome.runtime.sendMessage({
        type: "import",
        sourceId: "notion",
        sourceParams: { kind: "notion", pageUrlOrId: notionUrl },
        destinationParams: {
          spaceId,
          parentPageId: parentId || undefined,
        },
      });
      return;
    }
    if (!picked) {
      setStatus({ state: "error", message: "Pick a file or folder first." });
      return;
    }
    // Register the handle with the worker, then trigger the import
    chrome.runtime.sendMessage(
      { type: "register-handle", kind: picked.kind, handle: picked.handle },
      (r) => {
        if (r?.type !== "register-handle-result") {
          setStatus({ state: "error", message: "Failed to register handle." });
          return;
        }
        chrome.runtime.sendMessage({
          type: "import",
          sourceId: sourceKind,
          sourceParams: {
            kind: sourceKind,
            handleToken: r.token,
          },
          destinationParams: {
            spaceId,
            parentPageId: parentId || undefined,
          },
        });
      },
    );
  }

  const canStart =
    spaceId &&
    (sourceKind === "notion" ? notionUrl.trim().length > 0 : !!picked);

  return (
    <div className="import-form">
      <fieldset>
        <legend>Source</legend>
        <label>
          <input
            type="radio"
            checked={sourceKind !== "notion"}
            onChange={() => setSourceKind("local-folder")}
          />
          Local
        </label>
        <label>
          <input
            type="radio"
            checked={sourceKind === "notion"}
            onChange={() => setSourceKind("notion")}
          />
          Notion
        </label>
      </fieldset>

      {sourceKind !== "notion" && (
        <div className="local-picker">
          <button onClick={pickFile}>Pick .md file</button>
          <button onClick={pickFolder}>Pick folder</button>
          {picked && <div className="picked">Selected: {picked.label}</div>}
        </div>
      )}

      {sourceKind === "notion" && (
        <div className="notion-picker">
          <label>Page URL</label>
          <input
            type="text"
            value={notionUrl}
            onChange={(e) => setNotionUrl(e.target.value)}
            placeholder="https://www.notion.so/..."
          />
        </div>
      )}

      <fieldset>
        <legend>Destination (Confluence)</legend>
        <label>Space</label>
        <select
          value={spaceId}
          onChange={(e) => setSpaceId(e.target.value)}
        >
          <option value="">(choose…)</option>
          {(spaces ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label>Parent</label>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          disabled={!spaceId}
        >
          <option value="">(space root)</option>
          {(rootPages ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </fieldset>

      <button
        className="primary"
        disabled={!canStart || status.state === "running"}
        onClick={startImport}
      >
        Import page
      </button>

      {status.state === "running" && <p>{status.message}</p>}
      {status.state === "error" && (
        <p className="error">Error: {status.message}</p>
      )}
      {status.state === "done" && (
        <div className={status.ok ? "ok" : "warn"}>
          <p>
            {status.ok ? "Done." : "Done with warnings."}{" "}
            {status.url && (
              <a href={status.url} target="_blank" rel="noreferrer">
                Open page
              </a>
            )}
          </p>
          {status.failures.length > 0 && (
            <details>
              <summary>{status.failures.length} warning(s)</summary>
              <ul>
                {status.failures.map((f, i) => (
                  <li key={i}>{f.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors. (Vitest tests for React UI are out of scope for this plan; manual smoke is the verification step in Task 53.)

- [ ] **Step 3: Commit**

```bash
git add entrypoints/sidepanel/ImportForm.tsx
git commit -m "feat(sidepanel): ImportForm component (source picker, Confluence target, status)"
```

---

## Task 52: Side panel — mode switch + ImportForm wiring

**Files:**
- Modify: `entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: Add the mode switch**

In `entrypoints/sidepanel/App.tsx`, wrap the existing export UI in a `mode === "export"` branch and add an `import` branch:

```tsx
import { useEffect, useState } from "react";
import { ImportForm } from "./ImportForm";
import { getSettings, saveSettings } from "@/storage/settings";

type Mode = "export" | "import";

export function App() {
  const [mode, setMode] = useState<Mode>("export");

  // Load saved mode
  useEffect(() => {
    getSettings().then((s) => {
      if (s?.defaults?.lastMode) setMode(s.defaults.lastMode);
    });
  }, []);

  async function setAndPersistMode(next: Mode) {
    setMode(next);
    const s = await getSettings();
    await saveSettings({
      ...s,
      defaults: { ...(s.defaults ?? {}), lastMode: next },
    });
  }

  return (
    <div className="app">
      <header>
        <h1>WikiBridge</h1>
        <div className="mode-switch">
          <button
            className={mode === "export" ? "active" : ""}
            onClick={() => setAndPersistMode("export")}
          >
            Export
          </button>
          <button
            className={mode === "import" ? "active" : ""}
            onClick={() => setAndPersistMode("import")}
          >
            Import
          </button>
        </div>
      </header>

      {mode === "export" ? (
        /* existing export UI — leave the existing JSX here unchanged */
        <ExportPanel />
      ) : (
        <ImportForm />
      )}
    </div>
  );
}

// Wrap the existing render block from the export plan in a function:
function ExportPanel() {
  // Move the existing App body here verbatim. No logic change.
  return <div>{/* existing export form */}</div>;
}
```

The export-plan App body is moved unchanged into `ExportPanel`. If the plan's existing App used hooks at the top level, those hooks move with it into `ExportPanel`.

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Build the extension and load it**

```bash
pnpm wxt build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add entrypoints/sidepanel/App.tsx
git commit -m "feat(sidepanel): Export/Import mode switch with ImportForm"
```

---

## Task 53: Manual smoke test for import

**Files:**
- Create: `docs/superpowers/specs/2026-06-09-import-smoke-checklist.md`

End-to-end verification using the real extension.

- [ ] **Step 1: Write the checklist**

Create `docs/superpowers/specs/2026-06-09-import-smoke-checklist.md`:

```markdown
# Import smoke-test checklist

Prereq: Confluence (email + API token) and Notion integration token configured in Options. Test space available where you can create pages.

## A. Local folder import

1. Open the side panel, switch to Import mode.
2. Source: Local. Click "Pick folder". Choose `tmp/group-1-common-infra---26q2-configuring-log-inspection-polic-20260601-0544` (or any other folder with one `.md` + `images/` + `attachments/`).
3. Destination: pick a test Space; leave Parent as `(space root)` (or pick a known parent).
4. Click "Import page".
5. Verify in Confluence:
   - New page created with the title from the markdown frontmatter.
   - Screenshot rendered inline from the page's attachments.
   - All `attachments/*.txt` links resolve to page attachments.
   - The wide table is preserved.
   - No HTML escaping leaks (no literal `&lt;` showing).

## B. Local single .md import

1. Pick the same folder's `README.md` via "Pick .md file" (without picking the folder).
2. Import.
3. Verify:
   - Page created with the frontmatter title.
   - Image refs show as alt-text placeholders (no attachments uploaded — folder-less mode).
   - Side-panel warning summary lists the missing assets.

## C. Notion page import

1. Source: Notion. Paste a Notion page URL that contains:
   - Two headings (h1 + h2)
   - A bulleted list and a numbered list
   - A code block with a language (e.g. python)
   - One callout of each colour (blue / yellow / green / red) — verifies info/warning/success/note mapping
   - One image
   - One PDF or file
2. Import.
3. Verify the rendered Confluence page matches the Notion source structure; assets appear inline; warning count is 0 (or shows the synced_block / column_list fallbacks if you included those).

## D. Error paths

1. Pick a folder that contains zero `.md` files → expect inline error before any network call.
2. Pick a folder that contains two `.md` files → expect inline error before any network call.
3. Disable the network briefly during upload (devtools throttling → offline) → confirm body PUT is skipped or fails cleanly and the summary message references the page URL with cleanup instructions.

Tick each box when verified. File any deviations as bugs against this plan.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-09-import-smoke-checklist.md
git commit -m "docs: import smoke-test checklist"
```

---

## Self-Review

### Spec coverage check

| Spec section | Covered by |
|---|---|
| Direction & Mode (Export | Import) | Task 50 (settings), Task 52 (App mode switch) |
| LocalSource — file mode | Tasks 37–42, esp. 42 |
| LocalSource — folder mode | Tasks 37–42, esp. 41 (asset collection) + 42 (rejection rules) |
| Frontmatter handling | Task 42 |
| Markdown dialect support matrix | Tasks 37–39 (paragraphs/lists/code/tables/images), 38 (task list), 37 (raw `<u>`) |
| External images in markdown | Task 39 (`ext:` prefix) and Task 34 (renderer) |
| Inline attachment ref (`Inline.attachmentRef`) | Task 28 (IR), Task 31/34 (renderer), Task 39 (parser) |
| NotionSource (single page, no children of `child_page`) | Tasks 43–46; `child_page` falls into the unsupported-block warning branch |
| Block mapping (incl. consecutive list grouping, to_do prefix, toggle/column flattening) | Task 43 |
| Notion callout colour → variant mapping | Task 43 + assertions in Task 44 |
| Notion inline rich-text marks + links + mention + equation | Task 43 (`richTextToInlines`) |
| Notion image/file lazy assets | Tasks 43, 46 |
| ConfluenceDestination — create empty page, upload assets, render body, PUT body | Task 36 |
| Storage format mapping (headings/paragraphs/lists/code/quote/callouts/tables/images/attachments/divider/links/marks/attachmentRef) | Tasks 31–34 |
| HTML safety (escape text/attr/CDATA, safeUrl, safeFilename) | Task 30, exercised in 31/32/34 |
| Asset map resolver | Task 36 (assemble), Tasks 31/34 (resolver consumption) |
| Page-create / PUT-body critical failure handling | Task 36 |
| Confluence write API (createPage / updatePageBody / uploadAttachment / listSpaces / listRootPages) | Task 35 |
| Messaging protocol additions | Task 47 |
| Orchestrator dispatch for import | Task 48 |
| Background worker handlers + handle-token registry | Task 49 |
| Side panel UI (mode switch, source picker, Confluence space/parent dropdowns, status) | Tasks 51, 52 |
| Service worker keep-alive | Reused from export plan; no new task |
| Testing strategy (vitest + MSW + in-memory FS polyfill) | Tasks 30–48 each with their test file; helper in Task 40 |
| Manual smoke test | Task 53 |

No gaps.

### Placeholder scan

Searched for "TBD", "TODO", "implement later", "Similar to Task" — none present.

### Type consistency

- `Source.fetchPage` signature: existing interface uses `fetchPage(pageId: string)`; the new sources accept `LocalSourceParams` / `NotionSourceParams`. Inconsistency. Resolution: `Source` interface as defined in the export plan is generic enough only if we widen the parameter type. The `LocalSource` and `NotionSource` impls declare `async fetchPage(params: X)` — TypeScript will accept this only if `Source<P>` is generic. The current export-plan `Source` is `fetchPage(pageId: string)`. To stay compatible: the orchestrator does not invoke them through the `Source` interface for import — `runImport` calls each concrete class directly (see Task 48). So the interface mismatch does not affect runtime; both classes implementing `Source` is a nominal-only claim. This is acceptable for v1 and noted explicitly here so a reviewer is not surprised.
- `ConfluenceDestination` implements `Destination` with the existing `publish(page, ctx)` signature — consistent.
- `assetResolver` returns `string | null` everywhere it's used (Tasks 31 / 34 / 36) — consistent.
- `Inline.attachmentRef` properties (`assetId`, `inlines`) consistent in IR (Task 28), parser (Task 39), and renderer (Task 31).

### Scope check

This plan is one direction's worth of work (import) on a single application. Tasks are bite-sized (each step is one action). Total: 27 tasks. Appropriate scope for a single plan.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-wiki-import.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
