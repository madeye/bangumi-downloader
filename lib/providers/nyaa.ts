import { cleanKeyword, normalizeMagnet, toIsoDate } from "@/lib/utils";
import type { ProviderResult, SearchProvider, SearchQuery, SearchResultItem } from "@/lib/types";
import { getText, parseRssItems } from "@/lib/providers/rss";

const DEFAULT_BASE = process.env.NYAA_API_BASE || "https://nyaa.si";
const DEFAULT_PATH = process.env.NYAA_SEARCH_PATH || "/";
// Default to all categories; callers can override via NYAA_CATEGORY (e.g. 1_2
// for anime English-translated, 1_0 for all anime).
const DEFAULT_CATEGORY = process.env.NYAA_CATEGORY || "0_0";

// nyaa.si's RSS uses the nyaa: namespace to expose seeders, leechers, info hash,
// size, and category — enough to build a usable result with a proper magnet URL.
export class NyaaProvider implements SearchProvider {
  readonly source = "nyaa" as const;

  async search(query: SearchQuery): Promise<ProviderResult> {
    const keyword = cleanKeyword(query.keyword);
    if (!keyword) {
      return { items: [] };
    }

    const url = new URL(DEFAULT_PATH, DEFAULT_BASE);
    url.searchParams.set("page", "rss");
    url.searchParams.set("q", keyword);
    url.searchParams.set("c", DEFAULT_CATEGORY);

    try {
      const response = await fetch(url, {
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
        next: { revalidate: 0 }
      });

      if (!response.ok) {
        return {
          items: [],
          warnings: [`nyaa 返回了 ${response.status}，当前结果已跳过该数据源。`]
        };
      }

      const xml = await response.text();
      const limit = query.limit ?? 20;
      const offset = query.offset ?? 0;
      const items = parseRssItems(xml)
        .slice(offset, offset + limit)
        .map((block) => this.mapItem(block));
      return { items };
    } catch (error) {
      return {
        items: [],
        warnings: [
          error instanceof Error
            ? `nyaa 请求失败：${error.message}`
            : "nyaa 请求失败。"
        ]
      };
    }
  }

  private mapItem(block: string): SearchResultItem {
    const title = getText(block, "title") || "未命名资源";
    const torrentUrl = getText(block, "link");
    const detailUrl = getText(block, "guid");
    const infoHash = getText(block, "nyaa:infoHash");
    const category = getText(block, "nyaa:category");
    const seeders = parseNumber(getText(block, "nyaa:seeders"));
    const leechers = parseNumber(getText(block, "nyaa:leechers"));

    return {
      id: detailUrl || infoHash || `nyaa-${title}`,
      title,
      subtitle: category,
      source: this.source,
      publishedAt: toIsoDate(getText(block, "pubDate")),
      size: getText(block, "nyaa:size"),
      seeders,
      leechers,
      infoHash,
      magnetUrl: normalizeMagnet(infoHash, title),
      torrentUrl,
      detailUrl,
      tags: category ? [category] : []
    };
  }
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
