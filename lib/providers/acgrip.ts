import { cleanKeyword, normalizeMagnet, toIsoDate } from "@/lib/utils";
import type { ProviderResult, SearchProvider, SearchQuery, SearchResultItem } from "@/lib/types";
import { getAttr, getText, parseRssItems } from "@/lib/providers/rss";

const DEFAULT_BASE = process.env.ACG_RIP_API_BASE || "https://acg.rip";
const DEFAULT_PATH = process.env.ACG_RIP_SEARCH_PATH || "/.xml";

// acg.rip exposes only RSS for search; there's no JSON endpoint (the /page/N.json
// path returns 406). Seeder/leecher counts and info hashes are not in the feed,
// so the resulting items carry only title / detail URL / .torrent URL.
export class AcgRipProvider implements SearchProvider {
  readonly source = "acg-rip" as const;

  async search(query: SearchQuery): Promise<ProviderResult> {
    const keyword = cleanKeyword(query.keyword);
    if (!keyword) {
      return { items: [] };
    }

    const url = new URL(DEFAULT_PATH, DEFAULT_BASE);
    url.searchParams.set("term", keyword);

    try {
      const response = await fetch(url, {
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
        next: { revalidate: 0 }
      });

      if (!response.ok) {
        return {
          items: [],
          warnings: [`acg.rip 返回了 ${response.status}，当前结果已跳过该数据源。`]
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
            ? `acg.rip 请求失败：${error.message}`
            : "acg.rip 请求失败。"
        ]
      };
    }
  }

  private mapItem(block: string): SearchResultItem {
    const title = getText(block, "title") || "未命名资源";
    const detailUrl = getText(block, "link") || getText(block, "guid");
    return {
      id: detailUrl || `acg-rip-${title}`,
      title,
      source: this.source,
      publishedAt: toIsoDate(getText(block, "pubDate")),
      torrentUrl: getAttr(block, "enclosure", "url"),
      detailUrl,
      magnetUrl: normalizeMagnet(undefined, title),
      tags: []
    };
  }
}
