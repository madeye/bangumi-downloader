export type SearchSource = "bangumi-moe" | "dht";

export interface SearchQuery {
  keyword: string;
  limit?: number;
  offset?: number;
  sources?: SearchSource[];
}

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  source: SearchSource;
  publishedAt?: string;
  size?: string;
  seeders?: number;
  leechers?: number;
  infoHash?: string;
  magnetUrl?: string;
  torrentUrl?: string;
  detailUrl?: string;
  tags: string[];
}

export interface SearchResponse {
  query: SearchQuery;
  total: number;
  warnings: string[];
  items: SearchResultItem[];
}

export interface ProviderResult {
  items: SearchResultItem[];
  warnings?: string[];
}

export interface SearchProvider {
  readonly source: SearchSource;
  search(query: SearchQuery): Promise<ProviderResult>;
}
