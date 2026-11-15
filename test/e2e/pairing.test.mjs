// Browser tests of pairing (NAL-C4, docs/pairing.md in nodestro-api) against the stand-in backend over HTTPS with a
// self-issued certificate: the "restricted trust" notice, a pairing link whose code leaves the address, a fingerprint
// that does not match, renewal from the device cookie, removing the device, a revoked device, and axe.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright";
import { KEY, PAIR_CODE, startMock } from "./mock-backend.mjs";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf-8");
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
let browser;
let mock;
let plain;

before(async () => {
  browser = await chromium.launch(launch);
  mock = await startMock({ tls: true });
  plain = await startMock();
});
after(async () => { await browser?.close(); await mock?.close(); await plain?.close(); });
beforeEach(() => { mock.pairing = true; plain.pairing = false; });

async function open(target, address = "/", options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|EventSource/.test(message.text())) errors.push(message.text()); });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(target.url + address);
  return { context, page, errors };
}

const waitState = (page, state) => page.waitForSelector(`#status[data-state="${state}"]`, { timeout: 10000 });
const bare = (fingerprint) => fingerprint.replace(/:/g, "");

test("a self-issued certificate is marked as restricted trust, with its fingerprint", async () => {
  const { context, page, errors } = await open(mock);
  await waitState(page, "auth_required");
  await page.waitForSelector("#tls-notice:not([hidden])");
  assert.equal(await page.textContent("#tls-fingerprint"), mock.fingerprint);
  assert.ok(await page.isVisible("#pair-form"));
  assert.deepEqual(errors, []);
  await context.close();
});

test("a pairing link fills the code, leaves the address and connects the device", async () => {
  const { context, page, errors } = await open(mock, `/?pair#code=${PAIR_CODE.slice(0, 4)}-${PAIR_CODE.slice(4)}&fp=${bare(mock.fingerprint)}`);
  await waitState(page, "auth_required");
  assert.equal(await page.inputValue("#pair-code"), `${PAIR_CODE.slice(0, 4)}-${PAIR_CODE.slice(4)}`);
  // The code never stays in the address bar or the history.
  assert.ok(!page.url().includes(PAIR_CODE.slice(0, 4)));
  await page.fill("#pair-name", "Laptop");
  await page.click("#pair-form button[type=submit]");
  await waitState(page, "connected");
  assert.equal(await page.textContent("#status-text"), "Connected to Office server (device \"Laptop\")");
  assert.ok(await page.isVisible("#remove-device"));
  assert.ok(!(await page.isVisible("#sign-out")));
  // The device cookie stays on its narrow path, HttpOnly and Secure.
  const cookie = (await context.cookies()).find((item) => item.name === "nodestro_device");
  assert.ok(cookie && cookie.httpOnly && cookie.secure && cookie.path === "/ui/api/device" && cookie.sameSite === "Strict");

  // A new session comes from the device cookie when the old one is gone (a restart of the backend).
  await context.clearCookies({ name: "nodestro_ui" });
  await page.reload();
  await waitState(page, "connected");
  assert.ok(mock.requests.includes("POST /ui/api/device/session"));

  // Removing the device ends its access; the next visit asks for a code again.
  await page.click("#remove-device");
  await waitState(page, "auth_required");
  await page.reload();
  await waitState(page, "auth_required");
  assert.ok(await page.isVisible("#pair-form"));
  assert.deepEqual(errors, []);
  await context.close();
});

test("a fingerprint in the link that does not match blocks pairing", async () => {
  const { context, page } = await open(mock, `/?pair#code=${PAIR_CODE}&fp=${"00".repeat(32)}`);
  await waitState(page, "auth_required");
  await page.waitForSelector("#pair-error:not([hidden])");
  assert.match(await page.textContent("#pair-error"), /does not match/);
  assert.ok(await page.isDisabled("#pair-form button[type=submit]"));
  const before = mock.requests.filter((item) => item === "POST /ui/api/pair").length;
  await page.evaluate(() => document.getElementById("pair-form").requestSubmit());
  assert.equal(mock.requests.filter((item) => item === "POST /ui/api/pair").length, before);
  await context.close();
});

test("two tabs renewing at once keep the device", async () => {
  const { context, page } = await open(mock);
  await waitState(page, "auth_required");
  await page.fill("#pair-code", PAIR_CODE);
  await page.click("#pair-form button[type=submit]");
  await waitState(page, "connected");
  const revoked = mock.revoked();
  await context.clearCookies({ name: "nodestro_ui" });
  const other = await context.newPage();
  await Promise.all([page.reload(), other.goto(mock.url + "/")]);
  await Promise.all([waitState(page, "connected"), waitState(other, "connected")]);
  assert.equal(mock.revoked(), revoked);
  await context.close();
});

test("a link with a fingerprint is refused by a backend that reports none", async () => {
  plain.pairing = true;
  const { context, page } = await open(plain, `/?pair#code=${PAIR_CODE}&fp=${"AB".repeat(32)}`);
  await waitState(page, "auth_required");
  await page.waitForSelector("#pair-error:not([hidden])");
  assert.ok(await page.isDisabled("#pair-form button[type=submit]"));
  assert.ok(!page.url().includes(PAIR_CODE));
  await context.close();
});

test("a wrong code is refused, and a revoked device must pair again", async () => {
  const { context, page } = await open(mock);
  await waitState(page, "auth_required");
  await page.fill("#pair-code", "AAAA-AAAA");
  await page.click("#pair-form button[type=submit]");
  await page.waitForSelector("#pair-error:not([hidden])");
  await page.fill("#pair-code", PAIR_CODE.toLowerCase());
  await page.click("#pair-form button[type=submit]");
  await waitState(page, "connected");
  mock.revokeAll();
  await page.reload();
  await waitState(page, "auth_required");
  assert.ok(await page.isVisible("#pair-form"));
  await context.close();
});

test("without pairing the sign-in has only the key, and plain HTTP shows no trust notice", async () => {
  const { context, page, errors } = await open(plain);
  await waitState(page, "auth_required");
  assert.ok(!(await page.isVisible("#pair-form")));
  assert.ok(!(await page.isVisible("#tls-notice")));
  await page.fill("#signin-key", KEY);
  await page.click("#signin-form button[type=submit]");
  await waitState(page, "connected");
  assert.ok(await page.isVisible("#sign-out"));
  assert.ok(!(await page.isVisible("#remove-device")));
  assert.deepEqual(errors, []);
  await context.close();
});

for (const scheme of ["light", "dark"]) {
  test(`axe finds nothing serious on the pairing sign-in (${scheme})`, async () => {
    const { context, page } = await open(mock, `/?pair#code=${PAIR_CODE}&fp=${"00".repeat(32)}`, { bypassCSP: true, colorScheme: scheme });
    await page.waitForSelector("#pair-error:not([hidden])");
    await page.waitForSelector("#tls-notice:not([hidden])");
    await page.addScriptTag({ content: AXE });
    const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
    const serious = result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
    assert.deepEqual(serious.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`), []);
    await context.close();
  });
}
