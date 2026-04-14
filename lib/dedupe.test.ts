import { describe, expect, it } from "vitest";
import { dedupeItems } from "@/lib/dedupe";
import type { SearchResultItem } from "@/lib/types";

function mkItem(overrides: Partial<SearchResultItem>): SearchResultItem {
  return {
    id: Math.random().toString(36),
    title: "Untitled",
    source: "nyaa",
    tags: [],
    ...overrides
  };
}

describe("dedupeItems", () => {
  it("collapses items with the same infoHash", () => {
    const a = mkItem({ id: "1", infoHash: "abc", source: "nyaa", seeders: 10, size: "1 GB" });
    const b = mkItem({ id: "2", infoHash: "ABC", source: "dmhy", magnetUrl: "magnet:?xt=urn:btih:abc" });
    const [merged] = dedupeItems([a, b]);
    expect(merged.sources).toEqual(expect.arrayContaining(["nyaa", "dmhy"]));
    expect(merged.mirrors?.map((m) => m.source).sort()).toEqual(["dmhy", "nyaa"]);
    // nyaa record is richer (has seeders + size) so it wins as primary.
    expect(merged.source).toBe("nyaa");
    expect(merged.seeders).toBe(10);
  });

  it("falls back to normalized title when infoHash is missing", () => {
    const a = mkItem({ id: "1", title: "[Group] Show / Show [01]", source: "acg-rip" });
    const b = mkItem({ id: "2", title: "[GROUP]  Show / Show [01]", source: "dmhy" });
    const deduped = dedupeItems([a, b]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sources?.length).toBe(2);
  });

  it("does not merge clearly distinct titles", () => {
    const a = mkItem({ id: "1", title: "Show A [01]" });
    const b = mkItem({ id: "2", title: "Show B [01]" });
    expect(dedupeItems([a, b])).toHaveLength(2);
  });

  it("picks the newer publishedAt when merging", () => {
    const a = mkItem({ id: "1", infoHash: "x", publishedAt: "2026-04-01T00:00:00Z" });
    const b = mkItem({ id: "2", infoHash: "x", publishedAt: "2026-04-14T00:00:00Z" });
    const [merged] = dedupeItems([a, b]);
    expect(merged.publishedAt).toBe("2026-04-14T00:00:00Z");
  });
});
