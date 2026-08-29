# FIELD-01 real-browser acceptance

Date: 2026-08-29

Status: **8/8 focused browser journeys pass; independent code review accepts with no P0/P1**

## Boundary revisited

This gate closes the real-browser evidence retained when FIELD-01 was first
implemented. Before running it, the field audit, WF-07 path, OpenPencil variable
and binding reference, current draft repository, typed controls, publication,
and API Playground projection were reread.

The browser harness now follows the product's real ownership boundary. It
places one validated current-draft envelope in the migration input, lets Studio
move it into the multi-document IndexedDB repository, and opens the exact
`/documents/:documentId` route. Durable assertions read the admitted document
from `webmcp-studio-documents` rather than the retired Northstar localStorage
key.

## Passing interaction matrix

The two retained Playwright specifications pass **8/8** against the one
existing Studio server on port 3001:

- Invalid INR minimum and maximum drafts remain visible and block saves.
- Restoring the original valid bounds remains a no-op; changing Requirement is
  what enables Save.
- Optional-to-required fallback requires explicit confirmation before replacing
  a bound empty value.
- Contract-change and deletion impact actions close their modal stack, navigate
  to the exact off-page layer, select it, switch to Design, and focus its
  affected property.
- Deleting a field removes its definition, value, and two bindings atomically;
  one Undo restores the original snapshot and durable repository state.
- Compact Properties remains open while binding navigation changes the active
  page and selection.
- Field creation rejects invalid currency bounds, and its `New` action remains
  unambiguous beside the template catalog's `Create new` action.
- Compact File → Publish → API Playground publishes a deterministic approved
  asset field, displays Olive botanical, emits
  `"hero_asset": "olive-botanical"`, and exposes no private `data:image` source
  in the public request body.

## Stale harness assumptions removed

The repaired suite records product semantics instead of fighting them:

- Requirement is a radiogroup, so the contract targets the `Required` radio.
- A modal dialog makes its background trigger inaccessible. Continued dialog
  visibility proves compact Properties stayed open; querying its inert trigger
  would assert the opposite accessibility rule.
- Exact action names distinguish field `New` from template `Create new`.
- Dev-route hydration has a startup allowance without weakening individual
  locator expectations.

## Retained dependency

FIELD-01 is browser-accepted. The approved built-in catalog is intentionally
static. Durable uploads, a reusable workspace asset library, stable shared
availability, retry/progress, quota behavior, and reference-safe deletion remain
MEDIA-01 rather than hidden FIELD-01 scope.

## Independent code review

The reviewer read both browser specifications and the production migration,
route admission, repository, typed control, publication, and public asset
projection paths. The verdict is **ACCEPT with no P0/P1 and no misleading
browser-acceptance claim**. The review confirmed exact document identity,
durable delete/Undo readback, truthful roles and modal assertions, isolated
browser storage, explicit server-session isolation for publication, and the
public-ID/private-source boundary. `field-01-browser-independent-review.md`
retains the evidence and scope.
