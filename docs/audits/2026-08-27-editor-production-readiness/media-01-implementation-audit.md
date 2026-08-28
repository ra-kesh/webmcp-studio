# MEDIA-01 implementation audit

Date: 2026-08-28
Scope: repository and identity model, upload and retrieval boundaries, editor integration, migration and recovery, reference-safe removal, rendering, and automated evidence. This was a read-only production-code audit. Browser, dev server, and build were intentionally not run.

The visible interaction contract is specified separately in `media-01-ux-audit.md`. This document defines the storage and application boundary needed to make that interface truthful.

## Outcome

MEDIA-01 should make D1 and R2 the authoritative workspace media repository. IndexedDB should remain a device-local staging and migration layer, not the long-term identity or publication source. Built-in Studio artwork should appear through a read-only adapter to the same repository contract.

The durable identity is an opaque workspace-owned asset ID. Documents, fields, template versions, API requests, WebMCP operations, and review output should exchange that ID. Data URIs, object URLs, R2 keys, and arbitrary HTTPS URLs are private projections and must not become public identities.

Deletion from the product should initially mean archive from the library. It must not remove R2 bytes. Existing drafts and immutable versions must keep resolving archived media. Physical garbage collection is out of the first MEDIA-01 slice and must remain disabled until every live document reference is durably indexed.

This is the shortest path to a reusable media product without weakening the current network-isolated renderer.

## Current implementation

### Useful foundations already present

- The editor uses a canonical image node with both `assetId` and `src` (`packages/document/src/schema.ts:130-138`). The ID is the right long-term identity seam, although the source is still treated as independent mutable data.
- IndexedDB is now schema version 2 and stores name, MIME type, byte size, dimensions, creation/update/use timestamps, and two sort indexes (`apps/studio/src/features/editor/local-asset-store.ts:1-50,108-150`). It can list, mark used, estimate quota, migrate legacy metadata, delete, and verify rollback (`apps/studio/src/features/editor/local-asset-store.ts:152-259`).
- The local upload coordinator captures an immutable document/page/node anchor, revalidates after asynchronous work, rolls back staged storage, and commits the document only once (`apps/studio/src/features/editor/asset-mutation-transaction.ts:1-181`). Its eight tests cover stale review/page/document/target state, persistence failure, commit rejection, rollback failure, and object URL ordering (`apps/studio/src/features/editor/asset-mutation-transaction.test.ts:57-326`).
- `localAssetUsage` can find image-node and asset-field references in the current document (`apps/studio/src/features/editor/local-asset-model.ts:12-43`). This is a useful local impact projector, not a durable reference index.
- The Studio Worker already has D1, an `ASSETS` R2 binding, a workspace principal, and an architecture-level R2 prefix (`apps/studio/wrangler.jsonc:36-51`, `apps/studio/src/server/studio-principal.ts:69-153`, `docs/architecture.md:107-126`).
- Publish/render policy already blocks unresolved local sources and non-network-isolated image sources (`packages/document/src/publishing.ts:96-157`, `packages/document/src/render-policy.ts:201-209`). That safety boundary should be preserved.

### Repository gaps

1. No production code consumes `listLocalAssetSummaries`, `markLocalAssetUsed`, `localAssetStorageSummary`, `migrateLocalAssetMetadata`, or deletion except rollback. The richer IndexedDB schema is not yet a user repository.
2. `normalizeRecord` trusts legacy row shape and calls `record.blob.size` without schema validation or quarantine (`apps/studio/src/features/editor/local-asset-store.ts:108-123`). A corrupt row can still fail the entire list.
3. IndexedDB records lack a content hash, upload status, failure details, server asset ID, derivative identity, archive state, or migration state. There is no deduplication or resumable retry identity.
4. `listLocalAssets` loads every Blob through `getAll()` before returning summaries (`apps/studio/src/features/editor/local-asset-store.ts:164-175`). Library open and search will scale with total full-resolution bytes unless metadata and Blob stores are separated.
5. `migrateLocalAssetMetadata` opens one transaction per record through `Promise.all` (`apps/studio/src/features/editor/local-asset-store.ts:232-240`). It has no checkpoint, corruption isolation, cancellation, or partial-progress recovery.
6. Quota preflight compares the requested bytes with a browser-wide estimate (`apps/studio/src/features/editor/local-asset-store.ts:193-229`). It is a helpful warning, but not a reservation and not an application quota.
7. D1 migrations contain no media metadata or reference table (`migrations/0001_initial.sql:3-104`; `migrations/0006_template_version_constraints.sql:7-150`). The configured `ASSETS` bucket is unused by media.

### Editor and UI gaps

- The Asset Library renders only six bundled SVG data URIs from `studioAssets` (`apps/studio/src/features/editor/asset-library-dialog.tsx:18-19,62-95`; `apps/studio/src/features/editor/asset-catalog.ts:29-94`).
- Upload closes the library and opens a single-file picker. On selection, the file is persisted and inserted directly; it is never added to a reusable collection (`apps/studio/src/features/editor/asset-library-dialog.tsx:43-60`; `apps/studio/src/features/studio-shell.tsx:998-1013,1724-1729`).
- Add and replace separately test `file.type.startsWith("image/")`, cap one file at 25 MiB, decode client-side, and store a local alias (`apps/studio/src/features/editor/use-document-editor.ts:1215-1312,1357-1429`). MIME prefixes and browser decode are not a server trust boundary.
- Reload resolves only image-node `asset:local/` sources. A missing row returns `null` and is silently skipped; asset field values are not included (`apps/studio/src/features/editor/use-document-editor.ts:644-694`).
- Object URLs are held in one hook-level map and revoked at unmount (`apps/studio/src/features/editor/use-document-editor.ts:696-701`). A reusable list needs a reference-counted, viewport-aware URL cache so library close and item removal also release URLs.
- Built-in images use `assetId: library-{id}` plus a full data URI, while local uploads use an unrelated random ID plus `asset:local/{id}` (`apps/studio/src/features/editor/use-document-editor.ts:1265-1284,1314-1354`). The same visual concept currently has two incompatible identity rules.

### Publication and rendering gaps

- Asset fields classify only local aliases, inline data, and legacy HTTPS (`packages/document/src/fields.ts:176-205`). There is no durable managed-media reference.
- Publication blocks all `asset:local/` image nodes and any asset field that still needs resolution (`packages/document/src/publishing.ts:96-148`). That is correct for local aliases but leaves no path to promote an upload.
- `render-field-assets.ts` resolves only the six hard-coded catalog IDs and projects their data URIs into renderer input (`apps/studio/src/server/render-field-assets.ts:1-65`). A user asset ID cannot reach rendering, and repository ownership is not checked.
- Template persistence stores document and manifest JSON atomically, but no asset references are stored alongside them (`apps/studio/src/server/template-repository.ts:120-191`). A later delete cannot know which immutable versions pin an asset.
- The Renderer accepts only network-isolated inline image sources (`packages/document/src/render-policy.ts:201-209`). MEDIA-01 must materialize approved repository assets before this existing assertion, not allow Browser Run to fetch arbitrary network locations.

### Existing evidence is necessary but incomplete

- The local usage model has one test for one document (`apps/studio/src/features/editor/local-asset-model.test.ts:9-67`). It does not cover duplicate paths, defaults plus live values, immutable versions, or concurrent deletion.
- The upload transaction has strong unit coverage and one real-browser IndexedDB race contract (`apps/studio/test/e2e/asset-mutation-transaction.spec.ts:114-175`). The browser contract remains pending because the shared Worker host is unhealthy.
- Draft recovery validates and quarantines document bytes only (`apps/studio/src/features/editor/draft-recovery.ts:1-146`; `apps/studio/src/features/editor/draft-recovery.test.ts:17-151`). It neither migrates media records nor reconciles document references with available media.
- There are no IndexedDB upgrade/corruption/quota tests, media route tests, reload-and-reuse tests, or publish/render tests for user assets.

## Invariants to decide before implementation

These are phase-entry decisions, not details to improvise in components.

1. **One asset ID.** An uploaded asset keeps one opaque public ID for its lifetime. Renames, archive, derivative regeneration, and metadata repair do not change it.
2. **Immutable bytes per rendition.** Never overwrite an original or renderer rendition under an existing asset ID. A true replacement creates a new asset ID. Metadata changes may update the asset row.
3. **No source leakage.** Clients can receive a protected same-origin preview URL, but persisted/public contracts cannot contain object URLs, raw R2 keys, signed storage URLs, or renderer data URIs.
4. **Workspace ownership first.** Every get/list/content/archive/resolve operation constrains by both asset ID and principal workspace before R2 access.
5. **Publishable is not renderable.** A canonical document may contain approved managed IDs. A render projection resolves those IDs to private, network-isolated bytes, then calls the existing render-policy assertion. Do not weaken `assertRenderableDocument`.
6. **Archived remains resolvable.** Archive removes an item from ordinary selection but does not break a document that already references it.
7. **No physical delete in the first slice.** Local-only drafts are not durably indexed across devices. Keeping bytes is the only honest reference-safe behavior until PERSIST-01 closes that gap.
8. **Server validation is authoritative.** Client MIME, extension, dimensions, checksum, and decode results improve UX but cannot make an asset `ready` on their own.
9. **One command per document effect.** Insert, replace, promotion, reference replacement, and removal each create one canonical history checkpoint. Repository writes remain outside history and use compensation on rejected commits.
10. **Public automation uses IDs.** REST and WebMCP accept approved asset IDs only. Humans and agents use the same resolver and receive the same validation result.

## Proposed domain contract

Add a shared, UI-free media contract in `packages/document` only for identities and references, or create a small `packages/media` package if upload and repository schemas would otherwise bring transport concerns into the document package.

```ts
type ManagedAssetId = string

type MediaAsset = {
  id: ManagedAssetId
  name: string
  source: "upload" | "built_in"
  mediaType: "image/png" | "image/jpeg" | "image/webp"
  bytes: number
  width: number
  height: number
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  status: "uploading" | "processing" | "ready" | "failed" | "archived"
  failure: { code: string; message: string } | null
}

type ManagedAssetReference = `asset:managed/${ManagedAssetId}`
```

The first production ingestion slice should accept PNG, JPEG, and WebP only. GIF animation behavior and SVG sanitization/rasterization must be explicit follow-up decisions. The current picker claims both formats without a trusted server policy (`apps/studio/src/features/studio-shell.tsx:998-1003`).

For a bounded migration, image nodes may keep both fields, but `assetId` is authoritative and `src` must be derived as `asset:managed/{assetId}`. A command or decoder must reject mismatched pairs. A later schema version can remove persisted `src` for managed images and derive it entirely at projection time.

Asset fields should store the same opaque ID in public values. The document-layer parser may accept `asset:managed/{id}` internally during migration, but REST, WebMCP, and public manifests should expose only the ID already used by FIELD-01.

## D1 and R2 model

### D1 tables

Add a new migration after `0006_template_version_constraints.sql`.

`media_assets`

| Column                                                    | Contract                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                      | Internal stable primary key. Use a random, non-guessable ID.                                                                      |
| `workspace_id`                                            | Required foreign key to `workspaces`; part of every ownership query.                                                              |
| `public_id`                                               | Stable ID exposed to document/API contracts, unique per workspace. It may equal `id` if no internal/public distinction is needed. |
| `content_sha256`                                          | Lowercase SHA-256 of original bytes, unique per workspace for deduplication.                                                      |
| `name`                                                    | Validated user-visible filename, with path components removed.                                                                    |
| `media_type`                                              | Exact allowlisted server-detected MIME type.                                                                                      |
| `bytes`                                                   | Original byte size with a positive upper-bound check.                                                                             |
| `width`, `height`                                         | Positive server-validated dimensions with per-axis and pixel-area bounds.                                                         |
| `original_r2_key`                                         | Private immutable original key. Never returned to a client.                                                                       |
| `render_r2_key`                                           | Private immutable normalized renderer rendition. Required before `ready`.                                                         |
| `status`                                                  | `uploading`, `processing`, `ready`, `failed`, or `archived`.                                                                      |
| `failure_code`, `failure_message`                         | Stable retry information for failed processing. Do not store stack text.                                                          |
| `created_at`, `updated_at`, `last_used_at`, `archived_at` | Server timestamps. `last_used_at` means inserted/replaced, not previewed.                                                         |
| `revision`                                                | Monotonic metadata revision used by conditional archive/update requests.                                                          |

Indexes:

- unique `(workspace_id, public_id)`
- unique `(workspace_id, content_sha256)` for active and archived deduplication
- `(workspace_id, status, created_at DESC)` for Uploads
- `(workspace_id, status, last_used_at DESC)` for Recent

Store exact immutable-version references in two junction tables instead of one weak polymorphic table:

- `document_revision_media_assets(document_id, snapshot_id, asset_id, reference_path, created_at)` with a composite foreign key to the document revision.
- `template_version_media_assets(template_id, version, asset_id, reference_path, created_at)` with a composite foreign key to the immutable template version.

`reference_path` is a stable logical path such as `node/{nodeId}/src`, `field/{fieldId}/default`, or `field/{fieldId}/value`. A unique key over owner, asset, and path prevents double counting. Store references in the same D1 batch that writes the owning revision/version. If any asset is missing, foreign, failed, or not resolvable, the whole persistence operation fails before the owner becomes visible.

Current local drafts are not server revisions. The deletion-impact service should therefore return server references, while the client adds live current-document references from `localAssetUsage`. This is adequate only because archive retains bytes. It is not sufficient evidence for physical deletion.

### R2 keys

Use immutable, workspace-scoped keys:

```text
assets/{workspaceId}/{assetId}/original
assets/{workspaceId}/{assetId}/render.{ext}
assets/{workspaceId}/{assetId}/thumb.webp
```

The `original` preserves recoverability. `render` is bounded, normalized, and safe for deterministic rendering. `thumb` is optional in the first slice if the content route can serve an already bounded renderer rendition. Do not use user filenames in keys.

R2 metadata should include asset ID, workspace ID, content hash, detected MIME, width, height, and schema version. D1 remains authoritative. R2 metadata is integrity evidence and repair input, not the list database.

## Repository and route boundary

Create one server repository, for example `apps/studio/src/server/media-repository.ts`, and keep D1/R2 coordination out of route components and React hooks.

The client consumes a `MediaRepository` interface so local migration and built-ins can be composed without teaching the UI storage details:

```ts
interface MediaRepository {
  list(input: MediaListInput): Promise<MediaListPage>
  get(assetId: string): Promise<MediaAsset>
  upload(file: File, options: UploadOptions): UploadTask
  markUsed(assetId: string): Promise<MediaAsset>
  getDeletionImpact(assetId: string): Promise<MediaDeletionImpact>
  archive(assetId: string, expectedRevision: number): Promise<MediaAsset>
}
```

Recommended same-origin routes:

| Method   | Route                                             | Purpose                                                                                                                        |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/v1/studio/assets?collection=uploads             | recent                                                                                                                         | built-in&query=&cursor=`                                                                                                 | Cursor-paged repository list. Built-ins may be served by the same response adapter. |
| `GET`    | `/v1/studio/assets/:assetId`                      | Metadata and current state.                                                                                                    |
| `POST`   | `/v1/studio/assets`                               | Upload one raw file with idempotency key and declared metadata/checksum. Use XHR client-side for real byte progress and abort. |
| `GET`    | `/v1/studio/assets/:assetId/content?variant=thumb | render`                                                                                                                        | Workspace-owned protected bytes with exact content type/length, ETag, and private cache policy. Never expose the R2 key. |
| `POST`   | `/v1/studio/assets/:assetId/used`                 | Server-generated `last_used_at` after a successful insert or replacement.                                                      |
| `GET`    | `/v1/studio/assets/:assetId/deletion-impact`      | Exact server revision/version references and archive capability.                                                               |
| `DELETE` | `/v1/studio/assets/:assetId`                      | Conditional archive. Require the expected metadata revision or `If-Match`; return `409` if impact changed.                     |

If durable interrupted-upload recovery is required across devices, split upload into reservation plus raw content routes. Do not add that complexity to the first slice unless product acceptance requires resume from an already transferred byte offset. The required retry can safely replay the same file with the same idempotency key and checksum.

### Upload request ordering

The upload route is a raw-body boundary and must not use the JSON reader.

1. Reject unsupported method/media metadata, invalid or missing length, declared oversize, malformed checksum, and impossible dimensions before D1 or R2.
2. Resolve the Studio principal before any workspace query or R2 call.
3. Read enough prefix bytes to validate the exact image signature and dimensions. Treat client dimensions as a consistency assertion, not truth.
4. Enforce byte, width, height, and total-pixel limits. Count streamed bytes independently of `Content-Length`; abort on mismatch or overflow.
5. Verify the content SHA-256. Prefer an R2-verified checksum path so a large upload is not duplicated in Worker memory.
6. Check `(workspace_id, content_sha256)`. Return the existing ready asset, or restore an archived duplicate, without writing duplicate bytes.
7. Stage immutable R2 objects. Do not mark D1 `ready` until every required object and validation step succeeds.
8. Commit D1 metadata. On D1 failure, delete only the newly staged R2 keys and report cleanup failure distinctly.
9. Return a repository asset projection. Never return storage keys or renderer source bytes.

Every failure needs a stable code such as `asset_type_unsupported`, `asset_too_large`, `asset_dimensions_invalid`, `asset_checksum_mismatch`, `asset_decode_failed`, `asset_quota_exceeded`, `asset_upload_cancelled`, or `asset_storage_failed`.

The server must not rely on `file.type.startsWith("image/")`. Client and server should share the exact supported-type copy, but the server checks magic bytes. SVG must be rejected until sanitization/rasterization exists. GIF must be rejected or explicitly flattened with visible copy. Arbitrary HTTPS imports remain outside MEDIA-01.

### Quotas

Enforce both product and platform limits:

- per-file source bytes
- maximum dimensions and pixel area
- maximum renderer-rendition bytes
- workspace active-asset count
- workspace active original bytes
- concurrent uploads per principal

Browser `navigator.storage.estimate()` remains useful only for legacy local migration. Durable repository quota comes from D1 aggregate/reservation state. Concurrent requests must reserve quota atomically before R2 and finalize actual bytes after success. Failed and cancelled attempts release the reservation.

## Renderer and publication integration

Do not replace the current safety gate with an allowlist exception for `asset:managed/`.

Add a projection boundary with this order:

1. Decode and validate the canonical version/request.
2. Extract all image-node and asset-field managed IDs.
3. Resolve every ID through the workspace media repository. Require `ready` or allow `archived` only for an existing stored reference.
4. Load the bounded renderer rendition, not the original.
5. Replace managed references in an isolated render copy with renderer-safe private sources.
6. Apply field values.
7. Run `assertRenderableDocument` on the fully materialized copy.
8. Call the private Renderer Worker.

The current Renderer service request is JSON and the renderer policy accepts inline sources only. Before implementation, choose one bounded rendition transport:

- inline a strictly capped normalized rendition if aggregate request limits remain safe, or
- bind the private Renderer to the asset bucket and fulfill only opaque internal asset references from R2 before Browser Run.

Do not raise JSON body limits to accommodate 25 MiB originals. Do not let Browser Run fetch a same-origin or signed R2 URL over the network. A private R2-backed resource resolver must complete before page content is considered ready.

Publishing should freeze managed IDs and write junction rows in the same D1 batch as the immutable version. Public manifests keep the ID. `publicTemplateVersion` must stop depending on `studioAssets`, and `resolveRenderFieldAssetIds` must resolve through the workspace repository (`apps/studio/src/server/render-field-assets.ts:8-65`). Built-ins should be registered as read-only repository entries or resolved by an adapter with the same public ID policy.

## UI and upload state model

Use the acceptance matrix in `media-01-ux-audit.md`. The implementation should add an editor feature module rather than expand `studio-shell.tsx` or `use-document-editor.ts` further:

```text
apps/studio/src/features/media/
  media-library-dialog.tsx
  media-library-model.ts
  media-repository-client.ts
  media-upload-queue.ts
  media-thumbnail.tsx
  media-details-dialog.tsx
  media-deletion-dialog.tsx
  local-media-migration.ts
  media-object-url-cache.ts
```

One media surface must support two explicit modes:

- **Add image:** selecting a ready asset inserts one centered, proportionally scaled node and selects it.
- **Replace image:** selecting a ready asset updates only identity and default alt text while preserving node ID, geometry, crop, fit, opacity, visibility, lock, bindings, and stack position.

The dialog should remain open during file selection and upload. Each queue item owns its state:

```text
queued -> validating -> uploading -> processing -> ready
                    \-> cancelled
                    \-> failed -> retrying
```

After reload, any device-local `uploading` item without an active task becomes `interrupted`, not failed or complete. Retry reuses its stable client operation ID and checksum. Cancel aborts read/decode/XHR work and removes only staged bytes. The existing `executeAssetMutation` coordinator remains the document commit boundary after a repository item reaches `ready`.

The UI needs distinct loading, empty, filtered-empty, offline, quota, failed-list, missing-blob, upload-failed, archive-impact, and archive-failed states. Async status uses `aria-live`; list controls use semantic buttons and visible focus; compact actions meet the editor's 44 px target; search does not force focus on touch layouts.

Thumbnail loading must not call `getAll()` for Blobs. List metadata first, request bounded thumbnails only near the viewport, set intrinsic dimensions, and revoke object URLs when a card leaves the cache. Virtualize or use `content-visibility` for large collections.

## Local migration and recovery

### IndexedDB schema

The current version 2 metadata is useful, but the durable migration layer still needs:

- a metadata-only store so listing does not materialize every Blob
- a Blob store keyed by local ID
- indexes for `createdAt`, `lastUsedAt`, `migrationState`, and `serverAssetId`
- `contentSha256`, `migrationState`, `serverAssetId`, `failureCode`, and retry timestamps
- record-level parsing and quarantine instead of trusting `Partial<LocalAssetRecord>`

An upgrade transaction should change structure only. Hashing, image decode, and network upload must run as a resumable lazy migration after open. Each record migrates independently and stores a checkpoint.

### Promotion flow

1. Show legacy rows in Uploads as **On this device** with a **Back up to Studio** action. Do not imply cloud availability.
2. Validate the row and Blob. Corrupt metadata or a missing Blob becomes a recoverable unavailable item, not a list-wide exception.
3. Hash and upload with a stable operation ID. Save `localId -> managedAssetId` before changing the document.
4. In one canonical command, rewrite every current image node and asset-field occurrence from the local alias to the managed ID.
5. Keep the local alias mapping and Blob while Undo/history/recovery snapshots may still refer to it. Do not delete it in the same action.
6. A later cleanup pass may remove an unreferenced local Blob after a retention window and explicit reference scan. Cleanup failure is non-destructive and retryable.

Undo of promotion may restore a local alias. The alias resolver must therefore keep working after promotion. Redo must reuse the same managed asset ID and never upload duplicate bytes.

### Missing and corrupt media

When a document refers to `asset:local/{id}` but IndexedDB returns no Blob, the editor must create a deliberate missing-media state containing asset ID, affected node/field, and repair actions. It must not silently leave the source unresolved as the current reload effect does (`apps/studio/src/features/editor/use-document-editor.ts:660-679`).

Repair choices:

- locate a replacement file, validate it, and atomically reuse or replace the local identity
- choose an existing managed asset
- remove the affected node or clear an optional field through one command

Draft quarantine and media quarantine remain separate. Resetting a corrupt document must never delete media rows. Orphan media is hidden or archived later through reference-aware cleanup.

## Archive and reference safety

The user action should be **Remove from Uploads** or **Archive**, not **Delete permanently**, until server draft persistence covers all references.

Before archive:

1. Read the current metadata revision.
2. Query immutable document and template reference tables.
3. Add live current-document references in the client.
4. Show exact page/output/layer/field/version impact with navigable current-document rows.
5. Submit the archive with the expected revision.
6. Recompute impact in the server transaction. Return `409 asset_impact_changed` if it differs.
7. Set `status = archived`, increment revision, and retain every R2 object.

Archived assets disappear from ordinary Uploads/Recent results but remain resolvable for all existing references. A duplicate re-upload restores the same ID unless policy explicitly requires a new copy. A future **Archived** management view can restore it.

Physical garbage collection requires all of the following and is not part of the bounded first slice:

- PERSIST-01 has durable current-document revisions for every workspace document
- no document revision, template version, render job, field value, or retained recovery record references the asset
- archive retention has elapsed
- a repairable tombstone is committed before R2 deletion
- R2 deletion and D1 finalization have retryable, observable reconciliation

## OpenPencil patterns to adopt

Reference root: `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/open-pencil` at the repository revision recorded in `docs/reference-repositories.md`.

| Pattern                                                                                                                                                                                         | Evidence                                                                                                            | Studio interpretation                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| One searchable asset surface joins local and remote sources, groups results, supports grid/list, details, per-item busy state, keyboard insertion, and drag.                                    | `src/components/assets-panel/AssetsPanel.vue:62-95,123-200,266-320,324-500`                                         | Use one media surface and one selection contract. Keep drag as an accelerator with a button/keyboard alternative.                                   |
| Thumbnails render only when visible, ignore stale async responses with a request ID, and manage object URLs through lifecycle helpers.                                                          | `src/components/assets-panel/AssetThumbnail.vue:1-53`                                                               | Use viewport-scoped thumbnail requests and a central cache. Do not decode every upload on dialog open.                                              |
| File ingestion uses an exact raster MIME allowlist, decodes dimensions, bounds the working dimension, hashes bytes, prepares the full batch, cleans partial nodes, and records one Undo action. | `packages/core/src/editor/clipboard/assets.ts:16-100,134-183`                                                       | Share exact file policy, separate prepare from commit, deduplicate by strong server hash, and preserve the existing Studio transaction coordinator. |
| Canvas drop validates transferable types, displays drag-over state, maps screen to canvas coordinates, and supports multiple files.                                                             | `packages/vue/src/canvas/drop/use.ts:8-15,43-113`                                                                   | Add drop to the media surface and canvas only after the same repository validation path exists. Do not create a second upload implementation.       |
| Graph image bytes use content-derived identity.                                                                                                                                                 | `packages/scene-graph/src/images.ts:1-34`                                                                           | Use SHA-256 and workspace-scoped deduplication. Do not copy its non-cryptographic hash for a durable cross-tenant repository.                       |
| Export and library materialization copy only the dependency closure and referenced image resources.                                                                                             | `packages/core/src/io/subgraph.ts:33-103,106-117`; `packages/core/src/library/materialize.ts:26-51,107-123,135-177` | Freeze and resolve only asset IDs referenced by the chosen document/version/output. Never attach the whole media library to a render request.       |
| Library revisions have hard byte/node/image limits and verify content hashes.                                                                                                                   | `packages/core/src/library/validation.ts:6-76`                                                                      | Treat limit and integrity validation as domain behavior with stable errors, not incidental UI checks.                                               |
| Browser tests cover grouping, search, views, details, insertion, drag, coordinates, and variants.                                                                                               | `tests/e2e/components/assets-panel.spec.ts:29-330`                                                                  | Mirror this behavioral depth, then add the upload, quota, recovery, and archive journeys OpenPencil does not need for component assets.             |

OpenPencil stores images in its graph, so node mutation and byte mutation can share one in-memory transaction. Studio cannot copy that storage model. Its existing cross-store coordinator is the correct equivalent for local staging, and the server repository needs explicit compensation around D1 and R2.

## Bounded implementation sequence

### Slice 1: identity and repository contract

Files:

- new shared media schemas and reference extractor
- new D1 migration for media and immutable reference tables
- new `apps/studio/src/server/media-repository.ts`
- focused repository and migration tests

Exit evidence:

- one stable managed ID parses everywhere
- ownership is required for every operation
- D1 constraints reject duplicate or invalid rows
- R2 keys never leave server projections
- no production UI change yet

### Slice 2: list, content, upload, quota, and archive routes

Files:

- new `/v1/studio/assets` route tree
- raw upload boundary helper and tests
- content streaming and deletion-impact services

Exit evidence:

- full hostile-body and ownership matrix rejects before R2
- upload rollback leaves neither an orphan object nor a ready row
- deduplicated retry returns one asset
- cursor/search/recent sorting is deterministic
- archive keeps referenced content resolvable

### Slice 3: client repository and media surface

Files:

- new `features/media` module
- replace `asset-library-dialog.tsx` usage with add/replace modes
- reduce `studio-shell.tsx` to opening the surface
- route both add and inspector replace through one selection callback

Exit evidence:

- Recent, Uploads, and Built-in are truthful
- loading/error/empty/upload states are visible and accessible
- upload progress, cancel, retry, reuse after reload, and compact layout work
- no full Blob scan on library open

### Slice 4: local migration and missing-media recovery

Files:

- IndexedDB metadata/Blob split and record parser
- resumable `local-media-migration.ts`
- missing-media canvas and inspector state
- promotion command and Undo tests

Exit evidence:

- version 1 and version 2 stores migrate without data loss
- one corrupt row does not hide healthy rows
- promotion and one Undo/Redo preserve identity and do not duplicate uploads
- missing Blob has a visible repair journey

### Slice 5: publish, API, WebMCP, and renderer projection

Files:

- shared asset-reference extraction and managed parser
- template repository reference writes
- replace static `render-field-assets.ts` lookup with repository resolution
- render transport for bounded private renditions
- API Playground, review display, and WebMCP integration tests

Exit evidence:

- public contracts contain IDs only
- immutable versions pin exact assets
- every managed ID is ownership-checked before materialization
- render policy still sees only network-isolated safe sources
- missing/foreign/failed media stops before Renderer, Browser Run, or render R2

### Slice 6: reference-aware archive and scale evidence

Files:

- impact dialog and focus navigation
- archive/restore management state
- large-list virtualization/cache instrumentation
- browser and deployed Worker suites

Exit evidence:

- exact references survive reload and concurrent impact changes
- archive is safe for current and immutable references
- 200-plus assets do not decode or load full sources on open
- object URLs return to baseline after close/removal

## Required test matrix

### Domain and repository unit tests

- managed ID and source pair validation, including mismatch rejection
- reference extraction from image nodes, field defaults, live field values, duplicate paths, pages, outputs, document revisions, and template versions
- media record schema, filenames, state transitions, archive/restore, and deterministic sort/cursor behavior
- exact MIME/magic mapping, zero-byte/corrupt data, dimensions, pixel area, checksum, and quota arithmetic
- deduplication of active and archived assets
- deletion impact and expected-revision conflict

### IndexedDB tests

- clean creation and version 1/version 2 upgrades
- metadata-only listing without Blob materialization
- corrupt record quarantine while healthy records remain visible
- quota preflight, `QuotaExceededError`, transaction abort, blocked upgrade, and unavailable IndexedDB
- interrupted migration checkpoint and retry
- orphan rollback, missing Blob, promotion alias, and cleanup retention

### Studio Worker tests

- unauthenticated, wrong-workspace, and unknown asset for every route
- missing/invalid/mismatched/oversized length and stream overflow before D1/R2 mutation
- wrong media type, signature mismatch, checksum mismatch, corrupt dimensions, and pixel bomb
- R2 failure before D1 ready state; D1 failure after R2 with exact cleanup evidence
- concurrent same-hash uploads and idempotent retry produce one asset
- content route returns exact bytes/headers and never returns a storage key
- archive race, impact conflict, archived resolution, and no physical R2 delete
- list pagination/search/Recent ordering and stable cursor behavior

### Cross-boundary integration tests

- upload, list, reload, reuse, insert, one Undo, replace, one Undo
- promote local alias, Undo, Redo, reload, and publish without duplicate R2 objects
- publish writes exact version-reference rows atomically
- API and WebMCP accept an owned ID, reject a foreign/failed/unknown ID, and never expose private sources
- render materializes only referenced assets, enforces aggregate rendition bytes, then passes render policy
- invalid media produces zero Renderer, Browser Run, and render R2 calls
- archive keeps a published historical render reproducible

### Browser tests after host recovery

Use the eight journeys in `media-01-ux-audit.md`. Add multi-tab upload/archive races and a 200-item performance fixture. Do not claim browser completion until the canonical single-server topology executes them successfully.

### Deployed Worker evidence

- real Access principal isolation across two workspaces
- real streamed upload cancellation and size enforcement
- D1/R2 compensation under injected failures
- concurrent quota reservations and same-hash uploads
- Renderer materialization without external browser fetches
- memory and latency telemetry at maximum source/rendition/aggregate sizes

## Decisions that must remain visible

1. Choose the maximum original bytes, maximum dimensions/pixels, maximum renderer rendition bytes, and workspace quota from measured Worker/R2/renderer evidence. The current 25 MiB client limit is not sufficient proof.
2. Choose how the trusted renderer rendition is produced. Do not mark an upload `ready` until this service boundary exists.
3. Keep GIF and SVG disabled until animation and sanitization/rasterization behavior are designed and tested.
4. Keep physical garbage collection disabled until durable current-document references exist. Archive is enough for MEDIA-01 product behavior.
5. Run the existing ASSET-02 browser regression and all new MEDIA-01 browser contracts only after the host Worker runtime recovers. No browser result is claimed by this audit.
