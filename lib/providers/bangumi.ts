import { cleanKeyword, normalizeMagnet, toIsoDate } from "@/lib/utils";
import type { ProviderResult, SearchProvider, SearchQuery, SearchResultItem } from "@/lib/types";

interface BangumiMoeTag {
  name?: string;
  locale?: { zh_cn?: string; zh_tw?: string; ja?: string; en?: string };
}

interface BangumiMoeTorrent {
  _id?: string;
  title?: string;
  category_tag?: BangumiMoeTag | null;
  category_tag_id?: string;
  content?: string;
  introduction?: string;
  publish_time?: string;
  // Upstream returns size as a pre-formatted string (e.g. "274.61 MB"), not bytes.
  size?: string;
  seeders?: number;
  leechers?: number;
  infoHash?: string;
  magnet?: string;
  torrent?: string;
  download?: string;
  team?: { name?: string } | null;
  tag_ids?: string[];
  tags?: Array<BangumiMoeTag | string>;
}

function tagLabel(tag: BangumiMoeTag | string | null | undefined): string | undefined {
  if (!tag) return undefined;
  if (typeof tag === "string") return tag;
  return tag.locale?.zh_cn || tag.locale?.zh_tw || tag.locale?.ja || tag.locale?.en || tag.name;
}

interface BangumiMoeResponse {
  torrents?: BangumiMoeTorrent[];
  count?: number;
}

const DEFAULT_BASE = process.env.BANGUMI_MOE_API_BASE || "https://bangumi.moe";
const DEFAULT_PATH = process.env.BANGUMI_MOE_SEARCH_PATH || "/api/v2/torrent/search";

export class BangumiMoeProvider implements SearchProvider {
  readonly source = "bangumi-moe" as const;

  async search(query: SearchQuery): Promise<ProviderResult> {
    const keyword = cleanKeyword(query.keyword);

    if (!keyword) {
      return { items: [] };
    }

    const url = new URL(DEFAULT_PATH, DEFAULT_BASE);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ query: keyword }),
        next: { revalidate: 0 }
      });

      if (!response.ok) {
        return {
          items: [],
          warnings: [`bangumi.moe 返回了 ${response.status}，当前结果已跳过该数据源。`]
        };
      }

      const payload = (await response.json()) as BangumiMoeResponse;
      const limit = query.limit ?? 20;
      const offset = query.offset ?? 0;
      const items = (payload.torrents ?? [])
        .slice(offset, offset + limit)
        .map((torrent) => this.mapItem(torrent));
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
    const infoHash = torrent.infoHash;
    const tags = (torrent.tags ?? [])
      .map(tagLabel)
      .filter((value): value is string => Boolean(value));
    if (torrent.team?.name) {
      tags.unshift(torrent.team.name);
    }

    return {
      id: torrent._id || `bangumi-${infoHash || title}`,
      title,
      subtitle: torrent.content || tagLabel(torrent.category_tag),
      source: this.source,
      publishedAt: toIsoDate(torrent.publish_time),
      size: typeof torrent.size === "string" ? torrent.size : undefined,
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
