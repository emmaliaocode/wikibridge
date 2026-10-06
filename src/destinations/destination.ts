import type { Page } from "@/ir/types";

export type Failure = {
  blockIndex?: number;
  assetId?: string;
  reason: string;
};

export type PublishResult = {
  ok: boolean;
  failures: Failure[];
  destinationUrl?: string;
};

export type PublishContext = {
  onProgress: (message: string) => void;
};

export interface Destination {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  publish(page: Page, ctx: PublishContext): Promise<PublishResult>;
}
