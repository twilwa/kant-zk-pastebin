# Kant pastebin on Cloudflare

This fork's Cloudflare deployment serves the standalone Kant paste editor at
`pastebin.xware.online` and proxies the native Rust service at `/native/`.
The native service runs on `bbchat-ci` with persistent paste and IPFS storage.
See [native deployment](../docs/native-deployment.md) for its supported features,
public request boundary, and operating instructions.

Delve sign-in and temporary rooms are retired. Every request to
`pastebin-app.xware.online` returns HTTP 410 with a link to the general pastebin.
Room paths under `/r/` on `pastebin.xware.online` also return HTTP 410. The
deployment does not resolve Delve identities, initiate OAuth, or expose room
creation, message, session, or logout APIs. The retirement response clears the
room application's host-only session and login-flow cookies.

The editor stores pastes in IndexedDB. Copy/share links encode the whole paste
in a URL fragment and work without a server. Anyone with the link can read it;
the links have no encryption or expiry. Server synchronization starts blank and
is used only when the visitor configures a server. The deployed editor loads
its QR dependency locally and provides the bundled upstream CLI downloads.

## Development and checks

Use Node 22.18+ or 24+ (the tests execute TypeScript), npm, and installed Google
Chrome for browser checks. From this directory:

```sh
npm ci
npm run dev
```

Open the editor at `http://127.0.0.1:8787`.

```sh
npm test
npm run typecheck
npm run test:browser
npx wrangler deploy --dry-run
```

`npm test` covers retirement responses, expiry cleanup in real local SQLite
Durable Objects, and the native proxy boundary. Browser tests exercise the
standalone editor's real storage, sharing, QR, and split behavior, and confirm
that it does not offer room navigation. These tests do not contact Delve.
Run `npm run test:native` against the isolated native test service described in
[native deployment](../docs/native-deployment.md) for the full browser-to-native
request path.

## Storage and expiry

The `Room` and `Access` Durable Object classes and their existing bindings remain
solely to service scheduled expiry alarms. They expose no room or authentication
operations. Their alarms retain each stored deadline and delete live data when
it expires. The retirement deployment does not reset deadlines, delete
namespaces, or introduce a destructive migration. No R2 bucket or D1 database is
used by this Worker. Application logs and Worker observability are disabled.

Native paste storage is separate from these objects and remains persistent.
Browser-local editor data also remains in the visitor's IndexedDB.

Expiry means live service deletion, **not forensic erasure**. Cloudflare recovery
data and participant copies are outside the guarantee. See [Cloudflare storage
deletion](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#deleteall)
and [data security](https://developers.cloudflare.com/durable-objects/reference/data-security/).

## Deployment

`wrangler.jsonc` targets the owner's Cloudflare account and these exact domains:

- `pastebin.xware.online`: standalone editor and the `/native/` backend proxy.
- `pastebin-app.xware.online`: HTTP 410 retirement notice, including OAuth
  metadata, callbacks, room links, APIs, and former room assets.

Use authenticated Wrangler, then `npm run deploy`. No subscription upgrade is
performed; the account's existing plan limits apply. The current configuration
disables workers.dev and preview URLs, uses SQLite object migrations, and routes
all assets through the Worker for consistent security headers. Regenerate types
with `wrangler types` after changing bindings.

The Worker retains the operational name `kant-temporary-rooms` because the
editor and native proxy share that deployment. Preserve `NATIVE_ORIGIN_TOKEN`,
the native origin configuration, and the Cloudflare Tunnel when updating it.
Removing the entire Worker would also interrupt the general pastebin.

Preserve the `Room` and `Access` classes and bindings while their expiry alarms
remain in use. Do not roll back to an active room-service version or attempt to
recover expired messages. Historical room proposals and assessments describe
the retired service, not the current public interface.
