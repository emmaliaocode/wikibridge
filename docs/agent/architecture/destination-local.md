# Destination: Local Markdown

Directory: [`src/destinations/local/`](../../../src/destinations/local/). Implements [`Destination`](../../../src/destinations/destination.ts) but the real entry is `publishToHandle`.

| File | Role |
|------|------|
| `filesystem.ts` | `slugify`, `timestampFolderSuffix`, `writeTextFile`, `writeBinaryFile`. |
| `ir-to-markdown.ts` | Pure converter, IR `Block[]` → Markdown string. |
| `local-destination.ts` | Pipeline: pick subfolder, write README + assets. |

## Why `publish()` throws

`Destination.publish(page, ctx)` is the abstract contract. For local capture, we need a `FileSystemDirectoryHandle` which:

- Requires a **user gesture** to obtain (`showDirectoryPicker()` is gated by `transient activation`).
- Cannot **cross the runtime boundary** to the service worker.

So `LocalDestination.publish()` throws a clear error message, and the actual entry point is `publishToHandle(rootHandle, page, ctx)`, called from the side panel after `showDirectoryPicker()`. See [side-panel.md](side-panel.md) for the local branch flow.

## Output layout

```
<root>/
  └── <slug(page.title)>-<YYYYMMDD-HHMM>/
        ├── README.md
        ├── images/           (only if image assets exist)
        │   ├── pic1.png
        │   └── ...
        └── attachments/      (only if non-image assets exist)
            ├── doc.pdf
            └── ...
```

`slug` strips non-word/space chars, lowercases, trims to 60 chars. Empty → `"page"`. Timestamp is UTC.

## README.md structure

```markdown
---
title: <page.title>
sourceUrl: <page.sourceUrl>
capturedAt: <page.capturedAt>
---

# <page.title>

<rendered Markdown body>
```

Frontmatter gives tools a machine-readable header; the H1 gives readers a visible title (the body alone has no title).

## IR → Markdown mapping

| IR | Markdown |
|----|----------|
| `heading` | `#`, `##`, `###`, etc. (full 1-6 supported). |
| `paragraph` | inline text. |
| `list { ordered: false }` | `- ` per item, two-space indent for nested blocks. |
| `list { ordered: true }` | `1. `, `2. `, etc. |
| `code` | Triple-backtick fence with language. |
| `quote` | Each line prefixed `> `. |
| `callout` | Each line prefixed `> [<variant>] ` (e.g. `> [info] ...`). |
| `toggle` | `<details><summary>title</summary>\n\n<body>\n\n</details>`. Blank lines around body are required for nested Markdown to render. |
| `table` | Pipe-delimited with `---` header separator. Pipes inside cells escaped as `\|`. Cell content flattens nested blocks into a single line. |
| `image` | `![alt](images/<filename>)`. |
| `attachment` | `[filename](attachments/<filename>)`. |
| `divider` | `---`. |

### Inline marks

| IR | Markdown |
|----|----------|
| `bold` | `**...**` |
| `italic` | `*...*` |
| `underline` | `<u>...</u>` (Markdown has no native underline) |
| `strike` | `~~...~~` |
| `code` | `` `...` `` |
| `link` | `[text](url)` |
| `color` | `<span style="color:<name>">...</span>` (Notion color names are also valid CSS keywords) |
| `backgroundColor` | `<span style="background-color:<name>">...</span>` (stacks with color if both set) |

## Asset writing

For each `Page.asset`:
1. Pull `bytes` (already inlined when the page arrived from the worker).
2. Route to `images/` or `attachments/` by `mimeType.startsWith("image/")`.
3. Write via `writeBinaryFile(dir, asset.filename, bytes)`.

Failures per asset are collected into `failures[]`; the README still gets written.

## File System Access API quirk

`FileSystemWritableFileStream.write()` does NOT accept bare `Uint8Array` or `string`. It requires a `Blob` or a `WriteParams` object with a `type` field. The cryptic error is:

> `Failed to execute 'write' on 'FileSystemWritableFileStream': Failed to read the 'type' property from 'WriteParams': Required member is undefined.`

Both `writeTextFile` and `writeBinaryFile` wrap their input in `new Blob([data])` before calling `.write()`. The `FakeDir` test stub enforces this — it rejects bare `Uint8Array` so regressions are caught in `tests/local-destination.test.ts`.

## When to touch this

- New IR block variant → add a `case` to `renderBlock`. Decide on a sensible Markdown rendering; prefer HTML inline only when Markdown has no equivalent (underline, color).
- File-on-disk layout change → update `publishToHandle` and the README assertions in `tests/local-destination.test.ts`.
- A new platform that needs a different filename sanitization (e.g. NTFS forbidden chars) → revisit `slugify` and asset filename writes; for now we trust Confluence's filenames.
