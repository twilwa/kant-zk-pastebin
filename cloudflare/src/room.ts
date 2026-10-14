// ABOUTME: Honors expiration deadlines for stored temporary conversations.
// ABOUTME: Exposes only scheduled cleanup, with no conversation read or write methods.
import { DurableObject } from "cloudflare:workers";

export class Room extends DurableObject<Env> {
  async alarm() {
    const info = this.ctx.storage.kv.get<{ expiresAt: number }>("room");
    if (info && info.expiresAt > Date.now())
      await this.ctx.storage.setAlarm(info.expiresAt);
    else {
      this.ctx.storage.kv.delete("room");
      await this.ctx.storage.deleteAll();
    }
  }
}
