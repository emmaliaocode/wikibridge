# Storage

File: [`src/storage/settings.ts`](../../../src/storage/settings.ts). Thin wrapper around `chrome.storage.local`.

## Schema

```ts
type Settings = {
  atlassian: { siteUrl, email, apiToken } | null;
  notion:    { integrationToken }         | null;
  defaults: {
    lastDestinationType?: "notion" | "local";
    lastNotionParentId?:  string;
  };
};
```

`null` for `atlassian` or `notion` means "not configured yet". `defaults` is always an object.

## API

```ts
getSettings(): Promise<Settings>
saveSettings(value: Settings): Promise<void>
```

`getSettings` reads `atlassian`, `notion`, `defaults` keys via `chrome.storage.local.get(...)` and fills missing keys with `null` / `{}`.

`saveSettings` writes all three keys in one `chrome.storage.local.set` call.

## Why `chrome.storage.local` and not `chrome.storage.sync`

Tokens are device-scoped by design. `chrome.storage.sync` would replicate them to the user's Google account and to any other Chrome profile signed in with that account — outside the threat model. See [scope-and-principles.md](../scope-and-principles.md).

## Why plain text

`chrome.storage.local` is not encrypted at rest, but it is **scoped to the extension** — other extensions and web pages cannot read it. The threat model for v1 trusts the device and the user; adding encryption would require either a passphrase prompt on every capture (bad UX) or a key derived from device fingerprint (security theater).

If a v2 needs to harden this: investigate `webcrypto` with a passphrase, store the encrypted blob in `chrome.storage.local`, prompt once per session.

## Test coverage

`tests/settings.test.ts` mocks `chrome.storage.local` with an in-memory `Map` and round-trips a `Settings` object.

## When to touch this

- New setting (e.g. last-used local directory hint, theme preference) → add to `Settings` and update both functions. Decide whether it belongs in `defaults` (auto-managed) or as a top-level field (user-managed).
- Migration of an existing field → add migration logic in `getSettings` that reads the old shape and rewrites it. Settings are tiny, so eager migration on read is fine.
