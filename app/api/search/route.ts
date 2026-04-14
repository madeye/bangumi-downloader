import { NextRequest, NextResponse } from "next/server";
import { searchTorrents } from "@/lib/search";
import type { ScriptPreference, SearchSource } from "@/lib/types";

function parseSources(raw: string | null): SearchSource[] | undefined {
  if (!raw) {
    return undefined;
  }

  const valid: SearchSource[] = ["bangumi-moe", "acg-rip", "dmhy", "nyaa"];
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is SearchSource => valid.includes(value as SearchSource));

  return values.length ? values : undefined;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const keyword = searchParams.get("q")?.trim() || "";
  const limit = Number(searchParams.get("limit") || "20");
  const offset = Number(searchParams.get("offset") || "0");
  const sources = parseSources(searchParams.get("sources"));
  const preferRaw = searchParams.get("prefer");
  const scriptPreference: ScriptPreference | undefined =
    preferRaw === "simplified" || preferRaw === "traditional" ? preferRaw : undefined;
  // refine=0 → skip the LLM-backed remap/ranking for a fast first response.
  // refine=1 (default) → full pass. Client renders refine=0 immediately, then
  // issues refine=1 in the background and swaps the groups when it returns.
  const refineRaw = searchParams.get("refine");
  const useLlm = refineRaw !== "0";

  if (!keyword) {
    return NextResponse.json(
      { message: "缺少搜索关键词 `q`。" },
      { status: 400 }
    );
  }

  const result = await searchTorrents(
    {
      keyword,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
      offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
      sources,
      scriptPreference
    },
    { useLlm }
  );

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
