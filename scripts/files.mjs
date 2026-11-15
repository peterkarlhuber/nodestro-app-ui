// The interface's files and its manifest: shared by the manifest, the artifact builder and the tests.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SRC = join(ROOT, "src");
export const MANIFEST = "manifest.json";
//: The contract versions the interface speaks; src/connection.js says the same (a unit test compares them).
export const CONTRACT = { min: 1, max: 1 };

/** Every file of src/ except the manifest, as sorted POSIX paths. Hidden files are refused. */
export function sourceFiles() {
  const found = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      if (name.startsWith(".")) throw new Error(`hidden file in src/: ${join(folder, name)}`);
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(SRC, path).split(sep).join("/"));
    }
  };
  walk(SRC);
  return found.filter((path) => path !== MANIFEST).sort();
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** The manifest of the current files: name, version, contract range, languages and every file with its hash. */
export function buildManifest() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const files = sourceFiles().map((path) => {
    const data = readFileSync(join(SRC, path));
    return { path, size: data.length, sha256: sha256(data) };
  });
  const languages = files
    .map((file) => /^i18n\/([A-Za-z-]+)\.json$/.exec(file.path))
    .filter(Boolean)
    .map((match) => match[1])
    .sort();
  return { name: pkg.name, version: pkg.version, contract: CONTRACT, languages, files };
}

export function manifestText(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}
