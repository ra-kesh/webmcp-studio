# Cross-browser media Slice 4 active-editor relink phase map

Date: 2026-08-30

Status: **implemented and independently accepted; Slice 5 and row 10 remain active**

Ledger boundary: row 10, Cross-browser local media — Slice 4 only

## Gate decision

Slice 4 must join the already accepted promotion mapping to the mounted editor
without weakening history, persistence, or session ownership. The operation is
complete only after all exact local references are one canonical managed
identity, that history result is reported truthfully, the relinked draft has an
exact durable receipt, and the managed asset's Recent position has one
crash-safe idempotent update.

Three current seams cannot be used as success proxies:

1. `useDocumentEditor.commit()` returns only `boolean` and discards
   `DocumentHistoryCommit.id` and `undoable`.
2. `flushActiveDraft()` returns only `boolean`; it does not identify the exact
   record version and draft snapshot that became durable.
3. `markManagedMediaUsed()` and `POST /v1/studio/assets/:assetId/used` have no
   idempotency identity. Calling them before or after journal completion cannot
   be exactly once across a crash.

Slice 4 must add bounded result/receipt seams. It must not infer Undo from a
successful command, infer durability from a generic `saved` state, or hide the
Recent crash window with optimistic UI.

## Material reread

- The complete `cross-browser-media-phase-entry.md`, including all Slice 1,
  Slice 2, Slice 3A, and Slice 3B exit evidence.
- `cross-browser-media-slice1-independent-review.md`,
  `cross-browser-media-journal-independent-review.md`, and
  `cross-browser-media-owner-independent-review.md`.
- The complete PERSIST-01 phase entry, HIST-01 transaction and cancellable
  transform records, MEDIA-01 implementation/UX/browser reviews, and FAIL-01A,
  FAIL-01C, FAIL-01E, and FAIL-01F lifecycle records.
- The live document media extractor/relink reducer, history engine, mounted
  editor hook, draft save controller/repository, persistence provider/runtime,
  asset dialog/model/components, managed repository client/server, and route,
  unmount, review, crop, and session-transition ownership.

## Canonical code to reuse

| Concern                    | Canonical surface                                                                                                                   | Slice 4 rule                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local and managed identity | `packages/document/src/media.ts`: `localAssetSource`, `managedAssetSource`, `extractAssetReferences`, `assetReferenceKeysForSource` | Never slice prefixes or build a second reference scanner in React.                                                                                                                                     |
| Atomic document mutation   | `relink_asset_references` in `packages/document/src/schema.ts` and `commands.ts`                                                    | Dispatch one aggregate command with the exact sorted source keys. Do not loop over `set_field` or `replace_image_source`.                                                                              |
| History truth              | `commitCommandsWithResult` in `packages/editor/src/history.ts`                                                                      | Retain the returned commit ID and `undoable`; do not route this action through the boolean-only `commit()` wrapper.                                                                                    |
| Promotion mapping owner    | `startLocalAssetPromotion` in `local-asset-promotion-owner.ts`                                                                      | It owns hash, lookup, upload, cancellation, timeout, reconciliation, and the mapping checkpoint. Slice 4 starts only from its released `mapped`, `relinking`, `complete`, conflict, or failure result. |
| Durable operation state    | `local-asset-promotion-journal.ts`                                                                                                  | Every relink/use transition is lease- and revision-CAS owned. BroadcastChannel remains an invalidation hint only.                                                                                      |
| Draft capture and ordering | `capturePersistenceSession`, `DocumentDraftSaveController`, and `DocumentDraftRepository.get`                                       | Use the active controller's ordered write chain, then read back and verify the exact returned head. Do not instantiate another repository/controller or bypass compare-and-swap.                       |
| Persistence lifetime       | `StudioPersistenceProvider` / `StudioPersistenceRuntime.acquireLease()`                                                             | The installed editor session owns the repository lease. The promotion controller borrows that exact session and never closes it.                                                                       |
| Mounted session fences     | `mountedRef`, `activePersistenceSessionRef`, `sessionGenerationRef`, `claimSessionTransition`, `retirePersistenceSession`           | Presentation and editor mutation require exact session ownership; durable journal reconciliation may finish after presentation ownership is gone.                                                      |
| Editor blockers            | `allowMutation`, `pendingChangeSetRef`, `imageCropSessionRef`, `quotationRefreshJournalRef`, conflict/recovery refs                 | Promotion preflight and pre-commit revalidation must use the same blocker truth.                                                                                                                       |
| Managed Recent             | `managed-media-repository.ts` and server `MediaAssetRepository.markUsed`                                                            | Replace the current non-idempotent call with the operation contract below. Mutation notification is view invalidation, not authority.                                                                  |
| Media surface              | `asset-library-dialog.tsx`, `asset-library-components.tsx`, `asset-library-model.ts`                                                | Extend the retained Media dialog/local card. Do not add a separate picker, toast-only lifecycle, or route-global modal.                                                                                |

## Exact operation anchor

The controller should capture one immutable anchor only after the document is
in workspace mode, durable persistence is installed, the local alias has at
least one exact reference, and Review/crop/recovery/quotation refresh and a
document transition are inactive.

```ts
type ActiveRelinkAnchor = Readonly<{
  operationId: string
  localAssetId: string
  localSource: `asset:local/${string}`
  sourceLocalAssetRevision: number
  expectedReferenceKeys: readonly string[]

  documentId: string
  sourceContentSnapshotId: `sha256-${string}`
  sourceHistorySnapshotId: string
  sourceOperationVersion: number

  persistenceSession: ActivePersistenceSession
  sessionGeneration: number
  sourceDraftRecordVersion: number
  sourceDraftSnapshotId: `sha256-${string}`
}>
```

Capture `sourceContentSnapshotId` by awaiting
`deriveDocumentSnapshotId(structuredClone(historyRef.current.document))`, then
recheck the document ID, history snapshot, operation version, session object,
and generation before creating/resuming the journal. Do not use the lagging
React `documentSnapshotId` state as an operation anchor.

Before the relink commit, all of these must still hold:

- `mountedRef.current`, workspace mode, the same `ActivePersistenceSession`
  object, the same session generation, and matching controller/document ID;
- exact source content, history snapshot, operation version, draft record
  version, and draft snapshot;
- no active session transition, external-change/conflict recovery, corrupt
  draft recovery, Review proposal/application, image crop, or quotation
  refresh;
- the current local record, when present, still has the captured local
  revision; a missing Blob after a verified mapping does not invalidate the
  mapping and may use the Studio copy;
- the mapping still names the exact alias, content hash, managed asset, status,
  and revision from the journal; and
- `assetReferenceKeysForSource(document, localSource)` is byte-for-byte equal
  to the sorted `expectedReferenceKeys`.

Any mismatch before commit leaves the canonical document unchanged and the
mapping reusable. The visible state is **Backed up, relink not applied** with
Retry. It never uploads again.

## Target-only replay detection

Absence of the local source is not enough. A mapped/relinking retry is
target-only only when:

1. the source key set is empty;
2. `extractAssetReferences(document)` filtered by the journal's exact managed
   source has keys exactly equal to `expectedReferenceKeys`;
3. every matching managed node has coherent `assetId`/`src`, and field current,
   default, and bound projections are canonical; and
4. no expected key points to another source or disappeared from the document.

If all four hold, skip `relink_asset_references`. If the operation's original
history result is not already durably checkpointed, record
`relinkResultKind: "already_applied"`, `relinkUndoable: false`, and no commit
ID. Do not invent an Undo entry after reload. Source absent plus partial,
different, or missing target keys is `local_relink_conflict`.

## Journal progression and relink receipt

The journal needs an explicit intent and result distinction:

```text
mapped
  -> relinking (intent; no document result yet)
  -> relinking (committed or exact already-applied result)
  -> marking_used (exact durable draft receipt present)
  -> complete (idempotent Recent receipt present)
```

Add `relinkResultKind: "committed" | "already_applied" | null`.

- `committed` requires result content/history snapshot IDs, commit ID, and the
  exact `relinkUndoable` returned by history.
- `already_applied` requires result content/history snapshot IDs, a null commit
  ID, and `relinkUndoable: false`.
- `relinking` with no result is a crash-safe intent. On resume it either
  commits from the still-exact source anchor or uses the exact target-only
  rule above.
- `marking_used` and `complete` require both the relink result and durable draft
  receipt.

The synchronous editor commit sequence is:

1. CAS `mapped -> relinking` intent under the promotion lease.
2. Build one `relink_asset_references` command with the journal's exact source,
   managed pair, and expected keys.
3. Call `commitCommandsWithResult`, install the returned history synchronously,
   prune source contexts, publish the history callback, and capture the settled
   draft exactly as the ordinary commit path does.
4. Derive and verify the result content snapshot and exact managed target keys.
5. CAS the relink result (`kind`, content/history IDs, commit ID, Undo truth)
   before the first asynchronous draft-flush wait.

A crash after the in-memory commit but before step 5 is recovered by the exact
source/target replay rules. After reload, Undo is conservatively unavailable.

## Critical draft flush and receipt

After a document commit, cancellation must no longer abort or relabel the
finishing phase. Navigation, a second promotion for the same alias, Undo/Redo,
and any mutation that could change the promoted reference set stay blocked
until the critical flush settles. Page shutdown remains best effort, but the
operation and the normal unmount drain must join the same controller write.

Add a result-returning controller seam such as:

```ts
type DraftFlushReceipt = Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  draftSnapshotId: string
  savedAt: string
}>

DocumentDraftSaveController.flushWithReceipt():
  Promise<DraftFlushReceipt | DraftFlushFailure>
```

The method drains the ordered capture chain, requires no pending capture,
requires `state.status === "saved"`, and snapshots the controller's document
ID, record version, content snapshot, draft snapshot, and saved timestamp in
one synchronous return. Slice 4 calls it without the user's AbortSignal after
the relink commit.

Then call `DocumentDraftRepository.get(receipt.documentId)` and require a
`found` record whose summary matches every receipt field except `savedAt` only
where repository timestamp precision is explicitly normalized. Re-derive the
content snapshot from the stored envelope and re-run the exact target-only
test on the stored document. This read-back, not a generic save-state label, is
the critical persistence proof.

Checkpoint these journal fields:

- `relinkResultDraftRecordVersion` = receipt record version;
- `relinkResultDraftSnapshotId` = receipt draft snapshot;
- retain the relink commit's content snapshot separately; and
- add `relinkResultDraftContentSnapshotId` if a later user edit can legally be
  drained in the same flush. It identifies the exact durable head while
  `relinkResultContentSnapshotId` identifies the relink transaction result.

After read-back, UI publication additionally requires the same mounted session
object, generation, document ID, and live operation token. Losing presentation
ownership suppresses React state/focus changes. The lease owner may still
finish the durable journal/use reconciliation; it may not mutate a newly
mounted editor.

A failed/conflicted flush leaves state `relinking`, preserves the mapping and
local bytes, does not update Recent, and exposes **Backed up, save not finished**
with Retry.

## Crash-safe managed Recent contract

Exactly-once Recent accounting requires server idempotency. Add a migration
after the current migration head with a separate table; do not overload media
upload requests:

```text
media_asset_use_requests
  workspace_id       required
  idempotency_key    required, bounded by mediaIdempotencyKeySchema
  asset_id           required
  request_hash       required
  used_at            required server timestamp
  result_revision    required positive asset revision
  created_at         required server timestamp

primary key (workspace_id, idempotency_key)
foreign key (workspace_id, asset_id) -> media_assets, delete restricted
index (workspace_id, asset_id, used_at)
```

The key is workspace-global, not `(workspace, asset, key)`, so reusing one key
for another asset is a deterministic conflict. The journal must persist a
dedicated `recentUseIdempotencyKey` before the first `/used` call. It is not
the promotion upload `idempotencyKey`: one completed alias mapping may be
superseded for another document without another upload, but each successful
document relink is a distinct Recent event. Keep the Recent key stable across
retry/reload/re-anchor of the same unrelinked operation, and generate a new
Recent key only when explicitly superseding a completed operation for a new
document anchor. Derive a route-versioned request hash equivalent to
`sha256("media-used\0" + assetId)`.

`POST /v1/studio/assets/:assetId/used` must require `Idempotency-Key`. In one
D1 batch it increments `last_used_at` and asset revision once and inserts a
receipt whose result revision comes from the updated row. A same-key race
reconciles the stored request. Replays return the original stable receipt,
even if another later use has advanced the current asset again. A key reused
for a different request returns the canonical idempotency conflict.

The public response adds a strict receipt:

```ts
type ManagedMediaUseReceipt = Readonly<{
  assetId: string
  usedAt: string
  assetRevision: number
}>
```

No storage identity is exposed. The client accepts the same stable key and
returns the response request ID plus receipt. Notify managed-media listeners
only after a valid response or reconciled replay; the notification refreshes a
view and is never the accounting authority.

Journal fields:

- `recentUseIdempotencyKey: string`
- `recentUseRequestId: string | null`
- `recentUseUsedAt: string | null`
- `recentUseAssetRevision: number | null`

Ordering:

1. After exact draft read-back, CAS to `marking_used` with the durable receipt.
2. Call `/used` with the journal's stable key.
3. CAS `complete` with the exact server receipt and request ID.

Crash before step 1 resumes at draft verification. Crash before step 2 starts
the idempotent call. A lost response or crash between steps 2 and 3 replays the
same key and receives the same receipt without a second semantic update. A
completed journal performs no `/used` call.

## Operation ownership, navigation, and recovery

- Keep the owner/controller outside Radix dialog content so closing/reopening
  the Media surface cannot orphan its task. The dialog can observe durable
  state; it does not own correctness.
- One live operation token per local alias suppresses late view publication.
  The journal lease/revision remains cross-tab authority.
- Before the document commit, Cancel aborts the Slice 3 owner and waits for its
  acknowledgement. A committed mapping may therefore finish as `mapped`, not
  false `cancelled`.
- After relink commit, expose **Saving everywhere…** and remove Cancel. The
  critical flush and idempotent Recent reconciliation are finishing work.
- `claimSessionTransition` must refuse Home/open/replace/recovery/route
  transitions during critical relink persistence, with specific copy. Before
  that phase, a transition invalidates presentation and leaves/resumes the
  durable journal instead of mutating the destination session.
- Review or crop entered while hashing/uploading makes the pre-commit anchor
  stale. Do not close or alter those workflows; retain the mapping and show
  Retry after they settle.
- `mapped` resumes directly at revalidation/relink. `relinking` resumes from
  intent, exact result, or durable receipt. Neither state reads/hashes local
  bytes or uploads again.
- If the document anchor changes while upload/reconciliation is still in
  flight, Retry may explicitly supersede only a released `mapped` journal or
  a released `relinking` intent with no relink result, draft receipt, or Recent
  receipt. Re-anchor all source document/history/operation/draft/reference
  fields atomically under revision CAS while preserving the verified mapping,
  byte hashes, local revision, upload idempotency key, mapping request ID, and
  this relink operation's dedicated Recent key. It must not re-anchor an active
  lease, committed/already-applied result, `marking_used`, or `complete` state.
- `mapped`, `relinking`, `marking_used`, and `complete` are managed-mapping
  states. Their journal invariants require the whole managed tuple and
  `managedContentSha256 === contentSha256`; `marking_used` is not allowed to
  transiently shed or mismatch the mapping while accounting for Recent.
- `complete` is terminal for the same document anchor. A completed alias used
  by a new document must go through the journal's explicit completed-operation
  supersession and receive a new Recent idempotency key.
- On unmount, abort only cancellable pre-commit work. The existing session
  teardown drain and any started critical flush join the same controller.
  Late durable completion may update the journal/server receipt under CAS but
  cannot call React setters, move focus, alter selection, or touch the new
  session.

## UI, focus, and accessibility gate

Extend each healthy, referenced local card with a separate semantic action
named **Make available everywhere**. The card's existing Add/Replace button
keeps its current meaning; do not overload card selection with promotion. Show
the exact current-document use count.

Required visible states:

| Durable state                          | Copy and action                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Local, healthy, unmapped               | **Make available everywhere**                                                           |
| Hashing/reconciling/uploading          | Named phase, real byte progress only during upload, **Cancel**                          |
| Cancelling                             | **Stopping…**; no Retry yet                                                             |
| Mapped but stale/unrelinked            | **Backed up, relink not applied** and **Retry relink**                                  |
| Relink committed/flushing              | **Saving everywhere…**; no Cancel, close/navigation blocked only for the critical phase |
| Recent reconciliation                  | **Updating Recent…**; retry is internally idempotent                                    |
| Complete, Undo retained                | **Available everywhere** and announcement that Undo restores the device-only reference  |
| Complete, not undoable/already applied | **Available everywhere** with explicit no-Undo copy                                     |
| Conflict/failure                       | Inline specific next step and Retry only when the stable error is retryable             |

Use native buttons with visible `:focus-visible`, at least 44 px compact hit
targets, and no nested interactive controls. Status changes live beside the
asset in a `role="status"` / polite live region; deterministic conflicts use an
alert. `aria-busy` belongs on the affected operation region, not the entire
dialog. Progress has a text equivalent. The user can still reach other media
while noncritical upload work continues.

Starting the action keeps focus on its stable action/control. Completion does
not auto-close the Media dialog. Retry replaces the same control and receives
focus after a failure. If the dialog closes before critical work, ordinary
Radix focus return remains intact; reopening reconstructs state from IndexedDB,
not a stale component closure. Compact opening must not autofocus search or
summon the software keyboard.

Managed Recent updates only after the server receipt. Refresh the open dialog
through the existing managed-media invalidation seam or inject the
authoritative returned asset; do not assign `new Date()` optimistically and do
not remove the local retained card/blob.

## Required non-browser tests

### Domain/history/controller

- Direct nodes, field default/current values, bound nodes, pages, and outputs
  commit once with exact target keys and one history entry.
- `maxBytes: 1` commits the relink with `undoable: false`; journal and UI copy
  remain truthful.
- Exact target-only replay skips command dispatch. Source absence with partial,
  wrong, or missing target keys is conflict.
- Every anchor coordinate independently drifting—document/content/history/
  operation/draft head/local revision/Review/crop/recovery/session—produces no
  document mutation or flush and retains `mapped`.
- `mapped`, relinking intent, relinking result, durable relinking, marking-used,
  and complete each resume at the correct step with zero duplicate upload.
- Lease loss/newer attempt suppresses late commit, UI, focus, and completion.

### Persistence

- `flushWithReceipt` drains the exact capture, returns all five receipt fields,
  never lets an older write win, and reports failed/conflict/session-closed
  outcomes explicitly.
- Repository read-back mismatch in record/content/draft identity, source still
  present, or target set drift leaves `relinking` and performs zero `/used`.
- Save failure followed by Retry performs no second history commit.
- A newer ordinary capture drained with the relink still proves the target set
  and records separate relink-result and durable-head content identities.
- Unmount and route retirement join the same write; the new session is never
  mutated.

### Recent idempotency

- Migration verifies constraints, composite foreign key, index, and all prior
  migrations in real SQLite.
- Same key/same asset replay produces one `last_used_at` change and one revision
  increment and returns the original receipt.
- Same key/different asset or request hash returns deterministic conflict.
- Concurrent same-key batches yield one winner and one reconciled replay.
- Inject crash after durable flush, after server commit before response, after
  response before journal completion, and after completion. Every recovery
  ends with one semantic use update; completed replay sends zero requests.

### Mounted UI/session

- The retained Media dialog shows all phases, inline stable errors, byte
  progress, cancel acknowledgement, Retry, exact use count, and accurate Undo
  copy in both insert and replace modes.
- Keyboard-only action/cancel/retry works; status is announced once; focus stays
  stable and returns to the opener on close.
- Desktop and 390 px compact tests prove 44 px actions, one scroll owner, no
  horizontal overflow, and no forced compact search focus.
- Edit/review/crop/page/document/route/unmount/new-attempt races cannot mutate
  a stale editor. Critical persistence blocks navigation with exact copy.
- Managed Recent changes only after the authoritative use receipt, appears once,
  and the retained local card/blob remains available for Undo/recovery.

## Slice 4 exit gate

Accept Slice 4 only after an independent code review finds no P0/P1 and the
focused tests prove one mapped operation can either commit one truthful history
step or recognize one exact replay, durably read back a coherent managed draft,
survive every crash boundary without a second upload or Recent update, and
never publish into a stale mounted session.

This does not close row 10. Slice 5 still owns admission-time and missing-byte
recovery; Slice 6 still owns two-browser and deployed D1/R2 evidence.

## Exit record

- The mounted editor now owns one synchronously reserved, cancellable
  preflight and one finite-lease promotion/relink operation. Exact local
  references are either committed once through canonical history or recognized
  as an exact managed replay; partial, wrong, and missing targets become durable
  conflicts rather than guessed success.
- Relink history identity, truthful Undo availability, exact draft receipt and
  repository read-back, critical save ownership, unmount settlement, terminal
  lease ordering, and idempotent managed Recent reconciliation are retained in
  the journal and recover across reload, response loss, and route/session
  changes without a second upload or relink.
- The Media dialog projects raw journal authority synchronously against the
  current document, distinguishes local and foreign ownership, keeps Cancel /
  Stopping / Retry focus stable, refreshes open Recent state from authoritative
  mutation evidence, and cannot leak stale operation state across documents.
- The independent reviewer rejected sixteen P1 defects during implementation;
  every finding is repaired and covered by focused domain, persistence, DOM, or
  mounted-session evidence. The final verdict is **ACCEPT** with no open P0/P1.
- Final root evidence under the bundled Node runtime: 9 focused files and 144
  tests pass, Studio typecheck passes, all changed Slice 4 files outside the
  large hook pass scoped ESLint, all changed files pass Prettier, and
  `git diff --check` passes. The hook retains only five pre-existing unrelated
  quotation-refresh lint diagnostics.
- `cross-browser-media-editor-relink-independent-review.md` is the retained
  code-review record. Slice 5 admission/missing-byte recovery and Slice 6 real
  two-browser/deployed evidence remain explicitly outside this acceptance.
