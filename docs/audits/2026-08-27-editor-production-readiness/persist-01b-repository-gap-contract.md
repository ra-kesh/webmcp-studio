# PERSIST-01B repository gap contract

Date: 2026-08-28
Status: implementation-ready addendum; no product or test code changed

## Scope

This addendum closes only the first delivery slice in `persist-01b-phase-entry.md`:

1. save one durable conflict candidate as a new document and resolve that conflict in the same transaction;
2. keep healthy list rows visible when another metadata row is corrupt.

Routes, React state, and document-library UI are outside this contract.

## Current repository facts

The existing database already has the required stores:

- `draft-body`, keyed by `documentId`;
- `draft-meta`, keyed by `documentId`, with compound `activityAt + documentId` ordering;
- `draft-conflicts`, keyed by `conflictId`, indexed by `documentId` and `detectedAt`;
- `draft-quarantine`, keyed by `quarantineId`, indexed by `documentId` and `detectedAt`.

`DocumentDraftConflict` schema version 1 already stores the exact candidate, candidate content and draft snapshot IDs, resolution, and resolution time. It does not store the result document ID. `resolveConflict("save_copy")` can therefore mark a conflict resolved without proving that a copy exists.

`list()` currently stops at the first metadata value that `parseSummary` rejects. It returns `corrupt_record` and discards every healthy row found in that page. `get()` has the stronger behavior: it validates the body/metadata pair and quarantines only the observed bad pair with a stale-observation guard.

## Atomic save-conflict-as-copy API

Add one repository operation. Do not compose public `create()` and `resolveConflict()` in application code.

```ts
export type SaveConflictAsCopyInput = Readonly<{
  conflictId: string
  expectedCandidateDraftSnapshotId: string
  newDocumentId: string
  name?: string
}>

export type SaveConflictAsCopyResult =
  | Readonly<{
      ok: true
      status: "created" | "replayed"
      record: DocumentDraftRecord
      conflict: DocumentDraftConflict
    }>
  | Readonly<{ ok: false; reason: "missing_conflict" }>
  | Readonly<{
      ok: false
      reason: "stale_conflict"
      current: DocumentDraftConflict
    }>
  | Readonly<{
      ok: false
      reason: "resolved_without_copy"
      current: DocumentDraftConflict
    }>
  | Readonly<{
      ok: false
      reason: "target_exists"
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      failure: DraftRepositoryFailure
    }>

saveConflictAsCopy(
  input: SaveConflictAsCopyInput
): Promise<SaveConflictAsCopyResult>
```

`conflictId` is the idempotency key. `newDocumentId` is the requested first result ID, not a second idempotency key. A retry always converges on the result recorded by the conflict.

### Conflict schema compatibility

Add one optional field to the stored version-1 conflict shape and expose it as required after parsing:

```ts
type StoredDocumentDraftConflictV1 = Omit<
  DocumentDraftConflict,
  "resolutionDocumentId"
> &
  Readonly<{ resolutionDocumentId?: string | null }>

// Public normalized projection
type DocumentDraftConflict = Readonly<{
  // existing fields unchanged
  resolutionDocumentId: string | null
}>
```

Normalize an absent field to `null` when parsing. New unresolved conflicts and `reload_saved` resolutions write `null`. A successful `save_copy` writes the new document ID. The object store, key path, indexes, and database version do not change.

Existing unresolved rows remain fully usable. Existing `reload_saved` rows remain fully usable. A legacy row already marked `save_copy` without `resolutionDocumentId` is not replay-safe. Return `resolved_without_copy`, preserve the row, and never create another copy automatically. The repository has no proof that an earlier caller did or did not create one.

All conflict writers must stop overwriting a resolved row at the current document/session conflict key. They may replace the latest unresolved candidate for that document/session, which preserves the existing PERSIST-01A rule. If the matching row is resolved, a later genuine conflict gets a new generated `conflictId`. This keeps the prior result marker replayable and prevents a delayed stale save from erasing resolution evidence. Existing fixed conflict IDs remain readable.

`parseConflict` must enforce these new invariants for newly written rows:

- unresolved means `resolvedAt`, `resolution`, and `resolutionDocumentId` are all null;
- `reload_saved` means a non-null `resolvedAt` and null `resolutionDocumentId`;
- `save_copy` means a non-null `resolvedAt` and nonempty `resolutionDocumentId`;
- the legacy missing-field case is decoded separately so it remains recoverable rather than becoming invisible corruption.

### Copy projection

The copy is prepared from the conflict's exact admitted candidate, not the current durable head:

- replace canonical `document.id` with `newDocumentId`;
- use `name.trim()` when supplied and nonempty, otherwise `${candidate.document.name} copy`;
- reset canonical `revision` to zero;
- set canonical `createdAt` and `updatedAt` to one captured `now` value;
- preserve exact source context, pages, nodes, groups, fields, values, bindings, and document-scoped nested IDs;
- set origin to `{ kind: "duplicate", sourceDocumentId: conflict.documentId }`;
- do not copy publication linkage or preview bytes.

First read the conflict in a short readonly transaction. Parse it, run full admission on its stored candidate, and require the derived candidate content/draft snapshot IDs to equal the stored hashes. Then project and admit the copy and derive its new content/draft snapshot IDs before opening the write transaction. Reject invalid IDs, names, candidate hashes, aggregates, source context, or admission size without opening a write transaction. The later write transaction still re-reads the conflict and compares the expected candidate hash, so this preflight cannot authorize stale bytes.

### Transaction and idempotency contract

Use one `readwrite` transaction over `draft-body`, `draft-meta`, and `draft-conflicts`.

1. Re-read the conflict by `conflictId` inside the transaction.
2. If missing, return `missing_conflict`.
3. Parse it and compare `expectedCandidateDraftSnapshotId`. A replaced same-session candidate returns `stale_conflict`.
4. If it is already `save_copy` with a result ID, read and validate that exact body/metadata pair. Return `replayed` even when the retry supplied a different `newDocumentId`. The stored result wins.
5. If it is already `reload_saved`, or is a legacy `save_copy` without a result ID, return `resolved_without_copy`.
6. Read both target rows for `newDocumentId`. If a valid pair exists, return `target_exists`. If either row exists but the pair is invalid, return `corrupt_record`. Do not overwrite, quarantine, or resolve unrelated target data in this operation.
7. Put the admitted version-1 body and metadata with `recordVersion: 1`.
8. In the same transaction, set `resolution: "save_copy"`, `resolvedAt: now`, and `resolutionDocumentId: newDocumentId` on the conflict.
9. Commit before returning or emitting an event.

There is no state where the result record exists but the conflict is unresolved, or the conflict is resolved but its result record is absent. Transaction abort, quota, request failure, tab interruption, and concurrent retry leave the pre-operation state authoritative.

Two concurrent calls for one conflict have one winner. A loser re-reads the winner's resolution and returns `replayed` with the winner's exact record. Two calls with different target IDs still create only one copy.

### Event behavior

After a newly created copy commits, publish in this order:

1. the existing `saved` event with `reason: "content_saved"` for the copy;
2. a new `conflict_resolved` event for the source conflict.

```ts
type ConflictResolvedRepositoryEvent = Readonly<{
  type: "conflict_resolved"
  conflictId: string
  documentId: string
  resolution: "reload_saved" | "save_copy"
  resolutionDocumentId: string | null
  sessionId: string
}>
```

`resolveConflict("reload_saved")` emits the same compound event after commit. Replay emits no event. Event construction, parsing, post, and observer failures remain isolated. Events are invalidation hints; the transaction is authority.

## Corruption-tolerant list API

Extend the successful page rather than turning one bad row into a failed list:

```ts
export type DraftListRecoveryItem = Readonly<{
  documentId: string | null
  quarantineId: string | null
  status: "quarantined" | "retained"
  failure: DraftRepositoryFailure
}>

export type DraftListPage = Readonly<{
  items: readonly DocumentDraftSummary[]
  nextCursor: string | null
  recoveryItems: readonly DraftListRecoveryItem[]
}>
```

`list()` still returns a top-level failure for an invalid request/cursor or a failed list transaction. Row corruption is different: continue scanning until `limit + 1` healthy matching rows or index exhaustion, return the healthy page, and include one recovery item per bad row observed during that scan.

For an index-visible bad row whose primary key is a nonempty string:

1. retain its primary key and exact raw metadata observation while scanning;
2. finish the read transaction;
3. run the existing pair quarantine logic in a separate guarded transaction that re-reads body and metadata;
4. remove body, metadata, and preview only when the observed metadata is still current and the live pair remains invalid;
5. return `status: "quarantined"` with the committed quarantine ID;
6. if the observation was superseded by a healthy concurrent write, omit the recovery item and allow the next refresh to return that healthy row;
7. if quarantine cannot commit, preserve the raw pair and return `status: "retained"` with the failure. Healthy rows still return.

Never guess which side of a mismatched body/metadata pair is authoritative. Never delete a newer pair using stale list evidence.

The list cursor remains based on the last returned healthy `(activityAt, documentId)` pair. Corrupt rows do not consume the requested healthy-item limit. Search and active/deleted predicates apply before healthy limit satisfaction.

A row without an indexable compound key cannot be discovered by the activity index. Add a bounded primary-key integrity sweep, at most 50 metadata rows on each first-page list call, with this additive setting in the existing `repository-settings` store:

```ts
type DraftMetadataIntegrityScanSetting = Readonly<{
  key: "integrityScan.draftMetaV1"
  value: Readonly<{
    afterPrimaryKey: IDBValidKey | null
    completedAt: string | null
  }>
}>
```

The setting requires no store or database-version change. Reset `afterPrimaryKey` to null and set `completedAt` only after reaching the end. Merge that batch's findings into the first page's `recoveryItems`. The sweep uses the same guarded quarantine path, and the normal recent page does not wait for a full-store sweep. A malformed or non-string primary key that cannot fit the existing quarantine schema is returned as a retained recovery item and preserved; do not coerce it into a document ID.

After a quarantine commit, publish one additive event:

```ts
type QuarantinedRepositoryEvent = Readonly<{
  type: "quarantined"
  documentId: string
  quarantineId: string
  sessionId: string
}>
```

No event is emitted for a superseded observation or failed quarantine.

## Failure matrix

| Failure                                         | Required result                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Invalid copy input or candidate admission       | `validation_failed`; no transaction, copy, resolution, or event                          |
| Conflict missing                                | `missing_conflict`; no mutation                                                          |
| Same conflict ID now contains a newer candidate | `stale_conflict`; expose current conflict; no mutation                                   |
| Target ID has a valid body/metadata pair        | `target_exists`; preserve target and unresolved conflict                                 |
| Existing target pair is corrupt                 | `corrupt_record`; do not quarantine unrelated data as a side effect of conflict recovery |
| Copy transaction request/abort/quota failure    | `storage_unavailable` with typed failure; neither copy nor resolution commits            |
| Retry after committed copy                      | `replayed` with exact winning record; no new writes or events                            |
| Resolved legacy save-copy lacks result ID       | `resolved_without_copy`; preserve evidence and do not guess                              |
| Corrupt metadata amid healthy rows              | healthy rows plus recovery item; continue to page limit                                  |
| Quarantine succeeds                             | bad pair and preview removed atomically; quarantine retained; one event after commit     |
| Quarantine fails                                | raw pair retained; healthy page returned with `retained` recovery item; no event         |
| Stale quarantine observation                    | newer pair retained; no recovery item or event                                           |
| List cursor/request/transaction fails           | top-level typed list failure; no partial page claim                                      |

## Deterministic tests

Add focused cases to the existing repository suites:

1. Save an exact stale candidate as a copy and assert candidate content/source context, new canonical identity, origin, reset revision, body/meta version 1, and resolved conflict result ID in one committed state.
2. Inject an abort and `QuotaExceededError` after both puts are scheduled. Assert no target rows, unchanged unresolved conflict bytes, and no events.
3. Run two repository instances concurrently with the same conflict and same target ID. Assert one `created`, one `replayed`, one target, and one resolved conflict.
4. Repeat with different target IDs. Assert one winner, one replay of the winner, and no losing target.
5. Retry after close/reopen. Assert byte-equivalent record, `replayed`, no version/timestamp change, and no events.
6. Replace the same-session conflict candidate between preflight and transaction. Assert `stale_conflict` and no target.
7. Cover missing, reload-resolved, legacy save-copy-without-result, target-exists, corrupt target, malformed candidate hash, and oversized candidate.
8. Resolve a conflict, then submit another stale candidate from the same document/session. Assert the resolved row remains byte-equivalent and the later conflict receives a new ID.
9. Verify exactly one post-commit `saved` then `conflict_resolved` event for create, event parser isolation, and zero events for replay/failure.
10. Seed healthy rows before and after one index-visible malformed summary. Assert healthy ordering, healthy limit satisfaction, continuation without duplicates, one quarantine item, and exact bad pair/preview removal.
11. Seed two corrupt rows around an equal-timestamp cursor boundary. Assert they consume no healthy limit and do not hide later rows.
12. Force quarantine transaction failure. Assert healthy rows still return, bad bytes remain, recovery status is `retained`, and no quarantine event fires.
13. Replace a corrupt row with a healthy pair after scan observation but before quarantine. Assert stale evidence removes nothing and the next list returns the healthy row.
14. Seed a malformed row omitted from the activity index. Advance the bounded integrity sweep across multiple batches and assert eventual quarantine without an unbounded metadata read.
15. Keep the existing malformed-list-request, equal-timestamp pagination, stale-quarantine, conflict-candidate integrity, observer isolation, and pair-quarantine tests green.

Passing tests are evidence, not permission to expose the route or UI. This repository slice is complete only after typecheck, focused ESLint, Prettier check, `git diff --check`, and an independent source review report zero P0, P1, or P2 findings.
