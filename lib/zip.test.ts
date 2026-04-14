import { describe, expect, it } from "vitest";
import { buildZip } from "@/lib/zip";

// Parse a STORE-only zip produced by buildZip and return { name -> data }.
// Only implements the subset we write: no compression, no extras, no comments.
function parseZip(buf: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Locate EOCD by scanning from the end.
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
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error(`central header missing at ${cursor}`);
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(buf.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (method !== 0) throw new Error(`unexpected method ${method}`);

    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("local header missing");
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    out[name] = buf.slice(dataStart, dataStart + compressedSize);
  }

  return out;
}

describe("buildZip", () => {
  it("round-trips a single entry", () => {
    const data = new TextEncoder().encode("hello world");
    const zip = buildZip([{ name: "a.txt", data }]);
    const parsed = parseZip(zip);
    expect(Object.keys(parsed)).toEqual(["a.txt"]);
    expect(new TextDecoder().decode(parsed["a.txt"])).toBe("hello world");
  });

  it("preserves multiple entries and binary content", () => {
    const bin = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const zip = buildZip([
      { name: "first.torrent", data: new TextEncoder().encode("AAA") },
      { name: "sub/second.bin", data: bin }
    ]);
    const parsed = parseZip(zip);
    expect(new TextDecoder().decode(parsed["first.torrent"])).toBe("AAA");
    expect(Array.from(parsed["sub/second.bin"])).toEqual(Array.from(bin));
  });

  it("produces a valid EOCD with the right entry count", () => {
    const zip = buildZip([
      { name: "x", data: new Uint8Array([1]) },
      { name: "y", data: new Uint8Array([2]) },
      { name: "z", data: new Uint8Array([3]) }
    ]);
    // Signature at offset len-22 (no comment).
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(3);
  });

  it("handles an empty entry list", () => {
    const zip = buildZip([]);
    expect(parseZip(zip)).toEqual({});
  });

  it("stores a CRC32 that matches the file data", () => {
    const data = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    const zip = buildZip([{ name: "q.txt", data }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // CRC is at offset 14 of the local file header (which starts at 0).
    const crc = view.getUint32(14, true);
    // Known CRC32 of the pangram.
    expect(crc.toString(16)).toBe("414fa339");
  });
});
