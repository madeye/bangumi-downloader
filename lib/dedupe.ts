import { toSimplified } from "@/lib/script";
import type { MirrorLink, SearchResultItem, SearchSource } from "@/lib/types";

// Dedup key preference: infoHash (most reliable — collides only on true
// duplicates); falling back to a normalized title (lowercased, stripped of
// punctuation and whitespace) so that the same release posted on two RSS
// feeds without an info hash still collapses. Providers that don't expose
// infoHash directly may still embed it in the magnet URL, so we extract that.
function itemHash(item: SearchResultItem): string | undefined {
  return normalizeHash(item.infoHash || infoHashFromMagnet(item.magnetUrl));
}

// Title fallback: fold S→T, keep only the first '/'-separated segment (zh
// title; sources disagree on the romaji/en translation appended after it),
// then strip punctuation/whitespace.
function titleKey(title: string): string {
  const zhPart = title.split("/")[0];
  return toSimplified(zhPart)
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function infoHashFromMagnet(magnet?: string): string | undefined {
  if (!magnet) return undefined;
  const match = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
  return match?.[1];
}

// Normalize btih to lowercase hex. dmhy emits base32-encoded hashes (32 chars)
// while nyaa emits hex (40 chars) — same underlying SHA-1, different encoding.
function normalizeHash(hash?: string): string | undefined {
  if (!hash) return undefined;
  const h = hash.trim();
  if (/^[a-fA-F0-9]{40}$/.test(h)) return h.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(h)) return base32ToHex(h.toUpperCase());
  return h.toLowerCase();
}

function base32ToHex(s: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s) {
    const v = alphabet.indexOf(c);
    if (v < 0) return s.toLowerCase();
    bits += v.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
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
  // Pre-pass: build an alias from normalized title → hash, so items that lack
  // a hash (acg-rip often doesn't expose magnets) can still merge into the
  // hashed bucket for the same release.
  const titleToHash = new Map<string, string>();
  for (const item of items) {
    const hash = itemHash(item);
    if (!hash) continue;
    const tk = titleKey(item.title);
    if (tk && !titleToHash.has(tk)) titleToHash.set(tk, hash);
  }

  const buckets = new Map<string, SearchResultItem>();
  for (const item of items) {
    const hash = itemHash(item) ?? titleToHash.get(titleKey(item.title));
    const key = hash ? `hash:${hash}` : `title:${titleKey(item.title)}`;
    const existing = buckets.get(key);
    buckets.set(key, existing ? mergePreferRicher(existing, item) : withDefaults(item));
  }
  return Array.from(buckets.values());
}

function withDefaults(item: SearchResultItem): SearchResultItem {
  return {
    ...item,
    infoHash: normalizeHash(item.infoHash || infoHashFromMagnet(item.magnetUrl)),
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
