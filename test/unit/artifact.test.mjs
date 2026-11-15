import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { buildArchive } from "../../scripts/build-artifact.mjs";
import { MANIFEST, SRC, buildManifest, manifestText, sha256, sourceFiles } from "../../scripts/files.mjs";

test("the manifest is current and lists every file with its hash", () => {
  const manifest = buildManifest();
  assert.equal(readFileSync(join(SRC, MANIFEST), "utf-8"), manifestText(manifest), "run npm run manifest");
  assert.deepEqual(manifest.files.map((file) => file.path), sourceFiles());
  assert.ok(!manifest.files.some((file) => file.path === MANIFEST));
  for (const file of manifest.files) assert.equal(file.sha256, sha256(readFileSync(join(SRC, file.path))), file.path);
  assert.deepEqual(manifest.languages, ["de", "en", "es", "fr", "it", "pt-BR"]);
  assert.match(manifest.version, /^\d+\.\d+\.\d+/);
});

test("the archive is deterministic and holds the manifest and every file", () => {
  const first = buildArchive().archive;
  const second = buildArchive().archive;
  assert.equal(sha256(first), sha256(second));
  assert.equal(first[9], 255);
  assert.equal(first.readUInt32LE(4), 0);
  const tar = gunzipSync(first);
  const names = [];
  for (let offset = 0; offset < tar.length; ) {
    const name = tar.subarray(offset, offset + 100).toString("utf-8").replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString("utf-8"), 8);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    if (name !== MANIFEST) assert.equal(sha256(data), sha256(readFileSync(join(SRC, name))), name);
    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(names, [MANIFEST, ...sourceFiles()]);
});
