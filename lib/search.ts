import { AcgRipProvider } from "@/lib/providers/acgrip";
import { BangumiMoeProvider } from "@/lib/providers/bangumi";
import { DmhyProvider } from "@/lib/providers/dmhy";
import { NyaaProvider } from "@/lib/providers/nyaa";
import { dedupeItems } from "@/lib/dedupe";
import { annotateAndGroup } from "@/lib/grouping";
import { refineWithLlm } from "@/lib/llmGrouping";
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

export interface SearchOptions {
  useLlm?: boolean;
}

export async function searchTorrents(
  query: SearchQuery,
  options: SearchOptions = { useLlm: true }
): Promise<SearchResponse> {
  const enabledProviders = selectProviders(query.sources);
  const results = await Promise.all(enabledProviders.map((provider) => provider.search(query)));

  const rawItems = results.flatMap((result) => result.items);
  const deduped = dedupeItems(rawItems);

  const refine = options.useLlm
    ? await refineWithLlm(deduped)
    : { seriesRemap: new Map<string, string>(), groupRanking: new Map<string, number>() };
  const { groups, ungrouped } = annotateAndGroup(deduped, {
    seriesRemap: refine.seriesRemap,
    groupRanking: refine.groupRanking,
    scriptPreference: query.scriptPreference
  });
  const warnings = results.flatMap((result) => result.warnings ?? []);

  return {
    query,
    total: deduped.length,
    warnings,
    groups,
    ungrouped
  };
}
