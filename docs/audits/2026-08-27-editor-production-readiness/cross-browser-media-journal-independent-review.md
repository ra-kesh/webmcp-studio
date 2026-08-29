# Cross-browser media journal independent review

Date: 2026-08-30

Scope: row 10, Slice 3A IndexedDB schema version 5, local promotion journal,
lease and revision ownership, and the local asset repository database-open
refactor. This review does not accept the promotion network owner, active
document relink, admission recovery, browser journeys, or deployed behavior.

## Material read

- The complete `cross-browser-media-phase-entry.md`, including its invariants,
  Slice 3 gate, IndexedDB acceptance matrix, and completion limits.
- `media-01-implementation-audit.md`,
  `media-01-browser-independent-review.md`,
  `media-01-browser-acceptance.md`, and row 10 of
  `remaining-product-work-2026-08-29.md`.
- The complete current implementations of `local-asset-database.ts`,
  `local-asset-promotion-journal.ts`, its focused test, and the
  `local-asset-store.ts` database-open refactor.

## First-pass findings

### P1: network-capable states did not prove a persisted content checkpoint

The first reviewed schema allowed `reconciling`, `uploading`, and
`status_unknown` while `contentSha256` was null. It also allowed a managed
tuple or relink result in unrelated earlier states. The generic claim and CAS
API could move a released `complete` record backwards without going through
the explicit completed-operation supersession path.

That record was structurally parseable but could not prove the required
ordering, hash exact bytes, store the hash and stable request identity, then
start reconciliation or upload. It also weakened the promise that a mapped
operation resumes at relink instead of uploading again.

Status at final pass: repaired. The schema now requires the plain local content
hash in every network and mapped state, limits the managed tuple to conflict or
mapped states, requires equality for usable mappings and inequality for an
alias conflict, limits editor relink receipts to relinking or complete, and
limits the durable draft receipt to complete. Claim, renewal, and generic CAS
refuse a completed record. A new document must use the exact
`supersedeCompletedRevision` path, which preserves the mapping and clears only
the old document result.

### P1: the stored idempotency key was wider than the HTTP contract

The first reviewed journal accepted any 1 to 256 character identity. The
promotion HTTP boundary accepts only 1 to 128 ASCII letters, numbers, dots,
colons, underscores, or hyphens. A record containing a space, Unicode, or a
129 to 256 character value could therefore parse as resumable while every
network retry rejected its promised stable key.

Status at final pass: repaired. `mediaIdempotencyKeySchema` now lives in the
shared document media contract. The Worker validator and journal both use it,
and creation parses the key before opening IndexedDB. Invalid stable keys
therefore fail before a record can be written.

## Accepted behavior from the first pass

- Schema version 5 adds only the promotion-journal store. It leaves the legacy,
  metadata, Blob, and quarantine stores intact and retains the existing
  metadata indexes.
- Journal reads distinguish missing, ready, and corrupt records. A corrupt
  journal neither deletes nor hides a healthy metadata and Blob pair.
- Creation stores the source document, content, history, draft record, draft
  snapshot, local asset revision, and sorted reference set in one IndexedDB
  transaction before any later network owner can begin.
- Every mutation reads and writes in one read-write transaction. It requires
  the exact revision. Owner mutations also require the exact live owner and
  lease token.
- The finite lease is bounded to one second through five minutes. A takeover
  increments the revision and changes the token, so the late owner cannot
  publish progress after expiry.
- A completed mapping can be reused for another document only with the exact
  completed revision and no live lease. The new operation starts at `mapped`,
  keeps the managed identity and content hash, and clears the old relink and
  durable-draft result.
- BroadcastChannel carries only a parsed alias and revision hint. IndexedDB
  remains authoritative. Construction or publication failure is best effort
  and cannot turn an already committed checkpoint into an apparent failure.
- A blocked version upgrade fails with a direct close-the-other-tab message.
  Once the blocking v4 connection closes, a retry creates v5 and proceeds.
- Synchronous journal-write failure aborts the transaction and returns
  `local_promotion_checkpoint_failed` with no record. An independent injected
  asynchronous abort produced the same error and left the journal missing,
  confirming that the promise settles after abort acknowledgement rather than
  allowing an overlapping owner.

## Evidence run

The independent reviewer used Node 24.19.0.

- Focused journal plus local asset repository tests: 33/33 passing after both
  repairs.
- Focused shared document media tests: 8/8 passing.
- `@webmcp/document` and `@webmcp/studio` typechecks: passing after both
  repairs.
- `git diff --check`: passing after both repairs.
- Manual blocked-upgrade probe: v5 open rejected while a v4 connection ignored
  `versionchange`; after closing v4, the exact retry created a queued revision
  1 journal.
- Manual asynchronous-transaction-abort probe: returned
  `local_promotion_checkpoint_failed`; exact read returned `missing`.

## Final verdict

**ACCEPT for row 10 Slice 3A. No P0 or P1 remains in the reviewed journal and
database boundary.**

This verdict is intentionally narrow. It accepts the durable local checkpoint
and ownership mechanism that the next promotion owner can use. It does not
claim that refresh, cancellation, timeout, network-loss reconciliation,
document relink, or a second browser works yet.

## Nonblocking P2 and next-slice obligations

- The blocked-upgrade and asynchronous-abort cases passed independent probes,
  but they are not yet retained as automated tests. Add them before the full
  Slice 3 exit gate so future IndexedDB refactors cannot silently weaken them.
- `readJournalValue` and `mutateJournal` close the database on normal
  completion and transaction abort. A synchronous `database.transaction(...)`
  setup failure in an already-versioned but structurally malformed database
  rejects through the Promise executor without explicitly closing the opened
  handle. This needs defensive cleanup before malformed-database recovery is
  called complete.
- The journal validates each persisted state, exact revision, lease and
  completed-state barrier. It is not the promotion workflow transition table.
  The next owner must enforce directional transitions, increment attempts
  before upload, reconcile before any retry from `status_unknown`, and resume
  `mapped` or `relinking` without another upload.
- Keep BroadcastChannel advisory. A subscriber must reread IndexedDB and must
  never apply the event payload as promotion state.
