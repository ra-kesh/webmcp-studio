# REVIEW-02 durable review journal phase entry

Date: 2026-08-29

Status: **completed and independently accepted for the REVIEW-02 boundary**

## Outcome

Turn the current one-pending/one-last Review panel into an auditable review
journal that survives document reloads without moving review data into the
rendered document or allowing an agent to approve its own proposal.

## Evidence reread

- REVIEW-02 in the production backlog and the Review row in the retained
  feature-parity audit.
- The existing document `ChangeSet` validation/preview/apply path,
  `useDocumentEditor` Review owner, persisted draft envelope/repository, and
  Review panel.
- WEBMCP-01C's bounded receipt and deterministic proposal identity contract.
- Loora's typed transaction metadata and shared human/agent operation engine.
  Studio keeps its own document and Review model; no Loora code is imported.

## Product contract

- Add bounded provenance to each proposal: source, actor label, tool name,
  optional reason/request identity, and existing creation/base identity.
- Derive a bounded set of affected pages, layers, fields, groups, and outputs
  from the same canonical commands being reviewed. Store stable labels so a
  resolved deletion remains understandable.
- Persist one pending review plus the latest 50 resolved reviews inside the
  durable draft envelope. Review bytes affect the draft snapshot, not the
  canonical content snapshot or published/rendered document.
- Operation decisions, proposal creation, discard, and apply update the journal
  synchronously before autosave capture. Reload restores the exact pending
  decisions and resolved history.
- Applying records the resulting document revision/snapshot and accepted versus
  rejected operation IDs. Discarding records a rejected resolution without
  mutating document content.
- The Review panel shows provenance, affected targets, and resolved history.
  Existing affected layers can be focused through the canonical selection/page
  path; removed or missing targets remain readable but disabled.
- WebMCP proposal handlers attach their actual tool identity. Review acceptance
  and rejection remain human-only.

## Deliberate limits

- This slice is local durable review history for the current document. Server
  collaboration, comments/threads, named authenticated teammates, and cross-
  device synchronization remain later work.
- The journal is capped at 50 resolved entries and 100 affected targets per
  entry. It is audit context, not an unbounded event log.
- No Review data enters immutable template versions, PNG/PDF output, or the
  canonical document schema.

## Gate

Focused journal, envelope/repository, editor Review, WebMCP, and mounted panel
tests; three affected package typechecks; scoped lint/format; one live reload
journey; independent code review; ledger update; one phase commit.

## Completed implementation

- Added a versioned, bounded Review journal with one pending proposal and the
  latest 50 resolved entries. Each entry records source, actor, tool, reason,
  request identity, affected targets, per-operation decisions, and exact result
  revision/snapshot identity.
- Kept Review data outside the canonical document and render outputs. Non-empty
  journal state changes the durable draft snapshot without changing the content
  snapshot; empty legacy drafts retain their existing byte identity.
- Persisted Review state through durable creation, save, rename, admission, and
  current-draft migration. Duplicate and conflict-copy flows intentionally
  reset Review history because they create a new document identity.
- Restored the pending proposal's base snapshot into a fresh history owner on
  reload, preserving conflict detection and operation decisions.
- Added provenance, affected-target navigation, missing-target handling, and
  resolved history to the Review panel. Navigation is evaluated against the
  preview document while operation details remain canonical.
- Attached each WebMCP proposal to the actual invoking tool and optional reason
  and request identity. Apply and discard remain human-owned actions.

## Acceptance

- The first independent code review rejected the candidate with three P1
  findings: durable creation omitted the journal, target availability used the
  canonical document instead of the preview, and persisted journal identity
  was not bound to the document/revision or restored history snapshot.
- Each finding received a production repair and a focused regression. The
  final re-review verdict is **ACCEPT with no remaining P0/P1 blocker**.
- Focused Studio evidence passes **176/176 across seven files**, including the
  full mounted persistence suite; WebMCP registration passes **36/36**. The
  Document, WebMCP, and Studio typechecks, scoped ESLint, Prettier, production
  Studio build, and `git diff --check` pass.
- The live clean-copy journey proposed a field preview through WebMCP, observed
  an all-saved state, reloaded with the proposal/provenance intact and no
  conflict, discarded it through Review, then reloaded again. The resolved
  reason, `propose_field_updates` identity, discarded status, and distinct
  field/layer targets remained visible.
