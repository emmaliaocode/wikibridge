import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, saveSettings, type Settings } from "@/storage/settings";

const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  // Minimal chrome.storage.local mock
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
});

describe("settings", () => {
  it("returns an empty shape when nothing is stored", async () => {
    const s = await getSettings();
    expect(s).toEqual({ atlassian: null, notion: null, defaults: {} });
  });

  it("round-trips a saved value", async () => {
    const value: Settings = {
      atlassian: {
        siteUrl: "https://x.atlassian.net",
        email: "e@x.com",
        apiToken: "T",
      },
      notion: { integrationToken: "secret_y" },
      defaults: { lastDestinationType: "notion" },
    };
    await saveSettings(value);
    expect(await getSettings()).toEqual(value);
  });

  it("persists mode and import defaults", async () => {
    await saveSettings({
      atlassian: { siteUrl: "s", email: "e", apiToken: "t" },
      notion: { integrationToken: "n" },
      defaults: {
        lastMode: "import",
        lastImportSourceId: "local-folder",
        lastImportSpaceId: "100",
        lastImportParentId: "42",
      },
    });
    const s = await getSettings();
    expect(s.defaults?.lastMode).toBe("import");
    expect(s.defaults?.lastImportSourceId).toBe("local-folder");
    expect(s.defaults?.lastImportSpaceId).toBe("100");
    expect(s.defaults?.lastImportParentId).toBe("42");
  });
});
