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
// Concurrent callers are coalesced: requests arriving within a short window
// are merged into one (or a few) LLM calls, keeping total context under
// 64k tokens. This minimises cost and rate-limit pressure.
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

// ── Process-wide LRU cache ──────────────────────────────────────────────
const CACHE_MAX = 200;
const refineCache = new Map<string, LlmRefine>();

function refineCacheKey(labels: string[], groups: string[]): string {
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

// ── Coalescing batch queue ──────────────────────────────────────────────
// Concurrent refineWithLlm() calls are queued and flushed together after a
// short window. All queued labels/groups are merged into the minimum number
// of LLM calls that fit within the 64k token budget.

const BATCH_WINDOW_MS = 100;
// Reserve ~14k tokens for the response; prompt must fit in the rest.
const MAX_PROMPT_TOKENS = 50_000;
// Rough estimate: ~4 chars per token for Latin, ~1.5 for CJK.
const CHARS_PER_TOKEN = 3;

interface PendingRequest {
  labelToKey: Map<string, string>;
  groups: string[];
  resolve: (r: LlmRefine) => void;
}

let pendingQueue: PendingRequest[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

export function refineWithLlm(items: SearchResultItem[]): Promise<LlmRefine> {
  const cfg = llmConfig();
  if (!cfg) return Promise.resolve(EMPTY);

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

  if (labels.length < 2 && groups.length < 2) return Promise.resolve(EMPTY);

  const key = refineCacheKey(labels, groups);
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);

  return new Promise<LlmRefine>((resolve) => {
    pendingQueue.push({ labelToKey, groups, resolve });
    if (!batchTimer) {
      batchTimer = setTimeout(() => flushBatch(cfg), BATCH_WINDOW_MS);
    }
  });
}

async function flushBatch(cfg: LlmConfig): Promise<void> {
  batchTimer = null;
  const batch = pendingQueue;
  pendingQueue = [];

  // Merge all labels and groups across queued requests.
  const mergedLabelToKey = new Map<string, string>();
  const mergedGroupSet = new Set<string>();
  for (const req of batch) {
    for (const [label, key] of req.labelToKey) {
      if (!mergedLabelToKey.has(label)) mergedLabelToKey.set(label, key);
    }
    for (const g of req.groups) mergedGroupSet.add(g);
  }
  const allLabels = Array.from(mergedLabelToKey.keys());
  const allGroups = Array.from(mergedGroupSet);

  try {
    // Split into chunks that each fit within the token budget.
    const chunks = splitByTokenBudget(allLabels, allGroups);

    // Execute chunks — serialise to avoid concurrent 429s on rate-limited
    // backends, but still only make the minimum number of calls.
    let combinedRemap: SeriesRemap = new Map();
    let combinedRanking: GroupRanking = new Map();

    for (const chunk of chunks) {
      const result = await callLlm(cfg, chunk.labels, chunk.groups, mergedLabelToKey);
      for (const [k, v] of result.seriesRemap) combinedRemap.set(k, v);
      for (const [k, v] of result.groupRanking) combinedRanking.set(k, v);
    }

    const combined: LlmRefine = {
      seriesRemap: combinedRemap,
      groupRanking: combinedRanking,
    };

    // Cache the per-request exact key so repeat searches are instant.
    for (const req of batch) {
      const labels = Array.from(req.labelToKey.keys());
      cacheSet(refineCacheKey(labels, req.groups), combined);
    }
    // Also cache the merged key.
    cacheSet(refineCacheKey(allLabels, allGroups), combined);

    for (const req of batch) req.resolve(combined);
  } catch {
    for (const req of batch) req.resolve(EMPTY);
  }
}

// ── Token-budget splitting ──────────────────────────────────────────────

interface PromptChunk {
  labels: string[];
  groups: string[];
}

function estimateTokens(labels: string[], groups: string[]): number {
  const promptTemplate = 400; // fixed instruction text
  const labelTokens = labels.reduce((sum, l) => sum + Math.ceil(l.length / CHARS_PER_TOKEN), 0);
  const groupTokens = groups.reduce((sum, g) => sum + Math.ceil(g.length / CHARS_PER_TOKEN), 0);
  // JSON overhead: brackets, commas, quotes — ~2 tokens per item.
  const jsonOverhead = (labels.length + groups.length) * 2;
  return promptTemplate + labelTokens + groupTokens + jsonOverhead;
}

export function splitByTokenBudget(labels: string[], groups: string[]): PromptChunk[] {
  // Fast path: everything fits in one call.
  if (estimateTokens(labels, groups) <= MAX_PROMPT_TOKENS) {
    return [{ labels, groups }];
  }

  // Groups list is usually small — include the full list in every chunk so
  // ranking is consistent. Split only the labels.
  const groupTokens = estimateTokens([], groups);
  const labelBudget = MAX_PROMPT_TOKENS - groupTokens;

  const chunks: PromptChunk[] = [];
  let currentLabels: string[] = [];
  let currentTokens = 400; // prompt template

  for (const label of labels) {
    const labelCost = Math.ceil(label.length / CHARS_PER_TOKEN) + 2;
    if (currentTokens + labelCost > labelBudget && currentLabels.length > 0) {
      chunks.push({ labels: currentLabels, groups });
      currentLabels = [];
      currentTokens = 400;
    }
    currentLabels.push(label);
    currentTokens += labelCost;
  }
  if (currentLabels.length > 0) {
    chunks.push({ labels: currentLabels, groups });
  }

  return chunks;
}

// ── LLM caller ──────────────────────────────────────────────────────────

async function callLlm(
  cfg: LlmConfig,
  labels: string[],
  groups: string[],
  labelToKey: Map<string, string>,
): Promise<LlmRefine> {
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
    maxRetries: 0,
  });

  const response = await Promise.race([
    client.messages.create({
      model: cfg.model,
      max_tokens: 2048,
      messages: [{ role: "user", content: buildPrompt(labels, groups) }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("llm timeout")), TIMEOUT_MS)
    ),
  ]);

  const text = extractText(response);
  const parsed = JSON.parse(stripFences(text)) as CombinedResponse;
  return {
    seriesRemap: buildRemap(parsed.groups ?? [], labelToKey),
    groupRanking: buildRanking(parsed.ranking ?? [], groups),
  };
}

// ── Prompt & parsing ────────────────────────────────────────────────────

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
