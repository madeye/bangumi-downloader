import { BangumiMoeProvider } from "@/lib/providers/bangumi";
import { DhtProvider } from "@/lib/providers/dht";
import type { SearchProvider, SearchQuery, SearchResponse, SearchSource } from "@/lib/types";

const providers: SearchProvider[] = [new BangumiMoeProvider(), new DhtProvider()];

function selectProviders(sources?: SearchSource[]): SearchProvider[] {
  if (!sources?.length) {
    return providers;
  }

  const set = new Set(sources);
  return providers.filter((provider) => set.has(provider.source));
}

export async function searchTorrents(query: SearchQuery): Promise<SearchResponse> {
  const enabledProviders = selectProviders(query.sources);
  const results = await Promise.all(enabledProviders.map((provider) => provider.search(query)));

  const items = results
    .flatMap((result) => result.items)
    .sort((left, right) => {
      const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
      const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
      return rightTime - leftTime;
    });

  const warnings = results.flatMap((result) => result.warnings ?? []);

  return {
    query,
    total: items.length,
    warnings,
    items
  };
}
