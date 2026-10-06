import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  manifest: {
    name: "WikiBridge",
    description: "Capture Confluence pages to Notion or local Markdown.",
    permissions: ["storage", "sidePanel", "alarms", "activeTab"],
    host_permissions: [
      "https://*.atlassian.net/*",
      "https://api.notion.com/*",
    ],
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "Open WikiBridge",
    },
  },
});
