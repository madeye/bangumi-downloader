import { toSimplified } from "@/lib/script";

// Heuristic parser for anime release titles. Release naming is not
// standardized, so this is best-effort: it extracts what it can recognize and
// leaves the rest undefined. Callers should treat every field as optional.

export interface ParsedTitle {
  series?: string;
  seriesKey?: string; // normalized lowercase key for grouping
  season?: number;
  episode?: number;
  episodeRange?: [number, number]; // batch releases like "01-12"
  version?: number; // release version (e.g. "01v2" → 2). Defaults to 1.
  resolution?: string;
  group?: string;
  codec?: string;
}

const BRACKETS = [
  { open: "[", close: "]" },
  { open: "【", close: "】" },
  { open: "(", close: ")" },
  { open: "（", close: "）" }
];

const RESOLUTION_RE = /(2160p|1080p|720p|480p|4k)/i;
const CODEC_RE = /\b(hevc|x265|x264|h\.?264|h\.?265|av1|10-?bit|8-?bit|aac|flac)\b/i;
const SEASON_RE = /(?:S(\d{1,2})\b|Season\s*(\d{1,2})|第([一二三四五六七八九十\d]+)[季期])/i;
// Capture groups:
//   1: ep after "- ", 2: version after "- NNv?"
//   3: ep inside brackets, 4: version inside brackets
//   5: ep after "E"/"EP", 6: version after "E"/"EP"
//   7: ep after 第...话/集/話 (no version variant)
const EPISODE_RE = /(?:-\s*(\d{1,3})(?:v(\d))?\b|\[(\d{1,3})(?:v(\d))?\]|\bEP?(\d{1,3})(?:v(\d))?\b|第(\d{1,3})[话集話])/i;
// Batch range markers: "[01-12]", "[01-12 精校合集]", "01~12", "- 01-12".
const EPISODE_RANGE_RE = /(?:[\[\s-])(\d{1,3})\s*[-~]\s*(\d{1,3})(?:[\s\]]|$)/;

export function parseTitle(raw: string): ParsedTitle {
  if (!raw) return {};
  const out: ParsedTitle = {};

  const { stripped, firstBracket } = stripLeadingBrackets(raw);
  out.group = firstBracket;

  const resMatch = stripped.match(RESOLUTION_RE);
  if (resMatch) out.resolution = resMatch[1].toLowerCase().replace("k", "K");

  const codecMatch = stripped.match(CODEC_RE);
  if (codecMatch) out.codec = codecMatch[1].toLowerCase();

  const seasonMatch = stripped.match(SEASON_RE);
  if (seasonMatch) {
    const raw = seasonMatch[1] || seasonMatch[2] || seasonMatch[3];
    const n = parseCJKOrDecimal(raw);
    if (n) out.season = n;
  }

  // Try batch range first. If the title says "01-12" it's a batch, not ep 1.
  const rangeMatch = stripped.match(EPISODE_RANGE_RE);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      out.episodeRange = [a, b];
    }
  }

  if (!out.episodeRange) {
    const epMatch = stripped.match(EPISODE_RE);
    if (epMatch) {
      const raw = epMatch[1] || epMatch[3] || epMatch[5] || epMatch[7];
      const n = Number(raw);
      if (Number.isFinite(n)) out.episode = n;
      const ver = epMatch[2] || epMatch[4] || epMatch[6];
      if (ver) {
        const v = Number(ver);
        if (Number.isFinite(v)) out.version = v;
      }
    }
  }

  const extracted = extractSeries(stripped);
  if (extracted) {
    out.series = extracted.series;
    out.seriesKey = extracted.seriesKey;
  }

  return out;
}

// Strip only the FIRST leading bracket (the fansub group). We used to strip
// all consecutive leading brackets, but bracket-packed titles like
// `[SweetSub][機動戰士鋼彈][Mobile Suit Gundam][09][WebRip][1080p]` lost their
// episode marker that way. Leaving subsequent brackets lets EPISODE_RE and
// friends find `[09]`, `[1080p]`, etc.
function stripLeadingBrackets(raw: string): { stripped: string; firstBracket?: string } {
  const s = raw.trim();
  for (const b of BRACKETS) {
    if (s.startsWith(b.open)) {
      const end = s.indexOf(b.close, 1);
      if (end > 0) {
        const inside = s.slice(1, end).trim();
        return { stripped: s.slice(end + 1).trim(), firstBracket: inside || undefined };
      }
    }
  }
  return { stripped: s };
}

// Matches bracket contents that are metadata rather than a series title:
// episode numbers, resolutions, codecs, audio tags, language flags, release
// stage markers, etc. Used by extractSeries to skip past them.
const METADATA_BRACKET_RE =
  /^(?:\d{1,3}(?:v\d)?|\d{1,3}-\d{1,3}|\d{1,3}~\d{1,3}|2160p|1080p|720p|480p|4k|webrip|web-?dl|web-?rip|bluray|blu-?ray|hdtv|hdrip|hdr|avc|hevc|x26[45]|h\.?26[45]|av1|aac|flac|opus|e-?ac-?3|ddp?\d(?:\.\d)?|dts|10-?bit|8-?bit|dual[-_ ]?audio|multi[-_ ]?(?:sub)?s?|simp|trad|end|fin|finale|final|batch|v\d|ma10p|amzn|nf|dsnp|webdl|webrip|mkv|mp4|ts|ova|oad|sp|bdrip|bd|bdbox|精校合集|合集|生肉|繁日雙語|簡日雙語|简日双语|繁日双语|繁中|简中|繁体|简体|内嵌|内封|简繁(?:内封|内嵌|日内封|日内嵌)?|[简繁](?:日)?(?:内封|内嵌|外挂)?(?:字幕)?|日语|日文|中日双语|中英双语|多國字幕|多国字幕|sub[_-]?esp)$/i;

// extractSeries returns the series title. Two formats to handle:
//   1. Space-separated: "Chinese / English - 01 [1080p][WEBRip]"
//      — take text before the first bracket, split on '/', trim episode tail.
//   2. Bracket-packed: "[Group][Chinese][English][09][WebRip][1080p]"
//      — pick the longest non-metadata bracket content as the title.
interface ExtractedSeries {
  series: string;
  seriesKey: string;
}

function extractSeries(stripped: string): ExtractedSeries | undefined {
  if (!stripped) return undefined;

  const bracketPacked = /^[\[【(（]/.test(stripped);
  if (bracketPacked) {
    return extractFromBrackets(stripped);
  }

  // Cut at the first remaining bracket — inside those is metadata, not title.
  const cutAtBracket = stripped.search(/[\[\]【】()（）]/);
  let title = cutAtBracket >= 0 ? stripped.slice(0, cutAtBracket) : stripped;

  // Title usually comes as "中文 / English / 日本語 - 01" — take the first
  // '/'-separated segment; cut trailing " - NN" episode marker.
  title = title.split("/")[0];
  title = title.replace(/\s+-\s+\d{1,3}(?:v\d)?.*$/, "");
  title = title.replace(SEASON_RE, "");
  title = title.trim();

  if (!title) return undefined;
  return { series: title, seriesKey: normalizeSeriesKey(title) };
}

function extractFromBrackets(stripped: string): ExtractedSeries | undefined {
  const re = /\[([^\]]+)\]|【([^】]+)】|\(([^)]+)\)|（([^）]+)）/g;
  const candidates: string[] = [];
  for (const m of stripped.matchAll(re)) {
    const inner = (m[1] || m[2] || m[3] || m[4] || "").trim();
    if (!inner) continue;
    if (METADATA_BRACKET_RE.test(inner)) continue;
    candidates.push(inner);
  }
  if (!candidates.length) return undefined;
  // Display series: first candidate — matches releaser ordering conventions
  // (CJK title first for CN/TW releases).
  const series = candidates[0];
  // Series key: prefer a Latin-script candidate if present. Different
  // translations of the same show (e.g. 鋼彈 vs 高达 for "Gundam") share an
  // English title, so keying off that merges them without needing the LLM.
  const latin = candidates.find(isLatinDominant);
  const seriesKey = normalizeSeriesKey(latin ?? series);
  return { series, seriesKey };
}

function isLatinDominant(s: string): boolean {
  // Must contain Latin letters and no CJK. Mixed candidates like
  // "機動戰士鋼彈 GQuuuuuuX" don't count — we want the pure-Latin alias,
  // since that's the part that's stable across CN/TW translations.
  if (!/[A-Za-z]/.test(s)) return false;
  if (/[\u3400-\u9fff\u3040-\u30ff]/.test(s)) return false;
  return true;
}

export function normalizeSeriesKey(series: string): string {
  // Fold traditional → simplified so S/T variants of the same title collapse
  // into a single group without needing the LLM.
  return toSimplified(series)
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ") // strip punctuation/symbols
    .replace(/\s+/g, " ")
    .trim();
}

function parseCJKOrDecimal(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const map: Record<string, number> = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10
  };
  return map[s];
}
