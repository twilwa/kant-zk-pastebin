## ADDED Requirements

### Requirement: Independent paste editor
The service SHALL serve the standalone paste editor at `pastebin.xware.online`
without requiring a Delve account. Each app SHALL link to the other.

#### Scenario: Create and share a local paste
- **WHEN** a visitor saves text with no configured server
- **THEN** it persists across reloads in that browser
- **AND** a share link opens the same text in another browser context
- **AND** no paste content is uploaded to a server

#### Scenario: Host boundaries
- **WHEN** a request reaches the pastebin hostname
- **THEN** only the editor's public assets and health response are served
- **AND** a valid existing room path redirects to the room hostname
- **AND** authenticated room APIs are unavailable on the editor hostname

### Requirement: Honest sharing and deployment scope
The editor SHALL disclose that anyone holding a paste link can read its contents
and that these links have no expiry or encryption. Optional server sync SHALL
remain available only after the visitor configures a server.

#### Scenario: Self-contained deployment
- **WHEN** a visitor loads the editor and uses QR, sharing, or text splitting
- **THEN** the necessary scripts are served from this deployment
- **AND** advertised CLI downloads resolve to a complete runnable bundle
- **AND** the room host retains its restrictive content security policy
