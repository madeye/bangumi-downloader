import { describe, expect, it } from "vitest";
import { getAttr, getText, parseRssItems } from "@/lib/providers/rss";

const SAMPLE = `
<rss>
  <channel>
    <item>
      <title><![CDATA[ [桜都] 弹珠汽水 & me ]]></title>
      <link>https://example.com/1</link>
      <pubDate>Mon, 13 Apr 2026 22:32:33 -0700</pubDate>
      <enclosure url="magnet:?xt=urn:btih:abc&amp;dn=x" type="application/x-bittorrent"/>
      <nyaa:seeders>42</nyaa:seeders>
      <nyaa:size>415.6 MiB</nyaa:size>
    </item>
    <item>
      <title>Plain title</title>
      <link>https://example.com/2</link>
    </item>
  </channel>
</rss>
`;

describe("parseRssItems", () => {
  it("returns one block per <item>", () => {
    expect(parseRssItems(SAMPLE)).toHaveLength(2);
  });

  it("returns empty list for feeds without items", () => {
    expect(parseRssItems("<rss></rss>")).toEqual([]);
  });
});

describe("getText", () => {
  const [first, second] = parseRssItems(SAMPLE);

  it("unwraps CDATA and decodes entities", () => {
    expect(getText(first, "title")).toBe("[桜都] 弹珠汽水 & me");
  });

  it("reads namespaced tags like nyaa:seeders", () => {
    expect(getText(first, "nyaa:seeders")).toBe("42");
    expect(getText(first, "nyaa:size")).toBe("415.6 MiB");
  });

  it("returns undefined when the tag is absent", () => {
    expect(getText(second, "pubDate")).toBeUndefined();
  });
});

describe("getAttr", () => {
  const [first] = parseRssItems(SAMPLE);

  it("reads attribute values and decodes entities", () => {
    expect(getAttr(first, "enclosure", "url")).toBe("magnet:?xt=urn:btih:abc&dn=x");
  });

  it("returns undefined when tag or attr is missing", () => {
    expect(getAttr(first, "enclosure", "length")).toBeUndefined();
    expect(getAttr(first, "nothere", "url")).toBeUndefined();
  });
});
