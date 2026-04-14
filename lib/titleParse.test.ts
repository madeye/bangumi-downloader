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

  it("parses version from NNvM suffix", () => {
    const p = parseTitle("[桜都字幕组] Some Show [01v2][1080p]");
    expect(p.episode).toBe(1);
    expect(p.version).toBe(2);
  });

  it("defaults version to undefined when absent", () => {
    const p = parseTitle("[桜都字幕组] Some Show [01][1080p]");
    expect(p.episode).toBe(1);
    expect(p.version).toBeUndefined();
  });

  it("parses version in dash-separated episode form", () => {
    const p = parseTitle("[Nekomoe kissaten] Some Title - 03v2 [1080p][WEBRip]");
    expect(p.episode).toBe(3);
    expect(p.version).toBe(2);
  });

  it("parses CJK episode marker", () => {
    const p = parseTitle("[组] 某番 第12话 [1080p]");
    expect(p.episode).toBe(12);
  });

  it("parses bracket-packed titles (SweetSub style)", () => {
    const p = parseTitle(
      "[SweetSub][機動戰士鋼彈 GQuuuuuuX][Mobile Suit Gundam GQuuuuuuX][09][WebRip][1080P][AVC 8bit][繁日雙語]"
    );
    expect(p.group).toBe("SweetSub");
    expect(p.episode).toBe(9);
    expect(p.resolution).toBe("1080p");
    expect(p.series).toBe("機動戰士鋼彈 GQuuuuuuX");
  });

  it("parses bracket-packed titles with version marker", () => {
    const p = parseTitle(
      "[SweetSub][机动战士高达 GQuuuuuuX][Mobile Suit Gundam GQuuuuuuX][10v2][WebRip][1080P][AVC 8bit][简日双语]"
    );
    expect(p.episode).toBe(10);
    expect(p.version).toBe(2);
  });

  it("merges trad/simp bracket-packed titles via Latin alias", () => {
    const trad = parseTitle(
      "[SweetSub][機動戰士鋼彈 GQuuuuuuX][Mobile Suit Gundam GQuuuuuuX][01-12 精校合集][WebRip][1080P][AVC 8bit][繁日雙語]"
    );
    const simp = parseTitle(
      "[SweetSub][机动战士高达 GQuuuuuuX][Mobile Suit Gundam GQuuuuuuX][01-12 精校合集][WebRip][1080P][AVC 8bit][简日双语]"
    );
    expect(trad.series).toBe("機動戰士鋼彈 GQuuuuuuX");
    expect(simp.series).toBe("机动战士高达 GQuuuuuuX");
    expect(trad.seriesKey).toBe(simp.seriesKey);
    expect(trad.episodeRange).toEqual([1, 12]);
    expect(simp.episodeRange).toEqual([1, 12]);
    expect(trad.episode).toBeUndefined();
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
