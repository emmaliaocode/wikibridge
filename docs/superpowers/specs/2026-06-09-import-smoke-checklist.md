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
