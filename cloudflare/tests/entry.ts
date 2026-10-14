// ABOUTME: Seeds expiring storage to exercise production cleanup handlers.
// ABOUTME: Adds test-only setup methods without replacing alarm behavior.
import { Room as RoomCleanup } from "../src/room";
import { Access as AccessCleanup } from "../src/access";

export class Room extends RoomCleanup {
  async seed(expiresAt: number) {
    this.ctx.storage.kv.put("room", { expiresAt });
    this.ctx.storage.sql.exec("CREATE TABLE messages (text TEXT NOT NULL)");
    this.ctx.storage.sql.exec(
      "INSERT INTO messages VALUES (?)",
      "expiry verification",
    );
    await this.ctx.storage.setAlarm(expiresAt);
  }
}

export class Access extends AccessCleanup {
  async seed(key: string, expiresAt: number) {
    this.ctx.storage.kv.put(key, { expiresAt, value: { kind: "session" } });
    await this.ctx.storage.setAlarm(expiresAt);
  }
}
export default {
  fetch() {
    return new Response("test runtime");
  },
};
