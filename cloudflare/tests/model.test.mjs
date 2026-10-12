// ABOUTME: Tests room limits, admission, expiry, and safe return paths.
// ABOUTME: Exercises production validation functions without substituting their logic.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  roomInput,
  messageInput,
  admitted,
  returnPath,
  roomId,
} from "../src/model.ts";

test("room lifetime is bounded and defaults to one hour", () => {
  assert.deepEqual(roomInput({ recipient: "alice.delve.town" }), {
    recipient: "alice.delve.town",
    lifetime: 3600,
  });
  for (const lifetime of [900, 3600, 86400])
    assert.equal(
      roomInput({ recipient: "a.town", lifetime }).lifetime,
      lifetime,
    );
  for (const lifetime of [0, 1, -1, 86401, "3600", Infinity])
    assert.throws(() => roomInput({ recipient: "a.town", lifetime }));
  assert.throws(() => roomInput({ recipient: "", lifetime: 3600 }));
  assert.throws(() => roomInput({ recipient: "a.town", owner: "forged" }));
});

test("membership is exact and expiry does not slide with activity", () => {
  const room = {
    owner: "did:plc:owner",
    recipient: "did:plc:recipient",
    expiresAt: 1000,
  };
  assert.equal(admitted(room, room.owner, 999), true);
  assert.equal(admitted(room, room.recipient, 999), true);
  assert.equal(admitted(room, "did:plc:outsider", 999), false);
  assert.equal(admitted(room, room.owner, 1000), false);
  assert.equal(admitted(room, room.recipient, 2000), false);
  assert.equal(admitted(undefined, room.owner, 0), false);
});

test("message validation preserves literal text and rejects spoofing and oversized UTF-8", () => {
  const input = {
    text: "<img src=x onerror=alert(1)>",
    requestId: "abcdefghijklmnop",
  };
  assert.deepEqual(messageInput(input), input);
  assert.throws(() => messageInput({ ...input, sender: "other" }));
  assert.throws(() => messageInput({ ...input, text: "😀".repeat(2049) }));
  assert.throws(() => messageInput({ ...input, text: "" }));
  assert.throws(() => messageInput({ ...input, requestId: "short" }));
});

test("room URLs are bounded locators and callbacks cannot redirect externally", () => {
  const id = "AbCdEf0123456789_-abcd";
  assert.equal(roomId(id), true);
  assert.equal(roomId("../private"), false);
  assert.equal(returnPath(`/r/${id}`), `/r/${id}`);
  for (const path of [
    "//evil.town",
    "https://evil.town",
    "/auth/callback?code=secret",
    "/r/no",
    "/r/" + id + "?secret=x",
  ])
    assert.equal(returnPath(path), "/");
});
