# Async editor architecture — independent reliability review

- Date: 2026-09-01
- Reviewed commit: `d882c77364e11d8ac9f9f81c54eb0a01c5f92baf` (`fix(editor): preserve canvas across image sync`)
- Method: direct code and history review, durable-audit reconciliation, local reference-repository comparison, focused tests, package-wide tests, and all-workspace typecheck. No server, browser session, deployment, or production mutation was used.

## Decision

Do not release the reviewed commit as production-ready.

The review found one P0, two P1s, and two P2s:

| Priority | Status                                                       | Finding                                                                                                                                                                |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Closed by the 2026-09-01 Gate 4 repair                       | The multi-artboard merge removed the only production React image-readiness owner, so every mounted Studio replacement flow waits 15 seconds and rejects the candidate. |
| P1       | Closed by the 2026-09-01 Gate 5 repair                       | The last-good Fabric frame remains mutable during document synchronization while Fabric suppresses the events that would commit that mutation.                         |
| P1       | Closed by the 2026-09-01 Gate 5 repair                       | A failed incremental Fabric synchronization leaves the old frame in `ready` indefinitely, with no visible error, retry, or complete applied identity.                  |
| P2       | Confirmed behavior                                           | Export and publish remain enabled while a replacement preview is non-canonical, so the visible candidate and exported/published source can disagree.                   |
| P2       | Confirmed in React StrictMode; production exposure is a risk | Local-asset restore permanently deactivates its lifecycle ref during StrictMode effect replay and can discard the only pending restore.                                |

Here, P0 means a deterministic release-blocking failure of a primary product workflow, even when rollback prevents data loss. P1 means a credible canonical/render authority split or an unrecoverable editor state. P2 means bounded reliability, lifecycle, or truthfulness debt that should not block the P0/P1 repair.

## Scope and authority model

I reviewed the requested async and editor surfaces: images and assets, Fabric synchronization and cancellation, continuous multi-artboard ownership, selection/Inspector handoff, crop/replace/fit/fill, templates, persistence and recovery, renderer/export admission, and the React-versus-canonical-versus-Fabric boundary.

The intended authority graph is sound when its owners remain connected:

| State                          | Owner                                                                      | May do                                                         | Must not do                                                         |
| ------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Canonical document and history | `useDocumentEditor` plus typed document/editor transactions                | Persist authored semantics and feed export/publication         | Admit a tentative renderer preview merely because pixels appeared   |
| Replacement preview            | `pendingImageReplacement` projected by `useDocumentPreviewProjection`      | Show a candidate against an immutable anchor                   | Enter history, persistence, export, or publication before admission |
| Fabric canvas                  | Per-page `FabricCanvasAdapter` behind `FabricRenderInvalidationController` | Cache and manipulate a derived page view                       | Become a second canonical geometry store                            |
| React render view              | `@webmcp/render-view`                                                      | Independently prove the React consumer can install a candidate | Be assumed ready when no production owner is mounted                |
| Export/renderer                | Canonical snapshot plus independent server resource admission              | Materialize and verify exact render resources                  | Reuse an interactive-client acknowledgement as server authorization |

The highest-severity failures are topology failures between those owners. The local reducers, projectors, and repositories can all pass while a required producer has no production call site or a derived cache remains labeled `ready` after falling behind canonical state.

## Durable records reconciled

The review read the retained architecture, multi-artboard, polish, remediation, media, and image-phase records before judging the implementation. The most important cross-document contradiction is explicit:

- The replacement contract requires Fabric and the active React thumbnail to report exact readiness before commit (`asset-02-image-replacement-readiness.md:13-21`) and names `@webmcp/render-view` as an owner (`asset-02-image-replacement-readiness.md:23-29`).
- The multi-artboard integration record instructs the merge to remove filmstrip image-resource events (`multi-artboard-workspace-2026-09-01.md:29-36`).
- The earlier runtime-recovery contract made every incremental sync preparing and inert (`fail-01d-fabric-runtime-recovery.md:22-31`). The post-integration repair deliberately changed that to a last-good frame that stays interactive (`editor-architecture-render-ownership-2026-09-01.md:345-365`) without adding a separate mutation-admission state.

Those records are individually coherent but were not reconciled at the integration seam.

## Findings

### P0 — Restore an actual React readiness owner before accepting image replacement

Status: closed by the 2026-09-01 Gate 4 repair described below. The evidence in
this finding remains the reproduction record for the reviewed commit.

#### Trigger

In the mounted Studio UI, select Replace from the shared media picker and choose a curated image, managed upload, device-library item, or collection item. Applying a background-removal result reaches the same path.

#### Evidence

1. A replacement session always starts with both renderers waiting (`apps/studio/src/features/editor/image-replacement-readiness.ts:25-37`) and becomes ready only when both Fabric and React are ready (`apps/studio/src/features/editor/image-replacement-readiness.ts:63-72`).
2. The coordinator starts a deadline and keeps the original after 15 seconds (`apps/studio/src/features/editor/image-replacement-coordinator.ts:44-69`). A single renderer report remains pending (`apps/studio/src/features/editor/image-replacement-coordinator.ts:72-101`). The deadline behavior is itself covered by `image-replacement-coordinator.test.ts:230-263`.
3. Every shared-library replacement starts that coordinator (`apps/studio/src/features/editor/use-document-editor.ts:5471-5538`, `apps/studio/src/features/editor/use-document-editor.ts:5549-5593`). Background removal invokes the same performer (`apps/studio/src/features/studio-shell.tsx:3418-3437`).
4. The production shell reports only `renderer: "fabric"` (`apps/studio/src/features/studio-shell.tsx:2368-2398`) and mounts only page-scoped `FabricArtboard` instances in the continuous workspace (`apps/studio/src/features/studio-shell.tsx:5351-5417`). At the reviewed commit, a production-only grep for `renderer: "react"` returns no match.
5. `ProductPageFilmstrip` still knows how to forward `onImageResourceStateChange` (`apps/studio/src/features/editor/page-filmstrip.tsx:1198-1206`), but it has no production caller at the reviewed commit.
6. The regression boundary is exact. Before merge `c3f99345a252c5aefdfef6d22470fcc352f336ed`, `StudioShell` had `handleReactImageResourceStateChange` reporting `renderer: "react"` (`c3f9934^:apps/studio/src/features/studio-shell.tsx:2276-2283`) and passed it to the mounted `ProductPageFilmstrip` (`c3f9934^:apps/studio/src/features/studio-shell.tsx:5433-5451`). The multi-artboard merge removed both.
7. The strongest mounted hook test supplies both acknowledgements manually (`apps/studio/src/features/editor/use-document-editor.library-media-action.mounted.test.tsx:677-730`). It therefore proves the coordinator after a caller supplies React, not that `StudioShell` owns a React producer. `studio-shell-library-media-session.mounted.test.tsx:31-56` mounts the picker hook with a mocked performer and never mounts either renderer.
8. `replaceImageFile` exists (`apps/studio/src/features/editor/use-document-editor.ts:5730-5815`) but has no production call site, so it is not an alternate mounted replacement path.

#### Impact

The candidate can appear in Fabric, but the canonical document, snapshot, and history never accept it. The picker stays busy until the 15-second deadline, then reports failure and restores the original. Background-removal output also fails at its final application step. This is a universal outage for the mounted replacement surfaces, not a rare decode failure.

Rollback prevents corruption, but a primary image-editing workflow is deterministically unusable. That is P0.

#### Smallest safe repair

Preserve the two-renderer invariant and restore a production `@webmcp/render-view` admission owner for the exact pending `{token, documentId, pageId, nodeId, src, naturalSize}`. It may be a pending-only admission surface rather than the removed filmstrip, but it must execute the real React image-resource path and must register/unregister explicitly. Do not synthesize a React acknowledgement in the hook.

Make the coordinator snapshot a registered required-owner set instead of hard-coding topology it cannot observe. Startup should fail loudly if the product contract requires React and no React owner is registered. A broader alternative is to redefine replacement admission to the currently mounted renderer set and move React proof wholly into publish/export admission, but that changes the retained product invariant and is not the smallest repair.

#### Required regression test

Mount the real `StudioShell` replacement composition with `MultiArtboardWorkspace`, a deferred Fabric adapter, and the actual React admission owner. Drive a replacement from the picker without calling `reportImageReplacementRendererState` from the test. Prove:

- Fabric alone remains pending;
- the matching React load commits once before the deadline;
- React failure and missing React ownership keep the old canonical source and history;
- stale page, token, source, dimensions, or document identity cannot settle the current operation;
- background removal uses the same working path.

#### Gate 4 remediation evidence

The bounded Gate 4 repair restores the retained two-renderer contract without
reviving the removed filmstrip or synthesizing readiness in the editor hook:

- `StudioShell` now mounts a pending-only React readiness owner backed by the
  production `@webmcp/render-view` `Artboard`. It registers for the lifetime of
  the shell, reports the real image-resource result for the exact pending
  document and page, and unmounts the admission surface after settlement.
- Each mounted production `FabricArtboard` registers and unregisters Fabric
  ownership. The coordinator snapshots the required renderer set when an
  operation starts, refuses to expose a preview if a required owner is absent,
  and rolls back if the last required owner disappears before settlement.
- Readiness identity now includes exact document, page, token, node, source,
  and natural dimensions. The pending page is pinned in the multi-artboard
  interaction set so virtualization cannot remove the candidate owner mid-run.
- The canonical document, snapshot, operation version, and history remain
  unchanged until both real owners acknowledge the candidate. React failure,
  owner loss, and the unchanged 15-second production deadline clear the preview
  and retain the original source.
- `ImageReplacementWorkspace` is the production composition used by both
  `StudioShell` and the mounted regression. It owns the real
  `MultiArtboardWorkspace`, `FabricArtboard` readiness injection, React
  readiness owner, visibility calculation, and pending-page pin. Fabric
  readiness alone remains pending; the success regression moves focus to
  another page mid-admission, proves the offscreen target stays mounted and
  interaction-owned, returns focus, and then uses an actual React image `load`
  to commit one named history entry. React `error`, missing ownership, and a
  deterministic test-only timeout all prove rollback without canonical or
  history mutation. The existing background result regression still uses the
  same shared replacement performer and named history path.
- Verification ran with Node `v22.23.2`: Studio typecheck passed and seven
  focused replacement, Fabric lifecycle, binding, and multi-artboard files
  passed 58/58 tests. A real browser journey reused the single port-3001 Vite
  server, replaced `Sandstone arches` with `Olive botanical`, observed the
  picker close, Undo enable, and saved state settle with no console errors, then
  undid the test change to restore the document.
- Independent review first held the hand-wired test topology as P1 because it
  would not have caught a shell integration regression. After the production
  composition extraction and offscreen pending-page regression, re-review found
  no remaining P0 or P1. It also confirmed that lazy workspace/artboard loading,
  the outer workspace boundary, Gate 1 local boundaries, docked chrome, and the
  reverted canvas event policy remain intact.

This closes only the P0. The two P1 and two P2 findings below remain open and
were not changed by this repair. Gate 1's local Suspense ownership, docked
chrome, and reverted canvas event policy were not modified.

### P1 — Separate last-good pixel availability from Fabric mutation admission

Status: closed by the 2026-09-01 Gate 5 repair. The evidence below remains the reproduction record for the reviewed commit.

#### Trigger

Start a document synchronization that awaits a font or image decode, then drag, resize, or rotate an already-mounted object before the synchronization settles. A replacement or insertion of an image on the same page is a normal trigger.

#### Evidence

1. `FabricArtboard` considers a same-page last-good frame sufficient to avoid `preparing` (`apps/studio/src/features/editor/fabric-artboard.tsx:721-732`). Its runtime stays `ready`, so the canvas remains non-inert and pointer-enabled when `interactive` is true (`apps/studio/src/features/editor/fabric-artboard.tsx:868-887`). Studio passes `interactive` during ordinary async synchronization (`apps/studio/src/features/studio-shell.tsx:5412-5417`).
2. `settleCanvasInteractivity` only cancels text/transform work when the React `interactive` prop becomes false (`apps/studio/src/features/editor/fabric-artboard.tsx:1097-1105`). A document sync does not change that prop.
3. `FabricCanvasAdapter.sync` cancels a transform that was already active, increments its generation, and sets `syncing = true` (`packages/editor/src/fabric-adapter.ts:3046-3068`). It does not make objects non-selectable or non-evented.
4. A transform begun after that point gets no session baseline because `onBeforeTransform` returns while syncing (`packages/editor/src/fabric-adapter.ts:4582-4593`). Move handling also returns (`packages/editor/src/fabric-adapter.ts:4865-4868`), and final `object:modified` returns without emitting `onNodesChange` or restoring canonical geometry (`packages/editor/src/fabric-adapter.ts:4990-4993`). Fabric itself has already applied the object transform.
5. During incremental sync, an unaffected node is projected back only when its canonical object reference changed (`packages/editor/src/fabric-adapter.ts:3249-3255`). A visual-only drag of an unchanged node can therefore survive the current sync even though canonical geometry never moved.
6. Selection invalidation is not serialized behind document invalidation: `FabricRenderInvalidationController.invalidateSelection` calls `adapter.select` directly (`apps/studio/src/features/editor/fabric-render-invalidation-controller.ts:146-152`). `select` sets the shared boolean to true and then unconditionally false (`packages/editor/src/fabric-adapter.ts:3829-3859`), so a selection projection during document sync can prematurely clear the sync guard. Other adapter paths correctly restore the prior value (`packages/editor/src/fabric-adapter.ts:4010-4013`, `packages/editor/src/fabric-adapter.ts:4799-4821`).
7. The post-incident test proves only that the ready frame stays visible and selection is reapplied (`apps/studio/src/features/editor/fabric-artboard.lifecycle.mounted.test.tsx:384-460`). It never attempts a transform while the second sync is deferred and never compares Fabric geometry with canonical/history/export state.

#### Impact

The user can see a successful geometry edit that does not exist in the canonical document. Inspector values, undo history, persistence, WebMCP reads, and export retain the old geometry. A later redraw can snap the object back. The selection path can also reopen event processing before the document sync owns a stable applied state.

#### Smallest safe repair

Keep last-good pixels visible, but introduce a separate per-artboard `documentSyncInFlight`/`mutationAdmitted` state. At sync start, cancel any active transform and disable Fabric selection, controls, evented object mutations, crop gestures, and text editing until the exact sync identity succeeds. Workspace camera navigation may remain available.

Replace the shared boolean mutex with a nesting-safe depth or generation-scoped guard. `select` must preserve the existing document-sync guard, as the crop and baseline-restoration paths already do.

#### Required regression test

With the real adapter or a behaviorally complete fake, defer the second document sync and attempt move, scale, rotate, text entry, crop, and selection changes. Assert that no object geometry changes and no `onNodesChange` fires while pending. After exact success, assert one transform commits and canonical document, Inspector, history, persistence snapshot, and export request agree. Add a separate assertion that selection projection during the deferred sync cannot clear the document guard.

### P1 — Represent incremental sync failure as stale, not ready

Status: closed by the 2026-09-01 Gate 5 repair. The evidence below remains the reproduction record for the reviewed commit.

#### Trigger

Let the first page synchronization succeed, then reject or time out the next same-page font preparation or adapter synchronization.

#### Evidence

1. Last-good identity is stored as only `pageId` (`apps/studio/src/features/editor/fabric-artboard.tsx:231-240`) and tested only against the requested page (`apps/studio/src/features/editor/fabric-artboard.tsx:721-723`). It omits document ID, document revision, page-sync identity, and applied generation.
2. On incremental failure, the catch reports `error` to the optional callback but does not transition local runtime out of `ready` when a last-good frame exists (`apps/studio/src/features/editor/fabric-artboard.tsx:789-805`).
3. `CanvasRuntimeOverlay` receives only local runtime (`apps/studio/src/features/editor/fabric-artboard.tsx:937-943`), so it shows no failure or Retry in this state.
4. `StudioShell` does not pass `onRuntimeStateChange` to its artboards at the reviewed commit. The error report therefore has no product owner.
5. `MultiArtboardWorkspace` keys an artboard shell only by `page.id` (`apps/studio/src/features/editor/multi-artboard-workspace.tsx:147-165`). If a new document reuses a page ID, the same component can treat prior-document pixels as its last-good frame.
6. The lifecycle suite covers startup/no-last-good failure and pending-success preservation, not a rejected or timed-out second sync while a last-good frame exists.

#### Impact

Canonical state, React chrome/Inspector, persistence, and future export can advance while Fabric stays on old pixels and still advertises `ready`. There is no visible error, mutation lock, or retry path. If no later document identity changes, the stale frame can remain indefinitely. Reused page IDs can make the stale pixels belong to a different document.

#### Smallest safe repair

Add a runtime state such as `stale_error` containing both the last successfully applied identity and the exact requested identity. Keep last-good pixels visible, but disable document mutations and show a non-blocking error with Retry. Store last-good identity as at least `{documentId, pageId, documentSyncIdentity, attempt/generation}` and clear it when ownership changes.

The P1 repair should unify this with the mutation-admission state above: visible pixels may be usable for orientation while the derived editor is not authoritative enough to mutate.

#### Required regression test

Succeed the first sync, reject and separately time out the second, and assert that pixels remain visible but runtime is stale, Retry is visible, and mutations are disabled. Retry must use the current exact identity, not the failed closure. Only successful installation may return to `ready`. Repeat with a different document that reuses the page ID.

#### Gate 5 remediation evidence

The bounded Gate 5 repair closes both P1 findings without changing Gate 1's
lazy ownership, Gate 4's replacement owners and pending-page pin, or the
workspace camera boundary:

- `FabricArtboard` now distinguishes `preparing`, `syncing`, `ready`,
  `stale_error`, and hard `error`. Requested and applied state carry document,
  page, page-sync identity, document revision, and sync generation. A
  same-owner incremental failure retains visible last-applied pixels only as
  `stale_error`, makes the inner canvas inert, and exposes a bounded in-place
  Retry. A different document reusing the page ID clears applied ownership and
  shows the opaque hard-error surface.
- The adapter contract now requires atomic page installation. The regular
  Fabric path stages every new or replacement object and waits for all image
  decodes before page presentation, removals, object projection, ordering, or
  cache identity changes. The masked full-build path also settles its prepared
  resources before its existing synchronous install. An abort regression
  proves background, object identity/order, geometry, and `nodeByNodeId` remain
  exactly at the prior applied scene.
- Mutation admission is explicit and separate from pixel availability.
  Closing admission cancels transient transform/text/crop work, discards Fabric
  selection, disables hit testing and controls, and rejects adapter-originated
  move, scale, rotate, text, crop, preview, retry, selection, and export paths.
  Event suppression is nesting-safe, so selection projection cannot reopen a
  document sync. Reopening admission reprojects the canonical selection.
- `StudioShell` owns an exact per-page runtime registry and consumes it in
  Inspector capabilities, keyboard/editor command contexts, product commands,
  layer/page/output callbacks, guides, media insertion, and direct Inspector
  mutation callbacks. Each mounted artboard has an owner identity, publishes a
  denying state before paint, and releases only its own registry entry on cull
  or remount. Missing, preparing, syncing, stale, hard-error, or mismatched
  identity denies canonical/history mutation for the affected mounted page;
  absent lazy pages do not permanently disable document-wide actions. Camera
  pan, zoom, focus, and page activation remain available.
- Quotation layer/template surfaces use the same runtime admission. Media
  insertion/replacement, background-removal application, and template apply
  capture exact admission at invocation and recheck it immediately before the
  canonical commit. Deferred preparation or confirmation that settles after a
  canvas becomes stale is rejected without changing document, snapshot,
  operation version, or history.
- Regressions cover real-adapter geometry admission, nested event suppression,
  incremental rejection and timeout, retry without remount, current-identity
  retry, cross-document same-page reuse, page-local multi-artboard isolation,
  canonical snapshot/operation-version/history denial, owner-safe cull/remount
  closure, two-mounted-page lazy admission, initial ready Assets availability,
  and deferred media/template settlement after admission closes.
- Node `v22.23.2` verification passes the Fabric adapter suite (107/107) and an
  eight-file focused Studio matrix (167/167), both package typechecks, scoped
  Studio lint, and `git diff --check`. No server,
  browser session, deployment, port-3000 process, or capture directory was
  used.
- Final independent read-only re-review reports no remaining P0 or P1. It
  retains the two assigned P2s below and records two additional non-blocking
  Fabric hardening items: synchronous post-barrier install lacks injected-fault
  rollback coverage, and regular successful object retirement lacks explicit
  disposal/leak coverage. A same-tick shell predicate regression would also
  strengthen the already-synchronous registry-ref boundary.

Gate 5 closes the audit's two P1 findings. The two P2 findings below remain
open and were not expanded into this gate.

### P2 — Gate export and publish while a replacement preview is pending

Status: confirmed behavior; canonical export authority itself is correct.

#### Trigger

While the picker is waiting for renderer acknowledgements or final admission, invoke PNG/PDF export or publish.

#### Evidence

1. Pending replacement changes only the preview document (`apps/studio/src/features/editor/use-document-preview-projection.ts:34-59`). Canonical document/history remain old by design.
2. PNG and PDF export flush and then read the canonical snapshot (`apps/studio/src/features/studio-shell.tsx:3232-3260`, `apps/studio/src/features/studio-shell.tsx:3263-3298`). That is the correct source of authority.
3. The replacement performer holds `isImportingAsset` true for the operation (`apps/studio/src/features/editor/use-document-editor.ts:5488-5516`), but `outputBusy` omits both that state and `pendingImageReplacement` (`apps/studio/src/features/studio-shell.tsx:3588-3603`). PNG/PDF command enablement therefore remains true (`apps/studio/src/features/studio-shell.tsx:3724-3748`).
4. The visible Publish button also omits asset admission state (`apps/studio/src/features/studio-shell.tsx:4736-4747`). No test mentions export/publish together with `pendingImageReplacement` or `isImportingAsset`.

#### Impact

The canvas can visibly show the candidate while export or publication correctly consumes the old canonical source. With the P0 regression, that disagreement lasts for the full 15-second timeout. The output is internally canonical but contradicts what the user sees at command time.

#### Smallest safe repair

Include active asset mutation/replacement admission in the critical command gate. Disable export and publish with a precise reason until the candidate commits or is cancelled. If product policy prefers exporting the old source, require an explicit cancellation/restore before admitting the command so the visible canvas and canonical snapshot agree.

#### Required regression test

Project a pending candidate and assert PNG, PDF, publish, and conflicting asset actions are disabled. After commit, assert export receives the new canonical identity; after cancel/failure, assert it receives the old identity. The preview candidate must never appear in the request body before canonical commit.

### P2 — Repair local-asset restore lifecycle for StrictMode replay

Status: confirmed under React StrictMode semantics; current production exposure is a risk because the application entry does not explicitly mount `StrictMode`.

#### Trigger

Mount `useDocumentEditor` under React StrictMode with a canonical `asset:local` source whose `loadLocalAsset` promise settles after the initial effect setup/cleanup replay.

#### Evidence

1. The lifecycle ref is initialized true during render (`apps/studio/src/features/editor/use-document-editor.ts:1190-1194`).
2. Async restore installs a URL or reports an error only while that ref is true (`apps/studio/src/features/editor/use-document-editor.ts:3778-3817`). The in-flight promise is retained in `assetLoadPromisesRef` (`apps/studio/src/features/editor/use-document-editor.ts:3813-3819`).
3. The cleanup-only effect sets the ref false and never sets it true in setup (`apps/studio/src/features/editor/use-document-editor.ts:3822-3829`). By contrast, the nearby mounted lifecycle explicitly resets its ref true on setup (`apps/studio/src/features/editor/use-document-editor.ts:3250-3254`).
4. During StrictMode replay, cleanup leaves the first load in the promise map. The second setup sees that promise and does not start another load; the original completion sees `false` and discards the blob. Its finalizer removes the promise, but no dependency changes to retry the effect.
5. The existing StrictMode hook suite covers persistence-controller leasing (`use-document-editor.strict-mode.persistence.mounted.test.tsx:56-86`, `use-document-editor.strict-mode.persistence.mounted.test.tsx:176-242`), not delayed local-asset restoration.

#### Impact

Development StrictMode, a StrictMode host, or future lifecycle reuse can leave a saved local image permanently unresolved for that mount without a retry or error. Production currently does not explicitly wrap the app in StrictMode, so this is P2 rather than a present universal outage.

#### Smallest safe repair

Set lifecycle activity in effect setup and use a generation/lease or `AbortController` owned by that setup. Cleanup must invalidate only its generation and revoke only URLs installed by that generation. Do not use one monotonic boolean for a replayable effect lifecycle.

#### Required regression test

Mount the real hook under StrictMode with a deferred `loadLocalAsset`. Resolve after setup/cleanup replay and assert one live object URL is projected, the installed URL was not revoked, and no duplicate load or state update occurs after final unmount. Cover missing and rejected loads as well.

## Existing-test blind spots

| Boundary                | Existing evidence                                                     | Missing assertion                                                                                |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Replacement coordinator | Exact stale, dimension, failure, timeout, and two-ack reducer tests   | A production shell supplies every required owner without direct test injection                   |
| Library media hook      | Manually reports Fabric and React, then proves one history entry      | Actual React/Fabric wiring and timeout-free mounted picker completion                            |
| Multi-artboard shell    | Page layout, culling, page-local sync identities, and handle registry | Renderer-owner preservation when the filmstrip is removed                                        |
| Last-good Fabric frame  | Frame stays `ready`; latest selection is reapplied after success      | Transform/selection/crop/text attempts during deferred sync; incremental failure after last good |
| StrictMode persistence  | Repository/controller lease survives replay                           | Local `asset:local` restoration survives replay                                                  |
| Export                  | Canonical snapshot is flushed and used                                | Command admission while a non-canonical replacement preview is visible                           |

The Gate 4 and Gate 5 regressions now cover the replacement-owner,
multi-artboard, and last-good Fabric rows above. The StrictMode restore and
export/publication rows remain assigned to the two open P2 findings.

## Reviewed areas without an additional P0–P2 finding

These are supported strengths, not a claim of deployed or pixel-perfect completion:

- Multi-artboard layout keeps canonical geometry page-local, computes editor-only world frames, culls by overscanned visibility, and pins active/selected/crop pages (`packages/editor/src/multi-artboard.ts:116-213`; `apps/studio/src/features/studio-shell.tsx:2310-2337`). Page-specific document sync identities avoid whole-document invalidation.
- Fit, fill, manual crop, focal travel, frame resize, React render view, Fabric, and HTML renderer consume the canonical `projectImagePaint` implementation. Fabric calls it for layout and crop projection (`packages/editor/src/fabric-adapter.ts:2270-2315`), React calls it (`packages/render-view/src/index.tsx:1148`, `packages/render-view/src/index.tsx:1968`), and the renderer serializes the same projector (`apps/renderer/src/html.ts:359`). Replacement preserves authored frame geometry, placement, mask, and explicit alt text (`apps/studio/src/features/editor/media-selection-model.ts:54-82`).
- Image placement commands centralize fit/fill/flip/rotation/reset and emit typed `set_image_placement` drafts (`packages/editor/src/commands.ts:117-210`). Inspector capability modeling is canonical enough that no additional selection/Inspector P0–P2 was found beyond the async Fabric authority defects above.
- Template actions capture document, operation, source, and review generations (`apps/studio/src/features/editor/use-document-editor.ts:1303-1313`) and revalidate them before a created document installs (`apps/studio/src/features/editor/use-document-editor.ts:9988-10050`). Applied templates replace history through a named document transition and reconcile selection (`apps/studio/src/features/editor/use-document-editor.ts:10062-10096`).
- Draft persistence/recovery has explicit repository, save-controller, quarantine, conflict, and route-admission boundaries. The serial 94-test mounted persistence file passed. The StrictMode local-asset lifecycle above is a narrower hook-level exception.
- Server rendering does not trust interactive readiness. It materializes a transient clone, verifies managed content identity and dimensions, and admits exact node/resource expectations before Browser Rendering, as recorded in `asset-02-server-render-admission.md:7-31`. PNG/PDF export reads canonical state after a durable flush; the P2 is command-time truthfulness while preview state is pending, not export authority.

## Reference implementation comparison

The references were read as implementations, not as feature checklists.

### OpenPencil

Reference checkout: `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/open-pencil` at `88c1077071328b8df68f282543f16e20e97930b4`.

OpenPencil's retained backing is usable only when page, scene version, position-preview version, and font generation all match (`packages/core/src/canvas/renderer/retained-backing.ts:73-85`), plus viewport coverage (`retained-backing.ts:121-160`). A build snapshots those identities (`retained-backing.ts:418-436`), cancels on mismatch (`retained-backing.ts:454-460`), and installs only a completed matching build (`retained-backing.ts:471-482`). This is the relevant lesson for WebMCP Studio: “last good” is an identity-rich cache state, not “same page ID means ready.”

OpenPencil also centralizes image fit/fill/crop transform math and caches decoded images by content hash (`packages/core/src/canvas/fills.ts:385-475`). Its undo batching has an explicit owner and flushes on key change or scope disposal (`packages/vue/src/controls/undo-batch/use.ts:9-42`). Those patterns support generation-scoped render ownership and explicit mutation-session ownership; they do not require copying its Skia renderer.

### Loora

Reference checkout: `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/loora` at `68d5ff526eb23368999a02611ba7fde297da9212`.

Loora keys pending work by the full design/draft target (`packages/editor/src/lib/canvas-client.ts:68-70`), restores pending transactions before opening the controller (`canvas-client.ts:447-465`), and makes `ready`, `syncing`, `offline`, `conflict`, and `closed` explicit controller states (`canvas-client.ts:368-400`, `canvas-client.ts:843-932`). It flushes before close and persists the remaining queue (`canvas-client.ts:709-753`); ordered persistence prevents an older snapshot from landing after a newer acknowledgement (`canvas-client.ts:1245-1271`). Remote refresh rebases pending transactions and exposes conflicts instead of presenting a stale view as ready (`canvas-client.ts:809-839`; `packages/canvas/src/engine.ts:1009-1029`).

The transferable lesson is explicit target identity, explicit non-ready states, and ordered ownership across async settlement. Loora is not evidence that WebMCP Studio should adopt its transport or document model.

## Verification

All automated commands ran in a detached temporary worktree at the exact reviewed commit with Node `v22.23.2` and Bun `1.2.5`.

Focused architecture suites:

| Package                                                                                                      | Result                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Studio: replacement, library action, Fabric lifecycle/controller, multi-artboard, strict persistence, export | 13 files, 80/80 tests passed   |
| Editor: Fabric, crop, commands, history, Inspector, multi-artboard                                           | 14 files, 273/273 tests passed |
| Document image projection/conformance/resource admission                                                     | 5 files, 42/42 tests passed    |
| React render-view conformance                                                                                | 1 file, 35/35 tests passed     |
| Renderer HTML                                                                                                | 1 file, 42/42 tests passed     |

Focused total: 472/472 tests passed.

All-workspace typecheck passed for Studio, editor, document, render-view, renderer, WebMCP, UI, and worker-boundary.

The all-workspace test run was also executed and exited non-zero:

- Document 428/428, renderer 101/101, WebMCP 73/73, and worker-boundary 12/12 passed.
- Editor passed 383/384; one 75 ms performance assertion measured 99.3 ms under concurrent package load. The same test passed in the focused editor run.
- React render-view passed 34/35; one 250 ms performance assertion measured 269.5 ms under concurrent load. The same file passed 35/35 alone.
- Studio passed 1844/1853. Four persistence and one image-heavy failure under the concurrent run passed when rerun alone: persistence 94/94 and image-heavy 2/2.
- Two local-asset-store assertions remain red alone because fake IndexedDB returns a structured-cloned `Blob` and normalized record rather than the original `File` object expected by the test (37/39 passed). Two page-thumbnail assertions remain red alone because `expect.any(AbortSignal)` does not recognize the request's signal instance in this Node/Vitest realm (11/13 passed). Both failing groups reach the expected calls and fail on test-object identity/shape assertions; they are disclosed test-harness debt, not used to dismiss a product path.

Static production checks at `d882c77` found no `renderer: "react"` report and no `ProductPageFilmstrip` caller outside its definition. `StudioShell` also had no `onRuntimeStateChange` artboard owner.

No dev server, port 3000/3001 process, browser capture, capture directory, deployed Worker, or production service was started or changed. Existing untracked capture artifacts were not read, modified, staged, or removed.

## Repair order and release gates

1. Closed on 2026-09-01: explicit React replacement ownership and the real mounted composition regression now cover the P0.
2. Closed on 2026-09-01: per-artboard applied identity, owner-aware mounted admission, `syncing/stale_error`, atomic adapter installation, and commit-time async admission close both P1s.
3. Gate export, publish, and conflicting asset actions while replacement admission is pending.
4. Replace the local-asset lifecycle boolean with a replay-safe generation/lease and add the StrictMode restore test.
5. Rerun focused suites, all-workspace typecheck, serial performance-sensitive suites, and the existing healthy-host cross-renderer/browser evidence. Do not label renderer parity complete from unit tests alone.

Acceptance requires no synthetic renderer acknowledgements, no Fabric mutation while its applied identity is pending or stale, a visible retry for incremental sync failure, and exact agreement among visible preview, canonical document, persistence, Inspector, and export at every admitted command boundary.
