// ABOUTME: Checks standalone paste routing and browser workflows on real Workers assets.
// ABOUTME: Verifies host isolation, local storage, share links, QR, and app navigation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { runtime } from "./runtime.mjs";

const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const origin = "https://pastebin.xware.online";

test("source and downloadable CLI print usable help", () => {
  for (const file of [
    "../scripts/kant-cli.mjs",
    "public/pastebin/kant-cli.mjs",
  ]) {
    const help = execFileSync(process.execPath, [file, "--help"], {
      encoding: "utf8",
    });
    assert.match(help, /kant-cli — the kant-zk-pastebin client/);
    assert.match(help, /pastebinit --file/);
  }
});

test("pastebin assets and room routes stay on their intended hosts", async () => {
  const mf = await runtime({ entry: "src/index.ts", assets: true });
  try {
    const get = (path, init = {}) =>
      mf.dispatchFetch(origin + path, {
        headers: { "User-Agent": ua },
        redirect: "manual",
        ...init,
      });
    const home = await get("/");
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Kant Pastebin/);
    assert.equal(home.headers.get("Cache-Control"), "no-store, no-transform");
    for (const path of [
      "/app.js",
      "/style.css",
      "/qrcode.js",
      "/kant-cli.mjs",
      "/kant-cli.sha256",
      "/kant-cli.version",
    ])
      assert.equal((await get(path)).status, 200, path);
    assert.equal((await get("/", { method: "HEAD" })).status, 200);
    assert.equal((await get("/", { method: "POST" })).status, 405);
    for (const path of [
      "/api/session",
      "/auth/login",
      "/pastebin/index.html",
      "/missing",
    ])
      assert.equal((await get(path)).status, 404, path);
    const room = await get("/r/abcdefghijklmnopqrstuv");
    assert.equal(room.status, 302);
    assert.equal(
      room.headers.get("Location"),
      "http://localhost/r/abcdefghijklmnopqrstuv",
    );
    assert.equal((await get("/r/invalid")).status, 404);
    const roomHome = await mf.dispatchFetch("http://localhost/", {
      headers: { "User-Agent": ua },
    });
    assert.equal(roomHome.status, 200);
    assert.doesNotMatch(
      roomHome.headers.get("Content-Security-Policy"),
      /unsafe-inline/,
    );
    assert.equal(
      (await mf.dispatchFetch("http://localhost/pastebin/app.js")).status,
      404,
    );
  } finally {
    await mf.dispose();
  }
});

test("standalone editor shares local text between browsers without uploading it", async () => {
  const local = "http://127.0.0.1:8798";
  const mf = await runtime({
    entry: "src/index.ts",
    assets: true,
    port: 8798,
    pastebinOrigin: local,
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const failures = [];
  const outbound = [];
  try {
    await mf.ready;
    const context = await browser.newContext({
      userAgent: ua,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text());
    });
    page.on("request", (request) => {
      if (request.method() !== "GET") outbound.push(request.url());
    });
    await page.goto(local);
    await expect(page.locator("#pasteList")).toContainText("No pastes yet");
    await expect(page.locator("#serverUrl")).toHaveValue("");
    await expect(
      page.getByRole("link", { name: "Hosted pastebin", exact: true }),
    ).toHaveAttribute("href", "https://pastebin.xware.online/native/");
    await expect(
      page.getByRole("link", { name: "Delve rooms", exact: true }),
    ).toHaveAttribute("href", "https://pastebin-app.xware.online/");
    const title = "Local <note> & café";
    const content = "Text travels in the link, without a server.";
    await page.locator("#title").fill(title);
    await page.locator("#content").fill(content);
    await page.getByRole("button", { name: "📤 Share", exact: true }).click();
    await expect(page.locator("#pasteList strong")).toHaveText(title);
    await page.reload();
    await expect(page.locator("#serverUrl")).toHaveValue("");
    await page
      .getByRole("button", { name: "📋 Copy URL", exact: true })
      .click();
    await expect(page.locator("#result")).toContainText(
      "URL copied to clipboard",
    );
    const link = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(link.startsWith(local + "/#paste="), link);
    const guest = await browser.newContext({ userAgent: ua });
    const recipient = await guest.newPage();
    await recipient.goto(link);
    await expect(recipient.locator("#title")).toHaveValue(title);
    await expect(recipient.locator("#content")).toHaveValue(content);
    await expect(recipient.locator("#pasteList")).toContainText(
      "No pastes yet",
    );
    await page.getByRole("button", { name: "📱 QR Code", exact: true }).click();
    await expect(page.locator("#qrcode")).toHaveAttribute("width", "256");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("#content").fill("a".repeat(5100));
    await page.locator("#chunkSize").selectOption("5000");
    await page.getByRole("button", { name: "✂️ Split", exact: true }).click();
    await expect(page.locator(".chunk")).toHaveCount(2);
    await page.getByRole("button", { name: "📤 Share", exact: true }).click();
    await expect(page.locator("#pasteList .paste-item")).toHaveCount(2);
    await page
      .getByRole("button", { name: "📱 QR Code", exact: true })
      .first()
      .click();
    await expect(page.locator("#result")).toContainText(
      "use Share URL or split the text",
    );
    await expect(page.locator("#qrcode")).toHaveCount(0);
    assert.deepEqual(outbound, []);
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
    await mf.dispose();
  }
});
