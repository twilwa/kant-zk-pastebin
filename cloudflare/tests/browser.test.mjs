// ABOUTME: Exercises the browser room flow against real local Workers and SQLite.
// ABOUTME: Seeds local sessions without substituting provider login or application APIs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { runtime } from "./runtime.mjs";
import { digest, randomToken } from "../src/model.ts";

const origin = "http://127.0.0.1:8797";
const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const recipient = "did:plc:qzqct2rrq4u2gmy5g3mjxske";
const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";

test("browser members create, share, exchange literal text, and close a temporary room", async () => {
  const mf = await runtime({
    entry: "src/index.ts",
    assets: true,
    origin,
    port: 8797,
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const failures = [];
  try {
    await mf.ready;
    const { ACCESS, ROOMS } = await mf.getBindings();
    async function pageFor(did) {
      const context = await browser.newContext({
        userAgent: ua,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      if (did) {
        const token = randomToken();
        await ACCESS.getByName("session:" + (await digest(token))).save(
          {
            kind: "session",
            did,
            handle: did === owner ? "owner.delve.town" : "delve.town",
          },
          60000,
        );
        await context.addCookies([
          {
            name: "__Host-kant-session",
            value: token,
            url: origin.replace("http:", "https:") + "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }
      const page = await context.newPage();
      page.on("pageerror", (error) => failures.push(error.message));
      return page;
    }
    const a = await pageFor(owner);
    await a.goto(origin);
    await a.getByLabel("Recipient handle or DID").fill("delve.town");
    await a
      .getByRole("button", { name: "Check recipient", exact: true })
      .click();
    await expect(a.getByTestId("recipient-did")).toHaveText(recipient, {
      timeout: 20000,
    });
    await a
      .getByRole("button", { name: "Create temporary room", exact: true })
      .click();
    await expect(a).toHaveURL(/\/r\/[A-Za-z0-9_-]{22}$/, { timeout: 20000 });
    const link = a.url();
    await expect(
      a.getByRole("img", { name: "Room link QR code" }),
    ).toBeVisible();
    await a
      .getByRole("button", { name: "Copy room link", exact: true })
      .click();
    assert.equal(await a.evaluate(() => navigator.clipboard.readText()), link);
    const b = await pageFor(recipient);
    await b.goto(link);
    await expect(b.getByLabel("Message", { exact: true })).toBeEnabled();
    const literal =
      '<img src=x onerror="window.compromised=true"> & <script>alert(1)</script>';
    await a.getByLabel("Message", { exact: true }).fill(literal);
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(b.getByText(literal, { exact: true })).toBeVisible({
      timeout: 10000,
    });
    assert.equal(await b.evaluate(() => window.compromised), undefined);
    await b.getByRole("button", { name: "Copy message", exact: true }).click();
    assert.equal(
      await b.evaluate(() => navigator.clipboard.readText()),
      literal,
    );
    await b
      .getByLabel("Message", { exact: true })
      .fill("Received. This is temporary.");
    await b.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      a.getByText("Received. This is temporary.", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const stranger = await pageFor("did:plc:cccccccccccccccccccccccc");
    await stranger.goto(link);
    await expect(
      stranger.getByText("Room unavailable or expired", { exact: true }),
    ).toBeVisible();
    assert.equal(await stranger.locator("#messages article").count(), 0);
    await a
      .getByRole("button", { name: "Close room now", exact: true })
      .click();
    await expect(
      a.getByText("Room closed. Its stored messages have been deleted.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      b.getByText("Room unavailable or expired", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    assert.equal(await b.locator("#messages article").count(), 0);
    assert.deepEqual(
      await b.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0],
    );
    const guest = await pageFor(null);
    await guest.goto(link);
    await expect(
      guest.getByRole("link", { name: "Sign in with Delve" }),
    ).toHaveAttribute("href", /returnTo=%2Fr%2F/);
    const another = await a.evaluate(async (did) => {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kant-Request": "1" },
        body: JSON.stringify({ recipient: did }),
      });
      if (!response.ok) throw new Error("Second room creation failed");
      return response.json();
    }, recipient);
    assert.notEqual(another.url, link);
    await a.goto(another.url);
    await expect(a.getByLabel("Message", { exact: true })).toBeVisible();
    assert.equal(await a.locator("#messages article").count(), 0);
    await a
      .getByRole("button", { name: "Close room now", exact: true })
      .click();
    const expiresId = randomToken(16);
    const expires = ROOMS.getByName(expiresId);
    await expires.initialize({
      owner,
      recipient,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3000,
    });
    await expires.send(owner, {
      text: "This text expires.",
      requestId: "browser_expiry_001",
    });
    await b.goto(origin + "/r/" + expiresId);
    await expect(
      b.getByText("This text expires.", { exact: true }),
    ).toBeVisible();
    await expect(
      b.getByText("Room unavailable or expired", { exact: true }),
    ).toBeVisible({ timeout: 6000 });
    assert.equal(await b.locator("#messages article").count(), 0);
    await b.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      b.getByRole("link", { name: "Sign in with Delve" }),
    ).toBeVisible();
    assert.equal(
      (await b.evaluate(async () => (await fetch("/api/session")).json()))
        .authenticated,
      false,
    );
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
    await mf.dispose();
  }
});
