# Project guide

Kant ZK Pastebin includes a native Rust HTTP server, a browser application in
`web/`, and a browser-local paste editor in `static-pastebin/`.

## Development

The native server uses Actix Web and filesystem storage. Its Docker build uses
pinned public dependencies and a committed lockfile. See
`docs/native-deployment.md` for the persistent CI service and public boundary.
The static editor uses plain JavaScript, IndexedDB, and an external QR library.
You can serve its directory with any static HTTP server.

Install JavaScript test dependencies with `npm ci --ignore-scripts`. Install
the test browser with `npx playwright install chromium`, then run
`npm run test:static`. To use installed Chrome, set
`PLAYWRIGHT_CHANNEL=chrome`. These tests serve the production static files
and exercise real browser storage. They do not validate the native server.

## Work tracking

Beads tracks the deployment under `br-mgep` and the approved static rendering
fix under `br-0k0y`. Store generated test output in `scratchpad/`. Keep the
rendering change on the fork while upstream considers issue 13.

## Cloudflare deployment target

The standalone editor is available at `pastebin.xware.online`. The same Worker
proxies `/native/` to the persistent native service on `bbchat-ci` through
Cloudflare Tunnel. The operational Worker name remains `kant-temporary-rooms`.

Delve sign-in and temporary rooms are retired at the user's request. The
`pastebin-app.xware.online` origin and `/r/` paths on the editor origin return
HTTP 410. No Delve identity lookup, OAuth, session, or room APIs are available.
Existing `Room` and `Access` Durable Objects retain only their expiry alarms;
the retirement does not delete namespaces or alter native paste storage.

The `retire-delve-connectivity` change records the current deployment contract.
The `ephemeral-delve-rooms` proposal and `.factory/threat-model.md` remain
historical records. Cloudflare checks run from `cloudflare/` with `npm test`,
`npm run typecheck`, and `npm run test:browser`. Use `npm run test:native` with
the isolated native service for the complete browser-to-native request path.
