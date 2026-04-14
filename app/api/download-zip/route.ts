import { NextRequest, NextResponse } from "next/server";
import { buildZip, type ZipEntry } from "@/lib/zip";

interface RequestItem {
  url: string;
  filename?: string;
}

interface RequestBody {
  items: RequestItem[];
}

// Guard against excessive batches / huge responses.
const MAX_ITEMS = 200;
const MAX_BYTES_PER_FILE = 20 * 1024 * 1024; // 20MB per torrent is already absurd
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function safeName(raw: string, fallback: string): string {
  const base = (raw || fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const trimmed = base.length > 180 ? base.slice(0, 180) : base;
  return trimmed || fallback;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ message: "invalid JSON body" }, { status: 400 });
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ message: "items 不能为空" }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { message: `一次最多打包 ${MAX_ITEMS} 个种子` },
      { status: 400 }
    );
  }

  const results = await Promise.all(
    items.map(async (item, index): Promise<ZipEntry | { error: string }> => {
      if (!item?.url || !/^https?:/i.test(item.url)) {
        return { error: `#${index + 1} 无效 URL` };
      }
      try {
        const response = await fetch(item.url, { cache: "no-store" });
        if (!response.ok) {
          return { error: `#${index + 1} HTTP ${response.status}` };
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_BYTES_PER_FILE) {
          return { error: `#${index + 1} 文件过大` };
        }
        const name = safeName(item.filename ?? `torrent-${index + 1}.torrent`, `torrent-${index + 1}.torrent`);
        return { name, data: new Uint8Array(arrayBuffer) };
      } catch (cause) {
        return { error: `#${index + 1} ${cause instanceof Error ? cause.message : "下载失败"}` };
      }
    })
  );

  const entries: ZipEntry[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  let totalBytes = 0;

  for (const r of results) {
    if ("error" in r) {
      errors.push(r.error);
      continue;
    }
    totalBytes += r.data.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      errors.push("累计体积超过限制，已截断");
      break;
    }
    // Deduplicate filenames by suffixing a counter.
    const count = seen.get(r.name) ?? 0;
    seen.set(r.name, count + 1);
    const finalName = count === 0 ? r.name : r.name.replace(/(\.torrent)?$/i, `-${count}$1`);
    entries.push({ name: finalName, data: r.data });
  }

  if (!entries.length) {
    return NextResponse.json(
      { message: "没有可打包的种子", errors },
      { status: 502 }
    );
  }

  if (errors.length) {
    const notice = encoder().encode(`下载过程中 ${errors.length} 项失败：\n${errors.join("\n")}\n`);
    entries.push({ name: "_errors.txt", data: notice });
  }

  const zip = buildZip(entries);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="torrents-${Date.now()}.zip"`,
      "Cache-Control": "no-store"
    }
  });
}

function encoder(): TextEncoder {
  return new TextEncoder();
}
