# Architecture Overview

## Three layers

```
┌─────────────────────────────────────────────────────────────────┐
│ UI (browser-side rendered)                                      │
│                                                                 │
│   src/entrypoints/sidepanel/       src/entrypoints/options/     │
│   - capture form                   - token form                 │
│   - destination picker             - Test buttons               │
│   - progress, summary              - explicit Save              │
│   - Local file write path                                       │
└───────────────────┬─────────────────────────────────────────────┘
                    │ chrome.runtime.sendMessage  (typed protocol)
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Service worker  src/entrypoints/background.ts                   │
│                                                                 │
│   Message router  ───►  Orchestrator  src/orchestrator/         │
│                          runCapture / fetchPageOnly             │
│                          chrome.alarms keepalive                │
│                                                                 │
│   Source adapter            ─────►   Destination adapter        │
│   src/sources/confluence/            src/destinations/notion/   │
│   - REST client                      src/destinations/local/    │
│   - ADF parser  ───►   IR    ───►    - REST / fs client         │
│                       (contract)     - IR-to-target converter   │
└───────────────────┬───────────────────────────────────┬─────────┘
                    │ HTTPS                             │ HTTPS / fs
                    ▼                                   ▼
              Confluence Cloud                    Notion API
                                                  FileSystemDirectoryHandle
```

## The IR contract

[`src/ir/types.ts`](../../../src/ir/types.ts) defines the intermediate representation. The full taxonomy is in [ir.md](ir.md).

The IR is the **only** shared vocabulary between sources and destinations. Sources never know about Notion or Markdown; destinations never know about ADF. Adding a new source or destination touches only one side of the IR.

## Component map

| Component | Directory | Responsibility |
|-----------|-----------|----------------|
| Side panel | `src/entrypoints/sidepanel/` | User-facing capture UI. Handles the local-file branch end-to-end (the worker can't hold a `FileSystemDirectoryHandle`). |
| Options page | `src/entrypoints/options/` | Token configuration with live API tests. |
| Background service worker | `src/entrypoints/background.ts` | Message router. Owns the orchestrator. Encodes asset bytes as base64 before responding. |
| Orchestrator | `src/orchestrator/` | Composes a `Source` and a `Destination` into a single `runCapture` call. Manages keepalive. |
| Messaging protocol | `src/messaging/protocol.ts` | Typed request/response shapes between side panel and worker. |
| Storage | `src/storage/settings.ts` | Thin `chrome.storage.local` wrapper. |
| Source: Confluence | `src/sources/confluence/` | REST client + ADF → IR converter + page-id detection. |
| Destination: Notion | `src/destinations/notion/` | REST client + file uploads + IR → Notion blocks. |
| Destination: Local | `src/destinations/local/` | Filesystem writes + IR → Markdown. |
| IR | `src/ir/types.ts` | Type definitions only. No runtime code. |

## Capture data flow

Two branches share the source (Confluence) but route the destination differently:

| Branch | Where destination runs | Why | End-to-end doc |
|--------|------------------------|-----|----------------|
| Notion | Service worker (full pipeline) | Pure HTTP; no browser-only APIs needed. | [features/capture-to-notion.md](../features/capture-to-notion.md) |
| Local | Side panel (after worker fetches IR) | `showDirectoryPicker()` needs a user gesture and `FileSystemDirectoryHandle` cannot cross the worker boundary. Worker base64-encodes asset bytes before posting back. | [features/capture-to-local.md](../features/capture-to-local.md) |

Both paths stream `progress` messages and a terminal `done` / `error` response. See [messaging.md](messaging.md) for the protocol.

## Why this split

| Decision | Reason |
|----------|--------|
| IR-based pipeline | A new destination is one new class. No cross-cutting changes. |
| Adapter pattern | Source and destination interchangeable; orchestrator depends only on interfaces. |
| MV3 service worker for capture | Keeps tokens off the page context (no `localStorage` access from content scripts). |
| Side panel for local writes | `showDirectoryPicker` user-gesture requirement. |
| Base64 asset transport | `chrome.runtime.sendMessage` is JSON, not structured-clone (Chrome <148). |
| Best-effort error collection | Notion appendChildren and asset uploads can partially fail; aborting on one bad block would discard hours of work. |

## Extension points

To add a new destination (Obsidian, Joplin, …): implement [`Destination`](../../../src/destinations/destination.ts), register in `background.ts`, add a side-panel option. See [features/extending-with-new-destination.md](../features/extending-with-new-destination.md).

To add a new source (e.g. Notion-as-source for reverse capture): implement [`Source`](../../../src/sources/source.ts). Currently only Confluence is implemented.
