# Quotation content drift audit

Date: 2026-08-29

Status: prevention and explicit legacy layer upgrade implemented

## Cause

- Chrome and the in-app browser hold separate persisted revisions of the same
  document ID. Chrome has revision 23 with nine nodes and no groups; the in-app
  browser has revision 18 with the same nine nodes plus four groups.
- The draft source context does not store `composerVersion` or a deterministic
  source/content fingerprint.
- Built-in quotation templates still identify themselves as template version 1
  and composer version 1 even though generated document structure changed.
- Template materialization always uses the current composer, while already
  saved documents are accepted as valid and are not structurally upgraded.
- `document.groups` defaults to an empty array, so an old flat quotation passes
  schema validation and the loader cannot distinguish legacy missing groups
  from intentionally ungrouped content.

## Affected areas

- Layers hierarchy and group membership.
- Existing quotation page structure, pagination, layer names, bindings,
  geometry, lock/visibility defaults, and later composer-generated corrections.
- Template catalog previews versus applying a style to an older document:
  previews use current composition while style application preserves the old
  structure.
- Persisted Stuwiz quotation snapshots, which do not automatically reconcile
  with newer source records.
- Browser-local uploaded images whose document references can survive while
  their bytes are unavailable in another browser.
- Any future document feature introduced through permissive schema defaults
  without a separate content-migration decision.

## Accepted remediation invariants

- Source identity, composition identity, and appearance identity are separate.
- A legacy source context stays legacy on read. Decoding must not add metadata,
  because the draft repository verifies the exact persisted body and summary
  identities before admitting a record.
- An empty group list is not evidence that a quotation is safe to migrate. The
  user may have deliberately ungrouped the document.
- Historical quotation template `@1` remains a resolvable persisted identity,
  but it must never be materialized through the current composer.
- A legacy layer-organization upgrade must be explicit, group-only, undoable,
  and blocked whenever node/page membership is ambiguous.
- Published versions are immutable. Only a draft can receive a content
  upgrade and then be published as a new version.

These invariants were checked independently against the draft admission,
template lifecycle, document schema, composer, and repository code. Loora's
explicit version/provenance boundary is the architectural reference; no Loora
code is imported.

## Prevention boundary — completed 2026-08-29

- The active quotation composer now has an explicit version, `2`.
- The three current quotation styles are immutable template version `2` values
  declaring composer `2`.
- Historical template version `1` definitions remain available for validating
  saved references, are retired from the catalog, and fail explicitly if code
  attempts to materialize them without the unavailable historical composer.
- Catalog previews and new materialization can no longer silently use a
  composer different from the template's declared composer.
- Quotation source content now has a deterministic canonical SHA-256 identity;
  object key order does not affect it and a source revision change does.
- Existing source contexts and document bytes are not rewritten by this
  boundary.

Focused evidence: document template/composer tests pass 16/16, Studio template
lifecycle/catalog tests pass 13/13, and both affected package typechecks pass.

## Quotation composition provenance — completed 2026-08-29

- Exact known source/composition identity now persists for new quotation
  template creation, quotation import, sample restore, and recovery reset.
  Visual style application preserves the original structural lineage. Legacy
  wire data continues to decode without metadata injection or rewrite.
- Define later Stuwiz source reconciliation and shared asset persistence. These
  are not implied by composition provenance.

Focused provenance evidence: Studio draft admission/current-wire/template
lifecycle tests pass 46/46, the mounted quotation-import and sample-restore
regressions pass, and Studio typecheck passes.

The independent code review initially rejected a JSON-roundtrip mismatch for
explicit optional `undefined` values. Canonical source hashing now filters them
exactly as persistence does, the reproduced regression passes, and the final
review verdict is **ACCEPT with no remaining P0/P1 finding**.

## Explicit legacy layer organization — completed 2026-08-29

- Legacy flat quotation drafts are analyzed without mutation. The upgrade is
  offered only when every composer-owned layer still has the expected identity,
  type, and page membership and no custom or partial grouping exists.
- The analyzer rejects mismatched quotation snapshots, including stale source
  variants that would leave old composer-owned nodes behind, while allowing
  clearly user-created layers to remain ungrouped.
- Available analyses are anchored to document identity and revision. Applying a
  stale analysis fails closed and requires a fresh eligibility pass.
- The user must explicitly choose **Organize layers** from Templates. Pending
  Review work blocks the action. Current known composition and already-recorded
  migrations are never silently regrouped.
- Applying changes only groups, revision, timestamp, and legacy migration
  metadata. User copy, geometry, styling, layer order, and extra layers remain
  untouched. The action is one history entry; Undo/Redo restores both the exact
  document and source-context state, and normal draft persistence survives
  reload.
- The first independent review rejected incomplete full-structure validation
  and unanchored analysis. Both defects were repaired. The final review verdict
  is **ACCEPT with no remaining P0/P1 finding**.

Focused evidence: document migration tests pass **6/6**, the Studio template and
mounted persistence slice passes **81/81**, the independent reviewer reran the
combined focused slice at **11/11**, both affected package typechecks pass,
scoped ESLint passes, and `git diff --check` passes.

## Remaining quotation data boundary

- Define Stuwiz source reconciliation for changed upstream records.
- Move browser-local uploaded-image bytes to shared persistence.
- Add separate semantic content migrations for later composer changes; schema
  defaults alone must never be treated as proof of compatibility.
