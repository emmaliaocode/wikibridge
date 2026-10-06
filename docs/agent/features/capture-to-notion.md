# Capture to Notion

End-to-end flow for the primary use case.

## User journey

1. User opens a Confluence Cloud page in a tab.
2. Clicks the WikiBridge toolbar icon — side panel opens.
3. The side panel detects the page via `detectConfluencePageId(tab.url)` and shows the page title under "CURRENT PAGE".
4. User picks **Notion** (default if last used).
5. User picks a parent page from the dropdown (populated lazily via `search-notion-parents`).
6. User clicks **Capture page**.
7. Progress messages stream in the side panel ("Fetching page", "Uploading X.png (3/5)", "Appending 28 blocks").
8. On completion, the panel shows "Capture complete" with **Open in Notion** link. If there were issues, an expandable list shows them.

## What runs internally

```
side panel sendWithProgress("capture", { pageId, parentPageId })
   │
   ▼
background.ts handle()
   │
   ▼
runCapture({ pageId, source: new ConfluenceSource(creds), destination: new NotionDestination({ token, parentPageId }), onProgress })
   │
   ├── ConfluenceSource.fetchPage(pageId)         ──► Page IR with lazy asset.fetch()
   │     └── GET /wiki/api/v2/pages/{id} + /attachments
   │
   └── NotionDestination.publish(page, ctx)
         ├── POST /v1/pages              ──► destination page id + url
         ├── for each asset:             ──► download bytes, POST /v1/file_uploads
         ├── irToNotionBlocks(...)       ──► block JSON (hoisting, chunking, disambig)
         └── PATCH /v1/blocks/{id}/children (chunks of 100)
```

Detailed component docs:
- [architecture/source-confluence.md](../architecture/source-confluence.md) for ADF parsing.
- [architecture/destination-notion.md](../architecture/destination-notion.md) for upload pipeline and block mapping.
- [architecture/orchestrator.md](../architecture/orchestrator.md) for keepalive.

## What gets preserved

| Confluence | Notion |
|------------|--------|
| H1-H6 headings | H1-H4 (H5/H6 collapse to H4) |
| Bold / italic / underline / strike / inline code | Same annotations |
| Hyperlinks | `text.link.url` |
| Smart links (`inlineCard`/`blockCard`) | Plain link to the URL |
| Ordered / bulleted lists with nesting | `numbered_list_item` / `bulleted_list_item` with `children` |
| Code blocks with language | Notion `code` block (language mapped via `LANGUAGE_MAP`; unknown → "plain text") |
| Info/note/warning/success panels | Callouts with icon + colored background |
| Confluence Expand | Notion toggle |
| Tables | Notion table (with hoisting — see below) |
| Inline images | Image blocks (uploaded to Notion file storage) |
| Inline non-image files | File blocks (uploaded to Notion file storage) |
| Text color | `annotations.color` (Confluence hex → nearest of 10 Notion colors) |
| Highlight color | `annotations.color = <name>_background` |
| ADF `date` chip | ISO `YYYY-MM-DD` text |

## What's imperfect

- **H5/H6 → H4**: information loss but rare in practice.
- **Files inside table cells**: Notion forbids them; we move the file blocks to a "Attachments" section at the page bottom and leave an italic `[filename]` reference in the cell. See [destination-notion.md](../architecture/destination-notion.md) for hoisting details.
- **Foreground + background color on the same text**: Notion picks one; we prefer background since it's the dominant visual signal.
- **Unknown Confluence macros**: degrade to plain-text paragraphs with no warning surfaced to the user (logged on the worker console).

## Common failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Atlassian not configured" | Token missing or empty | Open options page, click Test, save. |
| Parent dropdown empty | Notion integration not added to any pages | In Notion, open a parent page → Connections → add WikiBridge integration. |
| `Notion appendChildren failed: 400 ... should be ≤ 2000` | A text/code segment >2000 chars escaped our chunker | Bug — file an issue with the page URL. The chunker covers all rich-text emission sites we know of. |
| `Confluence downloadAttachment failed: 4xx` | Attachment permissions, or the v1 download endpoint was changed by Atlassian | Verify in Confluence UI; if the file shows there, check `confluence-api.ts:downloadAttachment`. |
| Capture hangs after "Appending X blocks" | Network timeout to Notion | Reload extension, retry. If repeatable for the same page, the page may have a structure that triggers a Notion API limit not yet handled. |

## See also

- [smoke-checklist.md](../../superpowers/qa/smoke-checklist.md) for what to verify after a code change to this path.
- [known-issues.md](../../superpowers/qa/known-issues.md) for current gotchas.
