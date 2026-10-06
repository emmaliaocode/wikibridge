# Adding a New Destination

How to add Obsidian, Joplin, Bear, or any other destination as a third option alongside Notion and Local Markdown.

## The contract

[`src/destinations/destination.ts`](../../../src/destinations/destination.ts) defines:

```ts
interface Destination {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  publish(page: Page, ctx: PublishContext): Promise<PublishResult>;
}
```

`PublishContext` has one method: `onProgress(message: string)`. Use it to drive the side panel's progress UI.

`PublishResult` is `{ ok, failures: Failure[], destinationUrl? }`. Best-effort: collect failures into the array; do not throw for per-asset or per-block problems.

## Step 1: write the IR → target renderer

Pure function. No I/O, no async. Mirror [`ir-to-markdown.ts`](../../../src/destinations/local/ir-to-markdown.ts) or [`ir-to-notion.ts`](../../../src/destinations/notion/ir-to-notion.ts):

```ts
// src/destinations/<name>/ir-to-<name>.ts
import type { Block, Inline, Mark } from "@/ir/types";

export function renderForFoo(blocks: Block[], opts: ...): string | unknown {
  // walk blocks, emit target format
}
```

Cover all IR block and inline types. Use the existing renderers as a reference, especially for:
- Long-text chunking (Notion 2000-char limit).
- Table-cell limitations (Notion can't put blocks in cells).
- Asset reference resolution via callback.

Write `tests/ir-to-<name>.test.ts` with one assertion per block type plus edge cases.

## Step 2: write the API client

If the destination is over HTTP, mirror [`notion-api.ts`](../../../src/destinations/notion/notion-api.ts):

```ts
// src/destinations/<name>/<name>-api.ts
export class FooApi {
  constructor(private token: string) {}
  async createPage(...) { ... }
  async appendContent(...) { ... }
}
```

Use MSW for tests (`tests/<name>-api.test.ts`).

If the destination is filesystem-based, follow [`local-destination.ts`](../../../src/destinations/local/local-destination.ts) — note the FileSystemDirectoryHandle quirks documented there.

## Step 3: write the Destination class

```ts
// src/destinations/<name>/<name>-destination.ts
import type { Destination, PublishContext, PublishResult } from "@/destinations/destination";

export class FooDestination implements Destination {
  readonly id = "foo";
  readonly displayName = "Foo";

  constructor(private config: FooDestinationConfig) {}

  async isConfigured(): Promise<boolean> { ... }

  async publish(page: Page, ctx: PublishContext): Promise<PublishResult> {
    ctx.onProgress("Starting Foo capture");
    const failures: Failure[] = [];
    try {
      // upload assets, render content, send
      return { ok: failures.length === 0, failures, destinationUrl: ... };
    } catch (err) {
      // top-level failure
      return { ok: false, failures: [...failures, { reason: err.message }] };
    }
  }
}
```

Test in `tests/<name>-destination.test.ts`. Stub the API client with MSW or a fake.

## Step 4: extend settings

In [`src/storage/settings.ts`](../../../src/storage/settings.ts), add a new field:

```ts
export type Settings = {
  atlassian: ...;
  notion: ...;
  foo: FooSettings | null;  // ◄── new
  defaults: ...;
};
```

Update `getSettings`/`saveSettings` to round-trip the new key.

## Step 5: wire the worker

In [`src/entrypoints/background.ts`](../../../src/entrypoints/background.ts), extend the `capture` switch:

```ts
if (msg.destination.kind === "foo") {
  if (!settings.foo) throw new Error("Foo not configured");
  const destination = new FooDestination({
    token: settings.foo.token,
    ...
  });
  const { result } = await runCapture({ pageId, source, destination, onProgress: ... });
  reply({ type: "done", ok: result.ok, failures: result.failures, destinationUrl: result.destinationUrl });
  return;
}
```

Update [`src/messaging/protocol.ts`](../../../src/messaging/protocol.ts) `CaptureRequest.destination` union to include `{ kind: "foo", ... }`.

## Step 6: wire the side panel

In [`src/entrypoints/sidepanel/App.tsx`](../../../src/entrypoints/sidepanel/App.tsx):

- Extend `DestKind` union: `"notion" | "local" | "foo"`.
- Add a `<DestButton>` for Foo.
- Add config-missing UI ("Configure Foo to enable this option") gated on `settings.foo`.
- Extend `onCapture` to send `{ kind: "foo", ... }`.

## Step 7: wire the options page

In [`src/entrypoints/options/App.tsx`](../../../src/entrypoints/options/App.tsx):

- Add a new `<section>` for Foo with the same Field/Test/Show pattern.
- Add a `testFoo` handler that calls a minimal liveness endpoint (e.g. `whoami`).

## Step 8: smoke test

Add Foo entries to [`docs/superpowers/qa/smoke-checklist.md`](../../superpowers/qa/smoke-checklist.md):
- Configure Foo tokens, Test buttons green.
- Capture the standard smoke page, verify each content type round-trips.

## Step 9: write the destination-specific architecture doc

Add `docs/agent/architecture/destination-<name>.md` mirroring [destination-notion.md](../architecture/destination-notion.md) or [destination-local.md](../architecture/destination-local.md). Cover:
- API endpoints used.
- Limits worked around.
- Block/mark mapping table.
- Failure modes.

Link it from [README.md](../README.md) and [overview.md](../architecture/overview.md)'s component table.

## Reference implementations

- **HTTP-based**: see [destination-notion.md](../architecture/destination-notion.md). Pipeline: create page → upload assets → append children.
- **Filesystem-based**: see [destination-local.md](../architecture/destination-local.md). Quirks around `FileSystemDirectoryHandle` and `Blob` writes.

## Don't

- Don't bypass the IR. The renderer must consume `Block[]`, not direct ADF.
- Don't add destination-specific fields to the IR. If you need a hint that doesn't fit, pass it via your destination config instead.
- Don't change the `Destination` interface. If you need something new, propose a v2 interface and run both side-by-side first.
- Don't skip MSW tests. The HTTP behavior is the most likely place a bug ships unnoticed.
