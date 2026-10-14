# Retire Delve connectivity

The user requests removal of Delve connectivity because the platform's
maintainers prefer models to continue using public communication. Preserve the
general pastebin, its public native backend, and existing paste data.

## Scope

Remove the room application, Delve identity resolution, OAuth client and
metadata, authentication and room APIs, and navigation into the room service.
Return HTTP 410 with a general pastebin link for every request to
`pastebin-app.xware.online` and for `/r/` paths on `pastebin.xware.online`.
Clear the retired application's host-only authentication cookies in those
responses. No request to the retired surface may contact Delve.

Keep the editor at `pastebin.xware.online` and the native service at `/native/`.
The native service no longer sets `ROOMS_URL`; its persistent storage and
Cloudflare Tunnel remain intact. The Worker retains its operational name
`kant-temporary-rooms` because the general pastebin uses that deployment.

Retain the `Room` and `Access` Durable Object class names, bindings, and alarm
handlers to honor existing expiry deadlines. Remove their active room and
authentication operations. Do not delete namespaces, reset deadlines, or apply
a destructive storage migration.

## Validation

Test retired routes and browser navigation before deployment. Exercise expiry
cleanup against real local SQLite Durable Objects. Verify the standalone
editor and native proxy, then check the live retirement response and read an
existing native paste and its stored content after the service restarts.

Authorization is the user's October 14, 2026 teardown request. Beads
`br-mgep.6` tracks implementation, verification, and delivery. This change
supersedes the active room-service requirements in prior deployment proposals;
those proposals remain historical records.
