import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SearchResultItem } from "@/lib/types";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

import { buildSeriesRemap } from "@/lib/llmGrouping";

function mkItem(title: string): SearchResultItem {
  return { id: title, title, source: "nyaa", tags: [] };
}

describe("buildSeriesRemap", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.MINIMAX_API_KEY = "test-key";
  });

  it("returns empty map when MINIMAX_API_KEY is unset", async () => {
    delete process.env.MINIMAX_API_KEY;
    const remap = await buildSeriesRemap([
      mkItem("[g] Show A - 01 [1080p]"),
      mkItem("[g] Show B - 01 [1080p]")
    ]);
    expect(remap.size).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns empty map when fewer than 2 distinct series", async () => {
    const remap = await buildSeriesRemap([mkItem("[g] Show A - 01 [1080p]")]);
    expect(remap.size).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps original keys to canonical key from LLM clusters (cross-language only; S/T folded upstream)", async () => {
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
            ]
          })
        }
      ]
    });

    const remap = await buildSeriesRemap([
      mkItem("[g] 弹珠汽水瓶里的千岁同学 - 01 [1080p]"),
      mkItem("[g] Chitose-kun - 01 [1080p]")
    ]);

    expect(remap.get("chitose kun")).toBe("弹珠汽水瓶里的千岁同学");
  });

  it("falls back silently on JSON parse failure", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "not json at all" }] });
    const remap = await buildSeriesRemap([
      mkItem("[g] Show A - 01 [1080p]"),
      mkItem("[g] Show B - 01 [1080p]")
    ]);
    expect(remap.size).toBe(0);
  });

  it("strips markdown code fences before parsing", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "```json\n" +
            JSON.stringify({
              groups: [{ canonical: "Show A", originals: ["Show A", "Show A JP"] }]
            }) +
            "\n```"
        }
      ]
    });

    const remap = await buildSeriesRemap([
      mkItem("[g] Show A - 01 [1080p]"),
      mkItem("[g] Show A JP - 01 [1080p]")
    ]);
    expect(remap.get("show a jp")).toBe("show a");
  });

  it("ignores groups with fewer than 2 originals", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            groups: [{ canonical: "Show A", originals: ["Show A"] }]
          })
        }
      ]
    });
    const remap = await buildSeriesRemap([
      mkItem("[g] Show A - 01 [1080p]"),
      mkItem("[g] Show B - 01 [1080p]")
    ]);
    expect(remap.size).toBe(0);
  });
});
