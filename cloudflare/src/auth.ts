// ABOUTME: Authenticates Delve identities with the official AT Protocol OAuth client.
// ABOUTME: Binds one-use login flows to browsers and keeps provider tokens transient.
import {
  OAuthClient,
  requestLocalLock,
  type Fetch,
  type InternalStateData,
  type SessionStore,
  type OAuthClientMetadataInput,
  type ResolvedDocument,
  type AtprotoIdentityDidMethods,
  type OAuthSession,
} from "@atproto/oauth-client";
import { JoseKey } from "@atproto/jwk-jose";
import { WebcryptoKey } from "@atproto/jwk-webcrypto";
import { assertDidPlc, didDocumentValidator } from "@atproto/did";
import {
  digest,
  FLOW_MS,
  InputError,
  PROVIDER,
  randomToken,
  returnPath,
  SESSION_MS,
} from "./model";

export const SESSION_COOKIE = "__Host-kant-session";
const FLOW_COOKIE = "__Host-kant-flow";
export type Identity = { did: string; handle: string };

export function cookie(request: Request, name: string) {
  const entries = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((value) => value.trim());
  const matches = entries.filter((value) => value.startsWith(name + "="));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export const setCookie = (name: string, value: string, seconds: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;

export function metadata(origin: string): OAuthClientMetadataInput {
  const local = origin.startsWith("http://");
  const redirect = local
    ? origin.replace("localhost", "127.0.0.1") + "/auth/callback"
    : origin + "/auth/callback";
  return {
    client_id: local
      ? `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=atproto`
      : origin + "/oauth-client-metadata.json",
    client_name: "Kant temporary rooms",
    client_uri: local ? undefined : origin,
    redirect_uris: [redirect],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: "atproto",
    application_type: local ? "native" : "web",
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
  };
}

export const oauthFetch: Fetch = async (input, init) => {
  const request = new Request(input, { ...init, redirect: "manual" });
  const url = new URL(request.url);
  if (
    ![PROVIDER, "https://plc.directory"].includes(url.origin) ||
    url.username ||
    url.password
  )
    throw new Error("OAuth destination refused");
  request.headers.set(
    "User-Agent",
    "OpenAI File Downloader, XaiImageApiFetch/1.0",
  );
  const response = await fetch(request, {
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("OAuth redirect refused");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error("OAuth response exceeds limit");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(response.status === 204 ? null : bytes, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export function oauthClient(env: Env, binder: string) {
  type ProviderSession = Parameters<SessionStore["set"]>[1];
  const sessions = new Map<string, ProviderSession>();
  const client = new OAuthClient({
    clientMetadata: metadata(env.APP_ORIGIN),
    responseMode: "query",
    fetch: oauthFetch,
    handleResolver: PROVIDER,
    didResolver: {
      async resolve(did, options) {
        assertDidPlc(did);
        const response = await oauthFetch(
          `https://plc.directory/${encodeURIComponent(did)}`,
          {
            signal: options?.signal,
            headers: { Accept: "application/did+ld+json,application/json" },
          },
        );
        if (response.status !== 200) throw new Error("DID resolution failed");
        const document = didDocumentValidator.parse(await response.json());
        if (document.id !== did) throw new Error("DID identity mismatch");
        return document as ResolvedDocument<
          typeof did,
          AtprotoIdentityDidMethods
        >;
      },
    },
    runtimeImplementation: {
      requestLock: requestLocalLock,
      createKey: (algorithms) =>
        WebcryptoKey.generate(
          algorithms.filter((value) => value === "ES256"),
          undefined,
          { extractable: true },
        ),
      getRandomValues: (length) =>
        crypto.getRandomValues(new Uint8Array(length)),
      digest: async (bytes, algorithm) =>
        new Uint8Array(
          await crypto.subtle.digest(
            { sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[
              algorithm.name
            ],
            bytes,
          ),
        ),
    },
    stateStore: {
      async set(state, value) {
        const { dpopKey, ...data } = value;
        if (!dpopKey.privateJwk || data.iss !== PROVIDER)
          throw new Error("Invalid pending OAuth state");
        await env.ACCESS.getByName("flow:" + (await digest(state))).save(
          {
            iss: data.iss,
            verifier: data.verifier,
            appState: returnPath(data.appState ?? null),
            dpopJwk: JSON.stringify(dpopKey.privateJwk),
          },
          FLOW_MS,
          binder,
        );
      },
      async get(state): Promise<InternalStateData | undefined> {
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(state)) return undefined;
        const record = await env.ACCESS.getByName(
          "flow:" + (await digest(state)),
        ).take(binder);
        if (
          !record ||
          record.iss !== PROVIDER ||
          typeof record.verifier !== "string" ||
          typeof record.appState !== "string"
        )
          return undefined;
        return {
          iss: PROVIDER,
          verifier: record.verifier,
          appState: returnPath(record.appState),
          authMethod: { method: "none" },
          dpopKey: await JoseKey.fromJWK(JSON.parse(record.dpopJwk)),
        };
      },
      // Reading atomically consumes the browser-bound flow in Access.take().
      async del() {},
    },
    sessionStore: {
      async get(did) {
        return sessions.get(did);
      },
      async set(did, value) {
        sessions.set(did, value);
      },
      async del(did) {
        sessions.delete(did);
      },
    },
  });
  return { client, sessions };
}

export async function resolveIdentity(
  env: Env,
  identifier: string,
): Promise<Identity> {
  const { client } = oauthClient(env, "");
  const identity = await client.identityResolver.resolve(identifier, {
    noCache: true,
  });
  if (
    identity.handle === "handle.invalid" ||
    !identity.didDoc.service?.some(
      (service) =>
        [identity.did + "#atproto_pds", "#atproto_pds"].includes(service.id) &&
        service.serviceEndpoint === PROVIDER,
    )
  )
    throw new InputError("Choose an account hosted on Delve");
  return { did: identity.did, handle: identity.handle };
}

export async function localSession(
  request: Request,
  env: Env,
): Promise<Identity | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return null;
  const record = await env.ACCESS.getByName(
    "session:" + (await digest(token)),
  ).read();
  if (
    !record ||
    record.kind !== "session" ||
    typeof record.did !== "string" ||
    typeof record.handle !== "string"
  )
    return null;
  return { did: record.did, handle: record.handle };
}

export async function login(request: Request, env: Env) {
  const nonce = randomToken();
  const { client } = oauthClient(env, await digest(nonce));
  const url = await client.authorize(PROVIDER, {
    state: returnPath(new URL(request.url).searchParams.get("returnTo")),
    scope: "atproto",
  });
  if (url.origin !== PROVIDER)
    throw new Error("Authorization destination refused");
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.href,
      "Set-Cookie": setCookie(FLOW_COOKIE, nonce, FLOW_MS / 1000),
    },
  });
}

export async function callback(request: Request, env: Env) {
  const nonce = cookie(request, FLOW_COOKIE);
  const params = new URL(request.url).searchParams;
  if (
    !nonce ||
    params.get("iss") !== PROVIDER ||
    ["state", "code", "iss"].some((key) => params.getAll(key).length !== 1)
  )
    throw new InputError("Sign-in expired or invalid; start again");
  const { client, sessions } = oauthClient(env, await digest(nonce));
  let providerSession: OAuthSession | undefined;
  try {
    const result = await client.callback(params);
    providerSession = result.session;
    const identity = await resolveIdentity(env, result.session.did);
    const token = randomToken();
    await env.ACCESS.getByName("session:" + (await digest(token))).save(
      { kind: "session", ...identity },
      SESSION_MS,
    );
    const headers = new Headers({ Location: returnPath(result.state) });
    headers.append(
      "Set-Cookie",
      setCookie(SESSION_COOKIE, token, SESSION_MS / 1000),
    );
    headers.append("Set-Cookie", setCookie(FLOW_COOKIE, "", 0));
    return new Response(null, { status: 303, headers });
  } catch {
    return new Response(
      "Sign-in failed or expired. Return to the room app and try again.",
      {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Set-Cookie": setCookie(FLOW_COOKIE, "", 0),
        },
      },
    );
  } finally {
    try {
      await providerSession?.signOut();
    } catch {
      /* Provider tokens are discarded even if revocation is unavailable. */
    }
    sessions.clear();
  }
}
