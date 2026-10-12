// ABOUTME: Serves temporary room APIs, account sign-in, and the browser application.
// ABOUTME: Enforces request boundaries before calling private storage objects.
import {
  callback,
  cookie,
  localSession,
  login,
  metadata,
  resolveIdentity,
  SESSION_COOKIE,
  setCookie,
} from "./auth";
import {
  digest,
  InputError,
  randomToken,
  roomId,
  roomInput,
  type Result,
} from "./model";
export { Room } from "./room";
export { Access } from "./access";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const result = <T>(value: Result<T>) =>
  value.ok ? json(value.value) : json({ error: value.error }, value.status);

function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-transform");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mutation(request: Request, env: Env) {
  if (
    request.headers.get("Origin") !== env.APP_ORIGIN ||
    request.headers.get("X-Kant-Request") !== "1"
  )
    throw new InputError("Request origin refused", 403);
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new InputError("Use application/json", 415);
}

async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Expected JSON body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16384) {
      await reader.cancel();
      throw new InputError("Request too large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new InputError("Invalid JSON");
  }
}

async function limit(env: Env, key: string, count: number, windowMs: number) {
  if (
    !(await env.ACCESS.getByName("rate:" + (await digest(key))).permit(
      count,
      windowMs,
    ))
  )
    throw new InputError("Too many requests; try again later", 429);
}

async function handle(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.origin !== env.APP_ORIGIN) {
    if (
      url.hostname === "pastebin.xware.online" &&
      request.method === "GET" &&
      (url.pathname === "/" ||
        (url.pathname.startsWith("/r/") && roomId(url.pathname.slice(3))))
    )
      return Response.redirect(env.APP_ORIGIN + url.pathname, 302);
    throw new InputError("Unknown application origin", 400);
  }
  const path = url.pathname;
  if (request.method === "GET" && path === "/health")
    return json({ ok: true, service: "temporary-rooms" });
  if (request.method === "GET" && path === "/oauth-client-metadata.json")
    return json(metadata(env.APP_ORIGIN));
  if (request.method === "GET" && path.startsWith("/auth/")) {
    await limit(
      env,
      "login:" + (request.headers.get("CF-Connecting-IP") ?? "local"),
      30,
      600000,
    );
    if (path === "/auth/login") return login(request, env);
    if (path === "/auth/callback") return callback(request, env);
  }
  if (path.startsWith("/api/")) {
    if (!["GET", "POST", "DELETE"].includes(request.method))
      throw new InputError("Method not allowed", 405);
    if (request.method !== "GET") mutation(request, env);
    const identity = await localSession(request, env);
    if (path === "/api/session" && request.method === "GET")
      return json(
        identity
          ? { authenticated: true, ...identity }
          : { authenticated: false },
      );
    if (!identity) throw new InputError("Sign in with Delve to continue", 401);
    await limit(env, "account:" + identity.did, 300, 60000);
    if (path === "/api/logout" && request.method === "POST") {
      const token = cookie(request, SESSION_COOKIE)!;
      await env.ACCESS.getByName("session:" + (await digest(token))).drop();
      return new Response("{}", {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": setCookie(SESSION_COOKIE, "", 0),
        },
      });
    }
    if (path === "/api/resolve" && request.method === "GET") {
      await limit(env, "resolve:" + identity.did, 20, 60000);
      const handle = url.searchParams.get("handle");
      if (!handle || handle.length > 253)
        throw new InputError("Enter a Delve handle or DID");
      return json(await resolveIdentity(env, handle));
    }
    if (path === "/api/rooms" && request.method === "POST") {
      const input = roomInput(await body(request));
      await limit(env, "create:" + identity.did, 10, 3600000);
      const recipient = await resolveIdentity(env, input.recipient);
      if (recipient.did === identity.did)
        throw new InputError("Choose another account");
      const id = randomToken(16);
      const createdAt = Date.now();
      const room = {
        owner: identity.did,
        recipient: recipient.did,
        createdAt,
        expiresAt: createdAt + input.lifetime * 1000,
      };
      const initialized = await env.ROOMS.getByName(id).initialize(room);
      if (!initialized.ok) return result(initialized);
      return json(
        { id, url: env.APP_ORIGIN + "/r/" + id, room, recipient },
        201,
      );
    }
    const parts = path.split("/");
    if (parts[1] === "api" && parts[2] === "rooms" && roomId(parts[3] ?? "")) {
      const room = env.ROOMS.getByName(parts[3]);
      if (parts.length === 4 && request.method === "GET") {
        const cursor = url.searchParams.get("after") ?? "0";
        if (!/^\d{1,4}$/.test(cursor))
          throw new InputError("Invalid message cursor");
        return result(await room.read(identity.did, Number(cursor)));
      }
      if (parts.length === 4 && request.method === "DELETE")
        return result(await room.close(identity.did));
      if (
        parts.length === 5 &&
        parts[4] === "messages" &&
        request.method === "POST"
      )
        return result(await room.send(identity.did, await body(request)));
    }
    throw new InputError("Not found", 404);
  }
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new InputError("Method not allowed", 405);
  if (path === "/" || (path.startsWith("/r/") && roomId(path.slice(3)))) {
    url.pathname = "/index.html";
    url.search = "";
    return env.ASSETS.fetch(new Request(url, { method: request.method }));
  }
  if (["/app.js", "/style.css", "/skill.md", "/favicon.svg"].includes(path))
    return env.ASSETS.fetch(request);
  throw new InputError("Not found", 404);
}

export default {
  async fetch(request, env) {
    try {
      return secure(await handle(request, env));
    } catch (error) {
      if (error instanceof InputError)
        return secure(json({ error: error.message }, error.status));
      return secure(json({ error: "Service unavailable; retry shortly" }, 503));
    }
  },
} satisfies ExportedHandler<Env>;
