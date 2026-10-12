// ABOUTME: Serves the standalone paste editor without room sessions or private APIs.
// ABOUTME: Keeps existing short room links directed to the authenticated room service.
import { roomId } from "./model";

const assets = new Set([
  "/app.js",
  "/style.css",
  "/qrcode.js",
  "/kant-cli.mjs",
  "/kant-cli.sha256",
  "/kant-cli.version",
]);

export async function pastebin(request: Request, env: Env) {
  const url = new URL(request.url);
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
