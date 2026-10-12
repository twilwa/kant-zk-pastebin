# Project guide

Kant ZK Pastebin includes a native Rust HTTP server, a browser application in
`web/`, and a browser-local paste editor in `static-pastebin/`.

## Development

The native server uses Actix Web, filesystem storage, and packages from the
custom Nora Cargo registry. Its full build requires access to that registry.
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
