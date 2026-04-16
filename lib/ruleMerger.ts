import { normalizeSeriesKey, parseTitle } from "@/lib/titleParse";
import type { SearchResultItem } from "@/lib/types";
import type { GroupRanking, LlmRefine, SeriesRemap } from "@/lib/llmGrouping";

// ---------------------------------------------------------------------------
// Rule-based merger — runs before the LLM refine pass to handle deterministic
// merges cheaply. Anything resolved here is removed from the LLM's input,
// reducing latency, cost, and flakiness.
//
// Two outputs, same shape as LlmRefine:
//   1. seriesRemap  — maps variant seriesKeys → canonical key
//   2. groupRanking — static reputation scores for well-known fansub groups
// ---------------------------------------------------------------------------

// ── Static fansub group reputation table ────────────────────────────────
// Higher = better. Derived from community consensus; covers the groups the
// LLM prompt already calls out plus other commonly seen ones. Scores are
// relative; the absolute values only matter for ordering.
const GROUP_REPUTATION: Record<string, number> = {
  // Top-tier (original translations, high production value)
  "vcb-studio": 100,
  "mawen1250": 95,
  "sweetsub": 90,
  "lolihouseゆい": 88,
  "lolihouse": 88,
  "sakurato": 86,
  "桜都字幕组": 86,
  "桜都字幕組": 86,
  "nekomoe kissaten": 84,
  "喵萌奶茶屋": 84,
  "千夏字幕组": 82,
  "千夏字幕組": 82,
  "天月搬運組": 80,
  "天月搬运组": 80,
  "天月字幕組": 80,
  "天月字幕组": 80,

  // Good automated / fast releasers
  "subsplease": 75,
  "erai-raws": 72,
  "ani": 70,

  // Decent community groups
  "lilith-raws": 68,
  "nc-raws": 66,
  "orion origin": 64,
  "猎户不鸽压制": 64,
  "c.c dynamic": 62,
  "星空字幕组": 60,
  "星空字幕組": 60,
  "幻樱字幕组": 58,
  "幻樱字幕組": 58,
  "幻月字幕组": 56,
  "幻月字幕組": 56,
  "离谱Sub": 54,
  "悠哈璃羽字幕社": 52,
  "极影字幕社": 50,
  "極影字幕社": 50,
  "动漫国字幕组": 48,
  "動漫國字幕組": 48,
  "枫叶字幕组": 46,
  "楓葉字幕組": 46,
  "豌豆字幕组": 44,
  "豌豆字幕組": 44,
  "白恋字幕组": 42,
  "白戀字幕組": 42,
  "jsum": 40,
  "skymoon-raws": 38,

  // Raw/re-encode groups (useful but no translation)
  "ohys-raws": 30,
  "leopard-raws": 28,
};

// ── Series clustering rules ─────────────────────────────────────────────

// Minimum normalized-key length to attempt fuzzy matching. Short keys like
// "one" or "air" would cause false merges.
const MIN_FUZZY_KEY_LEN = 6;

// Two keys are "close enough" when one contains the other and the shorter
// one is at least this fraction of the longer one's length. Prevents
// "naruto" from swallowing "naruto shippuden".
const CONTAINMENT_MIN_RATIO = 0.65;

export function ruleBasedMerge(items: SearchResultItem[]): LlmRefine {
  return {
    seriesRemap: buildSeriesRemap(items),
    groupRanking: buildGroupRanking(items),
  };
}

// ── Group ranking ───────────────────────────────────────────────────────

function buildGroupRanking(items: SearchResultItem[]): GroupRanking {
  const ranking: GroupRanking = new Map();
  const seen = new Set<string>();
  for (const item of items) {
    const parsed = parseTitle(item.title);
    if (!parsed.group) continue;
    const key = parsed.group.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = GROUP_REPUTATION[key];
    if (score !== undefined) {
      ranking.set(key, score);
    }
  }
  return ranking;
}

// ── Series remap ────────────────────────────────────────────────────────

interface SeriesEntry {
  label: string;       // display name (first seen)
  seriesKey: string;    // normalized key
  aliases: string[];    // alternate names extracted from title (slash parts, Latin brackets)
}

function buildSeriesRemap(items: SearchResultItem[]): SeriesRemap {
  // Collect unique (seriesKey → label) with alternate name aliases.
  const entries = new Map<string, SeriesEntry>();
  for (const item of items) {
    const parsed = parseTitle(item.title);
    if (!parsed.series || !parsed.seriesKey) continue;
    if (entries.has(parsed.seriesKey)) continue;
    entries.set(parsed.seriesKey, {
      label: parsed.series,
      seriesKey: parsed.seriesKey,
      aliases: extractAliases(item.title),
    });
  }

  if (entries.size < 2) return new Map();

  const all = Array.from(entries.values());
  // Union-Find to cluster entries.
  const parent = new Map<string, string>();
  for (const e of all) parent.set(e.seriesKey, e.seriesKey);

  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }
  function union(a: string, b: string): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Rule 1: Shared alias — titles with a common alternate name (from
  // slash-separated parts like "中文 / English" or Latin bracket aliases).
  const byAlias = new Map<string, string[]>();
  for (const e of all) {
    for (const alias of e.aliases) {
      const norm = normalizeSeriesKey(alias);
      if (norm.length < MIN_FUZZY_KEY_LEN) continue;
      const bucket = byAlias.get(norm);
      if (bucket) bucket.push(e.seriesKey);
      else byAlias.set(norm, [e.seriesKey]);
    }
  }
  for (const keys of byAlias.values()) {
    // Dedupe in case the same seriesKey appears multiple times.
    const unique = [...new Set(keys)];
    for (let i = 1; i < unique.length; i++) union(unique[0], unique[i]);
  }

  // Rule 2: Substring containment on normalized keys — catches cases like
  // "re zero" matching "re zero kara hajimeru isekai seikatsu" when the
  // shorter key is long enough and covers most of the longer one.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i].seriesKey, b = all[j].seriesKey;
      if (a.length < MIN_FUZZY_KEY_LEN && b.length < MIN_FUZZY_KEY_LEN) continue;
      if (find(a) === find(b)) continue; // already merged
      if (isSubstringMatch(a, b)) union(a, b);
    }
  }

  // Rule 3: Normalized key equality after stripping common suffixes/noise
  // words ("tv", "the animation", etc.).
  const byStripped = new Map<string, string[]>();
  for (const e of all) {
    const stripped = stripNoiseSuffix(e.seriesKey);
    if (stripped.length < MIN_FUZZY_KEY_LEN) continue;
    const bucket = byStripped.get(stripped);
    if (bucket) bucket.push(e.seriesKey);
    else byStripped.set(stripped, [e.seriesKey]);
  }
  for (const keys of byStripped.values()) {
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }

  // Build remap: point every non-canonical key to its cluster root.
  const remap: SeriesRemap = new Map();
  // Pick the shortest seriesKey in each cluster as canonical (usually the
  // most concise/common form).
  const clusters = new Map<string, string[]>();
  for (const e of all) {
    const root = find(e.seriesKey);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(e.seriesKey);
    else clusters.set(root, [e.seriesKey]);
  }
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.length - b.length);
    const canonical = members[0];
    for (let i = 1; i < members.length; i++) {
      remap.set(members[i], canonical);
    }
  }
  return remap;
}

function isSubstringMatch(a: string, b: string): boolean {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < MIN_FUZZY_KEY_LEN) return false;
  if (!longer.includes(shorter)) return false;
  return shorter.length / longer.length >= CONTAINMENT_MIN_RATIO;
}

const NOISE_SUFFIXES = [
  " tv",
  " the animation",
  " the anime",
  " animation",
  " anime",
  " ova",
  " oad",
  " special",
  " specials",
  " sp",
];

function stripNoiseSuffix(key: string): string {
  let result = key;
  for (const suffix of NOISE_SUFFIXES) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
    }
  }
  return result;
}

// Metadata bracket patterns — things like "1080p", "HEVC", "01", episode
// numbers, etc. Must be skipped when hunting for a Latin series-name alias.
const METADATA_BRACKET_RE =
  /^(?:\d{1,3}(?:v\d)?|\d{1,3}-\d{1,3}|\d{1,3}~\d{1,3}|2160p|1080p|720p|480p|4k|webrip|web-?dl|web-?rip|bluray|blu-?ray|hdtv|hdrip|hdr|avc|hevc|x26[45]|h\.?26[45]|av1|aac|flac|opus|e-?ac-?3|ddp?\d(?:\.\d)?|dts|10-?bit|8-?bit|dual[-_ ]?audio|multi[-_ ]?(?:sub)?s?|simp|trad|end|fin|finale|final|batch|v\d|ma10p|amzn|nf|dsnp|webdl|webrip|mkv|mp4|ts|ova|oad|sp|bdrip|bd|bdbox|精校合集|合集|生肉|繁日雙語|簡日雙語|简日双语|繁日双语|繁中|简中|繁体|简体|内嵌|内封|简繁(?:内封|内嵌|日内封|日内嵌)?|[简繁](?:日)?(?:内封|内嵌|外挂)?(?:字幕)?|日语|日文|中日双语|中英双语|多國字幕|多国字幕|sub[_-]?esp)$/i;

// Extract alternate names from a title. Two sources:
//   1. Slash-separated parts: "[Group] 中文名 / English Name - 01" → ["English Name"]
//   2. Non-metadata bracket contents after the first (group) bracket.
function extractAliases(raw: string): string[] {
  const aliases: string[] = [];

  // Strip leading group bracket.
  const stripped = raw.replace(/^\s*(?:\[[^\]]*\]|【[^】]*】|\([^)]*\)|（[^）]*）)\s*/, "");

  // Slash-separated parts from the space-separated portion (before brackets).
  const cutAtBracket = stripped.search(/[\[\]【】()（）]/);
  const freeText = cutAtBracket >= 0 ? stripped.slice(0, cutAtBracket) : stripped;
  const slashParts = freeText.split("/");
  if (slashParts.length > 1) {
    for (const part of slashParts.slice(1)) {
      // Trim trailing episode marker like " - 01".
      const cleaned = part.replace(/\s+-\s+\d{1,3}(?:v\d)?.*$/, "").trim();
      if (cleaned) aliases.push(cleaned);
    }
  }

  // Bracket aliases (skip metadata).
  const bracketRe = /\[([^\]]+)\]|【([^】]+)】|\(([^)]+)\)|（([^）]+)）/g;
  for (const m of stripped.matchAll(bracketRe)) {
    const inner = (m[1] || m[2] || m[3] || m[4] || "").trim();
    if (!inner) continue;
    if (METADATA_BRACKET_RE.test(inner)) continue;
    aliases.push(inner);
  }

  return aliases;
}
