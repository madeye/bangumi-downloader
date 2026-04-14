import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-cache-test-"));
process.env.CACHE_DB_PATH = path.join(tmpDir, "cache.sqlite");

const { buildCacheKey } = await import("@/lib/search");
const { cacheGet, cacheSet } = await import("@/lib/cache");
import type { SearchQuery } from "@/lib/types";

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
