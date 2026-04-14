import { cleanKeyword, toIsoDate } from "@/lib/utils";
import type { ProviderResult, SearchProvider, SearchQuery, SearchResultItem } from "@/lib/types";
import { getAttr, getText, parseRssItems } from "@/lib/providers/rss";

const DEFAULT_BASE = process.env.DMHY_API_BASE || "https://share.dmhy.org";
const DEFAULT_PATH = process.env.DMHY_SEARCH_PATH || "/topics/rss/rss.xml";

// dmhy exposes search via RSS only. The enclosure URL is a full magnet
// (with trackers) — we use it directly as magnetUrl and leave torrentUrl unset.
// Info hash, size, and seeder counts are not in the feed.
export class DmhyProvider implements SearchProvider {
  readonly source = "dmhy" as const;

  async search(query: SearchQuery): Promise<ProviderResult> {
    const keyword = cleanKeyword(query.keyword);
    if (!keyword) {
      return { items: [] };
    }

    const url = new URL(DEFAULT_PATH, DEFAULT_BASE);
    url.searchParams.set("keyword", keyword);

    try {
      const response = await fetch(url, {
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
        next: { revalidate: 0 }
      });

      if (!response.ok) {
        return {
          items: [],
          warnings: [`dmhy 返回了 ${response.status}，当前结果已跳过该数据源。`]
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
            ? `dmhy 请求失败：${error.message}`
            : "dmhy 请求失败。"
        ]
      };
    }
  }

  private mapItem(block: string): SearchResultItem {
    const title = getText(block, "title") || "未命名资源";
    const detailUrl = getText(block, "link");
    const enclosureUrl = getAttr(block, "enclosure", "url");
    const magnetUrl = enclosureUrl?.startsWith("magnet:") ? enclosureUrl : undefined;
    return {
      id: detailUrl || `dmhy-${title}`,
      title,
      source: this.source,
      publishedAt: toIsoDate(getText(block, "pubDate")),
      magnetUrl,
      detailUrl,
      tags: []
    };
  }
}
