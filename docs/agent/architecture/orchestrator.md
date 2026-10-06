# Orchestrator

Directory: [`src/orchestrator/`](../../../src/orchestrator/).

| File | Role |
|------|------|
| `orchestrator.ts` | `runCapture()` and `fetchPageOnly()` — the two top-level entry points called from the service worker. |
| `keepalive.ts` | `startKeepalive()` / `stopKeepalive()` / `isKeepaliveAlarm(name)`. |

## `runCapture`

```ts
runCapture({ pageId, source, destination, onProgress }) → { page, result }
  startKeepalive()
  try {
    onProgress("Fetching page")
    page = await source.fetchPage(pageId)
    result = await destination.publish(page, { onProgress })
  } finally {
    stopKeepalive()
  }
```

`onProgress` is the caller's callback (the background worker turns it into a `chrome.runtime.sendMessage` broadcast).

## `fetchPageOnly`

Used by the local destination path. The worker fetches the IR (and assets) and posts it back to the side panel, which runs the destination locally because `FileSystemDirectoryHandle` can't cross the service-worker boundary.

```ts
fetchPageOnly({ pageId, source, onProgress }) → Page
  startKeepalive()
  try { return await source.fetchPage(pageId) }
  finally { stopKeepalive() }
```

The worker post-processes the returned `Page` to base64-encode asset bytes before posting. See [background-service-worker.md](background-service-worker.md).

## Keepalive

`chrome.alarms.create("wikibridge-keepalive", { periodInMinutes: 0.4 })` — fires every ~24 seconds, just under the 30-second idle suspension threshold. The handler in the background worker is a no-op; the alarm firing event itself counts as activity.

`stopKeepalive()` calls `chrome.alarms.clear` to remove the alarm when the capture finishes (success or failure).

`isKeepaliveAlarm(name)` exists so the background's `chrome.alarms.onAlarm` listener can distinguish our heartbeat from any future alarms.

## Why this is a separate module

`runCapture` is the only place that knows about the alarm lifecycle. Sources and destinations stay pure (no Chrome API dependency at the orchestrator-controlled boundary). This is what lets the per-converter unit tests run in Node with no Chrome mock.
