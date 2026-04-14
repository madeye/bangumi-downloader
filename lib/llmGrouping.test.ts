import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SearchResultItem } from "@/lib/types";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

import { refineWithLlm } from "@/lib/llmGrouping";

function mkItem(title: string): SearchResultItem {
  return { id: title, title, source: "nyaa", tags: [] };
}

describe("refineWithLlm", () => {
  beforeEach(() => {
    createMock.mockReset();
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

    const r = await refineWithLlm([
      mkItem("[桜都字幕组] 弹珠汽水瓶里的千岁同学 - 01 [1080p]"),
      mkItem("[nekomoe] Chitose-kun - 01 [1080p]")
    ]);

    expect(r.seriesRemap.get("chitose kun")).toBe("弹珠汽水瓶里的千岁同学");
    expect(r.groupRanking.get("桜都字幕组")).toBe(2);
    expect(r.groupRanking.get("nekomoe")).toBe(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("falls back silently on JSON parse failure", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "not json at all" }] });
    const r = await refineWithLlm([
      mkItem("[g1] Show A - 01 [1080p]"),
      mkItem("[g2] Show B - 01 [1080p]")
    ]);
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

    const r = await refineWithLlm([
      mkItem("[g] Show A - 01 [1080p]"),
      mkItem("[g] Show A JP - 01 [1080p]")
    ]);
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
    const r = await refineWithLlm([
      mkItem("[g1] Show A - 01 [1080p]"),
      mkItem("[g2] Show B - 01 [1080p]")
    ]);
    expect(r.seriesRemap.size).toBe(0);
  });
});
