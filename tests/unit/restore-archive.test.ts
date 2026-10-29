import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { walkImagesArchive } from "../../src/lib/restore-archive.ts";

const name = `${"a".repeat(32)}-320.webp`;
type Entry = { name: string; type?: string; size?: number; link?: string; body?: Buffer };
function octal(header: Buffer, offset: number, length: number, value: number) {
  header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length, "ascii");
}
function header(entry: Entry) {
  const result = Buffer.alloc(512);
  result.write(entry.name, 0, 100, "utf8");
  octal(result, 100, 8, 0o600); octal(result, 108, 8, 0); octal(result, 116, 8, 0);
  octal(result, 124, 12, entry.size ?? (entry.body ?? Buffer.from("abc")).length);
  octal(result, 136, 12, 0);
  result.fill(32, 148, 156);
  result.write(entry.type ?? "0", 156);
  result.write(entry.link ?? "", 157, 100);
  result.write("ustar\0", 257, 6);
  let checksum = 0;
  for (const byte of result) checksum += byte;
  result.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return result;
}
function archive(entries: Entry[], tail = Buffer.alloc(1024)) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = entry.body ?? Buffer.from("abc");
    blocks.push(header(entry));
    if ((entry.type ?? "0") === "0") {
      blocks.push(body, Buffer.alloc((512 - body.length % 512) % 512));
    }
  }
  blocks.push(tail);
  return gzipSync(Buffer.concat(blocks));
}
async function temporary<T>(run: (folder: string) => Promise<T>) {
  const folder = await mkdtemp(join(tmpdir(), "community-archive-test-"));
  try { return await run(folder); }
  finally { await rm(folder, { recursive: true, force: true }); }
}
async function validate(bytes: Buffer) {
  return temporary(async folder => {
    const path = join(folder, "images.tar.gz");
    await writeFile(path, bytes, { mode: 0o600 });
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return await walkImagesArchive(file); }
    finally { await file.close().catch(() => {}); }
  });
}

test("restore archive accepts the flat regular-file format", async () => {
  assert.deepEqual(await validate(archive([{ name: "./", type: "5", size: 0 }, { name: `./${name}` }])), { files: 1, totalBytes: 3 });
});
test("restore archive accepts an actual GNU tar backup", async () => {
  await temporary(async folder => {
    const live = join(folder, "live"); await mkdir(live);
    await writeFile(join(live, name), "abc");
    const target = join(folder, "gnu.tar.gz");
    await new Promise<void>((done, fail) => {
      const child = spawn("tar", ["-C", live, "-czf", target, "."], { stdio: "ignore" });
      child.once("error", fail);
      child.once("close", code => code === 0 ? done() : fail(new Error("GNU tar fixture creation failed.")));
    });
    assert.deepEqual(await validate(await readFile(target)), { files: 1, totalBytes: 3 });
  });
});
test("restore archive accepts an empty image directory", async () => {
  assert.deepEqual(await validate(archive([{ name: "./", type: "5", size: 0 }])), { files: 0, totalBytes: 0 });
});
test("restore archive rejects parent traversal", async () => {
  await assert.rejects(validate(archive([{ name: "../outside.webp" }])));
});
test("restore archive rejects absolute paths", async () => {
  await assert.rejects(validate(archive([{ name: `/${name}` }])));
});
test("restore archive rejects symlinks", async () => {
  await assert.rejects(validate(archive([{ name: `./${name}`, type: "2", size: 0, link: "../outside" }])));
});
test("restore archive rejects hardlinks", async () => {
  await assert.rejects(validate(archive([{ name: `./${name}`, type: "1", size: 0, link: "../outside" }])));
});
test("restore archive rejects PAX/extended headers", async () => {
  await assert.rejects(validate(archive([{ name: `./${name}`, type: "x", size: 0 }])));
});
test("restore archive rejects duplicate filenames", async () => {
  await assert.rejects(validate(archive([{ name: `./${name}` }, { name: `./${name}` }])));
});
test("restore archive rejects an oversized declared variant before allocation", async () => {
  await assert.rejects(validate(archive([{ name: `./${name}`, size: 17 * 1024 * 1024 }])));
});
test("restore archive rejects truncated content", async () => {
  await assert.rejects(validate(gzipSync(header({ name: `./${name}`, size: 100 }))));
});
test("restore archive rejects data following its end marker", async () => {
  await assert.rejects(validate(archive([{ name: `./${name}` }], Buffer.concat([Buffer.alloc(1024), Buffer.from("bad")]))));
});
test("validation then exclusive extraction reuse the same descriptor and preserve content/mode", async () => {
  await temporary(async folder => {
    const target = join(folder, "images"); await mkdir(target, { mode: 0o700 });
    const path = join(folder, "images.tar.gz");
    await writeFile(path, archive([{ name: "./", type: "5", size: 0 }, { name: `./${name}` }]), { mode: 0o600 });
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      assert.equal((await walkImagesArchive(file)).files, 1);
      assert.equal((await walkImagesArchive(file, (key, body) => writeFile(join(target, key), body, { mode: 0o600, flag: "wx" }))).files, 1);
      assert.equal(await readFile(join(target, name), "utf8"), "abc");
      assert.equal((await stat(join(target, name))).mode & 0o777, 0o600);
      await assert.rejects(walkImagesArchive(file, (key, body) => writeFile(join(target, key), body, { mode: 0o600, flag: "wx" })));
    } finally { await file.close().catch(() => {}); }
  });
});
