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

  it("derives infoHash from magnet URL when provider omits it", () => {
    const magnet = "magnet:?xt=urn:btih:ABC123DEF&dn=Show";
    const a = mkItem({ id: "1", title: "Slightly different title A", source: "acg-rip", magnetUrl: magnet });
    const b = mkItem({ id: "2", title: "Slightly different title B", source: "dmhy", magnetUrl: magnet });
    const c = mkItem({ id: "3", title: "Slightly different title C", source: "nyaa", infoHash: "abc123def", seeders: 10 });
    const deduped = dedupeItems([a, b, c]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sources?.sort()).toEqual(["acg-rip", "dmhy", "nyaa"]);
  });

  it("matches base32 and hex btih encodings as the same hash", () => {
    // 6YLZJMMOIO7EKWVFNPN4KTKQGTGIDIXJ (base32) == f61794b18e43be455aa56bdbc54d5034cc81a2e9 (hex)
    const a = mkItem({ id: "1", source: "nyaa", infoHash: "f61794b18e43be455aa56bdbc54d5034cc81a2e9", seeders: 5 });
    const b = mkItem({
      id: "2",
      source: "dmhy",
      magnetUrl: "magnet:?xt=urn:btih:6YLZJMMOIO7EKWVFNPN4KTKQGTGIDIXJ"
    });
    const deduped = dedupeItems([a, b]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sources?.sort()).toEqual(["dmhy", "nyaa"]);
  });

  it("merges titles that differ only in the romaji/english segment after '/'", () => {
    const a = mkItem({ id: "1", source: "acg-rip", title: "[Grp] 某番 / English Name - 01 [1080p]" });
    const b = mkItem({ id: "2", source: "dmhy", title: "[Grp] 某番 / Different Translation - 01 [1080p]" });
    const deduped = dedupeItems([a, b]);
    expect(deduped).toHaveLength(1);
  });

  it("picks the newer publishedAt when merging", () => {
    const a = mkItem({ id: "1", infoHash: "x", publishedAt: "2026-04-01T00:00:00Z" });
    const b = mkItem({ id: "2", infoHash: "x", publishedAt: "2026-04-14T00:00:00Z" });
    const [merged] = dedupeItems([a, b]);
    expect(merged.publishedAt).toBe("2026-04-14T00:00:00Z");
  });
});
