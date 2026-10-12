// ABOUTME: Verifies room persistence, authorization, and deletion using real Workers objects.
// ABOUTME: Tests transient credentials and replay limits without mocking storage or time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtime } from "./runtime.mjs";
import { digest, randomToken } from "../src/model.ts";

const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const recipient = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const outsider = "did:plc:cccccccccccccccccccccccc";
const info = (ms = 60000) => ({
  owner,
  recipient,
  createdAt: Date.now(),
  expiresAt: Date.now() + ms,
});
const message = {
  text: "literal <script>alert(1)</script>",
  requestId: "test_request_0001",
};

test("rooms persist, bind senders, reject outsiders, and deduplicate concurrent retries", async () => {
  const persistence = await mkdtemp(join(tmpdir(), "kant-rooms-"));
  let mf = await runtime({ persistence });
  try {
    let bindings = await mf.getBindings();
    let room = bindings.ROOMS.getByName("persistence");
    assert.equal((await room.initialize(info())).ok, true);
    assert.equal((await room.read(outsider, 0)).status, 404);
    assert.equal((await room.send(outsider, message)).status, 404);
    const results = await Promise.all([
      room.send(owner, message),
      room.send(owner, message),
    ]);
    assert.equal(results[0].value.sequence, results[1].value.sequence);
    assert.equal(results[0].value.text, results[1].value.text);
    assert.equal(results[0].value.sender, owner);
    assert.equal(
      (await room.send(owner, { ...message, text: "changed" })).status,
      409,
    );
    assert.equal((await room.read(recipient, 0)).value.messages.length, 1);
    await mf.dispose();
    mf = await runtime({ persistence });
    bindings = await mf.getBindings();
    room = bindings.ROOMS.getByName("persistence");
    assert.equal(
      (await room.read(recipient, 0)).value.messages[0].text,
      message.text,
    );
    assert.equal((await room.close(recipient)).status, 403);
    assert.equal((await room.close(owner)).ok, true);
    const storage = await mf.unsafeGetDurableObjectStorage("rooms", "Room", {
      name: "persistence",
    });
    assert.deepEqual(
      await storage.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages', '__cf_kv')",
      ),
      [],
    );
    assert.equal((await room.read(owner, 0)).status, 404);
    assert.equal((await room.send(owner, message)).status, 404);
  } finally {
    await mf.dispose();
    await rm(persistence, { recursive: true, force: true });
  }
});

test("expired rooms deny access and delete messages without an activity extension", async () => {
  const mf = await runtime();
  try {
    const { ROOMS } = await mf.getBindings();
    const room = ROOMS.getByName("expires");
    const metadata = info(400);
    await room.initialize(metadata);
    await room.send(owner, message);
    const storage = await mf.unsafeGetDurableObjectStorage("rooms", "Room", {
      name: "expires",
    });
    assert.deepEqual(
      await storage.exec("SELECT count(*) AS count FROM messages"),
      [{ count: 1 }],
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.deepEqual(
      await storage.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages', '__cf_kv')",
      ),
      [],
    );
    assert.equal((await room.read(owner, 0)).status, 404);
    assert.equal((await room.send(recipient, message)).status, 404);
    assert.equal((await room.read(recipient, 0)).status, 404);
  } finally {
    await mf.dispose();
  }
});

test("room message rate and capacity validation return explicit errors", async () => {
  const mf = await runtime();
  try {
    const { ROOMS } = await mf.getBindings();
    const room = ROOMS.getByName("limits");
    await room.initialize(info());
    assert.equal(
      (await room.send(owner, { ...message, sender: outsider })).status,
      400,
    );
    assert.equal(
      (await room.send(owner, { ...message, text: "x".repeat(8193) })).status,
      413,
    );
    for (let n = 0; n < 30; n++)
      assert.equal(
        (
          await room.send(owner, {
            text: "hello",
            requestId: `request_${String(n).padStart(12, "0")}`,
          })
        ).ok,
        true,
      );
    assert.equal(
      (await room.send(owner, { ...message, requestId: "request_over_limit" }))
        .status,
      429,
    );
    assert.equal((await room.send(recipient, message)).ok, true);
  } finally {
    await mf.dispose();
  }
});

test("flow claims are browser-bound, single-use, expiring, and session deletion is immediate", async () => {
  const mf = await runtime();
  try {
    const { ACCESS } = await mf.getBindings();
    const flow = ACCESS.getByName("flow");
    await flow.save(
      { kind: "flow", verifier: "test-only" },
      60000,
      "browser-digest",
    );
    assert.equal(await flow.take("wrong-browser"), null);
    const claims = await Promise.all([
      flow.take("browser-digest"),
      flow.take("browser-digest"),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await flow.read(), null);
    await flow.save({ kind: "session", did: owner }, 50);
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(await flow.read(), null);
    await flow.save({ kind: "session", did: owner }, 60000);
    await flow.drop();
    assert.equal(await flow.read(), null);
    const limit = ACCESS.getByName("limit");
    assert.deepEqual(
      await Promise.all([
        limit.permit(2, 60000),
        limit.permit(2, 60000),
        limit.permit(2, 60000),
      ]),
      [true, true, false],
    );
  } finally {
    await mf.dispose();
  }
});

test("a full room remains readable in bounded pages and rejects additional messages", async () => {
  const mf = await runtime({ entry: "src/index.ts" });
  try {
    const { ROOMS, ACCESS } = await mf.getBindings();
    const id = randomToken(16);
    const token = randomToken();
    await ACCESS.getByName("session:" + (await digest(token))).save(
      { kind: "session", did: owner, handle: "owner.delve.town" },
      60000,
    );
    const room = ROOMS.getByName(id);
    await room.initialize(info());
    const storage = await mf.unsafeGetDurableObjectStorage("rooms", "Room", {
      name: id,
    });
    await storage.exec(
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO messages(sender,text,sentAt,requestId) SELECT ?, 'stored text', ?, 'capacity_' || x FROM n",
      owner,
      Date.now() - 120000,
    );
    const call = (path, method = "GET", value) =>
      mf.dispatchFetch("http://localhost/api/rooms/" + id + path, {
        method,
        headers: {
          Cookie: "__Host-kant-session=" + token,
          Origin: "http://localhost",
          "Content-Type": "application/json",
          "X-Kant-Request": "1",
        },
        ...(value ? { body: JSON.stringify(value) } : {}),
      });
    const first = await (await call("?after=0")).json();
    assert.equal(first.messages.length, 100);
    assert.equal(first.cursor, 100);
    const last = await (await call("?after=900")).json();
    assert.equal(last.messages.length, 100);
    assert.equal(last.cursor, 1000);
    assert.equal((await (await call("?after=1000")).json()).messages.length, 0);
    assert.equal((await call("/messages", "POST", message)).status, 409);
    assert.equal((await call("", "DELETE", {})).status, 200);
  } finally {
    await mf.dispose();
  }
});
