// ABOUTME: Checks persisted expiration deadlines across Worker code replacement.
// ABOUTME: Uses real SQLite objects and scheduled alarms without mocked storage or time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtime } from "./runtime.mjs";

test("stored rooms and credentials survive deployment and expire on schedule", async () => {
  const persistence = await mkdtemp(join(tmpdir(), "kant-expiry-"));
  let mf = await runtime({ persistence });
  try {
    const { ROOMS, ACCESS } = await mf.getBindings();
    const deadline = Date.now() + 3500;
    await ROOMS.getByName("expires").seed(deadline);
    await ACCESS.getByName("session").seed("record", deadline);
    await ACCESS.getByName("rate").seed("allowance", deadline);
    await mf.dispose();
    mf = await runtime({ persistence, entry: "src/index.ts" });
    const room = await mf.unsafeGetDurableObjectStorage("rooms", "Room", {
      name: "expires",
    });
    const session = await mf.unsafeGetDurableObjectStorage("rooms", "Access", {
      name: "session",
    });
    const rate = await mf.unsafeGetDurableObjectStorage("rooms", "Access", {
      name: "rate",
    });
    assert.deepEqual(await room.exec("SELECT text FROM messages"), [
      { text: "expiry verification" },
    ]);
    for (const storage of [session, rate])
      assert.deepEqual(
        await storage.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='_cf_KV'",
        ),
        [{ name: "_cf_KV" }],
      );
    const { ROOMS: activeRooms, ACCESS: activeAccess } = await mf.getBindings();
    for (const [object, method, args] of [
      [activeRooms.getByName("expires"), "read", ["unused", 0]],
      [
        activeRooms.getByName("expires"),
        "send",
        ["unused", { text: "unwanted" }],
      ],
      [
        activeRooms.getByName("expires"),
        "initialize",
        [{ expiresAt: deadline }],
      ],
      [activeAccess.getByName("session"), "read", []],
      [activeAccess.getByName("session"), "save", [{ kind: "session" }, 60000]],
    ])
      await assert.rejects(
        async () => await object[method](...args),
        /not a function|does not implement|does not exist|not defined/,
      );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, deadline - Date.now() + 600)),
    );
    for (const storage of [room, session, rate])
      assert.deepEqual(
        await storage.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages', '_cf_KV')",
        ),
        [],
      );
  } finally {
    await mf.dispose();
    await rm(persistence, { recursive: true, force: true });
  }
});
