// ABOUTME: Verifies the running native service's public request boundary.
// ABOUTME: Checks origin authentication, private routes, and uploaded-content isolation.
import assert from "node:assert/strict";
import { test } from "node:test";

const origin = process.env.NATIVE_BOUNDARY_ORIGIN ?? "http://127.0.0.1:18910";
const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const token = "native-e2e-credential";
const request = (path, headers = {}, options = {}) => fetch(origin + path, {
  ...options, headers: { "User-Agent": ua, ...headers }, redirect: "manual",
});
const authorized = { "X-Kant-Origin-Token": token };

test("origin authentication cannot be replaced by a browser cookie or bearer", async () => {
  for (const headers of [{}, { Authorization: `Bearer ${token}`, Cookie: `token=${token}` },
    { "X-Kant-Origin-Token": "incorrect" }]) {
    const response = await request("/health", headers);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await request("/health", authorized)).status, 200);
});

test("host tools and encoded path bypasses stay private", async () => {
  for (const path of ["/api/diagnostics", "/api/search-doc?path=/etc/passwd", "/mcp",
    "/upgrade", "/plugins", "/plugin/screenshot/test", "/api/git-index",
    "/api/git-search", "/api/git-reindex", "/git-browse", "/git-view/a/b",
    "/api/nix-skill/find", "/svg2anim/test", "/%61pi/diagnostics", "/raw/%252e%252e"]) {
    for (const method of ["GET", "POST"]) {
      const response = await request(path, authorized, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
});

test("uploaded HTML runs in neither the application origin nor a script-enabled sandbox", async () => {
  const created = await request("/paste", { ...authorized, "Content-Type": "application/json" }, {
    method: "POST", body: JSON.stringify({ title: "HTML isolation check", content: "<script>parent.document.body.textContent='unsafe'</script>" }),
  });
  assert.equal(created.status, 200);
  const paste = await created.json();
  const preview = await request("/preview/" + paste.id, authorized);
  assert.equal(preview.status, 200);
  const policy = preview.headers.get("content-security-policy");
  assert.ok(policy.includes("sandbox"));
  assert.ok(!policy.includes("allow-scripts"));
  assert.ok(!policy.includes("allow-same-origin"));
  assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
  assert.equal(preview.headers.get("cache-control"), "no-store");
});
