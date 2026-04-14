import { AcgRipProvider } from "@/lib/providers/acgrip";
import { BangumiMoeProvider } from "@/lib/providers/bangumi";
import { DmhyProvider } from "@/lib/providers/dmhy";
import { NyaaProvider } from "@/lib/providers/nyaa";
import { dedupeItems } from "@/lib/dedupe";
import { annotateAndGroup } from "@/lib/grouping";
import type { SearchProvider, SearchQuery, SearchResponse, SearchSource } from "@/lib/types";

const providers: SearchProvider[] = [
  new BangumiMoeProvider(),
  new AcgRipProvider(),
  new DmhyProvider(),
  new NyaaProvider()
];

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

  const rawItems = results.flatMap((result) => result.items);
  const deduped = dedupeItems(rawItems);
  const { groups, ungrouped } = annotateAndGroup(deduped);
  const warnings = results.flatMap((result) => result.warnings ?? []);

  return {
    query,
    total: deduped.length,
    warnings,
    groups,
    ungrouped
  };
}
