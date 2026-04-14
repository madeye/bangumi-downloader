import Anthropic from "@anthropic-ai/sdk";
import { normalizeSeriesKey, parseTitle } from "@/lib/titleParse";
import type { SearchResultItem } from "@/lib/types";

// LLM-assisted refine pass. Two jobs bundled into one API call to halve the
// rate-limit pressure on shared backends (Kimi returns 429 "engine
// overloaded" readily):
//   1. Cluster series titles — merge simplified/traditional/romaji/English
//      variants of the same anime so they share a group.
//   2. Rank fansub/release groups by reputation — used as a tie-breaker when
//      picking the best release per episode.
//
// Both outputs fall back to empty on any failure, so the heuristic grouping
// keeps working when the LLM is unavailable or times out.

// LLM backend config. All three LLM_* env vars are required; without them
// the app falls back to heuristic grouping. Any Anthropic-compatible
// endpoint works (MiniMax, Kimi, etc.) — see .env.example.
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

export type SeriesRemap = Map<string, string>;
export type GroupRanking = Map<string, number>;

export interface LlmRefine {
  seriesRemap: SeriesRemap;
  groupRanking: GroupRanking;
}

interface CombinedResponse {
  groups?: Array<{ canonical?: string; originals?: string[] }>;
  ranking?: string[];
}

// Process-wide cache keyed on the sorted label+group inputs. Identical
// inputs produce identical answers, so repeat searches are instant.
const CACHE_MAX = 200;
const refineCache = new Map<string, LlmRefine>();

function cacheKey(labels: string[], groups: string[]): string {
  const norm = (xs: string[]) => [...xs].map((s) => s.toLowerCase()).sort().join("\u0001");
  return `${norm(labels)}\u0002${norm(groups)}`;
}

function cacheGet(key: string): LlmRefine | undefined {
  const v = refineCache.get(key);
  if (v !== undefined) {
    refineCache.delete(key);
    refineCache.set(key, v);
  }
  return v;
}

function cacheSet(key: string, value: LlmRefine): void {
  refineCache.set(key, value);
  if (refineCache.size > CACHE_MAX) {
    const oldest = refineCache.keys().next().value;
    if (oldest !== undefined) refineCache.delete(oldest);
  }
}

const EMPTY: LlmRefine = { seriesRemap: new Map(), groupRanking: new Map() };

export async function refineWithLlm(items: SearchResultItem[]): Promise<LlmRefine> {
  const cfg = llmConfig();
  if (!cfg) return EMPTY;

  // Labels (human-readable series) and the keys we need to emit back.
  const labelToKey = new Map<string, string>();
  const groupSet = new Set<string>();
  for (const item of items) {
    const parsed = parseTitle(item.title);
    if (parsed.series && parsed.seriesKey && !labelToKey.has(parsed.series)) {
      labelToKey.set(parsed.series, parsed.seriesKey);
    }
    if (parsed.group) groupSet.add(parsed.group);
  }
  const labels = Array.from(labelToKey.keys());
  const groups = Array.from(groupSet);

  // Bail out early when neither task has enough input to be useful.
  const hasClusterWork = labels.length >= 2;
  const hasRankWork = groups.length >= 2;
  if (!hasClusterWork && !hasRankWork) return EMPTY;

  const key = cacheKey(labels, groups);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    // maxRetries: 0 — some Anthropic-compatible backends (Kimi in
    // particular) return 429 "engine overloaded" during peak hours, and the
    // SDK's default retries stretch a single call to 50+ seconds. Fail fast
    // and let the heuristic fallback take over instead.
    const client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      maxRetries: 0
    });

    const response = await Promise.race([
      client.messages.create({
        model: cfg.model,
        max_tokens: 2048,
        messages: [
          { role: "user", content: buildPrompt(labels, groups) }
        ]
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("llm timeout")), TIMEOUT_MS)
      )
    ]);

    const text = extractText(response);
    const parsed = JSON.parse(stripFences(text)) as CombinedResponse;
    const refine: LlmRefine = {
      seriesRemap: buildRemap(parsed.groups ?? [], labelToKey),
      groupRanking: buildRanking(parsed.ranking ?? [], groups)
    };
    cacheSet(key, refine);
    return refine;
  } catch {
    return EMPTY;
  }
}

function buildPrompt(labels: string[], groups: string[]): string {
  return [
    "You are analyzing anime torrent search results. Do BOTH tasks below in one response.",
    "",
    "Task 1 — cluster series titles:",
    "  Group titles that refer to the SAME anime. Simplified/traditional Chinese,",
    "  Japanese, English, and romaji names of the same show are equivalents. Different",
    "  seasons of the same franchise also group together (season number lives elsewhere).",
    "  Distinct anime must stay separate. Only emit clusters with 2+ originals.",
    "",
    "Task 2 — rank fansub/release groups:",
    "  Order the groups list from MOST to LEAST preferred based on reputation, release",
    "  quality, and prolific-ness. Well-known groups (LoliHouse, 桜都字幕组, ANi,",
    "  Nekomoe kissaten, VCB-Studio, SubsPlease, Erai-raws) outrank unknowns. Include",
    "  every input group exactly once.",
    "",
    "Return ONLY JSON, no prose, no markdown fences. Schema:",
    '{"groups":[{"canonical":"<preferred display name>","originals":["<input title>", ...]}],',
    ' "ranking":["<best group>", "<next>", ...]}',
    "",
    "Titles:",
    JSON.stringify(labels),
    "",
    "Groups:",
    JSON.stringify(groups)
  ].join("\n");
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function buildRemap(
  clusters: CombinedResponse["groups"],
  labelToKey: Map<string, string>
): SeriesRemap {
  const remap: SeriesRemap = new Map();
  if (!clusters) return remap;
  for (const cluster of clusters) {
    const originals = (cluster.originals ?? []).filter((o) => labelToKey.has(o));
    if (originals.length < 2) continue;
    const canonicalLabel = cluster.canonical || originals[0];
    const canonicalKey = normalizeSeriesKey(canonicalLabel);
    for (const original of originals) {
      const originalKey = labelToKey.get(original)!;
      if (originalKey !== canonicalKey) remap.set(originalKey, canonicalKey);
    }
  }
  return remap;
}

function buildRanking(ordered: string[], inputs: string[]): GroupRanking {
  const inputSet = new Set(inputs.map((g) => g.toLowerCase()));
  const ranking: GroupRanking = new Map();
  let rank = ordered.length;
  for (const g of ordered) {
    if (inputSet.has(g.toLowerCase())) {
      ranking.set(g.toLowerCase(), rank--);
    }
  }
  return ranking;
}
