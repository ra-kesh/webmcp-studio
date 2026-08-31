# LIBRARY-02 Gate 6E exact media actions preflight

**Date:** 2026-08-31
**Status:** E0a, E0b, E0c and E0d accepted; E1 active. Gate 6E is not complete.

## Accepted implementation checkpoints

### E0a — receipt vocabulary

Accepted on 2026-08-31 at commit `87357d7` after independent review found one
P1 duplicate hand-maintained action union. The repository now imports the sole
schema-derived `LibraryCompletedAction`, the P1 re-review returned zero open
P0/P1 findings, and `assign_field` round-trips through schema, client,
controller, HTTP, repository persistence, retry, and idempotent replay.

Acceptance evidence: 82 focused Studio tests, 10 document schema tests, 22
repository tests, document and Studio typechecks, and scoped diff checks passed.

### E0b — pure exact preparation

Accepted on 2026-08-31 at commit `bd0aaae` after independent review returned
zero P0/P1 findings. One UI-free, mutation-free preparation boundary now
admits exact curated, managed, and device-local selections through their own
authoritative ports, checks source/ID/version/metadata/provenance/content,
preserves canonical persisted sources, fences asynchronous work with an abort
signal, and returns immutable prepared evidence without issuing a document
command or usage receipt.

Acceptance evidence: 19 focused preparation tests, Studio typecheck, scoped
ESLint, formatting, and diff checks passed.

### E0c — editor executor and replacement final admission

Accepted on 2026-08-31 at commit `0509ece` after independent review found five
P1 defects in transition cancellation, local-preview warning handling, receipt
settlement ownership, null local-use results and semantic no-op suppression.
All five were remediated and the final re-review returned zero remaining P0/P1
findings.

The executor owns exact preparation inside one action mutex, commits insert,
replace or field assignment through one canonical command, performs the final
mutable-source check after renderer admission, and emits usage signals only
after commit. Document/session transitions abort old work. Post-commit failures
surface as retryable warnings without repeating or rolling back the edit.

Acceptance evidence: 44/44 focused action, mounted-hook and replacement tests,
Studio typecheck, scoped lint/diff checks and independent code re-review passed.

### E0d — target, runtime and shell wiring

Accepted on 2026-08-31 at commit `a0266eb`. The browser emits immutable strict
detail, exact server lookup is source-aware, production mounts the isolated
media provider, and `useDocumentEditor` owns the production preparation
adapter. A shell-owned picker session captures the target and external focus
owner, cancels stale asynchronous work, routes exact selection to the one
executor, and preserves post-commit warning retries outside dialog lifetime.
The legacy selection union remains isolated for E1 instead of being fabricated
into current catalog identities.

The first independent review found a focus-restoration P1 during an in-dialog
transition to recovery plus a test-only typecheck gate. The focus owner now
survives openerless internal transitions while explicit external openers always
replace it; focus epochs reject stale scheduled restoration. Typed mutable test
captures replaced the invalid closure narrowing. The final re-review returned
zero remaining P0/P1.

Acceptance evidence: 78/78 integrated affected tests, Studio typecheck, scoped
lint/diff checks and two independent code reviews passed.

### E1 — active entry conditions

The E0d pre-implementation reread of this audit plus OpenPencil and Loora found
five wiring seams: retained strict detail, source-aware exact lookup, production
media-provider ownership, separation from legacy picker records and shell-owned
warning lifetime. Commit `a0266eb` closed those seams before ordinary dialog
cutover.

The E1 line-by-line cutover reconnaissance also recorded six preservation
requirements before dialog replacement: mount/export the production media
provider; route every ordinary source through the one executor; keep upload
**Use** disabled until an exact managed catalog version is discoverable; keep
recovery managed-only and independent from browser search; retain archive and
promotion in a dedicated management surface; and route every opener through
one focus-capturing function. The shared browser must become the sole owner of
ordinary search/results/scrolling, while upload queue, recovery, archive,
promotion, quota/status and close guards remain separate management workflows.
`TypedFieldValueControl` may open `assign_field` only in source mode; API ID and
field-default editing retain their existing separate contracts.

## Scope

Gate 6E cuts editor media actions over to the shared Gate 6 browser and makes the selected library identity authoritative from click through commit. It covers three editor targets:

- insert an image node;
- replace the source of an existing unbound image node; and
- assign an image value to a document field.

It covers the curated, managed, and device-local media sources. The intended result is one source-aware preparation boundary followed by exactly one canonical document command, with usage signals emitted only after that command commits. It does not redesign the media browser, implement Gate 6D, change the document renderer, or migrate historical documents.

## Sources reread

The preflight was prepared from the current repository, not from a remembered plan.

### Committed product contracts and audits

- `docs/audits/2026-08-27-editor-production-readiness/library-02-gate6-media-integration-map.md`
- `docs/audits/2026-08-27-editor-production-readiness/library-02-gate6d-shared-media-browser-preflight.md`
- `docs/audits/2026-08-27-editor-production-readiness/media-01-implementation-audit.md`
- `docs/audits/2026-08-27-editor-production-readiness/media-01-ux-audit.md`
- `docs/audits/2026-08-27-editor-production-readiness/asset-02-domain-render-contract.md`
- `docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md`
- `docs/audits/2026-08-27-editor-production-readiness/asset-02-image-replacement-readiness.md`

### Current Studio and document code

- `apps/studio/src/features/editor/asset-library-dialog.tsx`, especially `AssetLibrarySelection` and the dialog-owned recent-selection state.
- `apps/studio/src/features/studio-shell.tsx`, especially the current media-picker completion branch around the insert/replace callbacks.
- `apps/studio/src/features/editor/use-document-editor.ts`, especially `insertAsset`, `replaceSelectedImageWithAsset`, `insertManagedMedia`, `replaceSelectedImageWithManagedMedia`, `insertLocalAsset`, `replaceSelectedImageWithLocalAsset`, the image-replacement coordinator wiring, and `updateField`.
- `apps/studio/src/features/editor/image-replacement-coordinator.ts`.
- `apps/studio/src/features/editor/media-selection-model.ts`.
- `apps/studio/src/features/editor/typed-field-value-control.tsx` and `apps/studio/src/features/editor/inspector-sidebar.tsx`.
- `apps/studio/src/features/editor/managed-media-repository.ts` and `apps/studio/src/features/editor/managed-image-resource.ts`.
- `apps/studio/src/content/library/library-media-discovery.ts`, `library-media-discovery-provider.tsx`, `device-local-media-discovery-adapter.ts`, `library-discovery-adapter.ts`, and `discovery-controller.ts`.
- `apps/studio/src/content/library/library-preference-provider.tsx` and `library-preference-controller.ts`.
- `apps/studio/src/content/library/media/curated-media-content.ts` and `apps/studio/src/features/editor/asset-catalog.ts`.
- `packages/document/src/library-catalog.ts`, `library-catalog-projections.ts`, `library-preferences.ts`, `media.ts`, `fields.ts`, and `commands.ts`.
- `apps/studio/src/server/library-http.ts`, `library-preference-repository.ts`, `curated-media-http.ts`, and `media-asset-repository.ts`, plus the exact item/content routes under `apps/studio/src/routes/v1/studio/library/`.

### Reference implementations

- OpenPencil `outputs/reference-repos/editors/open-pencil/src/components/assets-panel/AssetsPanel.vue`, particularly its resolve/materialize-then-insert flow around lines 253–291.
- Loora `outputs/reference-repos/editors/loora/packages/editor/src/components/assets-panel.tsx` and `editor.tsx`, particularly the asset preparation/probe followed by one engine transaction around `editor.tsx:1754–1780` and the transaction provider enqueue path around `editor.tsx:297–301`.
- Loora's command/transaction paths were checked for the separation between preparation and canonical mutation.

These repositories are references for boundaries and interaction patterns only. No OpenPencil or Loora code is to be copied or imported.

## Current truth and gaps

The current media dialog and the editor command surface still describe two generations of the product at once.

1. `AssetLibrarySelection` in `apps/studio/src/features/editor/asset-library-dialog.tsx` is a legacy union of `StudioAsset | LocalAssetSummary | ManagedMediaAsset`. It does not carry the strict `LibraryMediaDetail` identity already established by Gate 6 discovery.
2. `apps/studio/src/features/studio-shell.tsx` branches a completed picker action into six separate hook methods. The source therefore controls both preparation and mutation instead of feeding one editor action boundary.
3. `apps/studio/src/features/editor/use-document-editor.ts` separately implements curated, managed, and local insert/replace paths. Their admission guarantees are not equivalent.
4. Curated insert/replace still starts from the six-item `StudioAsset` facade, writes `assetId: library-${id}`, and embeds a data URI. This loses the Gate 6A catalog identity and immutable canonical `/library/media/...` source.
5. Managed insert/replace calls `getManagedMedia`, verifies the browser image resource, commits, and then calls the managed `/used` endpoint. It does not first re-fetch and prove the exact selected catalog version, and it does not record the shared Gate 5 completion receipt.
6. Local insert/replace fetches by asset ID. It does not require the selected summary revision to still match, even though `device-local-media-discovery-adapter.ts` already exposes the exact `localCommands.recheckSelection` behavior.
7. Asset fields do not use the shared browser. `TypedFieldValueControl` still offers only the six legacy curated assets and `updateField` forwards a raw `set_field` value. `studioAssetIdForValue` in `asset-catalog.ts` does recognize canonical values from the full curated manifest; the remaining compatibility gap is managed/local current-value recognition and chooser breadth, not every curated item beyond the legacy six.
8. The dialog records a legacy curated Recent list in local storage. This conflicts with Gate 5 preference receipts and cannot represent exact item versions.
9. None of the existing paths give all three actions one completion identity and one consistent post-commit usage sequence.

## Required command and data-flow boundary

Introduce a focused, UI-free media-action preparation boundary beside the editor code. Its input is a strict `LibraryMediaDetail` and an action target:

```ts
type LibraryMediaActionTarget =
  | { type: "insert"; pageId: string }
  | { type: "replace"; pageId: string; nodeId: string }
  | { type: "assign_field"; fieldId: string }
```

The selected detail is the requested identity, not trusted mutable content. Preparation must re-fetch or recheck that identity through a dedicated exact port and return one admitted canonical image value plus source-specific post-commit callbacks. It must not mutate the document.

The action executor then follows one order:

1. create a per-attempt `AbortController` and correlation/completion identity;
2. prepare the exact selected media identity;
3. capture and revalidate the document anchor (`documentId`, page, node, field, and selection as applicable);
4. for replacement, run renderer acknowledgement and final source admission as specified below;
5. issue exactly one canonical document command;
6. if and only if that command commits, emit source-appropriate usage signals;
7. report a non-rollback warning if a usage signal fails.

The executor must have one action mutex across all sources. A user cannot start a local replacement while a managed insertion is still being prepared. Closing the dialog, changing the target, selecting another item, switching documents, or unmounting aborts the active preparation.

## Exact source-specific preparation and recheck

### Curated

The action receives the selected curated `LibraryMediaDetail`, then performs an exact catalog detail fetch for its media ID and catalog version. It resolves immutable content through `resolveCuratedMediaContent` in `apps/studio/src/content/library/media/curated-media-content.ts`.

Before admission, it cross-checks the selected and resolved identity and metadata: source, item kind, ID, catalog version, MIME type, byte size, width, height, provenance, and content hash where supplied. The document value must preserve:

- `assetId` equal to the catalog media ID;
- `src` equal to `content.canonicalSource`, the immutable `/library/media/...` route;
- resolved dimensions and MIME/provenance needed by the editor and renderer.

It must never write the mutable discovery preview URL, `content.src`, the old `library-${id}` alias, or a data URI for a new curated action.

### Managed

The action first performs an exact catalog detail fetch at the selected catalog version. It then calls `getManagedMedia(id)` and requires the current record to be ready, workspace-owned, and not archived or quarantined. Because `PublicMediaAsset` does not carry the Gate 6 catalog version, the repository read cannot replace the exact catalog-detail check.

The implementation cross-checks ID, MIME type, byte size, width, and height between the selected detail, exact discovery detail, and managed record. It then calls `verifyManagedBrowserImageResource` before admission. The persisted document value is the managed ID plus the canonical `asset:managed/<id>` source.

For replacement, the managed row is checked again at final admission after renderer acknowledgement. If the item changed, became unavailable, or stopped satisfying policy, the document remains untouched.

### Device-local

The action calls the Gate 6C exact port with the selected revision:

```ts
localCommands.recheckSelection({
  source: "local",
  assetId: detail.id,
  revision: detail.version,
})
```

The returned exact record/blob is the only admitted content. A newer record with the same ID is not silently accepted. The persisted value is the local asset ID plus `asset:local/<id>`.

For replacement, the local revision is checked again at final admission after renderer acknowledgement. Local media never writes a Gate 5 receipt, because its recency is device-scoped and already owned by the local store.

## Renderer-acknowledged replacement

ASSET-02 requires replacement to remain tentative until both renderer surfaces have acknowledged the candidate. The current `image-replacement-coordinator.ts` is wired from `use-document-editor.ts`, but the current validation hook only checks the document anchor synchronously.

Gate 6E must extend the candidate contract with an asynchronous final-admission step, for example `finalizeAdmission(signal)` or `beforeCommit(signal)`:

1. keep the current canonical source in the document;
2. prepare the candidate and show the tentative preview;
3. wait for both Fabric and React renderer acknowledgements;
4. keep the operation busy while the mutable managed/local source is rechecked;
5. revalidate the document/page/node anchor;
6. commit one `replace_image_source` command only if every check still passes.

A failure or abort at any point removes the tentative candidate and preserves the original canonical value. The exact-media path must not bypass the existing replacement coordinator.

Direct image replacement remains invalid for a field-bound image. `replace_image_source` rejects that case in `packages/document/src/commands.ts` around lines 1886–1904. The UI must direct the user to an `assign_field` action instead of weakening this guard.

## Exactly one canonical mutation

Preparation and renderer probing must not create history entries. A successful action emits one command only:

| Target       | Canonical command      | Required result                                                                                                                            |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Insert       | `add_node`             | One image node using the admitted canonical asset value.                                                                                   |
| Replace      | `replace_image_source` | Existing node geometry, crop, effects, opacity, bindings, order, and identity remain intact except for the admitted image source metadata. |
| Assign field | `set_field`            | The field value changes once; `applyFieldValues` projects the value to every bound image layer.                                            |

`set_field` is already the correct domain boundary. In `packages/document/src/commands.ts` around lines 860–889 it updates the field, while `applyFieldValues` around lines 170–186 derives the bound image source and asset ID. Gate 6E should not loop over bound nodes or issue extra replacement commands.

Undo and redo must therefore treat each completed media action as one atomic history step.

## Post-commit Recent and mark-used sequencing

Generate one completion ID for one document action attempt and retain it across retries of post-commit side effects. Nothing is marked used before the document command reports a real commit.

After a successful commit:

- curated: call the Gate 5 `recordUsed` command with exact `{ itemKind: "media", itemId, itemVersion }`, display name, action, and completion ID;
- managed: call the same Gate 5 `recordUsed` command, then independently call `markManagedMediaUsed(id, { idempotencyKey })`;
- local: call `markLocalAssetUsed(id)` only and refresh the local discovery overlay.

The two managed calls have different owners and must not be conflated. Gate 5 records durable workspace preference/recent state keyed by the discovery identity. Managed `markUsed` updates the media repository's own operational last-used state. A managed repository revision is not a substitute for the Gate 6 catalog version.

Usage failures occur after the canonical edit and must never roll it back. They should produce a visible, retryable warning while retaining the same completion/idempotency identity. A failed document command emits no Gate 5 receipt and no source-specific mark-used call.

### Blocking `assign_field` receipt schema gap

`packages/document/src/library-preferences.ts` currently restricts completed actions to `create | insert | replace` around lines 258–263 and 328–334. Gate 6E requires `assign_field` in that v1 union and in the matching provider, client/controller, and server request types.

This is a compatible schema extension, not a database migration: completed-action receipts are stored as JSON/string data without an enum constraint, and existing receipts remain valid. It must land before the field action attempts to record Gate 5 usage.

## Compatibility and migration risks

1. **Historical document values:** do not auto-rewrite old `library-*` asset IDs or inline curated data URIs. They must continue rendering. Only new actions use canonical Gate 6 identity/source values.
2. **Current field display:** keep source-aware current-value display while moving the chooser to the shared browser. Managed and local canonical values must not appear as unknown merely because the legacy facade cannot map them.
3. **API Playground boundary:** `assetValueMode="id"` is a separate contract. The editor stores canonical renderable sources; API clients may continue to exchange IDs. Do not solve the editor cutover by changing the public API value mode.
4. **Review and inspector labels:** `review-operation-details.ts` and inspector labeling still contain `library-` assumptions. They must recognize canonical curated, managed, and local references before the old facade is removed.
5. **Managed identity:** catalog version and managed repository revision are different. Gate 5 receipts use the selected discovery version. Managed resource checks use the current managed row.
6. **Local revision after use:** `markLocalAssetUsed` can advance a local record revision. Refresh the discovery overlay after success so the next selection carries the new exact revision.
7. **Upload race:** an uploaded `PublicMediaAsset` does not provide a Gate 6 catalog version. Refresh discovery and enable **Use** only after the exact managed summary/detail exists. Never invent a catalog version from a repository revision.
8. **Mutable UI state:** exact preparation uses its own request/abort lifetime. It must not trust the discovery controller's currently selected detail, which may change while an action is in flight.
9. **Dialog cutover:** preserve the working upload queue, recovery, archive-impact confirmation, promotion, close guards, and focus behavior. Remove old discovery state only after the shared browser owns the normal selection path.
10. **Asset facade removal:** `asset-catalog.ts` can be retired only after the editor chooser, field chooser, labels, tests, and compatibility reads no longer depend on it.

## Smallest non-overlapping implementation order

### E0 — exact action seam before visual cutover

**E0a — receipt vocabulary**

- Add `assign_field` to the completed-action schema and matching client/provider/server types.
- Add schema and round-trip tests.
- Do not change React components in this slice.

**E0b — pure exact preparation**

- Add source-discriminated exact preparation types and ports.
- Implement curated exact detail/content admission, managed exact detail/repository/resource admission, and local revision recheck.
- Add correlation, abort, mismatch, and no-mutation tests.
- Do not change the dialog in this slice.

**E0c — editor executor and replacement final admission**

- Add one `performLibraryMediaAction` hook boundary for insert, replace, and assign-field.
- Extend the replacement coordinator with asynchronous final admission for mutable sources.
- Route the successful path to one canonical command, then usage signals.
- Keep the six legacy methods until every caller has switched; remove them only at the end of this slice.

**E0d — target and shell wiring**

- Extend `MediaPickerState` with the `assign_field` target and strict selected detail.
- Route Studio shell intents to the one executor.
- Inject `libraryPreferenceCommands` instead of writing dialog-local Recent state.

### E1 — editor dialog cutover after Gate 6D is accepted

**E1a — shared browser mounting**

- Mount the accepted Gate 6D browser in `AssetLibraryDialog` for ordinary browsing and selection.
- Preserve upload queue, upload retry/cancel, managed recovery, archive-impact confirmation, promotion, close guards, and focus restoration as separate management regions/actions.

**E1b — legacy discovery removal**

- Remove the dialog's duplicate list/search/loading state, local-storage curated Recent, and legacy asset cards after the shared browser owns those paths.
- Keep management callbacks and status surfaces.
- Remove the legacy asset facade only after the final consumer audit.

**E1c — field chooser and compatibility labels**

- Add a source-mode **Choose image** path to `TypedFieldValueControl` using the same browser and `assign_field` target.
- Keep API ID mode separate.
- Update review/inspector descriptions for canonical curated, managed, and local references.

This sequence does not overlap Gate 6D implementation: E0 establishes data and mutation correctness independently; E1 consumes Gate 6D only after its browser contract and acceptance tests are complete.

## Focused automated tests

### Pure preparation

- exact curated, managed, and local success;
- selected/detail ID or version mismatch;
- curated canonical-source, hash, dimension, MIME, byte-size, and provenance mismatch;
- managed archive, quarantine, not-ready, ownership, repository-change, resource-probe, path, MIME, byte-size, and dimension failure;
- local missing record and revision mismatch;
- source/ID collisions across curated, managed, and local namespaces;
- abort at fetch, resolve/probe, final admission, and pre-command stages;
- every failed preparation proves zero document mutation and zero usage signal.

### Hook, history, and replacement

- insert, replace, and assign-field for all three sources each produce exactly one command and one Undo step;
- redo restores the admitted canonical value;
- replacement preserves geometry, crop, effects, opacity, order, and unrelated properties;
- direct replacement of a bound image is rejected and performs no command;
- one `set_field` updates all bound image layers without per-node commands;
- a managed/local final-source failure after both renderers become ready performs no commit;
- stale document/page/node/field anchors perform no commit;
- double click, target change, dialog close, and document switch cannot produce two commits.

### Receipts and source-specific usage

- failed or no-op command produces no receipt and no mark-used call;
- curated and managed successful actions record Gate 5 once with the exact catalog version;
- `assign_field` round-trips through the v1 completed-action schema;
- retry uses the same completion ID and does not duplicate Recent;
- managed repository mark-used is independent and idempotent;
- local calls only the local mark-used path;
- a post-commit receipt or mark-used failure does not roll back the document edit.

### Dialog and compatibility

- upload queue waits for a discoverable exact managed identity before enabling **Use**;
- local revision refreshes after mark-used;
- legacy inline/data-URI and `library-*` document values continue to render and remain editable;
- current-value labels recognize canonical curated, managed, and local references;
- recovery is managed-only and upload/retry/cancel/archive/promotion behavior survives the browser cutover;
- retain the 18 MEDIA journey regressions from the Gate 6 integration map.

## Browser acceptance

Run these after E1 lands, on the Studio server without disturbing unrelated local applications:

1. Insert one curated, one managed, and one local image; confirm the canvas and React preview agree, then Undo/Redo each action.
2. Replace an unbound image from every source; confirm renderer acknowledgement, property preservation, and one-step Undo/Redo.
3. Assign every source to an image field; confirm every bound layer updates together and one Undo restores the previous field value.
4. Attempt direct replacement of a bound image; confirm the UI explains the field route and the document does not change.
5. Make a selected managed item stale/archived and a selected local item revision-stale before commit; confirm no document mutation and no Recent entry.
6. Reload and confirm curated/managed Recent, favorites, and collections are durable, while local recency remains device-local.
7. Upload a managed image; confirm **Use** remains disabled until discovery returns an exact catalog identity, then insert it successfully.
8. Exercise keyboard-only browse/select/use/cancel, dialog focus return, 320px width, and 200% zoom.
9. Load approximately 1,000 local items and confirm bounded rendering and responsive selection/action cancellation.
10. Re-run managed recovery, archive-impact confirmation, promotion, publish, and render flows to prove the dialog cutover did not remove management or output behavior.

## Gate 6E exit condition

Gate 6E can be marked complete only when all three sources can perform all three targets through the same exact preparation and one-command boundary; renderer-acknowledged replacement performs a final mutable-source check; Recent/mark-used signals happen only after a committed action; the shared browser has replaced the legacy ordinary selection path without losing management flows; and the focused automated and browser acceptance checks above pass.
