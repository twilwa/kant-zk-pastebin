# ABOUTME: Builds the native pastebin from pinned public dependency sources.
# ABOUTME: Runs it without root privileges using a persistent application data mount.
FROM docker.io/library/rust:1.90-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock build.rs ./
COPY src ./src
COPY static ./static
ARG GIT_COMMIT=unknown
ARG BASE_PATH=/native
ENV GIT_COMMIT=$GIT_COMMIT BASE_PATH=$BASE_PATH
ENV CARGO_BUILD_JOBS=2 CARGO_HTTP_USER_AGENT="OpenAI File Downloader, XaiImageApiFetch/1.0"
RUN cargo build --locked --release --bin kant-pastebin \
    && install target/release/kant-pastebin /usr/local/bin/kant-pastebin

FROM docker.io/library/debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates liblzma5 libbz2-1.0 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/pastes /data/ipfs \
    && chown -R 10001:10001 /data
COPY --from=builder /usr/local/bin/kant-pastebin /usr/local/bin/kant-pastebin
USER 10001:10001
ENV IPFS_PATH=/data/ipfs UUCP_SPOOL=/data/pastes BIND_ADDR=0.0.0.0:8090
ENV BASE_PATH=/native PUBLIC_MODE=1 RUST_LOG=warn
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/kant-pastebin"]
