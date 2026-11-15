// The interface on its own origin (NAL-C5, docs/cross-origin.md in nodestro-api): the same files, laid out for a
// static host (index.html at the root, everything else under ui/assets/), with the standalone mode switched on and a
// Content Security Policy in a meta element. The embedded form (the artifact) is not changed.
//
//   node scripts/build-standalone.mjs [--out DIR]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MANIFEST, ROOT, SRC, buildManifest, manifestText } from "./files.mjs";

//: What a meta element can carry: no frame-ancestors (the static host sends it as a header, see README).
//: connect-src: the backends, over HTTPS, or a backend on this computer.
export const STANDALONE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; " +
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*; manifest-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'";

/** The standalone page: the embedded index.html with the mode and the policy. */
export function standaloneIndex() {
  const page = readFileSync(join(SRC, "index.html"), "utf-8");
  const marker = '<meta charset="utf-8">';
  if (!page.includes(marker)) throw new Error("index.html has no charset meta element");
  return page.replace(
    marker,
    `${marker}\n  <meta http-equiv="Content-Security-Policy" content="${STANDALONE_CSP}">\n  <meta name="nodestro-mode" content="standalone">`,
  );
}

/** Writes the standalone form to `out`; returns the list of written paths. */
export function buildStandalone(out) {
  const manifest = buildManifest();
  rmSync(out, { recursive: true, force: true });
  const written = [];
  const put = (path, data) => {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), data);
    written.push(path);
  };
  put("index.html", standaloneIndex());
  for (const file of manifest.files) {
    if (file.path === "index.html") continue;
    put(`ui/assets/${file.path}`, readFileSync(join(SRC, file.path)));
  }
  put(`ui/assets/${MANIFEST}`, manifestText(manifest));
  return written;
}

if (process.argv[1]?.endsWith("build-standalone.mjs")) {
  const at = process.argv.indexOf("--out");
  const out = at > 0 ? process.argv[at + 1] : join(ROOT, "dist", "standalone");
  console.log(`${out}: ${buildStandalone(out).length} files`);
}
