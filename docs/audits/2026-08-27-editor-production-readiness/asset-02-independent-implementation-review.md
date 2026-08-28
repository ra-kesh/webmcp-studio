# ASSET-02 independent implementation review

Reviewed: 2026-08-28
Scope: Current image-domain, crop-session, Fabric, React render-view, HTML renderer, Studio, WebMCP, accessibility, and focused test implementation.
Method: Direct code review against the accepted ASSET-02 domain and UX contracts. I did not rely on remediation status claims. I ran only package unit tests and typechecks; I did not run a browser, dev server, build, or Playwright.

## 2026-08-28 post-remediation re-review

The independent reviewer re-read the current implementation after the remediation work and found no remaining concrete P0 or P1 defect in the reviewed ASSET-02 slice. The original findings below are retained as the historical defect record; their implementation status is tracked in `remediation-progress.md`.

The re-review specifically confirmed source readiness and per-node recovery, exact tiny-frame placeholder geometry, renderer-acknowledged atomic replacement, managed-dimension integrity, the shared command/capability policy, direct frame and content manipulation, two-touch ownership, numeric active-crop alternatives, focus/compact placement, live WebMCP capability reads, thumbnail interaction semantics, and the retained 20-page/160-image render-count contract.

The remaining work is release evidence rather than a known P0/P1 code defect: real-browser gesture/accessibility journeys; actual Chromium performance and lifecycle profiling; mounted live-store WebMCP observation; and 1x/2x pixel baselines across Fabric, React, HTML, PNG/PDF, and published rendering. Browser renderer acknowledgement also cannot prove later Worker or artifact decode, so server render admission remains a separate boundary.

## Verdict

ASSET-02 now has a credible canonical foundation: strict image schema and migration, a shared affine projector, an immutable crop draft, one typed crop commit, rotation-aware direct panning, three honest frame masks, guarded WebMCP image patches, missing-alt publication blocking, and deterministic HTML readiness failures. The crop transaction itself is not the weak point.

It is not yet production-ready under the accepted definition of done. I found no current P0 defect, but seven P1 gaps remain. They are concentrated in source readiness and recovery, atomic replacement presentation, managed-dimension integrity, the shared command/capability model, direct manipulation and touch, keyboard/focus/compact behavior, and cross-renderer proof. Four P2 evidence or resilience gaps also remain.

No claim of full P0/P1 remediation, production parity, or ASSET-02 completion is supported by the current implementation. The narrower claims listed under **Verified strengths** are supported.

## Claim support

| Claim                                                             | Result                                            | Reason                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical image schema, migration, placement, and frame masks     | Supported                                         | Strict v2 schema, deterministic v1 migration, typed placement/mask/source commands, and shared projection are implemented and unit-tested.                                                                                        |
| Exactly-once crop domain transaction                              | Supported at domain/unit level                    | The session keeps an immutable baseline/draft and emits one `set_image_placement` command only when changed. Full mounted integration evidence remains incomplete (P2-01).                                                        |
| Fabric crop pan through frame rotation, image rotation, and flips | Supported                                         | The drag delta is converted into frame-local coordinates before the shared projector is used; the focused affine regression passes. Flips correctly change sampling orientation without inverting the requested visible movement. |
| Source-ready crop entry and actionable failure state              | Unsupported (P1-01)                               | Readiness is detected only after crop mode starts; import/sync rejection and React decode failure are not contained as actionable states.                                                                                         |
| Atomic, no-flash replacement                                      | Unsupported (P1-02)                               | Studio pre-decodes and revalidates, but the renderers discard the old resource before their separate decode completes.                                                                                                            |
| Managed metadata/natural-dimension integrity                      | Unsupported (P1-03)                               | Decoded dimensions are not compared with managed metadata, and the renderer resolver discards dimensions.                                                                                                                         |
| One image command/capability policy across every surface          | Unsupported (P1-04)                               | Only crop entry/apply/cancel are registered; inspector and replacement actions still use direct handlers.                                                                                                                         |
| Figma/Canva-grade direct crop manipulation and touch              | Unsupported (P1-05)                               | Canvas crop supports pan only; frame resize, inner handles, and two-touch content scaling are absent.                                                                                                                             |
| Keyboard, focus, screen-reader, and compact parity                | Unsupported (P1-06)                               | Numeric controls and a polite entry announcement exist, but screen-pixel nudge, focus provenance/return, canvas instructions, and collision-aware toolbar placement do not.                                                       |
| Fabric/React/HTML/PNG/PDF pixel parity                            | Unsupported (P1-07)                               | The retained corpus and tests do not cover the required placement/mask/source matrix or compare surfaces at 1x/2x.                                                                                                                |
| WebMCP image patch truthfulness                                   | Supported for the current typed proposal boundary | The public schema is discriminated, canonical placement/mask shapes are strict, legacy/matrix keys are rejected, replacement asset IDs resolve privately, and alt/decorative intent is preserved unless explicitly changed.       |
| Export/publish cannot consume an active crop draft                | Supported                                         | Export actions include crop in `outputBusy`, JSON export is disabled, and publish rejects an active crop before snapshotting.                                                                                                     |

## P1 findings

### P1-01 — Crop readiness and image failure recovery are reactive, not a capability

**Evidence**

- The crop-session start result rejects missing page/node, wrong type, lock, and visibility, but has no decoded-source readiness state (`packages/editor/src/image-crop-session.ts:22-32`, `packages/editor/src/image-crop-session.ts:100-134`).
- Studio enables Crop from selection/type/visibility/lock alone (`apps/studio/src/features/studio-shell.tsx:416-432`) and reconstructs the same incomplete condition at dispatch (`apps/studio/src/features/studio-shell.tsx:438-452`). The inspector button is disabled only for a locked node (`apps/studio/src/features/editor/inspector-sidebar.tsx:957-966`).
- Fabric rejects a missing placeholder only after Studio has already opened the session (`packages/editor/src/fabric-adapter.ts:1136-1155`). `FabricArtboard` then reports the failure and Studio cancels it (`apps/studio/src/features/editor/fabric-artboard.tsx:121-134`, `apps/studio/src/features/editor/fabric-artboard.tsx:268-283`; `apps/studio/src/features/editor/use-document-editor.ts:1029-1038`). This is useful containment, but it still produces an enabled control that opens and immediately closes.
- The Fabric dynamic import and `adapter.sync()` promise chains have no rejection branch (`apps/studio/src/features/editor/fabric-artboard.tsx:149-178`, `apps/studio/src/features/editor/fabric-artboard.tsx:180-206`). A rejected import/sync can leave the non-actionable “Preparing canvas…” overlay (`apps/studio/src/features/editor/fabric-artboard.tsx:257-261`).
- React render-view records only `loading` or `ready`; the `<img>` has no `onError`, so a failed resource can remain `loading` forever (`packages/render-view/src/index.tsx:204-227`, `packages/render-view/src/index.tsx:265-275`).

**User impact**

Crop appears available when the selected image is not usable, then disappears with an error after activation. A broken source has no stable Locate/Retry/Remove workflow. A top-level canvas adapter failure is not recoverable in place, and the React view cannot truthfully report a failed image.

**Concrete fix**

Introduce a source-readiness registry keyed by node ID plus source identity with `loading | ready | missing | error`. Project `selectedImageSourceReady` and `selectedImageSourceMissing` into the command context; disable Crop until ready and expose the reason. Render a geometry-preserving missing state with **Locate replacement**, **Retry**, and **Remove layer**. Add contained `.catch` paths for Fabric import/sync with a retry action and live announcement. Give React render-view an explicit error state and retry/resource-revision path.

### P1-02 — Replacement validation is staged, but the visible renderer swap is not atomic

**Evidence**

- Managed add/replace correctly captures an async anchor, fetches current metadata, pre-decodes in the browser, and revalidates the anchor before commit (`apps/studio/src/features/editor/use-document-editor.ts:1701-1755`, `apps/studio/src/features/editor/use-document-editor.ts:1758-1820`). Local-file and reused-local paths likewise prepare before document mutation (`apps/studio/src/features/editor/use-document-editor.ts:1823-1899`, `apps/studio/src/features/editor/use-document-editor.ts:1902-2000`).
- The generic replacement commit changes canonical identity immediately (`apps/studio/src/features/editor/use-document-editor.ts:1648-1672`).
- On the next Fabric sync, a changed `src` removes the old object before awaiting construction of the replacement (`packages/editor/src/fabric-adapter.ts:995-1017`).
- React changes the component key immediately for the new source (`packages/render-view/src/index.tsx:170-177`) and renders the new `<img>` before natural dimensions are available (`packages/render-view/src/index.tsx:204-275`). There is no retained previous decoded resource or error rollback.

**User impact**

The chosen bytes may pass Studio's preflight and still fail or delay during the renderer's second fetch/decode. In that interval the old image can flash away; on the second failure the document is already changed and the user sees a placeholder/loading image. This violates the accepted Replace loading state, where the old image remains visible until the new pixels are ready.

**Concrete fix**

Decode once into a renderer-consumable resource/cache token, revalidate the document/page/node/source anchor, then atomically commit and swap while retaining the old Fabric/React resource until the new one is ready. If the final swap cannot be installed, do not mutate the document or roll the command back. Route the commit through the typed `replace_image_source` command rather than `update_node` (`packages/document/src/commands.ts:526-554`).

### P1-03 — Managed natural dimensions are trusted but not verified against decoded content

**Evidence**

- `verifyManagedMediaBrowserDecode` returns decoded dimensions (`apps/studio/src/features/editor/use-document-editor.ts:163-176`), but managed add/replace discard that value and persist `current.width`/`current.height` without comparing them (`apps/studio/src/features/editor/use-document-editor.ts:1714-1735`, `apps/studio/src/features/editor/use-document-editor.ts:1779-1800`).
- The managed renderer repository verifies the content hash but returns only a data URI, discarding the asset's expected dimensions (`apps/studio/src/server/media-asset-repository.ts:804-823`).
- Materialization accepts a resolver of `Promise<string>` and therefore cannot carry expected dimensions to the renderer (`apps/studio/src/server/render-field-assets.ts:159-195`).

**User impact**

If stored metadata and bytes disagree, the editor and export can project the same placement using different natural dimensions. The result is a silent crop/composition change instead of the required node-specific integrity failure.

**Concrete fix**

Return verified `{ src, width, height, contentHash, revision }` from the managed resolver. Compare browser-decoded and renderer-decoded dimensions against that metadata before insertion, replacement, projection, or readiness. Fail with a stable asset/node error on mismatch and leave the document unchanged.

### P1-04 — The image command and capability registry is still only a crop stub

**Evidence**

- The accepted minimum includes insert, replace, fit, fill, flips, rotations, reset, and three frame commands plus crop actions (`docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:281-317`). The actual registry exposes only `image.crop`, `image.crop.apply`, and `image.crop.cancel` (`packages/editor/src/commands.ts:1-29`).
- Command context contains only `canCropImage` and `imageCropActive`; it lacks source readiness/missing, all-selected-images editable, draft changed, and lock-specific image capabilities (`packages/editor/src/commands.ts:33-44`).
- The inspector directly patches placement, flips, rotation, and alt through `onUpdate`, and calls frame/crop/replace callbacks directly (`apps/studio/src/features/editor/inspector-sidebar.tsx:731-893`, `apps/studio/src/features/editor/inspector-sidebar.tsx:957-975`).
- Studio has typed document helpers for placement and frame mask (`apps/studio/src/features/editor/use-document-editor.ts:948-963`), but replacement still commits `update_node` (`apps/studio/src/features/editor/use-document-editor.ts:1648-1672`). Thus typed document commands exist without one user-action registry controlling every surface.

**User impact**

Inspector, keyboard, toolbar, context menu, and automation can drift in enablement, labels, history names, and lock/review/source behavior. P1-01 is already one consequence: Crop cannot be disabled from a source-readiness capability that does not exist.

**Concrete fix**

Register the remaining image actions and their labels, shortcuts, enablement, and handlers in `@webmcp/editor`. Derive the complete capability context once. Make inspector, crop bar, context bar/menu, keyboard, and WebMCP adapters invoke those command IDs. Use named typed document transactions for placement, masks, fit/fill/flip/rotate/reset, and source replacement.

### P1-05 — Canvas crop manipulation supports pan, not the accepted frame/content workflow

**Evidence**

- Crop mode disables every Fabric control and locks movement, scaling, and rotation for all objects (`packages/editor/src/fabric-adapter.ts:1198-1227`).
- The only direct crop pointer operation stores a drag baseline and projects a translation (`packages/editor/src/fabric-adapter.ts:1302-1367`). There are no inner scale/rotation handles, crop-frame edge/corner resize, or two-touch content gesture.
- The accepted interaction explicitly requires frame-edge/corner resizing, two-touch content scaling, and content rotation/scale alternatives (`docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:168-175`, `docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:231-237`).
- Frame-mask controls commit outside the crop draft (`apps/studio/src/features/editor/inspector-sidebar.tsx:853-893`), while general mutation is blocked during an active crop (`apps/studio/src/features/editor/use-document-editor.ts:828-842`). The accepted history test requires mask changes to participate in the one crop transaction (`docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:361-367`).

**User impact**

The most common action—dragging the image—is now usable, but the editor still cannot deliver the direct, free-flowing crop behavior expected from Figma/Canva. Frame and content edits remain split across modes and history entries, and the touch journey is incomplete.

**Concrete fix**

Add screen-stable inner scale/rotation handles and a distinct frame-resize mode that preserves visible content placement. Add two-pointer content scale/translation begun inside the crop surface with pointer capture and scoped `touch-action`. Either include frame-mask/frame draft state in the same crop session and final transaction or revise the accepted contract before claiming the combined transaction.

### P1-06 — Keyboard geometry, focus return, canvas instructions, and compact placement are incomplete

**Evidence**

- Crop arrow keys change focal values by fixed `0.01`/`0.05` fractions (`apps/studio/src/features/studio-shell.tsx:593-625`). The accepted rule is one or ten screen pixels converted through current camera/frame/image geometry (`docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:220-229`). The current result varies with source size, zoom, and rotation.
- The crop toolbar is programmatically focusable (`tabIndex={-1}`) and announces entry once (`apps/studio/src/features/editor/image-crop-toolbar.tsx:301-332`), but it has no focus-on-entry effect or opener provenance. Compact entry closes the sheet and starts crop on the next frame (`apps/studio/src/features/studio-shell.tsx:1917-1922`) without preserving the exact Crop opener for exit.
- Fabric gives the upper canvas only `role="application"` and `aria-label`; there is no discoverable `aria-describedby` escape/instruction text (`packages/editor/src/fabric-adapter.ts:881-909`).
- The crop bar is fixed to one bottom offset (`apps/studio/src/features/studio-shell.tsx:1679-1687`) rather than choosing top or bottom from selected-frame screen bounds as required (`docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:275-279`).

**User impact**

Keyboard crop nudging is not spatially predictable. Crop opened from the compact inspector can lose focus provenance, and exit does not reliably return to the exact opener. Screen-reader users receive the mode announcement but not instructions for leaving the canvas application region. The bar may cover the frame being edited.

**Concrete fix**

Project keyboard screen deltas through the same affine path as Fabric pointer drag. Capture entry origin and opener element; focus the toolbar heading/Done only for menu/inspector entry, keep canvas focus for double-click, and restore exact focus on exit. Attach stable canvas instructions through `aria-describedby`. Choose toolbar top/bottom placement from selected-frame viewport bounds and verify at 320 px/200% zoom.

### P1-07 — Cross-surface parity is plausible but not demonstrated by the retained corpus

**Evidence**

- The canonical conformance document has two images, both using rectangle masks and zero inner rotation/flips (`packages/document/src/render-conformance.ts:97-149`).
- Its image test asserts one Fill and one Fit projection only (`packages/document/test/render-conformance.test.ts:107-145`).
- React render-view tests verify styles, stored placement/mask passthrough, source identity, and stale-size invalidation, but do not mount an image through load/error or compare a computed affine against Fabric/HTML output (`packages/render-view/test/conformance.test.ts:108-159`).
- HTML tests exercise manual affine, masks, failures, and randomized projector serialization, but there is no retained multi-surface matrix/pixel comparison. The accepted matrix requires landscape/portrait/square sources and frames, focal corners, multiple zooms/rotations/flips, all masks, and 1x/2x comparisons (`docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:343-350`).

**User impact**

The shared math significantly lowers risk, but it does not prove that Fabric, React, PNG/PDF, published rendering, and browser decode behavior produce the same pixels. A cross-surface regression can still escape—as the current missing React error state demonstrates.

**Concrete fix**

Expand the canonical fixture matrix, retain per-surface structural affine/clip outputs, mount React images through ready and failed load states, and add 1x/2x pixel baselines for Fabric, React, PNG/PDF, and published output once browser infrastructure is healthy. Do not mark renderer parity complete before those artifacts pass.

## P2 findings

### P2-01 — Exactly-once behavior is well unit-tested but not proven through the mounted composition

The domain session is strong (`packages/editor/src/image-crop-session.ts:100-255`) and the toolbar exit gate suppresses duplicate exit callbacks (`apps/studio/src/features/editor/image-crop-toolbar.tsx:244-260`). However, the Studio “integration” harness reconstructs an in-memory session and calls domain functions directly rather than mounting `useDocumentEditor`, `FabricArtboard`, `ImageCropToolbar`, and history together (`apps/studio/src/features/editor/image-edit-session.test.ts:63-133`).

**Impact:** A duplicate event or React timing issue across the real shell can evade the current proof even though each local primitive is correct.

**Fix:** Add a mounted hook/component integration test covering 50 previews, duplicate Enter/Done, page and selection settlement, review cancellation, Undo/Redo, exact history depth, snapshot identity, and one final `Crop image` entry.

### P2-02 — Every crop preview updates React state at the top editor hook

`previewImageCrop` calls `setImageCropSession` for every pointer update (`apps/studio/src/features/editor/use-document-editor.ts:1007-1015`), and `previewDocument` is recomputed from that session (`apps/studio/src/features/editor/use-document-editor.ts:3042-3050`). The accepted performance contract says pointer updates must not rerender the Studio shell (`docs/audits/2026-08-27-editor-production-readiness/asset-02-editor-ux-contract.md:407-411`).

**Impact:** This is a credible frame-rate risk on image-heavy/multi-page documents, but no browser profile was run in this review, so it is an evidence-backed risk rather than a measured regression.

**Fix:** Keep high-frequency pointer draft updates in a narrow external store or Fabric-local draft channel. Subscribe only Fabric/React image paint and crop controls; publish a lower-frequency semantic snapshot to the shell. Profile before and after on the required 20-page fixture.

### P2-03 — Reconciliation can cancel an externally invalidated crop without explaining why

The reconciliation effect maps every non-active result to `null` and discards `result.reason` (`apps/studio/src/features/editor/use-document-editor.ts:3028-3040`). The explicit apply path does show a generic source-change message (`apps/studio/src/features/editor/use-document-editor.ts:884-895`), but external history/document/source invalidation can take the silent effect path.

**Impact:** Crop mode may disappear after an external state change with no explanation that the draft was not applied.

**Fix:** Map each invalidation reason to a one-shot status/alert and preserve the exact baseline. Test source, document, page, review, recovery, lock, and visibility invalidations through the hook.

### P2-04 — WebMCP structured no-op detection uses reference equality

`createCanvasEditChangeSet` filters a patch using `node[key] !== value` (`packages/webmcp/src/change-sets.ts:263-267`). Equal placement or frame-mask objects supplied by a tool are new object references, so a semantic no-op becomes a review operation.

**Impact:** Automation can create noisy “changes” that do not change the document, weakening review trust and history quality.

**Fix:** Compare canonical structured values deeply after schema parsing; retain primitive equality for scalar fields. Add no-op regressions for identical placement and all frame-mask shapes.

## Verified strengths

- Image schema v2 is strict and readable, with explicit placement, inner rotation/flips, frame masks, alternative text, and decorative intent (`packages/document/src/schema.ts:178-205`, `packages/document/src/schema.ts:528-544`).
- Writable v1 documents migrate deterministically while immutable published v1 envelopes are not silently rewritten (`packages/document/src/document-decoder.ts:59-127`, `packages/document/src/document-decoder.ts:249-491`).
- Placement, mask, and source replacement have typed document commands with binding-aware source rejection (`packages/document/src/commands.ts:498-554`; `packages/document/src/schema.ts:605-620`).
- One projector owns image affine and clip geometry (`packages/document/src/render-projection.ts:411-548`).
- Crop preview is immutable editor state and changed apply emits exactly one named placement transaction (`packages/editor/src/image-crop-session.ts:100-225`). Selection/page transitions settle against the captured target, while Undo/Redo cancel a draft before touching history (`apps/studio/src/features/editor/use-document-editor.ts:874-920`, `apps/studio/src/features/editor/use-document-editor.ts:1040-1053`, `apps/studio/src/features/editor/use-document-editor.ts:2933-2960`).
- Fabric pan correctly handles outer rotation, inner rotation, and flips (`packages/editor/src/fabric-adapter.ts:552-612`, `packages/editor/test/fabric-crop-drag.test.ts:27-72`). Crop overflow uses one exact pre-crop clip snapshot and restores it on exit (`packages/editor/src/fabric-adapter.ts:1183-1197`, `packages/editor/src/fabric-adapter.ts:1231-1240`).
- The HTML renderer waits for fonts and decoded image resources, fails node-specifically, and consumes serialized shared projector math (`apps/renderer/src/html.ts:53-144`, `apps/renderer/src/html.ts:200-213`).
- WebMCP now exposes strict canonical image placement/mask input, verifies node type, rejects renderer-private/legacy transforms, preserves alt/decorative intent by default, and keeps resolved source URLs out of public results (`packages/webmcp/src/registration.ts:494-675`, `packages/webmcp/src/registration.ts:689-803`, `packages/webmcp/src/registration.ts:1483-1542`; `packages/webmcp/src/change-sets.ts:227-305`).
- Publication blocks missing meaningful-image alt text and blocks active crop publication (`packages/document/src/publishing.ts:96-143`; `apps/studio/src/features/editor/use-document-editor.ts:1259-1276`). Export actions include crop in their busy/disabled policy (`apps/studio/src/features/studio-shell.tsx:911-929`).
- Inspector now exposes numeric focal percentages, zoom, inner rotation, flips, frame masks, and alt/decorative controls (`apps/studio/src/features/editor/inspector-controls.tsx:99-219`; `apps/studio/src/features/editor/inspector-sidebar.tsx:731-927`).

## Test evidence

All commands below were run from the package directory against the final reviewed tree:

| Package               | Command                             | Result                                              |
| --------------------- | ----------------------------------- | --------------------------------------------------- |
| `@webmcp/editor`      | `bun test && bun run typecheck`     | 102 tests passed across 13 files; typecheck passed. |
| Studio                | `bun run test && bun run typecheck` | 192 tests passed across 37 files; typecheck passed. |
| `@webmcp/document`    | `bun test && bun run typecheck`     | 143 tests passed across 18 files; typecheck passed. |
| `@webmcp/webmcp`      | `bun test && bun run typecheck`     | 37 tests passed across 2 files; typecheck passed.   |
| `@webmcp/render-view` | `bun test && bun run typecheck`     | 7 tests passed; typecheck passed.                   |
| Renderer              | `bun run test && bun run typecheck` | 38 tests passed across 3 files; typecheck passed.   |

These green gates support the unit/domain claims above. They do not substitute for the missing mounted, browser, deployed, accessibility, performance, and pixel-conformance evidence called out in P1-07 and P2-01/P2-02.

## Release decision

Do not label ASSET-02 production-ready or renderer-parity complete yet. Keep the canonical model, projector, crop session, WebMCP schema, and current Fabric pan implementation. Close the P1 findings in this order:

1. Source readiness/failure state and managed dimension integrity.
2. Atomic renderer handoff for replacement.
3. Shared image command/capability registry.
4. Direct frame/content manipulation and touch.
5. Keyboard/focus/compact accessibility.
6. Retained multi-surface structural and pixel conformance.

There is no evidence-based reason to rewrite the completed crop domain or affine pan math. The remaining work is integration depth and product behavior around that foundation.
