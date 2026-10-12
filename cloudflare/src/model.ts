// ABOUTME: Defines room limits and validates public room requests.
// ABOUTME: Keeps admission and expiration decisions independent of transport and storage.
export const MAX_MESSAGE_BYTES = 8192;
export const MAX_MESSAGES = 1000;
export const SESSION_MS = 24 * 60 * 60 * 1000;
export const FLOW_MS = 10 * 60 * 1000;
export const PROVIDER = "https://pds.delve.town";

export type RoomInfo = {
  owner: string;
  recipient: string;
  createdAt: number;
  expiresAt: number;
};
export type Message = {
  sequence: number;
  sender: string;
  text: string;
  sentAt: number;
  requestId: string;
};
export type Result<T> =
  { ok: true; value: T } | { ok: false; status: number; error: string };

export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Expected a JSON object");
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new InputError("Unexpected request field");
  return value as Record<string, unknown>;
}

export function roomInput(value: unknown) {
  const input = object(value, ["recipient", "lifetime"]);
  if (
    typeof input.recipient !== "string" ||
    !input.recipient.trim() ||
    input.recipient.length > 253
  )
    throw new InputError("Enter a Delve handle or DID");
  const lifetime = input.lifetime ?? 3600;
  if (typeof lifetime !== "number" || ![900, 3600, 86400].includes(lifetime))
    throw new InputError("Choose 15 minutes, 1 hour, or 24 hours");
  return { recipient: input.recipient.trim(), lifetime };
}

export function messageInput(value: unknown) {
  const input = object(value, ["text", "requestId"]);
  if (typeof input.text !== "string" || !input.text.trim())
    throw new InputError("Write a message");
  if (new TextEncoder().encode(input.text).length > MAX_MESSAGE_BYTES)
    throw new InputError("Message exceeds 8 KiB", 413);
  if (
    typeof input.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(input.requestId)
  )
    throw new InputError("Invalid request identifier");
  return { text: input.text, requestId: input.requestId };
}

export function admitted(
  room: Pick<RoomInfo, "owner" | "recipient" | "expiresAt"> | undefined,
  actor: string,
  now = Date.now(),
) {
  return (
    !!room &&
    now < room.expiresAt &&
    (actor === room.owner || actor === room.recipient)
  );
}

export const roomId = (value: string) => /^[A-Za-z0-9_-]{22}$/.test(value);
export const returnPath = (value: string | null) =>
  value?.startsWith("/r/") && roomId(value.slice(3)) ? value : "/";
export const missing = (): Result<never> => ({
  ok: false,
  status: 404,
  error: "Room unavailable or expired",
});

export function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
