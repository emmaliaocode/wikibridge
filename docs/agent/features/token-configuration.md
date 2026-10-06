# Token Configuration

How users connect WikiBridge to their Atlassian and Notion workspaces.

## Open the options page

From `chrome://extensions` → WikiBridge → **Details** → **Extension options**. Or from the side panel's gear icon (`chrome.runtime.openOptionsPage()`).

## Atlassian setup

| Field | Where to get it |
|-------|-----------------|
| Site URL | The Confluence URL prefix, e.g. `https://yourorg.atlassian.net`. Trailing slash optional. |
| Email | The email tied to your Atlassian account. |
| API Token | <https://id.atlassian.com/manage-profile/security/api-tokens> → Create API token. |

Click **Test**:
- Calls `GET /wiki/api/v2/spaces?limit=1` with Basic auth.
- Green check → connection is good.
- Red cross → the message shows the HTTP status; common causes: wrong site URL, expired/revoked token, email mismatch.

## Notion setup

| Step | Action |
|------|--------|
| 1 | Create an integration at <https://www.notion.so/my-integrations>. |
| 2 | Copy the **Internal Integration Token** (starts with `ntn_` or `secret_`). |
| 3 | Paste into the Notion section in WikiBridge options. |
| 4 | Click **Test** — calls `GET /v1/users/me`. Green check + integration name on success. |
| 5 | **Add the integration to each parent page** you want to publish into: in Notion, open the parent page → **...** menu → **Connections** → search for and add your integration. |

Without step 5, the integration cannot see or write into the parent page even with a valid token. The Notion parent dropdown in the side panel only lists pages the integration has been added to.

## Save

Click **Save**. There is no autosave — partial edits do not overwrite existing values.

A brief "Saved." appears for 2 seconds on success.

## Token rotation

1. Generate a new token (Atlassian: revoke + create new in the management UI; Notion: rotate via the integration settings).
2. Open WikiBridge options, paste the new token, click Test, click Save.
3. The old token can be revoked immediately — WikiBridge only ever uses the saved value.

## Storage

Tokens live in `chrome.storage.local`, scoped to this extension only. They never leave the device. See [scope-and-principles.md](../scope-and-principles.md).

## When the UI hides destinations

The side panel disables a destination button when its tokens are missing:
- No Atlassian credentials → Capture is disabled with a "Configure" link.
- No Notion token → Notion option shows a "Configure Notion to enable this option" link.

The Local destination needs no token (it uses the file system).

## See also

- [architecture/options-page.md](../architecture/options-page.md) for the form implementation.
- [architecture/storage.md](../architecture/storage.md) for the storage schema.
