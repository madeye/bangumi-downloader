export type SearchSource = "bangumi-moe" | "acg-rip" | "dmhy" | "nyaa";

export type ScriptPreference = "simplified" | "traditional";

export interface SearchQuery {
  keyword: string;
  limit?: number;
  offset?: number;
  sources?: SearchSource[];
  scriptPreference?: ScriptPreference;
}

export interface MirrorLink {
  source: SearchSource;
  magnetUrl?: string;
  torrentUrl?: string;
  detailUrl?: string;
}

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  source: SearchSource; // primary source (the one whose metadata we prefer)
  sources?: SearchSource[]; // all sources the item was observed on (after dedupe)
  mirrors?: MirrorLink[]; // per-source magnet/torrent/detail links
  publishedAt?: string;
  size?: string;
  seeders?: number;
  leechers?: number;
  infoHash?: string;
  magnetUrl?: string;
  torrentUrl?: string;
  detailUrl?: string;
  tags: string[];
  // Populated by the grouping pipeline; providers don't need to set these.
  series?: string;
  season?: number;
  episode?: number;
  version?: number;
  resolution?: string;
  group?: string;
}

export interface ResultGroup {
  key: string; // stable identifier for UI (normalized series + season)
  series: string;
  season?: number;
  items: SearchResultItem[];
}

export interface SearchResponse {
  query: SearchQuery;
  total: number; // count of deduped items
  warnings: string[];
  groups: ResultGroup[];
  ungrouped: SearchResultItem[];
}

export interface ProviderResult {
  items: SearchResultItem[];
  warnings?: string[];
}

export interface SearchProvider {
  readonly source: SearchSource;
  search(query: SearchQuery): Promise<ProviderResult>;
}
