import { cleanKeyword, formatBytes, normalizeMagnet, toIsoDate } from "@/lib/utils";
import type { ProviderResult, SearchProvider, SearchQuery, SearchResultItem } from "@/lib/types";

interface BangumiMoeTorrent {
  _id?: string;
  title?: string;
  category_tag?: string;
  content?: string;
  publish_time?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  info_hash?: string;
  magnet?: string;
  torrent?: string;
  download?: string;
  tags?: Array<{ name?: string } | string>;
}

interface BangumiMoeResponse {
  torrents?: BangumiMoeTorrent[];
  count?: number;
}

const DEFAULT_BASE = process.env.BANGUMI_MOE_API_BASE || "https://bangumi.moe";
const DEFAULT_PATH = process.env.BANGUMI_MOE_SEARCH_PATH || "/api/torrent/search";

export class BangumiMoeProvider implements SearchProvider {
  readonly source = "bangumi-moe" as const;

  async search(query: SearchQuery): Promise<ProviderResult> {
    const keyword = cleanKeyword(query.keyword);

    if (!keyword) {
      return { items: [] };
    }

    const url = new URL(DEFAULT_PATH, DEFAULT_BASE);
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("limit", String(query.limit ?? 20));
    url.searchParams.set("offset", String(query.offset ?? 0));

    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json"
        },
        next: { revalidate: 0 }
      });

      if (!response.ok) {
        return {
          items: [],
          warnings: [`bangumi.moe 返回了 ${response.status}，当前结果已跳过该数据源。`]
        };
      }

      const payload = (await response.json()) as BangumiMoeResponse;
      const items = (payload.torrents ?? []).map((torrent) => this.mapItem(torrent));
      return { items };
    } catch (error) {
      return {
        items: [],
        warnings: [
          error instanceof Error
            ? `bangumi.moe 请求失败：${error.message}`
            : "bangumi.moe 请求失败。"
        ]
      };
    }
  }

  private mapItem(torrent: BangumiMoeTorrent): SearchResultItem {
    const title = torrent.title || "未命名资源";
    const infoHash = torrent.info_hash;
    const tags = (torrent.tags ?? [])
      .map((tag) => (typeof tag === "string" ? tag : tag.name))
      .filter((value): value is string => Boolean(value));

    return {
      id: torrent._id || `bangumi-${infoHash || title}`,
      title,
      subtitle: torrent.content || torrent.category_tag,
      source: this.source,
      publishedAt: toIsoDate(torrent.publish_time),
      size: typeof torrent.size === "number" ? formatBytes(torrent.size) : undefined,
      seeders: torrent.seeders,
      leechers: torrent.leechers,
      infoHash,
      magnetUrl: torrent.magnet || normalizeMagnet(infoHash, title),
      torrentUrl: torrent.download || torrent.torrent,
      detailUrl: torrent._id ? `${DEFAULT_BASE}/torrent/${torrent._id}` : undefined,
      tags
    };
  }
}
