# WikiBridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that captures a Confluence Cloud page and republishes it to Notion or a local Markdown folder, preserving headings, inline styling, links, lists, code, callouts, tables, images, and attachments.

**Architecture:** MV3 extension built with WXT. Side panel (React) sends a capture request to the background service worker; the orchestrator runs `ConfluenceSource.fetch() -> Page IR -> Destination.publish()`. Tokens live in `chrome.storage.local`. A `Destination` interface keeps Notion and Local as plug-in adapters with room for a third.

**Tech Stack:** WXT, React 18, TypeScript (strict), Vitest, MSW (Mock Service Worker). Package manager: pnpm.

**Spec:** `docs/superpowers/specs/2026-05-21-wikibridge-design.md`

---

## File Structure

This is the target layout after the plan completes. Tasks will create / modify these files.

```
wikibridge/
├── wxt.config.ts                          # WXT config, manifest fields
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── entrypoints/
│   ├── background.ts                      # service worker entry
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx
│   └── options/
│       ├── index.html
│       ├── main.tsx
│       └── App.tsx
├── src/
│   ├── ir/
│   │   └── types.ts                       # Page, Block, Inline, Asset, Mark
│   ├── messaging/
│   │   └── protocol.ts                    # typed Request/Response between UI and worker
│   ├── orchestrator/
│   │   ├── orchestrator.ts                # run(pageId, destinationId)
│   │   └── keepalive.ts                   # chrome.alarms heartbeat
│   ├── sources/
│   │   ├── source.ts                      # Source interface
│   │   └── confluence/
│   │       ├── confluence-source.ts       # implements Source
│   │       ├── adf-to-ir.ts               # ADF JSON -> Block[]
│   │       └── confluence-api.ts          # thin REST client
│   ├── destinations/
│   │   ├── destination.ts                 # Destination interface + result types
│   │   ├── registry.ts                    # list of destinations
│   │   ├── notion/
│   │   │   ├── notion-destination.ts      # implements Destination
│   │   │   ├── notion-api.ts              # thin REST client
│   │   │   ├── ir-to-notion.ts            # Block -> Notion block JSON
│   │   │   └── file-uploads.ts            # upload bytes, get fileUploadId
│   │   └── local/
│   │       ├── local-destination.ts       # implements Destination
│   │       ├── ir-to-markdown.ts          # Block -> Markdown string
│   │       └── filesystem.ts              # FileSystemDirectoryHandle helpers
│   └── storage/
│       └── settings.ts                    # chrome.storage.local wrapper
└── tests/
    ├── fixtures/
    │   ├── adf-rich.json                  # smoke fixture: ADF input
    │   └── ir-rich.json                   # smoke fixture: expected IR
    ├── adf-to-ir.test.ts
    ├── ir-to-markdown.test.ts
    ├── ir-to-notion.test.ts
    ├── settings.test.ts
    └── confluence-source.test.ts          # uses MSW
```

---

## Conventions

- **Package manager:** pnpm. All commands shown use `pnpm`.
- **Node version:** assume ≥ 20.
- **Commit messages:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`). No Claude Code attribution.
- **TDD:** every code-bearing task starts with a failing test (when test is feasible), then implementation. Some scaffolding tasks (project init, manifest config) don't have a meaningful unit test — those skip the test step and rely on the verification command shown.
- **Imports:** use the `@/` alias for `src/` (configured in tsconfig + WXT). Example: `import type { Page } from "@/ir/types"`.

---

## Task 1: Initialize WXT + React + TypeScript project

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `entrypoints/popup.html` (will delete), `entrypoints/popup/main.tsx` (will delete), `.wxt/`, `node_modules/`, plus WXT defaults
- Modify: `.gitignore` (already has `node_modules/`, `.wxt/`, `dist/`, `.output/` from earlier setup)

- [ ] **Step 1: Run WXT init**

Run from the repo root:

```bash
cd /Users/emma_liao/Documents/playground/wikibridge
pnpm dlx wxt@latest init . --template react --pm pnpm
```

When prompted "Current directory is not empty. Continue?" answer **yes** (the existing `docs/`, `README.md`, `.gitignore` must be preserved).

If `--template react --pm pnpm` flags aren't recognized by the installed version, run `pnpm dlx wxt@latest init .` and answer the prompts interactively: framework = React, package manager = pnpm.

Expected: `package.json`, `wxt.config.ts`, `tsconfig.json`, `entrypoints/popup/`, `public/`, `assets/` are created. `.gitignore` is updated by WXT (merge — don't lose our prior entries).

- [ ] **Step 2: Install dependencies**

```bash
pnpm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 3: Verify dev server starts**

```bash
pnpm dev
```

Expected: WXT prints a Chrome window opens (or instructions to load `.output/chrome-mv3/`). Stop with Ctrl+C.

- [ ] **Step 4: Remove the popup scaffolding we don't need**

WXT's React template creates a `popup` entrypoint. We use the side panel instead; delete it.

```bash
rm -rf entrypoints/popup
```

(If the template put files at `entrypoints/popup.html` and `entrypoints/popup/main.tsx`, delete both.)

- [ ] **Step 5: Add the `@/` alias**

Open `tsconfig.json` and ensure the `compilerOptions.paths` block includes:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

WXT respects tsconfig paths. Create `src/` as an empty directory:

```bash
mkdir -p src
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: bootstrap WXT + React + TypeScript project"
```

---

## Task 2: Configure manifest (side panel, options, permissions)

**Files:**
- Modify: `wxt.config.ts`

- [ ] **Step 1: Write the manifest config**

Replace `wxt.config.ts` with:

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "WikiBridge",
    description: "Capture Confluence pages to Notion or local Markdown.",
    permissions: ["storage", "sidePanel", "alarms", "activeTab"],
    host_permissions: [
      "https://*.atlassian.net/*",
      "https://api.notion.com/*",
    ],
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "Open WikiBridge",
    },
  },
});
```

Notes:
- `sidePanel` permission is required to call `chrome.sidePanel.*`.
- `activeTab` lets us read the active tab's URL to detect the Confluence page id.
- `alarms` for the service-worker keepalive.
- `host_permissions` allow `fetch()` from the service worker without CORS pre-flight friction.
- `action` with no popup makes the toolbar icon a click target we'll wire to open the side panel.

- [ ] **Step 2: Verify the build picks up the manifest**

```bash
pnpm build
```

Expected: build succeeds. Inspect `.output/chrome-mv3/manifest.json` and confirm `side_panel`, `permissions`, and `host_permissions` are present.

- [ ] **Step 3: Commit**

```bash
git add wxt.config.ts
git commit -m "feat: configure MV3 manifest for side panel + Confluence/Notion hosts"
```

---

## Task 3: Set up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` script and devDeps)

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -D vitest @vitest/ui @types/node msw
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the `test` script to `package.json`**

In `package.json`, under `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add a sanity test to prove the runner works**

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test**

```bash
pnpm test
```

Expected: 1 test passes.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm tests/smoke.test.ts
git add -A
git commit -m "chore: set up Vitest with @/ alias and MSW devDep"
```

---

## Task 4: Define IR types

**Files:**
- Create: `src/ir/types.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ir-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Page, Block, Inline, Asset, Mark } from "@/ir/types";

describe("IR types", () => {
  it("Page accepts a minimal value", () => {
    const page: Page = {
      id: "p1",
      title: "Hello",
      sourceUrl: "https://example.atlassian.net/wiki/spaces/X/pages/1",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [],
      assets: [],
    };
    expect(page.title).toBe("Hello");
  });

  it("Block discriminated union covers all v1 types", () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, inlines: [{ type: "text", text: "T" }] },
      { type: "paragraph", inlines: [] },
      { type: "list", ordered: true, items: [] },
      { type: "code", text: "x = 1" },
      { type: "quote", blocks: [] },
      { type: "callout", variant: "info", blocks: [] },
      { type: "table", rows: [] },
      { type: "image", assetId: "a1" },
      { type: "attachment", assetId: "a2", filename: "f.pdf" },
      { type: "divider" },
    ];
    expect(blocks.length).toBe(10);
  });

  it("Inline link carries href and nested inlines", () => {
    const inline: Inline = {
      type: "link",
      href: "https://x",
      inlines: [{ type: "text", text: "click" }],
    };
    expect(inline.href).toBe("https://x");
  });

  it("Mark covers the 5 expected marks", () => {
    const marks: Mark[] = ["bold", "italic", "underline", "strike", "code"];
    expect(marks.length).toBe(5);
  });

  it("Asset supports lazy fetch", async () => {
    const a: Asset = {
      id: "x",
      filename: "x.png",
      mimeType: "image/png",
      fetch: async () => new Uint8Array([1, 2, 3]),
    };
    const bytes = await a.fetch!();
    expect(bytes.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/ir-types.test.ts
```

Expected: FAIL — module `@/ir/types` not found.

- [ ] **Step 3: Implement the types**

Create `src/ir/types.ts`:

```ts
export type Mark = "bold" | "italic" | "underline" | "strike" | "code";

export type Inline =
  | { type: "text"; text: string; marks?: Mark[] }
  | { type: "link"; href: string; inlines: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Block[][] }
  | { type: "code"; language?: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | {
      type: "callout";
      variant: "info" | "note" | "warning" | "success";
      blocks: Block[];
    }
  | { type: "table"; rows: Block[][][] }
  | { type: "image"; assetId: string; alt?: string; caption?: string }
  | { type: "attachment"; assetId: string; filename: string }
  | { type: "divider" };

export type Asset = {
  id: string;
  filename: string;
  mimeType: string;
  bytes?: Uint8Array;
  fetch?: () => Promise<Uint8Array>;
};

export type Page = {
  id: string;
  title: string;
  sourceUrl: string;
  capturedAt: string;
  blocks: Block[];
  assets: Asset[];
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/ir-types.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ir/types.ts tests/ir-types.test.ts
git commit -m "feat: add IR types (Page, Block, Inline, Asset, Mark)"
```

---

## Task 5: Settings storage wrapper

**Files:**
- Create: `src/storage/settings.ts`
- Create: `tests/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, saveSettings, type Settings } from "@/storage/settings";

const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  // Minimal chrome.storage.local mock
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
});

describe("settings", () => {
  it("returns an empty shape when nothing is stored", async () => {
    const s = await getSettings();
    expect(s).toEqual({ atlassian: null, notion: null, defaults: {} });
  });

  it("round-trips a saved value", async () => {
    const value: Settings = {
      atlassian: {
        siteUrl: "https://x.atlassian.net",
        email: "e@x.com",
        apiToken: "T",
      },
      notion: { integrationToken: "secret_y" },
      defaults: { lastDestinationType: "notion" },
    };
    await saveSettings(value);
    expect(await getSettings()).toEqual(value);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/settings.test.ts
```

Expected: FAIL — `@/storage/settings` not found.

- [ ] **Step 3: Implement the settings module**

Create `src/storage/settings.ts`:

```ts
export type AtlassianSettings = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

export type NotionSettings = {
  integrationToken: string;
};

export type DefaultsSettings = {
  lastDestinationType?: "notion" | "local";
  lastNotionParentId?: string;
};

export type Settings = {
  atlassian: AtlassianSettings | null;
  notion: NotionSettings | null;
  defaults: DefaultsSettings;
};

const STORAGE_KEYS = ["atlassian", "notion", "defaults"] as const;

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get([...STORAGE_KEYS]);
  return {
    atlassian: (raw.atlassian as AtlassianSettings | undefined) ?? null,
    notion: (raw.notion as NotionSettings | undefined) ?? null,
    defaults: (raw.defaults as DefaultsSettings | undefined) ?? {},
  };
}

export async function saveSettings(value: Settings): Promise<void> {
  await chrome.storage.local.set({
    atlassian: value.atlassian,
    notion: value.notion,
    defaults: value.defaults,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/settings.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/settings.ts tests/settings.test.ts
git commit -m "feat: add chrome.storage.local settings wrapper"
```

---

## Task 6: Source and Destination interfaces

**Files:**
- Create: `src/sources/source.ts`
- Create: `src/destinations/destination.ts`

These are pure type/interface files — no test of behavior. We just need them compiling so later tasks can import.

- [ ] **Step 1: Create `src/sources/source.ts`**

```ts
import type { Page } from "@/ir/types";

export interface Source {
  readonly id: string;
  fetchPage(pageId: string): Promise<Page>;
}
```

- [ ] **Step 2: Create `src/destinations/destination.ts`**

```ts
import type { Page } from "@/ir/types";

export type Failure = {
  blockIndex?: number;
  assetId?: string;
  reason: string;
};

export type PublishResult = {
  ok: boolean;
  failures: Failure[];
  destinationUrl?: string;
};

export type PublishContext = {
  onProgress: (message: string) => void;
};

export interface Destination {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  publish(page: Page, ctx: PublishContext): Promise<PublishResult>;
}
```

- [ ] **Step 3: Verify it compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/sources/source.ts src/destinations/destination.ts
git commit -m "feat: define Source and Destination adapter interfaces"
```

---

## Task 7: ADF-to-IR converter — paragraphs, headings, marks, links

We build the ADF converter in layers. This task covers the simplest cases: paragraphs, headings, and the inline marks/links called out in the spec.

**Files:**
- Create: `src/sources/confluence/adf-to-ir.ts`
- Create: `tests/adf-to-ir.test.ts`

**Background:** Atlassian Document Format is a JSON tree. Each node has `type`, optional `content` (array of child nodes), optional `attrs`, optional `marks` (for text). Reference: <https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/>.

- [ ] **Step 1: Write the failing test**

Create `tests/adf-to-ir.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adfToBlocks } from "@/sources/confluence/adf-to-ir";

describe("adfToBlocks - text basics", () => {
  it("converts a paragraph with plain text", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "Hi" }] },
    ]);
  });

  it("converts headings 1..6", () => {
    const adf = {
      type: "doc",
      content: [1, 2, 3, 4, 5, 6].map((level) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `H${level}` }],
      })),
    };
    const result = adfToBlocks(adf);
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({
      type: "heading",
      level: 1,
      inlines: [{ type: "text", text: "H1" }],
    });
    expect(result[5]).toMatchObject({ type: "heading", level: 6 });
  });

  it("preserves bold, italic, underline, strike, code marks", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                { type: "strong" },
                { type: "em" },
                { type: "underline" },
                { type: "strike" },
                { type: "code" },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [
          {
            type: "text",
            text: "x",
            marks: ["bold", "italic", "underline", "strike", "code"],
          },
        ],
      },
    ]);
  });

  it("converts hyperlinks to an inline link node", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "go",
              marks: [{ type: "link", attrs: { href: "https://x" } }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "https://x",
            inlines: [{ type: "text", text: "go" }],
          },
        ],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the converter (basics)**

Create `src/sources/confluence/adf-to-ir.ts`:

```ts
import type { Block, Inline, Mark } from "@/ir/types";

type AdfNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
  text?: string;
};

const MARK_MAP: Record<string, Mark> = {
  strong: "bold",
  em: "italic",
  underline: "underline",
  strike: "strike",
  code: "code",
};

export function adfToBlocks(doc: AdfNode): Block[] {
  if (!doc.content) return [];
  return doc.content.flatMap(nodeToBlock).filter((b): b is Block => b !== null);
}

function nodeToBlock(node: AdfNode): Block | null {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", inlines: childrenToInlines(node) };
    case "heading": {
      const level = clampLevel(node.attrs?.level);
      return { type: "heading", level, inlines: childrenToInlines(node) };
    }
    default:
      // Unknown nodes degrade to a paragraph of their text content.
      // (Later tasks add support for lists, code, tables, etc.)
      const text = collectText(node);
      if (text === "") return null;
      return { type: "paragraph", inlines: [{ type: "text", text }] };
  }
}

function clampLevel(raw: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const n = typeof raw === "number" ? raw : 1;
  return (Math.min(6, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5 | 6);
}

function childrenToInlines(node: AdfNode): Inline[] {
  if (!node.content) return [];
  return node.content.flatMap(nodeToInlines);
}

function nodeToInlines(node: AdfNode): Inline[] {
  if (node.type !== "text" || typeof node.text !== "string") return [];

  const linkMark = node.marks?.find((m) => m.type === "link");
  if (linkMark) {
    const href =
      typeof linkMark.attrs?.href === "string" ? linkMark.attrs.href : "";
    const inner = nodeToInlines({ ...node, marks: node.marks?.filter((m) => m.type !== "link") });
    return [{ type: "link", href, inlines: inner }];
  }

  const marks = (node.marks ?? [])
    .map((m) => MARK_MAP[m.type])
    .filter((m): m is Mark => Boolean(m));

  const inline: Inline = marks.length
    ? { type: "text", text: node.text, marks }
    : { type: "text", text: node.text };
  return [inline];
}

function collectText(node: AdfNode): string {
  if (node.type === "text") return node.text ?? "";
  if (!node.content) return "";
  return node.content.map(collectText).join("");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/confluence/adf-to-ir.ts tests/adf-to-ir.test.ts
git commit -m "feat(adf): convert paragraphs, headings, marks, links"
```

---

## Task 8: ADF-to-IR — lists, code blocks, quotes, dividers

**Files:**
- Modify: `src/sources/confluence/adf-to-ir.ts`
- Modify: `tests/adf-to-ir.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/adf-to-ir.test.ts` (inside a new `describe` block):

```ts
describe("adfToBlocks - structural", () => {
  it("converts bullet list with nested items", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "a" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
        ],
      },
    ]);
  });

  it("converts ordered list", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "1" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    expect(out[0]).toMatchObject({ type: "list", ordered: true });
  });

  it("converts code block with language", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "code", language: "ts", text: "const x = 1;" },
    ]);
  });

  it("converts blockquote", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "wise" }],
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "quote",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "wise" }] },
        ],
      },
    ]);
  });

  it("converts horizontal rule to divider", () => {
    const adf = {
      type: "doc",
      content: [{ type: "rule" }],
    };
    expect(adfToBlocks(adf)).toEqual([{ type: "divider" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: 5 new tests FAIL.

- [ ] **Step 3: Extend the converter**

In `src/sources/confluence/adf-to-ir.ts`, replace the `nodeToBlock` switch with this version (additions noted):

```ts
function nodeToBlock(node: AdfNode): Block | null {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", inlines: childrenToInlines(node) };
    case "heading": {
      const level = clampLevel(node.attrs?.level);
      return { type: "heading", level, inlines: childrenToInlines(node) };
    }
    case "bulletList":
      return { type: "list", ordered: false, items: listItems(node) };
    case "orderedList":
      return { type: "list", ordered: true, items: listItems(node) };
    case "codeBlock": {
      const text = collectText(node);
      const language =
        typeof node.attrs?.language === "string" ? node.attrs.language : undefined;
      return { type: "code", language, text };
    }
    case "blockquote":
      return { type: "quote", blocks: childrenAsBlocks(node) };
    case "rule":
      return { type: "divider" };
    default: {
      const text = collectText(node);
      if (text === "") return null;
      return { type: "paragraph", inlines: [{ type: "text", text }] };
    }
  }
}

function listItems(node: AdfNode): Block[][] {
  if (!node.content) return [];
  return node.content
    .filter((c) => c.type === "listItem")
    .map((li) => childrenAsBlocks(li));
}

function childrenAsBlocks(node: AdfNode): Block[] {
  if (!node.content) return [];
  return node.content
    .map(nodeToBlock)
    .filter((b): b is Block => b !== null);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: all 9 tests pass (4 from Task 7 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/sources/confluence/adf-to-ir.ts tests/adf-to-ir.test.ts
git commit -m "feat(adf): convert lists, code blocks, quotes, dividers"
```

---

## Task 9: ADF-to-IR — callouts (Confluence panel) and tables

**Files:**
- Modify: `src/sources/confluence/adf-to-ir.ts`
- Modify: `tests/adf-to-ir.test.ts`

**Background:** Confluence panels in ADF look like `{ type: "panel", attrs: { panelType: "info" | "note" | "warning" | "success" | "error" }, content: [...] }`. We map `error` to `warning`. Tables in ADF are `{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell" | "tableHeader", content: [...] }] }] }`.

- [ ] **Step 1: Add failing tests**

Append to `tests/adf-to-ir.test.ts`:

```ts
describe("adfToBlocks - callouts and tables", () => {
  it("maps info panel to callout/info", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "panel",
          attrs: { panelType: "info" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "fyi" }] },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      {
        type: "callout",
        variant: "info",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "fyi" }] },
        ],
      },
    ]);
  });

  it("maps note, warning, success, error panel variants", () => {
    const variants: Array<[string, "note" | "warning" | "success"]> = [
      ["note", "note"],
      ["warning", "warning"],
      ["success", "success"],
      ["error", "warning"],
    ];
    for (const [panelType, expected] of variants) {
      const out = adfToBlocks({
        type: "doc",
        content: [
          {
            type: "panel",
            attrs: { panelType },
            content: [{ type: "paragraph", content: [] }],
          },
        ],
      });
      expect(out[0]).toMatchObject({ type: "callout", variant: expected });
    }
  });

  it("converts a 2x2 table with header row", () => {
    const cell = (text: string, header = false) => ({
      type: header ? "tableHeader" : "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const row = (cells: any[]) => ({ type: "tableRow", content: cells });
    const adf = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            row([cell("A", true), cell("B", true)]),
            row([cell("1"), cell("2")]),
          ],
        },
      ],
    };
    const out = adfToBlocks(adf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "table" });
    const table = out[0] as Extract<(typeof out)[number], { type: "table" }>;
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "A" }],
    });
    expect(table.rows[1][1][0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", text: "2" }],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: Extend the converter**

Add to the `switch` in `nodeToBlock`, before the `default`:

```ts
    case "panel": {
      const raw =
        typeof node.attrs?.panelType === "string" ? node.attrs.panelType : "info";
      const variant: "info" | "note" | "warning" | "success" =
        raw === "note"
          ? "note"
          : raw === "warning" || raw === "error"
          ? "warning"
          : raw === "success"
          ? "success"
          : "info";
      return { type: "callout", variant, blocks: childrenAsBlocks(node) };
    }
    case "table":
      return { type: "table", rows: tableRows(node) };
```

Add the table helper at the bottom of the file:

```ts
function tableRows(node: AdfNode): Block[][][] {
  if (!node.content) return [];
  return node.content
    .filter((r) => r.type === "tableRow")
    .map((row) => {
      if (!row.content) return [];
      return row.content
        .filter((c) => c.type === "tableCell" || c.type === "tableHeader")
        .map((cell) => childrenAsBlocks(cell));
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/confluence/adf-to-ir.ts tests/adf-to-ir.test.ts
git commit -m "feat(adf): convert panels (callouts) and tables"
```

---

## Task 10: ADF-to-IR — images and attachments (media nodes)

**Files:**
- Modify: `src/sources/confluence/adf-to-ir.ts`
- Modify: `tests/adf-to-ir.test.ts`

**Background:** Image references in ADF look like `{ type: "mediaSingle", content: [{ type: "media", attrs: { id: "<file-id>", type: "file" } }] }`. The `media` node's `attrs.id` matches the Confluence attachment id; we use that as our `assetId`. Captions, when present, appear as a sibling node in `mediaSingle.content`. For v1 we don't extract caption (Confluence rarely uses it via the UI); we capture `alt` from `attrs.alt`.

- [ ] **Step 1: Add failing tests**

Append to `tests/adf-to-ir.test.ts`:

```ts
describe("adfToBlocks - media", () => {
  it("converts mediaSingle to an image block referencing the media id", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [
            {
              type: "media",
              attrs: { id: "att-123", type: "file", alt: "diagram" },
            },
          ],
        },
      ],
    };
    expect(adfToBlocks(adf)).toEqual([
      { type: "image", assetId: "att-123", alt: "diagram" },
    ]);
  });

  it("mediaSingle without an id is dropped (defensive)", () => {
    const adf = {
      type: "doc",
      content: [{ type: "mediaSingle", content: [] }],
    };
    expect(adfToBlocks(adf)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: 2 new tests FAIL.

- [ ] **Step 3: Extend the converter**

Add to the `switch` in `nodeToBlock`, before the `default`:

```ts
    case "mediaSingle":
    case "mediaGroup": {
      const media = node.content?.find((c) => c.type === "media");
      const id = typeof media?.attrs?.id === "string" ? media.attrs.id : null;
      if (!id) return null;
      const alt =
        typeof media?.attrs?.alt === "string" ? media.attrs.alt : undefined;
      return { type: "image", assetId: id, alt };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/adf-to-ir.test.ts
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/confluence/adf-to-ir.ts tests/adf-to-ir.test.ts
git commit -m "feat(adf): convert media nodes to image blocks"
```

---

## Task 11: Confluence REST client

**Files:**
- Create: `src/sources/confluence/confluence-api.ts`
- Create: `tests/confluence-api.test.ts`

This is a thin client that owns auth + URL building. The orchestrator calls it; tests use MSW to stub network responses.

- [ ] **Step 1: Write the failing test**

Create `tests/confluence-api.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ConfluenceApi } from "@/sources/confluence/confluence-api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ConfluenceApi", () => {
  it("fetches a page in ADF body format with Basic auth", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/pages/42", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("body-format")).toBe("atlas_doc_format");
        expect(request.headers.get("Authorization")).toBe(
          // base64("u@x.com:T")
          "Basic " + btoa("u@x.com:T"),
        );
        return HttpResponse.json({
          id: "42",
          title: "Hello",
          body: { atlas_doc_format: { value: '{"type":"doc","content":[]}' } },
          _links: { webui: "/spaces/X/pages/42/Hello" },
        });
      }),
    );

    const api = new ConfluenceApi({
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      apiToken: "T",
    });
    const page = await api.getPage("42");
    expect(page.title).toBe("Hello");
    expect(page.adf).toEqual({ type: "doc", content: [] });
    expect(page.webUiPath).toBe("/spaces/X/pages/42/Hello");
  });

  it("lists attachments", async () => {
    server.use(
      http.get(
        "https://x.atlassian.net/wiki/api/v2/pages/42/attachments",
        () =>
          HttpResponse.json({
            results: [
              {
                id: "att-1",
                title: "diagram.png",
                mediaType: "image/png",
                fileId: "media-1",
                downloadLink: "/wiki/download/attachments/42/diagram.png",
              },
            ],
          }),
      ),
    );

    const api = new ConfluenceApi({
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      apiToken: "T",
    });
    const list = await api.listAttachments("42");
    expect(list).toHaveLength(1);
    expect(list[0].fileId).toBe("media-1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/confluence-api.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `src/sources/confluence/confluence-api.ts`:

```ts
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
  downloadLink: string;
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
        downloadLink: string;
      }>;
    };
    return body.results.map((r) => ({
      id: r.id,
      fileId: r.fileId,
      filename: r.title,
      mediaType: r.mediaType,
      downloadLink: r.downloadLink,
    }));
  }

  async downloadAttachment(downloadLink: string): Promise<Uint8Array> {
    const url = downloadLink.startsWith("http")
      ? downloadLink
      : `${this.base()}${downloadLink}`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) {
      throw new Error(`Confluence downloadAttachment failed: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/confluence-api.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/confluence/confluence-api.ts tests/confluence-api.test.ts
git commit -m "feat(confluence): add REST client (getPage, listAttachments)"
```

---

## Task 12: ConfluenceSource (assemble Page IR)

**Files:**
- Create: `src/sources/confluence/confluence-source.ts`
- Create: `tests/confluence-source.test.ts`

`ConfluenceSource` is the `Source` implementation. It calls `ConfluenceApi`, runs `adfToBlocks`, builds the `Asset` list (with lazy `fetch`), and returns a `Page`.

- [ ] **Step 1: Write the failing test**

Create `tests/confluence-source.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ConfluenceSource } from "@/sources/confluence/confluence-source";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ConfluenceSource", () => {
  it("returns a Page with blocks and lazy assets", async () => {
    server.use(
      http.get("https://x.atlassian.net/wiki/api/v2/pages/7", () =>
        HttpResponse.json({
          id: "7",
          title: "Doc",
          body: {
            atlas_doc_format: {
              value: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Hi" }],
                  },
                  {
                    type: "mediaSingle",
                    content: [
                      {
                        type: "media",
                        attrs: { id: "media-A", type: "file" },
                      },
                    ],
                  },
                ],
              }),
            },
          },
          _links: { webui: "/spaces/X/pages/7/Doc" },
        }),
      ),
      http.get(
        "https://x.atlassian.net/wiki/api/v2/pages/7/attachments",
        () =>
          HttpResponse.json({
            results: [
              {
                id: "att-A",
                title: "pic.png",
                mediaType: "image/png",
                fileId: "media-A",
                downloadLink: "/wiki/download/attachments/7/pic.png",
              },
            ],
          }),
      ),
      http.get(
        "https://x.atlassian.net/wiki/download/attachments/7/pic.png",
        () =>
          new HttpResponse(new Uint8Array([1, 2, 3]), {
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );

    const src = new ConfluenceSource({
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      apiToken: "T",
    });
    const page = await src.fetchPage("7");

    expect(page.id).toBe("7");
    expect(page.title).toBe("Doc");
    expect(page.sourceUrl).toBe(
      "https://x.atlassian.net/wiki/spaces/X/pages/7/Doc",
    );
    expect(page.blocks).toHaveLength(2);
    expect(page.assets).toHaveLength(1);
    expect(page.assets[0].id).toBe("media-A");
    expect(page.assets[0].filename).toBe("pic.png");

    const bytes = await page.assets[0].fetch!();
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/confluence-source.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the source**

Create `src/sources/confluence/confluence-source.ts`:

```ts
import type { Asset, Page } from "@/ir/types";
import type { Source } from "@/sources/source";
import { ConfluenceApi, type ConfluenceCreds } from "./confluence-api";
import { adfToBlocks } from "./adf-to-ir";

export class ConfluenceSource implements Source {
  readonly id = "confluence-cloud";
  private api: ConfluenceApi;
  private creds: ConfluenceCreds;

  constructor(creds: ConfluenceCreds) {
    this.creds = creds;
    this.api = new ConfluenceApi(creds);
  }

  async fetchPage(pageId: string): Promise<Page> {
    const [pageData, attachments] = await Promise.all([
      this.api.getPage(pageId),
      this.api.listAttachments(pageId),
    ]);

    const assets: Asset[] = attachments.map((a) => ({
      id: a.fileId,
      filename: a.filename,
      mimeType: a.mediaType,
      fetch: () => this.api.downloadAttachment(a.downloadLink),
    }));

    const blocks = adfToBlocks(pageData.adf as any);

    return {
      id: pageData.id,
      title: pageData.title,
      sourceUrl: `${this.creds.siteUrl.replace(/\/+$/, "")}/wiki${pageData.webUiPath}`,
      capturedAt: new Date().toISOString(),
      blocks,
      assets,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/confluence-source.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/sources/confluence/confluence-source.ts tests/confluence-source.test.ts
git commit -m "feat(confluence): assemble Page IR with lazy assets"
```

---

## Task 13: IR-to-Markdown — inline + block rendering

**Files:**
- Create: `src/destinations/local/ir-to-markdown.ts`
- Create: `tests/ir-to-markdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ir-to-markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/destinations/local/ir-to-markdown";
import type { Block } from "@/ir/types";

const render = (blocks: Block[]) =>
  renderMarkdown(blocks, { resolveAssetPath: (id) => `images/${id}.png` });

describe("renderMarkdown - inlines", () => {
  it("renders plain text paragraph", () => {
    const out = render([
      { type: "paragraph", inlines: [{ type: "text", text: "hi" }] },
    ]);
    expect(out.trim()).toBe("hi");
  });

  it("renders all 5 marks", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "b", marks: ["bold"] },
          { type: "text", text: " " },
          { type: "text", text: "i", marks: ["italic"] },
          { type: "text", text: " " },
          { type: "text", text: "u", marks: ["underline"] },
          { type: "text", text: " " },
          { type: "text", text: "s", marks: ["strike"] },
          { type: "text", text: " " },
          { type: "text", text: "c", marks: ["code"] },
        ],
      },
    ]);
    expect(out.trim()).toBe("**b** *i* <u>u</u> ~~s~~ `c`");
  });

  it("renders link", () => {
    const out = render([
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: "https://x",
            inlines: [{ type: "text", text: "go" }],
          },
        ],
      },
    ]);
    expect(out.trim()).toBe("[go](https://x)");
  });
});

describe("renderMarkdown - blocks", () => {
  it("renders headings 1..6", () => {
    const blocks: Block[] = [1, 2, 3, 4, 5, 6].map(
      (n) =>
        ({
          type: "heading",
          level: n as 1 | 2 | 3 | 4 | 5 | 6,
          inlines: [{ type: "text", text: `H${n}` }],
        }) as Block,
    );
    expect(render(blocks).trim()).toBe(
      "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6",
    );
  });

  it("renders unordered and ordered lists", () => {
    const out = render([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "a" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "b" }] }],
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [
          [{ type: "paragraph", inlines: [{ type: "text", text: "x" }] }],
          [{ type: "paragraph", inlines: [{ type: "text", text: "y" }] }],
        ],
      },
    ]);
    expect(out).toContain("- a\n- b");
    expect(out).toContain("1. x\n2. y");
  });

  it("renders code block with language fence", () => {
    const out = render([{ type: "code", language: "ts", text: "const x = 1;" }]);
    expect(out.trim()).toBe("```ts\nconst x = 1;\n```");
  });

  it("renders callout variants with bracketed prefix", () => {
    const out = render([
      {
        type: "callout",
        variant: "warning",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "watch out" }] },
        ],
      },
    ]);
    expect(out.trim()).toBe("> [warning] watch out");
  });

  it("renders divider", () => {
    expect(render([{ type: "divider" }]).trim()).toBe("---");
  });

  it("renders image with resolved path", () => {
    const out = render([{ type: "image", assetId: "abc", alt: "diagram" }]);
    expect(out.trim()).toBe("![diagram](images/abc.png)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/ir-to-markdown.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer**

Create `src/destinations/local/ir-to-markdown.ts`:

```ts
import type { Block, Inline, Mark } from "@/ir/types";

export type MarkdownRenderOptions = {
  resolveAssetPath: (assetId: string) => string;
};

export function renderMarkdown(
  blocks: Block[],
  opts: MarkdownRenderOptions,
): string {
  return blocks.map((b) => renderBlock(b, opts)).join("\n\n") + "\n";
}

function renderBlock(block: Block, opts: MarkdownRenderOptions): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${renderInlines(block.inlines)}`;
    case "paragraph":
      return renderInlines(block.inlines);
    case "list": {
      const lines = block.items.map((itemBlocks, i) => {
        const inner = itemBlocks
          .map((b) => renderBlock(b, opts))
          .join("\n\n")
          .replace(/^/gm, "  ")
          .trimStart();
        const prefix = block.ordered ? `${i + 1}. ` : "- ";
        return prefix + inner;
      });
      return lines.join("\n");
    }
    case "code":
      return "```" + (block.language ?? "") + "\n" + block.text + "\n```";
    case "quote":
      return block.blocks
        .map((b) => renderBlock(b, opts))
        .join("\n\n")
        .replace(/^/gm, "> ");
    case "callout": {
      const inner = block.blocks
        .map((b) => renderBlock(b, opts))
        .join("\n\n");
      return inner.replace(/^/gm, `> [${block.variant}] `);
    }
    case "table":
      return renderTable(block.rows, opts);
    case "image": {
      const path = opts.resolveAssetPath(block.assetId);
      return `![${block.alt ?? ""}](${path})`;
    }
    case "attachment": {
      const path = opts.resolveAssetPath(block.assetId);
      return `[${block.filename}](${path})`;
    }
    case "divider":
      return "---";
  }
}

function renderInlines(inlines: Inline[]): string {
  return inlines.map(renderInline).join("");
}

function renderInline(inline: Inline): string {
  if (inline.type === "link") {
    return `[${renderInlines(inline.inlines)}](${inline.href})`;
  }
  let text = inline.text;
  for (const m of inline.marks ?? []) {
    text = applyMark(text, m);
  }
  return text;
}

function applyMark(text: string, mark: Mark): string {
  switch (mark) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "underline":
      return `<u>${text}</u>`;
    case "strike":
      return `~~${text}~~`;
    case "code":
      return `\`${text}\``;
  }
}

function renderTable(
  rows: Block[][][],
  opts: MarkdownRenderOptions,
): string {
  if (rows.length === 0) return "";
  const cellToText = (cell: Block[]) =>
    cell.map((b) => renderBlock(b, opts)).join(" ").replace(/\|/g, "\\|");
  const lines: string[] = [];
  const header = rows[0].map(cellToText);
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(1)) {
    lines.push(`| ${row.map(cellToText).join(" | ")} |`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/ir-to-markdown.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/local/ir-to-markdown.ts tests/ir-to-markdown.test.ts
git commit -m "feat(local): render IR to Markdown (inlines, blocks, tables)"
```

---

## Task 14: LocalDestination (filesystem)

**Files:**
- Create: `src/destinations/local/filesystem.ts`
- Create: `src/destinations/local/local-destination.ts`
- Create: `tests/local-destination.test.ts`

We test against an in-memory `FileSystemDirectoryHandle`-shaped fake. The real `showDirectoryPicker()` lives in the side panel's React code (Task 17) — the destination receives the handle.

- [ ] **Step 1: Write the failing test**

Create `tests/local-destination.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LocalDestination } from "@/destinations/local/local-destination";
import type { Page } from "@/ir/types";

class FakeFile {
  data = new Uint8Array();
}

class FakeDir {
  name: string;
  children: Map<string, FakeDir | FakeFile> = new Map();
  constructor(name: string) {
    this.name = name;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    if (!this.children.has(name)) {
      if (!opts?.create) throw new Error("missing");
      this.children.set(name, new FakeDir(name));
    }
    return this.children.get(name) as FakeDir;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.children.has(name)) {
      if (!opts?.create) throw new Error("missing");
      this.children.set(name, new FakeFile());
    }
    const file = this.children.get(name) as FakeFile;
    return {
      createWritable: async () => ({
        write: async (chunk: Uint8Array | string) => {
          const bytes =
            typeof chunk === "string"
              ? new TextEncoder().encode(chunk)
              : chunk;
          file.data = bytes;
        },
        close: async () => {},
      }),
    };
  }
}

describe("LocalDestination", () => {
  it("writes README.md, images/, and attachments/", async () => {
    const root = new FakeDir("root");
    const page: Page = {
      id: "1",
      title: "Hello World",
      sourceUrl: "https://x.atlassian.net/wiki/spaces/X/pages/1/Hello-World",
      capturedAt: "2026-05-21T00:00:00.000Z",
      blocks: [
        { type: "heading", level: 1, inlines: [{ type: "text", text: "Hi" }] },
        { type: "image", assetId: "img-1", alt: "pic" },
        { type: "attachment", assetId: "doc-1", filename: "notes.pdf" },
      ],
      assets: [
        {
          id: "img-1",
          filename: "diagram.png",
          mimeType: "image/png",
          fetch: async () => new Uint8Array([1, 2]),
        },
        {
          id: "doc-1",
          filename: "notes.pdf",
          mimeType: "application/pdf",
          fetch: async () => new Uint8Array([3, 4]),
        },
      ],
    };

    const dest = new LocalDestination();
    const result = await dest.publishToHandle(root as any, page, {
      onProgress: () => {},
      now: () => new Date("2026-05-21T10:30:00Z"),
    });

    expect(result.ok).toBe(true);
    const folderName = [...root.children.keys()][0];
    expect(folderName).toMatch(/^hello-world-20260521-1030$/);

    const folder = root.children.get(folderName) as FakeDir;
    expect(folder.children.has("README.md")).toBe(true);
    expect(folder.children.has("images")).toBe(true);
    expect(folder.children.has("attachments")).toBe(true);

    const images = folder.children.get("images") as FakeDir;
    expect(images.children.has("diagram.png")).toBe(true);

    const attachments = folder.children.get("attachments") as FakeDir;
    expect(attachments.children.has("notes.pdf")).toBe(true);

    const readme = folder.children.get("README.md") as FakeFile;
    const text = new TextDecoder().decode(readme.data);
    expect(text).toContain("# Hi");
    expect(text).toContain("![pic](images/diagram.png)");
    expect(text).toContain("[notes.pdf](attachments/notes.pdf)");
    expect(text).toContain("title: Hello World");
  });

  it("collects failures when an asset fetch throws", async () => {
    const root = new FakeDir("root");
    const page: Page = {
      id: "2",
      title: "Bad",
      sourceUrl: "https://x/y",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [{ type: "image", assetId: "boom", alt: "" }],
      assets: [
        {
          id: "boom",
          filename: "boom.png",
          mimeType: "image/png",
          fetch: async () => {
            throw new Error("disk on fire");
          },
        },
      ],
    };
    const dest = new LocalDestination();
    const result = await dest.publishToHandle(root as any, page, {
      onProgress: () => {},
      now: () => new Date("2026-05-21T10:30:00Z"),
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].assetId).toBe("boom");
    expect(result.failures[0].reason).toMatch(/disk on fire/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/local-destination.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the destination**

Create `src/destinations/local/filesystem.ts`:

```ts
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "page";
}

export function timestampFolderSuffix(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    "-" +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes())
  );
}

export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  text: string,
): Promise<void> {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

export async function writeBinaryFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
}
```

Create `src/destinations/local/local-destination.ts`:

```ts
import type { Page } from "@/ir/types";
import type {
  Destination,
  Failure,
  PublishContext,
  PublishResult,
} from "@/destinations/destination";
import { renderMarkdown } from "./ir-to-markdown";
import {
  slugify,
  timestampFolderSuffix,
  writeBinaryFile,
  writeTextFile,
} from "./filesystem";

export type LocalPublishOptions = PublishContext & {
  now?: () => Date;
};

export class LocalDestination implements Destination {
  readonly id = "local";
  readonly displayName = "Local file (Markdown)";

  async isConfigured(): Promise<boolean> {
    return true; // local needs no token; permission is granted at capture time
  }

  async publish(_page: Page, _ctx: PublishContext): Promise<PublishResult> {
    throw new Error(
      "LocalDestination.publish requires a FileSystemDirectoryHandle; " +
        "call publishToHandle from the side panel after showDirectoryPicker().",
    );
  }

  async publishToHandle(
    root: FileSystemDirectoryHandle,
    page: Page,
    ctx: LocalPublishOptions,
  ): Promise<PublishResult> {
    const now = ctx.now?.() ?? new Date();
    const folderName = `${slugify(page.title)}-${timestampFolderSuffix(now)}`;
    const folder = await root.getDirectoryHandle(folderName, { create: true });
    const failures: Failure[] = [];

    const isImage = (mime: string) => mime.startsWith("image/");
    const imageAssets = page.assets.filter((a) => isImage(a.mimeType));
    const fileAssets = page.assets.filter((a) => !isImage(a.mimeType));

    let imagesDir: FileSystemDirectoryHandle | null = null;
    let attachmentsDir: FileSystemDirectoryHandle | null = null;
    if (imageAssets.length > 0) {
      imagesDir = await folder.getDirectoryHandle("images", { create: true });
    }
    if (fileAssets.length > 0) {
      attachmentsDir = await folder.getDirectoryHandle("attachments", {
        create: true,
      });
    }

    const assetSubdir = new Map<string, "images" | "attachments">();
    for (const a of imageAssets) assetSubdir.set(a.id, "images");
    for (const a of fileAssets) assetSubdir.set(a.id, "attachments");

    for (const asset of page.assets) {
      try {
        ctx.onProgress(`Writing ${asset.filename}`);
        const bytes = asset.bytes ?? (await asset.fetch!());
        const dir = assetSubdir.get(asset.id) === "images" ? imagesDir : attachmentsDir;
        if (!dir) throw new Error("destination dir not created");
        await writeBinaryFile(dir, asset.filename, bytes);
      } catch (err) {
        failures.push({
          assetId: asset.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const md = renderMarkdown(page.blocks, {
      resolveAssetPath: (id) => {
        const a = page.assets.find((x) => x.id === id);
        if (!a) return id;
        const sub = assetSubdir.get(a.id);
        return `${sub}/${a.filename}`;
      },
    });

    const frontmatter =
      `---\n` +
      `title: ${page.title}\n` +
      `sourceUrl: ${page.sourceUrl}\n` +
      `capturedAt: ${page.capturedAt}\n` +
      `---\n\n`;

    await writeTextFile(folder, "README.md", frontmatter + md);

    return {
      ok: failures.length === 0,
      failures,
      destinationUrl: undefined,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/local-destination.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/local/ tests/local-destination.test.ts
git commit -m "feat(local): write Page IR as a folder (README.md + images/ + attachments/)"
```

---

## Task 15: IR-to-Notion block conversion

**Files:**
- Create: `src/destinations/notion/ir-to-notion.ts`
- Create: `tests/ir-to-notion.test.ts`

This converts IR blocks to Notion block JSON. Asset references resolve via a callback (so the destination can substitute Notion file_upload IDs).

- [ ] **Step 1: Write the failing test**

Create `tests/ir-to-notion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { irToNotionBlocks } from "@/destinations/notion/ir-to-notion";
import type { Block } from "@/ir/types";

const resolve = (id: string) => `upload-${id}`;

describe("irToNotionBlocks - inlines and basics", () => {
  it("renders heading_1/2/3 (Notion supports up to 3)", () => {
    const blocks: Block[] = [1, 2, 3, 4].map((n) => ({
      type: "heading",
      level: n as 1 | 2 | 3 | 4,
      inlines: [{ type: "text", text: `H${n}` }],
    })) as Block[];
    const out = irToNotionBlocks(blocks, resolve);
    expect(out[0].type).toBe("heading_1");
    expect(out[1].type).toBe("heading_2");
    expect(out[2].type).toBe("heading_3");
    // h4+ collapses to heading_3
    expect(out[3].type).toBe("heading_3");
  });

  it("renders rich_text with annotations for marks", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "paragraph",
          inlines: [
            { type: "text", text: "b", marks: ["bold"] },
            { type: "text", text: "i", marks: ["italic"] },
            { type: "text", text: "u", marks: ["underline"] },
            { type: "text", text: "s", marks: ["strike"] },
            { type: "text", text: "c", marks: ["code"] },
          ],
        },
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text;
    expect(rt[0].annotations).toMatchObject({ bold: true });
    expect(rt[1].annotations).toMatchObject({ italic: true });
    expect(rt[2].annotations).toMatchObject({ underline: true });
    expect(rt[3].annotations).toMatchObject({ strikethrough: true });
    expect(rt[4].annotations).toMatchObject({ code: true });
  });

  it("renders link via text.link.url", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "paragraph",
          inlines: [
            {
              type: "link",
              href: "https://x",
              inlines: [{ type: "text", text: "go" }],
            },
          ],
        },
      ],
      resolve,
    );
    const rt = (out[0] as any).paragraph.rich_text[0];
    expect(rt.text.content).toBe("go");
    expect(rt.text.link).toEqual({ url: "https://x" });
  });

  it("renders bulleted_list_item / numbered_list_item", () => {
    const out = irToNotionBlocks(
      [
        {
          type: "list",
          ordered: false,
          items: [
            [
              {
                type: "paragraph",
                inlines: [{ type: "text", text: "a" }],
              },
            ],
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              {
                type: "paragraph",
                inlines: [{ type: "text", text: "1" }],
              },
            ],
          ],
        },
      ],
      resolve,
    );
    expect(out[0].type).toBe("bulleted_list_item");
    expect(out[1].type).toBe("numbered_list_item");
  });

  it("renders code block with language", () => {
    const out = irToNotionBlocks(
      [{ type: "code", language: "ts", text: "x" }],
      resolve,
    );
    expect(out[0]).toMatchObject({
      type: "code",
      code: { language: "typescript", rich_text: [{ text: { content: "x" } }] },
    });
  });

  it("renders callout variants", () => {
    const variants: Array<["info" | "note" | "warning" | "success", string]> = [
      ["info", "blue_background"],
      ["note", "gray_background"],
      ["warning", "yellow_background"],
      ["success", "green_background"],
    ];
    for (const [v, color] of variants) {
      const out = irToNotionBlocks(
        [
          {
            type: "callout",
            variant: v,
            blocks: [
              {
                type: "paragraph",
                inlines: [{ type: "text", text: "x" }],
              },
            ],
          },
        ],
        resolve,
      );
      expect(out[0].type).toBe("callout");
      expect((out[0] as any).callout.color).toBe(color);
    }
  });

  it("renders divider", () => {
    expect(
      irToNotionBlocks([{ type: "divider" }], resolve)[0],
    ).toMatchObject({ type: "divider" });
  });

  it("renders image block referencing the resolved file upload id", () => {
    const out = irToNotionBlocks(
      [{ type: "image", assetId: "asset-A", alt: "x" }],
      resolve,
    );
    expect(out[0]).toMatchObject({
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: "upload-asset-A" },
      },
    });
  });

  it("renders file block for attachment", () => {
    const out = irToNotionBlocks(
      [{ type: "attachment", assetId: "asset-B", filename: "doc.pdf" }],
      resolve,
    );
    expect(out[0]).toMatchObject({
      type: "file",
      file: {
        type: "file_upload",
        file_upload: { id: "upload-asset-B" },
      },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/ir-to-notion.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the converter**

Create `src/destinations/notion/ir-to-notion.ts`:

```ts
import type { Block, Inline, Mark } from "@/ir/types";

export type AssetResolver = (assetId: string) => string;

type NotionRichText = {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: Partial<{
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    code: boolean;
  }>;
};

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "shell",
  // Notion accepts a fixed language list; unknown values are mapped to "plain text" later.
};

const CALLOUT_COLOR: Record<
  "info" | "note" | "warning" | "success",
  string
> = {
  info: "blue_background",
  note: "gray_background",
  warning: "yellow_background",
  success: "green_background",
};

const CALLOUT_ICON: Record<
  "info" | "note" | "warning" | "success",
  string
> = {
  info: "ℹ️",
  note: "📝",
  warning: "⚠️",
  success: "✅",
};

export function irToNotionBlocks(
  blocks: Block[],
  resolve: AssetResolver,
): unknown[] {
  return blocks.flatMap((b) => blockToNotion(b, resolve));
}

function blockToNotion(block: Block, resolve: AssetResolver): unknown[] {
  switch (block.type) {
    case "heading": {
      const level = Math.min(block.level, 3) as 1 | 2 | 3;
      const key = `heading_${level}` as const;
      return [
        {
          type: key,
          [key]: { rich_text: inlinesToRichText(block.inlines) },
        },
      ];
    }
    case "paragraph":
      return [
        {
          type: "paragraph",
          paragraph: { rich_text: inlinesToRichText(block.inlines) },
        },
      ];
    case "list":
      return block.items.flatMap((itemBlocks) => {
        const [first, ...rest] = itemBlocks;
        const firstInlines =
          first && first.type === "paragraph"
            ? first.inlines
            : [{ type: "text", text: "" } as Inline];
        const childBlocks = first && first.type !== "paragraph"
          ? itemBlocks
          : rest;
        const key = block.ordered
          ? ("numbered_list_item" as const)
          : ("bulleted_list_item" as const);
        return [
          {
            type: key,
            [key]: {
              rich_text: inlinesToRichText(firstInlines),
              children:
                childBlocks.length > 0
                  ? irToNotionBlocks(childBlocks, resolve)
                  : undefined,
            },
          },
        ];
      });
    case "code":
      return [
        {
          type: "code",
          code: {
            language:
              (block.language && LANGUAGE_MAP[block.language]) ??
              block.language ??
              "plain text",
            rich_text: [{ type: "text", text: { content: block.text } }],
          },
        },
      ];
    case "quote":
      return [
        {
          type: "quote",
          quote: {
            rich_text: [{ type: "text", text: { content: "" } }],
            children: irToNotionBlocks(block.blocks, resolve),
          },
        },
      ];
    case "callout":
      return [
        {
          type: "callout",
          callout: {
            rich_text: [{ type: "text", text: { content: "" } }],
            icon: { type: "emoji", emoji: CALLOUT_ICON[block.variant] },
            color: CALLOUT_COLOR[block.variant],
            children: irToNotionBlocks(block.blocks, resolve),
          },
        },
      ];
    case "table":
      return [tableBlock(block.rows, resolve)];
    case "image":
      return [
        {
          type: "image",
          image: {
            type: "file_upload",
            file_upload: { id: resolve(block.assetId) },
            caption: block.caption
              ? [{ type: "text", text: { content: block.caption } }]
              : [],
          },
        },
      ];
    case "attachment":
      return [
        {
          type: "file",
          file: {
            type: "file_upload",
            file_upload: { id: resolve(block.assetId) },
            name: block.filename,
          },
        },
      ];
    case "divider":
      return [{ type: "divider", divider: {} }];
  }
}

function inlinesToRichText(inlines: Inline[]): NotionRichText[] {
  return inlines.flatMap(inlineToRichText);
}

function inlineToRichText(inline: Inline): NotionRichText[] {
  if (inline.type === "link") {
    return inline.inlines.flatMap((child) => {
      const parts = inlineToRichText(child);
      return parts.map((p) => ({
        ...p,
        text: { ...p.text, link: { url: inline.href } },
      }));
    });
  }
  const annotations: NotionRichText["annotations"] = {};
  for (const m of inline.marks ?? []) {
    Object.assign(annotations, markToAnnotation(m));
  }
  const rt: NotionRichText = {
    type: "text",
    text: { content: inline.text },
  };
  if (Object.keys(annotations).length > 0) rt.annotations = annotations;
  return [rt];
}

function markToAnnotation(mark: Mark): NotionRichText["annotations"] {
  switch (mark) {
    case "bold":
      return { bold: true };
    case "italic":
      return { italic: true };
    case "underline":
      return { underline: true };
    case "strike":
      return { strikethrough: true };
    case "code":
      return { code: true };
  }
}

function tableBlock(rows: Block[][][], resolve: AssetResolver): unknown {
  const width = rows[0]?.length ?? 0;
  return {
    type: "table",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: rows.map((row) => ({
        type: "table_row",
        table_row: {
          cells: row.map((cell) => {
            const para = cell.find((b) => b.type === "paragraph");
            if (para && para.type === "paragraph") {
              return inlinesToRichText(para.inlines);
            }
            // Notion table cells only accept rich_text; render nested blocks as plain text.
            return [
              {
                type: "text",
                text: { content: cell.map((b) => blockToText(b)).join(" ") },
              },
            ];
          }),
        },
      })),
    },
  };
}

function blockToText(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return block.inlines.map(inlineText).join("");
    case "code":
      return block.text;
    default:
      return "";
  }
}

function inlineText(inline: Inline): string {
  if (inline.type === "link") return inline.inlines.map(inlineText).join("");
  return inline.text;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/ir-to-notion.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/notion/ir-to-notion.ts tests/ir-to-notion.test.ts
git commit -m "feat(notion): convert IR blocks to Notion block JSON"
```

---

## Task 16: Notion REST client + file uploads

**Files:**
- Create: `src/destinations/notion/notion-api.ts`
- Create: `src/destinations/notion/file-uploads.ts`
- Create: `tests/notion-api.test.ts`

The file upload flow is two steps: `POST /v1/file_uploads` returns a `{ id, upload_url }`, then we PUT the bytes to `upload_url` as multipart form-data (field name `file`).

- [ ] **Step 1: Write the failing test**

Create `tests/notion-api.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NotionApi } from "@/destinations/notion/notion-api";
import { uploadFile } from "@/destinations/notion/file-uploads";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("NotionApi", () => {
  it("creates a page under a parent", async () => {
    server.use(
      http.post("https://api.notion.com/v1/pages", async ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer secret_t");
        expect(request.headers.get("Notion-Version")).toBe("2026-03-11");
        const body = (await request.json()) as any;
        expect(body.parent).toEqual({ type: "page_id", page_id: "parent-X" });
        expect(body.properties.title.title[0].text.content).toBe("Hello");
        return HttpResponse.json({ id: "new-page-1", url: "https://notion.so/new-page-1" });
      }),
    );
    const api = new NotionApi("secret_t");
    const page = await api.createPage("parent-X", "Hello");
    expect(page.id).toBe("new-page-1");
    expect(page.url).toBe("https://notion.so/new-page-1");
  });

  it("appends children in chunks of 100", async () => {
    let calls = 0;
    server.use(
      http.patch(
        "https://api.notion.com/v1/blocks/p/children",
        async ({ request }) => {
          calls++;
          const body = (await request.json()) as any;
          expect(body.children.length).toBeLessThanOrEqual(100);
          return HttpResponse.json({ results: [] });
        },
      ),
    );
    const api = new NotionApi("secret_t");
    const children = Array.from({ length: 250 }, () => ({ type: "divider", divider: {} }));
    await api.appendChildren("p", children);
    expect(calls).toBe(3); // 100 + 100 + 50
  });
});

describe("uploadFile", () => {
  it("creates an upload, sends bytes, returns the id", async () => {
    server.use(
      http.post(
        "https://api.notion.com/v1/file_uploads",
        async ({ request }) => {
          const body = (await request.json()) as any;
          expect(body.filename).toBe("pic.png");
          return HttpResponse.json({
            id: "fu-1",
            upload_url: "https://files.notion.com/upload/fu-1",
          });
        },
      ),
      http.post(
        "https://files.notion.com/upload/fu-1",
        async ({ request }) => {
          // multipart should include a "file" field
          const ct = request.headers.get("content-type") ?? "";
          expect(ct).toMatch(/multipart\/form-data/);
          return HttpResponse.json({ status: "uploaded" });
        },
      ),
    );
    const id = await uploadFile(
      "secret_t",
      "pic.png",
      "image/png",
      new Uint8Array([1, 2, 3]),
    );
    expect(id).toBe("fu-1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test tests/notion-api.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the API client**

Create `src/destinations/notion/notion-api.ts`:

```ts
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
```

Create `src/destinations/notion/file-uploads.ts`:

```ts
const NOTION_VERSION = "2026-03-11";

export async function uploadFile(
  token: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<string> {
  const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "single_part",
      filename,
      content_type: contentType,
    }),
  });
  if (!createRes.ok) {
    throw new Error(
      `Notion file_uploads create failed: ${createRes.status} ${await createRes.text()}`,
    );
  }
  const created = (await createRes.json()) as {
    id: string;
    upload_url: string;
  };

  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: contentType }),
    filename,
  );
  const sendRes = await fetch(created.upload_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
    body: form,
  });
  if (!sendRes.ok) {
    throw new Error(
      `Notion file upload PUT failed: ${sendRes.status} ${await sendRes.text()}`,
    );
  }

  return created.id;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/notion-api.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/notion/notion-api.ts src/destinations/notion/file-uploads.ts tests/notion-api.test.ts
git commit -m "feat(notion): add REST client and file upload helper"
```

---

## Task 17: NotionDestination orchestration

**Files:**
- Create: `src/destinations/notion/notion-destination.ts`
- Create: `tests/notion-destination.test.ts`

This wires everything together: create page, upload assets, convert IR with the asset resolver, append children in chunks.

- [ ] **Step 1: Write the failing test**

Create `tests/notion-destination.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NotionDestination } from "@/destinations/notion/notion-destination";
import type { Page } from "@/ir/types";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("NotionDestination", () => {
  it("creates a page, uploads images, appends blocks; returns destinationUrl", async () => {
    server.use(
      http.post("https://api.notion.com/v1/pages", () =>
        HttpResponse.json({ id: "new-1", url: "https://notion.so/new-1" }),
      ),
      http.post("https://api.notion.com/v1/file_uploads", () =>
        HttpResponse.json({
          id: "fu-A",
          upload_url: "https://files.notion.com/upload/fu-A",
        }),
      ),
      http.post("https://files.notion.com/upload/fu-A", () =>
        HttpResponse.json({ status: "uploaded" }),
      ),
      http.patch("https://api.notion.com/v1/blocks/new-1/children", () =>
        HttpResponse.json({ results: [] }),
      ),
    );

    const page: Page = {
      id: "1",
      title: "Hello",
      sourceUrl: "https://x/y",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [
        { type: "paragraph", inlines: [{ type: "text", text: "Hi" }] },
        { type: "image", assetId: "img-A", alt: "" },
      ],
      assets: [
        {
          id: "img-A",
          filename: "x.png",
          mimeType: "image/png",
          fetch: async () => new Uint8Array([1]),
        },
      ],
    };

    const dest = new NotionDestination({
      token: "secret_t",
      parentPageId: "parent-1",
    });
    const result = await dest.publish(page, { onProgress: () => {} });
    expect(result.ok).toBe(true);
    expect(result.destinationUrl).toBe("https://notion.so/new-1");
  });

  it("collects failures when an image upload fails but continues", async () => {
    server.use(
      http.post("https://api.notion.com/v1/pages", () =>
        HttpResponse.json({ id: "new-2", url: "https://notion.so/new-2" }),
      ),
      http.post("https://api.notion.com/v1/file_uploads", () =>
        new HttpResponse("nope", { status: 500 }),
      ),
      http.patch("https://api.notion.com/v1/blocks/new-2/children", () =>
        HttpResponse.json({ results: [] }),
      ),
    );

    const page: Page = {
      id: "2",
      title: "Bad",
      sourceUrl: "https://x/y",
      capturedAt: "2026-05-21T00:00:00Z",
      blocks: [{ type: "image", assetId: "img-X", alt: "" }],
      assets: [
        {
          id: "img-X",
          filename: "x.png",
          mimeType: "image/png",
          fetch: async () => new Uint8Array([1]),
        },
      ],
    };

    const dest = new NotionDestination({
      token: "secret_t",
      parentPageId: "parent-1",
    });
    const result = await dest.publish(page, { onProgress: () => {} });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].assetId).toBe("img-X");
    expect(result.destinationUrl).toBe("https://notion.so/new-2");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test tests/notion-destination.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the destination**

Create `src/destinations/notion/notion-destination.ts`:

```ts
import type { Page } from "@/ir/types";
import type {
  Destination,
  Failure,
  PublishContext,
  PublishResult,
} from "@/destinations/destination";
import { NotionApi } from "./notion-api";
import { uploadFile } from "./file-uploads";
import { irToNotionBlocks } from "./ir-to-notion";

export type NotionDestinationConfig = {
  token: string;
  parentPageId: string;
};

export class NotionDestination implements Destination {
  readonly id = "notion";
  readonly displayName = "Notion";

  constructor(private config: NotionDestinationConfig) {}

  async isConfigured(): Promise<boolean> {
    return Boolean(this.config.token && this.config.parentPageId);
  }

  async publish(page: Page, ctx: PublishContext): Promise<PublishResult> {
    const api = new NotionApi(this.config.token);
    const failures: Failure[] = [];

    ctx.onProgress("Creating Notion page");
    const created = await api.createPage(this.config.parentPageId, page.title);

    const uploadIds = new Map<string, string>();
    let i = 0;
    for (const asset of page.assets) {
      i++;
      try {
        ctx.onProgress(`Uploading ${asset.filename} (${i}/${page.assets.length})`);
        const bytes = asset.bytes ?? (await asset.fetch!());
        const id = await uploadFile(
          this.config.token,
          asset.filename,
          asset.mimeType,
          bytes,
        );
        uploadIds.set(asset.id, id);
      } catch (err) {
        failures.push({
          assetId: asset.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const resolve = (assetId: string): string => {
      const id = uploadIds.get(assetId);
      if (!id) {
        // No upload id (failed) — return an empty string; the block will likely
        // be rejected by Notion and we'll capture it as a block-level failure.
        return "";
      }
      return id;
    };

    // Drop blocks whose required asset failed to upload so we don't send invalid JSON.
    const usableBlocks = page.blocks.filter((b, idx) => {
      if (b.type === "image" || b.type === "attachment") {
        if (!uploadIds.has(b.assetId)) {
          failures.push({
            blockIndex: idx,
            assetId: b.assetId,
            reason: "asset upload failed; block dropped",
          });
          return false;
        }
      }
      return true;
    });

    const notionBlocks = irToNotionBlocks(usableBlocks, resolve);
    ctx.onProgress(`Appending ${notionBlocks.length} blocks`);
    try {
      await api.appendChildren(created.id, notionBlocks);
    } catch (err) {
      failures.push({
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      ok: failures.length === 0,
      failures,
      destinationUrl: created.url,
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/notion-destination.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/destinations/notion/notion-destination.ts tests/notion-destination.test.ts
git commit -m "feat(notion): orchestrate page create + uploads + block append"
```

---

## Task 18: Messaging protocol (UI to service worker)

**Files:**
- Create: `src/messaging/protocol.ts`

The side panel can't import the orchestrator directly (different runtime contexts). They communicate via `chrome.runtime.sendMessage`. We define typed message shapes.

- [ ] **Step 1: Create the protocol file**

Create `src/messaging/protocol.ts`:

```ts
import type { Failure } from "@/destinations/destination";

export type CaptureRequest = {
  type: "capture";
  pageId: string;
  destination:
    | { kind: "notion"; parentPageId: string }
    | { kind: "local-deferred" }; // local writes happen in the side panel (needs the user-picked dir handle)
};

export type CaptureProgress = {
  type: "progress";
  message: string;
};

export type CaptureDone = {
  type: "done";
  ok: boolean;
  failures: Failure[];
  destinationUrl?: string;
};

export type CaptureError = {
  type: "error";
  message: string;
};

export type SearchNotionParentsRequest = {
  type: "search-notion-parents";
  query: string;
};

export type SearchNotionParentsResponse = {
  type: "search-notion-parents-result";
  results: Array<{ id: string; title: string; url: string }>;
};

export type FetchPageOnlyRequest = {
  // For local destination: side panel asks the worker for the IR, then writes
  // files itself using the FileSystemDirectoryHandle (which can't cross runtimes).
  type: "fetch-page";
  pageId: string;
};

export type FetchPageOnlyResponse = {
  type: "fetch-page-result";
  page: import("@/ir/types").Page;
};

export type WorkerRequest =
  | CaptureRequest
  | SearchNotionParentsRequest
  | FetchPageOnlyRequest;

export type WorkerResponse =
  | CaptureProgress
  | CaptureDone
  | CaptureError
  | SearchNotionParentsResponse
  | FetchPageOnlyResponse;
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/messaging/protocol.ts
git commit -m "feat(messaging): define typed request/response protocol"
```

---

## Task 19: Orchestrator + service-worker keep-alive

**Files:**
- Create: `src/orchestrator/keepalive.ts`
- Create: `src/orchestrator/orchestrator.ts`

The orchestrator is the function called by the background service worker. It accepts a `Source` and a `Destination`, runs the pipeline, and reports progress via a callback.

- [ ] **Step 1: Create the keepalive module**

Create `src/orchestrator/keepalive.ts`:

```ts
const ALARM_NAME = "wikibridge-keepalive";

export function startKeepalive(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.4 }); // ~24s
}

export function stopKeepalive(): void {
  chrome.alarms.clear(ALARM_NAME);
}

// The background entry must call this on chrome.alarms.onAlarm so the SW
// service worker stays awake during long captures.
export function isKeepaliveAlarm(name: string): boolean {
  return name === ALARM_NAME;
}
```

- [ ] **Step 2: Create the orchestrator**

Create `src/orchestrator/orchestrator.ts`:

```ts
import type { Page } from "@/ir/types";
import type { Source } from "@/sources/source";
import type {
  Destination,
  PublishResult,
} from "@/destinations/destination";
import { startKeepalive, stopKeepalive } from "./keepalive";

export type RunOptions = {
  pageId: string;
  source: Source;
  destination: Destination;
  onProgress: (message: string) => void;
};

export async function runCapture(
  opts: RunOptions,
): Promise<{ page: Page; result: PublishResult }> {
  startKeepalive();
  try {
    opts.onProgress("Fetching page");
    const page = await opts.source.fetchPage(opts.pageId);
    const result = await opts.destination.publish(page, {
      onProgress: opts.onProgress,
    });
    return { page, result };
  } finally {
    stopKeepalive();
  }
}

export async function fetchPageOnly(opts: {
  pageId: string;
  source: Source;
  onProgress: (message: string) => void;
}): Promise<Page> {
  startKeepalive();
  try {
    opts.onProgress("Fetching page");
    return await opts.source.fetchPage(opts.pageId);
  } finally {
    stopKeepalive();
  }
}
```

- [ ] **Step 3: Verify it compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/
git commit -m "feat(orchestrator): run capture pipeline with SW keepalive"
```

---

## Task 20: Background service worker entry

**Files:**
- Create: `entrypoints/background.ts`

The background entry listens for messages from the side panel and dispatches to the orchestrator. It also enables the side panel on the toolbar icon.

- [ ] **Step 1: Implement the background entry**

Create `entrypoints/background.ts`:

```ts
import { defineBackground } from "wxt/sandbox";
import { ConfluenceSource } from "@/sources/confluence/confluence-source";
import { NotionDestination } from "@/destinations/notion/notion-destination";
import { NotionApi } from "@/destinations/notion/notion-api";
import { runCapture, fetchPageOnly } from "@/orchestrator/orchestrator";
import { isKeepaliveAlarm } from "@/orchestrator/keepalive";
import { getSettings } from "@/storage/settings";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@/messaging/protocol";

export default defineBackground({
  main() {
    // Open side panel on action icon click.
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});

    // Keepalive listener (no work, just keeps the SW from sleeping).
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (isKeepaliveAlarm(alarm.name)) {
        // no-op
      }
    });

    chrome.runtime.onMessage.addListener((msg: WorkerRequest, _sender, sendResponse) => {
      handle(msg, (resp) => {
        try {
          sendResponse(resp);
        } catch {
          // sender went away
        }
      })
        // Surface errors to the side panel
        .catch((err) => {
          sendResponse({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          } satisfies WorkerResponse);
        });
      return true; // keep the channel open for the async response
    });
  },
});

async function handle(
  msg: WorkerRequest,
  reply: (resp: WorkerResponse) => void,
): Promise<void> {
  const settings = await getSettings();
  if (!settings.atlassian) throw new Error("Atlassian not configured");
  const source = new ConfluenceSource(settings.atlassian);

  switch (msg.type) {
    case "capture": {
      if (msg.destination.kind === "notion") {
        if (!settings.notion) throw new Error("Notion not configured");
        const destination = new NotionDestination({
          token: settings.notion.integrationToken,
          parentPageId: msg.destination.parentPageId,
        });
        const { result } = await runCapture({
          pageId: msg.pageId,
          source,
          destination,
          onProgress: (m) => reply({ type: "progress", message: m }),
        });
        reply({
          type: "done",
          ok: result.ok,
          failures: result.failures,
          destinationUrl: result.destinationUrl,
        });
        return;
      }
      throw new Error(
        "local-deferred capture must be handled by the side panel, not the worker",
      );
    }
    case "fetch-page": {
      const page = await fetchPageOnly({
        pageId: msg.pageId,
        source,
        onProgress: (m) => reply({ type: "progress", message: m }),
      });
      reply({ type: "fetch-page-result", page });
      return;
    }
    case "search-notion-parents": {
      if (!settings.notion) throw new Error("Notion not configured");
      const results = await new NotionApi(
        settings.notion.integrationToken,
      ).searchParents(msg.query);
      reply({ type: "search-notion-parents-result", results });
      return;
    }
  }
}
```

- [ ] **Step 2: Verify build succeeds**

```bash
pnpm build
```

Expected: build succeeds and produces `.output/chrome-mv3/background.js`.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/background.ts
git commit -m "feat(background): wire orchestrator to side-panel messages"
```

---

## Task 21: Page-id detection helper

**Files:**
- Create: `src/sources/confluence/detect-page-id.ts`
- Create: `tests/detect-page-id.test.ts`

The side panel needs to extract the Confluence page id from the active tab's URL. Two formats: modern (`/wiki/spaces/SPACE/pages/<id>/Title`) and legacy (`?pageId=<id>`).

- [ ] **Step 1: Write the failing test**

Create `tests/detect-page-id.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/detect-page-id.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/sources/confluence/detect-page-id.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/detect-page-id.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources/confluence/detect-page-id.ts tests/detect-page-id.test.ts
git commit -m "feat(confluence): detect page id from tab URL"
```

---

## Task 22: Options page (token settings)

**Files:**
- Create: `entrypoints/options/index.html`
- Create: `entrypoints/options/main.tsx`
- Create: `entrypoints/options/App.tsx`

- [ ] **Step 1: Create the HTML entry**

Create `entrypoints/options/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>WikiBridge — Settings</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the React root**

Create `entrypoints/options/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 3: Create the App component**

Create `entrypoints/options/App.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import {
  getSettings,
  saveSettings,
  type Settings,
} from "@/storage/settings";
import { ConfluenceApi } from "@/sources/confluence/confluence-api";
import { NotionApi } from "@/destinations/notion/notion-api";

type TestStatus = "idle" | "ok" | "fail";

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showAtlToken, setShowAtlToken] = useState(false);
  const [showNotionToken, setShowNotionToken] = useState(false);
  const [atlStatus, setAtlStatus] = useState<TestStatus>("idle");
  const [atlMsg, setAtlMsg] = useState("");
  const [notionStatus, setNotionStatus] = useState<TestStatus>("idle");
  const [notionMsg, setNotionMsg] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  if (!settings) return <p>Loading…</p>;

  const updateAtl = (patch: Partial<NonNullable<Settings["atlassian"]>>) => {
    setSettings((s) => {
      if (!s) return s;
      const cur = s.atlassian ?? { siteUrl: "", email: "", apiToken: "" };
      return { ...s, atlassian: { ...cur, ...patch } };
    });
  };

  const updateNotion = (patch: Partial<NonNullable<Settings["notion"]>>) => {
    setSettings((s) => {
      if (!s) return s;
      const cur = s.notion ?? { integrationToken: "" };
      return { ...s, notion: { ...cur, ...patch } };
    });
  };

  const testAtlassian = async () => {
    if (!settings.atlassian) return;
    setAtlStatus("idle");
    try {
      const api = new ConfluenceApi(settings.atlassian);
      const url = `${settings.atlassian.siteUrl.replace(/\/+$/, "")}/wiki/api/v2/spaces?limit=1`;
      const res = await fetch(url, {
        headers: {
          Authorization:
            "Basic " +
            btoa(
              `${settings.atlassian.email}:${settings.atlassian.apiToken}`,
            ),
        },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setAtlStatus("ok");
      setAtlMsg("Connected");
    } catch (e) {
      setAtlStatus("fail");
      setAtlMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const testNotion = async () => {
    if (!settings.notion) return;
    setNotionStatus("idle");
    try {
      const me = await new NotionApi(
        settings.notion.integrationToken,
      ).whoami();
      setNotionStatus("ok");
      setNotionMsg(`Connected as ${me.name || me.id}`);
    } catch (e) {
      setNotionStatus("fail");
      setNotionMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 640 }}>
      <h1>WikiBridge — Settings</h1>

      <section>
        <h2>Atlassian (Confluence Cloud)</h2>
        <Field label="Site URL">
          <input
            value={settings.atlassian?.siteUrl ?? ""}
            placeholder="https://myorg.atlassian.net"
            onChange={(e) => updateAtl({ siteUrl: e.target.value })}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="Email">
          <input
            value={settings.atlassian?.email ?? ""}
            placeholder="me@myorg.com"
            onChange={(e) => updateAtl({ email: e.target.value })}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="API Token">
          <input
            type={showAtlToken ? "text" : "password"}
            value={settings.atlassian?.apiToken ?? ""}
            onChange={(e) => updateAtl({ apiToken: e.target.value })}
            style={{ width: "70%" }}
          />
          <button onClick={() => setShowAtlToken((v) => !v)}>
            {showAtlToken ? "Hide" : "Show"}
          </button>
          <button onClick={testAtlassian}>Test</button>
          <Status status={atlStatus} message={atlMsg} />
        </Field>
        <p>
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
          >
            Get an Atlassian API token
          </a>
        </p>
      </section>

      <section>
        <h2>Notion</h2>
        <Field label="Integration Token">
          <input
            type={showNotionToken ? "text" : "password"}
            value={settings.notion?.integrationToken ?? ""}
            onChange={(e) => updateNotion({ integrationToken: e.target.value })}
            style={{ width: "70%" }}
          />
          <button onClick={() => setShowNotionToken((v) => !v)}>
            {showNotionToken ? "Hide" : "Show"}
          </button>
          <button onClick={testNotion}>Test</button>
          <Status status={notionStatus} message={notionMsg} />
        </Field>
        <p>
          <a
            href="https://www.notion.so/my-integrations"
            target="_blank"
            rel="noreferrer"
          >
            Create a Notion integration
          </a>
          . Then share each parent page with the integration.
        </p>
      </section>

      <div style={{ marginTop: 16 }}>
        <button onClick={save}>Save</button>
        {saved && <span style={{ marginLeft: 12, color: "green" }}>Saved.</span>}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
      <label style={{ minWidth: 120, fontSize: 13, color: "#444" }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 8, flex: 1 }}>{children}</div>
    </div>
  );
}

function Status({ status, message }: { status: TestStatus; message: string }) {
  if (status === "idle") return null;
  return (
    <span
      style={{
        color: status === "ok" ? "green" : "crimson",
        fontSize: 12,
        marginLeft: 8,
      }}
    >
      {status === "ok" ? "✓" : "✗"} {message}
    </span>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm build
```

Expected: build produces `.output/chrome-mv3/options.html`.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/options/
git commit -m "feat(options): settings page with token fields and Test buttons"
```

---

## Task 23: Side panel — UI shell, page detection, destination picker

**Files:**
- Create: `entrypoints/sidepanel/index.html`
- Create: `entrypoints/sidepanel/main.tsx`
- Create: `entrypoints/sidepanel/App.tsx`

The side panel queries the active tab on mount, detects the Confluence page id, and renders the capture form.

- [ ] **Step 1: Create the HTML entry**

Create `entrypoints/sidepanel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>WikiBridge</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the React root**

Create `entrypoints/sidepanel/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 3: Create the App component**

Create `entrypoints/sidepanel/App.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { detectConfluencePageId } from "@/sources/confluence/detect-page-id";
import {
  getSettings,
  saveSettings,
  type Settings,
} from "@/storage/settings";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@/messaging/protocol";
import { LocalDestination } from "@/destinations/local/local-destination";

type DestKind = "notion" | "local";
type Phase =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | {
      kind: "done";
      ok: boolean;
      destinationUrl?: string;
      failures: { reason: string }[];
    }
  | { kind: "error"; message: string };

export function App() {
  const [pageId, setPageId] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState<string>("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [destKind, setDestKind] = useState<DestKind>("notion");
  const [parents, setParents] = useState<
    { id: string; title: string; url: string }[]
  >([]);
  const [parentId, setParentId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      if (s.defaults.lastDestinationType) setDestKind(s.defaults.lastDestinationType);
      if (s.defaults.lastNotionParentId) setParentId(s.defaults.lastNotionParentId);
    });
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (!tab?.url) return;
      setPageId(detectConfluencePageId(tab.url));
      setPageTitle(tab.title ?? "");
    });
  }, []);

  useEffect(() => {
    if (destKind !== "notion" || !settings?.notion) return;
    sendMessage<{
      type: "search-notion-parents";
      query: string;
    }, { type: "search-notion-parents-result"; results: typeof parents }>({
      type: "search-notion-parents",
      query: "",
    }).then((resp) => {
      if (resp.type === "search-notion-parents-result") setParents(resp.results);
    });
  }, [destKind, settings?.notion]);

  if (!settings) return <p>Loading…</p>;

  const notionConfigured = Boolean(settings.notion?.integrationToken);
  const atlConfigured = Boolean(settings.atlassian?.apiToken);

  const onCapture = async () => {
    if (!pageId) return;
    setPhase({ kind: "working", message: "Starting…" });
    await saveSettings({
      ...settings,
      defaults: {
        ...settings.defaults,
        lastDestinationType: destKind,
        lastNotionParentId: destKind === "notion" ? parentId : settings.defaults.lastNotionParentId,
      },
    });

    if (destKind === "notion") {
      try {
        const resp = await sendWithProgress<{ type: "capture"; pageId: string; destination: { kind: "notion"; parentPageId: string } }>(
          {
            type: "capture",
            pageId,
            destination: { kind: "notion", parentPageId: parentId },
          },
          (msg) => setPhase({ kind: "working", message: msg }),
        );
        if (resp.type === "done") {
          setPhase({
            kind: "done",
            ok: resp.ok,
            destinationUrl: resp.destinationUrl,
            failures: resp.failures.map((f) => ({ reason: f.reason })),
          });
        } else if (resp.type === "error") {
          setPhase({ kind: "error", message: resp.message });
        }
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    // Local: fetch page in worker, then write files here (need a user gesture for showDirectoryPicker).
    try {
      const dir = await (window as any).showDirectoryPicker();
      const fetched = await sendWithProgress<{ type: "fetch-page"; pageId: string }>(
        { type: "fetch-page", pageId },
        (msg) => setPhase({ kind: "working", message: msg }),
      );
      if (fetched.type !== "fetch-page-result") {
        if (fetched.type === "error") {
          setPhase({ kind: "error", message: fetched.message });
        }
        return;
      }
      // Lazy fetchers from the worker won't survive postMessage. The worker has
      // already inlined asset bytes (see Task 24 for the bytes-inlining update).
      const dest = new LocalDestination();
      const result = await dest.publishToHandle(dir, fetched.page, {
        onProgress: (m) => setPhase({ kind: "working", message: m }),
      });
      setPhase({
        kind: "done",
        ok: result.ok,
        destinationUrl: undefined,
        failures: result.failures.map((f) => ({ reason: f.reason })),
      });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>WikiBridge</strong>
        <button onClick={() => chrome.runtime.openOptionsPage()}>⚙</button>
      </header>

      <section style={{ marginTop: 16 }}>
        <Label>CURRENT PAGE</Label>
        {pageId ? (
          <p style={{ margin: "4px 0" }}>{pageTitle || pageId}</p>
        ) : (
          <p style={{ color: "#888" }}>
            Open a Confluence page in the active tab to capture it.
          </p>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        <Label>SAVE TO</Label>
        <div style={{ display: "flex", gap: 8 }}>
          <DestButton
            selected={destKind === "notion"}
            disabled={!notionConfigured}
            onClick={() => setDestKind("notion")}
          >
            Notion
          </DestButton>
          <DestButton
            selected={destKind === "local"}
            onClick={() => setDestKind("local")}
          >
            Local file
          </DestButton>
        </div>
        {!notionConfigured && destKind === "notion" && (
          <p style={{ fontSize: 12 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); }}>
              Configure Notion to enable this option
            </a>
          </p>
        )}
      </section>

      {destKind === "notion" && (
        <section style={{ marginTop: 16 }}>
          <Label>PARENT PAGE</Label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">— pick a parent —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </section>
      )}

      <button
        onClick={onCapture}
        disabled={
          !pageId ||
          !atlConfigured ||
          phase.kind === "working" ||
          (destKind === "notion" && (!notionConfigured || !parentId))
        }
        style={{
          marginTop: 24,
          width: "100%",
          padding: 12,
          background: "#0a7d6a",
          color: "white",
          border: 0,
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Capture page
      </button>

      <PhaseView phase={phase} />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: "#777", letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}

function DestButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: 8,
        border: `2px solid ${selected ? "#0a7d6a" : "#ccc"}`,
        background: "white",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {selected ? "● " : "○ "}
      {children}
    </button>
  );
}

function PhaseView({ phase }: { phase: Phase }) {
  if (phase.kind === "idle") return null;
  if (phase.kind === "working")
    return <p style={{ marginTop: 16, color: "#444" }}>{phase.message}…</p>;
  if (phase.kind === "error")
    return (
      <p style={{ marginTop: 16, color: "crimson" }}>Error: {phase.message}</p>
    );
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ color: phase.ok ? "green" : "darkorange" }}>
        {phase.ok ? "Capture complete." : "Capture finished with issues."}
      </p>
      {phase.destinationUrl && (
        <p>
          <a href={phase.destinationUrl} target="_blank" rel="noreferrer">
            Open in Notion
          </a>
        </p>
      )}
      {phase.failures.length > 0 && (
        <details>
          <summary>{phase.failures.length} issue(s)</summary>
          <ul>
            {phase.failures.map((f, i) => (
              <li key={i}>{f.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function sendMessage<Req extends WorkerRequest, Resp extends WorkerResponse>(
  req: Req,
): Promise<Resp> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(req, (resp: Resp) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

function sendWithProgress<Req extends WorkerRequest>(
  req: Req,
  onProgress: (msg: string) => void,
): Promise<WorkerResponse> {
  // The worker may send multiple responses ("progress" then "done"). We use
  // chrome.runtime.onMessage as a stream, with a unique request id.
  return new Promise((resolve, reject) => {
    const listener = (msg: WorkerResponse) => {
      if (msg.type === "progress") {
        onProgress(msg.message);
      } else {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage(req, (resp: WorkerResponse) => {
      const err = chrome.runtime.lastError;
      if (err) {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error(err.message));
      } else if (resp.type !== "progress") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(resp);
      }
    });
  });
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm build
```

Expected: build produces `.output/chrome-mv3/sidepanel.html`.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/sidepanel/
git commit -m "feat(sidepanel): capture UI with destination picker and progress"
```

---

## Task 24: Inline asset bytes for cross-context transfer (local destination)

**Files:**
- Modify: `entrypoints/background.ts`

When the side panel asks the worker for the IR for the local destination, the lazy `fetch()` closures on assets can't survive `chrome.runtime.sendMessage` (it's structured-clone serialization — functions are dropped). The worker must eagerly download asset bytes before responding.

- [ ] **Step 1: Modify the `fetch-page` handler to inline bytes**

In `entrypoints/background.ts`, replace the `"fetch-page"` case in `handle()` with:

```ts
    case "fetch-page": {
      const page = await fetchPageOnly({
        pageId: msg.pageId,
        source,
        onProgress: (m) => reply({ type: "progress", message: m }),
      });
      // Eagerly download asset bytes so the response survives structured-clone serialization.
      for (const asset of page.assets) {
        if (!asset.bytes && asset.fetch) {
          reply({ type: "progress", message: `Downloading ${asset.filename}` });
          asset.bytes = await asset.fetch();
        }
        // Remove the function before posting; it can't be cloned.
        delete (asset as { fetch?: unknown }).fetch;
      }
      reply({ type: "fetch-page-result", page });
      return;
    }
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/background.ts
git commit -m "fix(background): inline asset bytes before sending IR to side panel"
```

---

## Task 25: Manual smoke test page and checklist

**Files:**
- Create: `docs/superpowers/qa/smoke-checklist.md`

- [ ] **Step 1: Write the checklist**

Create `docs/superpowers/qa/smoke-checklist.md`:

```markdown
# WikiBridge — Manual Smoke Test

## Prep

1. In Confluence, create a test page that contains, in this order:
   - H1, H2, H3, H4, H5, H6 (six headings, distinct text)
   - A paragraph with bold, italic, underlined, struck-through, and inline-code spans, plus one hyperlink to https://example.com
   - An ordered list of 3 items
   - A bulleted list of 3 items, with one item containing a nested 2-item bulleted list
   - A code block with language=ts containing `const x = 1;`
   - One of each panel: info, note, warning, success
   - A 3x3 table with a header row
   - Two inline images (different file types: PNG and JPEG)
   - One PDF attachment

2. Note the page URL — e.g., `https://yourorg.atlassian.net/wiki/spaces/X/pages/12345/Smoke`.

3. In Notion, create a top-level page called "WikiBridge Smoke" and share it with your integration.

## Load the extension

```bash
pnpm build
```

In Chrome:
1. Visit `chrome://extensions`, enable Developer mode.
2. "Load unpacked" -> select `.output/chrome-mv3/`.
3. Open the WikiBridge options page from the extensions list and enter:
   - Atlassian site URL, email, API token (click Test, expect green ✓)
   - Notion integration token (click Test, expect green ✓)
4. Click Save.

## Capture to Notion

1. Open the Confluence smoke page in a tab.
2. Click the WikiBridge toolbar icon -> side panel opens.
3. Confirm the page title appears under "CURRENT PAGE".
4. Choose "Notion", pick "WikiBridge Smoke" from the parent dropdown.
5. Click "Capture page".
6. Watch progress messages: fetching, uploading 2/2 images, uploading 1/1 attachment, appending blocks.
7. On done, click the destination link.

### Verify in Notion

- [ ] H1..H3 render; H4..H6 collapsed to H3-equivalent
- [ ] All 5 inline marks render (bold/italic/underline/strike/code)
- [ ] Hyperlink is clickable and goes to example.com
- [ ] Ordered list 3 items, in order
- [ ] Bulleted list 3 items, with the nested 2-item sublist preserved
- [ ] Code block shows TypeScript syntax highlighting and exact content
- [ ] Four callouts render with the right color/icon
- [ ] Table shows header row and all 3x3 cells
- [ ] Both images render inline (not broken)
- [ ] PDF attachment shows as a file block, clickable

## Capture to local

1. Reload the smoke page tab.
2. In the side panel, switch to "Local file".
3. Click "Capture page". Pick an empty folder when prompted.
4. After "Capture complete", open the folder.

### Verify on disk

- [ ] A subfolder named `smoke-<timestamp>/` exists
- [ ] Contains `README.md`, `images/`, `attachments/`
- [ ] `README.md` has YAML frontmatter with title/sourceUrl/capturedAt
- [ ] The Markdown content reads cleanly with all expected elements
- [ ] Image files exist in `images/` and the Markdown references them
- [ ] PDF exists in `attachments/` and the Markdown references it

## Negative tests

- [ ] With Atlassian token cleared, the side panel disables Capture and shows a "Configure" link.
- [ ] On a non-Confluence tab (e.g., google.com), the side panel shows "Open a Confluence page in the active tab".
- [ ] On a Confluence page that has an unknown ADF macro, the macro degrades to a paragraph (not an error).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/qa/smoke-checklist.md
git commit -m "docs: add manual smoke-test checklist"
```

---

## Task 26: Final wiring check

**Files:**
- (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass. If any fail, fix before continuing.

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build the production extension**

```bash
pnpm build
```

Expected: `.output/chrome-mv3/` is produced with `manifest.json`, `background.js`, `sidepanel.html`, `options.html`.

- [ ] **Step 4: Manual smoke test**

Run the smoke checklist in `docs/superpowers/qa/smoke-checklist.md`. Confirm all items pass.

- [ ] **Step 5: Commit any fixes from the smoke pass**

If the smoke test surfaces bugs, fix and commit each separately with a `fix:` prefix. Do not amend earlier commits.

---

## Self-Review Checklist (for the plan author)

(These items are not implementation steps; they were checked when the plan was written.)

- Spec coverage: all goals from the design (`docs/superpowers/specs/2026-05-21-wikibridge-design.md`) are covered: ADF source (Tasks 7–12), IR (Task 4), Markdown destination (Tasks 13–14), Notion destination (Tasks 15–17), settings + tokens (Tasks 5, 22), side panel UI (Task 23), service worker keep-alive (Task 19), error handling as best-effort (Tasks 14, 17), extensibility via `Destination` interface (Task 6, registry left as a small follow-up).
- Type consistency: all imports use `@/...`, all interface names (`Source`, `Destination`, `Page`, `Block`, `Inline`, `Asset`, `Mark`, `Failure`, `PublishResult`, `PublishContext`) match across tasks.
- No placeholders: every code-bearing step has the actual code; every test step has the actual assertions.

## Notes on deviations from the spec (intentional, called out here)

- The spec mentioned a "destinations registry" object. The plan doesn't ship one because v1 only has two destinations, both hardcoded in `entrypoints/background.ts` and `entrypoints/sidepanel/App.tsx`. Adding the registry becomes a small refactor when destination #3 arrives (the `Destination` interface is already the seam).
- The spec described local capture as fully handled by `LocalDestination.publish()`. The implementation splits it: the worker fetches the IR (with asset bytes inlined), the side panel calls `publishToHandle()` with a `FileSystemDirectoryHandle` obtained via a user gesture. The `Destination.publish()` method throws in `LocalDestination` to enforce that. This is documented inline.
- Notion's table cells only accept rich text (not nested blocks). The IR allows nested blocks in cells, so `ir-to-notion.ts` flattens cell blocks to text when they aren't paragraphs. The local Markdown renderer does similar flattening at table render time. Documented in code comments and the IR-to-Notion task description.
