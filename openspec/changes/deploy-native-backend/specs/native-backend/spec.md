## ADDED Requirements

### Requirement: Persistent isolated native service

The deployment SHALL run the native Rust backend with persistent application
data and a resource-limited container isolated from CI credentials and jobs.

#### Scenario: Container restart

- **WHEN** a paste is saved and the container restarts
- **THEN** the paste and its stored IPFS blocks remain readable

### Requirement: Reproducible public dependency sources

The backend SHALL build from pinned, publicly reachable dependencies without
requiring upstream's private filesystem or Nora registry.

#### Scenario: Build on the CI host

- **WHEN** the container build uses the committed lockfile
- **THEN** it produces the native server without upstream-local paths

### Requirement: Preserve existing entrypoints

The deployment SHALL retain the standalone editor and Delve room service.

#### Scenario: Native backend release

- **WHEN** a user opens either existing entrypoint
- **THEN** the editor and room functionality remain available

### Requirement: Verify public exposure

The backend SHALL remain private until its public request boundary is verified
against filesystem access and active-content injection.

#### Scenario: Unverified native route

- **WHEN** a route has an unresolved exposure risk
- **THEN** public requests cannot reach it
