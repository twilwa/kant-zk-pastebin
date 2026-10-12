# Temporary Delve rooms

This fork's Cloudflare deployment serves the standalone Kant paste editor at
`pastebin.xware.online` and temporary, account-restricted, one-to-one
conversations at `pastebin-app.xware.online`. Each app links to the other.
Rooms use a trusted relay: the operator and Cloudflare can read message contents.
The native Rust server, public archive/search, IPFS node, file transfer, and
upstream peer relay are not deployed here.

The editor stores pastes in IndexedDB. Copy/share links encode the whole paste
in a URL fragment and work without a server. Anyone with the link can read it;
the links have no encryption or expiry. Server synchronization starts blank and
is used only when the visitor configures a server. The deployed editor loads
its QR dependency locally and provides the bundled upstream CLI downloads.

Each creation generates a fresh 128-bit random room locator, with immutable
membership bound to two Delve DIDs. Authentication uses the official AT Protocol
OAuth client with identity-only scope, PKCE, DPoP, one-use state, and a browser
binding cookie. Provider access tokens remain transient and revocation is best
effort. Local HttpOnly sessions expire after 24 hours.

## Development and checks

Use Node 22.18+ or 24+ (the tests execute TypeScript), npm, and installed Google
Chrome for browser checks. From this directory:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8787` consistently; the host-only login cookie cannot cross
between `localhost` and `127.0.0.1`.

```sh
npm test
npm run typecheck
npm run test:live
npm run test:browser
npx wrangler deploy --dry-run
```

`npm test` covers pure validation and real local Workers/SQLite/API behavior.
The live test uses Delve's actual authorization server, without completing an
account login. Browser tests exercise real UI, API, SQLite, and public account
resolution, with local sessions seeded by the test harness. They do **not** prove
the complete OAuth callback flow. There are no test-login routes in production.
A release also needs a real account login and a two-account production exchange.

The public [agent guide](web/skill.md) maps every UI action to its API operation.
No cookie extraction or separate long-lived API credentials are required for
browser agents.

## Storage and expiry

One SQLite Durable Object stores each room. Every operation checks the fixed
deadline and membership. Alarms delete live data at expiry; owner closure deletes
it immediately. A cleared URL cannot recreate a room through the public API.
Duplicate sends with the same request ID and text return the original message.

Access objects hold short-lived login states, local sessions, and rate counters.
No R2 bucket or D1 database is required. The service stores at most 1,000 messages
of 8 KiB per room. Sessions last 24 hours; unfinished login states last 10 minutes.
No transcript is saved in browser storage. Application logs and Worker
observability are disabled to avoid recording callback URLs and room identifiers.

Expiry means live service deletion, **not forensic erasure**. Cloudflare recovery
data and participant copies are outside the guarantee. See [Cloudflare storage
deletion](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#deleteall)
and [data security](https://developers.cloudflare.com/durable-objects/reference/data-security/).

## Deployment

`wrangler.jsonc` targets the owner's Cloudflare account and these exact domains:

- `pastebin-app.xware.online`: canonical service and OAuth metadata.
- `pastebin.xware.online`: standalone editor; existing room paths redirect to
  the canonical room service. Private room APIs are unavailable on this host.

Use authenticated Wrangler, then `npm run deploy`. No subscription upgrade is
performed; the account's existing plan limits apply. The current configuration
disables workers.dev and preview URLs, uses SQLite object migrations, and routes
all assets through the Worker for consistent security headers. Keep the canonical
origin and its OAuth metadata URL stable. Regenerate types with `wrangler types`
after changing bindings.

For an emergency shutdown, remove the exact custom-domain routes or deploy an
unavailable response. Do not use rollback as a way to recover expired messages;
that would violate the intended retention policy. Preserve the Room and Access
object classes in ordinary upgrades so existing expiry alarms remain serviced.
