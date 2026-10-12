// ABOUTME: Exercises the hosted pastebin proxy through real HTTP and Workers runtimes.
// ABOUTME: Checks origin credentials, request limits, redirects, and header isolation.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { runtime } from "./runtime.mjs";

const origin = "https://pastebin.xware.online";
const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";

test("native proxy preserves HTTP behavior while isolating credentials and limits", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      path: request.url,
      method: request.method,
      headers: request.headers,
      body: Buffer.concat(chunks).toString(),
    });
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; sandbox",
    );
    response.setHeader("Cache-Control", "private, no-store");
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/native/browse" });
      response.end();
    } else {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("Origin response");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const mf = await runtime({
    entry: "src/index.ts",
    nativeOrigin: `http://127.0.0.1:${server.address().port}`,
    nativeToken: "test-origin-credential",
  });
  const get = (path, init = {}) =>
    mf.dispatchFetch(origin + path, {
      redirect: "manual",
      ...init,
      headers: { "User-Agent": ua, ...init.headers },
    });
  try {
    const canonical = await get("/native?q=1");
    assert.equal(canonical.status, 308);
    assert.equal(canonical.headers.get("Location"), origin + "/native/?q=1");
    const home = await get("/native/?q=hello%20world", {
      headers: {
        Cookie: "session=private",
        Authorization: "Bearer private",
        "X-Kant-Origin-Token": "attacker-controlled",
        "X-Forwarded-Host": "attacker.invalid",
      },
    });
    assert.equal(home.status, 200);
    assert.equal(await home.text(), "Origin response");
    assert.equal(
      home.headers.get("Content-Security-Policy"),
      "default-src 'none'; sandbox",
    );
    assert.equal(home.headers.get("Cache-Control"), "private, no-store");
    assert.equal(requests[0].path, "/?q=hello%20world");
    assert.equal(
      requests[0].headers["x-kant-origin-token"],
      "test-origin-credential",
    );
    assert.equal(requests[0].headers.cookie, undefined);
    assert.equal(requests[0].headers.authorization, undefined);
    assert.notEqual(
      requests[0].headers["x-forwarded-host"],
      "attacker.invalid",
    );
    assert.equal(requests[0].headers["user-agent"], ua);
    const redirect = await get("/native/redirect");
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("Location"), "/native/browse");
    assert.equal(requests.length, 2);
    for (let i = 0; i < 10; i++) {
      const post = await get("/native/paste", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.10",
        },
        body: JSON.stringify({ content: "Hosted paste " + i }),
      });
      assert.equal(post.status, 200, "allowed write " + i);
      await post.text();
    }
    assert.equal(requests[2].body, '{"content":"Hosted paste 0"}');
    assert.equal(requests[2].headers["content-type"], "application/json");
    const limited = await get("/native/paste", {
      method: "POST",
      headers: { "CF-Connecting-IP": "192.0.2.10" },
      body: "eleventh request",
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "60");
    await limited.text();
    assert.equal(requests.length, 12);
    const oversized = await get("/native/upload", {
      method: "POST",
      headers: { "CF-Connecting-IP": "192.0.2.11" },
      body: new Uint8Array(16 * 1024 * 1024 + 1),
    });
    assert.equal(oversized.status, 413);
    await oversized.text();
    assert.equal(requests.length, 12);
    let sent = 0;
    const streamed = await get("/native/upload", {
      method: "POST",
      headers: { "CF-Connecting-IP": "192.0.2.12" },
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
          if (++sent === 17) controller.close();
        },
      }),
      duplex: "half",
    });
    assert.equal(streamed.status, 413);
    await streamed.text();
    assert.equal(requests.length, 12);
    assert.equal((await get("/native-looking")).status, 404);
    assert.equal(
      (
        await mf.dispatchFetch("http://localhost/native/", {
          headers: { "User-Agent": ua },
        })
      ).status,
      404,
    );
  } finally {
    await mf.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("native proxy fails closed without its origin credential", async () => {
  const mf = await runtime({ entry: "src/index.ts" });
  try {
    const result = await mf.dispatchFetch(origin + "/native/", {
      headers: { "User-Agent": ua },
    });
    assert.equal(result.status, 503);
  } finally {
    await mf.dispose();
  }
});
