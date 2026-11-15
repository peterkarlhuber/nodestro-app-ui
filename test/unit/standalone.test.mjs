// The interface on its own origin (NAL-C5): addresses, the list of backends, the token session and the event parser.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { STANDALONE_CSP, standaloneIndex } from "../../scripts/build-standalone.mjs";

const require = createRequire(import.meta.url);
const { Backends, EventParser, TokenProblem, TokenSession, normalizeAddress, normalizeFingerprint } = require("../../src/standalone.js");

function memory() {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key), data };
}

test("a backend address is https, or http only on this computer", () => {
  assert.equal(normalizeAddress(" https://Server.example:8800/ "), "https://server.example:8800");
  assert.equal(normalizeAddress("https://server.example/apps/one/"), "https://server.example/apps/one");
  assert.equal(normalizeAddress("http://localhost:8800"), "http://localhost:8800");
  assert.equal(normalizeAddress("http://127.0.0.1:8800"), "http://127.0.0.1:8800");
  for (const bad of ["", "server.example", "http://server.example", "ftp://server.example", "https://user:pw@server.example", "https://server.example/?x=1", "https://server.example/#code=1", "javascript:alert(1)"]) {
    assert.equal(normalizeAddress(bad), null, bad);
  }
});

test("a fingerprint is 64 hex digits, written with or without colons", () => {
  const pairs = "ab:".repeat(31) + "ab";
  assert.equal(normalizeFingerprint(pairs), "AB".repeat(32));
  assert.equal(normalizeFingerprint(""), "");
  assert.equal(normalizeFingerprint("12:34"), null);
  assert.equal(normalizeFingerprint("ZZ".repeat(32)), null);
});

test("the list of backends keeps names, addresses and fingerprints, never anything else", () => {
  const storage = memory();
  const list = new Backends(storage);
  assert.deepEqual(list.list(), []);
  const office = list.add("Office", "https://office.example:8800/", "");
  assert.equal(office.name, "Office");
  const lab = list.add("", "https://lab.example", "AB".repeat(32));
  assert.equal(lab.name, "lab.example");
  assert.equal(list.add("Again", "https://office.example:8800", "").id, office.id);
  assert.equal(list.list().length, 2);
  assert.equal(list.add("Bad", "http://evil.example", ""), null);
  assert.equal(list.add("Bad", "https://ok.example", "12"), null);
  list.choose(lab.id);
  assert.equal(list.current(), lab.id);
  list.update(lab.id, { name: "  Lab  " });
  assert.equal(list.get(lab.id).name, "Lab");
  list.remove(lab.id);
  assert.equal(list.current(), null);
  assert.deepEqual(list.list().map((item) => item.name), ["Again"]);
  // An edited store: malformed entries and extra fields are dropped.
  storage.setItem("nodestro.backends", JSON.stringify([{ id: "x", name: "X", address: "http://evil.example" }, { id: "y", name: "Y", address: "https://y.example", token: "secret" }, null]));
  assert.deepEqual(list.list(), [{ id: "y", name: "Y", address: "https://y.example", fingerprint: "" }]);
  storage.setItem("nodestro.backends", "{broken");
  assert.deepEqual(list.list(), []);
  // Without storage (private mode) nothing fails.
  const none = new Backends(null);
  assert.ok(none.add("A", "https://a.example", ""));
});

function reply(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test("the token session pairs, renews under a lock and revokes; the token stays in memory", async () => {
  const calls = [];
  let issued = 0;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/app/token") && init.method === "POST") return reply(200, { access_token: "nat_" + ++issued, expires_in: 900, device: { id: "dev_1", scopes: ["run"] }, app: { api_base: "/api/published/a" } });
    if (url.endsWith("/api/app/token/refresh")) return issued ? reply(200, { access_token: "nat_" + ++issued, expires_in: 900, device: {}, app: {} }) : reply(401, { error: { code: "pairing.device_revoked" } });
    if (init.method === "DELETE") return reply(200, { removed: true });
    return reply(404, {});
  };
  const locked = [];
  const locks = { request: async (name, work) => { locked.push(name); return work(); } };
  const seen = [];
  const session = new TokenSession({ fetch, base: "https://office.example", locks, onToken: (answer) => seen.push(answer.access_token) });
  await assert.rejects(session.refresh(), (problem) => problem instanceof TokenProblem && problem.status === 401 && problem.code === "pairing.device_revoked");
  await session.grant("K7QD-M2XA", "Laptop");
  assert.deepEqual(session.headers(), { Authorization: "Bearer nat_1" });
  const grant = calls.find((item) => item.url.endsWith("/api/app/token"));
  assert.equal(grant.init.credentials, "include");
  assert.equal(grant.init.headers["X-Nodestro-App"], "1");
  assert.deepEqual(JSON.parse(grant.init.body), { grant_type: "pairing_code", code: "K7QD-M2XA", name: "Laptop" });
  // Two renewals at once are one request.
  await Promise.all([session.refresh(), session.refresh()]);
  assert.equal(calls.filter((item) => item.url.endsWith("/refresh")).length, 2);
  assert.deepEqual(locked, ["nodestro-token:https://office.example", "nodestro-token:https://office.example"]);
  assert.deepEqual(seen, ["nat_1", "nat_2"]);
  await session.revoke();
  const removal = calls.at(-1);
  assert.equal(removal.init.method, "DELETE");
  assert.equal(removal.init.headers.Authorization, "Bearer nat_2");
  assert.deepEqual(session.headers(), {});
  clearTimeout(session.timer);
});

test("the event parser splits a stream into events, across chunks", () => {
  const events = [];
  const parser = new EventParser((type, data, id) => events.push([type, data, id]));
  parser.push("event: status\nid: 1\ndata: {\"a\"");
  parser.push(":1}\n\n: comment\n\nevent: text\ndata: line one\ndata: line two\r\n\r\ndata: plain\n\n");
  assert.deepEqual(events, [["status", "{\"a\":1}", "1"], ["text", "line one\nline two", "1"], ["message", "plain", "1"]]);
  // An event that never ends is dropped instead of filling the memory.
  parser.push("data: " + "x".repeat(3 * 1024 * 1024));
  assert.equal(parser.buffer, "");
});

test("the standalone page switches the mode on and carries a strict policy with Trusted Types", () => {
  const page = standaloneIndex();
  assert.match(page, /<meta name="nodestro-mode" content="standalone">/);
  assert.ok(page.includes(STANDALONE_CSP));
  for (const part of ["default-src 'none'", "script-src 'self'", "require-trusted-types-for 'script'", "trusted-types 'none'", "base-uri 'none'", "object-src 'none'"]) {
    assert.ok(STANDALONE_CSP.includes(part), part);
  }
  assert.ok(!/unsafe-(inline|eval)/.test(STANDALONE_CSP));
});
