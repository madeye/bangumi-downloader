import { cleanKeyword, normalizeMagnet, toIsoDate } from "@/lib/utils";
import type { ProviderResult, SearchProvider, SearchQuery, SearchResultItem } from "@/lib/types";

interface DhtIndexerItem {
  id?: string;
  name?: string;
  title?: string;
  size?: string;
  infoHash?: string;
  info_hash?: string;
  magnet?: string;
  torrentUrl?: string;
  torrent_url?: string;
  detailUrl?: string;
  detail_url?: string;
  createdAt?: string;
  created_at?: string;
  seeders?: number;
  leechers?: number;
  tags?: string[];
}

interface DhtIndexerResponse {
  items?: DhtIndexerItem[];
}

const DHT_INDEXER_URL = process.env.DHT_INDEXER_URL;
const DHT_INDEXER_AUTH_TOKEN = process.env.DHT_INDEXER_AUTH_TOKEN;

export class DhtProvider implements SearchProvider {
  readonly source = "dht" as const;

  async search(query: SearchQuery): Promise<ProviderResult> {
    const keyword = cleanKeyword(query.keyword);

    if (!keyword) {
      return { items: [] };
    }

    if (!DHT_INDEXER_URL) {
      return {
        items: [],
        warnings: ["未配置 DHT 索引服务，当前仅返回 bangumi.moe 数据。"]
      };
    }

    const url = new URL(DHT_INDEXER_URL);
    url.searchParams.set("q", keyword);
    url.searchParams.set("limit", String(query.limit ?? 20));
    url.searchParams.set("offset", String(query.offset ?? 0));

    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(DHT_INDEXER_AUTH_TOKEN
            ? { authorization: `Bearer ${DHT_INDEXER_AUTH_TOKEN}` }
            : {})
        },
        cache: "no-store"
      });

      if (!response.ok) {
        return {
          items: [],
          warnings: [`DHT 索引服务返回了 ${response.status}，当前结果已跳过该数据源。`]
        };
      }

      const payload = (await response.json()) as DhtIndexerResponse;
      const items = (payload.items ?? []).map((item) => this.mapItem(item));
      return { items };
    } catch (error) {
      return {
        items: [],
        warnings: [
          error instanceof Error
            ? `DHT 索引请求失败：${error.message}`
            : "DHT 索引请求失败。"
        ]
      };
    }
  }

  private mapItem(item: DhtIndexerItem): SearchResultItem {
    const infoHash = item.infoHash || item.info_hash;
    const title = item.title || item.name || "未命名资源";

    return {
      id: item.id || `dht-${infoHash || title}`,
      title,
      source: this.source,
      publishedAt: toIsoDate(item.createdAt || item.created_at),
      size: item.size,
      seeders: item.seeders,
      leechers: item.leechers,
      infoHash,
      magnetUrl: item.magnet || normalizeMagnet(infoHash, title),
      torrentUrl: item.torrentUrl || item.torrent_url,
      detailUrl: item.detailUrl || item.detail_url,
      tags: item.tags ?? []
    };
  }
}
