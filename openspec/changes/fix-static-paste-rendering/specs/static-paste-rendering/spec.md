# Static paste rendering

The static editor must display paste-controlled strings literally while
preserving the existing editing and sharing actions.

## ADDED Requirements

These requirements apply to shared-link fields, stored records, sync response
fields, QR titles, and values used by paste action buttons.

### Requirement: Paste fields remain inert

The editor MUST render paste titles, identifiers, and IPFS metadata as text.
Values inserted into HTML attributes MUST remain within their attribute.

#### Scenario: Open a shared paste containing markup

- GIVEN a shared-link title and IPFS field containing HTML and event handlers
- WHEN the editor loads the link
- THEN the fields appear literally and no supplied element or handler executes

#### Scenario: Save and reopen a local paste

- GIVEN a paste title containing markup, quotes, and Unicode
- WHEN the user saves, views, reloads, and deletes the paste
- THEN the title remains literal and the stored paste follows those actions

### Requirement: Action arguments preserve data

Paste action buttons MUST preserve quotes, backslashes, newlines, markup, and
Unicode in string arguments without interpreting them as executable code.

#### Scenario: Open a QR dialog

- GIVEN a stored paste with quotes and markup in its title and remote identifier
- WHEN the user opens its QR dialog
- THEN the title remains literal, the QR canvas renders, and the share action
  contains valid string arguments
