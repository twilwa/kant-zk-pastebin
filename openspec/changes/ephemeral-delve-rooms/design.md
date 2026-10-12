# Design

## Context

See proposal.md and .factory/threat-model.md. The hosted application has a
distinct authenticated room API; upstream raw witnesses cannot establish
Delve account identity. Existing native and browser applications remain intact.

## Decisions

Use a scoped `cloudflare/` package and browser entry point. Bundle the QR
generator locally with the assets. Do not import the experimental relay branch
or route unverified P2P messages into the authenticated transcript.

Use a Worker with `Room` and `Access` Durable Object bindings. Each room has
an independently generated 128-bit random URL ID, fixed owner/recipient DIDs,
an absolute expiry, and SQL message rows. A message body is at most 8 KiB;
a room is limited to 1,000 messages. SQL assigns the sequence. A unique
sender/request ID makes retries idempotent without trusting client ordering.
No global room index is needed.

All room reads and writes check membership and expiry within the room object.
Every deadline is absolute; activity never renews it. Alarm cleanup and owner
close delete all live room data. A missing room cannot be created through its
read/send route. Creation always generates a fresh ID on the server.

The Access binding stores single-use OAuth flow records and opaque local
sessions, with individual TTL alarms. Namespace IDs use hashes of secret
tokens. Access objects also enforce bounded per-account/IP request windows;
these records expire. Internal RPC methods are not exposed as public routes.

Use the official OAuth core and JWK packages with WebCrypto and a narrowly
scoped PLC resolver. The public client requests only `atproto`, has no refresh
grant, and starts at the fixed Delve provider. A Secure/HttpOnly/SameSite=Lax
flow cookie binds the SDK's single-use state to the initiating browser.
Validate issuer and DID/PDS binding before issuing a local session. OAuth
tokens are used only during the callback and revocation is attempted afterward;
remote revocation is best effort. These tokens are not
needed to read room messages. Local sessions expire within 24 hours and logout
deletes the session record. Refresh-token coordination is therefore unnecessary.

Serve the app and API on the same origin. Require matching Origin plus a
custom mutation header and JSON content type for API writes. Use a strict
CSP with local scripts/styles, host-only cookies, no-store, no-referrer, and
no service worker or transcript localStorage. Authenticated polling is the
initial transport. The UI clears messages on room denial and when its local
deadline is reached; the server remains authoritative.

## Risks and validation

OAuth runtime differences require real-provider validation after local unit,
storage-integration, and browser tests. Seeded local sessions can exercise the
room UI against real Worker APIs, but do not prove the OAuth login flow.
Production contains no test-login endpoint. A real Delve account login and
two-account exchange must be reported separately from seeded-session tests.

Operator access and provider recovery retention remain accepted limitations.
No content logs, archives, public discovery, or local saved drafts are added.
Do not claim E2EE or secure erasure.

## Deployment

Validate config/types, run unit and Workers tests, browser tests, and a dry-run
bundle before publishing the Worker. Bind only the exact pastebin hostnames;
leave the zone wildcard unchanged. Verify HTTPS, headers, login discovery,
denied outsider requests, and the documented API after deployment. Preserve
deployment version IDs for rollback; never roll back by deleting room storage.
