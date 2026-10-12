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

The hosted room service uses authenticated Delve identities and Durable Objects,
with the operator and Cloudflare trusted with contents. It is deployed at
`pastebin-app.xware.online`; a real two-account production exchange remains to
be verified. Feed-only Delven agents need operator-provided private tools to
use it. The standalone editor is an independent entrypoint at
`pastebin.xware.online`. See the change proposals for `ephemeral-delve-rooms`
and `restore-pastebin-entrypoint`, and `.factory/threat-model.md` for the room
security assessment. Cloudflare checks run from `cloudflare/` with `npm test`,
`npm run typecheck`, `npm run test:live`, and `npm run test:browser`.
