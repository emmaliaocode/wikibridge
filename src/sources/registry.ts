import type { Source } from "./source";

type SourceFactory = () => Source;

const factories = new Map<string, SourceFactory>();

export function registerSource(id: string, factory: SourceFactory): void {
  factories.set(id, factory);
}

export function getSource(id: string): Source {
  const factory = factories.get(id);
  if (!factory) throw new Error(`unknown source: ${id}`);
  return factory();
}

export function listSources(): string[] {
  return [...factories.keys()];
}
