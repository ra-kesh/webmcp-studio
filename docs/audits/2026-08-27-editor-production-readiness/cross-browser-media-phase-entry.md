# Cross-browser local media phase entry

Date: 2026-08-30

Status: audit complete; implementation has not started

Ledger boundary: row 10, Cross-browser local media

## Outcome

Give a browser-local `asset:local/{id}` reference one safe path to become a
workspace-managed `asset:managed/{id}` reference. The browser that owns the
bytes uploads them once. Studio then records a durable workspace mapping from
the local alias to the managed asset, relinks every occurrence in one canonical
document mutation, and lets another browser recover the same reference without
possessing the original IndexedDB Blob.

This phase does not turn IndexedDB into shared storage. It removes IndexedDB
from the long-term identity path after promotion while preserving the existing
local upload, managed repository, renderer, archive, and history contracts.

## Evidence reread

- `remaining-product-work-2026-08-29.md`, especially row 10. Managed media is
  shared now; local media is not. Promotion, missing-byte recovery, and safe
  cross-browser relinking are the remaining product boundary.
- `media-01-implementation-audit.md`, `media-01-ux-audit.md`,
  `media-01-browser-acceptance.md`, and
  `media-01-browser-independent-review.md`. MEDIA-01 already established opaque
  managed identity, retained archived bytes, strict renderer materialization,
  local missing-file UI, reusable media, geometry-safe replacement, and 18
  passing browser journeys.
- `fail-01a-foreground-export-lifecycle.md`,
  `fail-01c-export-prerequisite-cancellation.md`,
  `fail-01e-import-lifecycle.md`, and
  `fail-01f-managed-upload-lifecycle.md`. Cancellation owns and awaits local
  IndexedDB work, managed upload retries reuse one idempotency key, timeout and
  network loss report unknown commit status, and retries reconcile before
  starting another mutation.
- `packages/document/src/media.ts`, `schema.ts`, `commands.ts`, `fields.ts`,
  `publishing.ts`, and `validation.ts`. Managed image identity is strict;
  `assetId` must match the ID encoded in `src`. Asset fields can contain local
  or managed references. Bound source fields project both `src` and managed
  `assetId`.
- `local-asset-store.ts`, `local-asset-model.ts`,
  `asset-library-model.ts`, `asset-mutation-transaction.ts`,
  `media-selection-model.ts`, `managed-media-repository.ts`, and
  `use-document-editor.ts`. The local repository has split metadata/Blob
  stores, record quarantine, decoded-byte verification, missing-byte state,
  abort-aware reads, revision-checked archive, and retained bytes. It has no
  content hash, promotion checkpoint, server mapping, or relink operation.
- `migrations/0007_workspace_media_assets.sql`, `media-assets.ts`,
  `media-asset-repository.ts`, `media-asset-http.ts`,
  `render-field-assets.ts`, and `template-repository.ts`. D1 owns workspace
  metadata and references. R2 keys are private and content-derived. Uploads are
  SHA-256 deduplicated and request-idempotent. Publication stores exact managed
  references, and render materialization verifies R2 bytes before Browser
  Rendering.
- The focused local-store, mutation, managed-client, media-model, selection,
  repository, HTTP, publication-reference, renderer-materialization, history,
  and MEDIA-01 Playwright tests. They protect the foundations above but do not
  exercise promotion or a second browser without local bytes.

## Current truth and the exact gap

The two repositories are individually credible:

- `local-asset-store.ts` version 4 stores one local ID, validated metadata, and
  one Blob in browser IndexedDB. `getLocalAssetRecord` returns `null` for absent
  or quarantined bytes. No durable server identity is attached to the record.
- `MediaAssetRepository.upload` validates the image, hashes the authoritative
  bytes, deduplicates within the workspace, writes a deterministic private R2
  key, and records idempotency in D1. It knows nothing about the local alias in
  the source document.
- `assetReferenceUsage` and `localAssetUsage` find current-document image-node
  and asset-field references. They are impact projectors, not a durable
  cross-document or cross-browser index.
- `replace_image_source` changes one unbound image. It correctly refuses a
  source-bound layer. `set_field` can change one field and reproject its bound
  nodes. Neither command can migrate every occurrence of a local alias as one
  semantic operation.
- Current publication and export policy correctly block unresolved local
  aliases. Published immutable versions therefore need no rewrite. They either
  already contain managed IDs or publication never completed.
- The server's `current_document` media references are written during template
  publication. They are not an authoritative inventory of every local
  IndexedDB draft in every browser.

A normal image replacement is the wrong mechanism. A local alias can occur in
an unbound image node, an asset-field default, the live field value, and one or
more bound image nodes. Applying today's commands in sequence can expose an
intermediate document where a managed `src` and `assetId` disagree, or it can
leave a field definition pointing at the old local alias. Promotion needs one
document-domain command that validates and replaces the complete reference set
before aggregate validation runs.

## Non-negotiable invariants

1. A promotion binds one workspace-local alias to one SHA-256 content identity
   for its lifetime. The same alias with different bytes is a conflict, never a
   replacement.
2. The Worker computes the content hash, media type, dimensions, and byte count
   from the uploaded bytes. Browser metadata is advisory.
3. A committed promotion mapping points only to an owned managed asset whose R2
   object passed the existing admission contract. No mapping points at a staged
   or failed upload.
4. One local alias may map to a managed asset already created by content-hash
   deduplication. Promotion does not require a second R2 object or asset ID.
5. A relink changes identity and source only. It preserves node IDs, names,
   pages, outputs, stacking, groups, bindings, geometry, placement, crop, mask,
   opacity, visibility, lock state, decorative state, alternative text, and
   alternative-text provenance.
6. Relinking a field changes both its default and current value only where each
   exactly equals the source local alias. Bound nodes are projected from the
   resulting field values inside the same command.
7. The command rejects a local image whose `src` names the alias but whose
   `assetId` names another identity. Repair code must not guess which property
   is authoritative.
8. Promotion never deletes or archives local bytes. History, an older draft,
   another local document, or a failed persistence attempt may still require
   them.
9. Undo reverses the document relink only. It does not delete the managed asset,
   remove the D1 alias mapping, or delete R2 bytes. Redo reuses the same managed
   ID and performs no upload.
10. Another browser may resolve a committed mapping without local bytes. It may
    not discover arbitrary workspace aliases, read a private R2 key, or receive
    a renderer data URI.
11. Archived managed assets remain valid recovery targets for a previously
    committed local mapping. They are not selectable for unrelated new use.
12. Physical deletion remains disabled. A local alias mapping, local history,
    or a document not yet opened on another browser is enough reason to retain
    the managed bytes.

## Domain command

Add one canonical command, named here `relink_asset_references`:

```ts
type RelinkAssetReferencesCommand = {
  id: string
  type: "relink_asset_references"
  actor: "human" | "agent" | "api"
  at: string
  from: `asset:local/${string}`
  toAssetId: ManagedAssetId
  toSource: `asset:managed/${ManagedAssetId}`
  expectedReferenceKeys: string[]
}
```

`expectedReferenceKeys` contains the sorted logical paths found during
preflight, for example `node/{nodeId}/src`, `field/{fieldId}/default`, and
`field/{fieldId}/current`. The command extracts the paths again from the
current canonical document. It rejects if the set changed, the managed pair is
incoherent, the local node identity drifted, or no source occurrence remains.

The command constructs the complete next document before validation:

1. Replace matching field defaults and current values.
2. Replace matching unbound image-node `assetId` and `src` pairs.
3. Project bound field values so their image nodes receive the same managed
   pair.
4. Validate the complete document once.

Do not implement this as a list of `set_field` and `replace_image_source`
commands. The ordinary replacement binding guard remains correct and must not
be weakened. Promotion is a separate aggregate identity migration.

An exact replay after every source path already points at the target is an
idempotent outcome for the promotion coordinator. The coordinator must detect
that state and skip command dispatch. The command continues to reject a request
with no matching source occurrence, so an accidental stale call cannot create a
revision or history entry.

## Durable promotion mapping

Add a migration after the current migration head with a table equivalent to:

```text
media_asset_local_promotions
  workspace_id       required workspace foreign key
  local_asset_id     bounded local alias, primary key within workspace
  asset_id           composite workspace/asset foreign key
  created_at         server timestamp
  updated_at         server timestamp
  created_by         bounded audit principal identity
```

Required constraints and indexes:

- primary key `(workspace_id, local_asset_id)`;
- foreign key `(workspace_id, asset_id)` to `media_assets`, with delete
  restricted;
- add one shared `localAssetIdSchema` for a 1-to-128-character conservative ID
  and use it in document references, the local repository, and the route;
- index `(workspace_id, asset_id)` for impact and repair inspection.

The mapping is committed in the same D1 batch that wins or adopts the managed
asset and records the upload idempotency request. If the asset already exists
by content hash, the batch adds only the missing request and mapping rows. A
same-alias, same-hash race returns the existing mapping. A same-alias,
different-hash race returns `409 local_asset_alias_conflict` and changes
nothing. Mapping reads join `media_assets` for the authoritative content hash;
do not duplicate that hash in two D1 rows that can drift.

R2 remains unchanged. Promotion reuses the existing immutable key:

```text
media/workspaces/{workspaceId}/content/{sha256}/original
```

The D1 transaction may fail after R2 accepts bytes. Follow the existing managed
upload rule: never delete the deterministic object from a race loser. A retry
with the same bytes reuses it. Orphan reclamation stays outside this phase.

## HTTP and client repository contract

Add authenticated, same-origin Studio routes with the canonical API error
envelope and request ID:

| Method | Route                                              | Contract                                                                                                                                                             |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/studio/assets/local-promotions`               | Multipart image plus bounded `localAssetId`; stable `Idempotency-Key`; authoritative validation; returns the managed metadata and committed mapping.                 |
| `GET`  | `/v1/studio/assets/local-promotions/:localAssetId` | Exact workspace-scoped reconciliation and missing-byte recovery. Returns ready or archived managed metadata, or not found.                                           |
| `POST` | `/v1/studio/assets/local-promotions/resolve`       | Bounded batch lookup for document admission. Input is at most 100 distinct local IDs. Output preserves request order and distinguishes mapped from unmapped aliases. |

Authentication and upload admission run before multipart parsing. The existing
25,000,000-byte source limit, media allowlist, dimension and pixel bounds,
request rate/concurrency admission, and server byte inspection remain in force.
The promotion response includes `localAssetId`, `assetId`, the authoritative
content SHA-256, managed status and revision, and public managed metadata. The
hash is required to distinguish a healthy matching local Blob from an alias
collision. Responses never include an R2 key, object URL, signed URL, data URI,
or image bytes.

The local promotion client stores a journal record before network work starts:

```ts
type LocalPromotionJournal = {
  localAssetId: string
  contentSha256: string | null
  idempotencyKey: string
  attempt: number
  state:
    | "queued"
    | "hashing"
    | "uploading"
    | "status_unknown"
    | "mapped"
    | "relinking"
    | "complete"
    | "cancelled"
    | "failed"
    | "conflict"
  managedAssetId: string | null
  sourceDocumentId: string
  sourceSnapshotId: string
  expectedReferenceKeys: string[]
  errorCode: string | null
  updatedAt: string
}
```

Use a separate versioned IndexedDB store. Do not add partially optional fields
to `LocalAssetSummary` and then make every inventory record carry operation
state. The journal uses revision compare-and-swap plus a finite owner lease so
two tabs cannot both publish stale local progress. Server idempotency remains
the final race authority.

## Promotion and relink flow

The visible action is **Make available everywhere**. It appears for a healthy
local upload and for a document-level missing-media repair when a local Blob is
still available.

1. Capture the document ID, canonical snapshot ID, operation version, local
   asset revision, complete reference-key set, review/crop state, and current
   draft record version.
2. Read and verify the local record through `getLocalAssetRecord`. Decode the
   bytes with the existing limits. Hash the exact Blob. If another local record
   or retained document claims the same local ID with contradictory known
   metadata, stop with a conflict.
3. Persist the journal, stable idempotency key, content hash, and source anchor.
   If this checkpoint fails, do not start the network request.
4. Reconcile the exact alias first. If a matching committed mapping exists,
   skip upload. If it exists with a different content hash, stop with
   `local_asset_alias_conflict`.
5. Otherwise upload through the promotion endpoint. Reuse the managed upload
   queue's bounded concurrency, progress, timeout, cancellation, retryability,
   and unknown-status rules.
6. Persist the returned managed ID and `mapped` state before touching the
   document.
7. Refetch the exact managed metadata. Accept `ready`; accept `archived` only
   because this exact committed promotion mapping proves prior use. Reject
   unknown, foreign, failed, or incoherent metadata.
8. Recheck the captured document, local asset revision, review/crop state, and
   exact reference-key set. If anything changed, retain the mapping and show
   **Backed up, relink not applied** with Retry. Do not upload again.
9. Commit one `relink_asset_references` history transaction. Label it
   `Make image available everywhere` and report the exact reference count.
10. Await the critical draft flush. Promotion is complete only after the
    current browser has durably stored the relinked draft. A save failure leaves
    the journal at `relinking`, keeps the managed mapping, and exposes Retry.
11. Keep the local Blob, alias metadata, journal, and mapping. Marking the local
    card as promoted is metadata only; it does not archive it automatically.

Managed asset `lastUsedAt` is updated once after the relinked draft commit. A
retry that observes the already relinked document and the same managed mapping
must not issue another `/used` mutation.

## Safe migration across documents and browsers

One browser cannot safely rewrite another browser's IndexedDB. The first slice
must use the durable alias mapping as the bridge and migrate each document at a
real ownership boundary.

### Active document

A user-triggered promotion relinks every occurrence in the active document as
one history transaction and then flushes that document. No other open document
is mutated in the background.

### Inactive documents on the same browser

The document library may count exact local references by reading validated
draft bodies. It may show which documents still need relinking. It must not
rewrite closed drafts with an unguarded loop.

When one of those documents opens, draft admission batch-resolves its local
aliases. An exact mapping may be applied before the editor history owner is
installed. The repository writes the migrated body with an expected record
version and retains the pre-migration body in a bounded recovery receipt. A
compare-and-swap conflict leaves the draft untouched and retries admission from
the newer body.

### Another browser

The second browser has no local Blob. On document admission it extracts every
local alias and calls the bounded resolve route:

- An exact committed mapping is an identity migration. Admission relinks all
  matching references before installing editor history, stores a migration
  receipt, and persists the canonical managed document with compare-and-swap.
- An unknown alias remains a deliberate missing-media reference. The editor
  installs its existing placeholder and repair controls. It does not invent a
  managed ID or silently remove the layer.
- A malformed alias, incoherent local node identity, conflicting mappings, or
  unavailable repository blocks automatic migration and enters explicit
  recovery.

An already mounted editor never changes because another tab or browser created
a mapping. It shows **Studio copy available** and lets the user apply the same
one-step relink command. This preserves local history ownership.

Imports follow the same admission path. Exported JSON is not rewritten before
validation, and WebMCP continues to redact and reject local IDs until admission
has produced a canonical managed document.

## Missing-byte recovery

The document, Inspector, canvas placeholder, and Media surface must agree on
one state:

| Local bytes            | Promotion mapping  | Required behavior                                                                                                            |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Healthy                | None               | Render locally. Offer **Make available everywhere**, ordinary replacement, or removal where valid.                           |
| Healthy                | Same verified hash | Use the local preview. Relink automatically during admission or by one user action in a mounted editor. Do not upload.       |
| Healthy                | Different hash     | Show an identity conflict. Offer **Use Studio copy** or **Keep this file as a new upload**. Never overwrite either identity. |
| Missing or quarantined | Ready mapping      | Show **Studio copy available** and relink all exact uses.                                                                    |
| Missing or quarantined | Archived mapping   | Show **Studio backup found**. Permit exact recovery and rendering, but do not add the asset to ordinary selection.           |
| Missing or quarantined | No mapping         | Keep the missing placeholder. Offer **Locate file**, **Choose Studio image**, and context-valid remove or clear actions.     |
| Repository unavailable | Unknown            | Preserve the placeholder and local document. Show Retry. Do not report that no backup exists.                                |

**Locate file** first hashes and validates the selected bytes. If they match a
known promotion mapping, restore the local Blob and relink to that managed ID.
If they differ, create a new local identity or upload a new managed asset and
relink only after an impact review. Never put different bytes back under an old
local ID because another document, history entry, or browser may still use it.

For a source-bound image, recovery edits the owning asset field through the
aggregate relink command. For a required field, clearing is unavailable. For
an optional unbound occurrence, removal or clearing is one canonical command
with the exact impact shown first.

## History, idempotency, cancellation, and errors

### History

- Manual relink in a mounted editor creates one history checkpoint, regardless
  of node, field, page, or output count.
- Undo restores the exact prior document. If this browser no longer has local
  bytes, the restored state truthfully shows the missing placeholder. The
  confirmation says this before relinking from a missing state.
- Redo reapplies the managed identity from the retained mapping. It performs no
  upload and does not create a second managed asset.
- Admission-time migration runs before history exists. It records a repository
  migration receipt and retains a recoverable preimage instead of inventing an
  Undo entry that the user never performed.
- If the history byte budget cannot retain the transaction, the operation may
  still commit, but UI must not promise Undo. The existing `undoable` commit
  result is authoritative.

### Idempotency

- Generate and persist one idempotency key before the first request. Every
  upload retry for that local alias and byte hash reuses it.
- The server checks both idempotency-key request identity and the
  workspace/local-alias content binding.
- Reconciliation checks the exact alias mapping before any retry. A mapped
  result resumes at relink. An unmapped result with retained bytes retries the
  same upload. An unmapped result without bytes stays missing.
- A completed document relink is recognized by the absence of source paths and
  the presence of the exact managed paths. Replay is a no-op.

### Cancellation

- Hashing, local reads, mapping lookup, and upload are cancellable. The owner
  stays `cancelling` until FileReader, IndexedDB, fetch, or XHR acknowledges
  abort.
- XHR abort cannot prove that the Worker did not commit. Active upload cancel,
  timeout, and network loss reconcile the mapping and therefore may end at
  `status_unknown` or `mapped`, not a false `cancelled`.
- Once D1 commits the mapping, cancellation never removes the managed asset or
  mapping. It may stop before document relink and leave **Backed up, relink not
  applied**.
- Document commit plus critical draft flush is a non-cancellable finishing
  phase. Navigation and a second attempt stay blocked until it settles.
- Unmount, document replacement, review entry, crop entry, or a newer attempt
  invalidates UI publication from the old owner. Late completion may update the
  durable journal only under its compare-and-swap; it cannot mutate the new
  editor session.

### Stable error identity

At minimum, retain these codes through the canonical API envelope and local
operation state:

| Code                                          | Retry rule                                                            |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `local_asset_missing`                         | Retry only after locating bytes or finding a mapping.                 |
| `local_asset_corrupt`                         | Deterministic. Choose another file or use a mapped Studio copy.       |
| `local_asset_alias_conflict`                  | Deterministic. Requires an explicit identity choice.                  |
| `local_promotion_checkpoint_failed`           | Retry after local storage recovers. No network request was sent.      |
| `local_promotion_busy`                        | Retry after the owning tab settles or its finite lease expires.       |
| `local_promotion_status_unknown`              | Reconcile the exact mapping before any upload retry.                  |
| `local_relink_conflict`                       | Reload the latest document and recompute impact. Do not upload again. |
| `local_relink_persistence_failed`             | Retry the critical draft flush. Keep the mapping and local bytes.     |
| Existing upload validation and capacity codes | Preserve their current deterministic or retryable classification.     |

Every server error includes `X-Request-Id`, stable `code`, bounded message,
`retryable`, and field issues where applicable. The journal retains the request
ID and stable code, not response bodies or stack text.

## Bounded implementation sequence

### Slice 1: domain relink and reference extraction

- Add the aggregate command and one shared extractor for local and managed
  node, field-default, and field-current paths.
- Keep ordinary image replacement and binding rules unchanged.
- Add one-step history, Undo, Redo, replay, incoherent-identity, bound-field,
  and expected-path conflict tests.

Exit gate: a complex multi-page document with duplicate direct and bound uses
relinks without changing any non-identity property, and one Undo restores the
exact original document.

### Slice 2: D1 mapping and promotion repository

- Add the constrained mapping migration and repository methods.
- Add exact and batch lookup plus the promotion upload route.
- Reuse existing R2 keys, validation, upload admission, idempotency, and
  canonical API errors.

Exit gate: same-alias/same-bytes retries return one mapping and asset;
same-alias/different-bytes returns a deterministic conflict; no response leaks
private storage identity.

### Slice 3: local journal and promotion owner

- Add the versioned IndexedDB journal, compare-and-swap lease, hashing,
  reconciliation, progress, cancellation, unknown-status, and retry owner.
- Keep the Media dialog mounted and use the existing queue conventions.

Exit gate: refresh, tab competition, cancel, timeout, and network loss resume
from the journal without duplicate upload or stale editor mutation.

### Slice 4: active-document relink and persistence

- Add **Make available everywhere** and the mapped-but-unrelinked recovery
  state.
- Recheck the full document anchor after upload, commit once, and await the
  critical draft flush.
- Update managed Recent exactly once after durable relink.

Exit gate: one action promotes and relinks every current-document use; stale
document state leaves a reusable mapping and an unchanged document.

### Slice 5: admission and missing-byte recovery

- Batch-resolve local aliases during draft open and import admission.
- Add migration receipts, expected-version persistence, and mapped recovery for
  ready and archived assets.
- Complete Locate, Use Studio copy, new-identity replacement, clear, and remove
  behavior for nodes and fields.

Exit gate: a second browser with empty asset IndexedDB opens the same local
reference, obtains the committed mapping, and persists a coherent managed
document without receiving local or R2 bytes.

### Slice 6: browser and deployed evidence

- Add two-browser-context journeys, multi-tab races, failure injection, and
  cross-browser export/publication.
- Run against real Access, D1, R2, and multipart upload in the deployed Studio.

Exit gate: all local and deployed checks below pass, an independent P0/P1
review accepts the implementation, and only then may ledger row 10 close.

## Exact acceptance gates

### Domain and history

- Extract duplicate local references from image nodes, field defaults, current
  values, bound nodes, pages, and outputs with stable sorted keys.
- Reject malformed aliases, mixed local identities, target managed mismatch,
  changed expected paths, and partial field migration.
- Preserve every non-identity property byte-for-byte.
- Commit one history entry. Undo and Redo perform zero repository calls.
- Exercise an intentionally tiny history byte budget and assert that UI does
  not promise unavailable Undo.

Run the new focused domain suite with the existing command and history suites:

```sh
bunx vitest run packages/document/test/media-relink.test.ts packages/document/test/commands.test.ts packages/editor/test/history.test.ts
```

### IndexedDB and operation ownership

- Upgrade from current version 4 without changing metadata or Blob records.
- Persist the journal before upload; inject journal failure and assert zero
  network calls.
- Abort hash/read/open/transaction work and wait for acknowledgement.
- Resume `mapped` and `relinking` states after reload.
- Prove two tabs cannot publish stale progress, and lease expiry does not let a
  late owner overwrite the winner.
- Quarantine and missing-byte behavior remain available while promotion state
  is corrupt or unavailable.

### D1, R2, and HTTP

- Apply the new migration after migrations 0001 through 0011 and inspect table,
  checks, composite foreign key, indexes, and foreign-key enforcement.
- Reject authentication, rate, concurrency, length, multipart, local-ID, MIME,
  checksum, decode, dimension, and pixel errors before an invalid D1 mapping is
  visible.
- Cover new asset, content-hash duplicate, archived duplicate, same-key replay,
  key reuse with different request, same-alias race, alias conflict, D1 failure
  after R2, and R2 failure before D1.
- Exact and batch lookup are workspace-isolated and accept archived mappings
  only for recovery.
- Archive retains mapped bytes and renderer resolution. Physical R2 delete is
  never called.
- Every response uses the canonical request ID and error envelope and contains
  no R2 key, object URL, signed URL, data URI, or bytes.

Run the focused Studio unit boundary, then package checks:

```sh
bunx vitest run --config apps/studio/vitest.config.ts apps/studio/src/features/editor/local-asset-store.test.ts apps/studio/src/features/editor/local-asset-promotion.test.ts apps/studio/src/features/editor/cross-browser-media-admission.test.ts apps/studio/src/server/media-asset-repository.test.ts apps/studio/src/server/media-asset-http.test.ts apps/studio/src/server/media-asset-promotion.test.ts
bun run --filter @webmcp/document typecheck
bun run --filter @webmcp/editor typecheck
bun run --filter @webmcp/studio typecheck
```

### Cross-boundary integration

1. Promote one local asset used by direct nodes, one field default, another
   field's current value, and bound nodes. Give each field a nonmatching other
   slot and assert it stays unchanged. Assert one managed mapping, one R2
   object, coherent canonical references, one draft flush, and one `/used`
   call.
2. Undo and Redo after promotion. Assert the local Blob and mapping remain and
   no upload runs.
3. Change the document during upload. Assert **Backed up, relink not applied**,
   unchanged document identity, and Retry starting at relink.
4. Cancel during hashing, IndexedDB read, XHR upload, mapping reconciliation,
   and before relink. Assert exact terminal state and no overlapping retry.
5. Inject timeout and network loss after the Worker commits. Reconcile to the
   existing mapping and never upload a second object.
6. Open another retained document on the same browser. Admission migrates under
   expected record version and retains a recovery receipt.
7. Open the same document in a fresh browser context with empty local asset
   storage. Resolve and relink through D1. Export and publish succeed only after
   managed materialization.
8. Open a document whose alias has no mapping. Assert a stable placeholder,
   correct node/field impact, Locate, Choose Studio image, and valid remove or
   clear actions.
9. Supply different bytes for a mapped alias. Assert conflict, preserve both
   assets, and require an explicit new identity or Studio-copy choice.
10. Resolve a mapping to an archived asset. Assert existing-reference recovery
    and rendering work while ordinary library selection remains disabled.
11. Race promotion, archive, document replacement, Review, crop, navigation,
    and a second tab. No stale completion changes the mounted document or local
    journal winner.
12. Import and WebMCP paths expose only the managed ID after admission. Local
    alias and mapping details remain absent from tool, Review, history, publish,
    and render responses.

### Real-browser gate

Add a dedicated Playwright file with two isolated browser contexts. Context A
owns the IndexedDB Blob and performs promotion. Context B starts with empty
asset IndexedDB, opens a fixture document containing the same local alias, and
must recover through the shared route. The gate covers desktop and 390px
compact UI, keyboard-only recovery, focus return, status announcements, one
scroll owner, and no horizontal overflow.

```sh
bunx playwright test --config apps/studio/playwright.config.ts apps/studio/test/e2e/cross-browser-media-production.spec.ts
```

The existing 18 MEDIA-01 journeys, document import, foreground PNG/PDF,
publication, WebMCP, draft persistence, ASSET-02 replacement/crop, and API error
suites remain regression gates.

### Deployed gate

Against the Access-protected production Worker:

- in an explicitly approved acceptance policy, use two authenticated browser
  sessions for the same workspace and one principal from another workspace;
- stream one real multipart promotion into R2 and inspect the D1 mapping,
  upload request, media row, request audit, and exact object metadata;
- prove the second same-workspace browser recovers without IndexedDB bytes;
- prove the other workspace cannot resolve the alias or managed asset;
- inject disconnect, timeout, D1 failure, and a concurrent same-alias request;
- retain request IDs, D1 row identities, R2 object hash, browser screenshots,
  and a no-private-source network payload inspection.

Local mocks and a single browser context cannot close this deployed gate.

### Repository-wide completion

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run format:check
git diff --check
```

## Deliberate limits

- This phase does not synchronize arbitrary draft edits between browsers. It
  makes media identity recoverable when a document reaches another browser
  through an existing draft, revision, import, or future sync path.
- It does not add permanent deletion, R2 garbage collection, asset derivatives,
  GIF/SVG support, organization roles, or a general background sync engine.
- It does not rewrite immutable published versions. Local aliases are already
  rejected before publication.
- It does not expose local aliases to WebMCP or public template consumers.
- It does not weaken renderer admission or allow Browser Rendering to fetch
  asset content over the network.

## Completion claim

Ledger row 10 closes only when one browser can promote once, every reference in
the active document relinks atomically, another browser with no local bytes can
recover through the durable mapping, missing or conflicting bytes remain
repairable without guesswork, Undo/Redo and cancellation tell the truth, and
the focused, real-browser, deployed, repository-wide, and independent-review
gates all pass.

## Slice 1 exit evidence, 2026-08-30

The domain relink slice is implemented and independently accepted with no
remaining P0/P1. The accepted boundary includes:

- one shared strict local alias contract used by document admission and the
  browser-local repository, including invalid legacy quarantine;
- stable sorted extraction for direct image nodes, field defaults/current
  values, bound projections, pages and outputs;
- an exact-path aggregate relink from coherent local identity to coherent
  managed identity;
- fail-closed stale paths, malformed identity, partial target projection and
  unrelated field-projection drift;
- exact non-identity preservation and unchanged ordinary replacement guards;
  and
- one history transaction with exact Undo/Redo and truthful byte-budget
  admission.

Independent review found and drove repairs for local bound-field `assetId`
projection, malformed scene-node aliases, the duplicate permissive local-store
parser, and unrelated global binding projection. Final evidence is 78 focused
document/editor tests, 22 local-store tests, 211 full document tests, 309 full
editor tests, all three affected typechecks and `git diff --check` under Node
24.19.0.

Slices 2 through 6 remain open. In particular, the promotion coordinator must
recognize a target-only replay and skip the command, because the domain command
intentionally rejects a request with no remaining local source path.

## Slice 2 exit evidence, 2026-08-30

The durable mapping and Worker boundary are implemented and independently
accepted with no remaining P0/P1. The accepted boundary includes:

- one shared strict local-promotion, lookup, ordered batch-resolution and
  idempotency-key contract;
- a workspace-scoped D1 alias mapping with a restricted composite asset
  reference, creator identity and a real SQLite migration verifier;
- exact lookup, ordered 1-100 distinct-alias resolution and multipart
  promotion through authenticated, bounded, private/no-store HTTP routes;
- route-and-alias-bound idempotency, same-hash replay/adoption, deterministic
  different-hash conflict, retained-byte quota accounting and archived recovery;
- exact D1 result checks plus bounded authoritative reconciliation for
  committed races, without deleting the deterministic R2 object; and
- public response schemas that expose managed product identity and status but
  never R2 keys, data URIs or other private storage identity.

Independent review found and drove repairs for the valid local alias `resolve`
colliding with the static batch route, a committed `0/1/1` archived-restore race
being reported as failure, and an immediate post-restore archive being rejected
despite a valid durable mapping. Final evidence is 8 shared media tests, 52
independently rerun focused Studio server tests, document and Studio typechecks,
all migrations through `0012` in real SQLite, and `git diff --check` under Node
24.19.0.

Slices 3B through 6 remain open. Physical R2 presence and real D1/R2 behavior
remain renderer/deployed evidence gates rather than claims of this local slice.

## Slice 3A exit evidence, 2026-08-30

The local IndexedDB journal and finite ownership foundation are implemented and
independently accepted with no remaining P0/P1. The accepted boundary includes:

- a version-5 database upgrade that adds an isolated promotion journal while
  preserving version-4 metadata, Blob and quarantine records;
- strict durable source, content, history, operation, draft, local-revision,
  reference-set, mapping, relink and persistence anchors;
- exact revision compare-and-swap, one-second through five-minute leases,
  expiry takeover and stale-owner rejection in one IndexedDB transaction;
- explicit missing/ready/corrupt reads, completed-operation supersession and
  best-effort BroadcastChannel hints with IndexedDB remaining authoritative;
- state-constrained hash, mapping, conflict, relink and durable-draft facts; and
- the same shared 1-128 ASCII idempotency-key contract as the Worker, rejected
  before IndexedDB is opened or written.

Independent review rejected two defects before acceptance: network-capable
states did not prove the persisted byte-hash checkpoint or protect a completed
operation from generic rollback, and the original journal accepted keys the
HTTP boundary could never replay. Both are repaired. Final evidence is 33
journal/local-store tests, 8 shared media tests, document and Studio typechecks,
manual blocked-upgrade and asynchronous-abort probes, and `git diff --check`
under Node 24.19.0.

This is intentionally not the full Slice 3 exit. The owner/controller must
still enforce directional transitions, hash and reconcile before networking,
own progress/cancellation/timeouts, and resume mapped or unknown outcomes
without duplicate upload. The two manual IndexedDB probes and malformed-handle
cleanup remain retained hardening obligations for that work.

## Slice 3B exit evidence, 2026-08-30

The promotion HTTP client and single-owner workflow are implemented and
independently accepted with no remaining P0/P1. Together with Slice 3A, this
closes the local owner portion of Slice 3. The accepted boundary includes:

- a checkpointed, directional state machine that hashes exact browser-local
  bytes in bounded chunks, verifies the local revision again, and reconciles
  the durable alias before the first upload and every ambiguous retry;
- a stable route-and-alias-bound idempotency key, exact promotion identity
  checks, real XHR progress and bounded lookup/upload timeouts;
- finite lease heartbeat, exact CAS ownership, stale/late-owner suppression,
  attempted-operation reconciliation, and mapped/relinking resume without
  duplicate upload;
- status-unknown handling for abort, timeout, lost connection, malformed 2xx
  and missing request identity whenever the server may have committed;
- acknowledged cancellation across journal open/read/create/claim, local-store
  migration/open/transaction, Blob hashing and XHR, including commit-wins lease
  release and abort-wins rollback; and
- best-effort progress observation that cannot break durable ownership or stop
  cancellation from reaching the active operation.

Independent review initially rejected the green implementation and drove
repairs for pre-aborted XHR, response-body cancellation, exact alias response
checks, late reconciliation for attempted failed/cancelled operations, ambiguous
2xx classification, progress reset, late lease-owner publication, checkpoint
error normalization, journal/local-store acknowledgement, commit-after-abort
lease leaks, observer exceptions, canonical cancel edges, SHA padding vectors
and malformed transaction cleanup. Final evidence is 97 focused
client/owner/journal/local-store tests, Studio typecheck, scoped ESLint and
`git diff --check` under Node 24.19.0.

Slice 4 still owns active-document revalidation, atomic relink, one critical
draft flush, result receipt and UI integration. No mounted document or UI was
mutated in this slice. Global journal serialization throughput remains a P2
measurement for later batch-promotion work.
