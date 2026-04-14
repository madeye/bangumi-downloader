import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Each test run gets its own throwaway DB — set CACHE_DB_PATH before the
// cache module loads so its memoized handle points at the temp file.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-test-"));
process.env.CACHE_DB_PATH = path.join(tmpDir, "cache.sqlite");

const { cacheGet, cacheSet } = await import("@/lib/cache");

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("cache", () => {
  it("returns undefined on miss", () => {
    expect(cacheGet("missing")).toBeUndefined();
  });

  it("round-trips a payload", () => {
    cacheSet("k1", { hello: "world" }, 60);
    expect(cacheGet("k1")).toEqual({ hello: "world" });
  });

  it("treats expired entries as misses", () => {
    cacheSet("k2", "value", -1); // already expired
    expect(cacheGet("k2")).toBeUndefined();
  });

  it("overwrites on repeated set", () => {
    cacheSet("k3", "a", 60);
    cacheSet("k3", "b", 60);
    expect(cacheGet("k3")).toBe("b");
  });
});
