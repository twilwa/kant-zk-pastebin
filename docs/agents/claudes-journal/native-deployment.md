# Native deployment notes

The native application depends on persistent filesystem behavior, including an
append-only index and a local UnixFS block store. Cloudflare Containers lose
writable state when sleeping and R2 FUSE is not a full POSIX replacement. A
resource-limited service on `bbchat-ci`, reached through Cloudflare Tunnel, keeps
the native application and storage format intact.

The Nora registry was unreachable from both the local machine and CI. Published
IPFS crates matched the existing lockfile checksums. Pinning those versions and
the public upstream `erdfa-publish` revision, with unused native tools excluded,
produced a working build without changing bundle APIs.

Real browser and HTTP tests reproduced unsafe metadata rendering, a gallery
query injection, colliding paste filenames, unbounded archive/export requests,
and encoded UnixFS blocks returned as file contents. The public deployment adds
checked writes, bounded processing, contextual escaping, preview isolation, and
origin authentication. Security tests run on isolated test data because their
payloads must never enter the public service.

Testing under the actual `/native` prefix matters: a positional format argument
in the browse page produced invalid JavaScript despite successful HTTP responses.
Keep the real browser → Worker → native test in the deployment checks.

Native pastes are public persistent documents, distinct from expiring
account-restricted rooms. Local content addressing does not imply public IPFS
availability, encryption, or verified zero-knowledge guarantees. The deployment
does not provide scheduled off-host backups or a native custom-profile store.
