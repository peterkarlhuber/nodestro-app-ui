// Browser tests of the interface against the stand-in backend (test/e2e/mock-backend.mjs): sign-in, the form of the
// app contract, a run with a lost and regained connection, results as text, "About this app", an incompatible and a
// contract-less backend, six languages, dark mode and phone width, and axe without serious findings.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright";
import { KEY, LANGUAGES, startMock } from "./mock-backend.mjs";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf-8");
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
let browser;
let mock;

before(async () => { browser = await chromium.launch(launch); mock = await startMock(); });
after(async () => { await browser?.close(); await mock?.close(); });
beforeEach(() => { mock.mode = "contract"; mock.runs = 0; mock.finishAtOnce = false; });

async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|EventSource/.test(message.text())) errors.push(message.text()); });
  await page.goto(mock.url + "/");
  return { context, page, errors };
}

async function signIn(page) {
  await page.waitForSelector("#signin-key", { state: "visible" });
  await page.fill("#signin-key", KEY);
  await page.click("#signin-form button[type=submit]");
  await page.waitForSelector("#view-run:not([hidden])");
}

const statusOf = (page) => page.locator("#status").getAttribute("data-state");
const waitState = (page, state, timeout = 10000) => page.waitForSelector(`#status[data-state="${state}"]`, { timeout });

test("sign-in, the contract's form and the status line", async () => {
  const { context, page, errors } = await open();
  await waitState(page, "auth_required");
  assert.equal(await page.textContent("#status-text"), "Sign-in needed");
  await page.fill("#signin-key", "ndk_wrong");
  await page.click("#signin-form button[type=submit]");
  await page.waitForSelector("#signin-error:not([hidden])");
  await signIn(page);
  await waitState(page, "connected");
  assert.equal(await page.textContent("#status-text"), "Connected to Office server");
  // The form comes from GET /api/published/{slug} (form_version 1), not from /ui/api/config.
  assert.ok(await page.isVisible("#field-tone"));
  // File extensions keep exactly one dot (the contract sends ".pdf").
  assert.equal(await page.getAttribute("#field-docs", "accept"), ".pdf,.docx");
  assert.equal(await page.getAttribute("#fields label.drop", "title"), ".pdf .docx");
  assert.ok(!(await page.textContent("#fields")).includes("(config)"));
  assert.ok(mock.requests.includes("GET /api/app") && mock.requests.includes("GET /api/published/report"));
  assert.deepEqual(errors, []);
  await context.close();
});

test("about this app names the interface, the contract and the backend", async () => {
  const { context, page } = await open();
  await signIn(page);
  await waitState(page, "connected");
  await page.click("#status");
  await page.waitForSelector("#about-dialog[open]");
  const text = await page.textContent("#about-list");
  for (const part of ["0.1.0", "v1", "Office server", "bk_0123456789abcdef01234567", "0.2.0", "0.2.1", "v3", "Connected to Office server"]) {
    assert.ok(text.includes(part), part);
  }
  assert.equal(await page.evaluate(() => document.activeElement.id), "about-close");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#about-dialog[open]", { state: "detached" });
  await context.close();
});

test("a run survives a lost connection, and its result is text", async () => {
  const { context, page, errors } = await open();
  await signIn(page);
  await waitState(page, "connected");
  await page.fill("#field-topic", "Quarterly numbers");
  await page.click("#start");
  await page.waitForSelector("#run-body:not([hidden])");
  await context.setOffline(true);
  await waitState(page, "disconnected");
  await page.waitForSelector("#connection-banner:not([hidden])");
  assert.match(await page.textContent("#connection-text"), /^Connection interrupted, the run continues\./);
  await context.setOffline(false);
  await waitState(page, "connected", 40000);
  assert.ok(await page.isHidden("#connection-banner"));
  mock.finish();
  await page.waitForSelector("#output strong");
  assert.equal(await page.textContent("#output strong"), "bold");
  assert.equal(await page.locator("#output script").count(), 0);
  assert.ok((await page.textContent("#output")).includes("<script>window.injected = 1</script>"));
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.deepEqual(errors, []);
  await context.close();
});

test("waits grow while the backend is away, and the retry button reconnects at once", async () => {
  const { context, page } = await open();
  await signIn(page);
  await waitState(page, "connected");
  // The backend stops answering (no offline event): the next request notices it.
  const away = (route) => route.abort("connectionrefused");
  await page.route("**/ui/api/**", away);
  await page.route("**/api/**", away);
  await page.click("#nav-history");
  await waitState(page, "disconnected");
  assert.match(await page.textContent("#connection-text"), /^Connection interrupted\. Next attempt in 1 s\.$/);
  await page.waitForFunction(() => /in 8 s/.test(document.getElementById("connection-text").textContent), null, { timeout: 15000 });
  await page.unroute("**/ui/api/**", away);
  await page.unroute("**/api/**", away);
  await page.click("#connection-retry");
  await waitState(page, "connected", 3000);
  assert.ok(await page.isHidden("#connection-banner"));
  await context.close();
});

test("an incompatible backend gets a clear message and no form", async () => {
  mock.mode = "incompatible";
  const { context, page } = await open();
  await page.waitForSelector("#signin-key", { state: "visible" });
  await page.fill("#signin-key", KEY);
  await page.click("#signin-form button[type=submit]");
  await waitState(page, "incompatible");
  const message = "Backend version not compatible (app v1, backend v2). Update the interface.";
  assert.equal(await page.textContent("#view-loading p"), message);
  assert.equal(await page.textContent("#connection-text"), message);
  assert.ok(await page.isHidden("#view-run"));
  assert.ok(await page.isHidden("#nav-run"));
  assert.ok(await page.isHidden("#connection-retry"));
  await context.close();
});

test("a backend without the contract works in compatibility mode", async () => {
  mock.mode = "legacy";
  const { context, page } = await open();
  await signIn(page);
  await waitState(page, "connected");
  assert.ok((await page.textContent("#fields")).includes("Topic (config)"));
  assert.equal(await page.locator("#field-tone").count(), 0);
  await page.click("#status");
  assert.ok((await page.textContent("#about-list")).includes("none (compatibility mode)"));
  await context.close();
});

test("an app info the key may not read keeps the form of the interface's configuration", async () => {
  mock.mode = "info-forbidden";
  const { context, page } = await open();
  await signIn(page);
  await waitState(page, "connected");
  assert.ok((await page.textContent("#fields")).includes("Topic (config)"));
  await context.close();
});

test("six languages translate the status line and the dialog", async () => {
  const { context, page } = await open();
  await signIn(page);
  await waitState(page, "connected");
  const english = await page.textContent("#status-text");
  for (const language of LANGUAGES) {
    await page.selectOption("#language", language);
    await page.waitForFunction((code) => document.documentElement.lang === code, language);
    const status = await page.textContent("#status-text");
    assert.ok(!/^(conn|about)\./.test(status), `${language}: ${status}`);
    if (language !== "en") assert.notEqual(status, english, language);
    await page.click("#status");
    const about = await page.textContent("#about-dialog");
    assert.ok(!/\b(conn|about)\.[a-z_]+/.test(about), `${language}: ${about}`);
    await page.keyboard.press("Escape");
  }
  await context.close();
});

test("dark mode and phone width: no horizontal scrolling, the white word mark", async () => {
  const { context, page } = await open({ viewport: { width: 360, height: 780 }, colorScheme: "dark" });
  await signIn(page);
  await waitState(page, "connected");
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(width <= 0, `scrolls by ${width}px`);
  assert.ok(await page.isVisible(".logo-dark"));
  assert.ok(await page.isHidden(".logo-light"));
  assert.ok(await page.isVisible("#status"));
  assert.ok(await page.getAttribute("#status", "aria-label"));
  await context.close();
});

test("signing out asks for a sign-in again", async () => {
  const { context, page } = await open();
  await signIn(page);
  await waitState(page, "connected");
  await page.click("#sign-out");
  await waitState(page, "auth_required");
  await page.waitForSelector("#view-signin:not([hidden])");
  await context.close();
});

for (const scheme of ["light", "dark"]) {
  test(`axe finds nothing serious (${scheme})`, async () => {
    // The CSP forbids injected scripts, so axe runs in a context that bypasses it (the page itself is unchanged).
    const { context, page } = await open({ bypassCSP: true, colorScheme: scheme });
    const check = async (what) => {
      await page.addScriptTag({ content: AXE });
      const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
      const serious = result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
      assert.deepEqual(serious.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`), [], what);
    };
    await page.waitForSelector("#signin-key", { state: "visible" });
    await check("sign-in");
    await signIn(page);
    await waitState(page, "connected");
    await check("form");
    await page.click("#status");
    await check("about");
    await context.close();
  });
}
