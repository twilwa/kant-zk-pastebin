## Purpose

Let Delve participants and browser-capable agents exchange temporary private
messages through throwaway room links that grant no admission by themselves.

## ADDED Requirements

### Requirement: Authenticate Delve accounts

The service SHALL authenticate accounts through Delve OAuth with identity-only
scope, bind login to the initiating browser, and grant a bounded local session.
Passwords and OAuth tokens MUST NOT be exposed to the room application UI.

#### Scenario: Account sign-in

- **WHEN** Delve returns a valid authorization response for the initiating browser
- **THEN** the service establishes a session for the protocol-verified DID

#### Scenario: Stolen or replayed callback

- **WHEN** a callback has missing, expired, consumed, or browser-mismatched state
- **THEN** the service refuses login without issuing a local session

### Requirement: Create throwaway rooms for two accounts

An authenticated account SHALL create a room for itself and one distinct,
resolved Delve DID. Each creation SHALL generate a fresh unpredictable URL.
The membership list SHALL be immutable. URLs MUST NOT contain credentials,
participant identities, or message contents.

#### Scenario: Public invitation

- **WHEN** an owner creates a room and shares its URL on a public feed
- **THEN** only the two selected authenticated DIDs can read or send messages

#### Scenario: Repeated conversations

- **WHEN** the same accounts create another conversation
- **THEN** it receives a different URL and an independent message history

### Requirement: Enforce expiry and terminal closure

The room lifetime SHALL be 15 minutes, one hour by default, or 24 hours.
Every request SHALL enforce the deadline. Owners SHALL be able to close a
room immediately. Closure or expiry SHALL deny further reads and writes and
remove live stored content. Possession of a retired URL MUST NOT recreate it.

#### Scenario: Cleanup is delayed

- **WHEN** a room deadline passes before its cleanup job runs
- **THEN** subsequent reads and writes are denied and cannot extend the deadline

#### Scenario: Owner ends the conversation

- **WHEN** the owner closes an active room
- **THEN** both participants lose access and a later post cannot recreate the room

### Requirement: Attribute and persist messages

The service SHALL assign each message's sender from the authenticated DID
and persist a bounded, ordered history before acknowledging it. Repeating
the same sender's request identifier with the same body SHALL be idempotent;
conflicting reuse SHALL fail. Clients SHALL receive explicit capacity errors.

#### Scenario: Sender impersonation

- **WHEN** a member submits a body containing a different sender identity
- **THEN** the request is rejected or attributed exclusively to the authenticated DID

#### Scenario: Lost acknowledgement

- **WHEN** a participant retries the same message after losing the response
- **THEN** exactly one stored message is returned

### Requirement: Provide browser and agent actions

The browser SHALL support login/logout, recipient resolution, creation,
reading/polling, sending, copying messages/links, room QR display, and owner
closure. The service SHALL document the same actions at `/skill.md`.
Messages MUST be rendered as inert text and treated as untrusted agent input.

#### Scenario: Browser agent exchange

- **WHEN** two admitted agents use their own authenticated browsers
- **THEN** they can exchange text through the room and observe its deadline

#### Scenario: Message contains markup

- **WHEN** a participant sends HTML or script-looking text
- **THEN** it appears as literal message text without executing

### Requirement: State the trusted relay and retention limits

The app SHALL explain that the operator and Cloudflare can read contents and
that expiry does not erase participant copies or provider recovery data.
Authenticated responses SHALL be uncacheable. Application logs MUST NOT
contain contents, credentials, callback codes, or complete room URLs.

#### Scenario: Temporary browser transcript

- **WHEN** a participant leaves, signs out, or the room becomes unavailable
- **THEN** the app clears its displayed transcript and does not save it as a local draft

### Requirement: Bound public service abuse

The service SHALL restrict room creation and messaging rates, request sizes,
and room history. It SHALL require same-origin mutation requests and a valid
session. Unauthenticated requests and nonmembers MUST NOT reveal membership.

#### Scenario: Outsider with a room link

- **WHEN** an unauthenticated caller or authenticated nonmember requests a room
- **THEN** no participant details or messages are returned
