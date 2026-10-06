# Quickstart

## Prerequisites

- Node 20+, pnpm 11+, Chrome 148+ (for `message_serialization` if you opt in; not required).
- An Atlassian Cloud account with API token access.
- A Notion workspace and an integration you control.

## Install and build

```bash
pnpm install
pnpm build
```

`pnpm install` runs `wxt prepare` via postinstall. `pnpm build` produces `.output/chrome-mv3/`.

## Load the extension

1. Open `chrome://extensions`. Enable Developer mode.
2. Click **Load unpacked** and select `.output/chrome-mv3/`.
3. The toolbar icon appears. Click it to open the side panel.

Reload after rebuilds via the reload icon on the extension card — Chrome does not auto-reload extension code.

## Configure tokens

Open the options page from the extension card (or from the side panel's gear icon).

| Field | Where to get it |
|-------|-----------------|
| Atlassian Site URL | e.g. `https://yourorg.atlassian.net` |
| Atlassian Email | The account that owns the API token |
| Atlassian API Token | https://id.atlassian.com/manage-profile/security/api-tokens |
| Notion Integration Token | https://www.notion.so/my-integrations — create a new integration, copy the secret |

Click **Test** next to each section to verify credentials. Click **Save**. See [features/token-configuration.md](features/token-configuration.md) for details.

**Notion integration must be added to each parent page** you want to publish into. In Notion: open the parent page → top-right menu → Connections → add your integration.

## First capture

1. Open a Confluence page (`https://*.atlassian.net/wiki/spaces/*/pages/*`).
2. Click the WikiBridge toolbar icon — the side panel opens and detects the page title.
3. Choose **Notion**, pick a parent page from the dropdown, click **Capture page**.
4. Watch progress messages. On success, click **Open in Notion**.

For local capture: choose **Local file**, click Capture, pick an empty folder. Output goes to `<slug>-<timestamp>/{README.md, images/, attachments/}`.

## Run tests

```bash
pnpm test          # vitest run
pnpm test:watch    # watch mode
pnpm tsc --noEmit  # type check only
```

## Develop

WXT dev server is available via `pnpm dev` but is rarely used for this project — most iteration is `pnpm build` + reload extension in Chrome.

For end-to-end verification of capture behavior, follow [docs/superpowers/qa/smoke-checklist.md](../superpowers/qa/smoke-checklist.md).
