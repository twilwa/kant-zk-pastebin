// ABOUTME: Stores expiring login flows, local sessions, and request allowances.
// ABOUTME: Atomically consumes browser-bound flows and deletes expired credentials.
import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { SESSION_MS } from "./model";

type RecordValue = {
  value: Record<string, string>;
  binder: string;
  expiresAt: number;
};
type Allowance = { count: number; expiresAt: number };

export class Access extends DurableObject<Env> {
  async save(value: Record<string, string>, ttl: number, binder = "") {
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > SESSION_MS)
      throw new Error("Invalid access lifetime");
    const expiresAt = Date.now() + ttl;
    await this.ctx.storage.setAlarm(expiresAt);
    this.ctx.storage.kv.put("record", { value, binder, expiresAt });
  }

  async read() {
    const record = this.ctx.storage.kv.get<RecordValue>("record");
    if (!record || record.expiresAt <= Date.now()) {
      await this.drop();
      return null;
    }
    return record.value;
  }

  async take(binder: string) {
    const record = this.ctx.storage.kv.get<RecordValue>("record");
    if (!record || record.expiresAt <= Date.now()) {
      await this.drop();
      return null;
    }
    const a = new TextEncoder().encode(record.binder);
    const b = new TextEncoder().encode(binder);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    this.ctx.storage.kv.delete("record");
    await this.drop();
    return record.value;
  }

  async permit(limit: number, windowMs: number) {
    const now = Date.now();
    const stored = this.ctx.storage.kv.get<Allowance>("allowance");
    const allowance =
      stored && now < stored.expiresAt
        ? stored
        : { count: 0, expiresAt: now + windowMs };
    if (allowance.count >= limit) return false;
    this.ctx.storage.kv.put("allowance", {
      ...allowance,
      count: allowance.count + 1,
    });
    await this.ctx.storage.setAlarm(allowance.expiresAt);
    return true;
  }

  async drop() {
    this.ctx.storage.kv.delete("record");
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const record = this.ctx.storage.kv.get<RecordValue>("record");
    const allowance = this.ctx.storage.kv.get<Allowance>("allowance");
    const expiresAt = record?.expiresAt ?? allowance?.expiresAt ?? 0;
    if (expiresAt > Date.now()) await this.ctx.storage.setAlarm(expiresAt);
    else await this.drop();
  }
}
