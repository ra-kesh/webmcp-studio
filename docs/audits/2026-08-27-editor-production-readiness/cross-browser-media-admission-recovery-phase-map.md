# Cross-browser media Slice 5: admission and missing-byte recovery

Date: 2026-08-30

Status: **implemented and independently accepted; Slice 6 and row 10 remain active**

Ledger boundary: row 10, Cross-browser local media — Slice 5 only

## Outcome

Open or import a canonical document containing `asset:local/{id}` without
assuming that the current browser owns the original IndexedDB Blob.

Admission resolves every distinct local alias against the workspace mapping
boundary before editor history is installed. An exact ready or archived
mapping can migrate the complete alias reference set to its managed identity
under one document-repository compare-and-swap. The write includes a durable,
recoverable preimage receipt. An unmapped, unavailable, or identity-conflicted
alias remains a truthful local reference and opens with explicit recovery UI;
it is never removed, replaced, or guessed.

This slice also completes the mounted recovery choices for unresolved local
media: **Use Studio copy**, **Locate file**, **Keep this file as a new upload**,
**Choose Studio image**, and context-valid clear or remove actions. Manual
document changes use normal history and the Slice 4 critical-flush contract.

Slice 5 is implementation and focused local evidence. It does not claim that
two real browser contexts, real Cloudflare D1/R2, Access isolation, multipart
promotion, disconnection, or deployed renderer behavior has passed. Those are
Slice 6.

## Evidence reread

The boundary was derived after rereading:

- row 10 and the gate discipline in
  `remaining-product-work-2026-08-29.md`;
- the complete `cross-browser-media-phase-entry.md`, including the safe
  document/browser migration matrix, missing-byte matrix, history contract,
  Slice 5 list, cross-boundary gate, and deliberate limits;
- the complete Slice 1 domain review, Slice 2 server review, Slice 3A journal
  review, Slice 3B owner review, Slice 4 editor relink map, and the accepted
  Slice 4 managed-Recent receipt review;
- `persist-01-phase-entry.md` and `persist-01b-reference-patterns.md`, including
  OpenPencil's admission/controller separation and Loora's ordered persistence,
  route identity, explicit conflict state, and invalidation-not-authority
  patterns;
- MEDIA-01 and ASSET-02 resource, missing-file, renderer-materialization, crop,
  replacement, and admission records; and
- the actual current document repository, route, import, local-asset,
  promotion client, managed-media, editor, canvas, renderer, publication, and
  WebMCP code listed below.

The retained reference decision remains unchanged:

- use OpenPencil's separation of route admission, storage ownership, workspace
  state, and disposable local resources;
- use Loora's ordered persistence, exact target ownership, explicit state, and
  stale-result suppression;
- do not copy OpenPencil's provider/file identity or silent memory fallback;
- do not copy Loora's network transport or transaction rebase; and
- retain Studio's whole-document compare-and-swap and canonical command model.

## Current code truth

### Route and repository admission

- `document-route-admission.ts` currently performs `get`, validates identity,
  calls `touchOpened`, and returns a record. It has a generation guard but no
  `AbortController`, media planning, mapping resolution, migration write, or
  migration receipt.
- `routes/_studio/documents/$documentId.tsx` installs the returned record only
  after route admission, which is the correct ownership seam for a pre-history
  migration. It currently cannot display media-admission progress, a recovery
  manifest, or a post-migration receipt.
- `DocumentDraftRepository.save` has exact expected-version semantics, but a
  stale ordinary save creates a user conflict candidate. Automatic identity
  migration must not manufacture a normal editing conflict before an editor
  session exists.
- The document database is version 1 and has no resource-migration receipt or
  recovery-operation store. `get` correctly treats canonical validity and
  storage integrity as separate from resource availability.
- `installDraftRecord` creates fresh history and a save controller from the
  admitted record. This is the correct point after which an identity change
  becomes a user history operation rather than an admission migration.

### Import admission

- `document-import.ts` decodes and validates before repository access, which
  must remain.
- It then resolves local and managed assets one at a time. A missing local Blob
  returns `resource_policy_failed`, so a valid document from another browser
  cannot currently open with its preserved missing placeholder.
- It does not query local-promotion mappings, distinguish ready from archived
  mapped recovery, compare a healthy local Blob with the authoritative mapping
  hash, or return a recovery plan for user review.
- `importDocumentFile` and `openDocumentFile` consume only success/failure.
  They have session/snapshot generation guards, but no intermediate decision
  state for a transformed or unresolved import.

### Local browser media

- `local-asset-store.ts` has authoritative split metadata/Blob inspection,
  missing-byte detection, quarantine, exact revision, decoded-byte validation,
  and abort-aware exact reads.
- `getLocalAssetRecord` deliberately returns `null` for absent, missing, or
  quarantined bytes. That is sufficient for preview loading but too lossy for
  admission, which must distinguish all four states and retain their recovery
  facts.
- `listLocalAssetInventory` verifies the complete library rather than a
  bounded requested alias set. Admission must not scan or decode unrelated
  user media.
- The local metadata does not store a content hash. A healthy local Blob must
  be hashed only when an authoritative mapping exists and identity comparison
  is required. `hashLocalAssetBlobSha256` already provides the accepted,
  bounded, abort-aware exact-byte implementation.

### Mapping and managed resources

- Slice 2 already exposes one exact lookup and one ordered 1–100 alias resolve
  route. The repository returns ready and archived mappings with authoritative
  content hash and public managed metadata, scoped to the authenticated
  workspace.
- `local-asset-promotion-client.ts` implements exact lookup and multipart
  promotion but has no strict ordered batch-resolve client.
- Managed content lookup and the private content endpoint can read retained
  archived bytes. Archived mappings are therefore valid existing-reference
  recovery targets even though `selectable` remains false and ordinary media
  search/listing omits them.
- Slice 4's idempotent `/used` receipt can account for a recovered managed
  reference after the migrated draft is durable.

### Existing missing-media UI

- The canvas and Inspector preserve geometry and expose Retry, Locate, and
  Remove for an unavailable selected image.
- The Media dialog inventories missing aliases and offers Locate. It has no
  mapping-aware state, archived-backup state, hash-conflict choice, Studio-copy
  action, managed replacement choice, or field-specific clear behavior.
- `StudioShell` currently implements Locate by finding the first image node for
  an alias and opening ordinary single-node replacement. It ignores field-only
  references, duplicate direct references, bound projections, other pages,
  and outputs. It is not a valid alias recovery implementation.
- Missing-state projection currently comes from canvas readiness plus healthy
  inventory IDs. Repository outage, unknown backup status, missing bytes,
  quarantine, and a proven unmapped alias are not distinguishable.

### Renderer, publication, and WebMCP

- The editor previews local bytes through browser Object URLs and managed bytes
  through authenticated content URLs. A missing local alias already becomes a
  truthful unavailable canvas source.
- foreground local export requires the IndexedDB Blob; managed rendering uses
  verified private materialization. Publication and renderer policy correctly
  reject unresolved local aliases.
- managed archived content remains materializable for an exact existing
  reference. Ordinary selection remains ready-only.
- WebMCP redacts local identity to an unavailable marker and rejects it as a
  selectable managed resource. After admission relinks the document, normal
  managed identity is visible. No mapping hash, local alias, R2 identity, or
  local Blob is exposed through the catalog.

## P0 prerequisites before Slice 5 can be implemented safely

### P0-1: add a dedicated admission migration transaction

Do not call ordinary `save` from route admission. A stale ordinary save creates
an editing conflict candidate and cannot atomically retain the required
preimage receipt.

Add a repository operation equivalent to:

```ts
type MigrateLocalMediaInput = Readonly<{
  source: DraftHeadIdentity
  resultEnvelope: CurrentDraftEnvelope
  aliases: readonly AdmissionMigrationAlias[]
  receiptId: string
  createdAt: string
}>

DocumentDraftRepository.migrateLocalMedia(
  input: MigrateLocalMediaInput,
  signal?: AbortSignal
): Promise<
  | { ok: true; status: "migrated" | "replayed"; record: DocumentDraftRecord; receipt: LocalMediaAdmissionReceipt }
  | { ok: false; reason: "stale_head" | "deleted"; current: DocumentDraftSummary }
  | { ok: false; reason: "receipt_pending"; receipt: LocalMediaAdmissionReceipt }
  | { ok: false; reason: "validation_failed" | "storage_unavailable"; failure: DraftRepositoryFailure }
  | { ok: false; reason: "corrupt_record"; quarantineId: string; failure: DraftRepositoryFailure }
>
```

The body, metadata, invalidated preview, and receipt must commit in one
IndexedDB transaction after the exact source body/head is reread. A stale head
returns authority to the admission controller without creating a conflict row.
Cancellation requests transaction abort and waits for abort or commit
acknowledgement.

### P0-2: add exact requested-alias local inspection

Add one abort-aware local repository API that returns an ordered result for a
bounded set of strict aliases:

```ts
type LocalAssetAdmissionState =
  | { status: "ready"; record: LocalAssetRecord }
  | { status: "missing_bytes"; summary: LocalAssetSummary; issue: LocalAssetIntegrityIssue }
  | { status: "absent" }
  | { status: "quarantined"; issue: LocalAssetIntegrityIssue }
  | { status: "unavailable"; code: string; message: string }
```

It must inspect only requested IDs, preserve request order, quarantine only a
proven corrupt pair, and distinguish repository failure from absence. It must
not call the complete-library inventory and must not convert an unavailable
database into a false `absent` result.

### P0-3: add the ordered batch-resolution browser client

Add a strict client for `POST /v1/studio/assets/local-promotions/resolve` that:

- accepts 1–100 distinct canonical local IDs per request;
- requires the exact result length and request order;
- requires each result alias and nested promotion identity to match;
- requires a valid response request ID;
- classifies cancellation, timeout, network failure, malformed 2xx, and
  canonical server errors without converting unknown status into unmapped;
- uses `cache: "no-store"`; and
- returns no private media or storage identity.

Admission may partition at most 5,000 distinct aliases into stable 100-ID
chunks with concurrency two. More than 5,000 aliases is an explicit
`local_media_alias_limit_exceeded` recovery state and starts no network work.
This total bound matches the renderer's 5,000-layer product ceiling while
preventing unbounded route fan-out from field-only input.

### P0-4: add a canonical local-to-local identity migration

**Keep this file as a new upload** cannot put different bytes under an old
alias, and it cannot point the old alias at a managed asset that contradicts
the server's durable mapping. Add a domain command equivalent to
`relink_local_asset_references` with strict `from`, strict new local identity,
and exact sorted `expectedReferenceKeys`.

It must reuse the Slice 1 aggregate semantics: update exact field default and
current slots, direct nodes, and bound projections in one canonical command;
preserve every non-identity property; reject unrelated projection drift; and
create one history entry. Ordinary single-node replacement guards remain
unchanged.

Context-valid clear/remove can use existing canonical commands in one history
transaction after exact impact review:

- one unlocked, unbound image may use `remove_node`;
- an optional unbound asset field slot may use `set_field` or `update_field`
  with an empty value;
- a bound field cannot be cleared while its image bindings remain. The reviewed
  action must unbind/remove the named bound layers and then clear the exact
  optional slot in the same command batch; and
- required fields never offer clear. They offer Locate or managed replacement.

### P0-5: route admission needs cancellable preparation and post-install touch

The route controller needs an operation token plus `AbortController` covering
local inspection, mapping batches, hashing, planning, and the migration
transaction. `supersede` and `dispose` must abort and await acknowledgements.

`touchOpened` should move out of pre-install admission. Admission returns an
exact record and admission identity. After `installDraftRecord` confirms the
same record in the same route/session generation, a post-install confirmation
may call `touchOpened`. A touch failure is a warning, never permission to
install a stale record.

### P0-6: import must return a plan, not collapse recovery to failure

Refactor import into three boundaries:

1. bounded file read, JSON decode, schema, aggregate, and render-policy
   validation;
2. cross-browser media planning with no document or repository mutation; and
3. explicit install/persistence after the user accepts any transformed or
   unresolved media plan.

A missing canonical local Blob is no longer `resource_policy_failed` by itself.
Malformed identity, invalid aggregate, unmanaged remote input, or an
unverifiable managed asset remains a hard admission failure.

## Ownership map

| Owner | Responsibility | Must not own |
| --- | --- | --- |
| Document package | Strict alias extraction, exact reference keys, local-to-managed and local-to-local aggregate commands, deterministic admission plan projection | IndexedDB, fetch, React state, R2 content |
| Local asset repository | Requested-ID inspection, verified Blob restore, CAS against local state/revision, quarantine truth | Workspace mapping or document mutation |
| Promotion mapping client | Ordered private batch resolution and exact request/error identity | Local bytes, document mutation, optimistic cache authority |
| Document draft repository | Exact head CAS, atomic body/meta/preview/receipt write, receipt read/acknowledge/restore | Network lookup, editor history, UI decisions |
| Route admission controller | Operation token, cancellation, phase progress, re-read/replan loop, safe automatic migration before history | Mounted editor mutation or focus |
| Import controller | File-operation token, plan review, active-session/snapshot recheck, accepted persistence/install | Silent canonical rewrite |
| Mounted recovery controller | User-approved mapping/file choice, exact active-session anchor, one history commit, Slice 4 critical flush and idempotent Recent reconciliation | Upload alias overwrite, background inactive-document rewrite |
| Media/Inspector UI | Explain current truth, impact, choices, progress, retry, focus, and announcements | Correctness authority or durable operation ownership |
| Server mapping and managed repository | Workspace isolation, authoritative alias/hash/asset status, retained archived recovery, idempotent Recent receipt | Browser-local inventory or UI state |

BroadcastChannel and managed-media invalidation remain hints. Every operation
rereads its authoritative repository before publishing a result.

### Exact document and source ownership

- The admitted draft envelope is the only document authority. Admission may
  replace exact `asset:local/{id}` identity occurrences through a canonical
  aggregate command; it must not recompute quotation pages, recompose a
  template, refresh Stuwiz data, rename fields/layers, or normalize unrelated
  document content.
- `sourceContext`, quotation snapshots, template/composer identity, bindings,
  page/output order, Review journal, crop state, and publication linkage stay
  byte-for-byte or semantically identical except where the canonical media
  identity command necessarily updates a bound image projection.
- A field default/current slot owns its source value. A bound image is a
  projection of that field, not an independent source owner. Admission changes
  both only through the aggregate reference set; it never writes the bound
  layer alone.
- A direct image node owns its own source. Duplicate direct nodes remain
  distinct reference keys even when they point to the same alias.
- The browser-local repository owns local metadata and Blob availability. The
  document stores only the strict local alias and never gains ownership of the
  Blob, local path, file handle, or object URL.
- The authenticated workspace mapping owns the durable relation from old local
  alias to managed identity and content hash. A document migration consumes
  that relation; it does not edit, archive, revive, or delete it.
- Managed asset readiness, archived status, and retained bytes are server
  authorities. An archived mapping is admissible only for the exact existing
  alias relation; it does not become a generally selectable asset.
- The route admission operation owns only the record it read under its exact
  document/head/generation. The mounted editor owns later user changes. Neither
  may publish progress, focus, or results into the other's session.

## Exact admission identities

```ts
type DraftHeadIdentity = Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: `sha256-${string}`
  draftSnapshotId: `sha256-${string}`
  deletedAt: string | null
}>

type MediaAdmissionOperation = Readonly<{
  operationId: string
  routeOrImportGeneration: number
  sourceHead: DraftHeadIdentity | null
  sourceDocumentId: string
  sourceContentSnapshotId: `sha256-${string}`
  aliases: readonly string[]
}>

type AdmissionMigrationAlias = Readonly<{
  localAssetId: string
  managedAssetId: string
  managedSource: `asset:managed/${string}`
  contentSha256: string
  managedStatus: "ready" | "archived"
  expectedReferenceKeys: readonly string[]
  localState: "ready" | "missing_bytes" | "absent" | "quarantined"
  relationship: "same_hash" | "no_local_bytes"
  mappingRequestId: string
}>
```

Aliases and reference keys are sorted and unique. The migration planner derives
the source content snapshot itself; it never trusts a React snapshot state or
summary without verifying the envelope.

## Per-alias state model

Local state:

- `ready`: exact record and verified Blob are available;
- `missing_bytes`: valid metadata exists but its Blob does not;
- `absent`: neither current metadata nor current Blob exists;
- `quarantined`: the current pair was proven corrupt and preserved in
  quarantine;
- `unavailable`: IndexedDB could not be opened or read, so presence and bytes
  are unknown.

Mapping state:

- `mapped_ready`;
- `mapped_archived`;
- `unmapped`; or
- `unavailable`.

For `ready + mapped`, hash the exact Blob with the accepted Slice 3 owner hash
function and classify `same_hash` or `different_hash`. Do not infer content
identity from file name, MIME type, byte count, dimensions, metadata revision,
or preview pixels.

| Local state | Mapping state | Admission result |
| --- | --- | --- |
| ready | unmapped | Keep the local source. Offer Make available everywhere after open. |
| ready | mapped, same exact hash | Safe automatic migration candidate. No upload. |
| ready | mapped, different hash | No mutation. Require **Use Studio copy** or **Keep this file as a new upload**. |
| missing_bytes / absent / quarantined | mapped_ready | Safe automatic migration candidate; disclose **Studio copy recovered**. |
| missing_bytes / absent / quarantined | mapped_archived | Safe automatic migration candidate; disclose **Studio backup recovered** and keep it non-selectable. |
| missing_bytes / absent / quarantined | unmapped | Preserve the local reference and placeholder; offer Locate, Choose Studio image, and context-valid clear/remove. |
| any | mapping unavailable | Preserve the document and label backup status unknown with Retry. Never claim that no backup exists. |
| local unavailable | any | Preserve the local reference. Mapping may be displayed as a candidate, but automatic migration is disabled until local state is known or the user explicitly chooses Studio copy. |

A malformed alias or incoherent local image `assetId`/`src` remains canonical
validation failure. A malformed or order-drifted mapping response is repository
unavailable, not unmapped.

## Route-open data flow

1. Validate the route ID and capture one admission operation/generation.
2. Read and verify the complete draft record and exact head. Reject missing,
   deleted, corrupt, quarantined, and document-storage-unavailable states using
   the existing route outcomes.
3. Extract every distinct local alias and exact reference-key set from the
   canonical envelope. Zero aliases proceeds unchanged.
4. Inspect only those aliases in the local repository. Preserve typed
   unavailable results.
5. Resolve the sorted aliases through bounded, ordered mapping batches. A
   failed or malformed batch leaves the document unchanged; do not apply the
   successful prefix.
6. Hash only healthy local Blobs that have a mapping. Use concurrency two,
   per-Blob accepted read/total deadlines, phase progress, and operation
   cancellation.
7. Build the complete deterministic plan. Split exact safe migration aliases
   from unresolved, unavailable, and decision-required aliases.
8. Before persistence, recheck the operation generation and abort state. The
   user may choose **Open without recovering now** while work is still
   cancellable; that installs the original verified record with the recovery
   manifest and performs no migration write.
9. Apply all safe alias commands to an in-memory candidate. If any command or
   aggregate validation fails, discard the whole candidate and enter explicit
   recovery. Never persist a successful prefix.
10. Derive the candidate content/draft identities. Call the dedicated atomic
    migration operation with the exact source head and one batch receipt.
11. On `stale_head`, reread and replan from the new body at most twice. A third
    change opens the latest verified body unchanged and reports that recovery
    was deferred because another session kept editing.
12. On success, return the exact migrated record plus receipt to the route.
    Install fresh history from that record only if the route operation still
    owns presentation.
13. After the exact session reports installed, call `touchOpened`. Focus the
    canvas only for the owning route generation.
14. Reconcile unique managed asset IDs into Recent using stable keys stored in
    the migration receipt. This finishing work may survive view loss, but it
    cannot change the mounted editor or focus.

Safe automatic migration is not silent: the route loading surface names
**Recovering Studio images**, shows alias progress, and the installed editor
retains a visible recovery summary until the user acknowledges or opens its
details. Automatic migration is limited to exact identity evidence. A hash
conflict or unknown repository state always requires a user choice.

## Atomic migration receipt and recovery

Upgrade the document database from version 1 to version 2 by adding a separate
`draft-media-migrations` store. Do not add receipt fields to every draft body
or to the local-asset promotion journal.

```ts
type LocalMediaAdmissionReceipt = Readonly<{
  schemaVersion: 1
  receiptId: string
  kind: "local_media_admission"
  documentId: string
  createdAt: string
  acknowledgedAt: string | null
  restoredAt: string | null
  source: DraftHeadIdentity
  result: DraftHeadIdentity
  aliases: readonly AdmissionMigrationAlias[]
  preimage: CurrentDraftEnvelope
  managedUses: readonly {
    assetId: string
    idempotencyKey: string
    requestId: string | null
    usedAt: string | null
    assetRevision: number | null
  }[]
}>
```

Required indexes are `(documentId, createdAt)` and `(acknowledgedAt,
createdAt)`. The record contains no Blob, object URL, data URI, signed URL, R2
key, or fetched managed bytes. The preimage is the exact canonical envelope
already subject to the 32 MiB draft admission ceiling.

Receipt invariants:

- body, metadata, preview invalidation, and receipt commit atomically;
- the receipt source equals the exact pair reread in the write transaction;
- the receipt result equals the written pair and increments `recordVersion`
  once;
- every alias has a nonempty exact reference set and the result is exact
  target-only for all of them;
- source context, Review journal, quotation refresh journal, publication link,
  document ID, and all non-identity document properties are preserved;
- one migration receipt may cover many aliases, including several aliases
  deduplicated to the same managed asset;
- `managedUses` is unique by managed asset ID, not alias;
- no migration commits if its receipt cannot commit; and
- a replay of the exact source/result returns the existing receipt rather than
  incrementing the record again.

Bounded retention:

- permit at most one unacknowledged preimage receipt per document;
- if that receipt still matches the current result head, return and disclose
  it instead of migrating again;
- if the document advanced, retain Download and Save preimage as copy. Do not
  overwrite edits and do not silently evict the preimage;
- another automatic admission migration waits until the user keeps/restores
  the prior result or explicitly acknowledges its recovery receipt;
- acknowledgement may remove the preimage only after the user chooses **Keep
  recovered version**; retain a small metadata-only audit record; and
- retain at most 32 acknowledged metadata-only receipts, pruning oldest first.
  Capacity pressure never removes an unacknowledged preimage.

Recovery choices:

- **Keep recovered version** acknowledges the receipt and removes only its
  duplicate preimage.
- **Restore device-only version** is available only while the current durable
  head exactly equals the receipt result. It restores the preimage with a new
  repository version and records `restoredAt`. It explains that missing local
  bytes may show placeholders on this browser.
- If the current head advanced, offer **Save device-only version as a copy**
  and Download. Reuse the existing preserving conflict-copy identity rules; do
  not overwrite the live head.

Admission migration creates no editor Undo entry because it precedes history.
The receipt is the explicit recovery mechanism.

## Import data flow and decisions

1. Read and decode the file under the existing 32 MiB boundary.
2. Validate schema, migrations, aggregate semantics, renderer limits, fonts,
   and managed/local identity syntax before sending any alias to the server.
3. Build the same local/mapping/hash plan without writing the document
   repository or current editor.
4. If the plan has no local aliases, continue unchanged.
5. If exact mappings, unresolved aliases, archived backups, conflicts, or
   unknown repository state exist, show **Review document images** before
   install. List counts, affected pages/layers/fields, and each required user
   choice without displaying hashes.
6. **Open/Import with Studio copies** applies only exact safe mappings and
   preserves unresolved aliases. **Open/Import without recovering** preserves
   the original canonical document. Conflict aliases require an explicit
   per-alias choice before they can change.
7. Recheck file-operation generation and the active document/session/snapshot
   anchor before replacing or creating anything.
8. A separate imported document is created durably before navigation. Import
   into the active same-ID document remains one normal history replacement;
   its accepted media transformations are part of that one imported document,
   not hidden follow-up commands.

Imports never rewrite raw JSON before decoding and validation. The returned
import result may contain `mediaPlan`, `candidateDocument`, and
`recoveryManifest`; it must not collapse valid missing local resources into a
generic resource-policy error.

## Mounted missing-byte recovery

Mounted recovery starts from one exact alias impact projection and captures:

- document ID, content snapshot, history snapshot, operation version;
- active persistence session object and generation;
- draft record version and draft snapshot;
- exact source reference keys; and
- local inspection plus exact mapping identity and request ID.

Before commit it rechecks every anchor coordinate, Review/crop/quotation
refresh/recovery state, local state/revision, mapping identity/status/hash, and
reference keys. A stale result changes nothing and recomputes impact on Retry.

### Use Studio copy

- Available for an exact ready or archived mapping.
- If healthy local bytes differ, require confirmation: the document will use
  Studio's saved copy; the device file and server mapping are both retained.
- Apply one `relink_asset_references` command for every exact use.
- Archived copy says **Studio backup found** and remains absent from ordinary
  selection.
- One history entry is authoritative for Undo truth. Undo may restore a local
  alias whose Blob is unavailable; explain this before confirmation.
- After commit, use the Slice 4 non-cancellable critical flush, exact read-back,
  and stable `/used` receipt. No second upload occurs.

### Locate file

Validate media type, byte count, dimensions, decoded pixels, and exact SHA-256
before any document mutation.

- If the hash matches a committed mapping or a trustworthy retained promotion
  hash, restore the local Blob under the old alias with a local-state/revision
  CAS, retain any quarantine record, and offer/apply the exact managed relink.
- If the hash differs from the committed mapping, never overwrite the old
  alias. Offer **Use Studio copy** or **Keep this file as a new upload**.
- If no trustworthy old hash exists, mint a new local ID, save the file under
  it, and apply one `relink_local_asset_references` transaction. The old alias
  remains unchanged for other documents/history.
- A newly saved local identity may then use the accepted Slice 4 Make available
  everywhere flow. If the document relink fails, the new local upload remains
  as an unused recoverable item rather than being deleted.

### Choose Studio image

Choose only a currently ready/selectable workspace or built-in image. Show the
complete alias impact first, then replace all exact alias uses in one canonical
transaction. Choosing another managed image is an explicit document override;
it does not change or delete the durable old-alias promotion mapping.

### Clear and remove

- Selected unlocked unbound image: **Remove this layer**.
- Optional unbound field current/default slot: **Clear this field value** with
  the exact slot named.
- Bound optional asset field: review all bound layers; one transaction
  unbinds/removes the chosen layers and clears the chosen field slot. Do not
  leave an empty source projected into an image.
- Required field: no clear action.
- Locked layer, pending Review, active crop, or unavailable exact impact:
  disabled with the specific reason.

None of these actions may use the current `StudioShell` first-node shortcut.
Alias-level actions must include field-only and multi-page references.

## History, draft durability, and Recent

- Admission-time safe migration: no history entry; atomic preimage receipt.
- Import into an active document: one normal **Import document** history entry
  containing the accepted canonical result.
- Mounted Use Studio copy, new local identity, choose managed image, or reviewed
  clear/remove: one history transaction per confirmed user action.
- The history commit's `undoable` value is authoritative. UI never promises
  Undo if the byte budget rejected the entry.
- Undo/Redo changes only the document. It does not delete local bytes, a
  mapping, managed bytes, a restored local Blob, or a newly minted local item.
- Every mounted document commit uses the Slice 4 critical flush and exact
  repository read-back before success is announced.
- Admission migration writes stable, unique `/used` idempotency keys into its
  receipt before the body CAS. It calls `/used` only after the migrated body is
  durable, once per unique managed asset. Lost responses replay the key.
- A Recent failure leaves the recovered document safe and the receipt pending.
  The next receipt reconciliation continues; it never repeats the migration.

## Race and session fences

- One live admission token owns progress and presentation. Repository CAS owns
  durable truth.
- Route/import supersession aborts local reads, mapping batches, hashing, and a
  not-yet-committed migration transaction. It waits for abort/commit
  acknowledgement before the operation is considered stopped.
- If persistence wins a cancellation race, the receipt makes that durable
  migration discoverable on the next open. The stale operation cannot install,
  focus, announce, or touch the superseding route.
- A stale `get`, batch response, hash, receipt update, or managed-use response
  cannot mutate a mounted editor.
- Mapping creation in another tab is an invalidation hint only. An already
  mounted document never auto-relinks. It changes to **Studio copy available**
  after authoritative reread and waits for a user action.
- Admission CAS stale-head retry always re-extracts references and reruns local
  and mapping classification. It never applies a plan to a newer body.
- A local Blob restored or replaced in another tab is protected by exact local
  state/revision CAS.
- Document deletion, route replacement, recovery, Review, crop, quotation
  refresh, or critical Slice 4 persistence prevents a mounted recovery commit.
- After a mounted recovery document commit, cancellation disappears and the
  critical flush/use reconciliation finishes exactly as Slice 4 specifies.
- Closing a dialog never owns or cancels correctness. Durable admission/manual
  operation state is outside Radix content.

## Privacy and boundary rules

- Batch resolution is authenticated, same-origin, workspace-scoped, private,
  and no-store.
- Only strict local aliases cross the request boundary. Local file names,
  paths, Blobs, dimensions, previews, and local repository state do not.
- Content hashes are compared in the controller and stored only in private
  browser receipts/journals plus the existing private server mapping response.
  They are never displayed, included in Review, or exposed through WebMCP.
- Responses and receipts contain no R2 key, object URL, signed URL, data URI,
  or managed bytes.
- UI prefers the retained file/layer/field name. Raw alias IDs appear only in
  an expanded technical detail when no safe label exists.
- WebMCP continues to redact/reject unresolved local references. It receives a
  managed ID only after canonical admission or a user history command commits.
- Review proposals, history labels, render jobs, public templates, exports, and
  publication do not contain mapping request IDs, local aliases, content
  hashes, or local recovery receipt details.
- Browser Rendering still receives only verified inline private resources from
  the existing server materializer. It never fetches local or managed media
  over the network.

## Renderer and output behavior

- Unresolved local reference: editor placeholder remains; foreground export
  and publication fail with the existing exact missing/unmanaged resource
  identity.
- Ready managed migration: browser preview uses authenticated managed content;
  server render materializes and verifies R2 bytes.
- Archived mapped migration: browser content and server materialization remain
  available for this exact existing reference; ordinary Media selection and
  WebMCP asset search keep it non-selectable.
- Import/admission never embeds fetched managed bytes into the canonical draft.
- After recovery, PNG, PDF, publication, and WebMCP operate on the same managed
  canonical source and retain current renderer admission invariants.

## UI, focus, and accessibility

### Route admission

- Stable shell with phase text: **Checking document images**, **Checking this
  device**, **Checking Studio copies**, **Verifying matching files**, and
  **Saving recovered images**.
- Show determinate alias counts; byte progress is not claimed for hashing.
- While precommit work is cancellable, **Open without recovering now** installs
  the verified original record and its recovery manifest.
- Migration commit and receipt write are a short non-cancellable finishing
  phase. Do not offer false Cancel.
- Failure focuses a heading with Retry and Open without recovering where safe.

### Installed editor

- A migrated receipt produces a persistent, polite status banner:
  **Recovered N Studio images** or **Recovered N Studio backups**. Actions are
  Review details, Keep recovered version, and the context-valid restore path.
- Unresolved aliases appear in one **Document media** section in the existing
  Media dialog, not a second media picker or toast-only lifecycle.
- Each alias card shows one of: On this device; Studio copy available; Studio
  backup found; Different file on this device; File missing; Backup status
  unknown.
- Inspector and Media use the same projected alias state. Selecting a bound
  use navigates to its owning field; selecting a direct use navigates to its
  page/layer.
- Impact review lists exact layer, field, page, and output counts before any
  alias-wide mutation.
- Progress/status regions use `role="status"` and polite announcements;
  deterministic identity conflicts use `role="alert"`.
- Native buttons have visible `:focus-visible`, at least 44 px compact targets,
  no nested controls, and specific disabled reasons.
- Retry replaces the failed control and receives focus. Completion does not
  close the Media dialog. Closing returns focus to the opener.
- Desktop and 390 px compact layouts have one scroll owner, no horizontal
  overflow, and no forced search autofocus/software keyboard.

## Stable failure identity

| Code | Meaning and retry rule |
| --- | --- |
| `local_media_alias_limit_exceeded` | Deterministic automatic-admission bound; open unchanged and recover in bounded groups. |
| `local_media_local_repository_unavailable` | Presence/bytes unknown; Retry local inspection or explicitly use Studio copy. |
| `local_media_mapping_unavailable` | Backup status unknown; Retry. Never project unmapped. |
| `local_media_mapping_invalid_response` | Response length/order/identity/request ID failed; Retry and retain the original document. |
| `local_media_identity_conflict` | Healthy local hash differs from durable mapping; requires Use Studio copy or new identity. |
| `local_media_admission_stale` | Draft changed during planning; re-read/replan. After bounded retries, open unchanged. |
| `local_media_migration_persistence_failed` | Body/receipt CAS did not commit; prior draft remains authoritative. Retry. |
| `local_media_migration_receipt_pending` | An earlier recoverable migration awaits disposition; disclose it before another automatic mutation. |
| `local_media_restore_stale` | Receipt result is no longer the current head; Download or Save as copy. |
| `local_media_located_file_mismatch` | Selected bytes do not match the known alias identity; choose Studio copy or new identity. |
| Existing promotion/upload/managed errors | Preserve their accepted deterministic, retryable, unknown-status, and request-ID semantics. |

Errors retain bounded safe messages and verified request IDs. They do not store
response bodies, stack traces, local paths, file bytes, or R2 identity.

## Migration compatibility

- Document database version 1 to 2 adds only the media-migration store and
  indexes. Existing body, metadata, preview, conflict, quarantine, and settings
  rows are unchanged.
- A blocked upgrade closes the attempted connection and says to close the
  other Studio tab. It never falls back to an in-memory receipt.
- Unknown or malformed migration receipts are quarantined as receipts. A valid
  draft body is not quarantined because auxiliary receipt data failed.
- Local asset database stays at its accepted Slice 3 schema version unless the
  exact Blob-restore CAS needs an isolated operation record. Requested-ID
  inspection alone requires no database upgrade.
- Existing documents with local aliases remain canonical and are admitted on
  open. Schema defaults do not imply that their resources were migrated.
- Existing promotion journals and mappings retain their identities. Admission
  reads them as evidence where valid; it never rewrites, resets, or deletes
  them.
- Immutable published template versions are not rewritten. They already reject
  local aliases before publication.

## Focused essential tests

The implementation gate should prefer focused tests over a repository-wide
run while the phase is active.

### Planner and domain

- Stable deduplicated aliases and exact node/field default/current/bound
  reference keys across pages and outputs.
- Every state-matrix row, including ready same hash, ready different hash,
  missing ready mapping, missing archived mapping, unmapped, local unavailable,
  mapping unavailable, malformed response, and alias-limit refusal.
- Multi-alias candidate is all-or-nothing and preserves every non-identity
  property.
- Local-to-local reidentity preserves bindings and geometry; different bytes
  never reuse the old ID.
- Context-valid clear/remove batches reject required fields and never project
  an empty source into a bound image.

### Local and mapping repositories

- Requested-ID local inspection distinguishes ready, missing bytes, absent,
  quarantined, and unavailable without scanning unrelated assets.
- Blob restore requires exact expected local state/revision and exact known
  hash; a race changes nothing.
- Batch client proves order, result count, nested alias identity, 100-item
  bound, stable chunking, request ID, abort, timeout, canonical error, malformed
  2xx, private/no-store, and no private response fields.

### Draft CAS and receipt

- Version-1 database upgrades without changing existing records.
- Body, metadata, preview invalidation, and receipt commit together. Inject
  failure at each request and prove the previous pair and preview remain.
- Exact replay returns one receipt and one result version.
- Stale head returns no conflict candidate and no partial receipt; replan uses
  the newer body.
- One unacknowledged receipt blocks a second automatic migration without
  deleting its preimage.
- Exact-head restore succeeds; advanced-head restore refuses and preserves
  Download/Save-as-copy recovery.
- Admission Recent reconciliation is once per unique managed asset and survives
  lost response without repeating the draft migration.

### Route, import, and session

- Route with an empty local asset repository and exact ready mapping returns
  and installs one coherent managed record plus receipt.
- Archived mapping installs and renders but remains non-selectable.
- Unmapped/mapping-unavailable/hash-conflict documents install unchanged with
  exact recovery state.
- Supersede during local read, mapping response, hash, CAS, post-commit use, and
  pre-install prevents stale install, touch, focus, and UI publication.
- Commit-wins cancellation is disclosed from the durable receipt on next open.
- Import validates before mapping lookup, reviews transformed/unresolved media,
  and does not reject a valid missing local alias as corrupt.
- Import into an active document rechecks document/session/history snapshot and
  creates one truthful history entry.

### Mounted recovery UI

- Use Studio copy covers direct nodes, fields, bindings, pages, and outputs in
  one history commit and one critical flush; target-only replay is a no-op.
- Ready and archived mappings have distinct copy and selection behavior.
- Locate matching known hash, locate different hash, unknown-hash new identity,
  choose managed image, optional clear, bound remove/unbind/clear, required
  refusal, and locked/review/crop refusal all retain exact impact.
- Undo truth, placeholder-after-Undo copy, stable Retry, focus, announcements,
  44 px compact controls, one scroll owner, and no auto-close.
- Unresolved local sources remain blocked from export/publication and redacted
  in WebMCP. Recovered managed sources pass the existing materialization and
  admission seams.

Suggested focused commands after implementation:

```sh
bunx vitest run packages/document/test/media-relink.test.ts packages/document/test/media-recovery.test.ts packages/editor/test/history.test.ts
bunx vitest run --config apps/studio/vitest.config.ts apps/studio/src/features/editor/cross-browser-media-admission.test.ts apps/studio/src/features/editor/document-route-admission.test.ts apps/studio/src/features/editor/document-import.test.ts apps/studio/src/features/editor/local-asset-store.test.ts apps/studio/src/features/editor/missing-image-recovery.test.ts apps/studio/src/features/editor/asset-library-dialog.test.ts apps/studio/src/features/editor/use-document-editor-managed-assets.test.ts
bun run --filter @webmcp/document typecheck
bun run --filter @webmcp/editor typecheck
bun run --filter @webmcp/studio typecheck
git diff --check
```

## Slice 5 exit gate

Accept Slice 5 only after an independent code review finds no P0/P1 and focused
non-browser evidence proves:

1. a canonical document can be admitted with an empty simulated local media
   repository;
2. exact ready and archived mappings produce one atomic managed document,
   receipt, and expected-version write before history installation;
3. missing, unknown, and conflicting identity remains recoverable without
   guesswork or silent mutation;
4. mounted user choices cover nodes, fields, bindings, pages, and outputs with
   one truthful history transaction and critical flush;
5. no stale route/import/recovery owner can install, mutate, focus, or publish
   into another session; and
6. unresolved local identity remains private and blocked from remote output,
   while recovered managed identity uses the existing renderer/WebMCP/API
   contracts.

This closes Slice 5 implementation only. It does not close ledger row 10.

### Exit record — 2026-08-30

- The final independent review in
  `cross-browser-media-admission-recovery-independent-review.md` is **ACCEPT**
  with zero open P0/P1.
- Its expanded final-tree evidence covers 18 focused files and 321 passing
  tests, document and Studio typechecks, scoped lint for every changed Studio
  TypeScript file outside the deliberately guarded large editor hook, and a
  clean diff check.
- The mounted/UI freeze matrix passes 159/159. Root reruns also cover the
  route/domain/import/local boundary and the post-lint delta. Counts overlap
  and are recorded as freeze evidence rather than summed.
- The accepted implementation includes exact admission CAS and receipts,
  bounded private mapping, import planning, local Blob recovery, mounted
  recovery choices, a durable history-prepared checkpoint, exact/later body
  reconciliation, stable Recent replay, stale-owner fences, and truthful
  recovery/Undo presentation.
- Slice 6 remains the only owner of real two-browser, real IndexedDB,
  deployed Worker/D1/R2, network-fault, cross-browser output, privacy-payload,
  repository-wide build/lint, and final deployed acceptance claims.

## Slice 6 boundary kept explicitly separate

Slice 6 still owns all real-browser and deployed claims:

- two isolated Chromium contexts where one owns the Blob and the other starts
  with empty asset IndexedDB;
- real IndexedDB upgrade/blocking, FileReader hashing, BroadcastChannel hints,
  multi-tab admission races, reload, focus, and compact visual evidence;
- a real multipart promotion into the Access-protected Worker, D1 mapping and
  use receipt, R2 object metadata/hash, request-audit correlation, and
  archived retained bytes;
- owner-authenticated same-workspace recovery plus a different-workspace denial;
- real timeout/disconnect/committed-response-loss/D1-race behavior;
- cross-browser PNG/PDF, publication, and WebMCP completion after recovery;
- network payload inspection proving no local Blob, local file metadata, R2
  key, signed URL, data URI, or private managed bytes leaked; and
- repository-wide lint, typecheck, test, build, format, immutable evidence, and
  final independent review.

No local fake, single browser context, unit D1 adapter, or screenshots from the
same IndexedDB profile can substitute for Slice 6.
