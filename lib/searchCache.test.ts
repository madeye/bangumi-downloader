import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-cache-test-"));
process.env.CACHE_DB_PATH = path.join(tmpDir, "cache.sqlite");

const { buildCacheKey, searchTorrents } = await import("@/lib/search");
const { cacheGet, cacheSet } = await import("@/lib/cache");
import type { SearchQuery, SearchResponse } from "@/lib/types";

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function key(q: SearchQuery, useLlm = true) {
  return buildCacheKey(q, useLlm);
}

describe("buildCacheKey similarity normalization", () => {
  it("ignores surrounding whitespace and case", () => {
    expect(key({ keyword: "  Frieren  " })).toBe(key({ keyword: "frieren" }));
  });

  it("collapses internal whitespace", () => {
    expect(key({ keyword: "frieren\tbeyond   journey's\nend" })).toBe(
      key({ keyword: "frieren beyond journey's end" })
    );
  });

  it("treats full-width and half-width as equivalent (NFKC)", () => {
    expect(key({ keyword: "ＧＱｕｕｕｕｕｕｕｘ" })).toBe(
      key({ keyword: "GQuuuuuuux" })
    );
  });

  it("ignores source order", () => {
    expect(key({ keyword: "x", sources: ["nyaa", "dmhy"] })).toBe(
      key({ keyword: "x", sources: ["dmhy", "nyaa"] })
    );
  });

  it("treats omitted sources the same as empty array", () => {
    expect(key({ keyword: "x" })).toBe(key({ keyword: "x", sources: [] }));
  });

  it("distinguishes different keywords", () => {
    expect(key({ keyword: "frieren" })).not.toBe(key({ keyword: "bocchi" }));
  });

  it("distinguishes script preference", () => {
    expect(key({ keyword: "x", scriptPreference: "simplified" })).not.toBe(
      key({ keyword: "x", scriptPreference: "traditional" })
    );
  });

  it("distinguishes useLlm flag", () => {
    expect(key({ keyword: "x" }, true)).not.toBe(key({ keyword: "x" }, false));
  });

  it("distinguishes pagination", () => {
    expect(key({ keyword: "x", limit: 10, offset: 0 })).not.toBe(
      key({ keyword: "x", limit: 10, offset: 10 })
    );
  });
});

describe("cache hit rate for similar queries", () => {
  it("achieves 100% hit rate on a stream of cosmetic variants", () => {
    const variants: SearchQuery[] = [
      { keyword: "Frieren" },
      { keyword: "frieren" },
      { keyword: "  FRIEREN  " },
      { keyword: "frieren\t" },
      { keyword: "Ｆｒｉｅｒｅｎ" }
    ];

    const canonical = key(variants[0]);
    const payload = { hit: true };
    cacheSet(canonical, payload, 60);

    let hits = 0;
    for (const v of variants) {
      if (cacheGet(key(v))) hits++;
    }
    expect(hits).toBe(variants.length);
  });

  it("misses for genuinely different queries", () => {
    cacheSet(key({ keyword: "bocchi" }), { v: 1 }, 60);
    expect(cacheGet(key({ keyword: "frieren-other" }))).toBeUndefined();
  });
});

function mkResponse(query: SearchQuery, refined: boolean, total: number): SearchResponse {
  return {
    query,
    total,
    warnings: [],
    groups: [{ key: refined ? "refined" : "fast", series: "S", items: [] }],
    ungrouped: [],
    refined
  };
}

describe("searchTorrents cache resolution", () => {
  it("promotes a cached refined response on the fast path (useLlm=false)", async () => {
    const query: SearchQuery = { keyword: "promote-me" };
    cacheSet(buildCacheKey(query, true), mkResponse(query, true, 3), 60);

    const result = await searchTorrents(query, { useLlm: false });

    expect(result.refined).toBe(true);
    expect(result.total).toBe(3);
    expect(result.groups[0]?.key).toBe("refined");
  });

  it("returns a cached refined response directly when useLlm=true", async () => {
    const query: SearchQuery = { keyword: "direct-refined" };
    cacheSet(buildCacheKey(query, true), mkResponse(query, true, 7), 60);

    const result = await searchTorrents(query, { useLlm: true });

    expect(result.refined).toBe(true);
    expect(result.total).toBe(7);
  });

  it("falls back to the fast cache when no refined entry exists (useLlm=false)", async () => {
    const query: SearchQuery = { keyword: "only-fast" };
    cacheSet(buildCacheKey(query, false), mkResponse(query, false, 2), 60);

    const result = await searchTorrents(query, { useLlm: false });

    expect(result.refined).toBe(false);
    expect(result.total).toBe(2);
    expect(result.groups[0]?.key).toBe("fast");
  });

  it("prefers the refined cache over the fast cache when both exist", async () => {
    const query: SearchQuery = { keyword: "both-cached" };
    cacheSet(buildCacheKey(query, false), mkResponse(query, false, 2), 60);
    cacheSet(buildCacheKey(query, true), mkResponse(query, true, 5), 60);

    const result = await searchTorrents(query, { useLlm: false });

    expect(result.refined).toBe(true);
    expect(result.total).toBe(5);
  });

  it("does not cross-promote across different script preferences", async () => {
    const simplified: SearchQuery = { keyword: "x", scriptPreference: "simplified" };
    const traditional: SearchQuery = { keyword: "x", scriptPreference: "traditional" };
    cacheSet(buildCacheKey(simplified, true), mkResponse(simplified, true, 99), 60);

    const hit = cacheGet<SearchResponse>(buildCacheKey(traditional, true));
    expect(hit).toBeUndefined();
  });

  it("does not cross-promote across different source selections", async () => {
    const a: SearchQuery = { keyword: "x", sources: ["nyaa"] };
    const b: SearchQuery = { keyword: "x", sources: ["dmhy"] };
    cacheSet(buildCacheKey(a, true), mkResponse(a, true, 1), 60);

    expect(cacheGet<SearchResponse>(buildCacheKey(b, true))).toBeUndefined();
  });

  it("treats expired refined entries as a miss (does not promote stale data)", async () => {
    const query: SearchQuery = { keyword: "expired" };
    cacheSet(buildCacheKey(query, true), mkResponse(query, true, 42), -1);

    expect(cacheGet<SearchResponse>(buildCacheKey(query, true))).toBeUndefined();
  });
});
