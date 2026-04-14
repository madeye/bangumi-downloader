import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/download-zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function mockFetch(
  handler: (url: string) => { status: number; body: Uint8Array } | Promise<{ status: number; body: Uint8Array }>
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const { status, body } = await handler(url);
      return new Response(body as BodyInit, { status });
    })
  );
}

// Minimal STORE-zip reader (mirrors lib/zip.test.ts but scoped to what the
// route emits). Returns name -> bytes.
function parseZip(buf: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("EOCD not found");
  const total = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const out: Record<string, Uint8Array> = {};
  let cursor = centralOffset;
  const decoder = new TextDecoder();
  for (let i = 0; i < total; i++) {
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(buf.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    out[name] = buf.slice(dataStart, dataStart + compressedSize);
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/download-zip", () => {
  it("rejects an empty item list", async () => {
    const res = await POST(jsonRequest({ items: [] }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("items");
  });

  it("rejects invalid JSON bodies", async () => {
    const bad = new Request("http://localhost/api/download-zip", {
      method: "POST",
      body: "not json"
    });
    const res = await POST(bad as never);
    expect(res.status).toBe(400);
  });

  it("zips fetched torrents and returns an attachment", async () => {
    mockFetch((url) => {
      if (url.endsWith("/a")) return { status: 200, body: new TextEncoder().encode("AAA") };
      if (url.endsWith("/b")) return { status: 200, body: new TextEncoder().encode("BB") };
      return { status: 404, body: new Uint8Array() };
    });

    const res = await POST(
      jsonRequest({
        items: [
          { url: "http://x.test/a", filename: "alpha.torrent" },
          { url: "http://x.test/b", filename: "beta.torrent" }
        ]
      }) as never
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition") || "").toMatch(/attachment; filename=/);

    const buf = new Uint8Array(await res.arrayBuffer());
    const parsed = parseZip(buf);
    expect(new TextDecoder().decode(parsed["alpha.torrent"])).toBe("AAA");
    expect(new TextDecoder().decode(parsed["beta.torrent"])).toBe("BB");
  });

  it("records upstream failures in _errors.txt but still returns successful files", async () => {
    mockFetch((url) => {
      if (url.endsWith("/ok")) return { status: 200, body: new TextEncoder().encode("OK") };
      return { status: 500, body: new Uint8Array() };
    });

    const res = await POST(
      jsonRequest({
        items: [
          { url: "http://x.test/ok", filename: "ok.torrent" },
          { url: "http://x.test/bad", filename: "bad.torrent" }
        ]
      }) as never
    );

    expect(res.status).toBe(200);
    const parsed = parseZip(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(parsed).sort()).toEqual(["_errors.txt", "ok.torrent"]);
    expect(new TextDecoder().decode(parsed["_errors.txt"])).toMatch(/HTTP 500/);
  });

  it("returns 502 when every upstream fails", async () => {
    mockFetch(() => ({ status: 500, body: new Uint8Array() }));
    const res = await POST(
      jsonRequest({
        items: [
          { url: "http://x.test/a" },
          { url: "http://x.test/b" }
        ]
      }) as never
    );
    expect(res.status).toBe(502);
  });

  it("rejects non-http URLs per item", async () => {
    mockFetch(() => ({ status: 200, body: new TextEncoder().encode("ignored") }));
    const res = await POST(
      jsonRequest({
        items: [{ url: "file:///etc/passwd", filename: "evil.torrent" }]
      }) as never
    );
    // All items invalid -> no entries -> 502.
    expect(res.status).toBe(502);
  });

  it("deduplicates colliding filenames", async () => {
    mockFetch(() => ({ status: 200, body: new TextEncoder().encode("x") }));
    const res = await POST(
      jsonRequest({
        items: [
          { url: "http://x.test/1", filename: "dup.torrent" },
          { url: "http://x.test/2", filename: "dup.torrent" }
        ]
      }) as never
    );
    expect(res.status).toBe(200);
    const parsed = parseZip(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(parsed).sort()).toEqual(["dup-1.torrent", "dup.torrent"]);
  });

  it("sanitizes unsafe characters out of filenames", async () => {
    mockFetch(() => ({ status: 200, body: new TextEncoder().encode("x") }));
    const res = await POST(
      jsonRequest({
        items: [{ url: "http://x.test/1", filename: "../../pwn\0?.torrent" }]
      }) as never
    );
    expect(res.status).toBe(200);
    const parsed = parseZip(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(parsed);
    expect(names).toHaveLength(1);
    // Slashes (path separators) and control chars must be stripped so the
    // entry can't escape the extraction dir. Literal ".." alone is harmless.
    expect(names[0]).not.toMatch(/[\\/]/);
    expect(names[0]).not.toContain("\0");
    expect(names[0]).not.toContain("?");
  });

  it("caps batch size", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ url: `http://x.test/${i}` }));
    const res = await POST(jsonRequest({ items }) as never);
    expect(res.status).toBe(400);
  });
});
