# Capture to Local Markdown

End-to-end flow for the local-file destination.

## User journey

1. Open a Confluence page; click WikiBridge icon.
2. Switch to **Local file**.
3. Click **Capture page**.
4. Browser file picker prompts for a directory.
5. Side panel streams progress ("Fetching page", "Downloading X.png", "Writing X.png").
6. On completion, panel shows "Capture complete" (no link — no URL for a local folder).

## Output

```
<chosen-folder>/
  └── <slug(title)>-<YYYYMMDD-HHMM>/
        ├── README.md
        ├── images/       (only if image assets exist)
        │   └── ...
        └── attachments/  (only if non-image assets exist)
            └── ...
```

The timestamp suffix prevents collisions on repeated captures.

`README.md` opens with YAML frontmatter (`title`, `sourceUrl`, `capturedAt`) then a `# <title>` heading then the body.

## Why this flow is split between worker and side panel

Two browser constraints force the split:

1. `showDirectoryPicker()` requires a **user gesture**. It must run inside the click handler — not from the worker.
2. `FileSystemDirectoryHandle` is **non-transferable**. Cannot post it to the worker, even via structured clone.

The worker still does the heavy lifting:
- Calls Confluence API.
- Downloads all asset bytes.
- Parses ADF.

Then it posts the `Page` IR back to the side panel with `asset.bytesBase64` (base64-encoded). The side panel decodes the base64 and runs `LocalDestination.publishToHandle(dirHandle, page, ctx)` against the user-picked directory.

See [architecture/background-service-worker.md](../architecture/background-service-worker.md) for the base64 transport detail.

## Internal flow

```
side panel
  ├── dir = await showDirectoryPicker()        ◄── user gesture
  ├── sendWithProgress("fetch-page", { pageId })
  │     │
  │     ▼
  │   worker.handle("fetch-page")
  │     ├── source.fetchPage(pageId)            ──► Page (lazy assets)
  │     ├── for each asset: bytes = await asset.fetch(); set asset.bytesBase64; delete asset.fetch
  │     └── sendResponse({ type: "fetch-page-result", page })
  │
  ├── (page arrives, side panel decodes bytesBase64 → asset.bytes = Uint8Array)
  └── LocalDestination().publishToHandle(dir, page, ctx)
        ├── create <slug>-<timestamp>/
        ├── for each asset:
        │     - decide images/ vs attachments/ by mimeType
        │     - writeBinaryFile(subdir, filename, bytes)
        ├── renderMarkdown(blocks, { resolveAssetPath })
        └── writeTextFile(folder, "README.md", frontmatter + heading + body)
```

## What gets preserved

The Markdown output supports the full IR plus inline HTML for things Markdown lacks. See [destination-local.md](../architecture/destination-local.md) for the per-block mapping table.

Key differences from the Notion path:
- All H1-H6 levels are emitted exactly (no clamp).
- Foreground + background color can stack (`<span style="color:X;background-color:Y">`).
- Tables CAN reference files in cells (Markdown allows `[filename](attachments/file.pdf)` inline). The hoisting step that Notion needs is not applied.
- Toggle renders as `<details><summary>` which works in GitHub/most Markdown viewers.

## Common failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Failed to execute 'write' on 'FileSystemWritableFileStream'... Required member is undefined` | Regression — someone passed a bare `Uint8Array` to `.write()` | Wrap in `new Blob(...)`. The test `FakeDir` enforces this. |
| Image files are 15 bytes containing `[object Object]` | Asset bytes corrupted in transit (Uint8Array became `{}` in JSON serialization) | Verify `bytesBase64` is being set in the worker AND decoded in the side panel. |
| Picker cancelled by user | Expected — side panel returns to idle | None. |
| `NotAllowedError` from picker | Permission denied (user dismissed) or running outside a user gesture | Don't await any other promise before `showDirectoryPicker()`. |
| Disk full | OS-level | User-fixable. |

## See also

- [destination-local.md](../architecture/destination-local.md) — full block/inline mapping table.
- [smoke-checklist.md](../../superpowers/qa/smoke-checklist.md) — what to verify after changes here.
