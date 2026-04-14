import { describe, expect, it } from "vitest";
import { annotateAndGroup } from "@/lib/grouping";
import type { SearchResultItem } from "@/lib/types";

function mkItem(overrides: Partial<SearchResultItem> & { title: string }): SearchResultItem {
  return {
    id: overrides.id ?? Math.random().toString(36),
    source: "nyaa",
    tags: [],
    ...overrides
  };
}

describe("annotateAndGroup per-episode pruning", () => {
  it("keeps the release with the most seeders per (series, episode)", () => {
    const items = [
      mkItem({ id: "a", title: "[GroupA] Show - 01 [1080p]", seeders: 5 }),
      mkItem({ id: "b", title: "[GroupB] Show - 01 [1080p]", seeders: 50 }),
      mkItem({ id: "c", title: "[GroupA] Show - 02 [1080p]", seeders: 10 }),
      mkItem({ id: "d", title: "[GroupB] Show - 02 [1080p]", seeders: 3 })
    ];
    const { groups } = annotateAndGroup(items);
    expect(groups).toHaveLength(1);
    const ids = groups[0].items.map((i) => i.id).sort();
    expect(ids).toEqual(["b", "c"]);
  });

  it("uses group ranking as a tie-breaker when seeders are equal", () => {
    const items = [
      mkItem({ id: "a", title: "[GroupA] Show - 01 [1080p]", seeders: 10 }),
      mkItem({ id: "b", title: "[GroupB] Show - 01 [1080p]", seeders: 10 })
    ];
    const ranking = new Map([["groupb", 2], ["groupa", 1]]);
    const { groups, ungrouped } = annotateAndGroup(items, undefined, ranking);
    const kept = groups[0]?.items[0]?.id ?? ungrouped[0]?.id;
    expect(kept).toBe("b");
  });

  it("prefers higher resolution when seeders and group rank tie", () => {
    const items = [
      mkItem({ id: "a", title: "[G] Show - 01 [720p]" }),
      mkItem({ id: "b", title: "[G] Show - 01 [1080p]" })
    ];
    const { groups, ungrouped } = annotateAndGroup(items);
    const kept = groups[0]?.items[0]?.id ?? ungrouped[0]?.id;
    expect(kept).toBe("b");
  });

  it("does not prune items without an episode number", () => {
    const items = [
      mkItem({ id: "a", title: "[G] Show Batch 01-12 [1080p]" }),
      mkItem({ id: "b", title: "[G] Show Movie [1080p]" }),
      mkItem({ id: "c", title: "[G] Show - 01 [1080p]" }),
      mkItem({ id: "d", title: "[G] Show - 02 [1080p]" })
    ];
    const { groups, ungrouped } = annotateAndGroup(items);
    const allIds = [...groups.flatMap((g) => g.items), ...ungrouped].map((i) => i.id).sort();
    expect(allIds).toEqual(["a", "b", "c", "d"]);
  });

  it("folds simplified/traditional variants into a single bucket and picks by script preference", () => {
    const items = [
      mkItem({ id: "s", title: "[桜都字幕组] 弹珠汽水瓶里的千岁同学 - 01 [1080p]", seeders: 5 }),
      mkItem({ id: "t", title: "[桜都字幕组] 彈珠汽水瓶裡的千歲同學 - 01 [1080p]", seeders: 50 })
    ];
    // User prefers simplified even though traditional has more seeders.
    const { groups, ungrouped } = annotateAndGroup(items, { scriptPreference: "simplified" });
    const all = [...groups.flatMap((g) => g.items), ...ungrouped];
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("s");
  });

  it("falls back to seeders when neither candidate matches the preferred script", () => {
    const items = [
      mkItem({ id: "a", title: "[G] Show - 01 [1080p]", seeders: 5 }),
      mkItem({ id: "b", title: "[G] Show - 01 [1080p]", seeders: 50 })
    ];
    const { groups, ungrouped } = annotateAndGroup(items, { scriptPreference: "simplified" });
    const kept = groups[0]?.items[0]?.id ?? ungrouped[0]?.id;
    expect(kept).toBe("b");
  });

  it("prefers v2 over v1 for same episode from same group, even with fewer seeders", () => {
    const items = [
      mkItem({ id: "v1", title: "[桜都字幕组] Show [01][1080p]", seeders: 100 }),
      mkItem({ id: "v2", title: "[桜都字幕组] Show [01v2][1080p]", seeders: 5 })
    ];
    const { groups, ungrouped } = annotateAndGroup(items);
    const kept = groups[0]?.items[0]?.id ?? ungrouped[0]?.id;
    expect(kept).toBe("v2");
  });

  it("merges cross-language series via seriesRemap before pruning", () => {
    const items = [
      mkItem({ id: "a", title: "[G] 弹珠汽水瓶里的千岁同学 - 01 [1080p]", seeders: 5 }),
      mkItem({ id: "b", title: "[G] 彈珠汽水瓶裡的千歲同學 - 01 [1080p]", seeders: 50 })
    ];
    const remap = new Map([["彈珠汽水瓶裡的千歲同學", "弹珠汽水瓶里的千岁同学"]]);
    const { groups, ungrouped } = annotateAndGroup(items, remap);
    const all = [...groups.flatMap((g) => g.items), ...ungrouped];
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("b");
  });
});
