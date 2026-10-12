// ABOUTME: Checks that native IPFS downloads reconstruct complete original files.
// ABOUTME: Exercises small and multiblock contents through the running HTTP service.
import assert from "node:assert/strict";
import { test } from "node:test";
const origin = process.env.NATIVE_TEST_ORIGIN ?? "http://127.0.0.1:18909";
const ua = "OpenAI File Downloader, XaiImageApiFetch/1.0";
for (const size of [31, 1024 * 1024 + 17]) {
  test(`IPFS returns all ${size} original bytes`, async () => {
    const content = "0123456789abcdef".repeat(Math.ceil(size / 16)).slice(0, size);
    const created = await fetch(origin + "/paste", {
      method: "POST", headers: { "User-Agent": ua, "Content-Type": "application/json" },
      body: JSON.stringify({ title: `IPFS roundtrip ${size}`, content }),
    });
    assert.equal(created.status, 200);
    const paste = await created.json();
    assert.ok(paste.ipfs_cid);
    const download = await fetch(origin + "/ipfs/" + paste.ipfs_cid, { headers: { "User-Agent": ua } });
    assert.equal(download.status, 200);
    const received = await download.text();
    assert.equal(received.length, content.length);
    assert.ok(received === content, "download bytes match original content");
  });
}
