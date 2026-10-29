import { createReadStream } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createGunzip } from "node:zlib";

const imageName = /^[a-f0-9]{32}-(?:320|640|1200)\.webp$/;
const maxVariantBytes = 16 * 1024 * 1024;

// Backups produced by this application contain a flat directory of short, random
// WebP names. Reject all links, extended/PAX headers, paths and unexpected types.
// Bound memory to one image variant, never the complete archive. This walker is
// used once before any database creation and again for extraction to a new 0700
// directory. Both passes use the same open file descriptor, not a re-opened path.
export async function walkImagesArchive(file: FileHandle, receive?: (name: string, body: Buffer) => Promise<void>) {
  const input = createReadStream("", { fd: file.fd, start: 0, autoClose: false });
  const decoded = createGunzip();
  input.once("error", error => decoded.destroy(error));
  input.pipe(decoded);
  const iterator = decoded[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  async function take(length: number, allowEof = false): Promise<Buffer> {
    const pieces: Buffer[] = [];
    let needed = length;
    while (needed) {
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) {
          if (allowEof && needed === length) return Buffer.alloc(0);
          throw new Error("Incomplete image archive.");
        }
        pending = Buffer.from(next.value);
      }
      const used = Math.min(needed, pending.length);
      pieces.push(pending.subarray(0, used));
      pending = pending.subarray(used);
      needed -= used;
    }
    return Buffer.concat(pieces, length);
  }
  function textField(block: Buffer, start: number, length: number) {
    const field = block.subarray(start, start + length);
    const end = field.indexOf(0);
    return field.subarray(0, end < 0 ? field.length : end).toString("ascii");
  }
  function octalField(block: Buffer, start: number, length: number) {
    const value = block.subarray(start, start + length).toString("ascii").replace(/\0/g, "").trim();
    if (!/^[0-7]+$/.test(value)) throw new Error("Unsupported image archive number.");
    const result = parseInt(value, 8);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid image archive size.");
    return result;
  }
  const seen = new Set<string>();
  let files = 0;
  let totalBytes = 0;
  let rootSeen = false;
  try {
    for (;;) {
      const header = await take(512);
      if (header.every(byte => byte === 0)) {
        if (!(await take(512)).every(byte => byte === 0)) throw new Error("Invalid image archive terminator.");
        // Normal tar padding is small. Bound trailing zeros to avoid a gzip bomb.
        let padding = 0;
        for (;;) {
          const rest = await take(512, true);
          if (!rest.length) break;
          padding += rest.length;
          if (padding > 1024 * 1024 || !rest.every(byte => byte === 0)) throw new Error("Invalid trailing image archive data.");
        }
        break;
      }
      let checksum = 0;
      for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index]!;
      if (checksum !== octalField(header, 148, 8)) throw new Error("Invalid image archive header checksum.");
      const name = textField(header, 0, 100);
      const prefix = textField(header, 345, 155);
      const link = textField(header, 157, 100);
      const type = String.fromCharCode(header[156]!);
      const size = octalField(header, 124, 12);
      if (prefix || link) throw new Error("Image archive paths and links are forbidden.");
      if ((name === "./" || name === ".") && type === "5" && size === 0 && !rootSeen) {
        rootSeen = true;
        continue;
      }
      const safeName = name.startsWith("./") ? name.slice(2) : name;
      if (!imageName.test(safeName) || !["0", "\0"].includes(type) || size < 1 || size > maxVariantBytes || seen.has(safeName)) {
        throw new Error("Unsafe image archive entry.");
      }
      seen.add(safeName);
      const body = await take(size);
      const padding = (512 - size % 512) % 512;
      if (padding && !(await take(padding)).every(byte => byte === 0)) throw new Error("Invalid image archive file padding.");
      if (receive) await receive(safeName, body);
      files++;
      totalBytes += size;
      if (!Number.isSafeInteger(totalBytes)) throw new Error("Image archive is too large.");
    }
    return { files, totalBytes };
  } finally {
    // A successful pass leaves the caller-owned descriptor open for reuse.
    // On rejection, stop pending reads; the caller tolerates an already-closed FD.
    if (!input.readableEnded) input.destroy();
    decoded.destroy();
  }
}
