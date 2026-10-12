# Delve room deployment threat model

Assessment date: October 12, 2026. Status: local assessment, not a deployed
control or a full repository audit. Beads: `br-mgep.1`.

## Scope and assets

The target is temporary private text communication between known Delve
accounts, including agents with browser tools. Protect message contents from
nonmembers, account attribution, membership, OAuth credentials, and room
expiry. Room links may be posted on a public feed.

The first release may trust the operator, Cloudflare, and Delve's identity
service. It cannot protect against those parties, compromised participant
accounts/devices, screenshots, or a participant forwarding content. It does
not promise anonymity, nonrepudiation, or forensic erasure.

## Trust boundaries

The browser sends untrusted input to the Worker. Delve OAuth establishes an
account DID; the Worker authorizes that DID against room membership. Durable
Objects persist the authenticated room state. User text rendered in a browser
or consumed by an agent remains untrusted even when its sender is known.

Public URLs are locators. Session cookies and OAuth tokens are credentials.
No publicly shared invitation may contain a credential that grants room
membership. Handle-to-DID resolution requires the protocol's bidirectional
identity checks; a typed name alone is not evidence of account control.

## Validated upstream findings

Code base: upstream `81e42b19bc11aa03d7f637c8d9ca62914d67d0fd`, plus the
unrelated static rendering fix on the fork. Tests ran exclusively against a
loopback relay with fresh local SQLite state. No public room was attacked.

### High: room contents are accessible without an authenticated account

`server/relay.mjs:434` serves room history using only a room path and cursor.
`web/kant-net.mjs:201` encodes the plaintext body in the message envelope.
An actual HTTP GET without an invite/pass returned a message which the
production parser decoded. Preconditions: the caller knows the room ID.
For the proposed public-link use case, URL secrecy cannot provide admission.
This is a deployment suitability gap; upstream documents unencrypted chat.

### High: message witnesses do not authenticate the sender

`web/kant-net.mjs:193` includes only public fields in the message commitment.
`web/kant-net.mjs:199` uses an unkeyed witness;
`web/kantzk.mjs:31` implements the digest as four FNV-1a rounds.
`server/relay.mjs:411` allows posting without a pass, subject to rate limits.
`web/kant-net.mjs:695` accepts a parseable message for the current room.

The reproduction constructed a message as sender `alice` using only room,
name, sequence, and text. The real relay accepted it, and a real `KantNode`
receiver included the forged sender/text in `view()` after `pollOnce()`.
No room secret or signing key was supplied to the impersonation operation.
This contradicts treating witness acceptance as sender authentication.

### Medium: limited-pass holders possess the pass-minting secret

`web/kant-pass.mjs:30` includes the invitation fields, including its secret,
in a pass. `web/kant-pass.mjs:39` mints using that secret. Decoding a pass with
limit 1 supplied enough material to mint a pass with limit 1000, accepted by
the real `passOk` verifier at line 52. This test proves verifier acceptance;
it does not claim an observed quota-exhaustion attack against a public relay.

The same local test confirmed a public invitation round-trips the room secret
through the production encoder/decoder. Hex encoding is not encryption.

Reproduction: `rtk proxy node scratchpad/room-security-check.mjs` from this
checkout. The script uses production modules, a real HTTP server, real fetch,
and the SQLite pass store. All four assertions passed. The file is an ignored
one-shot diagnostic rather than a regression asserting vulnerabilities should
remain present.

## Feature-branch cryptography

`origin/feature/big-merge` at `bfa1988b332821c7832ae007592d1f296f979603`
contains `web/kant-file.mjs`: HKDF/SHA-256 key derivation and AES-GCM file
chunks using a shared secret. Its manifest includes filename, MIME type,
size, nonce, and CIDs. This is not proof of sender identity or encrypted chat.
The review found no public-key chat authentication in the inspected browser,
relay, and script sources. Native external Nora dependencies were not built
or audited, so this is not a repository-wide absence claim.

## Required controls by threat

| Threat | Required deployment control |
| --- | --- |
| Spoofing | SDK-verified Delve DID; server-bound sender; browser-bound OAuth state; no unauthenticated transcript transport |
| Tampering | TLS; same-origin/CSRF checks; validate requests; immutable member list; durable append before acknowledgement |
| Repudiation | Account attribution within the trusted service; do not claim cryptographic nonrepudiation |
| Information disclosure | Membership on every read; inert rendering; no content/credential logs; no-store; no transcript in URLs or service-worker cache |
| Denial of service | Bound request size, history, room count, and rate; explicit capacity errors and retry behavior |
| Elevation of privilege | Only authenticated members read/write; owner-only close; no authority derived from client sender, a bearer invitation, or a pass limit |

Expiry must be enforced in the request path and on any open connection.
Cleanup alarms handle deletion, but delayed cleanup must never extend access.
No application archive or analytics pipeline should copy room contents.
Provider recovery data and participant copies remain outside deletion claims.

## Remaining validation

The official OAuth core passes a local workerd compatibility check for crypto,
key serialization, public identity resolution, and provider discovery with a
small adapter. Real sign-in/callback, browser binding, replay rejection,
session revocation, and distributed state have not been validated.

Before launch, unit tests must cover admission and expiry decisions; Workers
integration tests must exercise persistence, retries, closure, and delayed
alarms; real browser tests must cover two admitted accounts, an outsider,
sender spoofing, script injection, and all documented agent actions. No test
authentication bypass may ship. These controls are proposed, not implemented.
