// ABOUTME: Verifies hosted paste creation and retrieval against a real native server.
// ABOUTME: Runs the browser through the Worker proxy with the production URL prefix.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { runtime } from "./runtime.mjs";

test("hosted paste creation stays under /native and persists through the proxy", async () => {
  const origin = "http://127.0.0.1:8799";
  const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";
  const mf = await runtime({
    entry: "src/index.ts",
    assets: true,
    port: 8799,
    pastebinOrigin: origin,
    nativeOrigin:
      process.env.KANT_NATIVE_TEST_ORIGIN ?? "http://127.0.0.1:18910",
    nativeToken: process.env.KANT_NATIVE_TEST_TOKEN ?? "native-e2e-credential",
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await mf.ready;
    const context = await browser.newContext({ userAgent: ua });
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) =>
      failures.push(page.url() + ": " + error.message),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        failures.push(page.url() + ": " + message.text());
    });
    await page.goto(origin + "/native/");
    await expect(page.locator("#form")).toBeVisible();
    const title = "Hosted browser verification " + Date.now();
    const content =
      title +
      ": A persistent paste saved through the Worker and native backend.";
    await page.locator("#title").fill(title);
    await page.locator("#content").fill(content);
    await page.getByRole("button", { name: "📤 Share", exact: true }).click();
    await expect(page).toHaveURL(/\/native\/paste\/[^/]+$/);
    await expect(page.locator("h1")).toContainText(title);
    await expect(page.locator("body")).toContainText(content);
    const id = new URL(page.url()).pathname.split("/").at(-1);
    const raw = await context.request.get(origin + "/native/raw/" + id);
    assert.equal(raw.status(), 200);
    assert.ok((await raw.text()).includes(content));
    await page.reload();
    await expect(page.locator("h1")).toContainText(title);
    await page.goto(origin + "/native/browse");
    await expect(
      page.getByRole("link", { name: title, exact: true }),
    ).toHaveAttribute("href", "/native/paste/" + id);
    for (const path of ["/threads", "/gallery", "/thread/" + id]) {
      const response = await page.goto(origin + "/native" + path);
      assert.equal(response.status(), 200, path);
      await expect(page.locator("h1")).toBeVisible();
    }
    await page.goto(origin + "/native/paste/" + id + "/split");
    await page.getByRole("button", { name: "✂️ Split", exact: true }).click();
    await expect(page.locator("#status")).toContainText("chunks");
    await page.goto(origin + "/native/splitter");
    await expect(
      page.locator('.profile-card[data-name="custom"]'),
    ).toBeVisible();
    await page.locator('.profile-card[data-name="custom"]').click();
    await page.locator("#textInput").fill("alpha beta gamma delta");
    await page.locator("#chunkSize").fill("8");
    await page.locator("#splitMode").selectOption("exact");
    await page.getByRole("button", { name: "✂️ Split", exact: true }).click();
    await expect(page.locator("#chunks .chunk-label")).toHaveCount(3);
    await page.goto(origin + "/native/search");
    await page.locator("#q").fill(title);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const found = page
      .locator("#results")
      .getByRole("link", { name: title, exact: true });
    await expect(found).toHaveAttribute("href", "/native/paste/" + id);
    await found.click();
    await expect(page).toHaveURL(origin + "/native/paste/" + id);
    await page.goto(origin + "/");
    await expect(page.locator("#serverUrl")).toHaveValue("");
    await expect(
      page.getByRole("link", { name: "Hosted pastebin", exact: true }),
    ).toBeVisible();
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
    await mf.dispose();
  }
});
