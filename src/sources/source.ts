import type { Page } from "@/ir/types";

export interface Source {
  readonly id: string;
  fetchPage(pageId: string): Promise<Page>;
}
