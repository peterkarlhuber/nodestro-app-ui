// Packs the interface into dist/nodestro-app-ui-<version>.tgz, deterministically: the same files give the same bytes
// (sorted entries, fixed time, owner and mode, no gzip name or time). Writes the archive's SHA-256 beside it and a copy
// of the manifest. The manifest must be current (npm run manifest).
//
//   node scripts/build-artifact.mjs [--out DIR]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { MANIFEST, ROOT, SRC, buildManifest, manifestText, sha256 } from "./files.mjs";

const BLOCK = 512;

function field(buffer, offset, length, text) {
  const bytes = Buffer.from(text, "utf-8");
  if (bytes.length > length) throw new Error(`tar field too long: ${text}`);
  bytes.copy(buffer, offset);
}

function octal(value, length) {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

/** One ustar entry (header and data, padded to whole blocks). */
function entry(path, data) {
  if (Buffer.byteLength(path) > 100) throw new Error(`path longer than 100 bytes: ${path}`);
  const header = Buffer.alloc(BLOCK);
  field(header, 0, 100, path);
  field(header, 100, 8, octal(0o644, 8));
  field(header, 108, 8, octal(0, 8));
  field(header, 116, 8, octal(0, 8));
  field(header, 124, 12, octal(data.length, 12));
  field(header, 136, 12, octal(0, 12));
  field(header, 148, 8, "        ");
  field(header, 156, 1, "0");
  field(header, 257, 6, "ustar\0");
  field(header, 263, 2, "00");
  let sum = 0;
  for (const byte of header) sum += byte;
  field(header, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  const padding = Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK);
  return Buffer.concat([header, data, padding]);
}

export function buildArchive() {
  const manifest = buildManifest();
  const current = readFileSync(join(SRC, MANIFEST), "utf-8");
  if (current !== manifestText(manifest)) throw new Error("src/manifest.json is not current: run npm run manifest");
  const parts = [entry(MANIFEST, Buffer.from(current, "utf-8"))];
  for (const file of manifest.files) parts.push(entry(file.path, readFileSync(join(SRC, file.path))));
  parts.push(Buffer.alloc(BLOCK * 2));
  const archive = gzipSync(Buffer.concat(parts), { level: 9 });
  archive[9] = 255; // gzip "OS: unknown", the same on every platform (the header has no time: bytes 4-7 are 0)
  return { manifest, archive };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-artifact.mjs")) {
  const at = process.argv.indexOf("--out");
  const out = at > 0 ? process.argv[at + 1] : join(ROOT, "dist");
  const { manifest, archive } = buildArchive();
  const name = `${manifest.name}-${manifest.version}.tgz`;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), archive);
  writeFileSync(join(out, `${name}.sha256`), `${sha256(archive)}  ${name}\n`);
  writeFileSync(join(out, MANIFEST), manifestText(manifest));
  console.log(`${join(out, name)} ${sha256(archive)}`);
}
