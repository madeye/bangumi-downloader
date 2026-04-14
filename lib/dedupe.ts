import type { MirrorLink, SearchResultItem, SearchSource } from "@/lib/types";

// Dedup key preference: infoHash (most reliable — collides only on true
// duplicates); falling back to a normalized title (lowercased, stripped of
// punctuation and whitespace) so that the same release posted on two RSS
// feeds without an info hash still collapses.
function dedupKey(item: SearchResultItem): string {
  if (item.infoHash) return `hash:${item.infoHash.toLowerCase()}`;
  const norm = item.title
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
  return `title:${norm}`;
}

const SOURCE_PRIORITY: SearchSource[] = ["nyaa", "bangumi-moe", "dmhy", "acg-rip"];

// mergePreferRicher returns the more metadata-dense of two items. nyaa and
// bangumi.moe carry size/seeders; dmhy/acg-rip usually don't. We break ties
// with SOURCE_PRIORITY so the UI shows a stable "primary" source.
function mergePreferRicher(a: SearchResultItem, b: SearchResultItem): SearchResultItem {
  const score = (it: SearchResultItem) =>
    (it.seeders !== undefined ? 4 : 0) +
    (it.size ? 2 : 0) +
    (it.infoHash ? 1 : 0);
  // Tie-break by priority when scores are equal; otherwise richer record wins.
  const chosen =
    score(a) === score(b)
      ? (SOURCE_PRIORITY.indexOf(a.source) <= SOURCE_PRIORITY.indexOf(b.source) ? a : b)
      : (score(a) > score(b) ? a : b);
  const other = chosen === a ? b : a;

  const sources = Array.from(
    new Set([...(chosen.sources ?? [chosen.source]), ...(other.sources ?? [other.source])])
  );
  const mirrors = mergeMirrors(chosen, other);

  return {
    ...chosen,
    sources,
    mirrors,
    // Prefer the freshest publish time.
    publishedAt: maxIsoDate(chosen.publishedAt, other.publishedAt),
    // Fill gaps in the chosen record from the other, without overwriting.
    size: chosen.size || other.size,
    seeders: chosen.seeders ?? other.seeders,
    leechers: chosen.leechers ?? other.leechers,
    infoHash: chosen.infoHash || other.infoHash,
    magnetUrl: chosen.magnetUrl || other.magnetUrl,
    torrentUrl: chosen.torrentUrl || other.torrentUrl,
    detailUrl: chosen.detailUrl || other.detailUrl,
    subtitle: chosen.subtitle || other.subtitle,
    tags: Array.from(new Set([...(chosen.tags ?? []), ...(other.tags ?? [])]))
  };
}

function mergeMirrors(a: SearchResultItem, b: SearchResultItem): MirrorLink[] {
  const toMirrors = (it: SearchResultItem): MirrorLink[] => {
    if (it.mirrors?.length) return it.mirrors;
    return [
      {
        source: it.source,
        magnetUrl: it.magnetUrl,
        torrentUrl: it.torrentUrl,
        detailUrl: it.detailUrl
      }
    ];
  };
  const merged = new Map<SearchSource, MirrorLink>();
  for (const m of [...toMirrors(a), ...toMirrors(b)]) {
    const existing = merged.get(m.source);
    if (!existing) {
      merged.set(m.source, m);
    } else {
      merged.set(m.source, {
        source: m.source,
        magnetUrl: existing.magnetUrl || m.magnetUrl,
        torrentUrl: existing.torrentUrl || m.torrentUrl,
        detailUrl: existing.detailUrl || m.detailUrl
      });
    }
  }
  return Array.from(merged.values());
}

function maxIsoDate(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export function dedupeItems(items: SearchResultItem[]): SearchResultItem[] {
  const buckets = new Map<string, SearchResultItem>();
  for (const item of items) {
    const key = dedupKey(item);
    const existing = buckets.get(key);
    buckets.set(key, existing ? mergePreferRicher(existing, item) : withDefaults(item));
  }
  return Array.from(buckets.values());
}

function withDefaults(item: SearchResultItem): SearchResultItem {
  return {
    ...item,
    sources: item.sources ?? [item.source],
    mirrors: item.mirrors ?? [
      {
        source: item.source,
        magnetUrl: item.magnetUrl,
        torrentUrl: item.torrentUrl,
        detailUrl: item.detailUrl
      }
    ]
  };
}
