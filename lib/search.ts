import { AcgRipProvider } from "@/lib/providers/acgrip";
import { BangumiMoeProvider } from "@/lib/providers/bangumi";
import { DmhyProvider } from "@/lib/providers/dmhy";
import { NyaaProvider } from "@/lib/providers/nyaa";
import { cacheGet, cacheSet } from "@/lib/cache";
import { dedupeItems } from "@/lib/dedupe";
import { annotateAndGroup } from "@/lib/grouping";
import { refineWithLlm } from "@/lib/llmGrouping";
import type { SearchProvider, SearchQuery, SearchResponse, SearchSource } from "@/lib/types";

const DEFAULT_CACHE_TTL_SECONDS = 900; // 15 minutes

function cacheTtlSeconds(): number {
  const raw = Number(process.env.SEARCH_CACHE_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_SECONDS;
}

function normalizeKeyword(raw: string): string {
  // NFKC folds full-width ASCII/punctuation into half-width so e.g. "ＧＱｕｕｘ"
  // and "GQuux" hash to the same key. Collapsing internal whitespace catches
  // double-spaces and stray tabs that users routinely paste in.
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCacheKey(query: SearchQuery, useLlm: boolean): string {
  return JSON.stringify({
    k: normalizeKeyword(query.keyword),
    s: [...(query.sources ?? [])].sort(),
    p: query.scriptPreference ?? null,
    l: query.limit ?? null,
    o: query.offset ?? null,
    llm: useLlm
  });
}

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
  const useLlm = !!options.useLlm;
  // Always prefer a cached refined response — it's strictly better than the
  // fast variant, so the fast path promotes it and the client can skip its
  // follow-up refine fetch.
  const refinedCached = cacheGet<SearchResponse>(buildCacheKey(query, true));
  if (refinedCached) return refinedCached;
  if (!useLlm) {
    const fastCached = cacheGet<SearchResponse>(buildCacheKey(query, false));
    if (fastCached) return fastCached;
  }

  const enabledProviders = selectProviders(query.sources);
  const results = await Promise.all(enabledProviders.map((provider) => provider.search(query)));

  const rawItems = results.flatMap((result) => result.items);
  const deduped = dedupeItems(rawItems);

  const refine = useLlm
    ? await refineWithLlm(deduped)
    : { seriesRemap: new Map<string, string>(), groupRanking: new Map<string, number>() };
  const { groups, ungrouped } = annotateAndGroup(deduped, {
    seriesRemap: refine.seriesRemap,
    groupRanking: refine.groupRanking,
    scriptPreference: query.scriptPreference
  });
  const warnings = results.flatMap((result) => result.warnings ?? []);

  const response: SearchResponse = {
    query,
    total: deduped.length,
    warnings,
    groups,
    ungrouped,
    refined: useLlm
  };
  cacheSet(buildCacheKey(query, useLlm), response, cacheTtlSeconds());
  return response;
}
