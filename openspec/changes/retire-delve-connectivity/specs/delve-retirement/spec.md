## ADDED Requirements

### Requirement: Retired connectivity surface

The deployment SHALL return HTTP 410 for all requests to
`pastebin-app.xware.online` and for `/r/` paths on `pastebin.xware.online`.
The response SHALL identify the retirement and link to the general pastebin.
The deployment SHALL NOT expose Delve identity resolution, OAuth metadata,
OAuth initiation or callbacks, authentication APIs, or room operations.

#### Scenario: Visit an existing room or sign-in link

- **WHEN** a client requests a room, authentication, asset, or API path on the
  retired application origin
- **THEN** the response has status 410 and does not redirect to Delve
- **AND** the response clears the application's host-only authentication cookies
- **AND** no outbound Delve request is made

#### Scenario: Visit a room link on the editor origin

- **WHEN** a client requests a path under `/r/` on `pastebin.xware.online`
- **THEN** the response has status 410 rather than forwarding to a room service

### Requirement: Preserve general pastebin service

The deployment SHALL retain the independent editor and the native backend at
`pastebin.xware.online` and `/native/`. Both interfaces SHALL omit navigation to
the retired room service. Retirement SHALL preserve native paste data, stored
IPFS blocks, browser-local paste data, native origin authentication, and the
Cloudflare Tunnel.

#### Scenario: Use the editor after retirement

- **WHEN** a visitor saves and shares a local paste
- **THEN** browser persistence and fragment-based sharing remain available
- **AND** no room or Delve sign-in navigation is offered

#### Scenario: Read a persistent native paste after restart

- **WHEN** the native service restarts with room navigation removed
- **THEN** an existing paste and its stored content remain readable
- **AND** the native pages link back to the editor without advertising rooms

### Requirement: Honor existing expiry schedules

The deployment SHALL retain the `Room` and `Access` Durable Object classes and
bindings solely to service expiry alarms. The classes SHALL expose no active
room or authentication operations. Retirement SHALL NOT delete namespaces or
extend the deadlines stored in existing objects.

#### Scenario: An existing object reaches its deadline

- **WHEN** an expiry alarm runs at or after the stored deadline
- **THEN** its live stored data is deleted

#### Scenario: An alarm runs before the deadline

- **WHEN** an alarm runs before the object's stored deadline
- **THEN** cleanup is scheduled for that same deadline
- **AND** the retirement does not make the stored contents publicly accessible
