// The checks of the interface's source: syntax, no HTML from strings, only relative asset paths, nothing loaded from
// elsewhere, and the six translations with the same keys and no empty texts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SRC, sourceFiles } from "./files.mjs";

const problems = [];
const LANGUAGES = ["de", "en", "es", "fr", "it", "pt-BR"];
//: Ways to turn a string into markup or code: results and form texts are untrusted, so none of them is used.
const FORBIDDEN = [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\s*\(/, /setTimeout\s*\(\s*["'`]/];

for (const path of sourceFiles()) {
  const text = path.match(/\.(js|html|css|json)$/) ? readFileSync(join(SRC, path), "utf-8") : null;
  if (text === null) continue;
  if (path.endsWith(".js")) {
    try {
      execFileSync(process.execPath, ["--check", join(SRC, path)], { stdio: "pipe" });
    } catch (error) {
      problems.push(`${path}: syntax error\n${error.stderr}`);
    }
    for (const pattern of FORBIDDEN) if (pattern.test(text)) problems.push(`${path}: ${pattern} is not allowed`);
  }
  if (/\/ui\/assets\//.test(text)) problems.push(`${path}: use relative asset paths (ui/assets/...), not /ui/assets/`);
  if (path.endsWith(".html") || path.endsWith(".css")) {
    const outside = text.replace(/http:\/\/www\.w3\.org\/[^"']*/g, "").match(/\b(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    if (outside) problems.push(`${path}: loads from elsewhere (${outside[0]})`);
  }
  if (path.endsWith(".html") && /<script(?![^>]*\bsrc=)[^>]*>/.test(text)) problems.push(`${path}: inline script`);
  if (path.endsWith(".html") && /\sstyle=/.test(text)) problems.push(`${path}: inline style attribute`);
  if (path.endsWith(".html") && /\son[a-z]+=/i.test(text)) problems.push(`${path}: inline event handler`);
}

const english = JSON.parse(readFileSync(join(SRC, "i18n", "en.json"), "utf-8"));
for (const language of LANGUAGES) {
  const strings = JSON.parse(readFileSync(join(SRC, "i18n", `${language}.json`), "utf-8"));
  const missing = Object.keys(english).filter((key) => !(key in strings));
  const extra = Object.keys(strings).filter((key) => !(key in english));
  const empty = Object.entries(strings).filter(([, value]) => typeof value !== "string" || !value.trim()).map(([key]) => key);
  if (missing.length) problems.push(`i18n/${language}.json: missing ${missing.join(", ")}`);
  if (extra.length) problems.push(`i18n/${language}.json: unknown ${extra.join(", ")}`);
  if (empty.length) problems.push(`i18n/${language}.json: empty ${empty.join(", ")}`);
  for (const [key, value] of Object.entries(strings)) {
    const wanted = new Set((english[key] || "").match(/\{\w+\}/g) || []);
    const found = new Set((value || "").match(/\{\w+\}/g) || []);
    if ([...wanted].some((name) => !found.has(name))) problems.push(`i18n/${language}.json: ${key} lacks a placeholder of en`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`lint: ${sourceFiles().length} files ok`);
