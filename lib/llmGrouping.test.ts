import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SearchResultItem } from "@/lib/types";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

import { refineWithLlm, splitByTokenBudget } from "@/lib/llmGrouping";

function mkItem(title: string): SearchResultItem {
  return { id: title, title, source: "nyaa", tags: [] };
}

describe("refineWithLlm", () => {
  beforeEach(() => {
    createMock.mockReset();
    vi.useFakeTimers();
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://example.com/anthropic";
    process.env.LLM_MODEL = "test-model";
  });

  it("returns empty refine when LLM_API_KEY is unset", async () => {
    delete process.env.LLM_API_KEY;
    const r = await refineWithLlm([
      mkItem("[g] Show A - 01 [1080p]"),
      mkItem("[g] Show B - 01 [1080p]")
    ]);
    expect(r.seriesRemap.size).toBe(0);
    expect(r.groupRanking.size).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns empty when there's nothing to cluster or rank", async () => {
    const r = await refineWithLlm([mkItem("[g] Show A - 01 [1080p]")]);
    expect(r.seriesRemap.size).toBe(0);
    expect(r.groupRanking.size).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("parses combined clusters+ranking from one LLM response", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            groups: [
              {
                canonical: "弹珠汽水瓶里的千岁同学",
                originals: ["弹珠汽水瓶里的千岁同学", "Chitose-kun"]
              }
            ],
            ranking: ["桜都字幕组", "nekomoe"]
          })
        }
      ]
    });

    const p = refineWithLlm([
      mkItem("[桜都字幕组] 弹珠汽水瓶里的千岁同学 - 01 [1080p]"),
      mkItem("[nekomoe] Chitose-kun - 01 [1080p]")
    ]);
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;

    expect(r.seriesRemap.get("chitose kun")).toBe("弹珠汽水瓶里的千岁同学");
    expect(r.groupRanking.get("桜都字幕组")).toBe(2);
    expect(r.groupRanking.get("nekomoe")).toBe(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("falls back silently on JSON parse failure", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "not json at all" }] });
    const p = refineWithLlm([
      mkItem("[g1] Show A - 01 [1080p]"),
      mkItem("[g2] Show B - 01 [1080p]")
    ]);
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    expect(r.seriesRemap.size).toBe(0);
    expect(r.groupRanking.size).toBe(0);
  });

  it("strips markdown code fences before parsing", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "```json\n" +
            JSON.stringify({
              groups: [{ canonical: "Show A", originals: ["Show A", "Show A JP"] }],
              ranking: []
            }) +
            "\n```"
        }
      ]
    });

    const p = refineWithLlm([
      mkItem("[g] Show A - 01 [1080p]"),
      mkItem("[g] Show A JP - 01 [1080p]")
    ]);
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    expect(r.seriesRemap.get("show a jp")).toBe("show a");
  });

  it("ignores clusters with fewer than 2 originals", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            groups: [{ canonical: "Show A", originals: ["Show A"] }],
            ranking: []
          })
        }
      ]
    });
    const p = refineWithLlm([
      mkItem("[g1] Show A - 01 [1080p]"),
      mkItem("[g2] Show B - 01 [1080p]")
    ]);
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    expect(r.seriesRemap.size).toBe(0);
  });

  it("coalesces concurrent calls into a single LLM request", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ groups: [], ranking: [] }) }]
    });

    // Use unique titles to avoid cache hits from prior tests.
    const p1 = refineWithLlm([
      mkItem("[x1] Alpha Unique - 01 [1080p]"),
      mkItem("[x2] Bravo Unique - 01 [1080p]")
    ]);
    const p2 = refineWithLlm([
      mkItem("[x3] Charlie Unique - 01 [1080p]"),
      mkItem("[x4] Delta Unique - 01 [1080p]")
    ]);

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([p1, p2]);

    // Both calls should have been served by a single LLM call.
    expect(createMock).toHaveBeenCalledTimes(1);

    // The merged prompt should contain all four series titles.
    const promptArg = createMock.mock.calls[0][0];
    const content = promptArg.messages[0].content;
    expect(content).toContain("Alpha Unique");
    expect(content).toContain("Bravo Unique");
    expect(content).toContain("Charlie Unique");
    expect(content).toContain("Delta Unique");
  });
});

describe("splitByTokenBudget", () => {
  it("returns a single chunk when input fits", () => {
    const labels = ["Show A", "Show B", "Show C"];
    const groups = ["g1", "g2"];
    const chunks = splitByTokenBudget(labels, groups);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].labels).toEqual(labels);
    expect(chunks[0].groups).toEqual(groups);
  });

  it("splits labels across chunks when input is too large", () => {
    // Generate enough labels to exceed the token budget.
    const labels = Array.from({ length: 5000 }, (_, i) => `Long Anime Title Number ${i} With Extra Words`);
    const groups = ["g1", "g2"];
    const chunks = splitByTokenBudget(labels, groups);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should include the full groups list.
    for (const chunk of chunks) {
      expect(chunk.groups).toEqual(groups);
      expect(chunk.labels.length).toBeGreaterThan(0);
    }
    // All labels should be covered.
    const allLabels = chunks.flatMap((c) => c.labels);
    expect(allLabels).toEqual(labels);
  });

  it("includes full groups list in every chunk", () => {
    const labels = Array.from({ length: 5000 }, (_, i) => `Title ${i} extra padding words here`);
    const groups = ["GroupA", "GroupB", "GroupC"];
    const chunks = splitByTokenBudget(labels, groups);
    for (const chunk of chunks) {
      expect(chunk.groups).toEqual(groups);
    }
  });
});
