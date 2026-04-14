import { parseTitle } from "@/lib/titleParse";
import type { ResultGroup, SearchResultItem } from "@/lib/types";

export interface GroupingResult {
  groups: ResultGroup[];
  ungrouped: SearchResultItem[];
}

export function annotateAndGroup(items: SearchResultItem[]): GroupingResult {
  const annotated = items.map(annotateItem);

  const buckets = new Map<string, ResultGroup>();
  const ungrouped: SearchResultItem[] = [];

  for (const item of annotated) {
    const parsed = parseTitle(item.title);
    if (!parsed.seriesKey) {
      ungrouped.push(item);
      continue;
    }
    // Movies / OVAs without a clear episode number land in the same bucket as
    // the series; users can still see them listed together which is usually
    // what they want.
    const seasonPart = item.season ? `::s${item.season}` : "";
    const key = `${parsed.seriesKey}${seasonPart}`;
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

  // Sort groups by their freshest item so recent series float to the top; and
  // sort ungrouped the same way for consistency.
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
  // Episode descending (latest first), then publishedAt descending.
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
