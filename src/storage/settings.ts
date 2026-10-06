/// <reference types="chrome" />

export type AtlassianSettings = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

export type NotionSettings = {
  integrationToken: string;
};

export type DefaultsSettings = {
  lastDestinationType?: "notion" | "local";
  lastNotionParentId?: string;
  lastMode?: "export" | "import" | "settings";
  lastImportSourceId?: "local-file" | "local-folder" | "notion";
  lastImportSpaceId?: string;
  lastImportParentId?: string;
};

export type Settings = {
  atlassian: AtlassianSettings | null;
  notion: NotionSettings | null;
  defaults: DefaultsSettings;
};

const STORAGE_KEYS = ["atlassian", "notion", "defaults"] as const;

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get([...STORAGE_KEYS]);
  return {
    atlassian: (raw.atlassian as AtlassianSettings | undefined) ?? null,
    notion: (raw.notion as NotionSettings | undefined) ?? null,
    defaults: (raw.defaults as DefaultsSettings | undefined) ?? {},
  };
}

export async function saveSettings(value: Settings): Promise<void> {
  await chrome.storage.local.set({
    atlassian: value.atlassian,
    notion: value.notion,
    defaults: value.defaults,
  });
}
