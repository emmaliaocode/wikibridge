# Messaging Protocol

File: [`src/messaging/protocol.ts`](../../../src/messaging/protocol.ts).

Typed request/response shapes between the side panel (sender) and the background worker (handler).

## Requests (`WorkerRequest`)

| `type` | Payload | Sent by | Handler |
|--------|---------|---------|---------|
| `capture` | `pageId`, `destination: { kind: "notion", parentPageId } \| { kind: "local-deferred" }` | Side panel on Capture click (Notion only — local takes a different path) | `runCapture` |
| `fetch-page` | `pageId` | Side panel on Capture click (Local only) | `fetchPageOnly` + base64-encode assets |
| `search-notion-parents` | `query: string` | Side panel when Notion picked + settings loaded | `NotionApi.searchParents` |

The `local-deferred` capture branch is **not** routed through `runCapture` in the worker — it's an explicit marker that the side panel handles the destination itself. The handler in the background worker throws if it ever sees `local-deferred`, which is a defensive guard against future refactors that might mistakenly send capture-via-worker for local.

## Responses (`WorkerResponse`)

| `type` | Payload | Delivery channel | When |
|--------|---------|------------------|------|
| `progress` | `message: string` | `chrome.runtime.sendMessage` (broadcast) | Streamed during a capture. |
| `done` | `ok`, `failures[]`, `destinationUrl?` | `sendResponse` | Terminal success / partial success. |
| `error` | `message: string` | `sendResponse` | Terminal fatal error (settings missing, network failure that prevented start). |
| `fetch-page-result` | `page: Page` (with `asset.bytesBase64`) | `sendResponse` | Terminal for `fetch-page` request. |
| `search-notion-parents-result` | `results: { id, title, url }[]` | `sendResponse` | Terminal for `search-notion-parents`. |

## Three-message pattern

One request maps to **N+1 messages**: N progress events followed by one terminal response.

```
client                                worker
  │   sendMessage(req, callback)      │
  ├──────────────────────────────────►│
  │                                   │ (start work)
  │   broadcast: progress             │
  │◄──────────────────────────────────│
  │   broadcast: progress             │
  │◄──────────────────────────────────│
  │   ... more progress ...           │
  │                                   │
  │   sendResponse(done)              │
  │◄──────────────────────────────────│
  │  (callback fires; channel closes) │
```

### Why two channels

`sendResponse` is **one-shot** — after the first call, the channel is closed. To stream progress, the worker uses `chrome.runtime.sendMessage(progressMsg)` (broadcast), and the side panel listens with `chrome.runtime.onMessage.addListener(handler)`. The final `done`/`error`/`...-result` goes through `sendResponse` so the side panel's request promise resolves.

The side panel helper `sendWithProgress` in `App.tsx` wires both: registers a temporary `onMessage` listener for progress, sends the request, removes the listener on terminal.

## Why `local-deferred` is a separate kind

The local destination cannot be invoked from the worker (filesystem handles don't cross runtimes). Rather than overload `capture` with conditional logic, the side panel explicitly emits `fetch-page` for the local branch and runs `LocalDestination.publishToHandle` itself.

`{ kind: "local-deferred" }` in the `CaptureRequest` union exists for future flexibility but is currently rejected by the handler. It documents the intent and reserves space if a future architecture wants to route through the orchestrator with a serializable directory token.
