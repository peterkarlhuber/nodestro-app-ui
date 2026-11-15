// A stand-in backend for the browser tests: the interface's files and recorded answers of the app contract and of the
// embedded interface's routes (/ui/api/...), with the same Content Security Policy as nodestro-api. Nothing runs a
// workflow: a run finishes when the test says so.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { buildStandalone } from "../../scripts/build-standalone.mjs";
import { SRC } from "../../scripts/files.mjs";

//: nodestro_api.webui_server.CSP
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; " +
  "connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; " +
  "form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png" };
export const LANGUAGES = ["de", "en", "es", "fr", "it", "pt-BR"];
export const KEY = "ndk_test_good";
export const PAIR_CODE = "K7QDM2XA";
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
  { name: "docs", type: "file", label: "Documents", help: "", required: false, default: null, options: [], multiple: true, accept: [".pdf", ".docx"], accept_formats: ["pdf", "docx"], max_mb: 20, max_files: 3 },
];
//: What /ui/api/config says (a backend without the contract has only this; the label shows where a field came from).
const CONFIG_FIELDS = [
  { name: "topic", label: "Topic (config)", type: "text", description: "", required: true, default: null, options: [], accept: [], multiple: false, max_files: null, max_size_mb: null },
];

//: A self-issued certificate for the HTTPS mock (NAL-C4) and its SHA-256 fingerprint as the backend reports it.
function selfSigned() {
  const folder = mkdtempSync(join(tmpdir(), "nodestro-ui-tls-"));
  try {
    const key = join(folder, "key.pem"), cert = join(folder, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "2",
      "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert], { stdio: "ignore" });
    const fingerprint = execFileSync("openssl", ["x509", "-in", cert, "-noout", "-fingerprint", "-sha256"]).toString()
      .trim().split("=")[1].toUpperCase();
    return { key: readFileSync(key), cert: readFileSync(cert), fingerprint };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export async function startMock({ tls = false } = {}) {
  const mock = {
    mode: "contract", // "contract" | "legacy" | "incompatible" | "info-forbidden"
    runStatus: "running",
    runs: 0,
    requests: [],
    pairing: false,
    //: NAL-C5: the token profile and CORS for the interface on another origin, and the origins allowed.
    crossOrigin: false,
    allowedOrigins: [],
    expiresIn: 900,
  };
  const certificate = tls ? selfSigned() : null;
  mock.fingerprint = certificate ? certificate.fingerprint : null;
  const sessions = new Set();
  //: Paired devices: id -> {secret, revoked}; sessions of a device end when it is revoked.
  const devices = new Map();
  const deviceSessions = new Map();
  const streams = new Set();
  //: Access tokens (memory only, as nodestro-api): token -> device id.
  const tokens = new Map();

  const json = (response, status, body, headers = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...(response.cors || {}), ...headers });
    response.end(JSON.stringify(body));
  };
  const problem = (response, status, code, headers) => json(response, status, { error: { status, code, message: code } }, headers);
  const session = (request) => {
    const match = /(?:^|;\s*)nodestro_ui=([^;]+)/.exec(request.headers.cookie || "");
    if (!match || !sessions.has(match[1])) return null;
    const device = deviceSessions.get(match[1]);
    return device && devices.get(device).revoked ? null : match[1];
  };
  const deviceCookie = (request) => {
    const match = /(?:^|;\s*)nodestro_device=([^;]+)/.exec(request.headers.cookie || "");
    return match ? match[1] : "";
  };
  const refreshCookie = (request) => {
    const match = new RegExp(`(?:^|;\\s*)${refreshName()}=([^;]+)`).exec(request.headers.cookie || "");
    return match ? match[1] : "";
  };
  const issued = (response, id) => {
    const device = devices.get(id);
    const secret = "secret" + Math.random().toString(36).slice(2);
    if (device.secret) device.replaced.push(device.secret);
    device.secret = secret;
    const token = "nat_" + Math.random().toString(36).slice(2);
    tokens.set(token, id);
    const app = { slug: "report", name: "Report writer", description: "Writes a short report.", version: 3, fields: CONFIG_FIELDS, free_input: false, default_input: "", output_schema: null, approvals: false, max_upload_mb: 20, missing_resources: [], api_base: "/api/published/report", providers: [], output_dir: { enabled: false } };
    return json(response, 200, { access_token: token, token_type: "Bearer", expires_in: mock.expiresIn, device: { id, name: device.name, scopes: ["run", "read"] }, app }, {
      "Set-Cookie": `${refreshName()}=${id}.${secret}; Max-Age=7776000; Path=/api/app/token; HttpOnly; Secure; SameSite=None; Partitioned`,
    });
  };
  //: As nodestro-api: the name carries the backend, since cookies do not tell ports apart.
  const refreshName = () => "nodestro_refresh_" + server.address().port;
  const tokenDevice = (request) => {
    const match = /^Bearer (nat_\S+)$/.exec(request.headers.authorization || "");
    const id = match && tokens.get(match[1]);
    const device = id && devices.get(id);
    return device && !device.revoked && device.origin === request.headers.origin ? id : null;
  };
  const tlsInfo = () => (tls ? { mode: "self_signed", fingerprint: mock.fingerprint } : { mode: "none", fingerprint: null });
  const signedIn = (response, id) => {
    const device = devices.get(id);
    const secret = "secret" + Math.random().toString(36).slice(2);
    if (device.secret) device.replaced.push(device.secret);
    device.secret = secret;
    const sessionId = "s" + (sessions.size + 1);
    sessions.add(sessionId);
    deviceSessions.set(sessionId, id);
    const secure = tls ? "; Secure" : "";
    return json(response, 200, { device: { id, name: device.name, scopes: ["run", "read"] }, operator: false }, {
      "Set-Cookie": [
        `nodestro_ui=${sessionId}; Path=/; HttpOnly; SameSite=Strict${secure}`,
        `nodestro_device=${id}.${secret}; Path=/ui/api/device; HttpOnly; SameSite=Strict; Max-Age=7776000${secure}`,
      ],
    });
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

  const handler = async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    mock.requests.push(request.method + " " + path);
    const contract = { "Nodestro-App-Contract": "1" };
    // CORS as nodestro-api (docs/cross-origin.md): only allowed origins, only the app contract's paths.
    const origin = request.headers.origin;
    const kind = path === "/api/app/token" || path === "/api/app/token/refresh" ? "token" : path === "/api/app" ? "discovery" : path.startsWith("/api/published/report") ? "app" : null;
    if (mock.crossOrigin && kind && origin && new URL(origin).host !== request.headers.host) {
      if (!mock.allowedOrigins.includes(origin)) return problem(response, 403, "cors.origin_not_allowed");
      response.cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Expose-Headers": "Nodestro-App-Contract, Retry-After, Content-Disposition" };
      if (kind === "token") response.cors["Access-Control-Allow-Credentials"] = "true";
      if (request.method === "OPTIONS") {
        response.writeHead(204, { ...response.cors, "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Idempotency-Key, Last-Event-ID, X-Nodestro-App", "Access-Control-Max-Age": "600" });
        return response.end();
      }
    }
    if (kind === "token") {
      if (!mock.crossOrigin) return problem(response, 404, "token.disabled");
      if (request.headers["x-nodestro-app"] !== "1") return problem(response, 403, "token.header_required");
      if (path === "/api/app/token" && request.method === "POST") {
        const sent = JSON.parse((await body(request)).toString() || "{}");
        if (String(sent.code || "").replace(/[-\s]/g, "").toUpperCase() !== PAIR_CODE) return problem(response, 400, "pairing.code_invalid");
        const id = "dev_" + (devices.size + 1).toString().padStart(16, "0");
        devices.set(id, { name: sent.name || "Browser", revoked: false, replaced: [], origin });
        return issued(response, id);
      }
      if (path === "/api/app/token/refresh" && request.method === "POST") {
        const [id, secret] = refreshCookie(request).split(".");
        const device = devices.get(id);
        if (device && device.replaced.includes(secret)) device.revoked = true;
        if (!device || device.revoked || device.secret !== secret || device.origin !== origin) return problem(response, 401, "pairing.device_revoked", { "Set-Cookie": `${refreshName()}=; Max-Age=0; Path=/api/app/token; HttpOnly; Secure; SameSite=None; Partitioned` });
        return issued(response, id);
      }
      if (path === "/api/app/token" && request.method === "DELETE") {
        const id = tokenDevice(request);
        if (!id) return problem(response, 401, "auth.invalid");
        devices.get(id).revoked = true;
        return json(response, 200, { removed: true }, { "Set-Cookie": `${refreshName()}=; Max-Age=0; Path=/api/app/token; HttpOnly; Secure; SameSite=None; Partitioned` });
      }
    }
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
      const current = session(request);
      const device = current && deviceSessions.get(current);
      const described = current ? { scopes: ["run", "read"], operator: false, name: device ? devices.get(device).name : "Test key", device: Boolean(device) } : null;
      return json(response, 200, { name: "Report writer", description: "Writes a short report.", version: 3, language: "en", languages: LANGUAGES, session: described, pairing: mock.pairing, tls: tlsInfo() });
    }
    if (path === "/ui/api/pair" && request.method === "POST") {
      const sent = JSON.parse((await body(request)).toString() || "{}");
      if (!mock.pairing) return problem(response, 404, "pairing.disabled");
      if (String(sent.code || "").replace(/[-\s]/g, "").toUpperCase() !== PAIR_CODE) return problem(response, 400, "pairing.code_invalid");
      const id = "dev_" + (devices.size + 1).toString().padStart(16, "0");
      devices.set(id, { name: sent.name || "Browser", revoked: false, replaced: [] });
      return signedIn(response, id);
    }
    if (path === "/ui/api/device/session" && request.method === "POST") {
      await body(request);
      const [id, secret] = deviceCookie(request).split(".");
      const device = devices.get(id);
      // As nodestro-api: a secret that was rotated away revokes the device (a stolen copy, or two tabs at once).
      if (device && device.replaced.includes(secret)) device.revoked = true;
      if (!device || device.revoked || device.secret !== secret) return problem(response, 401, "pairing.device_revoked");
      return signedIn(response, id);
    }
    if (path === "/ui/api/device" && request.method === "DELETE") {
      const current = session(request);
      const id = current && deviceSessions.get(current);
      if (!id) return problem(response, 403, "pairing.not_a_device");
      devices.get(id).revoked = true;
      return json(response, 200, { removed: true }, { "Set-Cookie": ["nodestro_ui=; Path=/; Max-Age=0", "nodestro_device=; Path=/ui/api/device; Max-Age=0"] });
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
      const auth = { methods: [...DISCOVERY.auth.methods, ...(mock.pairing ? ["pairing"] : []), ...(mock.crossOrigin ? ["token"] : [])] };
      const minimal = { contract: { name: "nodestro-app", versions, current: versions[0] }, backend: { id: DISCOVERY.backend.id, name: DISCOVERY.backend.name }, auth, tls: tls ? { enabled: true, ...tlsInfo() } : DISCOVERY.tls };
      return json(response, 200, session(request) || tokenDevice(request) ? { ...DISCOVERY, contract: minimal.contract, auth, tls: minimal.tls } : minimal, contract);
    }
    if (kind === "app" && origin && response.cors && !tokenDevice(request)) return problem(response, 401, "auth.token_required", contract);
    if (!session(request) && !tokenDevice(request)) return problem(response, 401, "auth.required", path.startsWith("/api/") ? contract : {});
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
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", ...(response.cors || {}), ...contract });
      response.write("event: status\ndata: " + JSON.stringify(run()) + "\n\n");
      streams.add(response);
      request.on("close", () => streams.delete(response));
      return;
    }
    return problem(response, 404, "not_found", contract);
  };
  const server = certificate ? createSecureServer({ key: certificate.key, cert: certificate.cert }, handler) : createServer(handler);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.url = `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;
  //: A restart of the backend: every access token is gone (the refresh cookie stays valid).
  mock.dropTokens = () => tokens.clear();
  mock.devices = () => [...devices.values()];
  mock.revokeAll = () => { for (const device of devices.values()) device.revoked = true; };
  mock.revoked = () => [...devices.values()].filter((device) => device.revoked).length;
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

//: The standalone form of the interface (npm run build:standalone) on a static host of its own, as a site of its own
//: (https://localhost:PORT, while the backends are https://127.0.0.1:PORT), with the headers the README asks for.
export async function startStatic() {
  const folder = mkdtempSync(join(tmpdir(), "nodestro-ui-static-"));
  buildStandalone(folder);
  const certificate = selfSigned();
  const server = createSecureServer({ key: certificate.key, cert: certificate.cert }, (request, response) => {
    const path = new URL(request.url, "https://localhost").pathname;
    const relative = path === "/" ? "index.html" : normalize(decodeURIComponent(path.slice(1)));
    const target = join(folder, relative);
    if (relative.startsWith("..") || !target.startsWith(folder + sep) || !TYPES[extname(target)]) { response.writeHead(404); return response.end(); }
    try { statSync(target); } catch { response.writeHead(404); return response.end(); }
    response.writeHead(200, { "Content-Type": TYPES[extname(target)], "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "frame-ancestors 'none'", "Cache-Control": "no-store" });
    response.end(readFileSync(target));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `https://localhost:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => { rmSync(folder, { recursive: true, force: true }); resolve(); }); }),
  };
}
