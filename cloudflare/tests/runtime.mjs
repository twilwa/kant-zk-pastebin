// ABOUTME: Runs production room objects in an isolated local Workers runtime.
// ABOUTME: Provides real SQLite persistence and RPC bindings for integration tests.
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { resolve } from "node:path";

export async function runtime(options = {}) {
  const result = await build({
    entryPoints: [options.entry ?? "tests/entry.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    external: ["node:*", "cloudflare:*"],
  });
  return new Miniflare({
    unsafeInspectDurableObjects: true,
    ...(options.port ? { port: options.port, host: "127.0.0.1" } : {}),
    ...(options.persistence
      ? { resourcePersistencePath: options.persistence }
      : {}),
    workers: [
      {
        config: {
          name: "rooms",
          compatibilityDate: "2026-10-12",
          compatibilityFlags: ["nodejs_compat"],
          ...(options.assets
            ? {
                assets: {
                  directory: resolve("public"),
                  hasUserWorker: true,
                  runWorkerFirst: true,
                  htmlHandling: "none",
                },
              }
            : {}),
          manifest: {
            mainModule: "worker.mjs",
            modules: {
              "worker.mjs": {
                type: "esm",
                contents: result.outputFiles[0].text,
              },
            },
          },
          exports: {
            Room: { type: "durable-object", storage: "sqlite" },
            Access: { type: "durable-object", storage: "sqlite" },
          },
          env: {
            ...(options.assets ? { ASSETS: { type: "assets" } } : {}),
            ROOMS: {
              type: "durable-object",
              worker: "rooms",
              exportName: "Room",
            },
            ACCESS: {
              type: "durable-object",
              worker: "rooms",
              exportName: "Access",
            },
            APP_ORIGIN: {
              type: "text",
              value: options.origin ?? "http://localhost",
            },
            PASTEBIN_ORIGIN: {
              type: "text",
              value: options.pastebinOrigin ?? "https://pastebin.xware.online",
            },
          },
        },
      },
    ],
  });
}
