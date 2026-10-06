import { describe, expect, it } from "vitest";
import { getSource, registerSource } from "@/sources/registry";
import type { Source } from "@/sources/source";

class FakeSource implements Source {
  readonly id = "fake";
  async fetchPage() {
    return {
      id: "x",
      title: "x",
      sourceUrl: "x",
      capturedAt: "x",
      blocks: [],
      assets: [],
    };
  }
}

describe("source registry", () => {
  it("registers and retrieves a source by id", () => {
    registerSource("fake", () => new FakeSource());
    const s = getSource("fake");
    expect(s.id).toBe("fake");
  });

  it("throws for unknown id", () => {
    expect(() => getSource("nope")).toThrow(/unknown source/i);
  });
});
