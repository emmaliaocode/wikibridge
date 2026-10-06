export type Mark = "bold" | "italic" | "underline" | "strike" | "code";

export type TextColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export type Inline =
  | { type: "text"; text: string; marks?: Mark[]; color?: TextColor; backgroundColor?: TextColor }
  | { type: "link"; href: string; inlines: Inline[] }
  | { type: "attachmentRef"; assetId: string; inlines: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Block[][] }
  | { type: "code"; language?: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | {
      type: "callout";
      variant: "info" | "note" | "warning" | "success";
      blocks: Block[];
    }
  | { type: "toggle"; title: string; blocks: Block[] }
  | { type: "table"; rows: Block[][][] }
  | { type: "image"; assetId: string; alt?: string; caption?: string }
  | { type: "attachment"; assetId: string; filename: string }
  | { type: "divider" };

export type Asset = {
  id: string;
  filename: string;
  mimeType: string;
  bytes?: Uint8Array;
  fetch?: () => Promise<Uint8Array>;
};

export type Page = {
  id: string;
  title: string;
  sourceUrl: string;
  capturedAt: string;
  blocks: Block[];
  assets: Asset[];
};
