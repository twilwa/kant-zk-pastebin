// ABOUTME: Coordinates a temporary conversation between two authenticated accounts.
// ABOUTME: Persists bounded messages and enforces membership, deadlines, and closure.
import { DurableObject } from "cloudflare:workers";
import {
  admitted,
  InputError,
  MAX_MESSAGES,
  messageInput,
  missing,
  SESSION_MS,
  type Message,
  type Result,
  type RoomInfo,
} from "./model";

export class Room extends DurableObject<Env> {
  async initialize(info: RoomInfo): Promise<Result<RoomInfo>> {
    if (this.ctx.storage.kv.get("room"))
      return { ok: false, status: 409, error: "Room already exists" };
    if (
      info.owner === info.recipient ||
      !/^did:plc:[a-z2-7]{24}$/.test(info.owner) ||
      !/^did:plc:[a-z2-7]{24}$/.test(info.recipient) ||
      !Number.isFinite(info.expiresAt) ||
      info.expiresAt <= Date.now() ||
      info.expiresAt > Date.now() + SESSION_MS
    ) {
      return {
        ok: false,
        status: 400,
        error: "Invalid room membership or lifetime",
      };
    }
    await this.ctx.storage.setAlarm(info.expiresAt);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, text TEXT NOT NULL, sentAt INTEGER NOT NULL, requestId TEXT NOT NULL, UNIQUE(sender, requestId))",
    );
    this.ctx.storage.kv.put("room", info);
    return { ok: true, value: info };
  }

  private async active(actor: string) {
    const info = this.ctx.storage.kv.get<RoomInfo>("room");
    if (info && info.expiresAt <= Date.now()) {
      await this.erase();
      return undefined;
    }
    return admitted(info, actor) ? info : undefined;
  }

  async read(
    actor: string,
    after: number,
  ): Promise<Result<{ room: RoomInfo; messages: Message[]; cursor: number }>> {
    const info = await this.active(actor);
    if (!info) return missing();
    if (!Number.isSafeInteger(after) || after < 0 || after > MAX_MESSAGES)
      return { ok: false, status: 400, error: "Invalid message cursor" };
    const messages = this.ctx.storage.sql
      .exec<Message>(
        "SELECT * FROM messages WHERE sequence > ? ORDER BY sequence LIMIT 100",
        after,
      )
      .toArray();
    return {
      ok: true,
      value: {
        room: info,
        messages,
        cursor: messages.at(-1)?.sequence ?? after,
      },
    };
  }

  async send(actor: string, value: unknown): Promise<Result<Message>> {
    if (!(await this.active(actor))) return missing();
    let input;
    try {
      input = messageInput(value);
    } catch (error) {
      if (error instanceof InputError)
        return { ok: false, status: error.status, error: error.message };
      throw error;
    }
    const existing = this.ctx.storage.sql
      .exec<Message>(
        "SELECT * FROM messages WHERE sender = ? AND requestId = ?",
        actor,
        input.requestId,
      )
      .toArray()[0];
    if (existing)
      return existing.text === input.text
        ? { ok: true, value: existing }
        : {
            ok: false,
            status: 409,
            error: "Request identifier was already used for different text",
          };
    const count = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT count(*) AS count FROM messages")
      .one().count;
    if (count >= MAX_MESSAGES)
      return {
        ok: false,
        status: 409,
        error: "Room is full; create another temporary room",
      };
    const now = Date.now();
    const recent = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT count(*) AS count FROM messages WHERE sender = ? AND sentAt > ?",
        actor,
        now - 60000,
      )
      .one().count;
    if (recent >= 30)
      return {
        ok: false,
        status: 429,
        error: "Message limit reached; retry in a minute",
      };
    const message = this.ctx.storage.sql
      .exec<Message>(
        "INSERT INTO messages (sender, text, sentAt, requestId) VALUES (?, ?, ?, ?) RETURNING *",
        actor,
        input.text,
        now,
        input.requestId,
      )
      .one();
    return { ok: true, value: message };
  }

  async close(actor: string): Promise<Result<null>> {
    const info = await this.active(actor);
    if (!info) return missing();
    if (info.owner !== actor)
      return {
        ok: false,
        status: 403,
        error: "Only the owner can close this room",
      };
    await this.erase();
    return { ok: true, value: null };
  }

  private async erase() {
    this.ctx.storage.kv.delete("room");
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const info = this.ctx.storage.kv.get<RoomInfo>("room");
    if (info && info.expiresAt > Date.now())
      await this.ctx.storage.setAlarm(info.expiresAt);
    else await this.erase();
  }
}
