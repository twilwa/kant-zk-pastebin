# Delve room assessment

The deployment goal is temporary private communication between Delve accounts,
including browser-capable agents. A public room link must not also be an
admission credential. The user accepts a trusted relay as a lower-lift first
release; end-to-end encryption is preferred if it aligns with upstream.

Local production-module tests reproduced secretless reads, sender
impersonation, and limited-pass re-minting accepted by the verifier. Upstream
main documents unencrypted chat. The feature branch adds AES-GCM file chunks
with a shared secret, not a public-key chat identity system. The proposal and
focused threat model describe the evidence and scope limits.

Delve exposes standard AT Protocol OAuth discovery. The official OAuth core
0.8.9 ran under local workerd with a WebCrypto/PLC resolver adapter. Real
public identity and authorization-server discovery succeeded, along with
PKCE, ES256, and key serialization. No user login was attempted.

The Node SDK imports Node networking through its default handle resolver even
when a different resolver is provided. The core SDK avoids that import.
Workers rejects Request redirect mode `error`; SDK internals can construct
that Request before a custom fetch is called. A deliberate resolver adapter
must retain refusal of redirects and official document validation. Do not
silently switch to automatic redirect following. Miniflare 5.20261006.1-alpha
uses `workers[].config.manifest`; its bundled README still shows the earlier
constructor API. The checked installed schema resolved that mismatch.

The accidental fork v0.1.0 tag was removed through GitHub's REST ref deletion
endpoint and absence verified through fresh REST and Git reads. The upstream
tag and fork rendering branch remain intact. Repository-local
`push.followTags=false` prevents another incidental tag push.

## Cloudflare deployment

The user approved the trusted-relay scope. Implementation is isolated in
`cloudflare/`; upstream native applications remain intact. `Room` objects enforce
two DIDs, absolute expiry, idempotent sends, limits, and owner closure. `Access`
objects hold browser-bound one-use OAuth state, local sessions, and rate limits.
Room requests cannot initialize a cleared URL. Browser content uses textContent.

Local tests cover real SQLite persistence across restart, simultaneous retries,
membership, sender spoofing, size/rate/capacity limits, pagination, deadline
denial, alarm-driven table deletion before any lazy read, and explicit closure.
Browser tests use real Worker APIs with test-seeded sessions and real public
Delve identity resolution. They exercise create, distinct throwaway URLs, copy
links/messages, QR, two-way text, inert markup, outsider denial, expiry, closure,
logout, and absence of local transcript storage. They do not prove account login.
No test-authentication route is present in the deployed Worker.

The real Delve provider accepts the deployed metadata and PKCE/DPoP PAR flow.
Full callback validation with a real user and a two-account production exchange
remain pending. The user was asked to sign in; no credentials were requested.

Worker `kant-temporary-rooms` is deployed to `pastebin-app.xware.online`; the
exact `pastebin.xware.online` root/room paths redirect to it. Version
`2c5136de-df8e-4464-8a6f-c56117f7bb90` is live. HTTPS, metadata, session responses,
redirects, production sign-in initiation, and browser rendering were verified.
The wildcard DNS record was untouched. No R2/D1 resources or plan upgrade were
needed. The Free plan rejected an explicit CPU limit, so deployment uses its
default limits.

Cloudflare injected analytics and challenge scripts despite a no-store response.
The restrictive CSP blocked them. Adding `Cache-Control: no-store, no-transform`
stopped injection without relaxing CSP or changing unrelated zone settings;
the live page then contained only its own script and emitted no console errors.
See Cloudflare's [analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/).

Workers' current SQLite deleteAll atomically removes data and alarms. Calling
deleteAlarm first creates a retention-failure window; the implementation uses
deleteAll directly. Expiry is live deletion, not a claim about forensic erasure
of provider recovery copies or participant copies.

Beads `br-mgep.2` tracks implementation and remaining live-account validation;
the completed design assessment is `br-mgep.1`.
