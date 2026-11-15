// Browser tests of the interface on its own origin (NAL-C5, docs/cross-origin.md in nodestro-api): the standalone
// build on a static host of its own (https://localhost), two stand-in backends on another site (https://127.0.0.1)
// with the token profile and CORS. The list of backends, pairing by code and by link, renewal after a reload and after
// a restart of the backend, a run with events read through fetch, removing the device, a backend that does not allow
// this origin, a fingerprint that changed, switching backends, no secret in storage, and axe.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright";
import { PAIR_CODE, startMock, startStatic } from "./mock-backend.mjs";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf-8");
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
let browser;
let site;
let office;
let lab;

before(async () => {
  browser = await chromium.launch(launch);
  site = await startStatic();
  office = await startMock({ tls: true });
  lab = await startMock({ tls: true });
});
after(async () => { await browser?.close(); await site?.close(); await office?.close(); await lab?.close(); });
beforeEach(() => {
  for (const backend of [office, lab]) {
    backend.crossOrigin = true;
    backend.allowedOrigins = [site.url];
    backend.pairing = true;
    backend.runs = 0;
    backend.mode = "contract";
  }
});

async function open(address = "/", options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // A refused backend shows as a failed request; everything else (CSP or Trusted Types violations) is an error.
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|CORS policy|ERR_FAILED/.test(message.text())) errors.push(message.text()); });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(site.url + address);
  return { context, page, errors };
}

const waitState = (page, state) => page.waitForSelector(`#status[data-state="${state}"]`, { timeout: 10000 });

async function addBackend(page, backend, name = "") {
  await page.waitForSelector("#view-backends:not([hidden])");
  await page.fill("#backend-address", backend.url);
  if (name) await page.fill("#backend-name", name);
  await page.click("#backend-form button[type=submit]");
}

async function pairWithCode(page) {
  await waitState(page, "auth_required");
  assert.ok(await page.isHidden("#signin-form"));
  await page.fill("#pair-code", PAIR_CODE);
  await page.fill("#pair-name", "Laptop");
  await page.click("#pair-form button[type=submit]");
  await waitState(page, "connected");
}

/** Everything the page keeps in storage, as one text (no token or secret may be in it). */
const stored = (page) => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));

test("a first visit adds a backend, pairs, renews after a reload and keeps no secret in storage", async () => {
  const { context, page, errors } = await open();
  await page.waitForSelector("#backend-none:not([hidden])");
  assert.ok(await page.isVisible("#nav-backends"));
  await addBackend(page, office, "Office");
  // The self-issued certificate is marked as restricted trust here as well.
  await page.waitForSelector("#tls-notice:not([hidden])");
  assert.equal(await page.textContent("#tls-fingerprint"), office.fingerprint);
  await pairWithCode(page);
  assert.equal(await page.textContent("#status-text"), "Connected to Office server (device \"Laptop\")");
  assert.ok(await page.isVisible("#field-tone"));
  assert.ok(await page.isVisible("#remove-device") && !(await page.isVisible("#sign-out")) && !(await page.isVisible("#nav-setup")));
  const kept = await stored(page);
  assert.ok(!kept.includes("nat_") && !kept.includes("secret") && kept.includes(office.url));
  // The fingerprint of the first pairing is kept (trust on first use) and compared from then on.
  assert.ok(kept.includes(office.fingerprint.replace(/:/g, "")));
  // The refresh cookie belongs to the backend, HttpOnly, Secure, SameSite=None and on its narrow path.
  // Partitioned (CHIPS): the cookie lives in this interface's partition only.
  const cookie = (await context.cookies()).find((item) => item.name.startsWith("nodestro_refresh_"));
  assert.ok(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === "None" && cookie.path === "/api/app/token");
  assert.equal(cookie.domain, "127.0.0.1");
  assert.equal(cookie.partitionKey, "https://localhost"); // the interface's site
  await page.reload();
  await waitState(page, "connected");
  assert.ok(office.requests.includes("POST /api/app/token/refresh"));
  assert.equal(office.devices().filter((device) => device.revoked).length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test("a run follows its events through fetch, also after the backend restarted", async () => {
  const { context, page, errors } = await open();
  await addBackend(page, office);
  await pairWithCode(page);
  // A restart drops every access token: the next request renews it from the refresh cookie and goes on.
  office.dropTokens();
  await page.fill("#field-topic", "Quarterly numbers");
  await page.click("#start");
  await page.waitForSelector("#run-body:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#status").dataset.state === "connected");
  await new Promise((resolve) => setTimeout(resolve, 300));
  office.finish();
  await page.waitForSelector("#output strong");
  assert.equal(await page.textContent("#output strong"), "bold");
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.ok(office.requests.includes("GET /api/published/report/runs/run_1/events"));
  assert.deepEqual(errors, []);
  await context.close();
});

test("removing the device ends its access; the next visit pairs again", async () => {
  const { context, page } = await open();
  await addBackend(page, office);
  await pairWithCode(page);
  const before = office.devices().filter((device) => device.revoked).length;
  await page.click("#remove-device");
  await waitState(page, "auth_required");
  assert.equal(office.devices().filter((device) => device.revoked).length, before + 1);
  await page.reload();
  await waitState(page, "auth_required");
  assert.ok(await page.isVisible("#pair-form"));
  await context.close();
});

test("a pairing link names the backend, fills the code and leaves the address", async () => {
  const link = `/?pair#backend=${encodeURIComponent(lab.url)}&code=${PAIR_CODE.slice(0, 4)}-${PAIR_CODE.slice(4)}&fp=${lab.fingerprint.replace(/:/g, "")}`;
  const { context, page, errors } = await open(link);
  // A backend that is not in the list yet is never added by the link alone: the person confirms its address.
  await page.waitForSelector("#backend-link:not([hidden])");
  assert.ok((await page.textContent("#backend-link")).includes(lab.url));
  assert.equal(await page.inputValue("#backend-address"), lab.url);
  assert.equal(await page.evaluate(() => localStorage.getItem("nodestro.backends")), null);
  await page.click("#backend-form button[type=submit]");
  await waitState(page, "auth_required");
  assert.equal(await page.inputValue("#pair-code"), `${PAIR_CODE.slice(0, 4)}-${PAIR_CODE.slice(4)}`);
  assert.ok(!page.url().includes(PAIR_CODE.slice(0, 4)) && !page.url().includes("backend="));
  await page.click("#pair-form button[type=submit]");
  await waitState(page, "connected");
  // The backend's own name replaces the host name in the list.
  await page.click("#nav-backends");
  assert.ok((await page.textContent("#backend-list")).includes("Office server"));
  assert.deepEqual(errors, []);
  await context.close();
});

test("a fingerprint that changed blocks pairing", async () => {
  const { context, page } = await open();
  await page.waitForSelector("#view-backends:not([hidden])");
  await page.fill("#backend-address", office.url);
  await page.fill("#backend-fingerprint", "00".repeat(32));
  await page.click("#backend-form button[type=submit]");
  await waitState(page, "auth_required");
  await page.waitForSelector("#pair-error:not([hidden])");
  assert.ok(await page.isDisabled("#pair-form button[type=submit]"));
  await context.close();
});

test("a backend that does not allow this origin is explained, and nothing is sent to it", async () => {
  office.allowedOrigins = [];
  const before = office.requests.length;
  const { context, page } = await open();
  await addBackend(page, office);
  await page.waitForSelector("#backend-error:not([hidden])");
  assert.match(await page.textContent("#backend-error"), /cannot be reached from this interface/);
  assert.ok(await page.isVisible("#backend-open"));
  assert.equal(await page.getAttribute("#backend-open", "href"), office.url + "/api/app");
  // The preflight and the discovery were refused; no token request followed.
  assert.ok(!office.requests.slice(before).some((item) => item.includes("/api/app/token")));
  await context.close();
});

test("a second backend: switch between them, each with its own device", async () => {
  const { context, page, errors } = await open();
  await addBackend(page, office, "Office");
  await pairWithCode(page);
  await page.click("#nav-backends");
  await addBackend(page, lab, "Lab");
  await pairWithCode(page);
  await page.click("#nav-backends");
  const rows = page.locator("#backend-list li");
  assert.equal(await rows.count(), 2);
  await rows.nth(0).locator("button.primary").click();
  await waitState(page, "connected");
  assert.equal(await page.textContent("#app-name"), "Report writer");
  // Removing the current backend removes its device there as well.
  await page.click("#nav-backends");
  const revoked = office.devices().filter((device) => device.revoked).length;
  await page.locator("#backend-list li").nth(0).getByText("Remove").click();
  await page.waitForFunction(() => document.querySelectorAll("#backend-list li").length === 1);
  assert.equal(office.devices().filter((device) => device.revoked).length, revoked + 1);
  // A backend that is not the current one: its device is removed through its refresh cookie.
  const labRevoked = lab.devices().filter((device) => device.revoked).length;
  await page.locator("#backend-list li").nth(0).getByText("Remove").click();
  await page.waitForFunction(() => document.querySelectorAll("#backend-list li").length === 0);
  assert.equal(lab.devices().filter((device) => device.revoked).length, labRevoked + 1);
  assert.deepEqual(errors, []);
  await context.close();
});

for (const scheme of ["light", "dark"]) {
  test(`axe finds nothing serious in the list of backends and the sign-in (${scheme})`, async () => {
    const { context, page } = await open("/", { bypassCSP: true, colorScheme: scheme });
    await page.waitForSelector("#view-backends:not([hidden])");
    await page.addScriptTag({ content: AXE });
    const check = async () => {
      const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
      return result.violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`);
    };
    assert.deepEqual(await check(), []);
    await addBackend(page, office);
    await waitState(page, "auth_required");
    assert.deepEqual(await check(), []);
    await context.close();
  });
}
