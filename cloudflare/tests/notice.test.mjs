// ABOUTME: Checks the retirement response independently of Worker routing.
// ABOUTME: Verifies credential expiry, safe navigation, and empty HEAD responses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { retired } from "../src/retirement.ts";

test("retirement notice contains only general pastebin links and clears both cookies", async () => {
  const response = retired(
    new Request("https://pastebin-app.xware.online/auth/callback?code=private"),
  );
  assert.equal(response.status, 410);
  assert.equal(
    response.headers.get("Content-Security-Policy"),
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const body = await response.text();
  assert.doesNotMatch(body, /private|<script|<form/);
  assert.match(body, /href="https:\/\/pastebin.xware.online\/"/);
  assert.match(body, /href="https:\/\/pastebin.xware.online\/native\/"/);
  const head = retired(
    new Request("https://pastebin-app.xware.online/", { method: "HEAD" }),
  );
  assert.equal(head.status, 410);
  assert.equal(await head.text(), "");
});
