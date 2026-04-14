import { describe, expect, it } from "vitest";
import { cleanKeyword, formatBytes, normalizeMagnet, toIsoDate } from "@/lib/utils";

describe("formatBytes", () => {
  it("returns bytes for values < 1KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales into higher units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("drops the decimal once the magnitude reaches two digits", () => {
    expect(formatBytes(15 * 1024)).toBe("15 KB");
  });
});

describe("normalizeMagnet", () => {
  const hash = "a".repeat(40);

  it("returns undefined without an info hash", () => {
    expect(normalizeMagnet(undefined)).toBeUndefined();
  });

  it("rejects non-40-hex strings", () => {
    expect(normalizeMagnet("notahash")).toBeUndefined();
    expect(normalizeMagnet("Z".repeat(40))).toBeUndefined();
  });

  it("builds a magnet URL with the title as display name", () => {
    expect(normalizeMagnet(hash, "Sample Title")).toBe(
      `magnet:?xt=urn:btih:${hash}&dn=Sample%20Title`
    );
  });

  it("lowercases and trims the hash", () => {
    expect(normalizeMagnet(`  ${"B".repeat(40)}  `)).toBe(
      `magnet:?xt=urn:btih:${"b".repeat(40)}`
    );
  });
});

describe("toIsoDate", () => {
  it("returns undefined for empty input", () => {
    expect(toIsoDate(undefined)).toBeUndefined();
  });

  it("returns undefined for unparseable input", () => {
    expect(toIsoDate("not a date")).toBeUndefined();
  });

  it("normalizes valid RFC dates to ISO", () => {
    expect(toIsoDate("Mon, 13 Apr 2026 22:32:33 -0700")).toBe(
      new Date("Mon, 13 Apr 2026 22:32:33 -0700").toISOString()
    );
  });
});

describe("cleanKeyword", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanKeyword("  hello   world ")).toBe("hello world");
  });
});
