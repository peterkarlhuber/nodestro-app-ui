// Writes or checks src/manifest.json (the files of the interface with their SHA-256).
//   node scripts/manifest.mjs --write   after changing a file of src/
//   node scripts/manifest.mjs --check   in CI: fails when the manifest is not current
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST, SRC, buildManifest, manifestText } from "./files.mjs";

const target = join(SRC, MANIFEST);
const wanted = manifestText(buildManifest());
if (process.argv.includes("--write")) {
  writeFileSync(target, wanted);
  console.log(`wrote src/${MANIFEST}`);
} else {
  let current = "";
  try { current = readFileSync(target, "utf-8"); } catch { /* missing */ }
  if (current !== wanted) {
    console.error(`src/${MANIFEST} is not current: run npm run manifest`);
    process.exit(1);
  }
  console.log(`src/${MANIFEST} is current`);
}
