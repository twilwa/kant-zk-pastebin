# Deploy the native Kant backend

The user authorizes publishing the existing fork commit and deploying the full
native backend, using Cloudflare if practical or the CI host otherwise.

## Deployment

Run the existing Rust application in a dedicated container on `bbchat-ci`, with
persistent paste and IPFS directories, resource limits, and a loopback listener.
Keep the independent editor and temporary rooms available. Use Cloudflare Tunnel
for public HTTPS only after the public request boundary passes verification.

Cloudflare Containers discard their writable disk on sleep. R2 FUSE does not
provide full POSIX semantics, so it is not a drop-in durable store for this
application's append-only index and filesystem operations.

## Portable build

Use the published IPFS crates at the existing locked versions and a pinned public
revision of upstream's erdfa-publish library. Disable unused erdfa native tooling
features. Preserve application code and data formats. The Nora registry is
unreachable from both the development machine and the CI host.

## Public release condition

The native server contains unauthenticated filesystem reads and unsafe rendering
of paste-controlled metadata. The user explicitly approves hardening for public deployment. Escape rendered
paste data, constrain filesystem access, sandbox previews, bound uploads and
archive extraction, and keep host-management routes outside the public surface.
Do not expose the backend until that work is verified.
