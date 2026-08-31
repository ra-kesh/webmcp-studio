# LIBRARY-02 Gate 6 media integration map

Date: 2026-08-31

Status: Slices A, B, C and D accepted; Slice E0a/E0b/E0c/E0d accepted and E1
active

## Accepted checkpoints

### Slice A — exact curated content

Accepted on 2026-08-31 at commit `a8cb3a9` after a fresh independent code
review returned zero P0/P1 findings.

- All 37 active manifest identities resolve only through their declared exact
  version, path, SHA-256, MIME type, byte count and dimensions.
- The six compatibility identities retain independently stored immutable v1
  bytes and exact public paths; they are not aliases for their active v2
  successors.
- GET/HEAD, ETag/304, immutable caching, content length and `nosniff` are
  covered, while unknown or drifted content fails closed.
- Editor, public template version, browser content, field materialization,
  publication and renderer use one canonical identity. Data URIs remain a
  transient render projection and never enter the saved document.
- Durable jobs distinguish the absolute job deadline from ordinary renderer
  timeouts, recompute and fence the remaining budget through final D1 publish,
  settle the known reservation without re-preparing, and preserve typed
  curated/managed field errors with stable locators.

Acceptance evidence: the fresh reviewer passed eight focused Studio files,
the curated document identity suite, and both Studio and Document typechecks.

### Slice B — managed metadata and catalog authority

Metadata/version authority was accepted at commit `66841a1`. Managed catalog
composition was accepted on 2026-08-31 at commit `d7fa6b0` after an independent
code review returned zero P0/P1 findings.

- Ready managed media is composed into workspace-scoped catalog list/detail
  through a D1-only reader; private R2 keys and content locators never enter
  catalog responses.
- Exact detail requires the current independent catalog version and rejects
  stale, archived, foreign or missing records through the same not-found
  boundary.
- Catalog revision now binds the immutable base, Gate 5 preference epoch and
  managed-media epoch. The media epoch is read even for template-only pages,
  so any old cursor is rejected after a searchable media mutation.
- Metadata search and provenance remain truthful: workspace upload,
  customer-provided and rights not verified unless authoritative metadata says
  otherwise. Managed repository recency does not masquerade as Gate 5 Recent.
- Managed composition is bounded to 1,000 ready rows and fails closed at 1,001
  instead of silently truncating catalog truth.

Acceptance evidence: 60 focused repository/catalog/HTTP tests and the Studio
typecheck passed in both implementation and independent review.

### Slice C — bounded device-local discovery

Accepted on 2026-08-31 at commit `2f8ddfe` after an independent re-review
closed three P1 findings and returned zero remaining P0/P1.

- Ordinary list and detail reads use only the browser metadata store. They do
  not open Blob storage, decode images or create object URLs.
- The bounded list returns items plus database version, migration state,
  legacy and unindexed counts, examined/projected/archive/unavailable counts,
  truncation and integrity issues. Partial or legacy state cannot appear as a
  healthy empty result.
- Only ready, unarchived, positive-dimension records project into discovery.
  Device-local identities retain source and exact record revision, while
  durable Favorites and Collections remain unavailable until promotion.
- Exact selection alone reads and verifies bytes. Revision, archive, missing,
  quarantine, unavailable and cross-profile changes fail before document
  mutation.
- A decoded-dimension mismatch performs revisioned metadata reconciliation and
  returns a retryable repository-changed result; it never accepts false
  dimensions or quarantines otherwise valid bytes.

Acceptance evidence: 49 focused local-store/adapter tests, the Studio
typecheck, scoped ESLint and scoped diff checks passed in implementation and
independent review.

### Slice D — D0/D1 discovery ownership foundation

Accepted on 2026-08-31 at commit `fc41c50` after an independent code review
found four P1 boundary defects, all four were remediated, and the independent
re-review returned zero remaining P0/P1 findings.

- Media discovery has a separate route-owned controller/provider initialized
  with `itemKinds: ["media"]` before activation. Its frozen public proxy cannot
  be switched back to template or mixed discovery, while the template and
  media controllers share only the Gate 5 preference invalidation authority.
- Server results and device-local results remain separate authorities. Server
  pages reject local-source rows and alone own totals, cursors and append;
  local inventory is bounded, metadata-only, retained, and reprojected through
  every new query before a replacement read can fail.
- Browser identity includes source, ID and exact version or revision, so an
  identical local, managed and curated ID cannot collide in focus, selection
  or preview state.
- Local detail and preview use exact Gate 6C rechecks. Preview reads are
  active-only, concurrently abortable, fenced by query and controller
  lifetime, and cancelled on caller abort, query change, deactivation or
  disposal. D2 therefore has no reason to import the local asset store.
- Retained local cards cannot leak from Uploads into Studio Library,
  Favorites, or collection scopes after a failed refresh. Inventory health and
  integrity status remain visible even when the filtered projection is empty.

Acceptance evidence: the root verification passed 65 focused discovery,
provider, local-adapter, template-browser and preference tests plus Studio
typecheck and scoped ESLint. The final independent remediation review passed
14 focused tests and Studio typecheck with zero remaining P0/P1 findings.

The D2 collection, preview, and preference-projection foundations were
checkpointed at commit `7ffb7f0` after their focused suites and independent
reviews returned zero open P0/P1 findings.

The source-aware catalog and persistence boundary was accepted at commit
`af48195`. Curated and managed media with the same ID/version remain distinct
through detail, preferences, Recent and collections. Migration 0016 upgrades
legacy preference/member identities and successful receipts without weakening
idempotency: old-hash replay succeeds only for the caller's exact migrated
source, while wrong-source reuse is rejected. Independent review found two
receipt-replay P1s; both were remediated and the final re-review returned zero
remaining P0/P1 findings.

The pure shared browser was accepted at commit `c9d35f8`. Its first independent
review found six P1 gaps in atomic scope cutover, source-aware server identity,
exact details, cloud-failure visibility, compact Sheet usability and exact
selection retry. All six were remediated and the final re-review returned zero
remaining P0/P1 findings. The browser now owns truthful loading/failure/empty
states, source grouping, exact details, permissions, collections, bounded local
previews, keyboard navigation and the 48/49 virtualization boundary without
issuing document commands.

Acceptance evidence: root verification passed 109 source-focused Studio tests,
both migration verifiers, all 338 Document tests, both typechecks and a 62-test
mounted browser matrix. Receiptless legacy preference repair separately passed
26/26 tests after its final P1 fix.

### Slice E — E0a/E0b/E0c exact-action foundations

E0a was accepted at commit `87357d7` after its duplicate action-union P1 was
removed and independent re-review returned zero open P0/P1. `assign_field` is
now a first-class completed-action receipt from document schema through D1
persistence and idempotent replay.

E0b was accepted at commit `bd0aaae` after independent review returned zero
P0/P1. Curated, managed, and device-local selections now enter one exact,
abortable, UI-free preparation boundary that preserves canonical sources and
performs no document mutation or usage side effect.

E0c was accepted at commit `0509ece` after five independent-review P1s were
remediated and the re-review returned zero remaining P0/P1. One mutex-owned
executor now performs exact insert, replace and field assignment as one
canonical command, rechecks mutable media after renderer admission, cancels on
session transitions, suppresses semantic no-ops and records source-specific
usage only after commit. Post-commit receipt failures remain retryable warnings
and never roll back the document edit. E0d target/runtime/shell wiring is now
active; Slice E is not complete.

E0d was accepted at commit `a0266eb`. Browser intents now retain a cloned,
schema-validated and recursively frozen exact detail; curated and managed
same-ID/version selections resolve through source-aware exact lookup. The
route-owned runtime mounts independent template and media discovery providers
after preference bootstrap, with media-only criteria from first activation.
The editor owns production preparation ports, while one shell session captures
the insert, replace or field target, aborts stale work, fences focus restoration
and retains post-commit retry notices beyond dialog close without repeating the
document edit. Legacy dialog records remain separate until E1.

Independent review found one production focus-restoration P1 and one integrated
test/typecheck gate. Both were remediated; the final re-review returned zero
remaining P0/P1 findings. Root verification passed 78/78 affected mounted and
controller tests, full Studio typecheck and scoped diff validation. E1 shared
browser/dialog/field cutover is now active; Slice E is not complete.

## Scope and entry condition

This map turns the media portion of
[the LIBRARY-02 phase entry](./library-02-phase-entry.md) into an implementation
sequence. It follows
[the Gate 5 preferences and collections map](./library-02-gate5-preferences-collections-map.md).
Gate 6 must start from the accepted Gate 5 checkpoint because the active Gate 5
work owns the discovery provider, template browser, editor hook and shell files
that later media integration will use.

This is not an editor architecture change. Studio already has the required
document commands, media repositories, local recovery work, render admission
and discovery contracts. Gate 6 joins those owners through exact media
identities and replaces the six-item compatibility path.

The following earlier audits remain binding:

- [MEDIA-01 implementation audit](./media-01-implementation-audit.md);
- [MEDIA-01 UX audit](./media-01-ux-audit.md);
- [MEDIA-01 browser acceptance](./media-01-browser-acceptance.md);
- [MEDIA-01 independent browser review](./media-01-browser-independent-review.md);
- [ASSET-02 render contract](./asset-02-domain-render-contract.md);
- [ASSET-02 server render admission](./asset-02-server-render-admission.md);
- [ASSET-02 image replacement readiness](./asset-02-image-replacement-readiness.md).

Gate 6 may change discovery and selection wiring. It must not weaken missing
local recovery, archive impact, reference accounting, renderer proof or private
R2 ownership.

## Verified current truth

### Curated media

- `apps/studio/src/content/library/media/manifest.ts` validates 37 immutable
  items. Each resource path encodes item ID, version and SHA-256. The manifest
  also owns dimensions, MIME type, byte count, category, use cases, timestamps,
  license and attribution.
- The 37 declared resources exist under
  `apps/studio/public/library/media/`. The OpenMoji license is checked in beside
  the imported resources.
- `apps/studio/src/content/library/catalog.ts` projects the curated manifest
  into the immutable 58-item Studio catalog and exact-detail map.
- `apps/studio/src/features/editor/asset-catalog.ts` remains a compatibility
  facade for six Studio originals. It rebuilds those SVG files as JavaScript
  data URIs and sets `resourcePath` to `null`.
- `apps/studio/src/features/editor/asset-catalog.test.ts` deliberately proves
  that the other 31 manifest entries are not accepted through the old facade.
- `apps/studio/src/features/editor/asset-library-dialog.tsx` imports
  `studioAssets`. Its Library collection therefore exposes six curated items,
  not the 37-item manifest.
- `apps/studio/src/server/render-field-assets.ts` resolves built-in asset fields
  through the same six-item facade. Managed aliases use the verified managed
  resource path. The other curated items have no equivalent publication and
  render materializer.

The catalog is ready for discovery. Curated insertion, replacement, asset-field
assignment, publication and rendering are not ready for all catalog items.

### Managed workspace media

- `migrations/0007_workspace_media_assets.sql` stores workspace ownership,
  name, MIME type, byte count, dimensions, content hash, private R2 key, status,
  revision and use timestamps. It has no library description, tags, category,
  use cases, provenance or license fields.
- `apps/studio/src/server/media-asset-repository.ts` lists only ready items and
  constrains every read and mutation by workspace. Search currently covers the
  name only.
- The managed content route uses exact metadata, immutable private caching,
  ETag, content length and `X-Content-Type-Options: nosniff`. R2 keys never
  appear in the public record.
- Archive requires a current deletion-impact token and refuses any asset with
  current-document or published-version references. Archive retains the R2
  object.
- Render materialization verifies the stored hash and decoded dimensions. A
  failed or mismatched resource cannot complete a render job.
- `apps/studio/src/features/editor/use-document-editor.ts` refetches a managed
  record through `getManagedMedia` before insert or replacement. It commits the
  typed document command before marking the managed asset used.
- `apps/studio/src/server/library-catalog-service.ts` currently projects only
  the fixed Studio catalog and principal preferences. It does not compose D1
  managed media into library list or detail responses.

Managed bytes and document use are sound. Search metadata and shared library
discovery are missing.

### Device-local media

- `apps/studio/src/features/editor/local-asset-database.ts` and
  `local-asset-store.ts` separate metadata, blobs, quarantine and promotion
  journals in the version 6 IndexedDB schema.
- Listing reads metadata without decoding every Blob. Per-record inspection
  distinguishes ready, missing-byte and quarantined records instead of failing
  the whole collection.
- `apps/studio/src/features/editor/local-asset-preview.ts` uses a placeholder
  when bytes are missing and does not silently replace canonical identity.
- `apps/studio/src/features/editor/asset-library-model.ts` derives exact local
  usage and archive impact from document references.
- The media dialog already supports local upload, retry, recovery, promotion,
  archive review and viewport-scoped object URLs.
- `markLocalAssetUsed` updates the timestamp and increments the local record
  revision. A local library identity that uses this revision is intentionally
  mutable.
- IndexedDB bytes exist only in the current browser profile. A server catalog
  cannot claim that those bytes are present on another device or in another
  browser profile.

Local media belongs in the visible discovery result through a client overlay.
It does not belong in server catalog storage and must keep its recovery path.

### Shared catalog and preferences

- `packages/document/src/library-catalog.ts` has strict media summary and
  detail contracts for `curated`, `managed` and `local` sources.
- `packages/document/src/library-catalog-projections.ts` already projects all
  three source kinds. Managed detail requires an authoritative refetch. Local
  detail carries the exact record revision and rejects archived, missing-byte
  and incomplete records.
- `apps/studio/src/server/library-catalog-service.ts` binds list cursors to the
  immutable base catalog revision and Gate 5 preference workspace revision.
  Managed upload, archive, restore or metadata changes do not yet invalidate a
  library cursor.
- Gate 5 D1 preferences own favorites, last use and collections. Existing
  managed `/used` receipts and browser-local curated Recent state are separate
  mechanisms. Media actions do not yet call the Gate 5 `recordUsed` command.

## P0 gaps

### P0.1 Exact curated materialization

Resolve every curated selection by item ID and immutable version. The resolver
must match the manifest path, checksum, MIME type, byte count and dimensions
before a document command commits. A catalog list row is not enough authority.

The canonical document and asset-field value must retain immutable version and
content identity. Do not reduce a selection to an unversioned ID, arbitrary
network URL or generated data URI.

The manifest resource needs an approved first-party content path. Static
hosting may remain the transport if tests prove that only manifest-declared
exact resources resolve and that the response has the expected MIME type,
length, immutable cache identity, ETag and nosniff policy.

### P0.2 Curated publication and render parity

The editor, published versions, output renderer and asset-field resolver must
use the same curated identity resolver. Extend the current
`render-field-assets.ts` boundary without admitting arbitrary SVG, filesystem
paths or remote URLs. Preserve the existing inline, network-isolated renderer
policy and ASSET-02 resource expectations.

### P0.3 Managed catalog authority

Compose ready managed media into `LibraryCatalogService` with workspace-scoped
summaries and exact details. Before insert, replacement or field assignment,
refetch the authoritative managed record and recheck `selectable`. If the item
was archived after listing, stop before document mutation.

### P0.4 Catalog cursor invalidation

The server catalog revision must include a bounded workspace media catalog
revision as well as the immutable Studio catalog and preference revision.
Upload, archive, restore and searchable metadata changes must invalidate an old
page or cursor. Do not compute an unbounded aggregate hash during each list
request.

### P0.5 Local availability and revision truth

Project ready local records through a browser-owned discovery adapter. Do not
send Blob URLs, IndexedDB bytes or local availability claims through catalog
HTTP. Refetch the exact local revision and integrity state before a document
command. Keep missing, quarantined and archived records out of ordinary search
while retaining their current recovery and archive interfaces.

### P0.6 Post-command Recent receipts

After a successful insert, replacement or asset-field assignment, record the
exact library identity through Gate 5 `recordUsed`. A failure may warn, but it
must not roll back the document command.

Managed media must also keep its repository `/used` receipt because that state
drives managed-media recency. These are two independent post-command effects,
not two document mutations. Retire or migrate the old curated localStorage
Recent record only after durable library use is working.

## P1 gaps

### P1.1 Searchable managed metadata

Add workspace-scoped media catalog metadata with description, normalized tags,
category, use cases, provenance, license and a catalog version. Upload defaults
must say that the item is a workspace upload or customer-provided asset. Do not
invent a license or public source.

Keep `catalog_version` separate from `media_assets.revision`.
`markUsed` increments the media record revision today. Using that revision as a
library version would change favorite and collection identity after every use.

### P1.2 One media discovery controller and browser

Reuse `LibraryDiscoveryController`, the Gate 5 preference provider and the
strict catalog query. Add a media browser that combines curated, managed and
ready local items while showing source and availability honestly. Do not copy
the template browser into a second query and pagination implementation.

The first integration should feed the existing media dialog. It must preserve
upload, recovery, archive-impact and promotion commands. Gate 7 can later mount
the same browser as the persistent editor Assets area.

### P1.3 Device-local organization boundary

The server cannot admit or resolve a browser-only item identity. For Gate 6,
project local items with `canFavorite: false` and
`canAddToCollection: false` until promotion to managed media. If the product
later requires durable organization of local-only items, it needs a stable
server registry contract. Accepting an unverifiable local identity in Gate 5
preferences would be false durability.

### P1.4 Bounded rendering and object URL use

Keep managed results cursor-based. Bound the local projection and rendered card
count. Preserve the dialog's viewport-near Blob loading and URL revocation.
Opening a large media result must not decode every local image or mount every
preview.

## Canonical owners and ports

| Responsibility                            | Existing owner to reuse                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Library schemas, identity and projections | `packages/document/src/library-catalog.ts`, `packages/document/src/library-catalog-projections.ts`, `packages/document/src/media.ts`           |
| Curated source metadata                   | `apps/studio/src/content/library/media/manifest.ts` and `apps/studio/public/library/media/`                                                    |
| Catalog list, detail and cursor authority | `apps/studio/src/server/library-catalog-service.ts`, `apps/studio/src/server/library-http.ts`                                                  |
| Managed D1 and R2 authority               | `apps/studio/src/server/media-asset-repository.ts`, `apps/studio/src/server/media-asset-http.ts`, `migrations/0007_workspace_media_assets.sql` |
| Browser discovery                         | `apps/studio/src/content/library/discovery-controller.ts`, the current discovery client, adapter and provider                                  |
| Durable favorites, Recent and collections | Gate 5 preference repository, HTTP client, controller and provider                                                                             |
| Device-local bytes and integrity          | `apps/studio/src/features/editor/local-asset-database.ts`, `local-asset-store.ts`, `local-asset-preview.ts`, `asset-library-model.ts`          |
| Document mutation                         | `apps/studio/src/features/editor/use-document-editor.ts` typed editor commands                                                                 |
| Current visible media workflows           | `apps/studio/src/features/editor/asset-library-dialog.tsx`, `asset-library-components.tsx`                                                     |
| Publication and renderer materialization  | `apps/studio/src/server/render-field-assets.ts` and `media-asset-repository.ts`                                                                |
| Managed WebMCP discovery                  | `apps/studio/src/features/editor/managed-webmcp-catalog.ts`                                                                                    |

The shell and dialog orchestrate these ports. They do not become new byte,
permission, history or render authorities.

## Non-overlapping implementation slices

### Slice A. Curated exact content

Own manifest lookup, exact content resolution, approved first-party serving,
client materialization, publication and render resolution, and focused tests.
Do not edit the media dialog or managed repository in this slice.

Likely files:

- `apps/studio/src/content/library/media/manifest.ts`;
- a focused curated content resolver and route under `apps/studio/src/server/`;
- route registration;
- `apps/studio/src/server/render-field-assets.ts`;
- `apps/studio/src/features/editor/asset-catalog.ts` during compatibility
  removal;
- focused content, publication and render tests.

### Slice B. Managed metadata and catalog

Own the D1 metadata migration, repository reads and mutations, metadata search,
workspace media catalog revision, dynamic library summaries/details and item
admission. Do not edit editor React or document mutation code.

Likely files:

- a migration after `0014`;
- `apps/studio/src/server/media-asset-repository.ts`;
- `apps/studio/src/server/media-asset-http.ts` if metadata receives a dedicated
  endpoint;
- `apps/studio/src/server/library-catalog-service.ts`;
- `apps/studio/src/server/library-http.ts`;
- repository, HTTP and catalog tests.

### Slice C. Device-local discovery overlay

Own a pure browser adapter from verified local inventory to strict library
media summaries and details. It must project only ready items, disable durable
organization and expose an exact revision recheck port. Do not edit the media
dialog in this slice.

Likely files:

- a focused adapter under `apps/studio/src/content/library/`;
- `apps/studio/src/features/editor/local-asset-store.ts` only if a read port is
  missing;
- projection and stale-revision tests.

### Slice D. Shared media browser

Start only after slices A, B and C settle their contracts. Own the media view
over the current discovery controller and preference provider. Add media cards,
filters, source labels, details, favorites and collections where permitted.
Keep upload, recovery, archive and promotion code untouched during the first UI
checkpoint.

Likely files:

- a media browser beside
  `apps/studio/src/content/library/library-template-browser.tsx`;
- shared library card or filter components where reuse is real;
- browser, keyboard, paging and preference projection tests.

### Slice E. Exact actions and dialog cutover

Own the single action boundary for insert, replace and asset-field assignment.
It resolves exact detail, performs source-specific validation, commits one typed
document command, then records managed and library use. After that boundary is
accepted, replace the dialog's six-item Library feed with the shared media
browser without removing its upload, recovery, archive or promotion flows.

Likely files:

- `apps/studio/src/features/editor/use-document-editor.ts`;
- a focused media selection command module if separation is needed;
- `apps/studio/src/features/editor/asset-library-dialog.tsx`;
- `apps/studio/src/features/studio-shell.tsx` for orchestration only;
- action, history, recovery and integrated browser tests.

Slices A, B and C can run in parallel after Gate 5 commits. Slice D depends on
their public contracts. Slice E owns the overlapping editor files and runs
last.

## Sequence

1. Finish, review and checkpoint Gate 5. Do not start Gate 6 on an uncommitted
   discovery or preference provider.
2. Freeze three contracts in focused tests: curated exact content, managed
   metadata plus media catalog revision, and client-only local projection.
3. Implement slices A, B and C in parallel.
4. Compose curated and managed media in the server catalog. Compose ready local
   media in the browser. Update dynamic item admission and cursor invalidation.
5. Implement slice D with one shared media discovery controller and Gate 5
   preference projection.
6. Implement slice E. Refetch exact source state before each command and record
   Recent only after the command succeeds.
7. Cut the existing dialog over to the shared media feed. Re-run all recovery,
   archive and render regressions before closing Gate 6.

## Essential evidence

### Curated content

- Exhaustively match all 37 manifest records to exact file bytes, SHA-256, MIME
  type, byte count and decoded dimensions.
- Reject unknown IDs, wrong versions, mismatched hashes, retired records and
  path traversal.
- Verify content length, ETag, immutable cache policy and nosniff.
- Prove catalog list and detail never expose data URIs, Blob URLs, R2 keys or
  renderer-only sources.
- Cover insert and replacement for each source family. Cover asset-field,
  publication and renderer resolution.

### Managed metadata and catalog

- Prove workspace isolation for metadata, search, exact detail and content.
- Test truthful upload defaults and normalized description, tags, category and
  use-case search.
- Prove `catalog_version` does not change when only `last_used_at` changes.
- Prove upload, archive, restore and metadata changes invalidate an old library
  cursor.
- Simulate list success followed by archive. Exact refetch must stop the command
  before document mutation.
- Keep the current rule that an asset referenced by a draft or published
  version cannot be archived. Re-run R2 hash and dimension verification.

### Device-local projection

- Ordinary discovery contains only ready records with verified dimensions.
- Missing, quarantined and archived records remain absent from search but
  continue to appear in the existing recovery or impact path.
- A changed local revision fails exact selection before document mutation.
- A second browser profile cannot claim the first profile's local availability.
- Favorite and collection actions remain unavailable until promotion.

### Actions and interface

- Insert and replacement create one history entry each. Replacement preserves
  geometry, crop, frame and binding rules already accepted under ASSET-02.
- Asset-field assignment resolves the same exact media identity.
- `recordUsed` runs only after command success. Managed `/used` or library
  preference failure cannot roll back the document.
- Favorites, Recent, collections and source information survive reload where
  their source contract permits it.
- Desktop and compact browser acceptance retains keyboard focus, 44 px action
  targets, pending state and nonblocking failure recovery.
- A 1,000-item media result keeps mounted cards and local object URLs bounded.

### Required regressions

- the current 18 MEDIA-01 browser acceptance scenarios;
- missing-local locate, managed replacement and remove-reference recovery;
- local and managed archive impact and exact reference counts;
- local promotion journals and durable Recent repair;
- managed renderer admission, R2 hash checks and decoded dimension checks;
- published-version asset resolution.

## Reference code inspected

The reference repositories remain read-only research material. Studio does not
copy or import their code.

OpenPencil checkout:
`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/open-pencil`

- `src/components/assets-panel/AssetsPanel.vue` shows one searchable asset
  view with grouped sources, grid and list modes, details, per-item busy state,
  keyboard insertion, canvas-centred placement and drag as an accelerator. Its
  clickable `div` pattern is not suitable for Studio. Studio should keep native
  buttons.
- `packages/core/src/io/subgraph.ts` copies only the selected dependency
  closure.
- `packages/core/src/library/materialize.ts` materializes only referenced
  library content and images.
- `tests/e2e/components/assets-panel.spec.ts` covers grouping, search, view
  changes, details, insertion, drag and coordinates.

Loora checkout:
`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/loora`

- `packages/editor/src/components/assets-panel.tsx` shows one asset view with
  upload, drop, paste, search, sorting, lazy images, per-item busy state and
  usage counts. Its physical delete and base64 upload choices are not suitable
  for Studio because they can break references and bypass R2 ownership.
- `packages/rpc/src/asset-url.ts` derives a stable content route from asset
  identity.
- `packages/rpc/src/storage.ts` scopes stored object keys by owner.

[The Loora editor reference](../../loora-editor-reference.md) provides the
broader transaction and command context. These files confirm the current Studio
direction. They do not justify replacing Studio's document, media, recovery or
renderer architecture.
