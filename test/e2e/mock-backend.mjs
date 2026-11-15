// A stand-in backend for the browser tests: the interface's files and recorded answers of the app contract and of the
// embedded interface's routes (/ui/api/...), with the same Content Security Policy as nodestro-api. Nothing runs a
// workflow: a run finishes when the test says so.
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { SRC } from "../../scripts/files.mjs";

//: nodestro_api.webui_server.CSP
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; " +
  "connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; " +
  "form-action 'self'; frame-ancestors 'none'";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png" };
export const LANGUAGES = ["de", "en", "es", "fr", "it", "pt-BR"];
export const KEY = "ndk_test_good";
export const OUTPUT = "# Report\n\nThis is **bold** and <script>window.injected = 1</script> plain text.\n\n- one\n- two";

export const DISCOVERY = {
  contract: { name: "nodestro-app", versions: [1], current: 1 },
  backend: { id: "bk_0123456789abcdef01234567", name: "Office server", version: "0.2.0", runtime_version: "0.2.1" },
  auth: { methods: ["api_key", "session"] },
  tls: { enabled: false },
  capabilities: ["runs", "events.sse", "files.upload", "files.download", "cancel", "resume", "history"],
  apps: [],
};
const FORM = [
  { name: "topic", type: "text", label: "Topic", help: "What the report is about", required: true, default: null, options: [], multiple: false, accept: [], accept_formats: [], max_mb: null, max_files: null },
  { name: "tone", type: "select", label: "Tone", help: "", required: false, default: "formal", options: ["formal", "casual"], multiple: false, accept: [], accept_formats: [], max_mb: null, max_files: null },
];
//: What /ui/api/config says (a backend without the contract has only this; the label shows where a field came from).
const CONFIG_FIELDS = [
  { name: "topic", label: "Topic (config)", type: "text", description: "", required: true, default: null, options: [], accept: [], multiple: false, max_files: null, max_size_mb: null },
];

export async function startMock() {
  const mock = {
    mode: "contract", // "contract" | "legacy" | "incompatible" | "info-forbidden"
    runStatus: "running",
    runs: 0,
    requests: [],
  };
  const sessions = new Set();
  const streams = new Set();

  const json = (response, status, body, headers = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify(body));
  };
  const problem = (response, status, code, headers) => json(response, status, { error: { status, code, message: code } }, headers);
  const session = (request) => {
    const match = /(?:^|;\s*)nodestro_ui=([^;]+)/.exec(request.headers.cookie || "");
    return match && sessions.has(match[1]) ? match[1] : null;
  };
  const body = (request) => new Promise((resolve) => {
    const parts = [];
    request.on("data", (part) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts)));
  });
  const run = () => ({
    run_id: "run_1", status: mock.runStatus, created_at: "2026-11-15T08:00:00Z", duration_seconds: 2, error: null,
    steps: [{ node_id: "write", label: "Write", status: mock.runStatus === "running" ? "running" : "succeeded" }],
    approvals: [], usage: { total_tokens: 1234 },
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    mock.requests.push(request.method + " " + path);
    const contract = { "Nodestro-App-Contract": "1" };
    if (request.method !== "GET" && path.startsWith("/ui/api/") && request.headers["x-nodestro-ui"] !== "1") return problem(response, 403, "request.cross_site");

    if (request.method === "GET" && path === "/") {
      response.writeHead(200, { "Content-Type": TYPES[".html"], "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      return response.end(readFileSync(join(SRC, "index.html")));
    }
    if (request.method === "GET" && path.startsWith("/ui/assets/")) {
      const relative = normalize(decodeURIComponent(path.slice("/ui/assets/".length)));
      const target = join(SRC, relative);
      if (relative.startsWith("..") || !target.startsWith(SRC + sep) || !TYPES[extname(target)]) return problem(response, 404, "not_found");
      try { statSync(target); } catch { return problem(response, 404, "not_found"); }
      response.writeHead(200, { "Content-Type": TYPES[extname(target)], "X-Content-Type-Options": "nosniff" });
      return response.end(readFileSync(target));
    }
    if (path === "/ui/api/bootstrap") {
      return json(response, 200, { name: "Report writer", description: "Writes a short report.", version: 3, language: "en", languages: LANGUAGES, session: session(request) ? { scopes: ["run", "read"], operator: false, name: "Test key" } : null });
    }
    if (path === "/ui/api/session" && request.method === "POST") {
      const sent = JSON.parse((await body(request)).toString() || "{}");
      if (sent.api_key !== KEY) return problem(response, 401, "auth.invalid", contract);
      const id = "s" + (sessions.size + 1);
      sessions.add(id);
      return json(response, 200, { scopes: ["run", "read"], operator: false, name: "Test key" }, { ...contract, "Set-Cookie": `nodestro_ui=${id}; Path=/; HttpOnly; SameSite=Strict` });
    }
    if (path === "/ui/api/session" && request.method === "DELETE") {
      sessions.delete(session(request));
      return json(response, 200, { signed_out: true }, { ...contract, "Set-Cookie": "nodestro_ui=; Path=/; Max-Age=0" });
    }
    if (path === "/api/app") {
      if (mock.mode === "legacy") return problem(response, 404, "not_found");
      const versions = mock.mode === "incompatible" ? [2] : [1];
      const minimal = { contract: { name: "nodestro-app", versions, current: versions[0] }, backend: { id: DISCOVERY.backend.id, name: DISCOVERY.backend.name }, auth: DISCOVERY.auth, tls: DISCOVERY.tls };
      return json(response, 200, session(request) ? { ...DISCOVERY, contract: minimal.contract } : minimal, contract);
    }
    if (!session(request)) return problem(response, 401, "auth.required", path.startsWith("/api/") ? contract : {});
    if (path === "/ui/api/config") {
      return json(response, 200, { slug: "report", name: "Report writer", description: "Writes a short report.", version: 3, fields: CONFIG_FIELDS, free_input: false, default_input: "", output_schema: null, approvals: false, max_upload_mb: 20, missing_resources: [], api_base: "/api/published/report", providers: [], output_dir: { enabled: false } });
    }
    if (path === "/api/published/report") {
      if (mock.mode === "info-forbidden") return problem(response, 403, "auth.scope", contract);
      return json(response, 200, { slug: "report", name: "Report writer", description: "Writes a short report.", release: 3, form_version: 1, form: FORM }, contract);
    }
    if (path === "/api/published/report/runs" && request.method === "POST") {
      await body(request);
      mock.runs += 1;
      mock.runStatus = mock.finishAtOnce ? "succeeded" : "running";
      return json(response, 202, run(), contract);
    }
    if (path === "/api/published/report/runs") return json(response, 200, { runs: mock.runs ? [run()] : [] }, contract);
    if (path === "/api/published/report/runs/run_1") return json(response, 200, run(), contract);
    if (path === "/api/published/report/runs/run_1/result") return json(response, 200, { run_id: "run_1", status: mock.runStatus, output: OUTPUT, files: [] }, contract);
    if (path === "/api/published/report/runs/run_1/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", ...contract });
      response.write("event: status\ndata: " + JSON.stringify(run()) + "\n\n");
      streams.add(response);
      request.on("close", () => streams.delete(response));
      return;
    }
    return problem(response, 404, "not_found", contract);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.url = `http://127.0.0.1:${server.address().port}`;
  mock.finish = () => {
    mock.runStatus = "succeeded";
    for (const stream of streams) {
      stream.write("event: status\ndata: " + JSON.stringify(run()) + "\n\n");
      stream.write("event: end\ndata: {}\n\n");
      stream.end();
    }
    streams.clear();
  };
  mock.close = () => new Promise((resolve) => { for (const stream of streams) stream.destroy(); server.closeAllConnections(); server.close(resolve); });
  return mock;
}
