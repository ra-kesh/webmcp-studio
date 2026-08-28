# PERSIST-01A independent code review

Date: 2026-08-28
Reviewer: final independent code pass
Verdict: **APPROVE for hook integration**

## Scope

I reread the current production code and tests rather than accepting the repair summary:

- `apps/studio/src/features/editor/document-draft-repository.ts`
- `apps/studio/src/features/editor/document-draft-repository.test.ts`
- `apps/studio/src/features/editor/document-draft-repository.failures.test.ts`
- `apps/studio/src/features/editor/document-draft-repository.storage-failures.test.ts`
- `apps/studio/src/features/editor/document-draft-migration.ts`
- `apps/studio/src/features/editor/document-draft-migration.test.ts`
- `apps/studio/src/features/editor/draft-admission.ts`
- `apps/studio/src/features/editor/draft-admission.test.ts`
- `apps/studio/src/features/editor/document-draft-save-controller.ts`
- `apps/studio/src/features/editor/document-draft-save-controller.test.ts`

I also reran the current-draft and import regression suites used by this boundary. No production or test file was edited during this review. Only this report was updated.

The foundation is approved for integration into `useDocumentEditor`. This approval means the repository, migration, admission, and ordered save-controller contracts are ready to become the editor's local persistence path. It does not mark document routes, recent-card UI, visible conflict resolution, session-only UI, previews, or cloud synchronization complete.

## Findings

No P0, P1, or P2 code finding remains in the reviewed PERSIST-01A foundation.

The three P1 findings and two P2 findings from the previous pass are closed below with current code and test evidence.

## Closed findings

### Closed P1: malformed save ancestry cannot reject or poison the conflict store

Evidence:

- `document-draft-repository.ts:335-336` defines one canonical snapshot-ID predicate: `sha256-` followed by exactly 64 lowercase hexadecimal characters.
- Stored metadata, bodies, migration markers, events, and conflict records reuse that predicate.
- `document-draft-repository.ts:1411-1436` validates `expectedVersion` as a positive safe integer and validates the base draft snapshot ID before admission or IndexedDB access.
- Omitted values, fractional versions, short hashes, non-hex hashes, and uppercase hashes return `validation_failed` rather than rejecting.
- `document-draft-repository.failures.test.ts:291-326` calls the public method through an unsafe runtime signature, proves all malformed calls fulfill with typed validation results, proves no conflict was stored, and proves version 1 remains healthy.

The earlier runtime reproduction no longer succeeds. Invalid ancestry cannot create a record that `listConflicts` later rejects.

### Closed P1: corruption remains distinct from storage unavailability

Evidence:

- `DraftWriteResult`, `DraftDeleteResult`, `DraftMigrationResult`, `DraftValueResult`, and `DraftQuarantineResult` carry explicit `corrupt_record` variants at `document-draft-repository.ts:96-117` and `document-draft-repository.ts:186-265`.
- Corruption found by create and migration returns `corrupt_record` with the committed `quarantineId` at `document-draft-repository.ts:1115-1158` and `document-draft-repository.ts:1276-1294`.
- Save propagates a corrupt preflight result with its quarantine ID at `document-draft-repository.ts:1446-1460`.
- Corruption introduced after save preflight is quarantined and returned as non-storage corruption at `document-draft-repository.ts:1484-1512`.
- Delete, purge, touch-opened, and quarantine reads preserve the same distinction.
- `document-draft-repository.failures.test.ts:328-395` deterministically corrupts metadata between save preflight and the compare-and-swap transaction, then proves a typed `corrupt_record`, public quarantine access, and removal of the corrupt active pair.
- The save controller retries only `storage_unavailable` at `document-draft-save-controller.ts:283-288`. Corruption is therefore non-retryable and can enter recovery UX truthfully.

No branch reviewed returns top-level `storage_unavailable` with `failure.kind: "corrupt_record"`.

### Closed P1: transaction failure cannot leave a detached unhandled rejection

Evidence:

- `document-draft-repository.ts:778-795` creates the terminal transaction promise, treats abort as the terminal failure, and attaches a rejection observer immediately.
- Request promises retain their exact request failure while the transaction observer prevents a later abort from becoming detached.
- Callers still await the original transaction promise on normal and aborting write paths, so attaching the observer does not convert an abort into success.
- `document-draft-repository.storage-failures.test.ts:209-254` forces a request error, requires a fulfilled typed `request_failed` result, and asserts no process-level unhandled rejection.
- `document-draft-repository.storage-failures.test.ts:256-320` aborts a version-2 write transaction after requests are issued, requires a typed `transaction_aborted` result, asserts no unhandled rejection, and proves the previous body and metadata remain byte-equivalent.

The public no-reject storage contract and atomic rollback behavior now agree.

### Closed P2: blocked, request, abort, quota, and rollback boundaries are executable

Evidence:

- `document-draft-repository.ts:831-853` classifies blocked upgrades, quota, abort, request failure, and general unavailability into distinct failure kinds.
- `document-draft-repository.storage-failures.test.ts:167-207` drives the real repository open path through an `IDBOpenDBRequest` blocked event and requires the typed blocked result.
- `document-draft-repository.storage-failures.test.ts:209-254` covers request failure.
- `document-draft-repository.storage-failures.test.ts:256-320` covers transaction abort, no unhandled rejection, and exact previous-pair preservation.
- `document-draft-repository.storage-failures.test.ts:322-379` covers quota classification and previous-pair preservation.
- The original synchronous-denial contract remains covered at `document-draft-repository.failures.test.ts:256-289`.

Session-only acknowledgement remains an integration acceptance item. It belongs to the hook and start-state wiring because the repository correctly reports unavailability rather than silently creating an in-memory fallback. It is not a remaining repository or save-controller defect.

### Closed P2: migration cleanup journal advances to the truthful suffix

Evidence:

- `document-draft-repository.ts:267-274` defines the typed cleanup-marker result.
- `document-draft-repository.ts:1354-1409` validates marker identity, reads the current setting in a write transaction, refuses missing or mismatched markers, and writes the exact deduplicated pending-key list.
- `document-draft-migration.ts:279-307` removes keys in identity-safe order and advances the repository marker to `orderedCleanupKeys.slice(index + 1)` after each successful removal.
- Cleanup stops at the first localStorage removal failure or journal update failure and reports the exact failing boundary.
- `document-draft-migration.test.ts:143-215` proves each suffix in order and proves the successful terminal marker is an empty list.
- `document-draft-migration.test.ts:254-322` still proves cleanup retry after a newer version-2 edit preserves that edit and does not create a migration conflict.
- `document-draft-migration.test.ts:324-357` proves dependent cleanup stops before the identity key when a context removal fails.

The setting is now a truthful cleanup journal rather than a static copy of the original key list.

## Previously closed safety properties rechecked

### Stale quarantine cannot delete a newer valid pair

- `document-draft-repository.ts:2735-2782` re-reads body and metadata in the quarantine write transaction and removes active rows only if both raw values still match the observed pair.
- Superseded evidence is retained with `activeRowsRemoved: false`.
- `get` retries after superseded evidence at `document-draft-repository.ts:2082-2139`.
- The deterministic interleaving test remains at `document-draft-repository.failures.test.ts:180-254`.

### Canonical integrity and public recovery remain intact

- `get` validates the pair, then recomputes content snapshot ID, draft snapshot ID, and canonical UTF-8 byte length before returning a record at `document-draft-repository.ts:2061-2155`.
- Missing, corrupt, and unavailable reads remain distinct.
- Public quarantine list, get, and delete operations remain available at `document-draft-repository.ts:2515-2622`.
- Missing body, missing metadata, malformed body, unsupported schema, hash mismatch, invalid aggregate, raw download serialization, and deletion remain covered in `document-draft-repository.failures.test.ts`.

### Compare-and-swap, no-op, pagination, and invalidation remain intact

- Same-draft save returns the current record without incrementing or rewriting at `document-draft-repository.ts:1546-1556`.
- The current pair read, expected-version comparison, conflict candidate write, and successful pair write share the save transaction at `document-draft-repository.ts:1466-1587`.
- The two-instance test still proves one version-2 winner and one durable losing candidate.
- The compound `[activityAt, documentId]` index and exclusive compound cursor preserve equal-time pagination.
- BroadcastChannel construction, inbound parsing, observer, post, unsubscribe, and close failures remain isolated from repository correctness.

### Ordered save controller remains ready

- Captures are cloned at commit time.
- Writes use one ordered promise chain.
- Each write uses the last durable record version and base draft snapshot ID.
- A newer capture wins over restoration of an older failed capture.
- Conflict and deleted results pause the controller and retain the candidate.
- Storage failure retains the capture for retry.
- Close invalidates late completion.
- Subscriber exceptions cannot relabel durable state.

The save-controller suite continues to cover these behaviors.

## Verification

I ran the final gate against the current files with the bundled Node 24 runtime because the host's default Node 18 cannot start the installed Rolldown build.

```text
bunx vitest run --config vitest.config.ts \
  src/features/editor/current-draft-repository.test.ts \
  src/features/editor/document-import.test.ts \
  src/features/editor/draft-admission.test.ts \
  src/features/editor/document-draft-repository.test.ts \
  src/features/editor/document-draft-repository.failures.test.ts \
  src/features/editor/document-draft-repository.storage-failures.test.ts \
  src/features/editor/document-draft-migration.test.ts \
  src/features/editor/document-draft-save-controller.test.ts

8 test files passed, 115 tests passed.

bun run typecheck
tsc --noEmit passed.

bunx eslint <the reviewed production and eight gate test files>
No lint findings.
```

The test gate was rerun after the lowercase-only snapshot-ID predicate and uppercase-rejection test landed.

## Approval boundary

Proceed with the `useDocumentEditor` integration. Keep the integration phase gated on explicit repository loading, no bootstrap-document autosave, session-only acknowledgement, ordered flush before document replacement or navigation, conflict state propagation, and healthy-browser reload testing.

Do not infer approval for PERSIST-01B, PERSIST-01C, or cloud synchronization. Document routes, real recent-card CRUD, visible recovery and conflict actions, preview scheduling, D1 draft heads, and server synchronization still require their own implementation and independent review.

---

# Hook cutover review

Date: 2026-08-28
Scope: fresh independent re-review of the completed `useDocumentEditor` repository cutover, including reasoned invalidations, import races, critical action ownership, deterministic PNG export, mounted lifecycle, publication, and WebMCP boundaries
Verdict: **APPROVE**

The hook cutover is approved. The current source closes all findings from both prior hook reviews, and this pass found no remaining P0, P1, or P2 defect inside the PERSIST-01A acceptance boundary. The repository, migration, admission, and save-controller foundation remains approved.

This approval is based on the production implementation and executable tests read directly in the current tree. Passing tests were treated as supporting evidence rather than a substitute for the code review.

## Closure evidence

### Reasoned cross-tab invalidations

`DraftRepositoryEvent` now requires every `saved` event to carry one of `content_saved | opened | publication_linked` at `document-draft-repository.ts:161-182`. The inbound parser rejects saved messages without a recognized reason or valid version/snapshot identities at `:474-504`.

All content-producing paths emit `content_saved` (`:1251-1259,1348-1356,1676-1684`); publication linkage emits `publication_linked` without changing the save head (`:1815-1830`); and recent-activity touch emits `opened` (`:2270-2285`). Compare-and-swap remains authoritative.

The hook ignores metadata-only reasons for the active document, ignores delayed content events older than the controller head, and ignores an equal exact head. It projects `external_change` only for a genuinely different content/source head or foreign deletion at `use-document-editor.ts:1082-1117`. The mounted tests prove that foreign open/publication metadata leaves flush and Home available, delayed older/equal events remain saved, source-context-only newer saves are detected through `draftSnapshotId`, and the next local write reaches the repository CAS conflict.

### Identity-safe, race-safe imports

Both workspace import paths now capture the session generation, active document ID, exact history snapshot ID, and shared import request generation before reading bytes. After the await they require every identity to remain exact and call `allowMutation()` again before changing history (`use-document-editor.ts:3102-3192,3215-3311`).

This closes same-document edit, Undo/Redo, crop, review, session-replacement, and competing-import races while preserving the established product contracts: foreign-ID document JSON is rejected; same-ID JSON remains an in-place import; quotation composition preserves the active durable document ID and installs its exact source context.

The deterministic mounted matrix at `use-document-editor.persistence.mounted.test.tsx:1812-2042` covers JSON and quotation imports after an intervening ordinary commit, crop/review activation, session replacement, and a newer competing import. It verifies exact history and durable records rather than only visible error text.

### Owned, truthful shell action dispatch

`useCriticalActionOwner.dispatch` acquires ownership synchronously before invoking an operation, returns `false` without calling it when any action already owns the boundary, retains asynchronous or synchronous failure text, and releases only the matching owner in `finally` (`use-critical-action-owner.ts:28-63`).

The shell routes JSON, PNG, and PDF product commands directly through that dispatch result at `studio-shell.tsx:2057-2068`; a rejected duplicate is therefore no longer reported as accepted. Home retains its equivalent synchronous claim/release path at `:2020-2046`. Unit coverage exercises same-tick duplicate rejection for all four action identities and persistent deferred failure state at `use-critical-action-owner.test.tsx:104-152`.

### Deterministic requested-page PNG export

`StudioShell` captures `activePage.id` synchronously when the owned PNG operation is invoked, before its first await (`studio-shell.tsx:1605-1627`). The extracted `exportPagePng` service then:

1. awaits the critical draft flush;
2. freezes the exact post-flush canonical document;
3. resolves the synchronously requested page inside that frozen document;
4. materializes local image nodes against that frozen input;
5. sends the matching `pageId` and full frozen document to the canonical server renderer; and
6. names the download from the same frozen requested-page record.

Those invariants are explicit at `export-page-png.ts:21-57`. The deferred-flush test at `export-page-png.test.ts:5-52` changes the document and models a page switch while the save drains, then proves the request retains the originally dispatched page ID, carries the exact post-flush document, and uses that requested page's matching filename. The live Fabric artboard is no longer the export authority.

## Retained cutover guarantees

- Start remains neutral; the private bootstrap cannot acquire a repository record or controller.
- One durable workspace owns one matching document record and save controller.
- Canonical document/source transitions capture synchronously and pagehide drains the captured candidate.
- Failed/conflicted candidates retain an exact envelope download that performs no flush or repository mutation.
- Continue installs only a successful `touchOpened` record; missing, deleted, and corrupt races do not install stale bytes.
- Home and replacement await ordered critical flush and cannot cross failed/conflict durability.
- StrictMode repository construction is side-effect free and the retained channel lifecycle closes exactly once.
- Publication freezes and verifies the exact durable head, links through `recordVersion + contentSnapshotId` CAS, treats a concurrent newer edit as an unlinked successful publication, and refuses session-only publication.
- UI and WebMCP publication share the same flush-aware hook service; WebMCP tools abort when the workspace returns to Start.
- Local durability and publication sync remain distinct states.

## Verification

Using the bundled runtime:

```text
Node: v24.19.0
Bun: 1.2.5

Focused Vitest gate:
12 test files passed, 107 tests passed.

Included:
document-draft-repository.test.ts
document-draft-repository.failures.test.ts
document-draft-repository.storage-failures.test.ts
document-draft-save-controller.test.ts
use-document-editor.persistence.mounted.test.tsx
use-document-editor.start.mounted.test.tsx
use-document-editor.history-commit.mounted.test.tsx
use-document-editor.strict-mode.persistence.mounted.test.tsx
use-critical-action-owner.test.tsx
use-draft-replacement.test.tsx
use-studio-webmcp.lifecycle.mounted.test.tsx
export-page-png.test.ts

cd apps/studio && bun run typecheck
Passed.

Focused ESLint over 20 reviewed production/test files
Passed with no findings.

Focused Prettier check over the same 20 files
All matched files use Prettier code style.
```

No server, build, or browser process was started for this review.

## Approval boundary

PERSIST-01A is approved for the hook-cutover scope. This does not infer approval for PERSIST-01B, PERSIST-01C, cloud synchronization, document-route CRUD, thumbnail scheduling, or later recovery/conflict UI phases; those retain their own audit gates.
