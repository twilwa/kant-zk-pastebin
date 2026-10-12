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

No Cloudflare resources or DNS changes were made. Work tracking remains in
Beads under br-mgep; the design assessment is br-mgep.1.
