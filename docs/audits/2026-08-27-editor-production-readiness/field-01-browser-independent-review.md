# FIELD-01 browser acceptance independent review

Date: 2026-08-29

Verdict: **ACCEPT — no P0/P1 or misleading browser-acceptance claim**

## Code read

The reviewer inspected the actual browser specifications and their production
boundaries:

- Versioned current-draft decoding and migration through draft admission.
- IndexedDB document repository creation and exact durable readback.
- `/documents/:documentId` route admission and identity checks.
- Typed field definitions, controls, validation, impact navigation, deletion,
  and history restoration.
- Compact modal ownership and background inaccessibility.
- Immutable publication, API Playground parameter projection, approved asset
  identity, and private renderer-source retention.
- Browser-context isolation and the explicit server-session reset used by the
  one publication case.

## Accepted invariants

- Each fixture enters through the real versioned migration input and exact
  document route; no browser case silently mounts the retired single-document
  localStorage path.
- Durable deletion and Undo are proven against the real `draft-body` row by
  exact document ID as well as live inspection and original snapshot identity.
- Requirement is targeted as a radio, field `New` is exact beside template
  `Create new`, and compact Properties is asserted through its mounted modal
  rather than an intentionally inert background trigger.
- Off-page impact actions close the correct modal stack, select the exact node,
  activate Design, and focus the affected property.
- The publication case resets shared server state, uses the visible compact
  File menu, publishes the fixture, and proves the public request contains
  `olive-botanical` without a private `data:image` source.
- Per-test Playwright contexts isolate localStorage, sessionStorage, and
  IndexedDB. Only the publication case needs and performs server-session
  isolation.

## Bounded conclusion

The eight passing cases substantiate FIELD-01's retained browser gap: typed INR
validation, explicit required fallback, impact navigation, atomic durable
delete/Undo, compact continuity, and deterministic compact API asset-ID output.
They do not claim renderer/pixel conformance or durable deployed media-library
coverage.
