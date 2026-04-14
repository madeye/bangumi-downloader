import { describe, expect, it } from "vitest";
import { normalizeSeriesKey, parseTitle } from "@/lib/titleParse";

describe("parseTitle", () => {
  it("extracts fansub group, series, episode, resolution", () => {
    const p = parseTitle(
      "[桜都字幕组] 弹珠汽水瓶里的千岁同学 / Chitose-kun wa Ramune Bin no Naka [13][1080p][简繁内封]"
    );
    expect(p.group).toBe("桜都字幕组");
    expect(p.series).toBe("弹珠汽水瓶里的千岁同学");
    expect(p.episode).toBe(13);
    expect(p.resolution).toBe("1080p");
  });

  it("handles dash-separated episode and english names", () => {
    const p = parseTitle("[Nekomoe kissaten] Some Title - 03 [1080p][WEBRip]");
    expect(p.group).toBe("Nekomoe kissaten");
    expect(p.series).toBe("Some Title");
    expect(p.episode).toBe(3);
  });

  it("parses season from S02 syntax", () => {
    const p = parseTitle("[LoliHouse] Some Show S02 - 05 [1080p]");
    expect(p.season).toBe(2);
    expect(p.episode).toBe(5);
  });

  it("parses CJK season marker", () => {
    const p = parseTitle("[组] 某番 第二季 - 03 [1080p]");
    expect(p.season).toBe(2);
  });

  it("parses CJK episode marker", () => {
    const p = parseTitle("[组] 某番 第12话 [1080p]");
    expect(p.episode).toBe(12);
  });

  it("returns empty for empty input", () => {
    expect(parseTitle("")).toEqual({});
  });

  it("leaves series undefined when all brackets strip it", () => {
    const p = parseTitle("[only-a-group]");
    expect(p.series).toBeUndefined();
    expect(p.seriesKey).toBeUndefined();
  });
});

describe("normalizeSeriesKey", () => {
  it("lowercases, collapses whitespace, strips punctuation", () => {
    expect(normalizeSeriesKey("  Some·Show!  ")).toBe("some show");
  });
});
