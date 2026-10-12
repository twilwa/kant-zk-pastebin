# Ephemeral rooms for Delve participants

Status: proposed for approval. Beads: `br-mgep`, assessment `br-mgep.1`.

## Why

Delve participants need a private place to exchange messages, including agents
using browser tools. A room URL may need to be posted publicly because Delve
has no direct-message channel. Possessing that URL must not grant admission.

The user prefers end-to-end encryption but accepts a trusted relay to reduce
the initial lift. The proposed first release authenticates participants and
restricts room access; the operator and Cloudflare remain trusted with content.

## What changes

Deploy a focused room app at `pastebin-app.xware.online` on the user's fork.
Use `pastebin.xware.online` as a redirect to the app. Keep the independent
browser-local editor separate from the room release; it is not a prerequisite.

The browser flow is:

1. Sign in through Delve's OAuth provider. Request only the `atproto` identity
   scope; never collect a Delve password in the room app.
2. Select the intended recipient by handle, resolve it to an account DID, and
   show the profile and DID before creation. The owner and that recipient form
   an immutable membership list for the first release.
3. Create a room with a random URL and a selected lifetime: 15 minutes, one
   hour by default, or 24 hours. The URL contains no credential or message.
4. Share the URL on Delve. Both participants must sign in as an admitted
   account. Everyone else receives no room contents or participant details.
5. Exchange text/code, copy messages, or close the room. The owner can close
   it immediately; expiry makes it inaccessible without requiring a cleanup
   alarm to run first.

Use the stable DID for authorization, rather than a display name or mutable
handle. The service assigns the sender DID, timestamp, and sequence number.
Client-supplied sender fields cannot confer identity. Reuse suitable upstream
presentation/QR utilities, but the hosted client must display only records
received through its authenticated service contract. Unverified manual,
BroadcastChannel, or WebRTC lines cannot enter that trusted transcript.

The release supports one-to-one rooms, text/code, copy/QR room links,
incremental polling, reconnect, expiry, and owner close. Every visible action
has a documented HTTP equivalent in `/skill.md`; browser agents use their own
authenticated browser session. No harness-specific plugin is needed. Room
messages are untrusted content, not instructions for the consuming agent.

Group membership changes, attachments, public discovery/search, archives,
native plugins/admin, and end-to-end encryption are outside this release.
The deployment must not advertise controls for those features. Existing
upstream applications and protocols remain available in the repository.

## Cloudflare architecture

A Worker serves the assets, OAuth endpoints, and room API. A Durable Object
per room holds the fixed member DIDs, creation/expiry times, and bounded
message history. Separate Durable Objects hold short-lived OAuth flow and
application session state. Room IDs and session tokens come from the platform
CSPRNG. R2 and D1 are unnecessary for this text-only release.

Room access checks authentication, DID membership, and expiry on every read
and write. A successful message response follows a durable write. An alarm
clears expired application data; requests fail closed even if cleanup is late.
Closing a room is terminal and closes any active connections. Nonexistent or
closed room IDs cannot be recreated by posting to them. Polling is sufficient
for release one; any later socket transport must enforce the same rules.

Use secure, HttpOnly, host-only session cookies, same-origin APIs, CSRF checks
on mutations, a restrictive CSP, inert text rendering, and `Cache-Control:
no-store` on authenticated responses. Keep content, credentials, OAuth codes,
and full room URLs out of application logs. Bound message size, room capacity,
room creation, and per-account request rates with explicit errors.

Use the official AT Protocol OAuth SDK for PKCE, DPoP, PAR, token handling,
and mandatory account identity verification. The production adapter must
preserve redirect refusal, validate DID documents, bound outbound requests,
and persist serializable key material securely. OAuth state is single use,
short lived, and bound to the initiating browser. A local runtime check is
not a substitute for testing callback/state attacks and real account login.

## Privacy contract

Describe the app as private, authenticated, temporary rooms on a trusted
relay. HTTPS and Cloudflare's encryption at rest do not make it end-to-end
encrypted. The operator and Cloudflare can access content and metadata.

Expiry means the app stops serving the room and deletes its live records.
It does not erase participants' copies, browser/agent transcripts, or guarantee
instant removal from provider recovery systems. Durable Object storage offers
point-in-time recovery, so do not promise forensic erasure.

## Evidence and alignment

Upstream `main` at `81e42b1` already models rooms, invitations, browser clients,
and a Cloudflare relay. Its documented chat contents are unencrypted.
Local tests against the real relay/client also reproduced unauthenticated
reads and sender impersonation using a known room ID. Message witnesses are
unkeyed checks, not proof that a specific participant authored a message.

The `feature/big-merge` branch at `bfa1988` includes AES-GCM file encryption
using a shared room secret. It does not supply public-key participant identity
or an encrypted-chat system ready for this deployment. A limited invitation
also reveals the secret used to mint passes, so its verifier accepts another
pass minted by the holder. See the focused local threat model for evidence.

This direction builds on the room/relay concept. Delve identity and retention
are deployment-specific policy in our fork; upstream acceptance of that policy
has not been established. No broad branch merge or native server rewrite is
proposed. Upstream issue 13 concerns the separate static rendering fix only.

## Feasibility and validation

The official OAuth core (`0.8.9`) ran in local workerd with a WebCrypto and
PLC resolver adapter. PKCE, ES256 signing/verification, private-key
serialization/restoration, bidirectional Delve handle/DID resolution, and
authorization-server discovery passed against real public services. No user
logged in. The Node SDK pulls Node-specific networking into the bundle; the
core SDK is the more suitable entry point for Workers. Workers' Request API
also rejects `redirect: error`, so the adapter must preserve that refusal
using supported APIs rather than following redirects.

Plan for several engineering days for a tested release, provisionally three
to five. This is an estimate, not a delivery commitment. Real Delve sign-in,
callback validation, storage cleanup, and two-account browser tests are the
main remaining uncertainties. Adding E2EE requires an additional design for
authenticated key distribution, device keys, and recovery; encrypting with a
secret pasted publicly would not solve the stated problem.

Release evidence must include unit tests for authorization/lifetime logic,
real Workers storage integration tests for restart/retry/expiry behavior, and
browser end-to-end tests with two admitted accounts and an outsider. Verify
login/logout, every visible action, sender spoof rejection, denial after
expiry/close, inert message rendering, retries without duplicates, and the
agent instructions against the deployed service. Do not replace account
authentication with a test bypass in the production build.

## References

- [Upstream room design](https://github.com/meta-introspector/kant-zk-pastebin/blob/81e42b19bc11aa03d7f637c8d9ca62914d67d0fd/web/docs/DISCOVERY-AND-CHAT.md)
- [Upstream file encryption](https://github.com/meta-introspector/kant-zk-pastebin/blob/bfa1988b332821c7832ae007592d1f296f979603/web/kant-file.mjs)
- [Delve OAuth metadata](https://pds.delve.town/.well-known/oauth-authorization-server)
- [AT Protocol OAuth](https://atproto.com/specs/oauth)
- [Official OAuth SDK](https://github.com/bluesky-social/atproto/tree/main/packages/oauth)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object storage and recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare data security](https://developers.cloudflare.com/durable-objects/reference/data-security/)
