# PERSIST-01B corruption-tolerant list independent review

Date: 2026-08-28
Scope: `persist-01b-repository-gap-contract.md` cases 10 through 15 only
Final caller re-review: 2026-08-28
Verdict: **APPROVE, no P0, P1, or P2 remains in this bounded slice**

## Resolved finding

### Prior P1: the mounted Start caller discarded successful list recovery items

Status: **resolved**.

Current evidence:

- `apps/studio/src/features/editor/use-document-editor.ts:216-237` converts a
  nonempty recovery page into explicit unreadable-document language and
  distinguishes records moved to recovery from records retained because a safe
  move failed.
- `apps/studio/src/features/editor/use-document-editor.ts:940-984` consumes
  `listed.page.recoveryItems`, persists the resulting warning in
  `repositoryRecoveryWarningRef`, and combines it with later list or migration
  warnings. An empty later page does not erase already reported recovery.
- The corrupt-only projection keeps `currentDraft: null`; Continue therefore
  remains unavailable while Create can still produce a separate durable
  document. It no longer looks like a clean first-use repository because the
  persistent warning names the unreadable document and recovery outcome.
- The mixed projection keeps the healthy current draft and its exact Continue
  path while displaying the unrelated recovery warning. It does not mark the
  healthy document unsaved or block it because another record is corrupt.
- Quarantine IDs and raw bytes remain durable in the repository. The current
  bridge does not claim that it deleted or repaired them. The full quarantine
  inventory and per-record download actions remain owned by the later
  PERSIST-01B library controller, outside this bounded compatibility repair.

Mounted proof:

- `use-document-editor.persistence.mounted.test.tsx:480-525` proves corrupt-only
  recovery remains visible, Continue is false, no durable save is claimed for
  the private bootstrap, Create remains available, and the warning survives
  that later repository activity.
- `use-document-editor.persistence.mounted.test.tsx:527-576` proves mixed
  recovery retains the healthy current draft, Continue opens the exact
  document, local save remains `saved`, and the warning remains visible after
  the later open/touch list activity.

## Repository implementation verified

No P0, P1, or P2 defect was found in the bounded repository mechanics.

### Healthy limit and cursor

- `document-draft-repository.ts:1057-1103` parses every index-visible row,
  records invalid metadata independently, and increments the requested count
  only for healthy rows that satisfy the active/deleted/query predicate.
- `document-draft-repository.ts:3112-3164` scans to `limit + 1` healthy matches,
  derives `nextCursor` from the last returned healthy summary, and reports
  corrupt observations separately.
- `document-draft-repository.test.ts:1928-2014` proves healthy page filling,
  continuation without duplicates, exact body/metadata/preview quarantine,
  and one event.
- `document-draft-repository.test.ts:2016-2092` proves two corrupt rows around
  equal-activity cursor boundaries consume no healthy limit and do not hide or
  duplicate later healthy rows.

### Guarded quarantine and retained failure

- `document-draft-repository.ts:3210-3279` re-reads the current body and
  metadata after the list transaction, compares the exact metadata
  observation, validates the current pair, and then calls the existing guarded
  quarantine transaction.
- `document-draft-repository.ts:3789-3852` re-reads both rows inside the
  read-write transaction and removes body, metadata, and preview only when both
  observations still match. The event is emitted only after commit and only
  when active rows were removed.
- `document-draft-repository.failures.test.ts:256-349` proves quarantine
  transaction failure preserves raw bytes, returns healthy rows with
  `status: "retained"`, creates no quarantine row, and emits no event.
- `document-draft-repository.failures.test.ts:351-437` proves a healthy pair
  that supersedes the list observation is retained, omitted from recovery, and
  returned on refresh.

### Sparse-index sweep and checkpoint

- `document-draft-repository.ts:1105-1162` scans the primary-key store in
  batches and records malformed or key-mismatched metadata omitted from the
  activity index.
- `document-draft-repository.ts:3170-3207` runs the sweep only for a first-page
  request, reads and advances the persisted primary-key checkpoint in one
  transaction, limits each batch to 50 rows, resets the checkpoint at the end,
  and records completion time.
- Indexed observations and sweep observations are deduplicated by exact primary
  key and metadata before recovery.
- `document-draft-repository.test.ts:2094-2149` proves a 51-row sparse set is
  handled as 50 then 1, with exact checkpoints and eventual quarantine.
- `document-draft-repository.test.ts:2151-2180` proves a non-string primary key
  is neither coerced nor deleted and is returned as retained recovery.

### Event and active-document semantics

- `document-draft-repository.ts:572-621` accepts a quarantine event only with
  nonempty document, quarantine, and session IDs.
- `document-draft-repository.failures.test.ts:1077-1110` proves valid inbound
  delivery and malformed quarantine-ID rejection.
- Successful quarantine emits exactly one post-commit event. Superseded and
  retained failures emit none.
- `use-document-editor.ts:1082-1131` treats a foreign quarantine for the active
  document as an external deletion boundary, preserves the open in-memory
  document, removes the durable-save claim, and does not refresh it away.
- `use-document-editor.persistence.mounted.test.tsx:1579-1624` proves that
  active-document bridge.

## Final gates

Using Node `v24.19.0`:

- `document-draft-repository.test.ts`
- `document-draft-repository.failures.test.ts`
- `use-document-editor.persistence.mounted.test.tsx`

Original repository and caller gate: **3 files, 92 tests passed**.

Final focused caller gate:

- `use-document-editor.persistence.mounted.test.tsx`: **1 file, 39 tests
  passed**.
- Studio `tsc --noEmit`: **passed**.
- Report Prettier and diff checks: **passed**.

The final mounted gate directly exercises successful nonempty recovery pages
through the Start caller. The bounded corruption-tolerant list slice is
approved.
