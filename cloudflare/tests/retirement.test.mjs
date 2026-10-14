// ABOUTME: Verifies that room hosts and links cannot expose authentication or messaging.
// ABOUTME: Exercises deployed routing and asset boundaries in a real Workers runtime.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runtime } from "./runtime.mjs";

const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const app = "https://pastebin-app.xware.online";
const pastebin = "https://pastebin.xware.online";

test("every room entrypoint is gone and expires browser credentials", async () => {
  const mf = await runtime({
    entry: "src/index.ts",
    assets: true,
    origin: app,
  });
  try {
    for (const path of [
      "/",
      "/oauth-client-metadata.json",
      "/auth/login?handle=test.delve.town",
      "/auth/callback?code=unused&state=unused",
      "/api/session",
      "/api/logout",
      "/api/resolve?handle=test.delve.town",
      "/api/rooms",
      "/api/rooms/abcdefghijklmnopqrstuv",
      "/api/rooms/abcdefghijklmnopqrstuv/messages",
      "/r/abcdefghijklmnopqrstuv",
      "/health",
      "/app.js",
      "/style.css",
      "/skill.md",
      "/favicon.svg",
      "/index.html",
      "/pastebin/index.html",
      "/native/",
    ]) {
      for (const method of ["GET", "HEAD", "POST", "DELETE", "OPTIONS"]) {
        const response = await mf.dispatchFetch(app + path, {
          method,
          redirect: "manual",
          headers: { "User-Agent": ua },
        });
        assert.equal(response.status, 410, method + " " + path);
        assert.equal(response.headers.get("Location"), null);
        assert.equal(
          response.headers.get("Cache-Control"),
          "no-store, no-transform",
        );
        const cookies = response.headers.getSetCookie();
        for (const name of ["__Host-kant-session", "__Host-kant-flow"])
          assert.ok(
            cookies.some(
              (value) =>
                value.startsWith(name + "=;") &&
                value.includes("Max-Age=0") &&
                value.includes("Secure") &&
                value.includes("HttpOnly"),
            ),
          );
        const body = await response.text();
        if (method === "HEAD") assert.equal(body, "");
        else {
          assert.match(body, /Temporary rooms are retired/);
          assert.match(body, /https:\/\/pastebin.xware.online\//);
          assert.doesNotMatch(body, /<script|<form|pds\.delve\.town/);
        }
      }
    }
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await mf.dispatchFetch(
        pastebin + "/r/abcdefghijklmnopqrstuv",
        {
          method,
          redirect: "manual",
          headers: { "User-Agent": ua },
        },
      );
      assert.equal(response.status, 410);
      assert.equal(response.headers.get("Location"), null);
    }
    assert.equal(
      (await mf.dispatchFetch("https://unknown.example/")).status,
      404,
    );
  } finally {
    await mf.dispose();
  }
});
