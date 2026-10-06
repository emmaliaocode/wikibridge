# Options Page

Entry: [`src/entrypoints/options/`](../../../src/entrypoints/options/). Single React component.

## Form fields

| Section | Field | Stored as |
|---------|-------|-----------|
| Atlassian | Site URL | `settings.atlassian.siteUrl` |
| Atlassian | Email | `settings.atlassian.email` |
| Atlassian | API Token | `settings.atlassian.apiToken` (masked input, "Show" toggle) |
| Notion | Integration Token | `settings.notion.integrationToken` (masked input, "Show" toggle) |

## Test buttons

Each section has a **Test** button that performs a minimal authenticated API call:

| Section | Endpoint | Success criterion |
|---------|----------|-------------------|
| Atlassian | `GET /wiki/api/v2/spaces?limit=1` with Basic auth | `res.ok` |
| Notion | `GET /v1/users/me` via `NotionApi.whoami()` | `res.ok` |

Inline result shows green check + "Connected (as <name>)" or red cross + error.

## Save

Save is **explicit** — no autosave. Reason: a half-typed token can overwrite a working one. The Save button calls `saveSettings(value)` and shows a brief "Saved." confirmation for 2 seconds.

## Token visibility

Tokens render as `<input type="password">` by default. The "Show" toggle flips the input type without re-rendering value. Visibility state is local to the component (not persisted) — refresh hides them again.

## Open from extension

Triggered by:
- Clicking the extension card's **Details → Extension options** in `chrome://extensions`.
- Clicking the gear icon in the side panel header, which calls `chrome.runtime.openOptionsPage()`.

## Settings flow

```
mount → getSettings() → setSettings(value)
   ↓
user edits fields → setSettings(...merged)   (in-memory only)
   ↓
click Save → saveSettings(value)              (persisted to chrome.storage.local)
```

The options page does not subscribe to storage changes. Multiple options tabs open at once will overwrite each other on Save — but this is acceptable v1 behavior (the UI is rarely opened from two tabs).

## Why no design system

The options page surface is small (~5 fields, 2 sections). A design system or component library would add weight without payoff. Inline styles are fine.
