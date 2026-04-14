import Anthropic from "@anthropic-ai/sdk";
import { normalizeSeriesKey, parseTitle } from "@/lib/titleParse";
import type { SearchResultItem } from "@/lib/types";

// LLM-assisted series clustering. The heuristic parser splits releases of the
// same anime into separate groups whenever the series name appears in a
// different language or script (e.g. simplified vs. traditional Chinese, or
// Chinese vs. romaji). This pass asks an LLM to merge those equivalents.
//
// Returns a remap from original normalized series key -> canonical key. Items
// whose key is not in the map keep their original grouping.

// LLM backend config. All three LLM_* env vars are required to enable the
// refine pass; without them the app falls back to heuristic grouping. Any
// Anthropic-compatible endpoint works (MiniMax, Kimi, etc.) — the example
// in .env.example shows the wiring.
//
// Typical LLM latency for these prompts is 30–60s, so the timeout has to be
// generous. The process-wide cache below keeps repeat searches instant.
const TIMEOUT_MS = 45000;

interface LlmConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

function llmConfig(): LlmConfig | undefined {
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !baseURL || !model) return undefined;
  return { apiKey, baseURL, model };
}

// Process-wide cache: prompts with identical label sets produce identical
// answers, so we cache on a stable hash of the sorted inputs. Capped to
// avoid unbounded growth in a long-running server.
const CACHE_MAX = 200;
const remapCache = new Map<string, SeriesRemap>();
const rankingCache = new Map<string, GroupRanking>();

function cacheKey(items: string[]): string {
  return [...items].map((s) => s.toLowerCase()).sort().join("\u0000");
}

function cacheGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const v = cache.get(key);
  if (v !== undefined) {
    // LRU touch: re-insert to move to end.
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cacheSet<V>(cache: Map<string, V>, key: string, value: V): void {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export type SeriesRemap = Map<string, string>;

interface ClusterResponse {
  groups?: Array<{ canonical?: string; originals?: string[] }>;
}

export type GroupRanking = Map<string, number>;

interface RankingResponse {
  ranking?: string[];
}

// rankFansubGroups asks the LLM to order fansub groups from most to least
// reputable/prolific. Returns a Map<normalizedGroupName, score> where higher
// score = more preferred. Empty map if the LLM is disabled or fails, which
// downstream code treats as "all groups tie at 0" — leaving seeders as the
// only tie-breaker.
export async function rankFansubGroups(groups: string[]): Promise<GroupRanking> {
  const cfg = llmConfig();
  if (!cfg) return new Map();
  const distinct = Array.from(new Set(groups.filter(Boolean)));
  if (distinct.length < 2) return new Map();

  const key = cacheKey(distinct);
  const cached = cacheGet(rankingCache, key);
  if (cached) return cached;

  try {
    const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });

    const response = await Promise.race([
      client.messages.create({
        model: cfg.model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: buildRankingPrompt(distinct)
          }
        ]
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("llm timeout")), TIMEOUT_MS)
      )
    ]);

    const text = extractText(response);
    const parsed = JSON.parse(stripFences(text)) as RankingResponse;
    const ranking = buildRanking(parsed.ranking ?? [], distinct);
    cacheSet(rankingCache, key, ranking);
    return ranking;
  } catch {
    return new Map();
  }
}

function buildRankingPrompt(groups: string[]): string {
  return [
    "Rank these anime fansub / release groups from MOST to LEAST preferred,",
    "based on reputation, release quality, and prolific-ness in the anime",
    "community. Well-known groups (e.g. LoliHouse, 桜都字幕组, ANi, Nekomoe",
    "kissaten, VCB-Studio, SubsPlease, Erai-raws) should rank higher than",
    "unknown or single-release groups.",
    "",
    "Return ONLY JSON, no prose, no fences. Schema:",
    '{"ranking":["<best group>","<next>", ...]}',
    "Include every input group exactly once in the ranking.",
    "",
    "Groups:",
    JSON.stringify(groups)
  ].join("\n");
}

function buildRanking(ordered: string[], inputs: string[]): GroupRanking {
  const inputSet = new Set(inputs.map((g) => g.toLowerCase()));
  const ranking: GroupRanking = new Map();
  // Score = N - index so the first element gets the highest score.
  let rank = ordered.length;
  for (const g of ordered) {
    if (inputSet.has(g.toLowerCase())) {
      ranking.set(g.toLowerCase(), rank--);
    }
  }
  return ranking;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function buildSeriesRemap(items: SearchResultItem[]): Promise<SeriesRemap> {
  const cfg = llmConfig();
  if (!cfg) return new Map();

  // Collect distinct (key, label) — LLM gets human-readable labels, we use
  // labels to reconstruct keys after clustering.
  const labelToKey = new Map<string, string>();
  for (const item of items) {
    const parsed = parseTitle(item.title);
    if (parsed.series && parsed.seriesKey && !labelToKey.has(parsed.series)) {
      labelToKey.set(parsed.series, parsed.seriesKey);
    }
  }
  if (labelToKey.size < 2) return new Map();

  const labels = Array.from(labelToKey.keys());
  const key = cacheKey(labels);
  const cached = cacheGet(remapCache, key);
  if (cached) return cached;

  try {
    const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });

    const response = await Promise.race([
      client.messages.create({
        model: cfg.model,
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: buildPrompt(labels)
          }
        ]
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("llm timeout")), TIMEOUT_MS)
      )
    ]);

    const text = extractText(response);
    const parsed = parseJson(text);
    const remap = buildRemap(parsed, labelToKey);
    cacheSet(remapCache, key, remap);
    return remap;
  } catch {
    // Silent fallback — heuristic grouping still works without the LLM.
    return new Map();
  }
}

function buildPrompt(labels: string[]): string {
  return [
    "You are clustering anime series titles. Group titles that refer to the SAME anime",
    "(simplified/traditional Chinese, Japanese, English, romaji are equivalents). Different",
    "seasons of the same franchise should be grouped together (the season number lives elsewhere).",
    "Distinct anime must stay separate.",
    "",
    "Return ONLY a JSON object, no prose, no markdown fences. Schema:",
    '{"groups":[{"canonical":"<preferred display name>","originals":["<input title>", ...]}]}',
    "Only emit groups with 2+ originals; singletons can be omitted.",
    "",
    "Titles:",
    JSON.stringify(labels)
  ].join("\n");
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

function parseJson(text: string): ClusterResponse {
  return JSON.parse(stripFences(text)) as ClusterResponse;
}

function buildRemap(parsed: ClusterResponse, labelToKey: Map<string, string>): SeriesRemap {
  const remap: SeriesRemap = new Map();
  if (!parsed.groups) return remap;

  for (const group of parsed.groups) {
    const originals = (group.originals ?? []).filter((o) => labelToKey.has(o));
    if (originals.length < 2) continue;
    const canonicalLabel = group.canonical || originals[0];
    const canonicalKey = normalizeSeriesKey(canonicalLabel);
    for (const original of originals) {
      const originalKey = labelToKey.get(original)!;
      if (originalKey !== canonicalKey) remap.set(originalKey, canonicalKey);
    }
  }
  return remap;
}
