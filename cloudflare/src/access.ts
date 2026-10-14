// ABOUTME: Honors expiration deadlines for stored login flows and sessions.
// ABOUTME: Exposes only scheduled cleanup, with no credential read or write methods.
import { DurableObject } from "cloudflare:workers";

export class Access extends DurableObject<Env> {
  async alarm() {
    const record = this.ctx.storage.kv.get<{ expiresAt: number }>("record");
    const allowance = this.ctx.storage.kv.get<{ expiresAt: number }>(
      "allowance",
    );
    const expiresAt = record?.expiresAt ?? allowance?.expiresAt ?? 0;
    if (expiresAt > Date.now()) await this.ctx.storage.setAlarm(expiresAt);
    else {
      this.ctx.storage.kv.delete("record");
      await this.ctx.storage.deleteAll();
    }
  }
}
