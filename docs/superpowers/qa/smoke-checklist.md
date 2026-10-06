# WikiBridge — Manual Smoke Test

## Prep

In Confluence, create a test page that contains the items below, in order. (Build incrementally — even partial coverage finds bugs.)

### Headings & inline text

- H1, H2, H3, H4, H5, H6 (six headings, distinct text). H1-H4 map directly to Notion `heading_1`..`heading_4`; H5/H6 collapse to `heading_4`. In Markdown they render as `#`/`##`/`###`/`####`/`#####`/`######`.
- A paragraph with **bold**, *italic*, <u>underlined</u>, ~~struck-through~~, and `inline-code` spans, plus one hyperlink to `https://example.com`.
- A paragraph containing **red-colored text** (use Confluence's color picker → red). Should appear red in Notion (`annotations.color: "red"`) and as `<span style="color:red">...</span>` in Markdown.
- A paragraph with an **inlineCard / smart link** to another Confluence or Jira page (paste a URL and choose "Display as smart link"). Should preserve the URL as a clickable link.
- A paragraph **longer than 2000 characters** (paste a long passage). Must not fail with Notion validation 400; should appear as a single visual paragraph.

### Block structure

- Ordered list of 3 items.
- Bulleted list of 3 items, one of them containing a nested 2-item bulleted list. Confirm the nested sub-list is preserved.
- A blockquote.
- A horizontal rule / divider.
- A code block with language `ts` containing a short snippet.
- A code block **longer than 2000 characters** (paste a long file). Must not fail validation; renders as one continuous code block in Notion.
- A Confluence **Expand** block (`/expand`) with a title and some body content. In Notion it should become a clickable **toggle**; in Markdown `<details><summary>title</summary>...</details>`.

### Callouts (Confluence "panel" macro)

- One info, one note, one warning, one success panel. Each should render with the right color/icon in Notion and a `> [variant] ...` bracketed-prefix quote in Markdown.

### Table

- A 3×3 table with a header row.
- A table where one cell contains an **inline file attachment** (insert via `/` → File). Notion table cells can't hold file blocks; the cell should show an italic `[filename]` reference and the actual file block should appear at the bottom of the page under an `## Attachments` heading separated by a divider.
- A table where two cells reference the **same filename** (e.g. both `screenshot.png`). The second occurrence should be disambiguated as `[screenshot.png (2)]` both in the cell text and in the bottom Attachments section.
- A table cell containing a Confluence **date chip** (`/date`). Should render as `YYYY-MM-DD` plain text (not "~" or empty).

### Media

- Two inline images of different file types: one PNG and one JPEG. Both should render inline at full size in Notion; locally, both should land in `images/` and the Markdown should reference them with `![alt](images/<name>)`.
- One inline non-image attachment — e.g. a PDF or a `.docx` — inserted in the body via `/` → File (NOT just uploaded to the page-level Attachments section). Notion: file block with download. Local: written to `attachments/` and linked from the Markdown.

### Reference

Note the page URL — e.g. `https://yourorg.atlassian.net/wiki/spaces/X/pages/12345/Smoke`.

In Notion, create a top-level page called `WikiBridge Smoke` and share it with your integration.

## Load the extension

```bash
cd <repo>/.claude/worktrees/feat+wikibridge-v1   # or wherever the worktree lives
pnpm build
```

In Chrome:

1. Visit `chrome://extensions`, enable Developer mode.
2. "Load unpacked" → select `.output/chrome-mv3/`.
3. Open the WikiBridge options page from the extensions list and enter:
   - Atlassian site URL, email, API token (click **Test**, expect green ✓).
   - Notion integration token (click **Test**, expect green ✓).
4. Click **Save**.

## Capture to Notion

1. Open the Confluence smoke page in a tab.
2. Click the WikiBridge toolbar icon → side panel opens.
3. Confirm the page title appears under "CURRENT PAGE".
4. Choose **Notion**, pick "WikiBridge Smoke" from the parent dropdown.
5. Click **Capture page**.
6. Watch progress messages: "Fetching page", "Downloading ...", "Uploading ...", "Appending ... blocks", "Capture complete."
7. On done, click the destination link.

### Verify in Notion

#### Headings & inline

- [ ] H1, H2, H3, H4 render at distinct sizes.
- [ ] H5 and H6 collapse to H4 (Notion's max heading depth).
- [ ] All 5 inline marks visible (bold / italic / underline / strike / inline code).
- [ ] Red text is actually red (not black).
- [ ] Hyperlink is clickable and goes to example.com.
- [ ] Smart link / inlineCard preserved as a clickable link.
- [ ] The >2000-char paragraph rendered without a 400 error and reads as one continuous block (Notion may show multiple internal rich_text spans but the visual result is seamless).

#### Block structure

- [ ] Ordered list 3 items, in order.
- [ ] Bulleted list 3 items, with the nested 2-item sublist preserved.
- [ ] Blockquote rendered as a Notion quote block.
- [ ] Horizontal rule rendered as a divider.
- [ ] Code block shows the right language syntax highlighting and exact content.
- [ ] >2000-char code block still renders as one contiguous code block, no truncation.
- [ ] Confluence Expand became a Notion toggle; clicking it reveals the body.

#### Callouts

- [ ] Info / note / warning / success callouts render with the right background color and emoji icon.

#### Table

- [ ] Simple 3×3 table renders with header row.
- [ ] Cell containing inline attachment shows italic `[filename]` reference.
- [ ] Page bottom has a divider + `## Attachments` heading + the hoisted file block(s).
- [ ] Hoisted file block is clickable (downloads the file).
- [ ] Duplicate filenames appear as `name`, `name (2)`, `name (3)` matching cell references to bottom file blocks 1:1 in order.
- [ ] Date chip inside table cell renders as `YYYY-MM-DD` text.

#### Media

- [ ] Both inline images render inline (not broken icons).
- [ ] Non-image inline attachment (PDF/docx) shows as a Notion file block, clickable for download.

## Capture to local

1. Reload the smoke page tab.
2. In the side panel, switch to **Local file**.
3. Click **Capture page**. Pick an empty folder when prompted.
4. After "Capture complete", open the folder.

### Verify on disk

#### File layout

- [ ] A subfolder named `<slug>-<YYYYMMDD-HHMM>/` exists.
- [ ] Contains `README.md`, `images/`, `attachments/`.
- [ ] `images/` files are real image bytes (NOT 15-byte `[object Object]` placeholders — check sizes are KB/MB, and open one to confirm).
- [ ] `attachments/` contains the non-image file with its original filename.

#### `README.md` content

- [ ] YAML frontmatter at top with `title`, `sourceUrl`, `capturedAt`.
- [ ] `# <Page title>` H1 heading appears right after the frontmatter (above the body).
- [ ] All inline marks rendered: `**bold**`, `*italic*`, `<u>underline</u>`, `~~strike~~`, `` `code` ``.
- [ ] Red text wrapped in `<span style="color:red">...</span>`.
- [ ] Hyperlinks render as `[text](url)`.
- [ ] Image references use `![alt](images/<name>)` and the linked files exist.
- [ ] Attachment references use `[filename](attachments/<name>)` and the linked files exist.
- [ ] Code blocks have correct language fence (` ```ts `).
- [ ] Callouts use `> [info] …` / `> [warning] …` etc. prefix.
- [ ] Confluence Expand rendered as `<details><summary>title</summary>...</details>` (or `Details` when title is empty).
- [ ] Date chip rendered as `YYYY-MM-DD`.
- [ ] Table rows formatted as Markdown pipe tables; cells with attachments contain inline `[filename](attachments/<name>)` references.

## Negative tests

- [ ] With Atlassian token cleared in Options, the side panel disables Capture and shows a "Configure" link.
- [ ] With Notion token cleared in Options, the Notion destination button is disabled with a "Configure Notion" link.
- [ ] On a non-Confluence tab (e.g. google.com), the side panel shows "Open a Confluence page in the active tab to capture it" and Capture is disabled.
- [ ] On a Confluence page that contains an unknown ADF macro (e.g. a third-party macro), the macro degrades to a paragraph (or is dropped if it has no text content) — no exception thrown, capture completes with at most a logged warning.

## Known issues

These are tracked in `docs/superpowers/qa/known-issues.md` and are expected behaviors today:

- **Side panel does not auto-refresh** when the user switches tabs or navigates the active tab. Work around by closing and reopening the side panel.

## After each smoke pass

If any item fails, capture:

1. The exact Confluence page URL.
2. A screenshot of the side panel's "Capture finished" status (especially any issue messages).
3. For local-file failures, the contents of the produced folder (`ls -la`, and `file` on suspicious binaries).
4. For Notion failures, the resulting Notion page URL plus the error string from the side panel.

Open service-worker DevTools (`chrome://extensions` → WikiBridge → "Inspect views: service worker") to see any `console.error` from the background.
