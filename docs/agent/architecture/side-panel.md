# Side Panel UI

Entry: [`src/entrypoints/sidepanel/`](../../../src/entrypoints/sidepanel/). React 19 functional component, ~360 lines.

## State

| State | Type | Source |
|-------|------|--------|
| `pageId` | `string \| null` | Detected from active tab URL via `detectConfluencePageId`. |
| `pageTitle` | `string` | From the active tab's `chrome.tabs` data. |
| `settings` | `Settings \| null` | From `getSettings()` on mount and on tab-change. |
| `destKind` | `"notion" \| "local"` | Last-used value persisted in `Settings.defaults.lastDestinationType`. |
| `parents` | `{ id, title, url }[]` | Fetched lazily when Notion is selected and settings are present. |
| `parentId` | `string` | Persisted in `Settings.defaults.lastNotionParentId`. |
| `phase` | `idle \| working \| done \| error` | Drives the progress and result UI. |

## Effects

1. **Mount**: load settings, detect active tab, listen for `chrome.tabs.onActivated` / `onUpdated` to refresh `pageId` and `pageTitle` on tab changes.
2. **When destKind = "notion" with notion configured**: send `search-notion-parents` to the worker.

## Capture flow

### Notion branch

```
onCapture (Notion)
  ├── persist defaults (lastDestinationType, lastNotionParentId)
  ├── sendWithProgress({ type: "capture", pageId, destination: { kind: "notion", parentPageId } })
  │     ├── streams progress → setPhase("working", message)
  │     └── terminal done → setPhase("done", ok, destinationUrl, failures)
  └── (errors caught into setPhase("error", message))
```

### Local branch

```
onCapture (Local)
  ├── persist defaults
  ├── showDirectoryPicker()   ◄── must be inside the user-gesture
  ├── sendWithProgress({ type: "fetch-page", pageId })
  │     └── terminal fetch-page-result → page with asset.bytesBase64
  ├── for each asset: decode bytesBase64 → Uint8Array, assign to asset.bytes
  ├── new LocalDestination().publishToHandle(dirHandle, page, ctx)
  │     └── streams progress → setPhase
  └── setPhase("done", failures)
```

The local branch is in the side panel (not the worker) because `FileSystemDirectoryHandle` cannot cross the runtime boundary and `showDirectoryPicker` requires a user gesture.

## Messaging helpers

- `sendMessage(req)`: one-shot request, awaits `sendResponse`. Used for `search-notion-parents`.
- `sendWithProgress(req, onProgress)`: registers a `chrome.runtime.onMessage` listener for `progress` events, then sends the request and awaits the terminal response. Listener is removed on terminal.

See [messaging.md](messaging.md).

## UI flow

1. **Idle state**: shows current page, destination picker, parent picker (Notion only), capture button.
2. **Working state**: progress message replaces the button area.
3. **Done state**:
   - Success: link to destination (Notion URL; nothing for local since the FS handle has no URL).
   - With issues: orange status + collapsible failure list.
4. **Error state**: red message.

## Capture button disabling

The button is disabled when:
- No `pageId` (no Confluence tab open).
- Atlassian token not configured.
- Currently working.
- Notion selected but Notion not configured OR no `parentId` picked.

## Settings persistence

Last-used destination and Notion parent persist in `chrome.storage.local`:

```ts
defaults: {
  lastDestinationType?: "notion" | "local";
  lastNotionParentId?: string;
}
```

Settings are saved on every capture click (before sending the request) so values survive panel close.

## Known limitations

- Long-running Local writes are not chunked. If a page has 500 images the side panel iterates them sequentially. Acceptable for v1 scale.
- The Notion parent dropdown is populated from `POST /v1/search` with an empty query — limited to 20 results. If a user has more accessible pages, the desired parent may not appear. Consider adding a text filter in v1.1.
- No "Cancel" affordance during capture. Once the worker starts, the request runs to completion (or error).
