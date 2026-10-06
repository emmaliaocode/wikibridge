# Background Service Worker

Entry: [`src/entrypoints/background.ts`](../../../src/entrypoints/background.ts).

## Responsibilities

1. Open the side panel on toolbar-icon click (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`).
2. Listen on `chrome.runtime.onMessage` and route requests to handlers.
3. Run captures via the orchestrator.
4. Encode asset bytes as base64 before sending the IR to the side panel.
5. Keep the worker alive during long captures via `chrome.alarms`.

## Message routing

```
chrome.runtime.onMessage → handle(msg, reply) → switch (msg.type)
                                                  ├── "capture"
                                                  ├── "fetch-page"
                                                  └── "search-notion-parents"
```

Each handler:
- Reads `getSettings()` for tokens.
- Instantiates `ConfluenceSource` (and `NotionDestination` if needed).
- Calls into the orchestrator.
- Reports progress and the terminal result via `reply`.

See [messaging.md](messaging.md) for the protocol shapes.

## Two-channel reply pattern

`reply` differentiates progress and terminal messages:

| Reply type | Channel | Why |
|------------|---------|-----|
| `progress` | `chrome.runtime.sendMessage(resp)` (broadcast) | `sendResponse` is one-shot; broadcast lets the side panel's listener pick up multiple events. |
| `done` / `error` / `fetch-page-result` / `search-notion-parents-result` | `sendResponse(resp)` | Resolves the side panel's original `sendMessage` callback. |

`finalSent` guard prevents double `sendResponse`. The handler returns `true` from the `addListener` callback to keep the channel open for the async terminal response.

## Asset base64 transport

Chrome MV3 `chrome.runtime.sendMessage` uses JSON serialization, not structured clone. `Uint8Array` becomes `{}` on the receiver side.

In the `fetch-page` handler (used by the local destination):

```ts
for (const asset of page.assets) {
  let bytes = asset.bytes;
  if (!bytes && asset.fetch) bytes = await asset.fetch();
  if (bytes) {
    (asset as Asset & { bytesBase64?: string }).bytesBase64 =
      uint8ArrayToBase64(bytes);
  }
  delete (asset as { bytes?: unknown }).bytes;
  delete (asset as { fetch?: unknown }).fetch;
}
```

The side panel decodes `bytesBase64` back to `Uint8Array` before invoking `LocalDestination.publishToHandle`. See [side-panel.md](side-panel.md).

The Notion path **does not** need base64 — it runs entirely in the worker, never crossing the boundary.

## Keepalive listener

```ts
chrome.alarms.onAlarm.addListener((alarm) => {
  if (isKeepaliveAlarm(alarm.name)) {
    // no-op; the firing event itself prevents SW suspension
  }
});
```

The alarm is created by the orchestrator and fires every ~24 seconds. See [orchestrator.md](orchestrator.md).

## Error surfacing

`handle()` may throw if settings are missing or downstream errors propagate. The `.catch` on the dispatcher wraps any thrown error into a `{ type: "error", message }` reply, routed through `reply` (which lands on `sendResponse` since `error` is not `progress`).

The orchestrator itself catches per-asset and per-block failures and collects them into `PublishResult.failures[]`. The error reply is reserved for *fatal* errors (missing config, unreachable host, etc.) that prevent a capture from even starting.

## Why this entry point is not unit-tested

Wiring chrome.runtime, chrome.alarms, chrome.sidePanel into a test harness is heavy and brittle. The components this file orchestrates (`runCapture`, `ConfluenceSource`, `NotionDestination`, settings) are independently tested. Integration coverage is the manual smoke test in [`docs/superpowers/qa/smoke-checklist.md`](../../superpowers/qa/smoke-checklist.md).
