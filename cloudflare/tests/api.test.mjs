// ABOUTME: Tests the public Worker API with real session and room objects.
// ABOUTME: Uses seeded local sessions to test authorization independently of provider login.
import assert from "node:assert/strict";
import { test } from "node:test";
import { digest, randomToken } from "../src/model.ts";
import { runtime } from "./runtime.mjs";

const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const recipient = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";

test("HTTP authorization, strict mutations, sender binding, and logout use real stores", async () => {
  const mf = await runtime({ entry: "src/index.ts" });
  try {
    const { ACCESS, ROOMS } = await mf.getBindings();
    const token = randomToken();
    await ACCESS.getByName("session:" + (await digest(token))).save(
      { kind: "session", did: owner, handle: "owner.delve.town" },
      60000,
    );
    const id = randomToken(16);
    await ROOMS.getByName(id).initialize({
      owner,
      recipient,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    const headers = {
      Cookie: `__Host-kant-session=${token}`,
      Origin: "http://localhost",
      "X-Kant-Request": "1",
      "Content-Type": "application/json",
      "User-Agent": ua,
    };
    const call = (path, init = {}) =>
      mf.dispatchFetch("http://localhost" + path, {
        ...init,
        headers: init.headers ?? headers,
      });
    assert.equal(
      (await call(`/api/rooms/${id}`, { headers: { "User-Agent": ua } }))
        .status,
      401,
    );
    const signedIn = await call("/api/session");
    assert.equal((await signedIn.json()).did, owner);
    assert.equal(signedIn.headers.get("Cache-Control"), "no-store, no-transform");
    assert.match(
      signedIn.headers.get("Content-Security-Policy"),
      /default-src 'self'/,
    );
    assert.equal(
      (
        await call(`/api/rooms/${id}/messages`, {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.town" },
          body: "{}",
        })
      ).status,
      403,
    );
    const body = JSON.stringify({
      text: "real API message",
      requestId: "api_message_00001",
    });
    const sent = await call(`/api/rooms/${id}/messages`, {
      method: "POST",
      body,
    });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).sender, owner);
    const spoofed = JSON.stringify({
      text: "spoof",
      requestId: "api_message_00002",
      sender: recipient,
    });
    assert.equal(
      (
        await call(`/api/rooms/${id}/messages`, {
          method: "POST",
          body: spoofed,
        })
      ).status,
      400,
    );
    assert.equal((await call(`/api/rooms/${id}?after=-1`)).status, 400);
    assert.equal(
      (
        await call(
          "/auth/callback?state=stolen&code=unknown&iss=https://pds.delve.town",
        )
      ).status,
      400,
    );
    assert.equal(
      (await call("/api/logout", { method: "POST", body: "{}" })).status,
      200,
    );
    assert.equal((await call(`/api/rooms/${id}`)).status, 401);
  } finally {
    await mf.dispose();
  }
});
