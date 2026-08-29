# MEDIA-01 browser acceptance independent review

Date: 2026-08-29

Verdict: **ACCEPT — no P0/P1 issue in the gate**

## Code read

The reviewer inspected the actual production and browser diff:

- Fabric adapter synchronization, readiness, and natural-size source checks.
- The focused source-equivalence regressions.
- Compact product-command insertion, picker focus ownership, and dialog close
  restoration.
- The shared Tabs height rule and Media dialog override.
- Current-draft migration, canonical document routing, IndexedDB readback,
  managed resource verification, upload revalidation, source-binding policy,
  and privacy-preserving local inspection in the Playwright contract.

## Accepted invariants

- `equivalentImageSources` resolves both values against one base and is used at
  every rendered-source versus document-source boundary. The remaining strict
  canonical-source comparison is correctly retained as a document race guard.
- Compact image insertion selects a persistent mounted trigger rather than an
  ephemeral submenu item, and both 320px and 390px browser cases prove Escape
  restoration.
- The Media collection list overrides the shared 32px horizontal Tabs variant
  with the same orientation modifier; its full-height triggers measure at least
  44px in both compact browser cases.
- The browser fixtures now enter through current-draft migration and the exact
  document route, and durable assertions read the IndexedDB body store.
- Managed fixtures satisfy the same MIME, bytes, dimensions, identity, and
  exact revalidation required in production. Fresh uploads enter the mocked
  authoritative repository before use.
- Source-bound replacement is correctly asserted disabled before mutation.
  Local reuse is asserted through the public layer name because
  `inspect_design` intentionally redacts browser-private local asset IDs.

## Nonblocking P2

The existing animation-frame focus restoration could theoretically race an
immediate programmatic picker reopen in that same frame. No ordinary product UI
path performs that sequence, so the reviewer did not treat it as a release or
gate blocker. A future generalized overlay-focus coordinator can own that edge
case if programmatic reopen is introduced.
