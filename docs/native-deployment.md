# Native pastebin deployment

The native Rust service is hosted on `bbchat-ci` behind Cloudflare Tunnel and the
existing `kant-temporary-rooms` Worker. The public entrypoint is
`https://pastebin.xware.online/native/`. The root URL remains the browser-local
editor; temporary Delve rooms remain at `https://pastebin-app.xware.online/`.

Native pastes are public and persistent. They can appear in browse and search.
They do not inherit the room service's account restrictions or expiry.
The service supports pastes, replies, raw downloads, file uploads, bounded archive
extraction, built-in split profiles, search, and content-addressed downloads.
The upstream custom split-profile endpoint does not persist profiles.
IPFS blocks are stored locally and served by this application; this deployment
does not announce or pin them on the public IPFS network. No end-to-end encryption
or additional zero-knowledge guarantees are introduced by this deployment.

## Runtime and data

`deploy/native/kant-pastebin.service` runs `localhost/kant-pastebin:deployed` as
UID 10001 in a read-only Podman container with a 2 CPU / 2 GiB limit. The only
persistent application mount is `/opt/kant-pastebin/data`, containing `pastes/`
and `ipfs/`. A dedicated 5 GiB ext4 image bounds disk use; `deploy/native/data.mount`
is installed under the unit name returned by
`systemd-escape --path --suffix=mount /opt/kant-pastebin/data`.
The application service requires that mount. HTTP listens on host loopback port 18091. Host-management routes,
plugins, repository indexing, filesystem diagnostics, and animation jobs are
outside the public surface.

`deploy/native/kant-pastebin-tunnel.service` runs the pinned Cloudflare connector.
The `kant-pastebin-ci` tunnel forwards `pastebin-origin.xware.online` to port
18091. Direct origin requests require `X-Kant-Origin-Token`; the Worker supplies
it from the `NATIVE_ORIGIN_TOKEN` secret and discards incoming cookies,
authorization, and user-supplied origin credentials.

Root-readable environment files live in `/opt/kant-pastebin/credentials/`:
`server.env` contains the origin token and `tunnel.env` contains the tunnel token.
Never put either credential in Git, shell history, or deployment logs. Rotate
the origin token in both the environment file and Worker secret together.

Writes through Cloudflare are limited to 10 requests per minute per client IP.
Cloudflare's rate limiter is local to each location and is not an exact global
quota. Requests are capped at 16 MiB, JSON at 2 MiB. Archive extraction is capped
at 64 MiB, 1,024 entries, and four nested archive levels; at most eight temporary
archive sessions are retained. Sessions expire after one hour and expired data
is pruned when the cache is accessed. Archive sessions are public
capabilities and are not private rooms. Active file previews are sandboxed without
scripts or same-origin access. Exports and split operations enforce an aggregate
64 MiB budget and at most 1,024 selections or output chunks; repeated selections
are deduplicated. Invalid oversized operations return an error before persistence.

## Build and operate

The Dockerfile uses pinned Rust and Debian images, a committed Cargo lockfile,
published IPFS crates, and a pinned public `erdfa-publish` revision. The native
build no longer needs the Nora registry. Build with a meaningful `GIT_COMMIT`
argument, tag the tested image `localhost/kant-pastebin:deployed`, and restart only
`kant-pastebin.service`. Preserve the previous image for rollback.

Useful commands on the CI host:

```sh
systemctl status kant-pastebin.service kant-pastebin-tunnel.service
journalctl -u kant-pastebin.service -n 50 --no-pager
podman logs --tail 50 kant-pastebin
systemctl restart kant-pastebin.service
```

Data survives container replacement and host restart. There is no scheduled
off-host backup configured by this deployment. Before maintenance involving
storage, stop the application, take a consistent copy of the entire data
directory, and restart it. Never remove the data directory when replacing an
image. The CI host remains a single point of failure.

## Validation

Run native unit tests serially because storage tests use temporary environment
variables:

```sh
cargo test --locked --release --lib --bin kant-pastebin -- --test-threads=1
```

Use isolated test data, never production, for adversarial tests. Start a public
mode native instance with an empty `BASE_PATH` on local port 18909 for
`tests/native-rendering.test.mjs` and `tests/native-ipfs.test.mjs`. Start another
on port 18910 with `BASE_PATH=/native`,
`NATIVE_ORIGIN_TOKEN=native-e2e-credential`, and
`BASE_URL=http://127.0.0.1:8799` for `tests/native-boundary.test.mjs` and
`cloudflare/npm run test:native`. The rendering suite fills the temporary archive
session pool; restart its test instance before repeating that suite.

Cloudflare checks are `npm test`, `npm run typecheck`, `npm run test:browser`, and
`npm run test:native` from `cloudflare/`. Verify the public browser create/read
flow and persistence across a service restart after deploying.
