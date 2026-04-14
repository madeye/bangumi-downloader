import { AcgRipProvider } from "@/lib/providers/acgrip";
import { BangumiMoeProvider } from "@/lib/providers/bangumi";
import { DmhyProvider } from "@/lib/providers/dmhy";
import { NyaaProvider } from "@/lib/providers/nyaa";
import { dedupeItems } from "@/lib/dedupe";
import { annotateAndGroup } from "@/lib/grouping";
import { buildSeriesRemap, rankFansubGroups } from "@/lib/llmGrouping";
import { parseTitle } from "@/lib/titleParse";
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
  const groupNames = Array.from(
    new Set(
      deduped
        .map((it) => parseTitle(it.title).group)
        .filter((g): g is string => !!g)
    )
  );
  const [remap, ranking] = await Promise.all([
    buildSeriesRemap(deduped),
    groupNames.length >= 2 ? rankFansubGroups(groupNames) : Promise.resolve(new Map<string, number>())
  ]);
  const { groups, ungrouped } = annotateAndGroup(deduped, {
    seriesRemap: remap,
    groupRanking: ranking,
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
