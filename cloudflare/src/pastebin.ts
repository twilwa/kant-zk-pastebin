// ABOUTME: Serves the local paste editor and proxies hosted pastebin requests.
// ABOUTME: Isolates origin credentials and directs room links to the room service.
import { roomId } from "./model";

const assets = new Set([
  "/app.js",
  "/style.css",
  "/qrcode.js",
  "/kant-cli.mjs",
  "/kant-cli.sha256",
  "/kant-cli.version",
]);

const maxBodyBytes = 16 * 1024 * 1024;

async function native(request: Request, env: Env) {
  if (!env.NATIVE_ORIGIN || !env.NATIVE_ORIGIN_TOKEN)
    return new Response("Hosted pastebin unavailable", { status: 503 });
  const url = new URL(request.url);
  if (url.pathname === "/native") {
    url.pathname = "/native/";
    return Response.redirect(url.href, 308);
  }
  if (Number(request.headers.get("Content-Length")) > maxBodyBytes)
    return new Response("Request exceeds 16 MiB", { status: 413 });
  if (!["GET", "HEAD"].includes(request.method)) {
    const { success } = await env.NATIVE_WRITES.limit({
      key: "native:" + (request.headers.get("CF-Connecting-IP") ?? "unknown"),
    });
    if (!success)
      return new Response("Too many writes; try again in a minute", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
  }
  let body: Uint8Array | undefined;
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel();
        return new Response("Request exceeds 16 MiB", { status: 413 });
      }
      chunks.push(value);
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  const target = new URL(env.NATIVE_ORIGIN);
  target.pathname = url.pathname.slice("/native".length);
  target.search = url.search;
  const headers = new Headers();
  for (const name of [
    "Accept",
    "Accept-Language",
    "Content-Type",
    "If-None-Match",
    "If-Modified-Since",
    "Range",
    "If-Range",
  ]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("User-Agent", "OpenAI File Downloader, XaiImageApiFetch/1.0");
  headers.set("X-Kant-Origin-Token", env.NATIVE_ORIGIN_TOKEN);
  return fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });
}

export async function pastebin(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/native" || url.pathname.startsWith("/native/"))
    return native(request, env);
  let response: Response;
  if (!["GET", "HEAD"].includes(request.method)) {
    response = new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  } else if (url.pathname.startsWith("/r/") && roomId(url.pathname.slice(3))) {
    response = Response.redirect(env.APP_ORIGIN + url.pathname, 302);
  } else if (url.pathname === "/health") {
    response = Response.json({ ok: true, service: "pastebin-editor" });
  } else if (url.pathname === "/favicon.ico") {
    response = new Response(null, { status: 204 });
  } else if (url.pathname === "/" || assets.has(url.pathname)) {
    url.pathname =
      "/pastebin" + (url.pathname === "/" ? "/index.html" : url.pathname);
    url.search = "";
    response = await env.ASSETS.fetch(
      new Request(url, { method: request.method }),
    );
  } else {
    response = new Response("Not found", { status: 404 });
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-transform");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  if (url.pathname.endsWith("/kant-cli.mjs"))
    headers.set("Content-Disposition", 'attachment; filename="kant-cli.mjs"');
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers,
  });
}
