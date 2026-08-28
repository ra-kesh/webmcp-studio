# Stuwiz quotation composition

## Decision

Studio does not receive a list of designed pages from Stuwiz. It receives one
versioned quotation snapshot and materializes as many pages as the content
requires. A template is a visual policy applied to that snapshot, not a second
copy of the business data.

This follows the existing Stuwiz quotation renderer: canonical arrays become
semantic sections, semantic sections are measured and packed, and the renderer
owns typography, spacing, page chrome, and visual hierarchy.

## End-to-end flow

1. Stuwiz owns quotation editing, validation, quote number/version, expiry, and
   the organization branding snapshot.
2. Stuwiz calls `POST /v1/studio/quotation-compositions` with contract version 1,
   an immutable quotation revision, and a requested template ID.
3. Studio validates the whole request before composing anything. Unknown or
   malformed data is rejected; no fields are silently dropped.
4. The composer turns participants, events, packages, coverage, deliverables,
   timelines, payment milestones, and terms into ordered semantic blocks.
5. Blocks are measured against the page content area. When the next block does
   not fit, Studio creates another page with the same header/footer system.
6. The materialized pages open in the editor. Templates are selected from the
   left rail; pages are navigated in the bottom horizontal filmstrip.
7. Changing the template recomposes the same source revision. Content order and
   page count remain deterministic while color, typography, surface, and chrome
   change.
8. The materialized document can be edited, published as a template version, or
   rendered through the existing output API.

## Ownership boundary

Stuwiz owns:

- quotation identity, revision, number, version, date, and validity
- participant contact snapshots
- events and tentative/fixed timing
- packages, coverage, deliverables, recommendation, and prices
- delivery timelines, three payment milestones, and fixed terms
- organization identity and contact/tax branding snapshot

Studio owns:

- template catalog and template versions
- semantic composition rules
- page dimensions, margins, pagination, and continuation behavior
- typography, color, spacing, borders, surfaces, page header/footer, and cover
- the editable scene graph and final render artifacts

Studio must never require Stuwiz to pre-compute page breaks or send coordinates.
Stuwiz must never depend on a particular template's current page count.

## Contract

The executable Zod contract is
[`quotation-contract.ts`](../packages/document/src/quotation-contract.ts). Its
top-level payload contains:

- `contractVersion: 1`
- `source.type: "stuwiz.quotation"`
- `source.quotationId` and non-negative `source.revision`
- immutable quote display metadata
- a branding snapshot
- `QuotationDocumentV1`

The document mirrors the current Stuwiz domain limits: up to 10 participants, 50
events, 10 packages, 50 coverage rows per package, 100 deliverables per package,
50 delivery clauses, exactly three payment rows, and 50 fixed terms.

The composition request adds `templateId`. The response returns source identity,
resolved template identity, derived `pageCount`, and the editable canonical
Studio `Document`.

## Determinism and revisions

For the same source revision, template version, composer version, and font
metrics, composition must return stable ordering and page breaks. When Stuwiz
sends a later revision, Studio should create a new composition revision rather
than mutating a previously accepted or rendered artifact in place.

The challenge implementation uses stable page IDs by page index so template
switching preserves the currently selected page. Production persistence should
also record the source payload hash, composer version, and template version.

## Editor behavior

- The left rail is for templates and layers. It is not a vertical page outline.
- The bottom filmstrip is the page navigator and scrolls horizontally like a
  photo gallery.
- The active page remains a full editable canvas.
- Template switching is disabled for arbitrary documents that have no quotation
  source, preventing accidental replacement with demo data.
- A composed quotation is allowed to have any valid derived page count.

## Current implementation and next production step

The current implementation composes a realistic non-private fixture through the
same contract used by the endpoint. It proves variable pagination, template-only
style switching, and editor navigation.

Before connecting production Stuwiz, add authenticated service-to-service
credentials, idempotency keyed by quotation ID + revision + template version,
payload-hash persistence, and a stored composition resource that the editor can
reopen without relying on browser storage.
