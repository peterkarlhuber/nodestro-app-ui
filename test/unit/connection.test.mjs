import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { CONTRACT } from "../../scripts/files.mjs";

const require = createRequire(import.meta.url);
const { BackendConnection, CONTRACT: CLIENT, STATES, TRANSITIONS, backoff, fieldsFromForm, negotiate } = require("../../src/connection.js");

function answer(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => (body === undefined ? JSON.parse("{") : body) };
}

const DISCOVERY = {
  contract: { name: "nodestro-app", versions: [1], current: 1 },
  backend: { id: "bk_0123456789abcdef01234567", name: "Office", version: "0.2.0", runtime_version: "0.2.0" },
  auth: { methods: ["session"] },
  tls: { enabled: false },
  capabilities: ["runs", "events.sse", "files.upload"],
  apps: [],
};

test("the contract range is the manifest's", () => {
  assert.equal(CLIENT.min, CONTRACT.min);
  assert.equal(CLIENT.max, CONTRACT.max);
});

test("negotiate picks the highest shared version and refuses others", () => {
  assert.equal(negotiate({ name: "nodestro-app", versions: [1], current: 1 }), 1);
  assert.equal(negotiate({ name: "nodestro-app", versions: [1, 2], current: 2 }), 1);
  assert.equal(negotiate({ name: "nodestro-app", versions: [2], current: 2 }), null);
  assert.equal(negotiate({ name: "other", versions: [1] }), null);
  assert.equal(negotiate({ name: "nodestro-app", versions: ["1"] }), null);
  assert.equal(negotiate(null), null);
});

test("every state has transitions, and every target is a state", () => {
  assert.deepEqual([...STATES].sort(), ["auth_required", "connected", "connecting", "degraded", "disconnected", "error", "incompatible"]);
  for (const targets of Object.values(TRANSITIONS)) for (const target of targets) assert.ok(STATES.includes(target), target);
  // An incompatible backend is left only by a new attempt; "connected" is reached only through "connecting".
  assert.deepEqual(TRANSITIONS.incompatible, ["connecting"]);
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    if (from !== "connecting" && from !== "degraded") assert.ok(!targets.includes("connected"), from);
  }
});

test("set follows the transitions and reports every change", () => {
  const seen = [];
  const connection = new BackendConnection({ fetch: async () => answer(200, DISCOVERY), onChange: (state) => seen.push(state) });
  assert.throws(() => connection.set("connected"), /no transition disconnected -> connected/);
  assert.throws(() => connection.set("unknown"), /unknown state/);
  connection.set("connecting");
  connection.set("connected");
  connection.set("disconnected");
  connection.set("connecting");
  connection.set("incompatible");
  assert.throws(() => connection.set("connected"));
  assert.deepEqual(seen, ["connecting", "connected", "disconnected", "connecting", "incompatible"]);
});

test("backoff grows and stays at 30 seconds", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map(backoff), [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000]);
});

test("discover keeps the backend's answer and the negotiated version", async () => {
  const calls = [];
  const connection = new BackendConnection({ base: "", fetch: async (url, init) => { calls.push([url, init.credentials]); return answer(200, DISCOVERY); } });
  const found = await connection.discover();
  assert.equal(found.backend.name, "Office");
  assert.deepEqual(calls, [["/api/app", "same-origin"]]);
  assert.equal(connection.contract, 1);
  assert.equal(connection.legacy, false);
  assert.deepEqual(connection.describe(), { id: DISCOVERY.backend.id, name: "Office", version: "0.2.0", runtimeVersion: "0.2.0", contract: 1, legacy: false, capabilities: DISCOVERY.capabilities });
  assert.ok(connection.can("events.sse"));
  assert.ok(!connection.can("approvals"));
});

test("discover reports each failure by kind", async () => {
  const kind = async (fetcher) => {
    try { await new BackendConnection({ fetch: fetcher }).discover(); return "none"; } catch (problem) { return problem.kind; }
  };
  assert.equal(await kind(async () => { throw new TypeError("offline"); }), "network");
  assert.equal(await kind(async () => answer(401, {})), "auth");
  assert.equal(await kind(async () => answer(500, {})), "server");
  assert.equal(await kind(async () => answer(200)), "server");
  assert.equal(await kind(async () => answer(200, { ...DISCOVERY, contract: { name: "nodestro-app", versions: [2], current: 2 } })), "incompatible");
});

test("an incompatible backend names its versions", async () => {
  const connection = new BackendConnection({ fetch: async () => answer(200, { ...DISCOVERY, contract: { name: "nodestro-app", versions: [2, 3], current: 3 } }) });
  await assert.rejects(connection.discover(), (problem) => problem.kind === "incompatible" && problem.detail.backend.join() === "2,3");
});

test("a backend without the contract is the compatibility mode", async () => {
  const connection = new BackendConnection({ fetch: async () => answer(404, {}) });
  assert.equal(await connection.discover(), null);
  assert.equal(connection.legacy, true);
  assert.equal(connection.describe().contract, null);
  assert.ok(connection.can("events.sse"));
});

test("fieldsFromForm maps form version 1 to the interface's names", () => {
  const fields = fieldsFromForm([
    { name: "topic", type: "text", label: "Topic", help: "What about", required: true, default: "AI", options: [], multiple: false, accept: [], accept_formats: [], max_mb: null, max_files: null },
    { name: "kind", type: "select", label: "Kind", options: ["a", "b"] },
    { name: "docs", type: "file", label: "", required: false, multiple: true, accept: [".pdf"], accept_formats: ["pdf"], max_mb: 20, max_files: 3 },
  ]);
  assert.deepEqual(fields[0], { name: "topic", label: "Topic", type: "text", description: "What about", required: true, default: "AI", options: [], accept: [], multiple: false, max_files: null, max_size_mb: null });
  assert.deepEqual(fields[1].options, ["a", "b"]);
  assert.equal(fields[1].description, "");
  assert.equal(fields[1].accept_extensions, undefined);
  assert.equal(fields[2].label, "docs");
  assert.deepEqual(fields[2].accept_extensions, [".pdf"]);
  assert.deepEqual(fields[2].accept, ["pdf"]);
  assert.equal(fields[2].max_size_mb, 20);
  assert.equal(fields[2].max_files, 3);
  assert.equal(fieldsFromForm(undefined), null);
  assert.deepEqual(fieldsFromForm([]), []);
});
