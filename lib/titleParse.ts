// Heuristic parser for anime release titles. Release naming is not
// standardized, so this is best-effort: it extracts what it can recognize and
// leaves the rest undefined. Callers should treat every field as optional.

export interface ParsedTitle {
  series?: string;
  seriesKey?: string; // normalized lowercase key for grouping
  season?: number;
  episode?: number;
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
const EPISODE_RE = /(?:-\s*(\d{1,3})(?:v\d)?\b|\[(\d{1,3})(?:v\d)?\]|\bEP?(\d{1,3})\b|第(\d{1,3})[话集話])/i;

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

  const epMatch = stripped.match(EPISODE_RE);
  if (epMatch) {
    const raw = epMatch[1] || epMatch[2] || epMatch[3] || epMatch[4];
    const n = Number(raw);
    if (Number.isFinite(n)) out.episode = n;
  }

  const series = extractSeries(stripped);
  if (series) {
    out.series = series;
    out.seriesKey = normalizeSeriesKey(series);
  }

  return out;
}

function stripLeadingBrackets(raw: string): { stripped: string; firstBracket?: string } {
  let s = raw.trim();
  let firstBracket: string | undefined;
  for (;;) {
    const trimmed = s.trimStart();
    let consumed = false;
    for (const b of BRACKETS) {
      if (trimmed.startsWith(b.open)) {
        const end = trimmed.indexOf(b.close, 1);
        if (end > 0) {
          const inside = trimmed.slice(1, end).trim();
          if (!firstBracket && inside) firstBracket = inside;
          s = trimmed.slice(end + 1);
          consumed = true;
          break;
        }
      }
    }
    if (!consumed) break;
  }
  return { stripped: s.trim(), firstBracket };
}

// extractSeries returns the series title: the leading text after group brackets
// are stripped, cut off at the first release-metadata bracket / separator /
// known tag. We prefer the first segment of a '/' split (zh name usually comes
// first in CJK releases), then strip any trailing quality tokens.
function extractSeries(stripped: string): string | undefined {
  if (!stripped) return undefined;

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
  return title;
}

export function normalizeSeriesKey(series: string): string {
  return series
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
