import { detectScript } from "@/lib/script";
import { parseTitle } from "@/lib/titleParse";
import type { ResultGroup, ScriptPreference, SearchResultItem } from "@/lib/types";

export interface GroupingResult {
  groups: ResultGroup[];
  ungrouped: SearchResultItem[];
}

export interface GroupingOptions {
  seriesRemap?: Map<string, string>;
  groupRanking?: Map<string, number>;
  scriptPreference?: ScriptPreference;
}

const RESOLUTION_SCORE: Record<string, number> = {
  "2160p": 4, "4K": 4, "1080p": 3, "720p": 2, "480p": 1
};

export function annotateAndGroup(
  items: SearchResultItem[],
  seriesRemapOrOptions?: Map<string, string> | GroupingOptions,
  groupRanking?: Map<string, number>
): GroupingResult {
  const opts: GroupingOptions =
    seriesRemapOrOptions instanceof Map || seriesRemapOrOptions === undefined
      ? { seriesRemap: seriesRemapOrOptions, groupRanking }
      : seriesRemapOrOptions;
  const annotated = items.map(annotateItem);
  const pruned = pruneToBestPerEpisode(annotated, opts);

  const buckets = new Map<string, ResultGroup>();
  const ungrouped: SearchResultItem[] = [];

  for (const item of pruned) {
    const parsed = parseTitle(item.title);
    if (!parsed.seriesKey) {
      ungrouped.push(item);
      continue;
    }
    const canonicalKey = opts.seriesRemap?.get(parsed.seriesKey) ?? parsed.seriesKey;
    const seasonPart = item.season ? `::s${item.season}` : "";
    const key = `${canonicalKey}${seasonPart}`;
    const group = buckets.get(key);
    if (group) {
      group.items.push(item);
    } else {
      buckets.set(key, {
        key,
        series: parsed.series || item.title,
        season: item.season,
        items: [item]
      });
    }
  }

  const groups = Array.from(buckets.values());

  // Split single-item buckets into ungrouped — a "group of one" just adds UI
  // noise without helping the user scan releases.
  const finalGroups: ResultGroup[] = [];
  for (const g of groups) {
    if (g.items.length <= 1) {
      ungrouped.push(...g.items);
    } else {
      g.items.sort(compareForDisplay);
      finalGroups.push(g);
    }
  }

  finalGroups.sort((a, b) => freshness(b) - freshness(a));
  ungrouped.sort(compareForDisplay);

  return { groups: finalGroups, ungrouped };
}

function annotateItem(item: SearchResultItem): SearchResultItem {
  const parsed = parseTitle(item.title);
  return {
    ...item,
    series: parsed.series ?? item.series,
    season: parsed.season ?? item.season,
    episode: parsed.episode ?? item.episode,
    resolution: parsed.resolution ?? item.resolution,
    group: parsed.group ?? item.group
  };
}

function compareForDisplay(a: SearchResultItem, b: SearchResultItem): number {
  if (a.episode !== undefined && b.episode !== undefined && a.episode !== b.episode) {
    return b.episode - a.episode;
  }
  if (a.episode !== undefined && b.episode === undefined) return -1;
  if (a.episode === undefined && b.episode !== undefined) return 1;
  return publishedTime(b) - publishedTime(a);
}

function publishedTime(item: SearchResultItem): number {
  return item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
}

function freshness(group: ResultGroup): number {
  return Math.max(...group.items.map(publishedTime));
}

// For each (series, season, episode) keep only the single best release.
// Ranking: script preference (if set) → seeders desc → fansub-group rank desc
// → resolution desc → publishedAt desc. Items without a resolvable episode are
// kept as-is (batch releases, OVAs, unknown titles).
function pruneToBestPerEpisode(
  items: SearchResultItem[],
  opts: GroupingOptions
): SearchResultItem[] {
  const best = new Map<string, SearchResultItem>();
  const passthrough: SearchResultItem[] = [];

  for (const item of items) {
    const parsed = parseTitle(item.title);
    if (!parsed.seriesKey || item.episode === undefined) {
      passthrough.push(item);
      continue;
    }
    const canonical = opts.seriesRemap?.get(parsed.seriesKey) ?? parsed.seriesKey;
    const key = `${canonical}::s${item.season ?? 0}::e${item.episode}`;
    const existing = best.get(key);
    if (!existing || compareCandidates(item, existing, opts) < 0) {
      best.set(key, item);
    }
  }
  return [...best.values(), ...passthrough];
}

function compareCandidates(
  a: SearchResultItem,
  b: SearchResultItem,
  opts: GroupingOptions
): number {
  if (opts.scriptPreference) {
    const aMatch = detectScript(a.title) === opts.scriptPreference ? 1 : 0;
    const bMatch = detectScript(b.title) === opts.scriptPreference ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
  }
  const seedDiff = (b.seeders ?? -1) - (a.seeders ?? -1);
  if (seedDiff !== 0) return seedDiff;
  const groupDiff = groupScore(b, opts.groupRanking) - groupScore(a, opts.groupRanking);
  if (groupDiff !== 0) return groupDiff;
  const resDiff = (RESOLUTION_SCORE[b.resolution ?? ""] ?? 0) - (RESOLUTION_SCORE[a.resolution ?? ""] ?? 0);
  if (resDiff !== 0) return resDiff;
  return publishedTime(b) - publishedTime(a);
}

function groupScore(item: SearchResultItem, ranking?: Map<string, number>): number {
  if (!ranking || !item.group) return 0;
  return ranking.get(item.group.toLowerCase()) ?? 0;
}
