// ABOUTME: Checks live provider discovery and OAuth initiation through the production Worker.
// ABOUTME: Verifies identity-only scope and browser binding without pretending to complete user login.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runtime } from "./runtime.mjs";

test("Delve accepts a real PKCE/DPoP authorization request and browser binding is host-only", async () => {
  const origin = "http://127.0.0.1:8787";
  const mf = await runtime({ entry: "src/index.ts", origin });
  try {
    const metadata = await (
      await mf.dispatchFetch(origin + "/oauth-client-metadata.json")
    ).json();
    assert.equal(metadata.scope, "atproto");
    assert.deepEqual(metadata.grant_types, ["authorization_code"]);
    assert.equal(metadata.token_endpoint_auth_method, "none");
    assert.deepEqual(metadata.redirect_uris, [origin + "/auth/callback"]);
    const response = await mf.dispatchFetch(
      origin + "/auth/login?returnTo=https://evil.example",
      { redirect: "manual" },
    );
    assert.equal(response.status, 302, await response.text());
    const destination = new URL(response.headers.get("Location"));
    assert.equal(destination.origin, "https://pds.delve.town");
    assert.ok(destination.searchParams.get("request_uri"));
    assert.match(
      response.headers.get("Set-Cookie"),
      /^__Host-kant-flow=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/,
    );
    assert.equal(response.headers.get("Cache-Control"), "no-store, no-transform");
    const stolen = await mf.dispatchFetch(
      origin +
        "/auth/callback?state=invalid&code=invalid&iss=https://pds.delve.town",
    );
    assert.equal(stolen.status, 400);
    assert.equal(stolen.headers.has("Set-Cookie"), false);
  } finally {
    await mf.dispose();
  }
});
