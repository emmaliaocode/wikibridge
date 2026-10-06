# Extension Manifest and MV3 Quirks

Domain-specific reference for the Chrome MV3 environment WikiBridge runs in.

## Manifest source

The manifest is **generated** by WXT from `wxt.config.ts`. Do not look for a static `manifest.json` in the source tree — it doesn't exist until `pnpm build` writes `.output/chrome-mv3/manifest.json`.

After every manifest change:

```bash
pnpm build
cat .output/chrome-mv3/manifest.json
```

Verify the generated fields match intent before reloading the extension.

## Manifest fields

| Field | Value | Why |
|-------|-------|-----|
| `manifest_version` | 3 | WXT default for `chrome-mv3` target. |
| `permissions.storage` | required | Token + defaults persistence via `chrome.storage.local`. |
| `permissions.sidePanel` | required | Calling `chrome.sidePanel.setPanelBehavior(...)`. |
| `permissions.alarms` | required | Service-worker keepalive heartbeat. |
| `permissions.activeTab` | required | Reading the active tab's URL to detect the Confluence page id. |
| `host_permissions["https://*.atlassian.net/*"]` | required | `fetch()` Confluence REST from the service worker without CORS preflight friction. |
| `host_permissions["https://api.notion.com/*"]` | required | `fetch()` Notion REST and file-upload endpoints. |
| `side_panel.default_path` | `sidepanel.html` | Path is relative to `.output/chrome-mv3/`. WXT generates the file from `src/entrypoints/sidepanel/`. |
| `action.default_title` | `Open WikiBridge` | Toolbar icon hover text. No `default_popup` — click opens the side panel via `setPanelBehavior({ openPanelOnActionClick: true })`. |

## WXT layout convention

`wxt.config.ts` declares `srcDir: "src"`. As a result:

- Entrypoints live under `src/entrypoints/` (NOT `entrypoints/` at the repo root).
- WXT's Vite alias `@:` resolves to `srcDir`, which matches the TS path alias `@/*` → `./src/*`. Both runtime and compile time agree.

Adding a new entrypoint (e.g. a popup): create `src/entrypoints/popup/index.html` + `main.tsx`. WXT auto-discovers.

## Static assets and build output

| Path | Contents | Notes |
|------|----------|-------|
| `public/icon/{16,32,48,96,128}.png` | Toolbar and extension-store icons. | WXT auto-wires these into `manifest.icons` and `action.default_icon` based on filename — no manifest entry needed. Replace files in place to change the icon. |
| `public/wxt.svg`, `assets/react.svg` | WXT scaffold leftovers, unused at runtime. | Safe to delete; kept for now to avoid touching the scaffold. |
| `.output/chrome-mv3/` | Build artefact written by `pnpm build`. | Load this folder via Chrome's "Load unpacked". Never edit — every build wipes and rewrites it. |
| `.output/chrome-mv3/manifest.json` | Generated manifest. | The authoritative source after a build. Spot-check it whenever `wxt.config.ts` changes (permissions, host permissions, side panel path). |
| `.wxt/` | WXT's internal type-generation cache. | `pnpm install` runs `wxt prepare` and populates this. Do not commit changes here. |

Adding a new icon size: drop the PNG into `public/icon/<size>.png` — WXT picks it up by filename convention.

Adding a non-icon static asset (a font, a stylesheet, etc.): drop it under `public/`. The whole `public/` tree is copied into `.output/chrome-mv3/` verbatim and is referenced from your code with a root-relative path (e.g. `/my-font.woff2`).

## MV3 service worker model

The background service worker (`src/entrypoints/background.ts`) is the persistent message router. Chrome may suspend it after ~30 seconds of idle. Implications:

- Long captures (multiple images, big attachments) need keepalive. The orchestrator wraps `runCapture()` in `startKeepalive() ... stopKeepalive()`. See [architecture/orchestrator.md](architecture/orchestrator.md).
- Module-scope state is unreliable across suspensions. All state must live in `chrome.storage.local` or be re-derived per message.
- `chrome.runtime.lastError` must be checked after `sendMessage` callbacks; the sender may have gone away.

## Known MV3 quirks we work around

### 1. `chrome.runtime.sendMessage` uses JSON serialization, not structured clone

`Uint8Array` survives `JSON.stringify` as `{}` — every byte is gone. Asset bytes are encoded as base64 in the background worker before posting; the side panel decodes them back. See [architecture/background-service-worker.md](architecture/background-service-worker.md).

Chrome 148+ supports opt-in structured clone via `"message_serialization": "structured_clone"` in the manifest. We do not opt in — base64 works on all versions and is small enough.

### 2. `sendResponse` is one-shot

A message handler that returns `true` keeps the channel open for one async `sendResponse`. Subsequent calls are no-ops. To stream progress, the background broadcasts `progress` events via `chrome.runtime.sendMessage(...)` (not `sendResponse`), and the side panel listens via `chrome.runtime.onMessage.addListener`. The final `done` / `error` / `fetch-page-result` goes through `sendResponse`. See [architecture/messaging.md](architecture/messaging.md).

### 3. `FileSystemWritableFileStream.write()` does not accept bare `Uint8Array`

It requires a `Blob` or a `WriteParams` object with a `type` field. The error is the cryptic `Failed to read the 'type' property from 'WriteParams': Required member is undefined.` We wrap all writes in `new Blob([bytes])`. See [architecture/destination-local.md](architecture/destination-local.md).

### 4. `showDirectoryPicker()` requires a user gesture

Cannot be invoked from the background worker. The side panel calls it during the user's click handler; the resulting `FileSystemDirectoryHandle` cannot cross runtime boundaries, so local-file capture runs entirely in the side panel after fetching the IR from the worker.

## Reloading

Chrome does not auto-reload extensions. After any rebuild:

1. `chrome://extensions`
2. Click the reload icon on the WikiBridge card.
3. Side panels open before reload should be closed and re-opened.
4. `chrome.storage.local` content is preserved across reloads.
