# PERSIST-01 phase entry: local document repository, routes, recents, and conflict safety

Date: 2026-08-28
Status: contract ready for implementation; no PERSIST-01 production code is claimed here

## Decision

Build the browser document repository first. It must work without a server, preserve every valid document as a separately addressable record, and reject stale writes from another tab. Add cloud synchronization only after the local repository, routes, recovery, and conflict UI are stable.

This is not a larger version of the current `localStorage` key. The current key stores one mutable envelope and cannot support honest recents, document routes, compare-and-swap writes, durable previews, or a deleted document that another tab must not resurrect.

The local implementation should use IndexedDB. Do not silently fall back to an in-memory repository when IndexedDB is blocked, unavailable, or over quota. The existing explicit session-only warning is the right fallback contract.

## Evidence reread

Retained Studio audits and contracts:

- `production-readiness-backlog.md`, PERSIST-01 and AUTOSAVE-01
- `code-architecture-audit.md`, ARCH-05 and ARCH-06
- `workflow-and-feature-audit.md`, WF-03 and persistence-dependent review/media findings
- `start-01-phase-entry.md`
- `start-01-start-surface-audit.md`
- `start-01-integration-independent-review.md`
- `remediation-progress.md`, especially REV-01, REV-02, START-01, and the latest start-surface handoff
- `docs/loora-editor-reference.md`
- `docs/architecture.md` and ADR 0003

Studio code inspected:

- `apps/studio/src/features/editor/current-draft-repository.ts` and its tests
- `apps/studio/src/features/editor/use-document-editor.ts`, including bootstrap, autosave, recovery, Home, replacement, and publication paths
- `apps/studio/src/features/editor/studio-start-model.ts` and `studio-start-surface.tsx`
- `apps/studio/src/features/editor/local-asset-store.ts`
- `apps/studio/src/features/editor/page-thumbnail-raster-producer.ts` and `page-thumbnail-raster-cache.ts`
- `apps/studio/src/server/page-thumbnail-http.ts`
- `apps/studio/src/routes/index.tsx` and the generated route tree
- `packages/editor/src/history.ts`
- `packages/document/src/schema.ts`, `commands.ts`, `publishing.ts`, and `semantic-clone.ts`
- migrations `0001_initial.sql` through `0007_workspace_media_assets.sql`

OpenPencil reference root:

`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/open-pencil`

Exact OpenPencil files inspected:

- `src/app/recent-files/store.ts`
- `src/app/recent-files/thumbnails.ts`
- `src/components/home/HomeWorkspace.vue`
- `tests/engine/app/recent-files/store.test.ts`
- `packages/vue/src/document/workspace/use.ts`
- `packages/vue/src/document/workspace/previews.ts`
- `src/app/storage/workspace/source.ts`
- `src/app/storage/workspace/events.ts`
- `src/app/storage/local-store/{types,store,idb,meta}.ts`
- `src/app/storage/reconcile.ts`

OpenPencil separates recent pointers, document storage, workspace loading, and preview loading. Its previews are visibility driven, concurrency bounded, revision reconciled, and backed by disposable object URLs. Its newer local store atomically writes metadata, body bytes, and optional thumbnail bytes. It records a monotonic local revision, tombstones, sync state, last sync failure, and cache presence.

The useful idea is separation of responsibilities. Studio should not copy OpenPencil's filesystem paths, `.fig` byte format, provider model, or silent memory fallback.

Loora reference root:

`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/loora`

Exact Loora file inspected:

- `packages/editor/src/lib/canvas-client.ts`

Loora persists pending transactions in IndexedDB before network acknowledgement. Writes are ordered so an older pending snapshot cannot land after a newer acknowledgement. It restores pending work, applies it optimistically, rebases it on a newer server base, enters an explicit conflict state when rebase fails, flushes at close and `pagehide`, reacts to online/offline state, and treats realtime messages as invalidation signals rather than authority.

Studio should adopt ordered persistence, explicit state, expected-version writes, and invalidation signals. It should not adopt Loora's network transport or transaction rebase yet. Studio does not yet serialize every document replacement and source-context change as a rebaseable transaction.

## Current truth and risks

The START-01 repository is sound for one document. It validates and migrates an atomic `{ document, sourceContext }` envelope, quarantines corrupt bytes, blocks writes while recovery is active, and preserves old bytes when migration cannot finish. Keep those properties.

It is not a multi-document repository:

- `CURRENT_DRAFT_STORAGE_KEY` has one value. A second document overwrites the first.
- `useDocumentEditor` owns start mode, workspace mode, persistence, recovery, publication, and all edit behavior in one 3,700-line hook.
- Autosave compares the last in-memory `Document` object by reference and writes after 450 ms. It has no durable per-document expected version.
- `SaveStatus` has no conflict state and combines browser durability with server publication sync.
- The only page route is `/`. There is no stable browser URL for a document.
- The start model derives `updatedAt` from the canonical document. A repository needs its own successful-save and last-open timestamps.
- Published snapshots are correctly scoped by exact document ID and content snapshot ID, but the draft repository does not record which local head produced the published version.
- The existing renderer thumbnail endpoint cannot accept `asset:local/*` bytes from IndexedDB. A recent-card preview plan that ignores this will either fail for real user documents or fall back to a misleading Fabric screenshot.
- `Document.revision`, history `snapshotId`, history `operationVersion`, and a durable repository write version are different identities. Reusing any one of them for another purpose recreates ARCH-06.

## Identity contract

Keep these identities separate:

| Identity                | Owner                     | Meaning                                                                                                  |
| ----------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `document.id`           | canonical document        | Stable logical document ID and route parameter.                                                          |
| `document.revision`     | canonical command reducer | Content edit count that may rewind after Undo. It is not a save token.                                   |
| history `snapshotId`    | editor session            | Identity for one local history branch. It is not durable across a fresh open unless explicitly restored. |
| `contentSnapshotId`     | document package          | SHA-256 identity from `deriveDocumentSnapshotId` for exact validated canonical content.                  |
| `draftSnapshotId`       | local repository          | SHA-256 identity for the validated document plus its source context.                                     |
| `recordVersion`         | local repository          | Positive, monotonically increasing compare-and-swap token for one browser document record.               |
| `serverVersion` or ETag | later cloud repository    | Workspace-scoped monotonic server concurrency token. It never comes from `document.revision`.            |
| `sessionId`             | open browser tab          | Identifies the tab that submitted a write or conflict candidate.                                         |

The local repository accepts `expectedRecordVersion`. The later server API accepts `expectedServerVersion` or `If-Match`. A successful local save may contain a document whose numeric revision is lower than the previous save because Undo is valid. `recordVersion` must still advance.

## IndexedDB layout

Use a dedicated database such as `webmcp-studio-documents`. Do not put document records into the existing asset database. Separate databases keep upgrades and quota failures attributable and prevent a document schema upgrade from blocking media access.

Version 1 should contain these stores.

### `draft-meta`

Key path: `documentId`.

```ts
type LocalDraftMetaV1 = Readonly<{
  schemaVersion: 1
  documentId: string
  name: string
  recordVersion: number
  contentSnapshotId: string
  draftSnapshotId: string
  documentRevision: number
  createdAt: string
  savedAt: string
  lastOpenedAt: string
  activityAt: string
  deletedAt: string | null
  pageCount: number
  outputCount: number
  firstPageId: string
  firstPageName: string
  firstPageWidth: number
  firstPageHeight: number
  encodedByteLength: number
  exportFormats: readonly ("png" | "pdf")[]
  sourceKind: "quotation" | "template" | null
  origin:
    | { kind: "blank" }
    | { kind: "template"; templateId: string; templateVersion: number }
    | { kind: "quotation" }
    | { kind: "import" }
    | { kind: "duplicate"; sourceDocumentId: string }
    | { kind: "current-draft-migration" }
  lastPublished: null | {
    templateId: string
    templateVersionId: string
    templateVersion: number
    contentSnapshotId: string
    publishedAt: string
  }
}>
```

Create indexes for `activityAt`, `savedAt`, and `deletedAt`. List active documents newest first by `activityAt`, then `documentId` as a stable tie-break. Use an opaque cursor containing that pair. The first implementation should default to 50 metadata rows and reject limits above 100. Search and source/category filters may run in memory over one bounded page until a dedicated normalized search index exists. Do not read every document body to build the start grid.

`name`, dimensions, counts, formats, and source kind are projections. The write transaction derives them from the validated body. Callers cannot supply contradictory summary values.

### `draft-body`

Key path: `documentId`.

```ts
type LocalDraftBodyV1 = Readonly<{
  schemaVersion: 1
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  draftSnapshotId: string
  encodedByteLength: number
  document: Document
  sourceContext: CurrentDraftSourceContext | null
}>
```

`draft-meta` and `draft-body` must be written in one IndexedDB `readwrite` transaction. The repository validates the document aggregate, source context, exact `document.id`, `contentSnapshotId`, and `draftSnapshotId` before opening the write transaction. `draftSnapshotId` hashes a versioned canonical encoding of `{ contentSnapshotId, sourceContext }`. `encodedByteLength` is the UTF-8 byte count of the exact versioned canonical draft encoding and must match in both rows.

Apply the existing 32 MiB JSON import admission boundary to this canonical draft encoding. Move that limit from `document-import.ts` into a shared document-admission contract rather than creating a second numeric constant. Reject an oversized capture before opening the write transaction, leave the prior committed record unchanged, and keep the current in-memory state available for Download. IndexedDB quota remains a separate runtime failure even below this admission limit.

Inside the transaction the repository reads current metadata, compares `expectedRecordVersion`, computes the next version, and writes both rows. There must never be a committed body and metadata pair with different record versions, snapshot IDs, or encoded lengths.

### `draft-previews`

Key path: `documentId`.

```ts
type LocalDraftPreviewV1 = Readonly<{
  schemaVersion: 1
  documentId: string
  contentSnapshotId: string
  pageId: string
  rendererRevision: string
  width: number
  height: number
  mimeType: "image/png"
  byteLength: number
  createdAt: string
  blob: Blob
}>
```

Preview writes are independent from document saves. A preview failure must not turn a saved document into a failed save. A card may show an older preview only if the UI marks it as updating. It must compare `contentSnapshotId` and must never label stale pixels as the current saved version.

Preview dimensions must satisfy the existing shared `pageThumbnailLimits`: each dimension is at most 512 px and total area is at most 262,144 pixels. Reuse `validatePageThumbnailSize` rather than duplicating its aspect-ratio and bounds logic. Reject a Blob whose observed size differs from `byteLength`.

### `draft-conflicts`

Key path: `conflictId`. Add indexes for `documentId` and `detectedAt`.

```ts
type LocalDraftConflictV1 = Readonly<{
  schemaVersion: 1
  conflictId: string
  documentId: string
  sessionId: string
  expectedRecordVersion: number
  observedRecordVersion: number | null
  baseDraftSnapshotId: string
  observedContentSnapshotId: string | null
  observedDraftSnapshotId: string | null
  candidateContentSnapshotId: string
  candidateDraftSnapshotId: string
  candidate: CurrentDraftSnapshot
  reason: "stale_write" | "deleted_elsewhere" | "migration_collision"
  detectedAt: string
  resolvedAt: string | null
  resolution: "reload_saved" | "save_copy" | null
}>
```

When compare-and-swap fails, store the candidate in this store before reporting conflict. Use the same IndexedDB transaction that observed the stale version. A refresh must not erase the user's candidate. One unresolved candidate per document and session is enough; a later failed attempt may replace that tab's earlier candidate after validation.

### `draft-quarantine`

Key path: `quarantineId`. Add indexes for `documentId` and `detectedAt`.

The record stores the raw metadata and body values when structured cloning permits it, a safe serialized copy when it does not, the failing store/key, an exact decode or invariant failure, and detection time. Copy to quarantine before removing or marking the source rows. If quarantine cannot commit, retain the source rows and report a storage failure.

Missing local or managed image resources are not automatically document corruption. Keep the canonical record and enter the existing missing-resource recovery path. Quarantine applies to malformed storage records, unsupported repository schema, mismatched meta/body identity, or an invalid canonical aggregate.

### `repository-settings`

Key path: `key`.

Use this for migration state and repository format metadata, not for a mutable current-document pointer. The route is the active-document identity. A `lastOpenedDocumentId` may be stored as a convenience, but `/` must remain the explicit start page and must not silently reopen it.

## Repository operations

Keep the repository framework independent. React and TanStack Router consume it; they do not implement storage rules.

```ts
type LocalDraftRepository = {
  open(): Promise<RepositoryOpenResult>
  list(options: ListDraftsOptions): Promise<DraftListPage>
  get(documentId: string): Promise<DraftReadResult>
  create(input: CreateDraftInput): Promise<DraftWriteSuccess>
  save(
    input: SaveDraftInput & { expectedRecordVersion: number }
  ): Promise<DraftSaveResult>
  touchOpened(documentId: string): Promise<DraftMetaResult>
  duplicate(input: DuplicateDraftInput): Promise<DraftWriteSuccess>
  softDelete(
    documentId: string,
    expectedRecordVersion: number
  ): Promise<DraftDeleteResult>
  restore(
    documentId: string,
    expectedRecordVersion: number
  ): Promise<DraftWriteSuccess>
  purge(
    documentId: string,
    expectedRecordVersion: number
  ): Promise<DraftDeleteResult>
  getPreview(documentId: string): Promise<DraftPreviewResult>
  putPreview(input: DraftPreviewInput): Promise<DraftPreviewWriteResult>
  linkPublication(input: LinkDraftPublicationInput): Promise<DraftMetaResult>
  listConflicts(documentId: string): Promise<readonly LocalDraftConflictV1[]>
  resolveConflict(
    input: ResolveConflictInput
  ): Promise<ConflictResolutionResult>
  subscribe(listener: (event: DraftRepositoryEvent) => void): () => void
  close(): void
}
```

Required behavior:

- `open` handles database upgrades, a blocked upgrade, unavailable IndexedDB, and old-current-draft migration. It never hides an error behind an empty list.
- `list` returns validated metadata only, at most the requested bounded page, plus an opaque continuation cursor. Corrupt rows become recovery items or storage errors rather than disappearing.
- `get` reads metadata and body in one transaction, validates matching identity/version/hash, and decodes document migrations. It checks editable resources after the storage transaction and may return `missing_resources` without quarantining a valid canonical record.
- `create` requires a new document ID. An existing ID returns `already_exists`; it never becomes an overwrite.
- `save` is the only ordinary body update. It uses compare-and-swap and returns `saved`, `unchanged`, `conflict`, `deleted`, `validation_failed`, or `storage_failed`.
- `unchanged` requires the same `draftSnapshotId`. It may update `lastOpenedAt`, but it must not increment `recordVersion`.
- `touchOpened` updates activity metadata without changing content identity or `recordVersion`. It reads and writes the latest row in one transaction so it cannot roll metadata backward.
- Rename changes canonical `Document.name` and therefore uses `save`. Do not patch metadata alone.
- Duplicate creates a new document ID, resets canonical revision to zero, sets new creation/update times, keeps nested page/node/group/field IDs because they are document-scoped, validates the aggregate, copies valid source context, and does not copy publication linkage. Managed and local asset references may be shared.
- Soft delete advances `recordVersion`, records `deletedAt`, and broadcasts deletion. A stale open tab cannot save over the tombstone. It may only reload, close, or save its candidate as a new document.
- Purge is a separate, explicit action. It removes metadata, body, preview, and resolved conflicts atomically. Do not expose immediate purge as the ordinary Delete command.
- Preview writes accept only PNG bytes with exact dimensions, byte length, renderer revision, page identity, and current `contentSnapshotId`. A stale preview completion is discarded.
- `linkPublication` patches metadata only when document ID, `recordVersion`, and `contentSnapshotId` still match. It does not increment the content `recordVersion`.
- Every successful mutation publishes a repository event after the IndexedDB transaction completes.

## Save state

Replace the single `SaveStatus` meaning with two independent projections.

Local durability:

```ts
type LocalSaveState =
  | { status: "opening" }
  | { status: "saved"; recordVersion: number; savedAt: string }
  | { status: "saving"; expectedRecordVersion: number }
  | { status: "failed"; message: string; retryable: boolean }
  | {
      status: "conflict"
      conflictId: string
      reason: "stale_write" | "deleted_elsewhere"
    }
  | { status: "session_only"; message: string }
```

Cloud synchronization later:

```ts
type CloudSyncState =
  | { status: "not_configured" }
  | { status: "synced"; serverVersion: number }
  | { status: "pending"; localRecordVersion: number }
  | { status: "syncing"; serverVersion: number }
  | { status: "offline"; pendingCount: number }
  | { status: "failed"; message: string; retryAt: string | null }
  | { status: "conflict"; serverVersion: number }
```

Being offline does not make an IndexedDB save fail. The UI should say `Saved on this device` while cloud state says `Waiting for connection`. A single ambiguous `offline` label would make users unsure whether their work is safe.

## Autosave and critical flush

Autosave starts from settled canonical editor commits, not Fabric events. Keep the existing transaction boundary and replace the direct `localStorage` effect with a per-document save controller.

The controller owns:

- active `documentId`, `recordVersion`, base `draftSnapshotId`, and `contentSnapshotId`;
- one ordered promise chain, so an older async hash or IndexedDB write cannot finish after a newer save and become authoritative;
- a short debounce after a settled history commit;
- exact capture of document and source context;
- cancellation or staleness checks when the route changes;
- retry after quota, transient open, or transaction failure;
- conflict candidate creation when compare-and-swap fails.

Flush before Home, opening another document, replacement, publish, explicit export/download, recovery reset, and route navigation. `pagehide` and `visibilitychange` are best-effort drains, not the only safety mechanism. Browsers do not guarantee that an async IndexedDB write started during page shutdown will finish. Keep normal autosave frequent enough that page shutdown loses at most the current unsettled interaction.

Use a router blocker while a save is in progress, failed, or conflicted. The native unload prompt should appear only when unsaved in-memory work remains. Custom unload text is not reliable in modern browsers.

## Multi-tab contract

Correctness comes from the IndexedDB compare-and-swap transaction. `BroadcastChannel` only shortens the time before another tab notices.

Create one tab `sessionId` and one channel, for example `webmcp-studio-documents-v1`. Broadcast compact events after commit:

```ts
type DraftRepositoryEvent =
  | {
      type: "saved"
      documentId: string
      recordVersion: number
      contentSnapshotId: string
      draftSnapshotId: string
      sessionId: string
    }
  | {
      type: "deleted"
      documentId: string
      recordVersion: number
      sessionId: string
    }
  | {
      type: "restored"
      documentId: string
      recordVersion: number
      sessionId: string
    }
  | {
      type: "preview"
      documentId: string
      contentSnapshotId: string
      sessionId: string
    }
```

Ignore self-originated events. On another tab's event:

- Inactive cards invalidate metadata and preview reads.
- An active clean editor may reload the exact newer record after settling canvas state.
- An active dirty editor does not merge silently. Its next save must fail compare-and-swap, persist a conflict candidate, pause autosave, and show the conflict UI.
- An active document deleted elsewhere becomes conflict state immediately. No autosave may recreate it.

First conflict choices:

1. `Reload saved version`. Require confirmation if a candidate exists. Keep `Download my version` available until resolution commits.
2. `Save my changes as a copy`. Create a new document ID from the candidate, navigate to its route, then mark the conflict resolved.

Do not add automatic last-write-wins or an `Overwrite` primary action. Do not claim collaborative merge. A later transaction rebase can be added only after every editor mutation, template application, import, source-context update, and structure replacement has one serializable command contract.

Test correctness with two repository instances and two session IDs against the same fake IndexedDB database. Broadcast delivery alone is not a valid conflict test.

## Migration from START-01

The current atomic envelope is the only legacy source to migrate into the new repository. Reuse `bootstrapCurrentDraft`, `decodeCurrentDraftEnvelope`, strict source-context validation, and current recovery precedence.

Migration order:

1. Open IndexedDB. If its upgrade is blocked, return a visible `blocked` result that asks the user to close the other Studio tab and retry.
2. Read the existing recovery key first. If owned recovery exists, stop. Do not create an empty repository and do not consume current-draft bytes.
3. Decode the current envelope or legacy document through the existing migration path.
4. Validate the canonical aggregate and source context. Do not make migration depend on network resource availability. Missing local or managed resources remain a separate open-time recovery state.
5. Derive `contentSnapshotId`, `draftSnapshotId`, and metadata.
6. In one IndexedDB transaction, write metadata/body and a setting such as `migration.currentDraftV1 = { documentId, draftSnapshotId, completedAt }`.
7. Read the new record back through the public `get` path and require exact ID and draft snapshot identity. The read may report missing resources without invalidating the migrated canonical record.
8. Remove old localStorage keys only after the read-back succeeds. Cleanup is best effort. The IndexedDB migration setting makes a retry idempotent if localStorage cleanup fails.

Collision behavior matters. If IndexedDB already contains the same document ID and `draftSnapshotId`, mark migration complete without rewriting. If it contains the same ID with a different draft snapshot, preserve the old envelope as a `migration_collision` conflict candidate and keep localStorage unchanged. Never overwrite one valid copy because migration happened twice.

Do not migrate the old one-draft key into a `recentDocuments` pointer array. The migrated document itself is the recent record.

## Start page and routes

Use these client routes:

- `/` for the explicit start page
- `/documents/$documentId` for one editor session

Both routes remain `ssr: false` because IndexedDB, Fabric, gestures, and shell preferences are browser owned.

The start route loads metadata first. It has explicit loading, storage-blocked, storage-unavailable, recovery, empty, and ready states. Search, list/grid preference, and previews do not block the metadata list. A failed open leaves the user on the start page, reports the exact document, and keeps Rename, Duplicate, Download recovery bytes, and Delete available when safe.

The document route validates the route ID before opening a session. Unknown, quarantined, or deleted IDs return to `/` with a persistent error rather than installing the private bootstrap document under the requested URL.

Route changes own session lifecycle:

1. settle crop, text, transform, and guide interactions;
2. flush the current repository record;
3. close subscriptions and revoke resource URLs;
4. load and validate the next record;
5. create fresh editor history for that document;
6. set `lastOpenedAt` only after successful installation;
7. focus the canvas or start-page card after navigation completes.

The current hook should receive an opened repository record and session controller. It should stop bootstrapping the global current-draft key itself. Do this extraction before adding cloud sync. Keeping routes, repository state, and every editor command in `useDocumentEditor` would make stale closure bugs much harder to contain.

## Preview contract

Recent previews are derived artifacts. They do not belong in the canonical document or undo history.

Use the first ordered page, the same output/page ordering used by `deriveCurrentDraftSummary`, and a bounded card size. Queue visible and near-visible cards only. Start with concurrency two, deduplicate by `documentId + contentSnapshotId + rendererRevision + dimensions`, abort work when a card leaves the retained window, and revoke every object URL on replacement, removal, or unmount. OpenPencil's `workspace/previews.ts` is the pattern to follow.

For documents whose resources the authenticated server renderer can resolve, reuse `/v1/studio/page-thumbnail` and preserve its exact header, byte-length, dimension, page, and renderer-revision checks. Store the returned PNG only if the repository still has the same `contentSnapshotId`.

Documents containing `asset:local/*` need a separate exact local preview producer because the Worker cannot read IndexedDB blobs. Until a canonical local producer passes render-view and image-resource conformance, show a stable placeholder. Do not store a Fabric viewport screenshot and call it a document preview. It can contain selection handles, zoom-dependent pixels, missing offscreen content, or stale local object URLs.

Preview errors stay on the card with retry. They do not demote local save state. Keep the last exact older preview while a new one is generating, but visibly mark it as updating.

## Publication linkage

Publishing already derives an exact `sourceSnapshotId` and stores immutable audit revisions by `(document_id, snapshot_id)`. Preserve that.

Before publish:

1. settle the editor;
2. flush the draft through compare-and-swap;
3. publish the exact saved `contentSnapshotId` and canonical document;
4. reject publication if the in-memory snapshot differs from the saved record returned by flush.

After the server returns the authoritative template version, update `lastPublished` in local metadata only if `documentId`, `recordVersion`, and `contentSnapshotId` still match. A user edit that lands while publish is in flight must not make the newer draft look published.

The later cloud API should record the draft head's `serverVersion` and `contentSnapshotId` on publish. The immutable `document_revisions` table remains publication/audit history; it must not double as the mutable draft head.

## Failure modes

| Failure                                       | Required result                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| IndexedDB getter/open denied                  | Start shows session-only or recovery state. No fake empty repository and no silent memory durability.                                 |
| Database upgrade blocked by another tab       | Close the attempted connection, show `Close the other Studio tab and retry`, and retain old storage.                                  |
| Unsupported repository schema                 | Quarantine readable rows, preserve raw values, and stop normal open.                                                                  |
| Metadata/body version or snapshot mismatch    | Quarantine both rows atomically. Do not guess which is newer.                                                                         |
| Canonical decode or aggregate failure         | Quarantine the stored record and provide Download/Retry/Delete recovery actions.                                                      |
| Local or managed resource temporarily missing | Keep the document record and use missing-resource recovery. Do not classify it as malformed storage.                                  |
| Quota or transaction abort during save        | Previous committed record remains authoritative; current editor state stays in memory; status becomes failed with Retry and Download. |
| Stale expected version                        | Store the candidate, enter conflict, pause autosave, and offer Reload or Save as copy.                                                |
| Deleted record receives a stale save          | Return `deleted_elsewhere`. Never clear the tombstone or recreate the same ID.                                                        |
| Preview render fails                          | Keep save state unchanged, retain any older exact preview, show Retry or placeholder.                                                 |
| Route target missing                          | Return to start with a persistent not-found message. Never substitute the sample or a private bootstrap document.                     |
| Migration cleanup fails                       | New repository record remains valid; old bytes remain; idempotent migration marker prevents duplication.                              |
| BroadcastChannel unavailable                  | Repository remains correct through compare-and-swap. Refresh on focus and before save.                                                |
| Browser closes during debounce                | Frequent settled-transaction saves bound exposure; `pagehide` attempts a final drain but is not claimed as guaranteed.                |

## First implementable slice

Implement PERSIST-01A before changing the start grid or routes.

Scope:

1. Add a framework-independent IndexedDB repository with `draft-meta`, `draft-body`, `draft-previews`, `draft-conflicts`, `draft-quarantine`, and `repository-settings`.
2. Implement `open`, `list`, `get`, `create`, `save(expectedRecordVersion)`, `touchOpened`, `softDelete`, and conflict-candidate reads. Preview methods may return `missing`; cloud fields do not exist yet.
3. Reuse current envelope/source validation and `deriveDocumentSnapshotId`. Add a versioned `draftSnapshotId` derivation over exact content identity plus source context.
4. Add idempotent migration from the current atomic localStorage envelope. Keep the current start UI showing one current card during this slice, but source it through the new repository adapter after migration.
5. Replace direct `writeCurrentDraft` autosave with an ordered per-document save controller. Keep the UI on `/` temporarily. Expose saved, saving, failed, conflict, and session-only states.
6. Add same-database two-instance tests for stale save and delete resurrection. Persist the losing candidate.
7. Do not delete `current-draft-repository.ts` until migration, recovery, rollback, and downgrade tests prove the new path. Treat it as a legacy decoder after cutover.

IndexedDB opens asynchronously. Keep the shell in an explicit repository-loading start state until migration and the selected record finish validation. Do not install the private bootstrap document as an editable session while this work is pending, and do not let the autosave controller observe it.

PERSIST-01A acceptance tests:

- atomic body/meta create and save;
- same-content no-op without version increment;
- Undo content with a lower `Document.revision` still increments `recordVersion`;
- source-context change changes the saved record even if canonical document content matches;
- a draft whose canonical UTF-8 encoding exceeds the shared 32 MiB admission limit is rejected before a transaction and preserves the prior record;
- failed transaction leaves the prior pair byte-equivalent;
- metadata/body mismatch quarantine;
- malformed body and unsupported schema quarantine;
- unavailable, blocked, abort, and quota outcomes;
- current-envelope migration, legacy migration, cleanup failure, idempotent retry, identical collision, and different-content collision;
- two tabs saving from version 1, exactly one version-2 winner, one durable conflict candidate;
- stale save after soft delete cannot resurrect the document;
- ordered save controller cannot let an older completion replace a newer capture;
- list ordering and cursor continuation remain stable when multiple records share `activityAt`, and a requested limit above 100 is rejected;
- session-only acknowledgement remains truthful when IndexedDB is unavailable.

This slice changes persistence mechanics without simultaneously changing routing, recent-card UI, deletion UX, and preview rendering. It is a safer review boundary and leaves the current START-01 recovery path available.

## Later local slices

PERSIST-01B adds `/documents/$documentId`, a real multi-document start list, Create/Open/Rename/Duplicate/Soft delete/Restore, route blockers, exact focus behavior, and the visible conflict dialog. At this point the current one-draft card can become a real recents collection.

PERSIST-01C adds durable previews, visibility-bounded loading, stale preview labeling, local-asset preview conformance, storage estimates, and purge/retention policy.

PERSIST-01 is locally complete only after A, B, and C pass independent code review plus healthy-browser reload, Back/Forward, multi-tab, blocked-upgrade, quota, and preview tests.

## Later cloud synchronization

Do not put cloud calls inside the IndexedDB repository. Add a separate sync controller after the local contract is stable.

The existing D1 `documents.current_revision` column cannot be the cloud concurrency token because canonical revision may rewind. The existing `document_revisions` table is an immutable publication audit keyed by snapshot ID. Keep it that way.

The current D1 `documents.id` is a server storage ID. `documents.public_id` is the canonical `Document.id`, and migration 0003 already makes `(workspace_id, public_id)` unique. A cloud draft API must resolve that workspace-scoped public ID to the internal row before reading or writing a head. The publish repository currently creates or updates the `documents` row when the first immutable version is stored. Cloud draft creation will create that row earlier, so the publish upsert must remain compatible and must never overwrite the mutable draft head.

A cloud phase needs a draft-head schema similar to:

```sql
CREATE TABLE document_draft_heads (
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  server_version INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  document_json TEXT NOT NULL,
  source_context_json TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, document_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE document_draft_mutations (
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  expected_server_version INTEGER NOT NULL,
  resulting_server_version INTEGER,
  snapshot_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, document_id, idempotency_key)
);
```

Exact D1 decisions still require a separate migration review, but these rules are fixed:

- Every read and write is workspace scoped.
- Update uses one conditional statement such as `WHERE server_version = ?` and checks affected rows.
- Delete writes a tombstone with a new server version. A stale client cannot recreate the same head.
- Idempotency keys converge retries.
- The server derives and validates `snapshot_id`; the client cannot claim it.
- A publish request records the exact draft `server_version` and snapshot ID it froze.
- Managed-media `current_document` references update in the same trusted server transaction as the accepted draft head.
- An offline outbox persists locally before the network call and keeps writes ordered, following Loora's pending-persistence pattern.
- First cloud sync may send whole validated snapshots with expected server version. Do not promise transaction rebase until every Studio mutation is serializable and tested for rebase.

Cloud acceptance must cover offline edit/restart, reconnect retry, stale server version, idempotent retry, remote delete, two clients, publication from a stale head, and preservation of both conflict candidates.

## Review gates

Static and fake-IndexedDB gates:

- repository and migration tests;
- two-instance conflict tests;
- hook/session save-controller tests;
- document, editor, Studio, WebMCP, renderer, and worker-boundary suites;
- package typechecks, lint, Prettier, and `git diff --check`.

Healthy-browser gates:

- first load and migration with exact read-back;
- refresh at saved, saving, failed, and conflict states;
- browser Back/Forward and direct document URL;
- two real tabs editing, deleting, reloading, and saving a copy;
- blocked IndexedDB upgrade and recovery after the other tab closes;
- storage quota failure with Download and retry;
- start list loading, empty, error, search, grid/list, keyboard, and focus states;
- exact/stale/missing preview behavior at 320, 390, 1280, and 1440 px;
- local-image document behavior without a fake preview;
- publish only after the exact draft flush.

Do not mark PERSIST-01 complete from unit tests alone. IndexedDB upgrade blocking, tab delivery, route lifecycle, shutdown behavior, and object URL cleanup need a real browser.
