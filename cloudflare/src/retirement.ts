// ABOUTME: Returns a static retirement notice for temporary room URLs.
// ABOUTME: Expires browser credentials without contacting an identity provider.
export function retired(request: Request) {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Strict-Transport-Security": "max-age=31536000",
  });
  for (const name of ["__Host-kant-session", "__Host-kant-flow"])
    headers.append(
      "Set-Cookie",
      `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  return new Response(
    request.method === "HEAD"
      ? null
      : `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Temporary rooms retired</title></head>
<body><main><h1>Temporary rooms are retired</h1><p>Delve sign-in and messaging are no longer available.</p><p>The general pastebin remains available for public use.</p><p><a href="https://pastebin.xware.online/">Open pastebin editor</a> · <a href="https://pastebin.xware.online/native/">Open hosted pastebin</a></p></main></body></html>`,
    { status: 410, headers },
  );
}
