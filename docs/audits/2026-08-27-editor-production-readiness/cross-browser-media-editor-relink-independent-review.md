# Cross-browser media editor relink — independent review

Date: 2026-08-30
Reviewer: independent code-review agent
Scope: Slice 4 mounted editor, exact relink/history, durable draft receipt,
managed Recent reconciliation, local Media UI, session ownership, and recovery
through the Slice 4 boundary.

## Final verdict

**ACCEPT**

The frozen Slice 4 tree has no open P0 or P1 finding in this review. A healthy
local image can be mapped once, relinked through one exact history result or an
exact target-only replay, durably read back, reconciled into managed Recent
with one stable receipt identity, and recovered without publishing into a
stale mounted editor.

This verdict does not admit Slice 5 recovery-entry work and does not claim the
deployed/two-browser evidence reserved for Slice 6.

## Material reread before review

The review reread the frozen phase contract and entry evidence before checking
the implementation:

- `cross-browser-media-editor-relink-phase-map.md`
- `cross-browser-media-phase-entry.md`
- the Slice 1, server, journal, owner, and use-receipt independent reviews in
  this audit directory
- the recorded OpenPencil/Loora mapping: OpenPencil for interaction fidelity;
  Loora's `react.tsx`, transaction engine, command/tool vocabulary, capture,
  persistence, and ownership patterns for gesture, command, durable-operation,
  and renderer discipline

## Code reviewed

Every changed Slice 4 production surface and its focused tests was inspected:

- `active-local-asset-promotion.ts` and its tests
- `document-draft-save-controller.ts` and its tests
- `local-asset-database.ts`, `local-asset-store.test.ts`, and the promotion
  journal migration tests
- `local-asset-promotion-journal.ts` and its tests
- `local-asset-promotion-owner.ts` and its tests
- `local-asset-relink-projection.ts`
- `asset-library-components.tsx` and its model/DOM focus tests
- `asset-library-dialog.tsx` and its projection tests
- `use-document-editor.ts` and the dedicated mounted promotion harness
- `studio-shell.tsx`

## Accepted contract evidence

### One owner and an immutable anchor

- `LocalAssetPromotionStartGate` reserves synchronously before journal reads,
  draft flushes, Blob reads, hashing, or owner installation
  (`active-local-asset-promotion.ts:20`).
- The mounted hook captures document/history/operation/session/draft/local
  revision/reference coordinates and revalidates them before admitting the
  owner and again before the synchronous relink
  (`use-document-editor.ts:5059-5579`).
- Lease ownership is reasserted after delayed validation and before document
  mutation. Exact source, exact target-only, and conflict outcomes use the
  canonical reference extractor/projection, not source absence alone
  (`local-asset-relink-projection.ts:9-78`).

### One truthful history result

- A source relink uses one `relink_asset_references` command through
  `commitCommandsWithResult`; the returned commit ID and `undoable` value are
  checkpointed. An exact target-only replay records `already_applied`, a null
  commit, and `undoable: false` (`use-document-editor.ts:5459-5619`).
- Current Undo copy is derived only from an exact completed relink commit still
  present in `history.past`; persisted/reloaded completion does not invent an
  Undo promise (`local-asset-relink-projection.ts:15-24`,
  `use-document-editor.ts:7928-7952`).

### Durable flush and exact read-back

- `flushWithReceipt` drains the ordered controller and samples document ID,
  record version, content snapshot, draft snapshot, and saved timestamp in one
  result. Failed, conflicted/pending, and closed sessions cannot return a
  success receipt (`document-draft-save-controller.ts:220-252`).
- The mounted relink retry enters the non-cancellable `saving` phase, retries a
  retained failed capture without a second history command, reads the stored
  envelope back, compares every receipt coordinate, re-derives its content
  hash, and verifies the exact managed target with no remaining local source
  (`use-document-editor.ts:5632-5693`).
- The critical boundary ends only after that durable proof. `updating_recent`
  no longer blocks editing/navigation/dialog close
  (`use-document-editor.ts:5420-5456`, `asset-library-dialog.tsx:366-369`).

### Crash-safe journal, lease, and Recent

- Journal invariants distinguish relinking intent, relink result,
  `marking_used`, and complete server receipt; the managed tuple, hash, exact
  result, durable receipt, and Recent receipt are state-validated
  (`local-asset-promotion-journal.ts:43-350`).
- Released source/target re-anchors and deterministic conflicts use exact
  revision CAS. Completed supersession keeps the upload mapping while issuing
  a new Recent key; unrelinked/result recovery retains the prior key
  (`local-asset-promotion-journal.ts:821-1025`, `:1033-1069`).
- The active owner serializes lease renewal and journal updates. It drains the
  heartbeat before terminal completion, writes the durable receipt before
  `/used`, and writes complete only after the authoritative use receipt
  (`active-local-asset-promotion.ts:194-280`, `:516-576`).
- Retry after an ambiguous use response or receipt-before-complete-CAS loss
  reuses the same Recent identity and performs no second relink/flush/upload
  (`active-local-asset-promotion.test.ts:501-578`).

### Mounted session and presentation ownership

- Progress and final publication require the exact operation token, session
  object, generation, and document. Route transitions detach token-fenced live
  presentation so A -> B -> A cannot resurrect a dead operation
  (`use-document-editor.ts:1354-1410`, `:5395-5458`, `:5723-5814`).
- `saving` blocks mutation and document transitions with specific copy.
  `updating_recent` releases those blocks while the durable owner continues.
- Critical unmount waits for the promotion's durable settlement before closing
  the controller/releasing the persistence lease, eliminating the
  `flushWithReceipt` versus teardown-close race
  (`use-document-editor.ts:2739-2790`, `:5380-5391`).
- The mounted harness proves rapid double start, deferred preflight Cancel,
  route/unmount fencing, critical transition blocking, post-receipt transition,
  critical unmount with a real deferred repository save/read-back, failed-save
  retry without a second relink, durable target conflict, and exact target
  re-anchor (`use-document-editor.local-asset-promotion.mounted.test.tsx:379-1024`).

### Media UI truth

- Persisted state stores raw journals and is projected synchronously against
  the current document. An async IndexedDB refresh can no longer leak A's
  projection into B or preserve `Complete` after Undo
  (`asset-library-dialog.tsx:359-438`, `:1294-1335`).
- Durable completion supersedes a stale local failure; a current live complete
  state remains locally authoritative only to retain exact Undo copy
  (`asset-library-dialog.tsx:179-193`,
  `asset-library-dialog.test.ts:454-477`).
- A foreign live lease is displayed as non-cancellable busy only where the
  current document actually contains that local alias; expiry reprojects to a
  truthful retry. Missing Blob with a verified mapping, archived managed
  mapping, zero local references after relink, and a retained local card are
  represented without pretending the local bytes were uploaded again.
- The action uses a stable native 44 px button through Start -> Cancel ->
  Stopping -> Retry, has localized `aria-busy`, polite status/conflict alert
  semantics, exact use count, and no forced dialog close
  (`asset-library-components.tsx:260-389`,
  `asset-library-promotion-focus.test.tsx:54-94`).

## P1 findings found and repaired during this review

The initial reviewed implementation was rejected until all of these were
closed:

1. rapid starts could pass the asynchronous acquisition gap;
2. stale live completion/failure could leak across documents or reappear after
   Undo/route return;
3. late final callbacks could publish into a newly mounted session;
4. lease ownership was not reasserted at the final pre-commit boundary;
5. existing-result recovery could enter flush without a mounted critical flag;
6. `updating_recent` remained incorrectly critical;
7. persisted Undo copy trusted journal history that is unavailable after
   reload;
8. target-only crash replay and durable conflict resolution were incomplete;
9. a failed controller retry could write the relink before the critical UI
   boundary;
10. cross-document foreign leases and conflict projection were not scoped to
    current exact references;
11. Cancel did not retain a stable **Stopping…** focus target;
12. a queued heartbeat could race the terminal journal CAS;
13. raw projected persisted state could be stale while an async refresh was in
    flight;
14. unmount could close the save controller before the critical operation
    sampled its receipt;
15. a stale local terminal failure could mask a newer authoritative completion
    from another tab; and
16. the explicit server-receipt-before-complete-journal-CAS recovery test was
    missing.

All sixteen are repaired in the frozen tree and covered by focused domain,
projection, DOM, or mounted tests.

## Independent verification

Run from `apps/studio` with the bundled runtime:

```text
vitest: 9 files passed, 144 tests passed
@webmcp/studio typecheck: passed
git diff --check: passed
```

The scoped ESLint run reports five existing quotation-refresh warnings in the
large hook at lines outside the Slice 4 insertion; no reviewed Slice 4 file
adds a lint diagnostic.

## Non-blocking boundary notes

- Mounted admission is deliberately globally serialized in the current UI,
  rather than allowing parallel promotions for different aliases. This is a
  conservative throughput limitation, not a truth, durability, or ownership
  defect; other actions are visibly disabled while the bounded owner is
  active.
- Slice 5 still owns admission-time/missing-byte recovery breadth.
- Slice 6 still owes real two-browser, deployed Worker/D1/R2, network-fault,
  and production artifact evidence.
