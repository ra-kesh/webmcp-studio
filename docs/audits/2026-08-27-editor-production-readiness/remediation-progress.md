# Remediation progress

This file records implementation evidence after the 2026-08-27 audit. The audit files remain a snapshot of the state that was inspected; this log is the current handoff.

## Mandatory phase-entry protocol

Before starting every implementation phase:

1. Reread the relevant findings, measurements, reproductions, and acceptance criteria in this audit folder. Do not rely on memory or an earlier summary.
2. Revisit the applicable reference repositories and source folders, including OpenPencil and the local Canva/editor references identified by the audit. Inspect the actual implementation patterns relevant to the phase—not only screenshots or README claims.
3. Trace the current WebMCP Studio code paths and existing tests that own the behavior. Record conflicts, dead parallel implementations, and reusable primitives before editing.
4. Write a bounded phase plan linking audit item IDs, reference patterns, affected code boundaries, and verification evidence.
5. Only then implement. Finish with unit/integration coverage, real browser use, and an update to this remediation log.

A phase is not considered started until steps 1–4 are complete. A phase is not considered complete merely because it builds; its audit acceptance criteria must be exercised proportionally to risk.

## 2026-08-29 — Lossless conformance capture and renderer alignment (CONFORM-01 / EXPORT-01)

Status: **active; bounded local repair complete, final/deployed capture open**

- Revisited Loora's canvas capture/export path and OpenPencil's visual-oracle
  scripts before implementation. The gate now owns byte-stable fixture JSON,
  exact output/page order, lossless DSF-1 browser captures, real Studio
  PNG/PDF requests, magic/header/dimension validation, PDF page rasterization,
  staged promotion, hashes, and machine-readable reports.
- One complete run retained all 12 expected artifacts. It proved exact page
  dimensions and PDF order, then exposed text and vector drift rather than
  hiding it behind screenshots.
- React and Renderer now share grayscale/geometric font policy. Fabric idle
  text paints canonical lines with native Canvas run shaping/letter spacing;
  editing and styled/path fallbacks remain Fabric-owned. The managed Geist
  baseline bridge is corrected by one pixel.
- Fabric lines compensate stroke-inclusive origin and reverse that compensation
  when projecting back to canonical geometry. Icons compensate their scaled
  stroke inside the SVG viewport. Focused screenshots bring properties and
  square Fabric pages under the unchanged raw limits; canonical long-text
  geometry is aligned while raw Canvas/CSS glyph coverage remains above limit.
- Browser Rendering `429` and connection-loss failures now become stable,
  retryable `503` responses. Capture attempts are serial, bounded, and have a
  30-second deadline. A capacity-blocked run cannot mix or promote partial
  artifacts.
- Independent review rejected two harness details while accepting the actual
  editor/renderer repairs: React capture relied on `document.fonts.ready`, and
  promotion copied files individually. React now uses Fabric's exact per-page
  font load/check contract with a fallback-font regression. Successful captures
  are immutable versioned directories; an atomic report replacement selects a
  complete run. The verifier binds every comparison input to that report and
  checks all byte lengths, SHA-256 values, and version-2 browser runtime metadata
  before pixel work. The legacy complete run remains supported explicitly as a
  version-1 report.
- Focused evidence: editor 74/74, render-view 12/12, Renderer HTML 21/21, and
  Studio renderer-error 4/4 tests pass; the React readiness gate adds 12/12
  focused Studio tests; affected packages typecheck. Final
  same-runtime/deployed capture and the geometry-aware text oracle remain open.

## 2026-08-27 — Published render repair (DEMO-01)

Status: **completed locally**

- Root cause: Browser Rendering returned an ordinary unknown-length `ReadableStream`; `apps/renderer/src/index.ts` teed that stream and passed one branch directly to R2, which requires a known-length body.
- Fix: `apps/renderer/src/artifact-body.ts` reads the artifact through a 64 MiB bounded stream collector and materializes a sized `Blob`. R2 storage and the service-binding response now share the same explicit-size artifact; the response includes `Content-Length` and accurate `X-Bytes` metadata.
- Stable failures: missing bodies, invalid declared lengths, over-limit artifacts, length mismatches, and stream read failures now have named renderer error codes.
- Regression coverage: renderer body tests plus a Worker-handler contract test reproduce an unknown-length browser PDF and assert R2 receives a `Blob`, response bytes remain intact, and artifact metadata is complete.
- Live proof: published `midnight-film` version 1 completed as render `render-09834b10-b082-4220-9893-6421d258f873`; the persisted artifact was 291,565 bytes, PDF 1.4, tagged, and six pages.

## 2026-08-27 — Command integrity and safe review mode (CMD-01 / REVIEW-01)

Status: **core toolbar and review safety completed; broader command-adapter migration remains**

- Added the typed command registry in `packages/editor/src/commands.ts`, including unique keyboard chords, mutating-command classification, and capability-derived enablement.
- Removed the second global keyboard owner from `use-document-editor.ts`. The shell now resolves shortcuts once and executes the same command IDs used by its toolbar.
- `V` now selects the pointer tool without clearing selection. Command tests reject duplicate chords.
- Mutations return an explicit commit result. Add, duplicate, paste, delete, page, and output side effects only update selection/navigation after a successful commit, eliminating the ghost selection produced by blocked review-mode edits.
- Pending review disables text, shapes, history, paste/duplicate/group/delete, templates, imports, new-document actions, export, and inspector mutation tabs. The inspector automatically opens Review; page/viewport navigation and review decisions remain available.
- Image/import/reset/template mutation entry points also guard before performing storage or replacement side effects.
- Browser regressions cover `V` selection preservation and a real WebMCP-created pending proposal. Pressing `T` leaves the inspected document, revision, selection, and pending change set byte-for-byte unchanged.

Remaining CMD-01 scope:

- Migrate remaining inspector actions, menus, and WebMCP direct mutations to command adapters. Page/output management now uses the PAGE-01 structural command registry.
- Generate platform-specific shortcut labels from registry metadata.
- Expose queryable command capability projection to WebMCP.

## Verification baseline

- `bun run check`: passing (lint, every package typecheck, 81 unit/integration tests, all production builds).
- `bun run --filter @webmcp/studio test:e2e`: passing (5 browser tests).
- Live browser: published six-page render succeeds; review-mode controls and keyboard block are verified against the running app.

## 2026-08-27 — Responsive shell and accessible compact panels (RESP-01 / A11Y-01)

Status: **completed locally**

Phase-entry evidence:

- Reread `visual-and-interaction-audit.md`, `reference-patterns.md`, and the responsive/accessibility test evidence. The required viewport matrix is 320, 360, 390, 430, 768, 1119, 1120, 1280, and 1440 pixels; every width must retain access to publish, API playground, imports, exports, new-document creation, and failure/status information.
- Revisited OpenPencil's actual `EditorWorkspace.vue`, `MobileDrawer.vue`, viewport-kind hook, and control/toolbar/canvas-header/page-list themes. The governing pattern is a deliberate compact editor composition—canvas remains primary and panel content moves into one controlled surface—not indefinite compression of the desktop tri-panel shell.
- Rechecked the local Canva-clone and Avnac editor sources. They reinforce use of established dialog/menu primitives and explicit editor-panel ownership; Avnac's current mobile exclusion is not an acceptable product behavior for this app.
- Inspected the installed shadcn `radix-nova` registry, the local Radix Dialog and Dropdown Menu primitives, and the official Sheet registry source. Sheet provides the required modal semantics, focus trap, Escape handling, outside-content isolation, and opener-focus restoration without maintaining a parallel accessibility implementation.
- Traced current ownership to `StudioShell`: the top bar hides publish below 900px and API playground below 760px without replacements; errors disappear below 1050px; the 1120px grid breakpoint swaps between fixed sidebars and a hand-built overlay whose backdrop and close button duplicate close behavior without dialog semantics or focus management.

Bounded implementation contract:

1. Replace progressive capability loss with one responsive top-bar action model. Wide screens may expose direct actions; compact screens receive a single labelled overflow menu containing document status/errors, publish, API playground, new/import/export document actions, and output exports. Capabilities and disabled states must remain identical between direct and overflow entry points.
2. Keep compact editor controls intentional rather than clipped: a stable document identity, 44px compact/coarse pointer targets, and no horizontal document overflow at any supported width. Desktop-density controls remain unchanged where space permits.
3. Move the tri-panel threshold to 1280px so 1119 and 1120 share one compact information architecture. At 1280 and above, preserve the 236px / flexible canvas / 320px desktop relationship.
4. Replace the hand-built compact overlay with one controlled shadcn Sheet. It must have a programmatic title/description, exactly one close control, side appropriate to the invoking panel, scroll containment, Escape closure, modal focus containment, and focus restoration to the opener.
5. Add browser regressions for the entire viewport matrix, action reachability, no horizontal overflow, compact hit-target geometry, panel labelling, focus entry/trap, Escape, outside-content isolation, and opener-focus restoration. Re-run the existing gesture and command-integrity suites plus the repository check.

Completion evidence:

- `StudioShell` now keeps document identity flexible and gives every width one `More studio actions` menu. That menu exposes save/error state, publish, API playground, core editor/history commands, new/import/export document actions, and PNG/PDF output actions with the same review/export disabled states as the direct controls.
- The desktop tri-panel shell now begins at 1280px. Widths 1119 and 1120 use the same canvas-first compact composition; 1280 and 1440 retain the 236px / flexible canvas / 320px panel structure.
- Compact toolbar, panel, zoom, and menu targets are at least 44px. The narrow zoom control removes only the slider and secondary selection shortcut while retaining zoom out, numeric reset, zoom in, and fit controls.
- The custom backdrop/panel implementation was deleted. Both compact panels use the official shadcn Radix Sheet with named title and description, one close control, `overscroll-contain`, modal focus containment, Escape closure, explicit `inert`/`aria-hidden` editor isolation, and opener-specific focus restoration.
- The browser matrix passes at 320, 360, 390, 430, 768, 1119, 1120, 1280, and 1440px. Every width has zero document-level horizontal overflow and can reach publish, API playground, new document, both imports, document JSON export, PNG export, and multi-page PDF export.
- Accessibility regression proof covers focus entry, 12 successive Tab presses remaining in the Sheet, programmatic background-focus rejection, exactly one 44px close button, Escape closure, close-button closure, and restoration to each actual opener.
- Live browser review was performed at compact, 1119px, and 1280px shell modes. The 1119px header remains a straight two-row composition with the panel controls at opposite edges; 1280px cleanly restores both fixed sidebars without document overflow.
- The current Vercel Web Interface Guidelines were applied to the modified shell and Sheet. The phase-specific scan found no missing icon labels, unlabeled controls, click-only non-buttons, blocked paste, hidden focus replacement, `transition: all`, or zoom-disabling viewport behavior.
- `bun run check` passes: lint, all package typechecks, 81 unit/integration tests, and every production build.
- `bun run --filter @webmcp/studio test:e2e` passes all 7 browser tests, including the existing gesture and command-integrity regressions.

## 2026-08-27 — Canonical page and output management (PAGE-01)

Status: **completed locally**

Phase-entry evidence:

- Reread WF-01, PAGE-01 test evidence, the P0 backlog row, and the audit's document/output/page acceptance criteria. The existing six-page quotation proved rendering but the shipped UI could only select pages; every structural callback was unreachable.
- Revisited OpenPencil's `PagesPanel.vue` and page-list theme. The relevant pattern is a persistent semantic page list with explicit add, rename, reorder, and guarded delete actions, while the canvas navigation strip remains a fast visual surface.
- Rechecked the local Canva-style references for horizontal gallery navigation and contextual page actions. The product-specific conclusion remains: templates belong in the left catalog; pages remain visible in the bottom gallery; structural management belongs in the same left information architecture as Templates and Layers.
- Traced the current document engine before editing. `OutputVariant.pageIds` is the canonical page order consumed by thumbnails and export; every page owns one `outputId`; the command engine atomically removes page nodes, groups, and bindings; the hook already provides undoable page/output operations. The unmounted `document-sidebar.tsx` duplicated the live sidebar and committed page settings once per keystroke.

Bounded implementation contract:

1. Consolidate the left information architecture into Templates / Pages / Layers on desktop and in the existing compact Sheet. Do not mount a second competing sidebar.
2. Treat `output.pageIds` as the only ordering source. The sidebar, horizontal filmstrip, active canvas, persistence, API document, and renderer must observe that same order.
3. Give every structural action a stable product command ID and capability rule. Pending review blocks all structural mutations; final-page and final-output removal are blocked at both capability and document-engine boundaries.
4. Make page settings transactional: edit a local draft, validate it, and commit name/dimensions/background once so one Undo restores the entire change.
5. Keep fast contextual actions beside the bottom gallery while full output/page management lives in the Pages panel. Destructive structural actions must explain impact and remain undoable.
6. Remove the dead parallel sidebar and cover add, duplicate, reorder, rename/resize, delete/undo, output create/delete, invariant communication, persistence, compact parity, and review-mode blocking in browser tests.

Completion evidence:

- The live left sidebar now contains Templates, Pages, and Layers. The same component is mounted inside the compact Document Sheet, so desktop and compact use one implementation and one capability model.
- `PageOutputPanel` exposes output creation/rename/delete and page add/duplicate/settings/reorder/delete. Output/page counts, dimensions, names, and real renderer-backed thumbnails are visible without leaving the editor.
- The horizontal filmstrip remains the photo-gallery page navigator requested for the quotation workflow. It now adds pages and exposes contextual duplicate, move-left/right, and delete actions without replacing the left template catalog.
- Stable `page.*` and `output.*` command IDs and capability rules live in `packages/editor/src/structure-commands.ts`. The same IDs are attached to sidebar, filmstrip, dialog, and destructive confirmation entry points. Review state, first/last position, final page, and final output determine enablement centrally.
- Page settings no longer mutate on each keypress. Name, width, height, and background are edited in a draft and saved as one document command/Undo step. Output rename follows the same explicit-save pattern.
- Page and output deletion confirmations report the affected page/object count and state that the operation can be undone. Disabled final-page/final-output menu items include the governing invariant in plain language.
- The abandoned `document-sidebar.tsx` was removed rather than retained as a second architecture.
- Live browser use verified the real six-page quotation at 1280px: Pages panel, page thumbnails, active canvas, zoom HUD, and horizontal filmstrip remain visually aligned; the panel is dense but readable and uses the existing editor chrome.
- New browser coverage exercises add/undo, duplicate/undo, reorder/undo, transactional rename and resize/undo, page delete/undo, output create/delete, canonical persistence relationships, invariant messaging, and pending-review blocking. It also asserts sidebar and filmstrip order after mutations.
- `bun run check` passes: lint, every package typecheck, 84 unit/integration tests, and every production build. `git diff --check` is clean.
- `bun run --filter @webmcp/editor test` passes all 26 editor tests, including structural command vocabulary and capability invariants.
- `bun run --filter @webmcp/studio test:e2e` passes all 10 browser tests, including the complete responsive/accessibility, gesture, command-integrity, and page/output suites.

## 2026-08-27 — Strict aggregate publication and render gate (VALID-01)

Status: **completed locally**

Phase-entry evidence:

- Reread ARCH-02, ARCH-03, the VALID-01 backlog row, failure-state evidence, import/export findings, and the strict publish/render acceptance criteria.
- Traced `documentSchema`, document commands, aggregate validation, quotation composition, JSON restore/import, client publication, the template D1 repository, preview-export routes, the published render route, and the private Renderer Worker. The client authored `manifest` and `sourceRevision`; the template route stored them after shape parsing; unknown keys were stripped; the renderer accepted schema-valid documents without aggregate validation.
- Revisited the current Cloudflare Workers best-practices source, retrieved `@cloudflare/workers-types@5.20260827.1`, and checked both Wrangler configs against the installed schema. Both Workers use service bindings, generated `Env`, `nodejs_compat`, explicit compatibility dates, and observability. The modified render error path now reads a bounded response snippet rather than buffering an unbounded error body.
- Rechecked the Stuwiz quotation contract and composer because they are a first-class document creation boundary, not merely fixture code.

Bounded implementation contract:

1. Make public document, command, change-set, template, quotation, publish, export, and renderer objects strict at nested boundaries. Unknown keys fail; they are never silently stripped.
2. Replace arbitrary node patch records with an allowlisted union of common and node-specific property schemas. The final discriminated node schema must reject properties that do not belong to the actual node type.
3. Extend aggregate validation to duplicate IDs/references, output-page ownership, orphan/cross-owned pages and nodes, group relationships, field keys/values/defaults, duplicate binding targets, and supported image-source protocols.
4. Run aggregate validation after every canonical command and before restore/import replacement, quotation composition return, immutable publish, preview export, and private rendering.
5. Make the public publish request contain only publication identity and the canonical document. Derive source revision, parameter manifest, output metadata, page dimensions, and binding targets on the server immediately before D1 persistence.
6. Enforce deterministic renderer policy for unresolved local images and fonts unavailable to the renderer. Return stable 400 shape errors and 422 aggregate/policy errors before Browser Rendering or R2.
7. Prove invalid import recovery, persistence non-mutation, unknown-key rejection, valid server-derived publication, and renderer short-circuiting with adversarial unit and browser fixtures.

Completion evidence:

- Document and quotation schemas are strict recursively; command/change-set/template schemas and every modified public request object reject unknown keys. Empty or unknown node patches fail before mutation.
- `validateDocument` now detects duplicate collection IDs, duplicate ordered references, missing/cross-owned/orphan pages and nodes, duplicate field keys, orphan field values, invalid defaults, duplicate binding targets, unsafe image protocols, and the existing group/reference/type issues.
- `assertValidDocument` is the aggregate gate used by canonical commands and composition. Local draft restoration quarantines invalid relationships instead of replacing the starter; JSON import reports the first stable issue and preserves current work.
- `templatePublishRequestSchema` excludes `manifest` and `sourceRevision`. `persistTemplateVersion` parses that strict request and calls `createTemplateVersionFromPublishRequest`, which derives the source revision and complete manifest from the validated document immediately before the D1 batch.
- Publishing and rendering reject unresolved `asset:local` images and text fonts outside the deterministic renderer set. Preview export and both private renderer handlers run the same aggregate/policy gate.
- Renderer Worker tests prove an orphan node returns `422 document_validation_failed`; Browser Rendering and R2 are never invoked. Separate coverage proves unknown renderer request keys return 400.
- Browser tests upload an aggregate-invalid but schema-valid Studio JSON file, observe the named relationship error, and verify the six-page current document remains intact. Route tests submit invalid publish requests, receive 422/400, and prove the workspace template list is unchanged.
- The happy-path browser test publishes version 1 through the revised contract and verifies D1 returns one immutable template with a server-derived one-parameter, six-page manifest.
- Cloudflare guidance influenced the boundary implementation: service bindings remain the Worker-to-Worker path, request state remains local, all I/O promises are awaited, and renderer error-body inspection is explicitly bounded and cancelled.
- `bun run check` passes: lint, every package typecheck, 95 unit/integration tests, and all production Worker/client/server builds. `git diff --check` is clean.
- `bun run --filter @webmcp/studio test:e2e` passes all 13 browser tests across validation, page/output, command, gesture, responsive, and accessibility behavior.

## 2026-08-27 — Clean challenge journey and artifact proof (E2E-01)

Status: **completed locally; deployed smoke remains an environment gate**

Phase-entry evidence:

- Reread E2E-01, DEMO-01/WF-08, the artifact-confidence gaps in WF-09, the clean-session evidence, and the audit's challenge-demo gate. A completed badge or successful click path is insufficient: the downloaded artifact must be independently parsed.
- Revisited OpenPencil's real Playwright export suite and visual-oracle tests. The relevant pattern is to force an observable download path, wait for the browser download event together with the user action, inspect the saved result, and keep deterministic failure evidence rather than inferring export success from UI state.
- Traced the current Studio journey end to end: canonical UI commands, renderer-safe library assets, page/output mutations, WebMCP proposal registration, human Review decisions, immutable server-derived publication, API Playground render history, owned artifact download route, Renderer Worker PDF production, D1 job/output records, and R2 retrieval.
- Confirmed the clean test can use a new browser context/workspace and clear the local draft without sharing a prior template version or render job. The starter contains one bound `quotation_title` field and a six-page quotation output; adding one canonical page makes the published PDF expectation seven pages.

Bounded implementation contract:

1. Run one serially observable user journey in a fresh browser/workspace: canvas edit, approved library image insertion, page creation, WebMCP field proposal, human Review accept/apply, immutable publish, API Playground PDF render, artifact download, then draft Undo.
2. Assert every boundary, not only the final screen: inspect WebMCP state after edit/image/page, preview state before apply, applied field revision, server-derived published manifest, completed render history, and unchanged published artifact after Undo.
3. Capture the real download response through the owned route. Assert `application/pdf`, nonzero and metadata-consistent bytes, a PDF signature, seven parsed pages, and recognizable API-modified quotation text from the document fixture.
4. Use a real PDF parser in the test process; do not rely on regex page counting or UI-reported metadata. Attach the PDF and a journey screenshot to the Playwright result, and retain screenshots/traces on failure.
5. Keep the test deterministic and isolated. Do not depend on a prior localStorage draft, version number, D1 workspace, render history record, filename UUID, or timing sleep.
6. Run the focused journey, the complete browser suite, and the repository check before marking E2E-01 complete.

Completion evidence:

- Added one deterministic Playwright journey that creates a new demo workspace, clears every Studio draft/version key, waits for the real Fabric editor to hydrate, and then exercises the exact challenge story through shipped UI and registered WebMCP tools.
- The journey adds text, inserts the original renderer-safe `Olive botanical` asset, creates page seven through the canonical Pages panel, proposes `quotation_title` through WebMCP, proves the proposal is non-mutating, accepts/applies it in Review, publishes version 1, and verifies the server-derived manifest has one parameter and seven pages.
- API Playground changes the published parameter to `E2E Rendered Wedding Story` and requests the quotation PDF. The test captures the real `POST /v1/studio/render` response, waits for completed history, follows the owned download route, and captures the browser download event.
- `pdfjs-dist` parses the downloaded bytes in the test process. The test requires `application/pdf`, API byte-count equality, a `%PDF-` signature, exactly seven parsed pages, the complete API-modified title after whitespace normalization, and `NORTHSTAR STUDIO` fixture text.
- The retained proof artifact is a tagged PDF 1.4 file with seven pages and 308,717 bytes. The Playwright result also attaches a full-page journey screenshot and the downloaded PDF; configuration retains screenshots and traces on failure.
- Undo runs after artifact verification and restores the pre-review field value and revision. This proves the live draft remains reversible while the immutable published/rendered artifact is unaffected.
- The browser suite initially exposed a pre-hydration gesture-test oracle: it clicked server-rendered Fit at 34% before Fabric mounted, then mistook the correct hydrated 32% fit for wheel zoom. All gesture tests now wait for `canvas.upper-canvas`; the ordinary-wheel test passes without weakening its zoom/transform assertions.
- Focused E2E-01 passes in 11.8 seconds. The complete browser suite passes all 14 tests, including the nine-width responsive matrix, compact dialog accessibility, command/review safety, page/output invariants, validation boundaries, gestures, and the real render journey.
- `bun run check` passes: lint, all package typechecks, 95 unit/integration tests, every production Worker/client/server build, and `git diff --check`.
- A deployed smoke run is not claimed without a deployed challenge URL and credentials. The same journey is the deployment gate once that environment exists; no production deployment was performed implicitly during this local implementation phase.

## Next editor slice after E2E-01

The demo-critical local gate is now credible. Continue with the editor-foundation beta sequence before catalog breadth: revision/transaction identity (`REV-01`), coherent gesture/inspector undo history (`HIST-01`), and explicit navigation/focus scope (`NAV-01`). Revisit their audit evidence and OpenPencil engine/transaction patterns before implementation.

## 2026-08-27 — Typed, truthful inspector controls (INSPECT-01)

Status: **completed locally**

Phase-entry evidence:

- Reread INSPECT-01, the Inspector parity row, the architecture finding for the monolithic inspector, and the transaction evidence from HIST-01. The live defect is not cosmetic: a rejected `-1` width remains in the input while the canonical node keeps its previous width, locked layers expose controls that appear editable, and multiple selection has no explicit mixed-value representation.
- Traced the actual mutation path from both desktop and compact `InspectorSidebar` instances through `StudioShell`, `useDocumentEditor`, history, canonical `update_node`, and the strict document patch schema. Both responsive surfaces share the component, but local input parsing currently sits above canonical validation and can diverge from it without feedback.
- Revisited OpenPencil's selection-capability projection, `PositionControlsRoot`, `VariableNumberField`, and number-field E2E coverage. The governing patterns are one selection-derived model shared by visible sections and command enablement; a first-class mixed sentinel; separate draft/update/commit behavior; invalid and Escape restoration; and one transaction per continuous gesture.
- Rechecked the installed shadcn Field, Input, Slider, and Toggle Group primitives and current official usage. The existing system already supports semantic labels, `data-invalid`, `aria-invalid`, inline `FieldError`, disabled styling, and a slider commit boundary; the inspector should compose those primitives instead of recreating inaccessible form semantics.

Bounded implementation contract:

1. Add a pure typed inspector model in `@webmcp/editor` that derives single/multiple mode, editable/locked counts, all/some locked state, common node capabilities, and explicit same/mixed values for base geometry, opacity, visibility, and lock state.
2. Replace permissive numeric parsing with a reusable draft parser that supports absolute and simple relative values, rejects non-finite/out-of-range input with a stable visible message, exposes `aria-invalid`, preserves the canonical value, and restores it on Escape. Never leave an invalid draft looking applied.
3. Disable every property mutation for a locked single layer while retaining the explicit visibility and unlock actions. For mixed lock selections, state that locked layers are skipped; shared property commits update all editable selected layers atomically in one history entry.
4. Give multi-selection real shared geometry and opacity controls. Equal values render normally; unequal values render an explicit `Mixed` placeholder/label. A committed shared value replaces the property only on editable selected layers through one canonical batch.
5. Derive type-specific sections from capabilities rather than scattered node-type conditionals, keep native color changes as one committed action, and retain one-commit slider behavior. Pending Review keeps Design/Fields unavailable and cannot invoke hidden mutations.
6. Use the same model and controls in desktop and compact surfaces. Add pure fixtures plus browser coverage for invalid/recovery, locked, mixed, mixed-lock, review, and continuous-control transaction boundaries, then personally inspect representative quotation layers at desktop and compact widths before completion.

Completion evidence:

- Added `@webmcp/editor/inspector`, a pure selection projection that owns none/single/multiple mode, editable and locked counts, all/some locked state, common node capabilities, and explicit `empty` / `value` / `mixed` values for base properties. Typed fixtures prove empty, single-type, mixed-type, mixed-value, and mixed-lock behavior.
- Extracted the inspector's reusable input controls from the monolithic sidebar. Numeric controls now compose the design-system Field/Input/Error primitives, have stable labels, show `Mixed` explicitly, support absolute plus `+`, `*`, and `/` relative entry, validate against the canonical property bounds, expose `aria-invalid`, and render the exact error without mutating the document.
- Escape restores the canonical draft and cancels the following blur. The first focused browser run caught a stale-draft blur that reintroduced the error after Escape; the cancellation boundary was fixed rather than weakening the test. The next browser run caught Enter plus blur producing two commits; successful Enter now owns one commit and suppresses the redundant blur transaction.
- A locked single layer now disables identity, geometry, opacity, text, typography, color, shape, crop, source, and image-replacement controls. Visibility and unlock remain available, with an explicit explanation of why the rest of the panel is disabled.
- Multi-selection now exposes shared X, Y, width, height, rotation, and opacity. Equal values render normally; unequal values render a real `Mixed` placeholder. Mixed-lock selections state the exact skipped count, batch one canonical update over editable nodes only, and create one history entry; fully locked selections explain the required unlock and disable property/arrange/delete actions.
- Type-specific sections are projected through the shared capability model. Text, fill, stroke, corner-radius, and image sections remain narrowed to their valid document node types. Color text entry has visible hex validation and Escape recovery; the native color picker has one change/commit boundary. Existing opacity/crop sliders retain local gesture preview and one canonical commit on release.
- Three dedicated browser tests prove invalid width feedback and canonical non-mutation, Escape recovery, relative entry, locked single controls, explicit mixed selection, mixed-lock partial updates, one operation-version increment, one-step Undo, and the identical contract in the compact Properties sheet. The pre-existing pending-review and slider-gesture suites continue to prove mutation lockout and one-gesture/one-transaction behavior.
- Manual verification used the live six-page quotation rather than only the E2E fixture. `Quotation title` correctly reports its locked state and disables width, opacity, content, typography, and color controls; selecting it with `Prepared for` reports a fully locked selection and a real mixed width.
- `bun run check` passes lint, every typecheck, all 126 unit/integration tests, and every production Worker/client/server build. The complete browser suite passes 27/27 in 2.1 minutes. `git diff --check` is clean. The existing production chunk-size warning remains unchanged and is not hidden by this phase.

## 2026-08-27 — Versioned template catalog and explicit use semantics (TEMPLATE-01)

Status: **complete — routed browser acceptance and independent review pass**

Phase-entry evidence:

- Reread TEMPLATE-01, WF-02, the Templates and First-run parity rows, the reference adopt/avoid matrix, and the Stuwiz quotation-composition contract. The current tab is mislabeled: it renders three synthetic palette cards, is disabled for a general document, and immediately recomposes the linked quotation without explaining which manual edits will be replaced.
- Traced the current Studio paths. The sidebar owns a quotation-only list; `selectQuotationTemplate` calls `composeQuotationDocument`, replaces the complete document, and retains only one undo snapshot; blank creation clears the quotation source; the existing `/v1/studio/templates` route is an API publication-version repository and must not be overloaded with design-starter catalog semantics.
- Revisited the local Canva clone's dashboard and editor template flows. Its useful distinction is default create-a-new-project versus a separately confirmed replace-current action, plus dimensions, real thumbnail metadata, loading, failure, and empty states. Its raw Fabric `loadJson` and owner-light repository are not suitable canonical boundaries for Studio.
- Revisited Polotno's paged template panel. The useful pattern is a replaceable catalog data source with progressive loading and preview assets; raw `store.loadJSON` remains explicitly rejected because it bypasses validation, impact explanation, source transitions, and canonical history.
- Rechecked `@webmcp/render-view`'s `Artboard`, already shared by page/output thumbnails. The first implementation can render a catalog entry's immutable first page through the same document renderer, giving truthful previews immediately. PERF-01 will later replace repeated live artboards with cached raster previews without changing repository or catalog contracts.

Bounded implementation contract:

1. Introduce a strict immutable design-template union distinct from published API template versions: `document_starter` owns a validated canonical document snapshot; `quotation_style` owns a versioned visual policy/composer identity and materializes against a supplied Stuwiz quotation snapshot. Common metadata includes stable ID/version, name, description, category/tags, compatibility, dimensions/page count, source/license, and preview page identity.
2. Add a queryable repository boundary with list/search/category/get/materialize operations, defensive immutable results, aggregate document validation, deterministic ordering, and stable malformed/not-found/incompatible errors. Do not make React, Fabric, or the sidebar the data store.
3. Replace synthetic bars with real first-page previews rendered from each materialized canonical document. Keep preview sizing aspect-correct, alt/name metadata explicit, and the renderer boundary replaceable by cached PNG artifacts later.
4. Build one searchable, categorized catalog for both desktop and compact sidebars with skeleton/loading, error/retry, empty/no-results, selection/details, dimensions/pages, and compatibility states. General document starters remain available without quotation source data; quotation styles explain when a linked source is required.
5. Make `Create new from template` the primary action. It creates a fresh document identity and fresh internal IDs from an immutable template snapshot; general starters clear linked quotation state, while quotation styles retain the exact supplied source revision and record their catalog version.
6. Keep `Apply to this design` secondary and explicit. Before mutation, show a computed impact summary for pages, outputs, nodes, fields, bindings, assets, and linked-source state. Require confirmation, reject incompatible use, commit one named replace transaction, preserve a valid active page/selection when possible, and make one Undo restore the exact previous document and source context.
7. Treat linked quotation visual policy and general starter replacement as different operations even when they share catalog UI. A quotation restyle must retain source-backed content, manual content/layout changes, stable structure, and custom paints while mapping only known palette tokens; a general replacement must say when it disconnects Stuwiz data.
8. Prove schema/repository immutability, query ordering, aggregate rejection, ID remapping, source transitions, impact calculation, one-step undo, loading/error/empty/retry, real preview content, default-create versus confirmed-apply, quotation/general compatibility, pending-review lockout, and desktop/compact parity before completion.

Resumption evidence:

- The independent-review P1/P2 blockers that interrupted this slice now have local implementations and focused verification recorded below. Deployment-only gates remain explicit and do not require the editor product path to stay paused.
- Re-read the catalog contract, the typed repository and built-in definitions, the existing quotation-only sidebar, the shared `Artboard` renderer, and the available design-system primitives before resuming. The visible defect is confirmed: the current Templates tab still renders three synthetic quotation palette cards and exposes no document-starter lifecycle despite the repository already containing both template kinds.
- Work is split at a stable boundary: the catalog surface owns preview, query, category, compatibility, loading/error/empty states, details, and confirmation UI; the editor lifecycle owns materialization, fresh identity, linked-source transitions, canonical history, pending-review admission, and desktop/compact integration.
- The standalone `TemplateCatalogPanel` surface is complete behind that boundary. It renders immutable first pages through the shared `Artboard`, keeps their aspect ratio inside the sidebar, and owns search, category filtering, selected details, dimensions/page/source/license metadata, active and compatibility states, source-required explanation, design-system skeletons, error/retry, empty/no-results, and pending-review mutation lockout.
- `Create new` is the primary catalog action. `Apply to this design` is secondary: general document starters open an accessible impact confirmation covering pages, outputs, objects, groups, fields, bindings, image assets, and quotation-source disconnection; quotation styles bypass destructive confirmation and explicitly describe the non-destructive, source-backed restyle contract. Lifecycle callbacks remain outside React catalog state.
- Focused model and server-rendered component coverage proves metadata filtering/order preservation, category projection, quotation compatibility, aspect-correct renderer preview sizing, identity/active matching, dimensions, every impact row, real `Artboard` page content, catalog metadata, recoverable loading/error states, and mutation-disabled quotation/review states. Eight focused tests pass; Studio and shared UI typechecks/lints pass; scoped `git diff --check` is clean. Hook/shell integration and browser proof remain pending, and no Vite/Playwright process was started while the host browser/workerd condition is unresolved.
- Hook and shell integration now replace the old quotation-only synthetic cards on both desktop and compact surfaces. The catalog consumes the typed repository state directly, defaults details to the active catalog version, and exposes the same search, preview, compatibility, create, and apply contract in both layouts.
- The lifecycle boundary now distinguishes a fresh-document create from a current-document apply. Create materializes a new document identity and new relational IDs and starts a fresh history. General apply retains the current document identity/name/creation time, materializes fresh internals, increments revision, computes every destructive impact dimension before confirmation, and commits one named replacement. Quotation apply uses the non-destructive palette-token mapper and preserves pages, nodes, groups, fields, bindings, outputs, manual content/layout edits, selection, and valid active page.
- A versioned template/source context travels with every history snapshot. It records catalog ID/version and the exact quotation payload revision, clears both for a general starter, restores both on Undo/Redo, and reports local-storage failure without rolling back an already committed document mutation or falsely saying nothing changed.
- Focused lifecycle tests prove fresh identity, current-identity apply, source disconnection, exact impact, non-destructive quotation restyle, catalog-version transitions, and incompatible source rejection. The Studio suite now passes 41 tests; Studio and UI typecheck/lint and repository whitespace checks pass. A dedicated browser specification covers real previews, search, confirmed replacement, exact identity/source transitions, one-step source-aware Undo, fresh create with no inherited Undo, and compact parity. That specification and the updated quotation-preservation browser test are written but intentionally unrun until the stuck host is recovered.

Browser closure:

- Re-ran the retained template boundary on the healthy Studio host at port 3001. The old specifications failed immediately because they still removed retired localStorage keys and expected `/` to open the editor. The product now truthfully opens the document library/start surface, migrates into the versioned IndexedDB repository, and edits only on canonical `/documents/:documentId` routes.
- Migrated the acceptance contract to enter through **Open sample**, assert the exact routed document identity, and read durable `draft-body` records. The browser now proves five renderer-derived previews, search filtering, explicit 6 → 1 impact, quotation disconnection, current-document identity preservation, durable template/source metadata, one-step source-aware Undo, a fresh remapped identity and route, retained prior record, empty new-session history, and compact quotation-style compatibility.
- Updated the quotation-restyle journey to use the current text-preset/direct-edit workflow and durable repository reads. A manual text node and added seventh page survive the Midnight Film style change; only visual keys change; revision increments once; one Undo restores the exact prior document and source context.
- Independent review rejected the first browser candidate because it encoded the obsolete single-draft replacement warning for a multi-document create. The repaired coordinator now settles and flushes the current durable document, creates a distinct record, and navigates without destructive confirmation. Session-only work still receives a truthful loss warning. The browser requires the original durable record to remain byte-for-byte equivalent at the IndexedDB object boundary.
- The combined production browser gate passes **3/3** with one worker. Studio typecheck, focused E2E ESLint, scoped Prettier, and `git diff --check` pass. `template-01-browser-acceptance.md` records the exercised boundary and retained limits.
- A second independent pass found that the visible creation overlay did not yet block live WebMCP proposal/publication calls during awaited flush/create work. The final mutation admission now starts synchronously, remains active through awaited route navigation, blocks ordinary editor mutations, projects no product command context, returns one stable disabled reason for WebMCP product commands, and rejects proposal, publication, and rendering before delegation. Direct proposal/publication guards close the pre-render interval.
- Deferred failure and deferred route-handoff tests plus a mounted real-tool WebMCP regression prove cleanup, full handoff coverage, live blocking without tool re-registration, and zero proposal/publication/product/render delegation while disabled. The focused transition set passes **13/13**; the routed browser contract remains **3/3**. Final independent verdict: **ACCEPT — no P0/P1**.
- Retained P2: a rejected client-side route-navigation promise can leave a non-actionable identity-loading surface after the new document has been safely persisted. This is a recovery-surface follow-up, not a data-loss blocker for TEMPLATE-01.

## 2026-08-28 — Independent-review production-blocker remediation (SEC-01)

Status: **in progress — deployment remains blocked**

Phase-entry evidence:

- Read the independent code review in full, including every confirmed defect, architectural risk, prior-claim correction, positive conclusion, coverage row, reproduction, and acceptance test. Its 11 confirmed defects supersede TEMPLATE-01 and invalidate using the green 126-test/27-browser-test suite as a release decision by itself.
- Traced both server-render entry paths. Direct draft PDF export accepts a caller document and invokes the renderer service binding; published-template render creates a disposable demo workspace for an unknown caller before materialization and rendering. Neither path has an authenticated-production mode, strong concurrent admission control, tenant budget, or storage reservation.
- Traced the renderer boundary. Request size checks trust `Content-Length`, page/node dimensions are merely positive, CSS-like values are interpolated after HTML escaping rather than CSS validation, `https://` image URLs are accepted directly, and Browser Rendering plus R2 are invoked in the same request.
- Retrieved current Cloudflare Workers, Browser Run, Rate Limiting, and Durable Objects guidance and the latest published Workers types. Cloudflare documents its Rate Limiting binding as permissive, eventually consistent, and location-scoped, so it is useful for burst shedding but not accurate resource accounting. A per-principal SQLite Durable Object is the correct coordination atom for strong concurrent reservations and budgets.
- Confirmed that the client-side PNG action does not need a server renderer, while current PDF export does. Any preview/export convenience must cross the same admission boundary as API rendering; there will be no privileged alternate route.

Bounded implementation contract:

1. Introduce one `RenderAdmission` service used by every Studio route before `env.RENDERER.fetch`. Its input is a server-derived principal plus a validated render plan; callers cannot supply workspace, quota, pixel, page, or storage-accounting values.
2. Default deployed access closed. Localhost may use the documented demo principal for development. A deployed caller must present a configured, verifiable principal; missing production authentication must fail closed before demo-workspace creation, D1 mutation, Browser Rendering, or R2 access.
3. Use one SQLite Durable Object per principal to atomically reserve request count, rendered pages, total pixel area, estimated storage, and a concurrent slot. Persist reservations before renderer RPC, finalize actual bytes after success, and release/record failure on every error path. Reject over-budget and over-concurrency requests with stable 429/402-style product errors before renderer or R2 calls.
4. Add strict render-policy validation at the document boundary: finite bounded page/node geometry, bounded page/output/node counts and aggregate pixel area, bounded text/path data, renderer-managed font families, and CSS-safe color/font values. Treat HTML escaping and CSS safety as separate concerns.
5. Remove arbitrary renderer-side network authority. Published render documents may reference only versioned application asset identifiers or approved first-party/data resources; remote `https://` media must be ingested through a separately reviewed proxy that resolves DNS, validates every redirect and IP class, caps bytes/MIME/decode, and produces a managed asset. A raw URL or CSS `url(...)` token must fail before Browser Rendering.
6. Make the private Renderer Worker accept only the normalized internal render envelope, revalidate the same hard limits defensively, and never accept user-controlled budget identity. Direct public access remains disabled; health does not confer render authority.
7. Parse request bodies with a byte-capped reader independent of `Content-Length`, returning stable 400/411/413 errors for malformed, empty, truncated, invalid-length, and headerless oversized bodies. No rejection may touch D1, the admission object, renderer binding, Browser Rendering, or R2.
8. Add unit/integration tests with fakes that prove invocation order and zero downstream calls for unauthorized, malformed, over-page, over-node, over-pixel, unsafe CSS, unmanaged image, budget-exhausted, and concurrent requests. Add deployed-Worker tests for actual Durable Object serialization and service/R2 non-invocation before calling SEC-01 complete.
9. Reconcile configuration and generated Worker types after adding bindings/migrations. Keep observability structured and avoid secrets in Wrangler source. Run focused adversarial tests, all repository checks, full browser coverage, and a second independent code review; local mocks alone cannot earn the production-security completion claim.

Current SEC-01 evidence and remaining gate:

- The shared document boundary now rejects unsafe CSS tokens, unmanaged remote images, active/nested-fetch SVG, unmanaged fonts, excessive dimensions, page/layer/group counts, text/path sizes, and aggregate pixel area. The private renderer defensively runs the same policy before Browser Run or R2.
- All JSON Worker routes use one byte-capped streaming reader. Focused live probes sent malformed bodies to export PNG, export PDF, published render, template publish, and quotation composition; all returned stable 400 responses and the local D1 workspace count remained exactly 55 before and after.
- Deployed access now defaults to verified Cloudflare Access identity. Localhost is the only automatic demo-session mode. The production token route refuses to export an unusable pseudo-token; API clients must use Access.
- One SQLite `RenderAdmission` Durable Object per principal atomically reserves concurrency, requests, pages, pixels, and estimated storage before any renderer service-binding call, then settles actual bytes or records failure. The built Worker contains the named class export, binding, and SQLite migration.
- The first live restart caught that the installed Miniflare runtime does not yet accept a 2026-08-28 compatibility date. Both Workers are pinned to the newest actually supported date, 2026-08-27; generated types were reconciled and the sole localhost:3000 Worker restarted successfully with the Durable Object namespace present.
- SEC-01 is not marked complete: a real Access application still needs its team domain/audience configured, and deployed concurrent/adversarial verification must prove Browser Run and R2 non-invocation. Those are explicit deployment gates, not reasons to block correction of the confirmed P1 editor failures.

## 2026-08-28 — Atomic semantic-group edge ordering (P1-2)

Status: **implemented with focused desktop/compact regression; full-suite reconciliation pending**

Phase-entry evidence:

- Reproduced the independent review's command-path split in code: layer-tree drag/drop emits canonical atomic `reorder_nodes`, while the inspector emitted one immediately validated `reorder_node` per descendant. The first descendant could temporarily break a semantic group's contiguous stack and throw before the remaining commands ran.
- Revisited `layerDropCommands`, the `reorder_nodes` reducer, aggregate group-contiguity validation, history transactions, the real nested layer-tree fixture, and both desktop and compact inspector surfaces. Both inspector surfaces share one callback, but both visible callers still require regression coverage.

Bounded implementation contract and evidence:

1. Resolve an exact semantic-group selection to its complete descendant block in current paint order. Never reverse descendants or move them through transient invalid states.
2. Emit exactly one `reorder_nodes` command with index zero for back or the post-removal list length for front. Detect edge no-ops before the reducer so an already-positioned block does not throw.
3. Preserve group parentage, child order, contiguity, selection, and one-step history. Locked partial selections cannot truthfully support group arrangement; disable front/back until the complete selection is unlocked and explain the distinction from property updates.
4. The focused browser regression uses a real nested group, unlocks its locked descendant explicitly, invokes front and back, asserts exact page order and operation-version increments, proves Undo/Redo, then repeats the visible action through compact Properties. It passes in 5.8 seconds without an error boundary.

## 2026-08-27 — Transaction history and snapshot identity (REV-01 / HIST-01)

Status: **core transaction and snapshot contract completed locally; live-transform cancellation and byte-budget accounting remain follow-up work**

Phase-entry evidence:

- Reread ARCH-06, ARCH-07, INT-03, the Undo/redo and transform-gesture parity rows, the REV-01/HIST-01 backlog contracts, and the interaction-test requirements. The concrete failures are reusable document revisions after undo/branch, unnamed full-document steps, selection clearing, uncoalesced nudges, and no explicit transaction metadata.
- Revisited OpenPencil's `UndoManager`, editor undo actions, position snapshots, control batching, and duplicate/undo E2E tests. Its useful pattern is small named entries with forward/inverse behavior, bounded history, rollback-capable batches, stable selection restoration, and an explicit coalescing key; continuous controls flush after a documented 300 ms idle interval.
- Traced Studio's current ownership. Fabric already emits one canonical `onNodesChange` batch only at `object:modified` or `text:editing:exited`, and Radix sliders use `onValueCommit`; those interactions already commit once. The missing foundation is in `packages/editor/src/history.ts`, the hook's generic `commit`, per-key nudge calls, unconditional selection clearing on undo/redo, and WebMCP proposals that identify only a reusable document revision.

Bounded implementation contract:

1. Replace anonymous past/future document arrays with bounded named history entries containing before/after documents, immutable before/after snapshot IDs, timestamp, label, and optional coalescing key. Keep structural sharing; never serialize binary asset bodies into an extra history log.
2. Add a session operation version that advances on every commit, undo, and redo even when the document revision rewinds. Undo/redo restores a content snapshot ID but never rewinds this concurrency token; branch-after-undo receives a new snapshot ID and clears redo.
3. Expose `snapshotId` and `operationVersion` from `inspect_design`. Every WebMCP proposal must include the inspected snapshot ID and is rejected before preview if the current snapshot differs, even when the document revision number has been reused.
4. Give transactions stable user-facing labels. Coalesce consecutive keyboard nudges for the same selection within 300 ms; a different command, selection, direction-independent target set, or elapsed window starts a new step.
5. Reconcile selection and active page after undo/redo. Keep selected IDs that still exist and remain on the selected page; clear only invalid IDs. Do not clear a valid selection merely because history moved.
6. Preserve existing one-commit Fabric and slider boundaries and prove them with browser tests. Add pure tests for labels, limits, coalescing, monotonic operation versions, branch identity, stale same-revision proposal rejection, selection survival, and redo invalidation.
7. Treat live-transform Escape rollback and delta-based memory accounting as follow-on work if the current Fabric integration cannot expose a safe begin/cancel boundary without private APIs; do not fake either acceptance criterion with a test-only hook.

Completion evidence:

- `DocumentHistory` now stores at most 100 named entries. Each entry carries the before/after documents, before/after snapshot IDs, commit time, label, and optional coalescing key. Undo and redo restore the relevant snapshot while a separate session `operationVersion` advances monotonically on every commit, undo, and redo.
- Branching after Undo clears redo and creates a new snapshot identity. Pure tests prove two different branches can share the same document revision while retaining different snapshot IDs and a monotonically increasing operation version.
- `inspect_design` returns `snapshotId` and `operationVersion`. All four WebMCP proposal tools require `baseSnapshotId`; the resulting strict `ChangeSet` retains it through proposal creation, pending review inspection, preview, and apply. A stale abandoned-branch proposal is rejected even when its numeric revision matches the current document.
- The editor commit path updates its session ref synchronously, so rapid keyboard events compose against the latest document. Consecutive nudges for the same selected IDs coalesce for 300 ms into one undo entry while each underlying operation still receives its own revision, snapshot, and operation version.
- Undo and redo reconcile selection against the restored page and nodes. Existing selected IDs survive move, style, nudge, undo, and redo; removed or cross-page IDs are discarded instead of leaving ghost selection.
- Fabric drag remains one canonical `object:modified` commit. Browser coverage drags a real Fabric text object through eight pointer-move steps and observes exactly one document revision and operation-version increment, then one Undo restores geometry and keeps the layer selected.
- The browser test exposed a real inspector defect: opacity and image-focus sliders were controlled by saved values but only handled `onValueCommit`, so the thumb could not track a gesture. `CommitPercentSlider` now maintains a local gesture draft, updates the displayed percentage and thumb continuously, and sends one canonical update on release. Slider thumbs also receive explicit accessible names.
- Browser coverage moves opacity through eight pointer steps, observes one canonical commit, and verifies one Undo restores 100% opacity with selection intact. Pure coverage verifies labels, the 100-entry bound, exact 300 ms coalescing, elapsed/selection boundaries, monotonic operation versions, branch identity, redo invalidation, and stale snapshot conflicts.
- `bun run check` passes with 101 unit/integration tests, all package typechecks and lint, and every production Worker/client/server build. The complete browser suite passes all 16 tests across history, Fabric and inspector gestures, render artifact proof, validation, page/output management, keyboard/review safety, responsive behavior, and accessibility. `git diff --check` is clean.

Explicit follow-up:

- Fabric currently reports the committed result at `object:modified`; it does not expose a public begin/cancel transaction boundary to the React adapter. Escape rollback during an in-flight transform remains open rather than being simulated with private Fabric state.
- History uses structurally shared document objects and a fixed entry-count limit. A measured byte budget and delta/inverse payload migration remain open for documents large enough that 100 retained full document roots exceed the eventual memory target.

## 2026-08-27 — Production layer navigation and hierarchy (NAV-01 / A11Y-02)

Status: **completed locally**

Phase-entry evidence:

- Reread NAV-01, A11Y-02, WF-01, the Layers parity row, the navigation test evidence, and the audit's explicit target: a virtualized ARIA tree with hierarchy, persistent expansion, range/toggle selection, rename, visibility, lock, reorder/reparent, search, scroll-to-selection, and a 1,000-layer performance gate.
- Traced the live Studio ownership. `QuotationSidebar` mounts a reversed flat array of page nodes; it has no group rows, tree keyboard model, search, row actions, rename, drag semantics, or virtualizer. Selection is bridged indirectly through `StudioShell`, while the canonical document already stores nested group membership and the editor hook already exposes group selection, rename, visibility, lock, and undoable node order operations.
- Revisited OpenPencil's production `LayerTree` root/item primitives, flattened visible-row model, inline rename, persistent-on-state lock/visibility actions, drag instructions and drop indicators, selected-ancestor expansion, scroll-to-selection, and its 5,000-row Playwright test. The governing patterns are a headless tree model, one visible-row projection shared by keyboard/selection/virtualization, explicit above/below/child drop intent, and DOM row counts bounded independently of document size.
- Rechecked Avnac's scene hierarchy and grouping tests. Its useful constraint is to make parentage and sibling order canonical operations rather than sidebar-only state; grouped descendants must survive copy, render, resize, reorder, and ungroup operations.
- Inspected the installed shadcn `radix-nova`/Geist configuration and current Input, ScrollArea, Tooltip, and Dropdown Menu primitives. The tree itself remains a purpose-built editor primitive; commodity controls keep the existing design system. TanStack Virtual is the selected headless row virtualizer, and Atlassian Pragmatic Drag and Drop's tree-item hitbox model is the interaction reference for three explicit drop outcomes.

Bounded implementation contract:

1. Add a pure layer-tree model that projects canonical page order and nested groups into stable front-to-back rows. Search preserves matching ancestors; expansion is stored per document/page; group state is derived from every descendant; range selection uses only the current visible row order.
2. Extend canonical commands for atomic multi-node reorder and node/group reparenting. Reject cross-page targets, circular group parentage, invalid memberships, and no-op moves before history commit. Dragging a group moves its complete descendant block without changing renderer semantics.
3. Replace the flat list with one virtualized ARIA `tree`/`treeitem` implementation using roving focus. Arrow keys navigate and expand/collapse; Home/End jump; Space/Enter select; Shift extends selection; platform modifier toggles; F2/Enter rename; Escape cancels; Delete, hide, lock, and order operations remain keyboard reachable and review-aware.
4. Give each row one readable hierarchy: disclosure, type icon, inline name, and persistent exceptional state. Visibility and lock actions appear on hover/focus and remain visible while active. Selected, focused, hidden, locked, dragging, and drop-target states must be visually distinct without making the panel noisy.
5. Support inline node/group rename, descendant-aware group visibility/lock, above/below reorder, child/root reparenting, explicit drop previews, contextual keyboard alternatives, search with clear/no-results states, selected-ancestor expansion, and automatic scroll-to-selection.
6. Keep one implementation across the fixed desktop panel and compact Sheet. Do not fork capability or styling. All mutations use the existing history/review gate and preserve selection when valid.
7. Prove the pure hierarchy/selection/drop calculations, canonical command invariants and Undo, ARIA roles and keyboard behavior, range/additive selection, rename cancel/commit, visibility/lock, reorder/reparent, search, scroll-to-selection, compact parity, pending-review blocking, and a 1,000-layer DOM/performance bound. Finish with real browser use and visual inspection at desktop and compact widths.

Completion evidence:

- Added a memoized headless layer model in `packages/editor/src/layer-tree.ts`. It builds indexed nested groups in canonical front-to-back paint order, derives aggregate and mixed lock/visibility states, retains matching search ancestry, flattens only expanded visible rows, implements replace/toggle/range selection, and projects above/below/inside drop transactions.
- Canonical document commands now support multi-node block reorder plus node/group reparenting. Reparent operations preserve contiguous renderer paint stacks, reject cross-page and circular targets, and prune empty leaf groups recursively while retaining structural parents that still contain child groups. Aggregate validation rejects scattered stacks, duplicate direct membership, and empty leaf groups.
- The former flat Layers list was replaced by one shared `LayerTree` used by both the desktop sidebar and compact Sheet. Desktop and compact also share the active Templates / Pages / Layers tab, so breakpoint changes do not reset information architecture. Compact search, rows, disclosure, lock, visibility, and drag controls all measure at least 44px.
- TanStack Virtual owns the bounded scroll viewport and Atlassian Pragmatic Drag and Drop supplies explicit above, below, and child intent. Pointer drag/reparent was exercised against the running app and one Undo restores membership and paint order. Keyboard alternatives support reorder, indent, outdent, rename, delete, hide, and lock.
- The planned row-roving focus model was replaced after accessibility review with the safer virtualized-tree pattern: the stable `tree` owns DOM focus and `aria-activedescendant`, while the active row is kept mounted outside the visible range. Parent rows contain owned `role="group"` relationships; every virtual row declares level, position, set size, selection, expansion, and keyboard shortcuts.
- Focus and selection are independent. Arrow/Home/End navigation cannot reach the canvas nudge handler; Space toggles; Shift extends the visible range; platform modifiers toggle; actions operate on the current selected set when the focused row participates in it. Rename Enter/Escape and deletion retain tree focus. Local tree selection no longer forces groups open, while external canvas selection expands ancestors and scrolls into view.
- Search disables misleading disclosure actions while it forces matching paths open, reports the true match count through a polite status, preserves ancestor context, and scrolls a selected filtered layer back into view when cleared. Expansion persists per document/page in session storage.
- `inspect_design` now exposes canonical `activePageGroups`, giving WebMCP and browser tests direct hierarchy evidence. A multi-command reparent/reorder produces one named history entry and one operation-version increment; one Undo restores exact order and membership.
- Pure coverage proves nested ordering, mixed group states, ARIA row metadata, search ancestry, selection models, executed drop order, cross-parent placement, one-step history, command rejection, recursive empty-group cleanup, and 1,000-layer model construction. Document tests pass 44/44, editor tests 41/41, WebMCP tests 16/16, renderer tests 11/11, and Studio unit tests 8/8.
- Eight dedicated browser tests cover hierarchy/keyboard isolation, truthful search, rename cancellation/commit/Undo, multiselect actions, aggregate group state, review blocking, real pointer reparent/Undo, compact parity, and a valid 1,000-layer document. The 1,000-layer gate requires a bounded viewport, fewer than 80 mounted rows, tail search/selection, query-clear scroll restoration, and canonical persistence.
- The complete browser suite passes all 24 tests, including gestures, the seven-page PDF journey, validation boundaries, command integrity, history gestures, page/output management, the nine-width responsive matrix, and compact focus containment.
- Final live browser inspection at 1440×900 confirmed a dense, readable hierarchy aligned with the canvas and inspector, distinct active/selected states, nested group indentation, truthful scroll ownership, and no visible shell regression. The current Vercel Web Interface Guidelines and WAI-ARIA Treeview pattern were applied to the modified surface.
- `bun run check` passes: lint, every package typecheck, 120 unit/integration tests, every production build, and `git diff --check` is clean.

### Follow-up: quotation structure must feed the tree

- Live review exposed a contract gap after NAV-01: the tree implementation was complete, but `composeQuotationDocument()` still emitted `groups: []`. The only visible nesting in the sample came from a manually created QA group, so most quotation pages still appeared as flat layer lists.
- The quotation writer now emits canonical semantic groups while it composes each page. Cover content has nested Cover layout, Cover identity, Quotation details, and Date details groups. Every continuation page groups page chrome, section headings, cards, and label/value/divider rows.
- Group IDs and memberships are deterministic, page-local, disjoint, and contiguous in paint order. The existing document validator rejects any drift.
- Saved generated quotations with the unchanged canonical page/node topology migrate to the composed hierarchy on restore. The migration only replaces legacy groups when every existing group matches a composed block, so unrelated custom grouping is left untouched.
- Browser verification confirmed three visible levels on the Cover page and grouped cards/sections throughout Overview. The canonical quotation fixture now contains 78 semantic groups across six pages instead of one flat node list.

## 2026-08-28 — Corrupt local draft recovery (independent review P1-5 / PERSIST-01)

Status: **completed locally; complete browser suite currently has two unrelated publication-identity failures**

Phase-entry evidence:

- Reread independent review P1-5, ARCH-05, the persistence backlog, the previous validation remediation claim, the complete restore/save effects in `use-document-editor.ts`, and the current validation browser tests. The previous claim that invalid relationships were "quarantined" was inaccurate: the hook only displayed an error, marked restoration complete, and allowed the 450 ms persistence effect to replace the unreadable bytes with the quotation starter.
- Confirmed three separate unsafe inputs: malformed JSON, JSON that fails the strict document schema, and schema-valid documents that fail aggregate relationship validation. The current import test covers none of their boot-time behavior.
- Rechecked the installed radix-nova Dialog and Button primitives. Recovery will be one blocking, responsive dialog shared by desktop and compact layouts. The editor cannot dismiss it or mutate the placeholder starter before choosing how to handle the unreadable draft.

Bounded implementation contract:

1. Move draft decoding into a pure, tested boundary that classifies malformed JSON, schema-invalid data, migration failures, and aggregate-invalid documents. Run migration only after strict schema validation, then run aggregate validation again; never infer or repair unknown legacy shapes.
2. Store a versioned quarantine record under a separate production key. Preserve the original string byte-for-byte in both the source draft key and the quarantine record. Reuse an existing valid quarantine record across reloads until the user explicitly resolves it.
3. Set a synchronous persistence lock before the autosave effect can schedule. While recovery is pending, do not write the in-memory starter to the draft key, even after the save debounce or subsequent renders.
4. Present a persistent recovery dialog with the stable failure reason and three explicit choices: download the original bytes, retry the current strict recovery boundary, or replace the unreadable local draft with the known-valid starter. Download and failed retry must leave both stored copies unchanged. Reset must write the starter first and only then clear quarantine/unblock autosave.
5. Add pure tests for every failure class and migration ordering. Add browser tests that seed malformed, schema-invalid, and relationship-invalid production bytes, reload, wait beyond the debounce, and assert exact source/quarantine byte preservation plus persistent recovery UI. Exercise download, failed retry, explicit reset, and compact layout against the same implementation.

Completion evidence:

- Added `draft-recovery.ts` as the only local-draft decode boundary. It classifies malformed JSON, strict-schema failure, migration failure, and aggregate relationship failure. The quotation structure migration runs only after strict schema parsing, and the aggregate validator runs on its result before the hook can trust it.
- Invalid bytes remain untouched under `webmcp-studio:northstar-document:v2` and are copied byte-for-byte into the versioned `webmcp-studio:draft-recovery:v1` record. A valid existing recovery record wins on later reloads until the user explicitly resolves it.
- The restore effect sets a synchronous persistence lock before the autosave effect runs. Canonical commits, WebMCP proposals/application, publishing, template replacement, undo, redo, blank creation, and import paths cannot mutate or publish the placeholder document while recovery is pending.
- Added one non-dismissible radix-nova recovery dialog outside the desktop/compact panel split. It names the actual safety failure, explains that autosave is stopped, downloads the original bytes, retries the same strict boundary, and performs an explicit reset. Download and failed retry give visible live feedback; failed actions preserve both copies; reset writes the valid starter before clearing quarantine and unblocking persistence.
- Six pure tests prove malformed/schema-invalid inputs never reach migration, aggregate validation runs after migration, migration errors stay contained, quarantine serialization round-trips the exact raw string, and a valid migrated document restores.
- Three Playwright tests seed malformed, schema-invalid, and schema-valid relationship-invalid strings under the production key. Every case reloads and waits 750 ms, beyond the 450 ms debounce, then compares both the source key and parsed recovery record with the exact original string. Coverage also proves download, failed retry and second reload persistence, compact access to all actions, explicit reset, quarantine removal, and six-page starter restoration.
- The first browser pass exposed that failed Retry produced no visible result. The shipped dialog now reports that the safety check still failed and that nothing changed; the test is scoped to that live status. The actual Playwright failure screenshot was visually inspected at desktop width and confirmed a centered, readable dialog, inert blurred editor, clear reason hierarchy, and distinct destructive/recovery actions.
- Focused verification passes: Studio unit tests 14/14, recovery browser tests 3/3, Studio typecheck, modified-file lint, and `git diff --check`. The complete browser suite passes 30/32, including all recovery and editor tests. Its two failures are the concurrently modified publication success flow (`clean-challenge-journey` and valid immutable manifest), recorded under the separate branch-safe publication phase; they occur after Publish and before its success dialog and do not touch local-draft recovery.

## 2026-08-28 — Lossless page and selection duplication (P1-3 / ARCH-09)

Status: **completed locally — repository-wide gate remains owned by the concurrent SEC-01 remediation**

Phase-entry evidence:

- Reread independent-review defect P1-3, ARCH-09, PAGE-01, CMD-01, the workflow audit, and the existing page/output and command tests. The three visible clone paths copy different subsets of the aggregate: page duplication copies pages/nodes/groups, selection duplicate copies nodes, and clipboard copy/paste stores nodes. Every path drops field bindings; the latter two also drop group structure.
- Traced canonical group, binding, command, validation, history, selection, and publication behavior. Groups own direct node membership and nested parentage; a selected group is represented by all descendant node IDs; field bindings point to a shared field and one node property; aggregate validation requires group stacks to stay contiguous and binding targets to be unique and type-compatible.
- Revisited OpenPencil's actual clipboard engine. It finds selected top-level roots, clones complete subtrees, snapshots the whole created graph, restores/deletes that graph as one named undo entry, and selects the cloned roots. The local Canva clone only clones Fabric display objects and therefore is not a safe model for Studio's semantic document graph.
- Confirmed the reusable domain behavior in `add_output_variant`: it appends nodes, groups, and field bindings atomically and reapplies current field values. The defect is architectural duplication of that policy, not an absent field-materialization primitive.

Bounded implementation contract:

1. Add one pure semantic-fragment capture/clone operation in `@webmcp/document`. It preserves canonical source paint order, clones nodes with fresh IDs, includes every group whose complete descendant set was selected, remaps nested group parentage, clones every selected node's binding with a fresh binding ID and the same shared field target, and supports a target page plus placement offset.
2. Make the partial-selection policy explicit: a complete selected group keeps its internal hierarchy; a selected child whose complete group was not selected becomes a top-level clone. Clipboard data is a semantic snapshot, so later source edits or deletion cannot change what gets pasted.
3. Extend canonical document commands so a selection fragment and a duplicated page append nodes/groups/bindings in one aggregate-validated command. Reject duplicate/conflicting IDs, missing fields/nodes, incompatible or duplicate binding targets, cross-page groups, invalid parentage, and incomplete page membership before committing.
4. Route page duplicate, selection duplicate, and copy/paste through the same domain operation. Page duplication uses zero offset and an exact source-page fragment; selection duplicate/paste use the editor's 24px cascade. One action creates one history entry and one Undo restores the exact prior document.
5. Prove text, image `src`, boolean `visible`, and shape `fill` bindings; nested group parentage and contiguous paint order; fresh node/group/binding IDs; field-value rematerialization after updates; page and selection one-step undo; and clipboard snapshot behavior. Update the browser regression to duplicate the bound Cover page rather than the deliberately unbound Overview page and inspect the persisted aggregate.

Completion evidence:

- Added `captureSemanticFragment` and `cloneSemanticFragment` in `@webmcp/document`. Capture freezes a semantic clipboard snapshot in canonical page order. Clone remaps node, group, and binding IDs, keeps the same shared field IDs/properties, rebuilds nested parentage on the target page, and applies an optional placement offset/name suffix.
- The partial-selection rule is now code and test, not an accident: a group is copied only when every descendant layer is selected. Complete nested groups retain their hierarchy; a selected child from an incomplete group is cloned as a top-level layer with its binding intact.
- Added the atomic `duplicate_nodes` command and extended `duplicate_page` with bindings. Both use the same aggregate append validator as `add_output_variant`; it rejects colliding IDs, invalid group references, missing/incompatible fields, and duplicate binding targets before the document revision advances. Field values are reapplied after append.
- Page duplicate, selection duplicate, and copy/paste now all call the semantic fragment operation. Duplicate and paste emit one command and one named history entry. Repeated paste snapshots the just-created semantic graph, preserving the existing 24px cascade without falling back to display-object-only clipboard state.
- Document coverage uses one nested fixture with `text`, image `src`, boolean `visible`, and rectangle `fill` bindings. It proves fresh IDs, complete manifest targets on both pages, valid group parentage, and later API field updates materializing identically on originals and clones. Clipboard tests prove later source edits cannot mutate copied content.
- Editor history coverage proves bound page duplication and bound selection duplication each create exactly one entry; one Undo restores the byte-equivalent prior document and Redo restores the complete clone.
- The PAGE-01 browser regression now duplicates the bound Cover page and inspects persisted node, group, parent, and binding references instead of duplicating unbound Overview and checking only its name. A dedicated browser test duplicates and copy/pastes the real nested Cover layout, verifies one revision, fresh graph relationships and bindings, then verifies one Undo returns the exact persisted baseline.
- Focused verification passes: 23 document command/clone tests, 9 editor history tests, all three affected package typechecks, and 4 page/semantic browser tests. `semantic-duplication.spec.ts` passes its real group duplicate plus copy/paste journey in 9.7 seconds.

Repository gate note at handoff:

- The full document run reaches 57 passing tests and two SEC-01-adjacent failures in `publishing.test.ts`; both expect the pre-policy error copy while the concurrent render-policy work now rejects earlier with stricter managed-image/font messages. `git diff --check` also reports whitespace in the concurrently generated `apps/studio/worker-configuration.d.ts`. Neither failure touches semantic cloning, but the root task must reconcile them before claiming the whole repository green.

## 2026-08-28 — Branch-safe publication identity (independent review P1-1 / REV-02)

Status: **completed locally — migration 0004 must be applied to every deployed D1 database before rollout**

Phase-entry evidence:

- Reread independent-review defect P1-1, the REV-01 history contract, VALID-01 publication boundary, the complete history implementation, client publish hook/dialog, D1 template repository, all three migrations, and current publication/history tests. History correctly gives abandoned branches distinct session snapshot IDs, but the client still deduplicates on `sourceRevision`, and D1 still keys `document_revisions` by `(document_id, revision)` with `INSERT OR IGNORE`.
- Confirmed the failure spans three boundaries. The browser can return branch A without contacting the server when branch B reuses its revision. `template_versions` cannot record a stable content identity. `document_revisions` silently retains A when B has the same numeric revision.
- Retrieved the current Cloudflare Workers best-practices page and `@cloudflare/workers-types@5.20260827.1`. The implementation will use Web Crypto SHA-256 over a canonical validated document encoding, direct D1 bindings, awaited I/O, workspace-scoped queries, and no request state in module globals.

Bounded implementation contract:

1. Add one canonical document-content identity function in `@webmcp/document`. Validate and canonicalize the full immutable document, hash it with SHA-256, and use the resulting ID in every published version. The public request cannot claim this value; the server derives it again immediately before persistence.
2. Replace client revision-only publication checks with content identity checks. A repeated publish of byte-equivalent canonical content is idempotent; a different branch at the same numeric revision must request and receive a new immutable version.
3. Persist the content identity on `template_versions`. Make `(template_id, source_snapshot_id)` unique so retries and concurrent exact-content publishes converge on one version.
4. Rebuild `document_revisions` so `(document_id, snapshot_id)` is the primary identity and revision is indexed metadata. Store both same-revision branches, never `INSERT OR IGNORE` one branch because its revision number was reused.
5. Expose a workspace-scoped audit lookup by document ID plus snapshot ID. Both source snapshots must remain independently addressable and return the exact canonical document stored at publication time.
6. Add focused domain and browser regressions for publish A, Undo, branch B at the same revision, publish B, exact-B retry, immutable version reads, and direct audit reads. Inspect returned IDs, revisions, documents, and node geometry across every boundary before calling the defect fixed.

Completion evidence:

- `deriveDocumentSnapshotId` validates and canonicalizes the complete document, follows JSON's optional-value encoding rules, and hashes the result through Web Crypto SHA-256. `TemplateVersion` now carries that identity. The public publish request still cannot supply it; `createTemplateVersionFromPublishRequest` derives it inside the trusted server boundary.
- The editor computes the same content identity for local comparison and no longer treats matching revision numbers as a published state. Publish responses are parsed as authoritative template versions. The dialog and top-bar status compare snapshot identity, so a same-revision branch correctly offers the next immutable version.
- Existing local published-version records from before this change are upgraded in place by deriving their missing snapshot identity from their validated immutable document. Invalid records fail visibly instead of being silently accepted under a caller-supplied identity.
- D1 migration 0004 rebuilds `document_revisions` with `(document_id, snapshot_id)` as its primary key and adds a revision lookup index. `template_versions.source_snapshot_id` has a per-template unique index. The repository checks exact content before requested version, so a retry converges on the existing immutable version while a different same-revision document receives the next version.
- Added a workspace-scoped audit read at `GET /v1/studio/documents/:documentId/revisions/:sourceSnapshotId`. Immutable-template reads now expose `versionId`, `sourceSnapshotId`, and the stored canonical document so clients can verify the version-to-audit relationship.
- The focused browser regression performs the reported sequence against the actual UI and local D1: add and move a layer, publish A, Undo, create B at the same revision, publish B, retry B as proposed version 3, read immutable versions 1 and 2, and read both audit snapshots. It checks distinct hashes and geometry, equal numeric revisions, and status `200` idempotence returning version 2. The test passes in 8.3 seconds.
- Direct post-test D1 inspection found two rows for document revision 6, two distinct `document_json` values, and two SHA-256 snapshot IDs. The associated template has exactly two immutable versions, two snapshot identities, and both versions report revision 6. This is the cross-boundary evidence the earlier REV-01 claim lacked.
- Focused domain identity tests pass 2/2. Document, Studio, and WebMCP typechecks pass. The existing valid-publish boundary test passes after the new contract. Modified-file diff checking is clean.

Deployment gate:

- Migration 0004 was applied and inspected only against the local Wrangler D1 state. Do not deploy code that reads `source_snapshot_id` before the matching migration succeeds in staging and production. Remote migration execution is intentionally not part of this local remediation task.

## 2026-08-28 — Deterministic renderer resource readiness (independent review P1-6 / RENDER-02)

Status: **completed locally — deployed Browser Rendering and editor/export visual parity remain release gates**

Phase-entry evidence:

- Reread independent-review defect P1-6 and traced `apps/renderer/src/html.ts`, both Browser Rendering paths in `apps/renderer/src/index.ts`, renderer HTML/Worker tests, and the installed Cloudflare Playwright PDF API before editing.
- Confirmed the working-tree defect: the only supported font is fetched from jsDelivr at render time, `document.fonts.ready` is treated as success even if the managed face failed, image nodes have no decode/error barrier, and both artifact paths can persist output without proving their required resources rendered.
- Revisited Cloudflare Browser Rendering custom-font guidance and Wrangler module behavior. The implementation will use a versioned first-party font payload, not runtime network access, while keeping Browser Rendering behind the existing private service binding.

Bounded implementation contract:

1. Renderer HTML must perform zero remote font requests and must identify one exact managed Geist face.
2. Readiness is one terminal state: `ready` only after `document.fonts.ready`, an exact `document.fonts.check`, and successful decode plus `complete && naturalWidth > 0` for every rendered image; otherwise `error` with a stable code.
3. PNG and PDF must share the same resource gate. An error or timeout returns a stable renderer response before screenshot/PDF creation or R2 write.
4. Tests must prove font self-containment, image gating, resource-error short-circuiting, and the successful artifact path. Focused tests, typecheck, dry-run Worker build, and no-R2-on-resource-failure evidence are required before local completion; deployed Browser Rendering and editor/export visual-parity fixtures remain separate closure evidence.

Completion evidence:

- Renderer HTML embeds the pinned `@fontsource-variable/geist@5.3.0` OFL-1.1 Latin WOFF2 as a build-system-independent `data:font/woff2` payload with its source SHA-256 recorded beside the bytes. An initial Wrangler Data-module implementation passed the standalone build but the wider gate exposed that Vite ignores auxiliary-worker `rules` and emitted a URL instead; that implementation was removed rather than accepted. Both the standalone Wrangler artifact and Studio's Vite-built auxiliary Renderer now contain exactly 39,200 base64 characters / 29,400 decoded bytes with SHA-256 `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1`, and neither render path depends on a runtime font URL.
- One executable readiness state machine owns both the generated script and its pure tests. It waits for `document.fonts.ready`, requires `document.fonts.check` plus an exact loaded `Geist Variable` face, awaits every image's `decode()`, and verifies `complete && naturalWidth > 0`. It sets either `data-render-ready="true"` or a stable `managed_font_failed`, `image_decode_failed`, or `resource_readiness_failed` terminal error with the failing node ID when available.
- PNG and PDF now use the same Playwright page gate. PDF no longer uses the opaque QuickAction path: the Worker inspects readiness, calls `page.pdf()` only on success, materializes a sized Blob, then writes R2. Resource failure and timeout return `422 render_resource_failed` before screenshot/PDF generation or R2.
- Focused renderer evidence passes: 18/18 tests, including direct state-machine success/font/corrupt-image cases, PDF image-failure short-circuit, PNG timeout short-circuit, valid sized-PDF storage, malformed/unsafe request rejection, and artifact-body bounds. Renderer typecheck and Wrangler dry-run production build pass; modified renderer/audit diff checking is clean.
- This closes the local defect, not the production release gate. A deployed Browser Rendering run must still exercise valid and corrupt inline images plus the embedded face, and representative editor/export screenshots must pass geometry/pixel comparison before production promotion.

## 2026-08-28 — Canvas-scoped gesture ownership (independent review P2-3 / A11Y-03)

Status: **completed locally — browser magnification is preserved outside the canvas**

Phase-entry evidence:

- Reread independent-review defect P2-3, the interaction audit's explicit viewport-ownership target, the feature-parity gesture row, the complete local gesture hook/unit/browser tests, and the relevant Studio shell ownership.
- Revisited OpenPencil commit `88c107707132`, specifically `packages/vue/src/shared/input/wheel.ts`, `gesture.ts`, and `canvas/useCanvasInput.ts`. Wheel and Safari gesture cancellation are attached only to the canvas ref; there is no document-wide modifier-wheel blocker.
- Confirmed the local defect and its false-positive test: Studio already attaches a non-passive wheel listener to `workspaceRef`, then redundantly attaches a second listener to `document` which prevents every Ctrl/Meta wheel over toolbars, sidebars, fields, and dialogs. The existing outside-canvas E2E asserts that inaccessible behavior as correct.

Bounded implementation contract:

1. The canvas viewport alone owns wheel pan, Ctrl/Meta-wheel zoom, and Safari gesture cancellation. No document/window listener may cancel browser zoom.
2. Modifier wheel over the canvas remains cursor-anchored editor zoom and is `defaultPrevented`; the same cancelable events over a sidebar control and open dialog remain unprevented and do not change the editor camera.
3. Cover Ctrl and Meta event shapes, retain ordinary two-dimensional pan/Shift behavior, and run focused unit plus real-browser regressions before local completion.

Completion evidence:

- Removed the document-wide non-passive wheel listener. The canvas workspace remains the sole owner of wheel pan, Ctrl/Meta zoom, and Safari gesture cancellation, matching the scoped OpenPencil input pattern.
- The first browser run exposed a second independent cancellation path: Radix Dialog's modal scroll lock permits Ctrl-wheel pinch zoom but classifies Meta-wheel as ordinary scrolling and cancels it at the document boundary. The shared `DialogContent` now stops only unhandled Ctrl/Meta wheel propagation after consumer capture handlers run, preserving browser magnification while leaving ordinary modal scroll isolation intact.
- Replaced the backwards outside-canvas regression with an explicit ownership contract. Cancelable Ctrl and Meta wheel events are both `defaultPrevented` over the canvas, both remain unprevented over the Templates sidebar and an open New Document dialog, and neither outside surface changes the editor camera. The existing real mouse Control-wheel and ordinary two-dimensional pan tests remain green.
- Focused evidence passes: 4/4 gesture unit tests, 3/3 Playwright gesture tests, and Studio typecheck. The browser test failed once on the dialog Meta path before the shared dialog fix, demonstrating that the final assertion is sensitive to the actual defect rather than only the removed hook code.

## 2026-08-28 — Render selection parity and artifact identity (independent review P2-2 / API-02)

Status: **implemented and storage-verified locally — focused browser contract is pending host Worker recovery**

Phase-entry evidence:

- Reread independent-review defect P2-2, the current HTTP render route, WebMCP render-selection parser/tests, render job/output migrations, owned artifact reads, API Playground adapter, and the successful publication/render journey.
- Confirmed one part was already repaired during SEC-01: the HTTP Zod boundary now rejects repeated `(outputId, format)` pairs before principal resolution, D1, admission, or renderer invocation, matching WebMCP's `seen`-set rule. The independent review's required storage invariant is still absent.
- Traced artifact identity: PDF is one `(job, output, null page, format)` row; PNG is one `(job, output, page, format)` row. Because SQLite unique indexes treat nulls as distinct, a plain four-column unique index would not protect duplicate PDFs; the migration must normalize null page identity explicitly.

Bounded implementation contract:

1. Add a D1 uniqueness constraint on `(render_job_id, output_id, coalesced page_id, format)` so route bugs, retries, or future adapters cannot create two records for one artifact identity.
2. Prove duplicate HTTP selection rejection happens before job insert, admission, renderer, and artifact insert; prove the equivalent UI/API and WebMCP adapters accept the same valid set and reject the same duplicate set.
3. Apply the migration to a representative local database, verify existing rows have no conflicts, and run route/browser plus WebMCP regressions before local completion.

Implementation evidence:

- The HTTP render request schema rejects a repeated `(outputId, format)` pair through a cross-item refinement before principal resolution, D1 admission, Browser Rendering, or artifact persistence. Malformed input returns the stable `400 invalid_render_request` envelope rather than entering the render workflow.
- WebMCP uses the same identity rule and now has a focused duplicate-selection regression. Its complete focused suite passes 17/17 with typecheck green.
- Added local migration 0005 with a unique expression index on `(render_job_id, output_id, COALESCE(page_id, ''), format)`. Normalizing nullable `page_id` is required because SQLite otherwise permits repeated PDF rows whose page identity is null.
- Before applying 0005, the representative local database had no conflicting artifact identities. After applying it locally, direct inspection found the index and 17 existing PDF rows; a transactional duplicate-PDF `INSERT OR IGNORE` reported zero changes, and rollback left no probe rows. No remote database was changed.
- Added `render-selection-boundary.spec.ts`. It snapshots owned render history, submits a repeated HTTP selection, expects `400 invalid_render_request`, then requires byte-equivalent history afterward. Its execution is pending the same host-level orphaned Worker recovery as the other new browser contracts; this phase is not marked browser-complete.

## 2026-08-28 — Truthful starter metadata (independent review P3-1 / WF-03)

Status: **implemented and unit-verified — browser contract is pending host Worker recovery**

Phase-entry evidence:

- Reread independent-review defect P3-1, WF-02/WF-03, the responsive dialog evidence, and the mandatory remediation protocol. The dialog still claims five proposal pages plus WhatsApp and follow-up outputs; both ordinary reset and corrupt-draft recovery restore the current six-page quotation composer result with one `Quotation` output.
- Traced the complete reset boundary in `use-document-editor.ts`: initialization, legacy quotation-group migration, draft recovery, ordinary demo reset, active page selection, quotation source, and default quotation template all depend on a private `quotationSeed`. The dialog owns unrelated hard-coded marketing copy and receives no metadata from that reset object.
- Revisited the local Canva clone's template creation path and react-design-editor's pure summary models. The useful pattern is one typed template/document record whose immutable JSON and dimensions create the project, with display summaries derived in a pure model. OpenPencil does not provide a more relevant starter metadata boundary for this defect.

Bounded implementation contract:

1. Create one typed quotation-starter source that owns the composed document, source payload, default visual template, and metadata derived from that exact document aggregate.
2. Derive document name, total pages, output count, each output name/page count/export formats, field count, and binding count. Do not store those values as parallel prose.
3. Make editor initialization, quotation-structure migration, corrupt-draft reset, and ordinary reset consume the same starter source. Make the new-document dialog render only its derived metadata.
4. Add pure tests that derive truthful metadata from the current composer and from an expanded source that changes pagination. Add a browser contract that reads the dialog's claims, resets, then compares those claims with the exact persisted restored aggregate.
5. Run focused unit/browser tests, Studio and document typechecks, modified-file lint, and whitespace checks. Repository-wide completion remains a separate gate while concurrent remediation is active.

Implementation evidence:

- Added `quotation-starter.ts` as the single typed source for the composed starter document, the exact Stuwiz fixture payload, the default quotation template, and metadata derived from that same aggregate. Metadata contains the document identity/name, total page and output counts, every output's ID/name/kind/page count/export formats, and field/binding counts.
- Editor initialization, corrupt-draft recovery reset, and ordinary demo reset now consume `quotationStarter`. The former private `quotationSeed`, duplicated default-template constant, and direct fixture use were removed from the hook. The temporary quotation-group restore heuristic was subsequently removed entirely under PERSIST-02 because current-schema user grouping must not be inferred from starter topology.
- `NewDocumentDialog` receives `quotationStarter.metadata` through the editor boundary. It displays the actual document name, `6 pages in 1 output`, and `Quotation · 6 pages · PDF + PNG` for the current composer. The obsolete five-page, WhatsApp, and follow-up claim no longer exists.
- Two focused unit tests pass. One compares every metadata property with the exact reset aggregate. The second expands the source terms until the composer creates more pages, then proves the metadata recomputes the new total plus every output name and page count instead of retaining current fixture values.
- Added `starter-metadata.spec.ts`. It first replaces the document with a one-page blank, reads the visible starter claims, invokes the real reset button, waits for the production local-storage draft to change, and compares document name, page count, output count, output IDs/names/page counts/export formats, and visible output descriptions with the restored bytes.
- Completed local non-browser gates: focused Studio tests 2/2, Studio typecheck, modified-file ESLint, Prettier, and tracked-file whitespace checks pass. The Playwright run was stopped before execution because concurrent Vite/Worker runners orphaned host `workerd` processes and made port 3000 unavailable. Per the root task, the focused browser spec and canonical suite will run once after host recovery; this phase is not marked browser-complete yet.

## 2026-08-28 — Async local-asset transaction integrity (independent review P2 risk / ASSET-02)

Status: **core boundary completed locally — real-browser IndexedDB evidence remains pending because the shared Worker host is unhealthy**

Phase-entry evidence:

- Reread the independent review's P2 asset-risk finding and acceptance test, WF-04, the reference adopt/avoid matrix, the current `addImageFile` and `replaceImageFile` callbacks, local IndexedDB storage, history snapshot identity, review proposal state, selection/page navigation, and the visible asset-error path.
- Confirmed both callbacks authorize once, retain a page or target node across image decode and IndexedDB persistence, then commit without comparing the current history snapshot. A review proposal, page navigation, document replacement, or target deletion can make that authority stale. Failed commits leave the saved blob and eagerly created object URL without a document reference.
- Revisited OpenPencil's clipboard asset path and undo batching. Its relevant behavior is to prepare file bytes before resolving the current paste target, keep document creation in one synchronous commit section, and delete every partially created node on failure. Studio needs the equivalent across two stores: immutable snapshot/page/node anchors, commit-time revalidation, and compensating IndexedDB deletion. Its graph-local asset storage is not copied because Studio's document and IndexedDB cannot share one native transaction.
- Rechecked the Avnac repository pattern identified by the audit. The useful part is explicit validated repository CRUD; Studio's current put/get-only helper cannot prove rollback or inspect retained rows.

Bounded implementation contract:

1. Capture a typed mutation anchor containing the document snapshot, document ID, active page, target page, and replacement-node identity before the first await. Revalidate review/recovery state, snapshot, active page, page membership, and target image after decode and again after persistence.
2. Keep asynchronous preparation and persistence outside document history. Commit exactly once and synchronously only while the anchor is current. A stale or rejected operation must not change selection, document history, or document content.
3. Add repository delete/list/exists support and make IndexedDB helpers resolve on transaction completion, not request success. A persisted but uncommitted asset must be deleted and absence verified before the operation reports a normal stale/failure result.
4. Create and register the preview object URL only after a successful document commit. If commit rejects or throws, no object URL may exist. Surface a specific recoverable status for review, page/document, target-node, storage, and rollback failures.
5. Add deterministic unit tests with paused decode and persistence boundaries, covering review start, page/document replacement, target deletion, commit rejection, rollback, and object-URL ordering. Add a real-browser regression that pauses decode, starts review, resumes, then inspects both the canonical document and IndexedDB for exact non-mutation and zero retained upload rows.
6. Run focused unit/browser tests, Studio typecheck and lint, and modified-file whitespace checks. Do not call the phase complete until those gates pass.

Completion evidence:

- Added a pure asset-mutation coordinator with typed add/replace anchors. It checks draft recovery, pending review, immutable history snapshot, document identity, active page, page ownership, and the replacement image's asset/source identity after decode and again after IndexedDB persistence. The last check and canonical history commit share one synchronous call stack, so another browser event cannot enter between authority validation and commit.
- Local assets now have explicit list, existence, delete, and verified rollback operations. The IndexedDB helper no longer resolves a put/delete/get on request success; it resolves only after the owning transaction completes and treats errors and aborts as failures. A stale or rejected operation deletes the staged row and verifies that its key is absent before returning the normal recoverable result.
- `addImageFile` and `replaceImageFile` now serialize local image mutations, stage the blob, revalidate, and commit once. They create an object URL and update selection only after commit succeeds. Review, recovery, document, page, target, decode, storage, commit, and rollback failures produce distinct retry guidance through the existing document-status surface.
- Eight deterministic tests pause decode or persistence and then start review, switch pages, replace the document, or delete the target node. They also cover synchronous commit rejection, atomic persistence failure, rollback failure, exact cleanup ordering, and prove the caller cannot create an object URL before commit. All eight pass as part of the complete Studio unit run, 24/24 tests.
- Non-browser gates pass: Studio typecheck, modified-file ESLint, modified-file whitespace checks, and the complete production Studio build including its auxiliary Renderer Worker. The build retains the pre-existing large-chunk warning but has no error.
- Added `asset-mutation-transaction.spec.ts` for the real Chrome acceptance path. It pauses `createImageBitmap`, starts a genuine WebMCP review, resumes decode, compares canonical snapshot/revision/node IDs, reads the real `webmcp-studio-assets/assets` object store, counts object-URL creation, and requires the recoverable status copy. The run did not reach test execution because the shared host's orphaned `workerd` state prevented Playwright's configured Vite Worker server from becoming healthy. The second attempt was stopped on root-task instruction to avoid spawning more servers. This phase is intentionally not marked browser-complete; that focused spec and the canonical suite remain the closure gate after host recovery.

## 2026-08-28 — Non-destructive quotation theme application (independent review P1-4 / TEMPLATE-01 safety slice)

Status: **implemented and domain-verified — focused browser contract is pending host Worker recovery**

Phase-entry evidence:

- Reread independent-review defect P1-4, TEMPLATE-01, the current quotation template catalog, `composeQuotationDocument`, the general design-template repository, editor history replacement semantics, and the live template-selection callback before editing.
- Confirmed the exact data-loss path remains present: a card click calls `composeQuotationDocument(quotationSource, templateId)` and replaces the whole current aggregate. This discards every post-import page, node, group, field, binding, output change, manual text edit, and accepted agent result even though the catalog promises content will remain fixed.
- The quotation composer already exposes the three versioned palettes, and its generated document uses those palette values consistently for page backgrounds and supported node paint properties. That provides a deterministic token-to-token application boundary without rebuilding document structure or guessing semantic content from source data.

Bounded implementation contract:

1. Add a pure document-domain operation that maps the active quotation palette to the selected palette across page backgrounds and supported node paint properties while preserving document, output, page, node, group, field, and binding identities and all non-visual values.
2. Custom paint values that are not an exact active-theme token must remain unchanged. User text, geometry, layer names, lock/visibility, page order, output settings, source bindings, and manually added structure must survive byte-for-byte outside the explicit visual and revision metadata paths.
3. Template application creates one named history entry and one Undo step. Selecting the already-active template is a no-op. The active page and valid selection remain stable; review/recovery mutation locks remain authoritative.
4. Add domain regressions with edited bound/unbound content, an added page and group, output edits, bindings, custom paint, and immutable input evidence. Add editor/browser coverage for one-step apply/Undo and persisted aggregate survival.
5. Run focused domain/editor tests, Studio/document typechecks, lint, whitespace checks, then the canonical browser suite after the host Worker process state is healthy. Do not mark this safety slice complete while browser evidence remains unavailable.

Implementation evidence:

- Added `applyQuotationTemplate` in the document domain. It maps exact active-palette tokens to the selected palette across page backgrounds and text/shape/line/icon paints, advances revision metadata once, validates the result, and never calls the quotation composer. Non-token custom paints are deliberately preserved.
- The regression fixture edits bound content, adds an unbound agent-approved note, adds a page and semantic group, changes output settings, and adds a field plus binding. After theme application every aggregate relationship, stable ID, text value, geometry value, lock/visibility value, and output setting remains equal outside the explicit paint and revision paths. The input aggregate remains immutable and validation has no errors.
- Template selection now derives the next aggregate from the current history snapshot, creates one named `Apply … theme` entry, retains active page and valid selection, and is a no-op for the active card. It no longer clears pending review state after authorization; the existing review/recovery guard remains the gate.
- Added palette inference for history traversal. Undo and Redo synchronize the active template badge and persisted template ID from the restored aggregate, preventing an Olive document from being mislabeled Midnight after Undo and preventing the next token mapping from using the wrong source palette.
- Focused evidence passes: 13/13 quotation-application plus editor-history tests, document/editor/Studio typechecks, targeted Studio lint, formatting, and scoped whitespace checks. The real-browser contract edits text, adds a seventh page, applies Midnight, compares the complete persisted aggregate outside visual keys, checks selection survival, and requires one Undo to restore the exact stored bytes and Olive badge. Execution remains pending host Worker recovery.

## 2026-08-28 — Required publication identity storage (independent review P3 risk / REV-03)

Status: **completed locally — staging and production migration plus post-apply inspection remain release gates**

Phase-entry evidence:

- Reread the independent review's nullable-publication-identity finding, the mandatory remediation protocol, REV-02's publication identity contract, migrations 0001 through 0005, `template-repository.ts`, the runtime `templateVersionSchema`, and the branch-publication domain/browser tests. Runtime requires a non-empty version ID, nonnegative integer source revision, a SHA-256 or legacy snapshot identity, and parsed document/manifest objects, while D1 still permits null identity columns and arbitrary JSON text.
- Revisited the current Cloudflare D1 migration, foreign-key, and SQL guidance. D1 enforces foreign keys in migrations and permits `PRAGMA defer_foreign_keys`, not a dependable `foreign_keys = OFF` inside the implicit migration transaction. The documentation also warns that deferred checks do not suppress cascade actions.
- Traced the dependent schema before editing. `render_jobs` has a composite foreign key to `template_versions(template_id, version)`, and `render_outputs` cascades from `render_jobs`. A parent-only drop-and-rename rebuild fails under foreign-key enforcement and risks render-history loss; the migration must preserve and rebuild both dependents inside the same transaction.

Bounded implementation contract:

1. Add migration 0006 without rewriting migration history. Rebuild `template_versions` with required, non-empty publication IDs, nonnegative integer revisions matching the stored document revision, accepted snapshot-ID formats, JSON-object checks for the document and manifest, the original composite primary key and template foreign key, and the existing named ID and snapshot indexes.
2. Preserve every render job and output while rebuilding the referenced table. Recreate their original foreign keys, checks, workspace/idempotency indexes, and normalized artifact-identity uniqueness before ending deferred validation.
3. Make the first copy into the constrained table the validation boundary. Invalid legacy data must abort the complete migration before current tables are removed, leaving an exact pre-migration schema and data set plus a constraint error that names the repair column or check.
4. Add a deterministic disposable-database verifier. It must migrate a valid pre-0002 publication row through 0006, parse the result with the runtime schema, compare dependent rows byte-for-byte, and inspect columns, indexes, foreign keys, and `foreign_key_check`.
5. Run isolated malformed-document, null-revision, and null-snapshot cases. Each must reject inside one transaction, retain the old nullable schema and invalid row, retain render history, and leave no migration backup or replacement table behind.
6. Apply and inspect migration 0006 only on the local Wrangler D1 database. Staging and production application, backup review, and post-apply inspection remain explicit release gates.

Completion evidence:

- Added `0006_template_version_constraints.sql` without changing 0001 through 0005. The rebuilt table makes `id`, `source_revision`, and `source_snapshot_id` `NOT NULL`; named checks reject blank IDs, negative/non-integer or document-mismatched revisions, unsupported snapshot identity formats, malformed/non-object documents, and malformed/non-object manifests. The original `(template_id, version)` primary key, cascading template foreign key, `idx_template_versions_id`, and unique `idx_template_versions_source_snapshot` remain present.
- The migration does not depend on disabling foreign keys. It defers their validation, validates every source row by copying into the constrained replacement first, then backs up and rebuilds `render_jobs` and `render_outputs` before replacing the referenced table. Their original data, checks, cascade relationships, workspace index, partial idempotency uniqueness, and normalized artifact-identity uniqueness are restored before deferred validation ends.
- Added the deterministic `bun run verify:migrations` harness. A valid publication inserted against migration 0001 migrates through 0006, parses with `templateVersionSchema`, preserves its render job and output byte-for-byte, retains the primary key/index/foreign-key schema, and returns an empty `foreign_key_check`. Malformed document JSON fails on `chk_template_versions_document_json`; null revision and snapshot values fail on their named columns. All three failures roll back the exact prior schema, invalid source row, and render history and leave no replacement or backup tables.
- Applied 0006 with Wrangler 4.126.0 to the local D1 state only. Counts before and after were 36 template versions, 20 render jobs, and 17 outputs. Post-apply inspection reports all three identity columns as `NOT NULL`, both template-version indexes with the expected uniqueness, the template and two-level render foreign keys intact, zero SQL-level invalid rows, zero foreign-key violations, and no pending local migration. A read-only runtime pass parsed all 36 of 36 stored versions with `templateVersionSchema`.
- Focused verification passes: the migration harness, 7/7 publication identity/publishing tests, Studio typecheck, Bun compilation of the verifier, Prettier for supported modified files, and scoped `git diff --check`. This repository has no Prettier SQL parser or root ESLint config for the standalone script; SQL correctness is exercised by the disposable SQLite transactions and the actual local Wrangler D1 migration instead of claiming those unavailable gates.

Deployment gate:

- Do not deploy code that assumes these constraints until 0006 succeeds independently in staging and production. Before each apply, take the environment's normal D1 recovery point and run the same null/blank identity, revision/document mismatch, snapshot-format, `json_valid`, and JSON-object diagnostics used by the migration checks. If the migration rejects a row, its constraint or column name is the repair target; restore that version from its immutable publication/audit source and rerun rather than editing migration history. After each apply, compare template-version, render-job, and render-output counts, inspect `table_info`, named indexes and all three foreign-key lists, run `foreign_key_check`, and parse every migrated version through the runtime schema.

## 2026-08-28 — Non-heuristic draft structure restoration (independent review P2 migration risk / PERSIST-02)

Status: **implemented and unit-verified — browser reload contract is pending host Worker recovery**

Phase-entry evidence:

- Reread the independent review's quotation-group migration risk, draft decoder/recovery tests, current restore effect and retry path, quotation starter topology, layer-group invariants, and the persistence backlog before editing.
- Confirmed the only persisted document schema currently accepted by Studio is `schemaVersion: 1`; there is no older explicitly versioned grouping format, migration envelope, source hash, or applied-migration marker. The current callback nevertheless identifies one document by ID/topology and replaces all groups when existing groups happen to match seed node sets.
- A flat document is already a valid canonical document and the production layer tree supports it. Preserving a valid flat or custom-grouped draft is safer than silently improving its hierarchy by guessing provenance. Therefore the supported migration set for the current schema is empty; a future structure migration must introduce an explicit source version/marker before it is allowed to transform bytes.

Bounded implementation contract:

1. Remove the quotation ID/topology/group-name heuristic from both initial restore and recovery retry. Current-schema drafts pass through the identity migration and aggregate validation only.
2. Prove byte-equivalent preservation for flat, partially grouped, coincidentally seed-shaped custom, and already grouped current-schema documents. No group name, parent, ordering, node membership, or unrelated metadata may change.
3. Retain the generic decoder migration boundary for future explicitly versioned migrations, including exception containment and post-migration aggregate validation; do not register any implicit current-schema migrator.
4. Run focused draft tests, Studio typecheck/lint, full non-browser gate, and a browser reload contract after host Worker recovery. Do not describe unchanged valid legacy drafts as migrated.

Implementation evidence:

- Deleted `restoreQuotationLayerStructure`, its document-ID/topology checks, and its seed-group replacement from the editor. Both initial restore and the user's explicit recovery retry now call the decoder without a registered structure migration.
- Valid current-schema drafts therefore pass through schema parsing and relationship validation without semantic rewriting. Flat layers remain flat; partial or custom hierarchy remains user-authored; current composed hierarchy remains unchanged. Invalid aggregates still enter the existing quarantine/recovery flow.
- The generic decoder migration parameter remains covered for a future explicitly versioned migration: it runs only after schema parsing, contains migration exceptions, and validates the migrated relationships before returning bytes to the editor. No current-schema migration is registered because no reliable provenance marker exists.
- Added a four-shape preservation regression covering an entirely flat quotation, a partial group whose node set matches a starter block but has a user name, a complete quotation with a renamed/re-identified seed-shaped group and updated parent references, and the already grouped document. All return the exact input aggregate and byte-equivalent serialization.
- Added a browser reload contract that persists a coincidentally seed-shaped custom group under the real production key, reloads, waits beyond autosave debounce, and requires exact stored bytes with no recovery dialog. Execution remains pending host Worker recovery.
- Focused evidence passes: 7/7 draft recovery tests, Studio typecheck, targeted Studio lint, formatting, and scoped whitespace checks. The repository-wide non-browser gate will be rerun after the concurrent JSON-boundary task settles.

## 2026-08-28 — Bounded renderer artifact delivery (independent review P2 memory risk / RENDER-03)

Status: **implemented locally — deployed near-threshold memory telemetry remains a release gate**

Phase-entry evidence:

- Reread the independent review's PDF-memory risk, Renderer artifact helper/tests, both Browser Rendering handlers, Studio's durable render invocation, direct PNG/PDF proxy routes, render admission accounting, and current Wrangler bindings before editing.
- Confirmed the earlier 64 MiB stream helper is now dead production code, while the live PDF path still creates a second `Uint8Array` copy and a Blob from `page.pdf()` bytes, writes that Blob to R2, and retains the Blob again as the response body. The durable job caller immediately cancels that body and uses only R2 metadata.
- Cloudflare R2 accepts an `ArrayBuffer`/view directly and returns stored objects as streams. The safe local boundary is therefore one generated byte buffer, a hard size check, direct R2 write, then either a metadata-only response for durable jobs or a fresh R2 read stream for direct download. A deployed Worker memory profile is still required because local tests cannot measure platform serialization or Browser Rendering transfer overhead.

Bounded implementation contract:

1. Replace the unused 64 MiB materializer with a pure artifact-size policy and lower the provisional maximum to 16 MiB. Reject above-limit PNG/PDF bytes with one stable response before R2 write.
2. Remove `Uint8Array.from` and Blob construction from PDF. Write the generated screenshot/PDF view directly to R2 and do not retain it as the response body after persistence.
3. Let internal durable-job requests explicitly omit the artifact body. For direct export, return the stored R2 object's body stream with exact size/checksum/content metadata; fail deterministically if post-write retrieval is unavailable.
4. Test just-below, exact, and just-above thresholds without allocating threshold-sized fixtures; prove too-large artifacts never call R2; prove metadata-only and streamed-download response modes.
5. Run Renderer/Studio focused tests, typechecks, builds, full non-browser gate, and deployed near-threshold memory telemetry before calling the risk production-closed.

Implementation evidence:

- Replaced the unused stream-to-chunks-to-Blob helper with one pure size policy. The provisional artifact ceiling is now 16 MiB, not an unverified 64 MiB. Just-below and exact-threshold values pass; just-above, negative, fractional, NaN, and infinite lengths fail without allocating threshold-sized test bodies.
- Both PNG and PDF check generated byte length before R2. An oversized artifact returns stable `413 render_artifact_too_large` metadata and never calls R2. This does not pretend generation itself is free; deployed Browser-to-Worker transfer telemetry remains required.
- PDF no longer calls `Uint8Array.from` or constructs a Blob. Browser-provided PDF bytes and screenshot bytes are each passed directly to R2 once. The prior chunk array, per-chunk copies, Blob backing store, and Blob response retention are gone from production code.
- Durable render jobs now send `Prefer: return=minimal`. Renderer persists the artifact and returns `204` plus key/size/checksum headers without reading or returning the body that the job caller previously cancelled immediately. Direct exports read the just-written R2 object and stream its body; if that read is unavailable, Renderer deletes the staged key and returns stable `502 render_artifact_unavailable` instead of leaving an unreported object.
- Focused Renderer coverage proves streamed direct PDF bytes, metadata-only durable responses, no R2 call for oversized PDF and PNG, deterministic missing-object cleanup, and the existing resource/validation boundaries. Renderer tests pass 28/28; Renderer and Studio typechecks, Renderer dry-run production build, formatting, and scoped whitespace checks pass.
- Production closure still requires deployed renders just below and above the 16 MiB policy with Worker memory telemetry, plus cancellation evidence. Until then this is a materially safer local boundary, not a measured platform-memory claim.

## 2026-08-28 — Cross-route JSON request boundary (independent review P2-1 / SEC-01 request slice)

Status: **core boundary implemented and non-browser verified — raw/deployed HTTP execution remains pending host Worker recovery**

Phase-entry evidence:

- Reread independent-review defect P2-1, its full acceptance test, the mandatory phase-entry protocol, and SEC-01's request-boundary contract. The required proof is broader than a malformed `{` probe: empty, malformed, truncated, wrong-media-type, invalid or mismatched length, headerless, and headerless-oversized bodies must have stable rejection semantics before D1, admission, Renderer, Browser Rendering, or R2.
- Enumerated the executable API handlers rather than relying on the generated route tree. The JSON-consuming Studio POST routes are preview PNG, preview PDF, published render, template publish, and quotation composition. Session reset is POST but consumes no JSON. The private Renderer has two JSON-consuming POST routes, page PNG and output PDF. There are no JSON-consuming PUT or PATCH routes in the current Studio or Renderer source.
- Traced every source parser. All seven executable JSON routes call `@webmcp/worker-boundary`'s streaming `readJsonBody`; no route still calls `request.json()`. Client file import, draft recovery, D1 row decoding, and local UI storage use separate bounded-by-storage/schema parsers and are not HTTP request-body entry points.
- Revisited Avnac's actual document route. Its useful behavior is schema validation before repository mutation, but Elysia owns body decoding and the route provides no byte-limit or malformed-body contract to reuse. Revisited OpenPencil's HTTP/MCP code and found a caught `req.json()` boundary but no general byte-capped request reader. Neither reference closes P2-1. The current Workers guidance explicitly permits buffering only after a hard byte cap; the Studio boundary must remain independently implemented and streaming.

Bounded implementation contract:

1. Keep one byte-counting stream reader as the only executable JSON request parser. Reject unsupported JSON media types, empty bodies, malformed/truncated JSON, invalid UTF-8, unsafe or mismatched length declarations, unreadable streams, and bodies over each route's cap with stable product codes and only 400, 411, or 413 statuses.
2. Do not trust `Content-Length` as the byte cap. If a route requires a declared length, still stream and cap a headerless body before returning 411, so an oversized headerless/chunked request returns 413 without allocating the complete body. A valid headerless body remains supported only on explicitly internal/optional-length boundaries.
3. Put the five public Studio JSON routes in one typed policy registry and make every handler consume it before authentication, D1, admission, or Renderer access. Preserve the private Renderer's optional-length service-binding contract, but apply the same media, syntax, UTF-8, and streamed-size failures before Browser Rendering or R2.
4. Add focused reader tests for the complete failure matrix, including hostile streams and cancellation, and Renderer Worker tests proving zero browser/R2 calls for every boundary class. Add a pending HTTP contract spec covering all five public routes plus D1/render-history non-mutation; do not start Vite or Playwright while host `workerd` is unhealthy.
5. Run worker-boundary and Renderer tests, Studio/Renderer/worker-boundary typechecks, targeted lint and formatting, and scoped whitespace checks. Record the exact cross-route evidence and keep deployed-Worker HTTP verification as a release gate.

Implementation evidence:

- Added one typed Studio policy registry for the five public JSON routes. Preview PNG and PDF plus template publish cap bodies at 8,000,000 bytes, quotation composition at 2,000,000, and published render at 256,000. Every policy requires a declared length, and every handler now calls `readStudioJsonBody` before principal resolution or any D1, admission, or Renderer operation. Quotation composition no longer has a weaker one-off policy.
- Tightened the shared stream reader. Wrong or missing JSON media type is a stable 400, as are empty, malformed/truncated, invalid-UTF-8, invalid/mismatched-length, and unreadable bodies. Missing required length is 411. Declared or observed over-limit bytes are 413. The reader no longer trusts absence of `Content-Length` as an early exit: it counts and caps a headerless stream first, so a small valid body receives 411 but an oversized body receives 413. Stream cancellation is best-effort and cannot replace the stable 413 with a transport exception.
- Preserved the private Renderer service-binding contract as optional-length because in-process `Request` construction does not synthesize `Content-Length`. Both Renderer POST routes still consume the same reader with the 8,000,000-byte observed cap and reject the full transport matrix before `launch` or R2.
- Added 11 shared-reader tests covering valid JSON/charset, empty, malformed and truncated JSON, invalid UTF-8, missing/wrong/lookalike media types, invalid/unsafe/mismatched/oversized declarations, headerless cap enforcement, required-length precedence, hostile cancellation, and stream read failure. All 11 pass.
- Added a five-route Studio policy test. It asserts the exact route inventory and caps, proves exact-length parsing plus 411 behavior on every route, and proves headerless oversized input returns 413 before the required-length response. All 3 tests pass.
- Expanded the Renderer Worker contract on both `/render` and `/render/pdf`: empty, malformed, wrong-media-type, invalid-length, mismatched-length, declared-oversized, and headerless-oversized requests produce their stable 400/413 codes with zero Browser Rendering and R2 calls. The current complete Renderer run, including the concurrently added artifact-integrity cases, passes 28/28 tests across 3 files.
- Added `json-request-boundary.spec.ts` as the pending real HTTP contract. It sends raw HTTP/1.1 requests for all five public routes, including invalid and mismatched lengths plus true chunked bodies, rejects any unhandled-500 envelope, and compares template plus render history before and after. It deliberately has not started Vite/Playwright while the host's orphaned `workerd` processes remain unhealthy.
- Non-browser gates pass: worker-boundary, Renderer, and Studio typechecks; focused Studio policy tests; targeted Studio ESLint; Prettier; and scoped whitespace checks. Source enumeration still finds no `request.json()` in executable Studio or Renderer routes. The remaining closure gates are the pending raw HTTP spec after host recovery and a deployed-Worker repetition that observes D1, admission, Browser Rendering, and R2 non-invocation under the real runtime.

## 2026-08-28 — Integrated non-browser reconciliation after independent-review fixes

Status: **green locally — browser/deployed gates listed in each phase remain open**

- Ran the complete repository `bun run check` after merging publication identity, atomic group reorder, semantic duplication, draft recovery, renderer readiness, gesture ownership, render identity, starter metadata, asset transactions, non-destructive themes, constrained migration 0006, non-heuristic restore, cross-route JSON policy, and bounded artifact delivery.
- Lint passes for every configured workspace. Typecheck passes for worker-boundary, document, WebMCP, render-view, Renderer, UI, editor, and Studio.
- All executable non-browser tests pass: worker-boundary 11/11, WebMCP 17/17, Studio 28/28, Renderer 28/28, editor 49/49, and document 64/64, for 197 passing tests. Render-view currently has no test files and exits through its explicit `passWithNoTests` contract; CONFORM-01 remains open rather than treating that as rendering evidence.
- Every production build passes, including the standalone Renderer Wrangler dry run and Studio client, SSR Worker, and auxiliary Renderer Worker builds. The existing large-chunk warning remains a performance backlog item, not a build failure.
- `bun run verify:migrations` passes after the complete build: valid legacy publication upgrade, malformed document JSON rollback, null revision rollback, and null snapshot rollback. Repository `git diff --check` is clean.
- This reconciliation does not convert pending browser or deployed gates into passes. The host still has unreaped `workerd` processes, so new Playwright contracts for template preservation, starter metadata, asset races, raw HTTP parsing, render selection, and custom-group reload remain written but unexecuted. Production Access configuration, deployed Browser Rendering/resource parity, staging/production migrations, and deployed memory telemetry also remain explicit release blockers.

## 2026-08-28: Cross-renderer conformance foundation (CONFORM-01)

Status: **structural foundation implemented and non-browser verified; browser and pixel parity remain open**

Phase-entry evidence:

- Reread the mandatory phase-entry protocol, the independent review's three-renderer P3 risk, the CONFORM-01 backlog row, and RENDER-02's resource-readiness evidence. Resource readiness now prevents missing fonts and undecoded images from being accepted, but it does not prove that Fabric, React thumbnails, PNG, and PDF place the same pixels.
- Revisited OpenPencil's actual visual-oracle implementation in `tools/visual-oracles/src/compare.ts` and its focused engine helpers/tests. Its useful pattern is a named canonical fixture, renderer-owned output files, explicit image-size normalization, machine-readable absolute-error/RMSE metrics, and retained diff artifacts. The Studio foundation will adopt the deterministic fixture and comparison contract without copying OpenPencil's Figma clipboard or CanvasKit-specific code.
- Rechecked the local reference guidance for Canva-style editors. None of the reviewed Canva/Avnac examples provides a stronger cross-renderer oracle; this phase therefore follows the OpenPencil engine-test pattern and keeps the product-specific canonical document as the source.
- Traced the current implementations in `packages/editor/src/fabric-adapter.ts`, `packages/render-view/src/index.tsx`, and `apps/renderer/src/html.ts`. They independently translate frame, text, shape, line, icon, and image properties. `@webmcp/render-view` has no tests. HTML applies a global border-box rule that the React component leaves to host CSS, Fabric computes image crop geometry separately from CSS `object-fit`, and Fabric scales icon path bounds while React/HTML honor the declared SVG `viewBox`.

Bounded implementation contract:

1. Add one valid golden canonical document with mixed-size/mixed-format outputs and named cases for every node type, rotation, opacity, text line height/letter spacing/alignment, long and whitespace-sensitive text, image cover/contain crop positions, rectangle radius/stroke, ellipse stroke, page background/size, and hidden/locked state.
2. Add pure shared projection helpers for properties that must mean the same thing in every renderer. Fabric, React, and HTML must consume those helpers rather than maintain three value translations.
3. Add deterministic package tests that compare each implementation's projected frame, typography, shape, SVG, image, visibility, page, and ordering contract against the golden corpus. Tests must fail on a dropped or altered canonical property.
4. Add a browser/pixel comparison specification with explicit dimensions, artifact names, thresholds, and diff retention. Do not launch Vite or Playwright while the host `workerd` state is unhealthy.
5. Run document, editor, render-view, and Renderer tests/typechecks plus the relevant repository gate. Keep Fabric/browser raster capture, Browser Rendering PNG/PDF rasterization, font metrics, anti-aliasing tolerances, and deployed artifacts listed as open evidence until they run.

Implementation evidence:

- Added `renderConformanceDocument`, a schema-valid and render-policy-safe golden document with 11 nodes. It covers all three text sizing modes, rectangle, ellipse, line, icon, cover image, contain image, rotation, opacity, line height, letter spacing, alignment, long and whitespace-sensitive text, focal positions, shape stroke/radius, hidden/locked state, three page sizes/backgrounds, ordered multipage output, square output, PNG, and PDF.
- Added one pure document projection for frames, pages, type-specific render values, SVG viewBox `meet` geometry, and image cover/contain source/destination geometry. React thumbnails and Renderer HTML now consume the same projection. Fabric consumes the shared frame, typography, image-layout, and SVG-viewport helpers rather than recalculating those values independently.
- Fixed five concrete structural mismatches. React thumbnails now declare border-box sizing and the same font fallback instead of depending on host CSS. Text uses `pre-wrap`, so multiple spaces are no longer collapsed before export. Fabric bordered rectangles and ellipses preserve the canonical outer width/height used by CSS. Fabric icons honor the declared viewBox and uniform `meet` scale instead of stretching raw path bounds. Fabric image/icon resync uses group-relative coordinates, preventing the second document sync from shifting grouped content.
- Locked state is now observable as `data-node-locked` in React and HTML without changing its visual meaning. Hidden state, paint order, page dimensions, page backgrounds, output membership, and mixed-size PDF page rules have direct contract assertions.
- `@webmcp/render-view` has executable property tests instead of passing through `passWithNoTests`. Document conformance, Renderer HTML, and Fabric cover the shared structural contract. `bun run verify:conformance:structure` checks all 11 nodes across canonical, React, and HTML property mappings, pure Fabric text projections, and synchronous non-image Fabric objects. The command explicitly excludes browser text line-break and pixel claims.
- Added a deterministic Sharp-based pixel comparator and checked-in eight-comparison manifest. It rejects dimension changes, computes per-pixel RGBA differences and RMSE, writes red-on-gray diff PNGs plus a JSON report, and fails above the explicit 1.5 percent / RMSE 6 thresholds. Manifest validation passes without launching a browser.
- The complete non-browser `bun run check` passes after these changes. Current counts are worker-boundary 11/11, WebMCP 17/17, Studio 41/41, Renderer 31/31, editor 52/52, document 70/70, and render-view 4/4, for 226 passing tests. All configured lint, package typechecks, production builds, targeted Prettier, structural verification, and `git diff --check` pass.

Remaining release evidence:

- This phase is not pixel parity. The unhealthy host `workerd` state prevented the required device-scale-1 browser captures. Fabric, React Artboard, Renderer PNG, and rasterized Renderer PDF artifacts still need to be generated for all three golden pages and passed through the checked-in comparator.
- Run the same corpus through deployed Browser Rendering with the embedded Geist face, valid/corrupt image cases, and retained CI artifacts. Review any threshold exception by node/region; do not raise a global tolerance to hide text, stroke, crop, or icon drift.

## 2026-08-28 — Content-first text workflow (TEXT-01)

Status: **interaction workflow and healthy-browser acceptance complete; retained
cross-renderer pixel conformance remains open**

Phase-entry evidence:

- Re-read TEXT-01 in the parity matrix, workflow audit, production backlog, the independent-review limitation, the new CONFORM-01 projection contract, and the OpenPencil north-star interaction gate. The current product still inserts one generic 44px `Double-click to edit` box; typography repair is deferred to the inspector and fixed-box overflow is only an estimated validation warning.
- Revisited OpenPencil's actual `textAutoResizeChanges`, resizing control, auto-resize engine tests, and double-click editor tests. The useful contract is an explicit Auto width / Auto height / Fixed mode, one canonical geometry update when text or typography changes, undo covering content and derived geometry together, and direct editing entered by double-click. Its full glyph engine, path text, style runs, font-feature model, and platform font resolver are intentionally beyond this first text slice.
- Revisited Polotno's text-overflow and vertical-resize examples. They confirm that overflow policy and vertical resizing must be deliberate product states, but their global unstable configuration switches and selection-dependent overflow behavior are not acceptable canonical document semantics.

Bounded implementation contract:

1. Add a backward-compatible canonical text sizing mode with Auto width, Auto height, and Fixed. Existing documents retain their geometry; new text presets choose a mode intentionally.
2. Introduce deterministic managed-font layout projection for intrinsic width, wrapped height, line count, and fixed-box overflow. Text, typography, width, and sizing-mode mutations must derive geometry through one pure boundary used by commands, Fabric, React, and export HTML.
3. Add content-first Heading, Subheading, Body, and Caption presets with explicit name, sample copy, typography, sizing mode, and page-relative initial geometry. The visible add-text surface must expose presets on desktop and compact layouts while the `T` shortcut keeps a documented default.
4. Keep direct editing first-class: a newly inserted text layer is selected and enters editing where the canvas supports it; double-click edits existing text; exit creates one named content-plus-geometry transaction; Escape/cancel must not leave a ghost document mutation.
5. Expose text resizing in the typed inspector with an explicit segmented/select control, explain each mode, and show a visible overflow warning for fixed boxes with a one-action repair path. Locked and mixed selections retain the existing capability/validation contract.
6. Prove preset geometry, deterministic layout, sizing transitions, overflow detection/repair, renderer property parity, one-step Undo, pending-review lockout, direct-edit entry/exit, and desktop/compact reachability. Browser interaction and pixel claims remain pending until the unhealthy host is recovered; no substitute test may be reported as browser proof.

Implementation evidence:

- The document schema now has the backward-compatible `TextSizingMode` values `auto_width | auto_height | fixed`; omitted legacy values parse as `fixed`. `projectTextLayout`, `projectTextLayoutAfterPatch`, `deriveTextGeometryPatch`, `applyTextLayoutPatch`, and `repairTextOverflowPatch` are pure public boundaries. Text commands and field-bound text changes use that boundary, so content, typography, sizing-mode, and derived geometry changes remain one canonical command and one history transaction.
- `managed_font_approximation_v1` deterministically projects intrinsic width, wrapped height, line count, and fixed-box overflow for the managed Geist family. It preserves explicit newlines and whitespace while preventing a soft-wrap delimiter from becoming visible indentation on the next line. Direct patches to a managed axis are re-derived: `auto_width` owns width and height, `auto_height` owns height, and `fixed` accepts both dimensions.
- `managedRendererFonts`, `ManagedRendererFont`, and `isManagedRendererFont` are the single exported font-policy source for editor controls, render admission, and publication. The estimator is intentionally defined only for that managed set; unmanaged font strings can still be parsed from legacy/untrusted documents but fail render and publication policy instead of silently claiming deterministic metrics.
- React and export HTML expose sizing mode, measurement version, canonical line count, and aggregate/X/Y overflow diagnostics; fixed text clips while automatic modes remain visible. Both render the canonical `displayText` line sequence with native soft wrapping disabled instead of asking separate CSS render paths to invent line breaks from raw text. Fabric displays the same projected sequence outside editing, swaps to untouched canonical raw text for the active edit session, and restores projected lines on commit, no-op, cancellation, or rejected mutation. Fabric can still add a native Canvas wrap when its measured glyph width exceeds the approximation, so browser/pixel evidence remains mandatory. Fabric controls enforce the sizing contract: Auto width has no scale handles, Auto height exposes horizontal width handles, and Fixed exposes ordinary resize handles. Object-modified patches cannot persist a managed axis.
- Direct Fabric editing is an explicit session. Double-click and `enterTextEditing(nodeId)` enter only an editable unlocked `Textbox`, focus its hidden textarea, and do not consume blank-canvas double-click zoom. Unchanged exits emit no patch; normal exits emit one text patch; Escape/cancel restores the session baseline with no patch; rejected Studio mutations restore both the object and canonical cache. Selection and page navigation commit an active edit, while review lock and document replacement cancel it. `commitTextEditing()` and `cancelTextEditing()` are public so the React boundary can resolve transitions before sync.
- Studio explicitly cancels the Fabric session before document/quotation imports, template creation/application, draft restore/reset, blank creation, and demo restoration, including replacements that retain the same document ID. Direct Fabric text exits are labeled `Edit text` rather than the generic layer label. The inspector consumes the managed-font registry instead of accepting a publish-blocked free-form family, and its compact sizing, font, paragraph, list, and repair controls meet the 44 px source contract.
- Paragraph/list basics now share one plain-text contract in `@webmcp/editor`; Studio's inspector re-exports that contract instead of maintaining a second implementation. Bulleted and ordered toggles preserve blank paragraphs and indentation, normalize pasted `-`, `*`, `•`, `1.`, and `1)` markers without stacking, and renumber ordered items independently by indentation depth. During a Fabric edit session, Enter continues the current item, Enter on a marker-only item terminates the list, Tab/Shift+Tab indent or outdent selected list lines without inserting a literal tab or moving focus, and Backspace at the content boundary removes the marker while preserving indentation. These transformations update Fabric's hidden textarea but do not emit interim document patches; the existing edit exit still produces one content-plus-derived-geometry command and one Undo step.
- The golden conformance document now has 11 nodes and covers all three sizing modes. Pure document tests cover sizing transitions, direct managed-axis patches, whitespace boundaries, overflow and repair, schema compatibility, command transactions, validation, and conformance. Fabric tests cover property projection, controls, managed geometry, direct-entry eligibility, unchanged exit, Escape/cancel, hidden-textarea cleanup, callback rejection, re-entry cache stability, and transition policy. React and Renderer tests cover structural sizing and overflow attributes.
- Focused paragraph/list verification passes: editor `text-lists.test.ts` plus `fabric-adapter.test.ts` run 35/35 tests after exhaustive bullet and multi-digit marker-boundary cases, editor typecheck passes, Studio's inspector compatibility tests run 3/3, and Studio typecheck passes. The complete editor package passes 80/80. No Vite, Playwright, or browser process was started on the unhealthy `workerd` host.
- The last integrated non-browser `bun run check` before the follow-up UI/list/display-line changes passed with worker-boundary 11/11, WebMCP 17/17, Studio 49/49, Renderer 32/32, editor 63/63, document 82/82, and render-view 5/5. Subsequent focused gates pass with Studio 51/51, Renderer 32/32, editor 80/80, document 83/83, and render-view 5/5 plus relevant typechecks/lint. A new full production build was deliberately not launched while eight unreaped macOS `workerd` processes remain on the host. The existing structural verifier covers 11 canonical nodes, including three Fabric text property projections and six synchronous non-image Fabric objects, while explicitly excluding browser glyph/pixel claims.

Open evidence and scope:

- This phase proves shared properties, projected display lines, and deterministic canonical geometry, not identical text rasterization. React/HTML now consume the canonical line sequence; Fabric consumes it outside editing but still uses Canvas glyph measurement and can rewrap a projected line. Exact Fabric line breaks, glyph bounds, clipping edges, anti-aliasing, and device-scale-1 pixels require the retained Fabric/React/Renderer PNG/PDF corpus. OpenPencil avoids this class of drift by measuring and drawing through the same CanvasKit paragraph engine; adopting one shaping engine is the production direction if the browser corpus exposes meaningful Fabric/CSS divergence. Structural checks must not be cited as text pixel parity.
- The implemented list slice is deliberately a production-quality plain-text, single-node contract; it is not a semantic list-node or rich-text-run schema and is not claimed as that parity. Rich-text runs, reusable text styles, semantic list metadata, font fallback/resolution beyond the managed family, path text, and advanced typography remain TEXT-02 work.
- Pending browser cases now cover desktop and compact preset reachability, `T` insertion, immediate edit, existing-text double-click versus blank-canvas zoom, every sizing transition, locked/mixed sizing, independent X/Y clipping and repair modes, content-plus-geometry Undo, Escape, selection/page/review transitions, and bulleted/numbered Enter/termination/indent/outdent/Backspace/renumber flows with no interim operation and one exit commit. None has executed on the unhealthy host. Do not close TEXT-01 until those interaction gates and the retained Fabric/React/PNG/PDF line/pixel corpus pass.

Healthy-browser acceptance on 2026-08-29:

- Re-read the TEXT-01 contract and the matching OpenPencil/Loora text-editing
  ownership before running the retained browser suite against the single Studio
  server on port 3001.
- The first run found a real focus race: toolbar preset selection entered Fabric
  editing before the Radix menu completed its close-focus restoration, so the
  menu trigger immediately stole focus back. Preset insertion now records one
  pending edit target and hands focus to Fabric only after the menu closes. The
  direct `T` command remains immediate and does not share menu state.
- The browser pass also found that the compact More menu exposed only a generic
  Text submenu, not Heading, Subheading, Body, and Caption. The compact fallback
  now exposes all four 44 px preset actions directly and uses the same close-time
  editing handoff. Desktop retains its dedicated Add text control.
- Paragraph alignment and page/object alignment previously exposed duplicate
  accessible names inside compact Properties. Paragraph controls now say
  **Align text left/center/right**, making their intent and automation target
  unambiguous.
- The production browser suite passes **16/16** from a clean Start surface and
  the explicit Northstar sample. It proves preset/shortcut insertion, direct
  editing, text-versus-blank double click, every sizing mode, locked/mixed
  axes, independent overflow and repair, one-transaction content plus geometry,
  exact Undo, Escape, review/selection/page transitions, compact target sizes,
  and bulleted/numbered list continuation, indentation, termination, marker
  removal, renumbering, and one exit commit.
- `text-01-browser-acceptance.md` retains the exact browser boundary and open
  evidence. The Fabric/React/Renderer PNG/PDF device-scale-1 pixel corpus remains
  open; interaction acceptance is not presented as glyph/pixel parity.
- An independent code reviewer inspected the actual menu focus owner,
  compact/desktop reachability, command guards, accessible names, server
  selection, and browser assertions and returned **ACCEPT with no P0/P1**.
  `text-01-browser-independent-review.md` preserves that verdict.

## 2026-08-28 — Typed shared-field and public parameter contract (FIELD-01)

Status: **complete — implementation, independent code review, and real-browser acceptance pass**

Phase-entry evidence:

- Reread FIELD-01, WF-07, the field parity matrix, the editor architecture audit, and the prior remediation protocol before editing. Revisited OpenPencil's variable definitions, bindings, picker, dialog, and undo tests as the concrete reference for one typed definition feeding canvas, inspector, API, and agent surfaces.
- Traced the complete Stuwiz-facing path rather than treating Fields as an isolated form: canonical document values, binding propagation, review, immutable publication, local published-version restore, API Playground, `/v1/studio/templates`, `/v1/studio/render`, WebMCP inspection/proposal/validation/publish/render, and retained render history.
- The independent reviewer continuously reread the actual code while implementation continued. Its findings exposed cross-boundary failures that component tests missed: double-resolved asset IDs, stale public manifests after reload, numeric-money precision loss, branch-unsafe publication, private renderer-source leakage, immutable-version identity drift, inconsistent catalog policy, and compact duplicate IDs.

Implementation evidence:

- The canonical field model now supports text, number, INR currency, date, asset, color, choice, and boolean definitions with agent guidance and executable validation metadata. Required/empty semantics, text length, numeric/currency bounds, date validity, choice membership, safe color syntax, and binding/property compatibility are enforced by shared domain helpers.
- Currency writes use exact canonical decimal strings. Managed INR display formatting is presentation-only; formatted legacy INR is normalized for writable documents. Public API and WebMCP proposal/render boundaries reject JavaScript numbers for currency before precision can be lost. Semantically equivalent formatted proposals are no-ops.
- The Inspector uses type-specific controls, visible draft errors, disabled invalid/unchanged saves, explicit contract-change confirmation, impact summaries, and 44 px compact targets. Optional-to-required fallback cannot silently replace a bound empty value. Contract-change and deletion impact rows close their modal before navigating to the exact page, layer, and property.
- Deleting a field reports bindings, pages, and outputs, removes definition/value/bindings in one command, and one Undo restores the complete transaction. Desktop and compact Inspector instances namespace control IDs; labels resolve to the visible control, including boolean defaults.
- Review output is field-aware and human-readable for currency, date, choice, and assets. Image update details omit private `src` values and name approved assets by stable catalog identity.
- Publication and API boundaries share one catalog-backed asset identity validator. Inline or external renderer-safe values without a public Studio ID are visibly invalid in the field control, block the Publish dialog, fail server persistence, and appear as `unmanaged_asset` in `validate_design`. Optional missing current values correctly inherit approved defaults.
- Public manifests expose approved asset IDs while renderer documents retain private sources. WebMCP and API Playground keep IDs public until the Studio render route resolves them exactly once. Render history projection is idempotent for either an approved ID or its private source and never exposes the source.
- Restored server-authoritative versions replace stale local candidates in state and localStorage. Immutable published envelopes are validated and returned byte-for-byte unchanged; they cannot receive defaults or migrations under an old ID/version/snapshot. Explicit legacy transformation requires `migrateTemplateVersionForRepublication` with a replacement publication identity.
- `publish_template` now requires document ID, revision, and exact snapshot ID, preventing an Undo branch with a reused revision from publishing different bytes. Registration metadata truthfully marks publish and render as non-read-only open-world operations with their idempotency semantics.
- API Playground reuses the same field definition and typed control contract, disables Run for invalid parameters, sends exact currency strings and approved asset IDs, and uses a one-column compact request layout with per-output accessible format labels.

Verification evidence:

- The complete non-browser workspace test gate passes: worker-boundary 11/11, render-view 5/5, WebMCP 23/23, Renderer 32/32, editor 81/81, document 115/115, and Studio 79/79, for 346 passing tests.
- All eight workspace package typechecks pass. Repository lint and `git diff --check` pass. The independent final code review reports no remaining FIELD-01 P0 or P1 findings; its final three P2 interaction findings were also fixed and rechecked locally.
- The retained Playwright contracts now start from the route-owned draft repository rather than the retired single-document localStorage bootstrap. They migrate one exact current-draft envelope into IndexedDB, enter the canonical `/documents/:documentId` route, and read durable state back from the repository body store.
- The two contracts pass **8/8** against the one existing Studio server on port 3001. Coverage includes invalid INR bounds, no-op save protection, optional-to-required confirmation, exact delete impact, off-page property focus, atomic Undo, compact-sheet continuity, contract-change navigation, and field creation validation.
- A deterministic compact publication adds an approved asset field, publishes version 1, opens API Playground through the compact File menu, displays Olive botanical, emits the public value `"hero_asset": "olive-botanical"`, and proves the request body contains no private `data:image` source.
- Browser acceptance exposed stale harness assumptions without requiring product work: `Required` is correctly a radio, modal background triggers are intentionally inaccessible while Properties is open, `New` requires an exact field-action locator beside template `Create new`, and restoring the original INR bounds correctly leaves Save disabled until another contract value changes.
- `field-01-browser-acceptance.md` records the exercised boundary and retained MEDIA-01 dependency.
- An independent reviewer read the actual migration, route admission, repository, typed-control, publication, public asset projection, and both browser specifications. The verdict is **ACCEPT with no P0/P1 and no misleading acceptance claim**; `field-01-browser-independent-review.md` records the evidence.

Open evidence and next dependency:

- The current approved catalog is intentionally static. Replacing it with a durable, user-browsable repository, upload lifecycle, stable public identities, quota/recovery, and reference-safe deletion is MEDIA-01; FIELD-01 now exposes the correct policy seam for that work instead of embedding arbitrary URLs in public contracts.

## 2026-08-28 — Authoritative workspace media repository (MEDIA-01 backend)

Status: **backend/domain contract implemented; local real-browser acceptance passes; deployed D1/R2 acceptance remains open**

Phase-entry evidence:

- Re-read the MEDIA-01 parity/backlog and UX audit, the existing Studio principal and JSON error conventions, D1 migrations, R2 bindings, renderer resource policy, canonical document asset rules, and Cloudflare D1/R2 production guidance before implementation.
- Kept the repository boundary workspace-owned and private: public contracts carry opaque IDs and metadata; storage keys, raw object URLs, and image bytes never cross list, mutation, template, manifest, review, or history responses.

Implementation evidence:

- Migration `0007_workspace_media_assets.sql` adds constrained `media_assets`, exact `media_asset_references`, and idempotency records with workspace/hash deduplication plus created, recent, search, reference, and source indexes. Reference rows use the composite workspace/asset foreign key and `ON DELETE RESTRICT`.
- `@webmcp/document` owns the strict managed source/opaque-ID grammar, exact 25,000,000-byte, 16,384-edge, and 100,000,000-pixel limits, supported PNG/JPEG/WebP types, public metadata, list, deletion-impact, and archive runtime schemas. Browser admission and Worker validation consume the same constants, while the Worker remains authoritative.
- Upload validates content length, multipart structure, name, idempotency, declared type, magic bytes, image structure, dimensions, decoded pixel area, and renderer data-URI limits before R2 or D1. Successful rows are renderer-safe `ready` renditions; SVG/GIF/spoofed/truncated/oversized inputs fail with stable errors.
- The repository implements workspace-scoped uploads/recent/search pagination, SHA-256 deduplication, R2/D1 cleanup and race handling, private ETag content streaming, integrity checks, truthful `lastUsedAt`, exact deletion impact, optimistic revision/token archive, and storage accounting. Every replay/deduplicated return and archived restore verifies the existing private object's hash and repairs a missing or corrupt object from the already validated upload before reporting success. Archive hides an asset from discovery but deliberately retains content and renderer resolution for drafts, history, and immutable publications.
- Studio routes now expose list/upload, private content, deletion impact, archive, and `/used` through the existing principal. Every public response is runtime-parsed against the shared transport contract and never contains an R2 key or raw URL.
- Canonical documents and published template versions persist `asset:managed/asset-…` identities only. Publication checks workspace ownership and writes both current-document and published-version reference rows in the same D1 batch. Direct composite-FK inserts accept archived identities and cannot silently skip an archive race; successful batch results are checked against the exact collected reference count.
- Render execution is the only private projection: it loads canonical managed IDs after admission, verifies the R2 object hash, and substitutes bounded renderer-safe sources in a transient clone. The canonical request, D1 document revision, immutable template version, and public manifest remain byte-free.
- The client repository consumes the shared response schemas rather than blind casts. `asset:managed/{opaqueId}` is accepted by canonical field/node and publish-readiness policy as a publishable identity, while direct render policy still requires the server projection.

Verification evidence:

- Focused document tests cover managed identity parsing, transport schemas, field values, and publish readiness. Focused Studio tests cover all accepted/rejected formats, byte/dimension/render caps, idempotency/deduplication, workspace isolation, list/recent/storage behavior, ETag/content integrity, exact impact/archive preconditions, retained archived content, `/used`, canonical publication persistence, exact atomic references, archived publication, archive-vs-publish race behavior, and transient render materialization.
- No Vite, production build, browser, or Playwright process was started while the host remains unhealthy. Browser interaction, actual deployed D1/R2 migration, deployed Worker multipart streaming, quota telemetry, and end-to-end Asset Library acceptance remain open release evidence and must not be inferred from these non-browser gates.

## 2026-08-28 — WebMCP managed-media parity (MEDIA-01)

Status: **implemented and local real-browser accepted; deployed Worker/D1/R2 acceptance remains open**

Phase-entry evidence:

- Re-read MEDIA-01, the WebMCP parity matrix, the authoritative repository contract above, and the current Asset Library and WebMCP registration paths before editing. The confirmed defect was architectural: the human picker queried the workspace repository, while WebMCP received only the static built-in catalog and therefore could neither discover nor resolve a user's managed media.
- Preserved the lifecycle contract that archive removes an asset from discovery and new insertion but does not invalidate existing drafts, history, immutable publications, inspection, validation, or rendering. Local `asset:local/*` identities remain browser-private and are never admitted to public tools.

Implementation evidence:

- `@webmcp/webmcp` now depends on asynchronous `searchAssets` and exact `resolveAsset` service boundaries. Search is cursor-paginated and does not preload a first workspace page. Built-ins remain a first-class catalog source; workspace assets carry explicit `ownership: "workspace"` and no invented license, description, or tags.
- Studio's managed WebMCP catalog composes built-ins with on-demand workspace search and exact metadata lookup. Exact managed IDs are revalidated after every completed request so an upload/archive performed by another tab or API client cannot leave a settled positive or negative cache stale; only concurrent identical requests share one bounded in-flight promise. Archived metadata resolves with `selectable: false`, allowing existing references to round-trip while excluding it from search and all new field, insertion, and replacement proposals.
- A workspace-scoped exact metadata endpoint returns only shared public metadata. Its runtime schema forbids unknown/private fields, and the repository projection never exposes an R2 key, private object URL, data URI, or image bytes. Cross-workspace and unknown identities return not found.
- `search_assets`, `inspect_design`, `validate_design`, field proposals, asset insertion, canvas replacement, and render modification resolution now await the shared catalog. Existing managed field and image-node identities—including archived ones—inspect, validate, and render correctly. Unknown managed IDs and every local ID are rejected; render output and tool results retain opaque public IDs rather than private sources.
- Public projection is defense in depth: image `src` values are stripped, local asset IDs are redacted, managed canonical sources are converted back to opaque IDs, and render records never expose transient renderer materialization.

Verification evidence:

- The complete WebMCP package passes typecheck and 33/33 focused tests. Coverage includes managed search and cursor forwarding, exact field and node resolution, inspection, validation, field/insertion/replacement proposals, render modification resolution, exact-parameter archived continuity, cross-parameter archived rejection, unknown/local rejection, untrusted-content annotations, and absence of private sources or fabricated licensing.
- Studio's managed-media suites cover no-preload search, built-in-to-managed pagination, completed-request revalidation, concurrent request deduplication, exact archived lookup, workspace isolation, safe projection, mutation notifications, durable reference integrity, and malformed/local short-circuiting. The complete Studio suite passes 157/157 and full typecheck passes; owned scoped ESLint passes.
- `@webmcp/document` typecheck and its focused media transport suite pass 5/5, including ready/archived lookup shape, the `selectable` invariant, and rejection of private `r2Key` output. `git diff --check` passes for this remediation slice.
- Studio's full typecheck passes. Full Studio lint currently has one concurrent unrelated `local-asset-store.ts` unnecessary-assertion finding; the managed WebMCP and render-reference files pass scoped ESLint. No Vite, browser, production build, or deployed Worker process was started on the unhealthy host.

Open evidence:

- Run the managed Asset Library and WebMCP journeys against deployed workspace-scoped D1/R2: multi-page search, exact existing archived reference, upload/archive/mark-used cache refresh, field assignment, canvas replacement, and render. Inspect retained tool payloads and network responses to confirm opaque IDs remain the only public source representation.

Independent-review remediation evidence:

- Exact lookup correctness no longer depends on the same JavaScript realm's mutation listener. Settled results are never reused; a later tool call always reaches the no-store workspace metadata endpoint, while simultaneous duplicate lookups still collapse to one request.
- Archived render permission is parameter-local. A non-selectable asset is accepted only when it equals that exact field's effective current/default value; another field or image node referencing the same archived asset grants no permission. The cross-field regression proves the render service is not called.
- Managed image `assetId` and canonical `src` now share one document-domain identity contract. Strict schema parsing rejects a mismatch, writable legacy decoding normalizes it explicitly with migration evidence, domain validation reports `invalid_asset`, bound managed-field writes update both properties atomically, WebMCP inspection projects the source's canonical opaque ID while validation reports the malformed state, and durable reference collection/render materialization refuse disagreement before persisting or resolving it.
- All ten registered WebMCP tools carry `untrustedContentHint: true` because their results can contain workspace filenames, document labels/text, field values, artifact filenames, or derivative validation/review messages. Registration tests assert the hint for every tool, including the consequential publish/render annotations.

## 2026-08-28 — Media library interaction integrity (MEDIA-01 UI)

Status: **implemented; authored production browser acceptance passes 18/18**

Implementation evidence:

- The shared Media dialog now keeps selection commits atomic. While a managed/local/library selection is settling, close, Escape, upload, retry, cancel, archive, duplicate selection, and pagination mutations are disabled. Successful managed use is recorded through `/used`; completed-but-unused uploads stay out of Recent. Built-in recent use persists in bounded local metadata, local use persists through the local repository, Uploads sort by creation, and Recent sorts by actual use.
- Search refresh retains the existing grid instead of flashing empty. Query changes abort and generation-invalidate in-flight Load More requests, so a stale page cannot append into a new query. Empty states expose counts, exact PNG/JPEG/WebP and 25 MB policy copy, drag/drop plus the keyboard-equivalent Upload button, and a direct Clear search action.
- Local preview cards observe a bounded viewport margin rather than creating URLs for the entire inventory. Leaving the margin revokes the Blob URL; unmount revokes every remaining URL. Missing local references expose direct Locate replacement actions that reopen the same geometry-preserving replace flow. Managed preview failure remains a selectable fallback rather than converting a valid repository identity into a dead card.
- Upload queue states are live and independently actionable. Unknown progress is a real indeterminate progress element, known byte progress is exact, and queue operations remain blocked during a document selection commit. The hidden multi-file input is named, labelled, removed from the tab order, and shares one validation/upload path with drag/drop.
- Archive review uses truthful hide/archive language because retained references remain resolvable. It reports exact current/published references and provides navigable current layer/page rows. Navigation closes both modal layers before focusing the referenced canvas layer. Archive success immediately removes the item, then refreshes authoritative workspace counts and byte storage.
- The authored production browser contract now covers managed and local insert/replace, geometry preservation, selection lock/close races, independent upload success/error/cancel/retry, completed-but-unused Recent behavior, query-scoped stale pagination, missing-local repair, reference navigation, impact revalidation, successful archive/storage refresh, reload-and-reuse, compact focus restoration, and object-URL cleanup across a 60-item inventory.

Verification evidence:

- Focused media model/transaction/policy tests pass 24/24 across 6 files. The complete Studio suite passes 156/156 across 31 files. The complete workspace non-browser suite passes 438/438 across worker-boundary, render-view, WebMCP, Renderer, editor, document, and Studio.
- All eight workspace package typechecks pass, including the authored Playwright TypeScript contract. The owned Media dialog/model/spec files pass ESLint and Prettier, and repository `git diff --check` passes.
- The retained production Playwright contract now passes **18/18** against the existing Studio server on port 3001. It covers atomic built-in/managed/local insertion, geometry-safe replacement, source-binding protection, authoritative archive revalidation before local and WebMCP commits, reload-and-reuse, progress/retry/cancel, repository recovery, stale pagination, missing-file repair, reference navigation, reference-safe archive, storage refresh, bounded preview URL cleanup, and compact 320/390 focus and touch behavior.
- Browser execution exposed and closed two production defects: Fabric now treats browser-resolved absolute image URLs as equivalent to their canonical document-relative sources at sync, readiness, and natural-size boundaries; compact image insertion returns focus to the stable top-bar trigger and the collection tabs meet the 44px touch target.
- `media-01-browser-acceptance.md` records the exercised boundary and the remaining deployed-infrastructure limitation.
- An independent reviewer read the production and browser diff and returned **ACCEPT with no P0/P1**. It confirmed complete Fabric source-comparison coverage, persistent compact focus ownership, the shared-tabs override, and truthful route/repository/privacy fixtures. `media-01-browser-independent-review.md` records the review and its nonblocking focus-race P2.

## 2026-08-28 — Integrated MEDIA-01 integrity closure

Status: **no remaining P0/P1 findings; local real-browser acceptance passes; deployed-infrastructure acceptance remains open**

Cross-boundary remediation evidence:

- The final independent review traced the repository, dialog, editor commit, WebMCP proposal/apply, canonical document, Fabric sync, and renderer paths as one system. Every previously reported P0/P1 was closed: exact managed-asset revalidation, archived-reference scoping, public/private identity coherence, corrupt local bytes, asynchronous dimension reconciliation, Fabric per-node failure containment, duplicate `/used` writes, indeterminate upload progress, reference-navigation close-lock bypass, and stale list/proposal application.
- Managed insert and replace now refetch exact authoritative metadata immediately before the local draft commit and accept only a currently selectable asset. The dialog does not also mark the asset used; the successful editor-owned commit performs exactly one awaited `/used` mutation. The selection lock remains active through that side effect.
- Applying an accepted WebMCP change set gathers every managed asset identity from the accepted commands, refetches each exact record, verifies selectability, confirms the same pending change set is still current, and repeats the document snapshot conflict check after the asynchronous boundary. The Review panel exposes this state as `Checking images…` and disables accept, reject, discard, and apply actions until the check settles.
- Local inventory treats IndexedDB metadata as advisory and the Blob as authoritative. It checks record shape, MIME, byte length, and bounded browser decode; corrupt or undecodable data is atomically quarantined and excluded from ready inventory and storage counts. Authoritative decoded dimensions reconcile only under a revision-plus-`updatedAt` compare-and-swap. Archive or a competing inventory pass wins cleanly instead of allowing a stale decoded record to reappear.
- The Media dialog performs one verified inventory read per refresh and derives its storage summary from those same records, avoiding a second decode pass. Fabric image-load failure creates a bounded placeholder for that node and does not abort the remaining canvas synchronization; the full adapter regression proves later objects are still added, moved, and indexed.
- Reference navigation now uses the same close request as Escape and the close button. An active upload or settling selection cannot unmount the dialog or cancel work through the nested archive-impact route.

Verification evidence:

- The final repository-wide non-browser gate passes lint, all eight package typechecks, `git diff --check`, and **448/448 tests**: worker-boundary 11/11, render-view 5/5, Renderer 32/32, WebMCP 33/33, editor 83/83, document 123/123, and Studio 161/161.
- The independent reviewer separately reran canonical focused suites: WebMCP 33/33, local asset store 19/19, Studio media catalog/repository/model/preview 28/28, and the full Fabric adapter 21/21. It reports no remaining P0 or P1 issue in the integrated MEDIA-01 code.
- Explicit local race regressions cover undecodable same-size/same-MIME bytes, authoritative dimension repair, archive winning while decode is pending, and two concurrent inventory reconciliation passes. Authored Playwright cases cover exactly one `/used`, indeterminate-to-determinate progress, archive-after-list exact revalidation, archive-after-WebMCP-proposal revalidation, and upload/selection close-lock navigation.

Browser closure and known limitation:

- The authored production browser suite passes **18/18** against port 3001. This closes the retained visible-interaction gap for the local Studio, including exact managed-media revalidation, local reload continuity, upload lifecycle, deletion review, geometry-safe replacement, responsive focus restoration, and compact touch targets.
- Actual multipart/R2 behavior, the deployed D1 migration, workspace isolation against the deployed principal, quota telemetry, and retained deployment artifacts remain mandatory infrastructure release evidence. The local route-mocked browser suite does not claim those deployed boundaries.
- A very small eventual-consistency interval remains between the final exact metadata response and the synchronous local draft commit if a second client archives the same asset at that precise instant. Archive is non-destructive and existing references intentionally remain renderable, so this is not a data-loss or release-blocking defect. Strict elimination would require a server-issued lease/version token or a server-atomic draft mutation and belongs to a future collaborative-document consistency phase.

## 2026-08-28 — ASSET-02 phase-entry contract

Status: **in progress; document migration and shared projection first**

Accepted contract:

- Re-read the complete domain/render and editor/UX ASSET-02 audits before implementation. The current `fit` plus `cropX/cropY` model is only semantic cover/contain alignment; it cannot represent an inner image transform, a crop session, flip/rotation, or frame-local clipping.
- The persisted/API contract uses readable placement controls: `mode: fill | fit | manual`, normalized focal coordinates, cover-relative zoom, inner rotation, and independent horizontal/vertical flips. Raw matrices are not public document or API input. One pure projector derives the affine geometry consumed by Fabric, React preview, HTML, PNG, and PDF.
- The outer image frame remains canonical geometry. Image placement is non-destructive content inside that frame. Replacement preserves placement, frame mask, frame geometry, opacity, lock/visibility, binding, and accessibility intent unless the user explicitly resets them.
- The first honest mask scope is image-local rectangle, normalized rounded rectangle, and ellipse. Figma-style sibling alpha/luminance masks remain a future scene-graph feature; they will not be simulated with renderer-only Fabric state.
- Draft documents move to schema version 2. Version 1 cover/contain nodes migrate deterministically to fill/fit placement, receive a rectangular frame mask and explicit non-decorative intent, and record named migrations. Empty legacy alternative text records an unresolved accessibility migration. Immutable published version 1 templates are not rewritten in place and require the existing republication path.
- Manual zoom is relative to the rotation-aware frame-covering scale. Values below 1 are valid so entering manual mode from Fit can preserve visible pixels; the crop UI owns legal-boundary resistance and exact commit clamping. Rounded radius is normalized to the shorter frame edge.
- Inspector replacement is layer-scoped. A source-bound layer must not silently detach, update every linked layer, or apply only the new alt while the source reverts. It is blocked with the bound field named and directs the user to Fields for a shared update or to unbind Source for a layer-only replacement.

Ordered implementation:

1. Land the schema-v2 migration, strict image schemas, shared affine/clip projection, and numeric tests.
2. Migrate every document producer, command, inspector, Fabric, React/HTML renderer, WebMCP/API, and conformance fixture to the new canonical placement without duplicate fit/crop truth.
3. Add the ephemeral crop-session controller: pointer previews write no history, Done/Enter commits one `Crop image` transaction, and Cancel/Escape commits none.
4. Add direct-manipulation crop UI, gesture arbitration, compact crop bar, focus/keyboard/accessibility behavior, and replacement/reset/mask flows.
5. Run full non-browser gates and independent code review. Authored browser acceptance remains unexecuted until the unhealthy host is recovered; no visible-runtime claim is allowed before that evidence exists.

### Binding-aware replacement slice

- The Inspector's Replace image action remains layer-scoped. Before any library, local, managed, or direct-file replacement mutates state, Studio inspects the target's canonical `src` binding. A bound source is not detached and is not overwritten with a value that field materialization can later revert.
- A blocked replacement names the shared asset field, reports how many layers share it, keeps the media dialog open, and gives two truthful next steps: change the value in Fields to update every linked layer, or unbind Source to replace only this layer. The guard runs in the visible selection preflight and again at the editor commit boundary; asynchronous local/managed paths therefore remain protected against a binding added after the picker opened.
- Unbound replacement still produces one direct node update. It changes only `assetId` and `src`; authored alternative text, decorative intent, placement, frame mask, frame geometry, outer rotation, opacity, visibility, lock state, node identity, selection, and stack position remain unchanged. New image insertion now creates the explicit schema-v2 fill placement, rectangle frame, and non-decorative intent.
- Focused pure tests cover the direct unbound patch with full presentation/accessibility preservation and a two-layer shared-field block with exact actionable copy. The authored media browser contract now expects alt preservation for library, local-repair, and managed replacement, but remains unexecuted under the host restriction.

### Shared image projection slice

- `projectImagePaint` is the one pure geometry boundary. It returns an affine transform that maps natural source pixels into frame-local pixels plus renderer-ready rectangle, rounded-rectangle, or ellipse clip geometry. Positive image rotation follows the browser's y-down clockwise convention. The canonical document keeps ergonomic placement fields and never stores this matrix.
- Fit derives the largest scale whose oriented source bounds stay inside the frame. Fill and Manual derive their zoom base from the inverse-rotated frame-corner extents, not the source's axis-aligned rotated bounding box; this keeps all four frame corners covered at arbitrary angles when zoom is at least 1. Focal travel is clamped in source-local axes. Manual zoom below 1 switches to oriented-bound alignment so a Fit-to-Manual conversion can preserve the exact visible pixels.
- The projector rejects non-finite or non-positive dimensions and zoom, clamps focal coordinates to `[0, 1]`, caps zoom at 64, normalizes rotation to `[-180, 180)`, and clamps rounded radius to the schema's `0..0.5` shorter-edge range. The schema remains responsible for reporting invalid canonical input; projection-side clamping is defense for preview/render callers.
- Legacy `projectImageLayout` remains available through an explicit structural `cover | contain` input. Focused tests prove its old source/destination geometry, new zero-rotation equivalence, Fit bounds, rotation-aware Manual coverage across focal/flip combinations, exact Fit-to-Manual conversion, flip centering, normalization, all frame clips, and invalid-number rejection.
- Verification passes with **11/11 focused projection tests and 1,493 assertions**, complete `@webmcp/document` **142/142**, document typecheck, repository lint, and scoped Prettier. No Vite, browser, build, or Playwright process ran.

### Fabric image consumer slice

- Fabric no longer derives crop rectangles from legacy `cover | contain` fields. `projectFabricImagePaint` consumes `projectImagePaint` and converts its source-pixel-to-frame affine into a center-origin Fabric image with natural source dimensions, uniform scale, inner rotation, independent flips, focal translation, and zero legacy `cropX/cropY` offsets.
- The image group now uses Fabric's public `FixedLayout`. Its width, height, outer position, outer rotation, controls, and history patch remain the canonical image frame even when the inner image rotates or extends outside that frame. Rectangle, shorter-edge rounded rectangle, and ellipse clips are centered in that fixed frame's local coordinate system.
- Same-source resync mutates the existing inner `FabricImage` and replaces only the derived clip object. It does not decode or rebuild the source. Source changes still take the existing explicit reload path. Invalid decoded natural dimensions throw into the existing per-node missing-image containment boundary instead of projecting against a synthetic `1 x 1` source.
- Focused tests reconstruct the affine from the actual Fabric child matrix for Fill, Fit, and rotated/flipped Manual placement. They also prove canonical group geometry, ellipse and rounded clips, frame resize, retained image identity during placement/mask sync, invalid natural-dimension rejection, and the pre-existing missing-image continuation path. The consumer-only editor gate passed **94/94** with editor typecheck and scoped Prettier. The later combined crop-manipulation gate below also passes repository lint. No browser, Vite, build, or Playwright process ran.

### Fabric crop direct-manipulation slice

- Crop mode is an explicit `CanvasImageCropMode` adapter input with an `onImageCropPreview` event. It does not infer editing state from selection. `FabricArtboard` forwards that input and event, reapplies the mode after asynchronous document sync, and draws a screen-stable frame label while crop is active.
- A primary-pointer drag on the target image converts page movement into the rotated frame's local coordinates. It then solves focal movement from `projectImagePaint` response vectors. Fill enters equivalent Manual placement. Fit computes the cover-relative Manual zoom that preserves its exact starting affine before the first pixel moves.
- The target frame becomes non-selectable with every outer transform locked. Other canvas objects become non-selectable and non-evented for the crop session. Pointer movement updates only the existing inner image and emits a canonical placement preview. It never calls `onNodesChange`, writes history, or changes outer frame geometry. Canvas pan still owns hand, Space, and middle-button gestures in the parent capture handler.
- Exit restores every object's captured interaction flags and makes the crop target active again, so ordinary frame handles return without another click. Transient Fabric selection-cleared events are ignored during crop. Object-moving and object-modified fallbacks restore canonical geometry and emit no document mutation if Fabric dispatches an unexpected transform event.
- Focused tests prove exact Fit-to-Manual entry, preview-only drag, fixed frame geometry, blocked peer movement, no `onNodesChange`, retained crop source, restored interaction flags, and a normal geometry callback after exit. Editor passes **96/96**, Studio passes **184/184**, both package typechecks pass, repository lint passes, and the four touched files pass scoped Prettier. No browser, Vite, build, or Playwright process ran.

### Fabric crop overflow-preview and unavailable-image slice

- Active crop now removes only the target group's frame clip and disables Fabric object caching. The existing inner `FabricImage` remains the sole paint source and keeps the affine from `projectImagePaint`; no duplicate crop transform or second decoded image was added. The fixed `Group` dimensions and event boundary remain unchanged.
- `FabricArtboard` places a 40 percent neutral dimmer over the artboard only. An SVG luminance mask cuts the canonical frame out of that dimmer. Rectangle, normalized shorter-edge rounded rectangle, ellipse, and outer-frame rotation use exact page-coordinate geometry. The clear frame interior therefore shows the image normally while overflow remains visible but subdued.
- Exit and cancellation restore the same pre-crop Fabric clip object, the original caching policy, and normal interaction flags. Tests cover all three frame masks, rotated frame geometry, unchanged inner-image identity, fixed canonical bounds, exact clip identity restoration, and the artboard-scoped 40 percent mask.
- Fabric rejects crop entry for missing-image placeholders or groups without a decoded `FabricImage`. `FabricArtboard` reports one typed `image_unavailable` failure. The document editor cancels only the matching crop session, clears its toolbar state, and reports that the image could not be loaded; a stale rejection cannot close a newer crop session.

Open limits:

- This slice proves geometry, not resource acquisition or pixels. Callers must still supply verified natural dimensions and handle decode/readiness failure. Fabric, React, HTML, PNG, and PDF must consume this projection and pass the retained structural and pixel corpus before export parity can be claimed.
- Fit or Fill states with a non-default zoom remain mathematically deterministic, but the interaction layer should convert direct scale/pan edits to Manual. Manual zoom below 1 intentionally permits visible frame area; crop-session commit policy decides when frame-covering placement is required and clamps before writing canonical state.
- Direct manipulation in this slice pans the image only. Numeric zoom/rotation/flip controls and keyboard movement use the session/toolbar paths owned by Studio. Resize and rotation handles for the inner source are not present yet.
- Browser pointer capture, touch behavior, camera arbitration, cursor rendering, overflow pixels and mask antialiasing, commit/cancel focus return, and the one-history-entry result remain authored or structural claims until the retained browser suite runs on a healthy host.
- The replacement-focused suites pass 4/4 across two files. Owned ESLint, Prettier, repository whitespace checks, and the full Studio typecheck now pass. The browser-facing replacement and crop contracts still require the retained healthy-host interaction and pixel suites described above; no compiler exception remains for this slice.

### Studio crop-session and visible-control integration

- Studio now mounts the crop session as a real editor mode. Image double-click and the Inspector's **Crop image** action share one entry path; compact entry closes the modal sheet before enabling the canvas. Active text editing is committed before crop starts so its exit patch cannot race the crop mutation guard.
- The fixed, non-modal crop bar exposes Fit, Fill, logarithmic image zoom, inner rotation, horizontal/vertical flip, centered Reset, Cancel, and Done. It remains in screen space above the page filmstrip, keeps 44 px compact targets, confines horizontal overflow to the control row, and keeps Cancel/Done visible. The ordinary camera zoom bar is hidden while crop is active.
- Crop previews update the ephemeral session and `previewDocument` only. The hook keeps a synchronous session ref so repeated Enter/button activation cannot apply twice. Done/Enter emits one typed `set_image_placement` transaction labeled **Crop image**; unchanged Done and Cancel/Escape add no history. Selection and page changes apply a valid changed draft once before continuing. Undo/Redo first cancel the uncommitted draft; unrelated mutations are blocked until crop exits.
- Keyboard arrows reposition the image draft, with Shift for the larger step. Trackpad wheel/pinch remains camera-owned; image scale uses the visible image-zoom control. Fit zoom retains the Fit projection base until a direct drag converts it to equivalent Manual placement, preventing a first-movement jump from Fit scale to cover scale.
- The image Inspector now exposes typed rectangle, normalized rounded-rectangle, and ellipse frame-mask commands under **Change image frame** history, plus explicit decorative-image intent. Marking an image decorative clears alternative text atomically; non-decorative images retain a visible alternative-text control. Direct source strings are read-only in the Inspector and route users through binding-aware **Replace image** instead of creating incoherent `src`/`assetId` pairs.
- Focused routing coverage proves image double-click, text double-click isolation, and empty-canvas zoom remain distinct. A rotated/flipped drag regression proves page-space movement is projected through outer rotation and the canonical inner affine. The current non-browser gates pass editor **97/97**, Studio **184/184**, document **142/142**, WebMCP **33/33**, renderer HTML **18/18**, and render-view **5/5**, with package typechecks and owned lint green. Browser pointer/touch/focus/pixel acceptance remains deliberately unclaimed on the unhealthy host.

### ASSET-02 independent review remediation

Status: **no remaining P0/P1 finding after independent code review; real-browser, pixel, and deployed-render evidence remain open**

Phase-entry evidence:

- Re-read the independent ASSET-02 implementation review, its accepted UX contract, and the retained domain/render contract before each remediation slice. The work below addresses review findings P1-01 through P2-04 without changing the readable persisted placement contract or introducing renderer-private matrices into the API.
- Revisited OpenPencil's canvas input arbitration, pan/zoom scheduler, selection transforms, and direct-manipulation source before implementing gestures. The applicable pattern is one owner for each gesture, screen-space deltas converted at the canvas boundary, transient manipulation outside canonical history, and one semantic commit when the session exits.
- Preserved the existing central seams: `projectImagePaint` owns geometry, the crop session owns atomic draft/apply/cancel semantics, the typed command registry owns discrete image actions, and Studio owns document history. Parallel implementations are rejected rather than reconciled later.

Implemented evidence:

- Image source readiness is keyed by node ID plus exact source identity and projected into image capabilities. Fabric reports loading, ready, or unavailable without allowing stale callbacks to overwrite a replacement. Crop is unavailable until decoded pixels are ready. The visible recovery surface distinguishes loading from unavailable content and routes users to locate a replacement, retry, or remove the layer while keeping frame geometry intact.
- Managed image insertion and replacement compare browser-decoded dimensions with authoritative metadata before canonical mutation. Renderer materialization carries verified source identity, dimensions, hash, and revision instead of discarding integrity metadata. Mismatches fail with stable, node-specific errors rather than silently changing the crop projection.
- Replacement is an atomic visible handoff in both Fabric and React. The previously decoded image stays mounted while a candidate loads; only a ready candidate is promoted. A failed or stale candidate cannot remove the old pixels. The canonical mutation uses the typed `replace_image_source` command, produces one **Replace image** history entry, and preserves placement, frame, geometry, accessibility intent, lock/visibility, opacity, and bindings.
- The image command registry now covers insert, replace, crop/apply/cancel, Fit, Fill, both flips, rotate left/right, reset rotation, reset crop, and rectangle/rounded/ellipse frame shapes. It owns labels, history labels, mutation metadata, shortcuts, capabilities, dispatch, and multi-image drafts. Studio's Inspector, crop toolbar, keyboard path, and shell dispatch these command IDs instead of maintaining separate discrete-action switches. Numeric focal, zoom, and inner rotation commits route through typed `set_image_placement`; exact rounded-radius commits route through typed `set_image_frame_mask`. Neither uses a generic node patch.
- Crop keyboard movement is defined in screen pixels. Arrow keys move one screen pixel and Shift+Arrow moves ten; the adapter converts that delta through camera zoom, outer frame rotation, inner image rotation, flips, and the canonical projector. Tests cover camera zoom from 0.25 through 4 plus invalid zoom defense.
- The canvas application region has stable instructions and mode-aware keyboard ownership. Enter, Escape, and Undo route through the central crop command contract, while arrow keys remain the geometry-specific adapter path. Compact and desktop crop entry preserve opener provenance and the toolbar selects top or bottom placement from frame visibility rather than blindly covering the selection.
- Two-touch behavior has exact spatial arbitration. A gesture whose midpoint begins inside the active crop frame scales and translates image content around that midpoint; rectangle, rounded, ellipse, and rotated frame hit tests use exact frame-local geometry. A gesture begun outside the crop frame remains camera pan/zoom. The active owner captures the sequence until all touches end, so a remaining finger cannot leak into the competing gesture.
- Direct crop-frame resizing now uses eight screen-stable handles with 24 px hit targets, rotation-aware cursors, pointer capture, and handle-scoped `touch-action`. Every preview derives from the immutable pointer-down frame. Screen movement is converted through camera zoom and outer-frame rotation; Shift preserves aspect ratio and Alt/Option resizes around the frame center. The projector rebases placement to Manual while preserving the exact source-to-page affine. Frame geometry, placement, and frame mask live in the same crop draft, and Done emits one ordered **Crop image** transaction containing only the changed commands.
- Crop resize handles are pointer affordances hidden from the accessibility tree rather than keyboard-inert buttons. The Inspector's labeled numeric frame and image controls remain the precise keyboard-accessible path.
- Cross-surface structural parity now retains a nine-case image corpus spanning landscape, portrait, and square sources; all mask shapes; focal extremes; zoom, rotation, and flips; and 1x/2x output dimensions. Document projection, Fabric, React render-view, and Renderer HTML assertions consume the same affine and clip contract. This is structural parity only: browser-raster Fabric/React/PNG/PDF baselines remain blocked by the host and are not claimed.
- Crop invalidation reasons are no longer discarded. Document replacement, page changes/removal, target removal/replacement, source or placement changes, lock, and visibility changes emit one truthful cancellation message and keep the last committed state. Structured WebMCP placement and frame-mask no-ops compare canonical values by content, preventing reference-unequal objects from creating empty review operations.
- A mounted React integration now exercises the real document editor hook and crop toolbar. Fifty previews leave the canonical document, snapshot ID, operation version, and history untouched. Duplicate Enter plus Done produces exactly one **Crop image** commit; Undo and Redo restore the exact baseline and committed document objects/snapshot IDs. Duplicate cancellation, review cancellation, and active-crop Undo/Redo commit nothing; selection and page settlement commit once. This proof exposed and fixed a real missing `@webmcp/editor/layer-tree` package export.
- `inspect_design` now accepts a serializable projection of the editor's exact typed command policy. `@webmcp/editor` produces command ID, product label, and enabled state from the same context used by toolbar, inspector, keyboard, and canvas; Studio supplies that projection to WebMCP. Automation clients no longer need to guess availability from lock state or document shape.
- High-frequency crop preview state now lives in a target/source-guarded external store. Fifty pointer previews schedule one animation-frame publication, leave the Studio shell at one render, and cause one subscribed toolbar update. Done reads the latest live revision synchronously even before the frame flush, while Fabric and Inspector subscribe narrowly to placement, frame, and mask drafts. Canonical document, snapshot, operation version, and history remain unchanged until the one semantic apply.
- `inspect_design` command capabilities are read through a live getter rather than a render-time array, so Fit, Fill, reset, rotation, and crop availability cannot go stale while preview isolation intentionally avoids shell renders. Source-bound replacement is projected as disabled before the picker opens, with the same exact shared-field/fan-out explanation in Inspector, the command registry, and WebMCP.
- A mounted React composition now runs the real `useDocumentEditor` and `useStudioWebMcp` hooks together, registers the actual `inspect_design` tool, selects a source-ready image, and enters crop. A live Manual/focal/rotation preview changes Reset, Fill, and rotation-reset capabilities before the external store publishes its next animation-frame snapshot, while the composition render count stays fixed. After publication the same inspection stays current; reverting the live draft before the following publication disables those commands again without a render. This closes the render-time-capture gap with a production-equivalent mounted test rather than a mutable stand-in value.
- **Resize frame to image** is now a reachable crop command. Fabric supplies verified decoded natural dimensions; the command first proves a safe non-no-op projection, then preserves the exact source-to-page affine while resizing/repositioning the outer frame and rebasing the placement. The visible crop toolbar exposes a screen-stable action, and the eventual Done remains one **Crop image** history transaction.
- A selected image now has a responsive context toolbar beside the canvas workflow: Crop, Replace, Fit/Fill, flips, and a More menu for image rotation, reset, and frame actions. Compact widths progressively collapse secondary controls instead of overflowing. Every action dispatches the central typed command ID and uses its enablement policy.
- Missing images preserve exact canonical frame geometry down to 1 x 1, remain selected at the same stack index, and show an in-frame label only when it fits. Inspector exposes retry source acquisition, locate replacement, and remove layer. Retry now decodes and swaps only the requested Fabric object while preserving its siblings, stack index, and selection; it does not remount the canvas or edit the document. Locate observes binding-aware replacement capability, and Remove uses the normal undoable deletion path. Page, filmstrip, and template thumbnails suppress recovery controls so a failed image can never create nested buttons inside a selector. A mounted React/jsdom regression now forces real `Artboard` image failures inside page-output and template selectors, observes the resulting display-only unavailable state, and proves there is no focusable Retry descendant or failure-driven outer selection. This replaces the earlier mocked-prop assertion with rendered interaction evidence.
- Active-crop Inspector X/Y/width/height/frame rotation, focal position, inner zoom/rotation, flips, and frame-mask controls all edit the same live crop draft. Numeric frame resize requires verified natural dimensions and rejects an unrepresentable affine instead of silently changing pixels. Placement and mask edits remain ephemeral, then settle together as exactly one **Crop image** transaction.
- Managed and library replacement now uses a prepared-resource token and waits for exact node/source/dimension acknowledgements from the mounted Fabric canvas and React filmstrip before the one typed canonical commit. Renderer failure, mismatch, target change, commit rejection, stale acknowledgement, or timeout clears the tentative preview and preserves the old canonical document/history and displayed pixels. The token is callback-only and never enters the document or API.
- The retained performance fixture contains 20 pages and 160 distinct images. It proves same-page selection rerenders no thumbnails, page switching rerenders exactly the old and new thumbnails, and fifty crop previews coalesce into one frame with zero shell/filmstrip rerenders and exactly one toolbar plus active-page renderer update after flush. This test exposed and fixed unstable active-page callbacks that had invalidated every thumbnail.
- Local image replacement now creates, decodes, and dimension-verifies the exact object URL before one typed `replace_image_source` commit. Activation or commit failure revokes the URL, rolls back persisted bytes, and leaves canonical document, snapshot, and history untouched. Alt-text provenance is canonical data: generated defaults refresh for a replacement, direct alt edits become authored, and authored/decorative intent is preserved.
- Viewport-wide `touch-action: none` was removed. Touch suppression is scoped to active direct-manipulation handles, while non-passive gesture listeners claim only editor-owned wheel, pinch, or two-touch sequences. This restores the architectural boundary between editor gestures and native/assistive input outside the active manipulation surface.
- Studio's Vitest discovery now includes both `.test.ts` and `.test.tsx`. This closed a false-green hole where the crop-frame overlay and rendered Inspector tests existed but were silently skipped by the package command; both are now collected by the full suite.

Current verification:

- The final integrated non-browser gate passes Studio **291/291** across 59 collected files, editor **171/171**, document **149/149**, WebMCP **41/41**, render-view **12/12**, and Renderer **41/41**. Studio, editor, document, WebMCP, render-view, and Renderer typechecks pass. The ASSET-02 Studio slice passes scoped ESLint and Prettier; repository `git diff --check` passes. An independent line-by-line code review reports no remaining concrete P0 or P1 defect in the reviewed slice. The retained cross-renderer image corpus remains structural evidence, not pixel evidence.
- The healthy-host browser restriction remains in force. There is no active Vite server. Eleven orphaned macOS `workerd` processes remain in uninterruptible `UE` state, so starting another server would repeat the earlier multi-server failure and cannot produce trustworthy browser evidence.

Remaining evidence boundary:

1. Browser acknowledgements cannot prove that a later Worker, published page, PNG, or PDF process can decode the same resource. The local server render-admission contract below now proves that boundary independently; deployed Browser Rendering and retained artifacts remain release evidence.
2. The 20-page mounted contract proves React ownership and commit counts, not real Chromium frame time, long tasks, off-screen decode retention, or lifecycle cleanup.
3. The mounted React/WebMCP composition now proves live capability reads before and after external-store publication without a composition rerender. The healthy-host browser suite must still repeat the journey through the browser-owned WebMCP bridge and retain its trace; that is runtime evidence, not an open command-policy implementation defect.

### ASSET-02 server render admission and artifact readiness

- Managed aliases are resolved only in a transient server render clone. The repository verifies stored hash and structural dimensions, while each exact image node receives a renderer expectation containing asset identity, natural dimensions, content hash, and revision. The canonical document and editor history remain unchanged.
- Before capacity reservation or durable job insertion, the server proves node existence/type, exact asset identity, and exact inline-byte SHA-256. The private Renderer repeats that admission before Browser Rendering, requires an explicit expectation manifest on every request, then compares browser-decoded natural dimensions before PNG/PDF generation or R2.
- Draft PDF and private PNG routes now use the same materialization/admission path, so a real Asset Library document no longer fails by sending `asset:managed/...` aliases directly to render policy. Local inline export sources remain valid and are not misclassified as managed merely because their local IDs share the `asset-` prefix.
- Node-specific renderer failures are parsed from a bounded 1,024-byte response and retained as stable job error codes with node/asset detail instead of being collapsed to `renderer_failed`. Only stored-artifact metadata can advance a durable job to completed.
- A concrete expectation-collapse defect was closed: distinct managed identities with identical bytes are now captured per node rather than recovered from a data-URI-keyed map. Initial field resources are reused by asset ID instead of triggering a second repository read.
- Durable implementation and release evidence is recorded in `asset-02-server-render-admission.md`. Document **155/155**, Renderer **43/43**, and Studio **299/299** across 62 files pass with typechecks; the Studio server-focused admission/materialization/error slice contributes **12/12** passing tests.

Open release evidence:

- A separate free-rotation handle is intentionally not required unless it can be visually distinguished from frame rotation. Free rotation remains available through the exact numeric control, while 90-degree steps, scale control, one-pointer pan, two-pointer scale/translation, direct frame resizing, and **Resize frame to image** cover the accepted crop workflow.
- The retained healthy-host suite must still exercise pointer capture/cancellation, trackpad browser-zoom prevention, two-touch crop-versus-camera arbitration, focus return, software-keyboard behavior, compact 320px/200 percent placement, 44 px targets, load/error replacement handoff, a real Chrome performance profile, and the 1x/2x Fabric/React/Renderer/published PNG/PDF pixel corpus. No non-browser test is presented as a substitute.

## 2026-08-28 — PERF-01 renderer-backed page filmstrip

Status: **implementation, independent code review, and non-browser gates complete; healthy-host profiling remains open**

Implementation evidence:

- Revisited the retained performance audit and OpenPencil's preview scheduler before implementation. The adopted boundary keeps visibility, active-page ownership, and keyboard navigation in React while a framework-independent cache owns bounded asynchronous raster work and Object URL lifetime.
- The active page remains a live `Artboard`. Inactive pages are admitted by one scroll-viewport `IntersectionObserver` with a 240 px preload margin and use exact aspect-fitted low-resolution PNGs. CSS content containment limits off-screen layout/paint work without removing page selectors from the accessibility model.
- The cache is keyed by document, selected-page visual/dependency revision, renderer revision, and raster size. It deduplicates concurrent requests, limits production to three requests, retains at most 64 LRU entries, rejects stale work by exact pending identity and settled/abort state, propagates aborts, and revokes every Object URL during invalidation, eviction, replacement, clear, and disposal. Unrelated page/snapshot changes reuse completed rasters; changed and removed pages abort and evict only their superseded keys. Leaving the viewport margin or becoming active cancels unfinished work while retaining a completed entry. Strict Mode and mounted producer-replacement regressions prevent work through disposed caches.
- Transient network, 408, 425, 429, and 5xx failures retain the live page fallback and retry at most three times using `Retry-After` plus bounded exponential backoff. Mounted evidence proves a transient failure recovers without visibility churn. Filmstrip hits use the recency-touching cache request path; a 65-entry mounted revisit regression proves the retained 64-entry policy evicts the older unused raster rather than the recently revisited page.
- Page selectors use roving focus across the 100-page fixture. ArrowLeft, ArrowRight, Home, and End select and focus the corresponding page; only the active page and its overflow action enter the tab order.
- Studio exposes an authenticated `POST /v1/studio/page-thumbnail` boundary. It validates strict input and nearest-pixel aspect, materializes and admits exact managed resources, reserves an isolated thumbnail capacity lease against requested pixels, forwards abort checkpoints through managed-resource preparation/admission and the private Renderer, and validates render/page/output/dimension/byte identity before settlement. Rejected settlement RPCs remain retryable.
- Client and Studio both project the current snapshot to one canonical output/page pixel-render graph before transport and render admission. It retains nodes and page-owned groups while removing fields, current/default field values, and bindings because canonical commands already apply bound values to nodes and the HTML renderer paints nodes only. A realistic multi-megabyte bound-image regression proves the managed source occurs once and stays below the private 8 MB boundary. A retained real-boundary test sends a valid 100-page document and proves only page 100 reaches the renderer, avoiding the publication renderer's 40-page aggregate limit and unrelated resource work.
- Renderer uses the exact low-resolution viewport, a uniformly scaled canonical page, `fullPage: false`, managed resource readiness, and PNG IHDR verification. Successful thumbnails are direct `no-store` responses and never read or write R2. The real 2x portrait filmstrip contract is retained: 1240 x 1754 produces 102 x 144.

Verification evidence:

- The focused Studio cache/producer/filmstrip/server gate passes **67/67** across six files. Focused Renderer/Document thumbnail and render-policy coverage passes **44/44** and **22/22** respectively.
- The sequential repository-wide non-browser gate passes Studio **353/353** across 66 files, editor **171/171**, document **172/172**, WebMCP **41/41**, render-view **12/12**, Renderer **51/51**, and worker-boundary **11/11**, for **811/811** tests. All eight package typechecks and the full lint gate pass.
- Running repository tests concurrently with the full typecheck temporarily starved one history timeout and perturbed one render-count timing assertion; both focused reruns passed, and the normal sequential repository test command then passed completely. This is recorded rather than hidden as a false green.

Open evidence and budget boundary:

- No Vite, Browser Rendering, build, browser, or Playwright process was started on the unhealthy host. Real scroll/input latency, rapid-churn cancellation, memory/Object URL release, and portrait/landscape/square visual parity remain mandatory browser evidence.
- Each request now carries only the canonical selected-page pixel-render graph. A browser/network profile must still quantify that smaller transfer plus Worker startup cost at 100 pages. If either dominates the budget, the next contract should register one content-addressed snapshot or batch visible page requests rather than weakening identity checks.

## 2026-08-28 — Cancellable canvas transform sessions (HIST-01 follow-up)

Status: **implementation, independent code review, and non-browser gates complete; healthy-host pointer acceptance remains open**

Implementation evidence:

- Ordinary move, resize, and rotate gestures now have a framework-independent transform-session boundary. It captures immutable canonical geometry with document/page identity at Fabric's public `before:transform` event, keeps pointer preview Fabric-local, emits one existing node-change batch on a real completion, and emits nothing for a click/no-op.
- `CanvasAdapter` and `FabricArtboardHandle` expose `cancelTransform()`. Studio's single Escape resolver owns the exact order: cancel crop, cancel text editing, cancel an ordinary transform, then clear selection. Successful cancellation uses Fabric's public `endCurrentTransform()`, suppresses its trailing modified event, restores the exact canonical baseline, clears guides, renders once, and preserves single or multi-selection.
- Sync, page/document replacement, review/noninteractive transitions, selection replacement, and unmount settle an active transform before discarding Fabric state. Stale or rejected completions restore through one generation/document/page-guarded microtask after Fabric's finalizer instead of recursively rebuilding a selection inside `object:modified`.
- ActiveSelection child patches are projected in canvas/world geometry. Line restoration reapplies canonical position after Fabric recalculates endpoints. Canonical resync also clears Fabric-only skew and outer flips so rollback is exact after a hostile group transform.
- Multi-selection resize is constrained to the canonical model: side handles are hidden, corner handlers remain uniform even while Shift is held, and scaling flips are locked. A defensive completion check rejects and restores any nonuniform group resize that arrives programmatically. Fabric-created Shift/marquee selections receive the same policy immediately; any selection containing a locked node is inspectable but cannot begin a transform.

Verification evidence:

- Focused transform, Fabric adapter, artboard, and Escape tests pass **76/76**. Coverage includes single/multi baselines, no-op and duplicate lifecycle events, exact Escape rollback, trailing-event suppression, stale context, rejected commits, removed pages, selection replacement during a live drag, Fabric-created mixed locked selections, rotated nonuniform multi-selection rollback, and stale queued-restore invalidation.
- The sequential repository-wide non-browser gate passes **842/842 tests**: Studio 359/359, editor 196/196, document 172/172, WebMCP 41/41, Renderer 51/51, render-view 12/12, and worker-boundary 11/11. All eight package typechecks, full lint, Prettier on the owned files, and `git diff --check` pass.
- Independent line-by-line review found and drove fixes for ActiveSelection world geometry, mixed-lock bypass, no-move session release, stale queued rollback, external selection replacement, and unrepresentable nonuniform scaling. The final reviewer pass is retained as a gate before phase closure.

Open evidence:

- No Vite, browser, build, Wrangler, or Playwright process was started on the unhealthy host. Real mouse/trackpad pointer cancellation, selection preservation, handle visibility, Shift behavior, and visual continuity remain healthy-host acceptance evidence and are not claimed by the non-browser suite.

## 2026-08-28 — Product command discovery and contextual actions (MENU-01)

Status: **implementation and independent code review complete; essential healthy-host command discovery accepted, exhaustive contextual focus/collision evidence remains open**

Implementation evidence:

- Re-read the MENU-01 audit, top-bar placement decision, independent code review, page/output integration review, and relevant OpenPencil implementation before each slice. Loora is now recorded as the additional reference for one typed transaction/command vocabulary shared by people, menus, agents, and APIs; this reinforces the existing package boundaries rather than causing an architectural restart.
- `@webmcp/editor/product-commands` owns the registered product vocabulary, category and menu metadata, typed targets and arguments, live capability projection, disabled explanations, checked/mixed state, stable-target validation, platform shortcut formatting, palette projection, and menu builders. Runtime execution is accepted only when the host explicitly returns `true`; a missing or declining handler cannot appear successful.
- File, Edit, View, Object, Text, Arrange, and Help share one generated model. At widths of 1600 px and above they occupy the existing 48 px top bar without adding a row. Smaller widths expose the same groups through the existing More menu. Command search and the shortcut reference are available from that same registry; parameterized alignment/distribution variants have stable unique invocation IDs.
- The owned Radix menubar and context-menu wrappers render visible, non-truncated disabled explanations connected with `aria-describedby`. Mixed checked state survives into palette, menubar, context, and dropdown surfaces. Existing File and export dropdowns render registry-backed groups instead of handwritten action copies.
- Fabric emits a typed right-click request without suppressing the native browser context event. Blank-canvas context selection clears the current selection; a selected object preserves its multi-selection; an unselected object becomes the exact target before the menu opens. The existing canvas menu model and runtime perform final live validation before dispatch.
- Layer rows use the same target-aware context groups. Pointer right-click, Shift+F10, and the Context Menu key preserve an existing multi-selection only when the target belongs to it; otherwise they select the row or group exactly. The real virtualized row container is the Radix trigger, avoiding an `asChild` ref/prop loss through a custom component. Menu close returns focus to the tree.
- Page rows, output headers, and bottom filmstrip cards now expose generated context menus and generated ellipsis items from the same typed page/output targets. Shift+F10 and the Context Menu key use the native context-event path, non-active page right-click selects that page before opening, and close restores the corresponding selector. Last-page and last-output invariants retain their exact disabled explanations.
- Page/output dialogs are owned by the shell product executor. Page add/duplicate/rename/delete/move and output add/rename/delete have explicit accepted handlers. PDF capability is resolved against the targeted output ID, and PDF export receives that captured output ID instead of silently exporting whichever output is active.
- Layer menu commands capture the exact selection node IDs and selected group identity at open time. Final runtime validation rejects changed selection, page, document, snapshot, or group before the shell's selection-based executor can mutate. The independent follow-up review confirmed the earlier target-drift finding is closed.
- Production cannot enter the handwritten fixture fallback menus: `QuotationSidebar` requires the product context/runtime, and the shell renders `ProductPageFilmstrip`, whose props require both. The compatibility paths remain only for isolated component fixtures.

Verification evidence:

- Full repository lint passes. All eight package typechecks pass. `git diff --check` passes.
- Editor product-command tests pass **15/15**; the complete editor package passes **214/214**. The output-header mounted test opens the real Radix context menu from Shift+F10 and proves the dispatched invocation retains the captured output ID. The complete Studio suite passes **372/372 across 71 files** when run with one worker. Completed package totals are document 172/172, render-view 12/12, Renderer 51/51, WebMCP 41/41, and worker-boundary 11/11, for **873/873** non-browser tests.
- The default fully parallel workspace test run perturbed one render-count timing assertion in the image-heavy responsiveness contract. The exact test passed in isolation, and the complete Studio suite passed with one worker. This is recorded as test-runner resource interference rather than hidden as a false green.

Open evidence:

- No Vite, browser, build, Wrangler, or Playwright process was started on the unhealthy host. Pointer context placement, nested dropdown/context arbitration, focus return, portal collision, compact 320 px behavior, and actual top-bar visual alignment remain mandatory healthy-host acceptance evidence.
- The final independent read-only review and its follow-ups report no unresolved production-path P0/P1 defect. Healthy-host browser evidence remains a separate acceptance gate.
- A later healthy localhost smoke on 2026-08-29 verified that Cmd+K opens the
  named command-search dialog and that Shift+F10 on a real virtualized locked
  layer opens the generated target-aware menu with Copy enabled, mutation
  commands disabled with the exact unlock explanation, and Unlock available.
  This closes those two essential journeys only; the broader pointer, compact,
  collision, and focus-return matrix above is not claimed.
- The retained healthy-host regression now passes **2/2** against the routed
  Studio product on port 3001. It covers the 1920 px menubar, 390 px compact
  More-to-Help command-search path, dialog viewport containment, blank-canvas
  context discovery, and executing Select all from both the context menu and
  command search. The run exposed a real canonical defect: Select all had been
  classified as selection-scoped and therefore required an existing target.
  It is now bound to a stable active-page target, rejects page drift, and gives
  empty pages a truthful disabled reason. Independent review rejected the first
  repair because explicit WebMCP queries for a non-current page inherited the
  current UI page's enablement. The accepted correction projects canonical
  per-page node counts and derives availability from the captured page target.
  The focused product-command suite is **20/20**, WebMCP registration is
  **37/37**, affected package typechecks and focused ESLint pass, and final
  independent re-review reports no P0/P1. Full evidence is retained in
  `menu-01-browser-acceptance.md`.

## 2026-08-28 — Constrained resize and rotation snapping (GUIDE-01A)

Status: **implementation, independent code review, and non-browser gates complete; healthy-host interaction evidence remains open**

Implementation evidence:

- Re-read the GUIDE-01 phase-entry audit and the matching OpenPencil resize/rotation and Loora gesture/transaction boundaries before implementation. The resulting `transform-constraints` module is framework-independent: immutable baseline geometry, all eight handles, symmetric minimums, Shift proportions, Alt/Option centered resize, Shift+Alt, explicit rotated snap decline, 15-degree rotation snapping, and typed acquire/hold/release latches are pure inputs and outputs.
- Fabric's transform policy disables its Shift side-handle skew path. Public control coverage proves side handles remain resize actions with zero skew. Rotation and resize previews remain Fabric-local; only `object:modified` settles through the existing one-gesture transform session.
- Resize snapping reuses the page/object guide language, retains a per-axis latch with wider release hysteresis, and converts its 8 px acquire/12 px release thresholds through the live editor zoom supplied by `FabricArtboard`. Page/document sync, pointer settlement, cancellation, rejection, selection replacement, and unmount clear latches and transient guides.
- Rotated objects decline only unsafe world-axis snap correction. Local size/aspect constraints still apply, and the adapter preserves Fabric's opposite-handle point in rotated space. The public regression holds both the immutable aspect ratio and fixed anchor at 18 degrees.
- Text sizing modes have separate direct-manipulation contracts. `auto_width` exposes no resize handles. `auto_height` changes intrinsic width, reflows without glyph scaling, retains its canonical top edge, omits layout-owned height from commit, and supports axis-aligned snap plus rotated reflow. Fixed text uses its centered clip as the canonical frame while Fabric retains a potentially taller intrinsic layout box; create, sync, preview, projection, all eight public resize controls, Shift, and Shift+Alt use inverse rotated frame/anchor math so the visible clip round-trips without first-drag or settlement drift.
- The shortcut reference and interaction-model document expose Shift proportion resize, Shift 15-degree rotation, and Alt/Option center resize only after those paths became real and tested.

Verification evidence:

- The focused constraint/Fabric/Textbox suite passes **99/99**. It includes all eight pure handles, centered/minimum/aspect combinations, resize and rotation hysteresis, screen-space thresholds, real Fabric Shift side controls, all eight fixed-Textbox public controls, Shift+Alt, rotated shape anchoring, public auto-height reflow, rotated auto-height top anchoring, fixed-frame create/sync identity, no-op settlement, and guide/latch cleanup.
- The complete editor package passes **255/255 across 19 files**. The complete Studio suite passes **373/373 across 72 files** with one worker. All eight package typechecks pass; full lint, scoped Prettier, and `git diff --check` pass.
- Independent line-by-line review reproduced and drove closure of Fabric Shift skew, lost Alt centering, missing resize hysteresis, zoom-dependent thresholds, stretched Textbox snapping, rotated Shift aspect loss, auto-height vertical drift, fixed intrinsic/clip anchor mismatch, canonical fixed-text round-trip drift, and fixed-text vertical/corner handle drift. Its final verdict reports no remaining P0, P1, or P2 correctness finding.

Open evidence and next slice:

- No Vite, browser, build, Wrangler, or Playwright process was started on the unhealthy host. A healthy-host browser pass must exercise all eight handles on ordinary, rotated, and fixed-text objects; public auto-height left/right resize; modifier changes before and during a gesture; snap acquire/hold/release at fit and 100 percent; Escape, rejected settlement, Undo/Redo, page replacement, guide cleanup, visible clipped-frame handle tracking, and one history entry per gesture.
- GUIDE-01B followed this slice and is recorded below.

## 2026-08-28 — Zoom-aware rulers and persistent page-local guides (GUIDE-01B)

Status: **implementation, independent code review, and non-browser gates complete; healthy-host interaction evidence remains open**

Implementation evidence:

- Re-read the GUIDE-01B phase-entry audit and the exact OpenPencil ruler, guide geometry, hit testing, input, and explicit-snap-target sources before implementation. Loora remains the companion reference for typed transactions, synchronous history ownership, gesture boundaries, and one command vocabulary; the Studio implementation remains original and document/image/quotation-focused.
- Added a strict versioned editor-workspace sidecar keyed by document and page. It persists only ruler/guide preferences and stable guide records; camera, hover, selection, drag preview, snap latches, canonical document data, quotations, publication, renderer input, and WebMCP payloads remain outside the sidecar. Invalid or oversized storage is quarantined, page/document keys are pruned, and failed storage preserves the live session.
- Added one DPR-aware fixed viewport overlay for 20 px rulers, 1/2/5 ticks, selection bands, persistent guide lines, hover/selection/drag states, coordinate badges, and narrow screen-space hit regions. Fabric remains the canvas interaction owner outside those strips. Direct interaction covers ruler drag creation, move, Alt/Option duplicate, drag-back removal, click-without-drag, Escape cancellation, and selected-guide Delete/Backspace.
- Added an accessible **Manage guides** dialog with labelled axis/coordinate controls, inline validation, exact move/remove actions, guide-count limits, live announcements, and connected opener-focus restoration. View menu, context menu, and command search share the registered `canvas.rulers.toggle`, `canvas.guides.toggle`, and `canvas.guides.manage` commands with checked state.
- Visible active-page guides project into the same move/resize snap language as page/object candidates. Guide targets win equal-distance ties and use zoom-aware 8 px acquire / 12 px release hysteresis. Hidden guides neither paint, hit-test, nor snap, while remaining available in persistence and the manager.
- Document history now emits synchronous commit notifications at the mutation boundary. A pure bounded session ledger orders document and guide actions in the exact sequence they occur, clears the opposite redo branch on new work, breaks document coalescing across guide actions, and routes the existing Undo/Redo commands without an out-of-ledger fallback. Same-turn guide→document and document→guide tests prove chronology.
- Guide/object selection is mutually exclusive. Page/document replacement, visibility changes, review/crop transitions, modal and compact-panel opening, and unmount cancel or clear transient guide interaction state. The shared Escape resolver gives guide drag and guide selection precedence before crop, text, transform, and ordinary selection handling.

Verification evidence:

- The complete editor package passes **284/284 across 20 files**. The complete Studio suite passes **405/405 across 79 files** with one worker, including the real Vitest/JSDOM overlay, dialog, synchronous document-commit, session-ledger, guide command controller, snap projection, workspace persistence, Escape, and existing editor regressions.
- Editor and Studio typechecks pass. Focused Studio lint, scoped Prettier, and `git diff --check` pass.
- Independent code review initially rejected the slice for effect-delayed chronology, fallback history routing, missing snap integration evidence, theme access, and accessibility/focus gaps. The remediation added synchronous commit observation, the pure ledger and tests, visible-guide snap projection tests, computed-style/dark-theme coverage, guide-limit containment, and deterministic focus restoration. The reviewer then passed GUIDE-01B with no open code-level finding.

Open evidence and next slice:

- No Vite, browser, build, Wrangler, or Playwright process was started on the unhealthy host. A healthy-host browser pass must exercise mouse and trackpad zoom/pan with rulers, ruler-to-canvas creation, move/duplicate/removal, overlapping guide hit resolution, hidden-guide behavior, all zoom levels, page switching, compact/modal interruption, review transition, keyboard deletion/Escape, chronological mixed Undo/Redo, focus restoration, dark theme, and visual alignment at supported viewport widths.
- The next editor phase must begin by rereading its audit slice and the matching OpenPencil and Loora implementation areas rather than treating GUIDE-01B completion as permission to skip phase-entry review.

## 2026-08-28 — Adjustable editor workspace (SHELL-01)

Status: **implementation and independent code review complete; healthy-host browser/visual acceptance remains open**

Implementation evidence:

- Re-read the SHELL-01 contract and the actual OpenPencil workspace/splitter/layout-storage code before implementation. Loora remains the companion reference for explicit editor regions, browser-owned interaction state, typed commands, and deterministic verification; shell preferences remain separate from canonical document/history/API state.
- Replaced the fixed desktop columns with a bounded flex workspace. The document panel is 208/264/360 px, the inspector is 280/336/440 px, each visible divider owns a 12 px pointer target and 1 px line, and the resolver protects a 520 px canvas at the 1280 px desktop threshold.
- Added a versioned user-global layout repository for panel widths, collapse state, and filmstrip density. It strictly decodes the exact shape, clamps finite values, quarantines corrupt bytes, safely handles read/write failures, and now also contains a throwing `window.localStorage` property getter before the editor can render.
- The editor route is client-only because Fabric, gesture ownership, and workspace preferences are browser-owned. Saved layout and the initial viewport width are read synchronously in the first client render, preventing both the default-layout flash and a constrained 1280 px geometry flash before the real 1440 px width is known.
- Both splitters support pointer capture, animation-frame coalescing, Arrow 8 px, Shift+Arrow 32 px, Home/End, and Enter collapse. Constrained resizing materializes the visible geometry first, keeps the opposite panel fixed, reports truthful dynamic ARIA bounds, and cannot move the divider in the wrong direction. Unexpected `lostpointercapture` settles idempotently and cannot leave a stuck drag.
- Enter collapse transfers focus to the persistent matching expand control; reopening restores the last expanded width. Compact document/properties Sheets remain unchanged and independent from desktop collapse preferences.
- The page gallery is 88 px in compact mode and 96/120 px on desktop. Compact always uses compact card/thumbnail/raster geometry even when the saved desktop preference is comfortable. The desktop-only density toggle has a stable accessible name, `aria-pressed`, and visible pressed state; no inert density action appears in compact mode.
- Thumbnail rasters have intrinsic integer dimensions, placeholders disable pulse under reduced-motion preferences, page order remains `output.pageIds`, and add/context actions remain reachable. Camera/crop toolbar reserves now derive from the truthful 88/100 compact section and 96/108 or 120/132 desktop geometry.
- Workspace persistence failures are exposed through an always-mounted polite live region as well as the detailed action-menu status. Collapse controls do not point `aria-controls` at absent panels.

Independent review evidence:

- The first review rejected the slice for constrained resize reversal, lost focus after splitter collapse, an oversized compact filmstrip, an undersized compact control, missing capture-loss recovery, post-paint persistence, hidden error announcements, and thumbnail markup/motion gaps.
- Remediation re-review then caught and drove closure of three additional integration defects: a hardcoded 1280 px first-render width, an inert compact density preference control, and an uncontained throwing `localStorage` getter.
- The final independent code verdict is **PASS** with every original and follow-up P1/P2 resolved. The retained report is `shell-01-independent-code-review.md`.

Verification evidence:

- The final focused layout/splitter/filmstrip gate passes **58/58**. The broader focused shell/filmstrip/placement/performance gate passes **66/66**.
- The complete Studio suite passes **435/435 across 81 files** with one worker. Studio typecheck, reviewed-file ESLint, scoped Prettier, and `git diff --check` pass.
- A checked-in Playwright regression seeds maximum 360/440 panel widths and records the first mounted panel geometry with a MutationObserver, specifically guarding against reload flash. It is written but intentionally unrun under the current host restriction.

Open evidence:

- No Vite, browser, build, Wrangler, or Playwright process was started on the unhealthy host. SHELL-01 is not visually closed until a healthy-host pass covers 320, 390, 1119, 1280, 1440, and 1920 px; pointer drag and keyboard resize/collapse; first-frame reload geometry; compact and desktop strip heights; independent scrolling; focus; overflow; and retained screenshots against the OpenPencil-inspired target.

## 2026-08-28 — Truthful blank-document and empty-canvas start flow (START-01 first slice)

Status: **first-slice implementation and independent code review complete; healthy-host browser acceptance and the full start/recents phase remain open**

Implementation evidence:

- Re-read WF-03, the START-01 priority contract, the actual current draft/template/import paths, OpenPencil's real recent-file repository and home workspace, the local Canva clone's create/template/project dashboard flow, and Loora's canonical transaction boundary. The implementation does not fabricate a recent-project grid over the existing single mutable draft.
- Rebuilt New document as a real keyboard form with name, three editable pixel presets, custom dimensions, explicit Create/Cancel, stable field metadata, inline validation, first-invalid-field focus, sample metadata derived from the actual starter, contained creation/sample failures, and protected in-flight sample restoration. A custom name survives format changes; name-only edits preserve format identity.
- Name and finite integer dimensions are validated against the renderer's 8,192 px edge and 33,554,432 px area policies both in the form and again inside `createBlankDocument`. Direct callers cannot install a document the renderer must reject.
- Added the canonical `custom` output kind across document and WebMCP schemas instead of mislabeling portrait/story/custom documents as square. Equal dimensions use `square`; all other blank dimensions use `custom`. New blank outputs advertise both PNG and PDF support.
- Empty pages expose Add text, Add image, Choose template, and Add page using the existing editor callbacks. The surface is disabled during review/recovery, excluded from captured pan and double-click zoom, one column below 420 px, two columns above, and uses 44 px compact controls.
- Successful creation closes through the controlled dialog, requests fit, and transfers focus to the interactive canvas. Cancel, invalid input, guarded mutation, rejected async restore, and pending sample restoration preserve truthful state and cannot dispatch a competing blank creation.

Independent review evidence:

- The initial review verdict was **FAIL** with five P1 findings and four P2 groups. Remediation closed false output semantics, dialog-only validation, gesture hijacking, missing form/focus behavior, unhandled restore rejection, preset/name instability, compact overflow/targets, form metadata, test gaps, stale architecture documentation, and the late sample/blank concurrency race.
- The same reviewer re-read the final source and issued **PASS**. The historical failure and final re-review are retained in `start-01-independent-code-review.md`.

Verification evidence:

- The complete Studio suite passes **458/458 across 84 files** with one worker. The complete document package passes **173/173**, and WebMCP passes **42/42**.
- All eight package typechecks pass. Full lint, scoped Prettier, and `git diff --check` pass. The focused post-remediation reviewer gate passes START-01 **23/23**, document validation **10/10**, and WebMCP registration **34/34**.

Open evidence and next slice:

- No Vite, browser, build, Wrangler, or Playwright process was started on the restricted host. A healthy-host pass must still verify 320/390/1280/1440 layout, Enter submit, error focus, compact wrapping, pointer/space/hand behavior over the empty-state card, template panel reachability, and created-canvas focus.
- START-01 is not complete. The next slice is an explicit, truthful start surface over the current single draft: Continue current work, create from template, blank/custom, Import JSON, and opt-in sample. Real recents, stable multi-document IDs, previews, rename/duplicate/delete, conflict handling, and document routes remain coupled to PERSIST-01 and must not be faked.

## 2026-08-28 — Explicit start surface and atomic current-draft bootstrap (START-01 second slice)

Status: **implementation and non-browser gates complete; final independent code verdict and healthy-host browser acceptance remain open**

Implementation evidence:

- Startup now synchronously classifies browser state as empty, one validated current draft, recovery-required, or storage-unavailable. A private neutral bootstrap document is never presented as user work and is never autosaved. The Northstar proposal is an explicit sample action only.
- One versioned atomic envelope owns the canonical document and its quotation/design-template source context. Legacy document bytes migrate only after the atomic write succeeds; unreadable source keys preserve all legacy bytes, and source-discard warnings appear only when source-context bytes actually existed.
- Continue opens the exact validated in-memory envelope without rewriting it. Blank, template, import, and sample creation validate and persist the replacement envelope before workspace installation. Storage-unavailable sessions retain the same envelope in memory and can go Home and Continue without losing the latest edits.
- Canonical JSON import is bounded before read, decodes/migrates/validates before installation, and performs editable-resource admission. Healthy exact local IndexedDB resources and exact ready or archived managed workspace resources round-trip; missing, mismatched, unreadable, traversal-like, short, and malformed owned-looking identities fail as typed resource-policy errors before replacing the current draft.
- The full-page start surface shows one honest current-browser-draft card, complete template loading/error/empty/filter/compatibility states, blank/custom creation, JSON import, and the opt-in Northstar sample. It teaches document → outputs → ordered pages without fabricating a recent-project grid.
- Every visible destructive start path uses one replacement coordinator. Confirmation remains open when live-editor settlement or critical flush fails, concurrent requests are synchronously locked, Download captures the latest settled text, and successful replacement opens only after settle → flush → validated install.
- Home is a registered product command shared by the logo, File menu, and command palette. It is disabled with a visible reason during crop/review, commits active text, flushes the current envelope, returns to the start surface, and restores focus to the truthful current-draft action.
- WebMCP registration exists only in workspace mode. Returning Home aborts the registration signal for every registered tool and disposes the managed catalog. Publication lookup is scoped by exact document and template identity.
- Browser-storage failure requires explicit session-only acknowledgement and deliberately moves focus to Continue or Blank when the acknowledgement control is replaced.

Verification evidence:

- The complete Studio suite passes **543/543 across 91 files** with one worker. The complete editor, document, WebMCP, Renderer, render-view, and worker-boundary packages pass **284/284**, **173/173**, **42/42**, **51/51**, **12/12**, and **11/11** respectively.
- Import admission passes **27/27**, including exact local/managed ready, archived managed, missing/mismatched resources, field references, deduplicated lookups, and malformed owned-looking identities.
- All package typechecks and the full lint gate pass. Scoped Prettier passes. A repository-wide concurrent test invocation starved one five-second filmstrip timing case; the normal sequential Studio suite and the isolated **29/29** filmstrip rerun both pass. This is recorded as concurrency flake evidence rather than hidden.

Open evidence and next boundary:

- No Vite, browser, build, Wrangler, or Playwright process was started on the restricted host. Healthy-host acceptance must still cover the start/workspace transition, replacement Download/Cancel/Retry, latest live text, storage-unavailable focus, template filtering, compact layout, and browser-owned WebMCP cleanup.
- This slice intentionally owns one current browser draft. Real recents, stable multi-document identities, previews, rename/duplicate/delete, document routes, multi-tab conflict handling, and durable synchronization belong to PERSIST-01. They must be implemented on a versioned document repository rather than simulated over the single mutable draft.

## 2026-08-28 — Multi-document persistence foundation and editor cutover (PERSIST-01A)

Status: **completed and independently approved for the PERSIST-01A boundary**

Implementation evidence:

- Re-read the PERSIST-01 phase-entry contract, OpenPencil recent-file/local-store code, and Loora's pending-persistence and ordered-flush client before implementation. The repository remains framework-independent and local-first; React, routes, cloud synchronization, and renderer previews do not own its storage invariants.
- Added a dedicated `webmcp-studio-documents` IndexedDB with `draft-meta`, `draft-body`, `draft-previews`, `draft-conflicts`, `draft-quarantine`, and `repository-settings`. Metadata and body share one atomic transaction and exact `recordVersion`, `contentSnapshotId`, `draftSnapshotId`, and canonical UTF-8 byte length.
- Moved the 32 MiB draft/import boundary into one shared admission contract. Canonical draft encoding is versioned and key-stable; `contentSnapshotId` identifies the document while `draftSnapshotId` also identifies source context. Oversized saves are rejected before IndexedDB opens and retain the prior committed pair.
- Draft metadata records stable route identity, monotonic repository version, canonical revision, activity/saved/open times, tombstone state, page/output projections, first-page geometry, export formats, source kind, origin, and publication placeholder. Recents read bounded metadata pages only, use a stable `(activityAt, documentId)` cursor, default to 50, and reject limits above 100.
- Compare-and-swap saves retain one validated conflict candidate per document and session. Soft delete advances the durable version and leaves a tombstone; a stale tab receives `deleted_elsewhere` and cannot resurrect the ID. Restore and explicit purge are separate operations. Broadcast events are invalidation hints only; listener/channel failure cannot change a committed result.
- Preview records require exact current content identity, real page identity, renderer revision, aspect-correct shared thumbnail bounds, PNG MIME and exact Blob byte length. Content edits invalidate the preview; source-context-only changes retain the same exact pixels.
- Added an idempotent START-01 migration coordinator. It opens IndexedDB before reading legacy storage, preserves recovery precedence, buffers legacy rewrites/removals, atomically creates the record and migration marker, requires exact public read-back, and only then performs best-effort localStorage cleanup. Identical retries converge; different-content collisions preserve both candidates and leave legacy bytes untouched.
- Added a Loora-informed per-document save controller over the same repository command. It clones the exact canonical document and source context at capture time, coalesces debounce windows, serializes every write against the latest accepted `recordVersion` and base draft identity, and exposes separate local opening/saving/saved/failed/conflict/session-only states. Explicit flush bypasses debounce; storage failure retains the candidate for Retry; stale/deleted conflicts pause autosave; close cancels future scheduling and late state adoption without falsely claiming that an already-issued IndexedDB transaction can be cancelled.

Verification evidence:

- The independent final foundation gate passes **115/115 across eight files**. The repository contract suite includes exact store/row shapes, source-only identity, revision rewind, two-instance conflicts, tombstone resurrection prevention, restore, purge, duplicate origin, touch-open semantics, exact previews, quarantine, list bounds, pre-transaction oversized rejection, real request/transaction/abort/quota failures, stale-quarantine races, and exact cleanup-journal resumption. The controller suite proves serial ordering, coalescing, exact source capture, conflict/deletion pause, retry, non-retryable pause, listener isolation, close-generation behavior, and immediate flush.
- Studio typecheck, reviewed-file ESLint, scoped Prettier, and `git diff --check` pass at this checkpoint.
- The complete serial Studio suite passes **603/603 across 97 files**. Async replacement plumbing passes **5/5**, including deferred flush order, double-confirmation locking, and rejected-flush retention.
- The independent reviewer first rejected stale quarantine deletion, malformed ancestry acceptance, corrupt-record relabelling, detached transaction rejection, missing storage-failure proof, and stale migration-cleanup journalling. Every finding was repaired and re-reviewed. The final report records no remaining P0, P1, or P2 foundation finding and explicitly approves `useDocumentEditor` integration.
- The editor now starts from a private neutral document that cannot enter autosave, exposes separate opening/blocked/unavailable/ready repository lifecycle, migrates before listing, and opens a document only after an explicit Continue or create action returns an exact verified record. One repository instance and one record-matched controller own a mounted Studio session; request and controller generations reject late async adoption.
- New/template/import/sample creation commits through the repository before the workspace changes. Ordinary edits, review application, in-place imports, template context changes, Undo, and Redo capture the exact canonical document-plus-source tuple through the ordered controller. The legacy 450 ms `localStorage` writer and its mutable persisted-document identity are removed.
- Home, replacement, publication, PNG, PDF, and JSON download paths settle the live editor, await the critical local flush, and freeze their document only afterward. Failed or conflicted flushes keep the workspace open; retryable failures expose Retry, conflicts retain the candidate and Download path, and best-effort `pagehide` draining is paired with a truthful native unload warning rather than a durability claim.
- The independent mounted cutover suite passes **12/12**: empty/bootstrap isolation, blocked/unavailable truth, exact migration and record opening, stale generation rejection, exact ordinary autosave, exact design-source persistence, Undo/Redo source restoration with increasing repository versions, deferred Home ordering, storage failure retention, and real two-instance CAS conflict retention. Three older crop/performance/WebMCP mounted harnesses now use the explicit Start -> Continue lifecycle and pass **9/9** without weakening their original assertions.
- The complete serial Studio suite now passes **615/615 across 98 files**. Studio typecheck, focused ESLint, scoped Prettier, and `git diff --check` pass after the cutover.
- Two independent hook-review rounds exposed and drove repairs for identity-unsafe imports, incomplete failed/conflict downloads, foreign invalidation handling, unload/unmount capture, Continue races, StrictMode channel ownership, publication-head linkage, metadata-only cross-tab events, live-artboard PNG export, slow same-document import races, and untruthful duplicate action dispatch.
- Repository events now distinguish `content_saved`, `opened`, and `publication_linked`; only a genuinely different content/source head or foreign deletion projects an external change. Mounted coverage proves metadata-only, delayed older, and exact-equal events remain non-blocking while a true newer source head reaches CAS conflict.
- JSON and quotation imports retain the exact session, document, history snapshot, request generation, and post-await editability boundary. The mounted two-format race matrix proves ordinary edits, crop, review, session replacement, and a competing import cannot be overwritten by delayed file reads.
- Critical Home/JSON/PNG/PDF actions acquire synchronous ownership. Duplicate product-command dispatch is rejected truthfully, deferred success/failure releases only the owner, and failure text remains visible. PNG export no longer reads the live Fabric artboard after an await: it sends the exact post-flush canonical document and synchronously requested page ID to the server renderer and derives the filename from that same frozen page.
- The final independent hook reread reports **APPROVE with zero P0/P1/P2**. Its focused gate passes **107/107 across 12 files**, plus Studio typecheck, focused ESLint, and focused Prettier.
- After approval, the complete serial Studio suite passes **653/653 across 101 files**. Studio typecheck, reviewed-file ESLint, scoped Prettier, and `git diff --check` are clean.

Open evidence and next boundary:

- PERSIST-01B routes and recents UI, PERSIST-01C durable preview production/loading, and all healthy-browser reload, multi-tab, blocked-upgrade, quota, navigation, and shutdown evidence remain open.

## 2026-08-28 — Routed document library and conflict recovery (PERSIST-01B)

Status: **repository closure, persistence ownership/layout cutover, visible Recent/Trash library, exact-ID opening, canonical document routes, and routed conflict/recovery UI independently approved; PERSIST-01C previews remain open**

Phase-entry evidence:

- Re-read the PERSIST-01, START-01, workflow, architecture, and production-readiness contracts; traced the current route, Start, editor hook, repository, save controller, lifecycle mutations, conflict, quarantine, and test owners; and recorded the exact ownership gaps in `persist-01b-current-code-assessment.md`.
- Revisited actual OpenPencil, Loora, Avnac, and Canva-clone source rather than relying on README claims. `persist-01b-reference-patterns.md` records exact files, safe adaptations, and rejected shortcuts. Loora is a primary technical reference beside OpenPencil for route-keyed sessions, ordered pending work, explicit conflict, command surfaces, and one validated operation path for human and API/agent control.
- Wrote the risk-ranked executable matrix in `persist-01b-acceptance-plan.md`, separating restricted-host Vitest/typecheck/lint/format evidence from mandatory healthy-browser Back/Forward, compact, keyboard, two-tab IndexedDB, blocked-upgrade, and quota gates.
- Consolidated the governing implementation contract in `persist-01b-phase-entry.md`. `/` becomes the real metadata-only document library; `/documents/$documentId` admits one exact route-keyed editor session; creation commits before navigation; every exit settles and flushes; Delete is recoverable; and conflicts preserve Download, Reload saved, and atomic Save as copy without an Overwrite action.
- The first implementation slice closes three repository gaps before routing: explicit active/deleted/all pagination applied before the page limit, recoverable list corruption that cannot hide healthy rows, and idempotent atomic conflict save-copy. Preview production/scheduling, permanent purge policy, storage estimates, cloud heads, authentication, presence, and rebase remain explicitly outside 01B.

Repository closure evidence:

- Replaced the ambiguous `includeDeleted` list switch with explicit `active | deleted | all` state. State, query, limit, options-object, and supplied cursor inputs are validated before IndexedDB opens; predicates apply during the compound `(activityAt, documentId)` scan before the healthy page limit is satisfied. Equal-time multi-page traversal remains stable.
- Added atomic `saveConflictAsCopy()`. The exact admitted candidate is projected to a new canonical ID/revision and body, metadata, and conflict resolution commit in one transaction. `conflictId` is replay authority; concurrent same- or different-target retries converge on one result; abort/quota failures leave no half-state; old `resolveConflict("save_copy")` is rejected; resolved conflict markers cannot be overwritten by later stale candidates.
- Version-1 conflict rows now normalize a compatible `resolutionDocumentId`. Post-commit copy emits `saved` then `conflict_resolved`; reload resolution emits the same invalidation family; replay and failure emit none. Direct BroadcastChannel tests reject malformed resolution/result combinations.
- Listing now continues past index-visible corrupt metadata until it has `limit + 1` healthy matching rows. Successful pages carry typed `recoveryItems`; guarded quarantine rechecks the exact observed body/metadata pair, atomically removes its preview only when still current, and emits `quarantined` only after commit. Failed quarantine retains the raw pair and reports recovery instead of failing healthy rows.
- A persisted 50-row primary-key sweep finds malformed metadata omitted by the activity index without an unbounded read. Checkpoints advance across 50+1 batches; non-string keys remain retained without coercion; stale evidence cannot delete a concurrent repair.
- The transitional Start adapter now preserves recovery warnings. Corrupt-only storage cannot appear clean or expose a false Continue target; mixed storage retains the exact healthy draft while keeping recovery visible; Create remains available. A foreign active-document quarantine projects a real external change instead of being silently ignored.
- Independent review first rejected malformed list runtime inputs, three missing atomic regression proofs, and ignored successful recovery items. Each finding received a red test and repair. Final list-state, conflict-copy, and corruption-list reviews all report APPROVE with zero P0/P1/P2.
- The focused final gate passes **118/118 across six files**. After the final recovery-projection repair, the complete serial Studio suite passes **679/679 across 101 files**. The exact mounted suite passes **39/39** and repository regression passes **61/61**. Studio typecheck, scoped ESLint, scoped Prettier, and `git diff --check` pass.
- No Vite, browser, build, Wrangler, or Playwright process ran on this restricted host. Healthy-browser acceptance remains mandatory after the route/library/conflict surfaces exist.

Persistence ownership and layout evidence:

- Added the client-only pathless `/_studio` layout around the Studio page while keeping every `/v1/*` API route as a direct root sibling. `StudioPersistenceRuntime` is now the sole production owner of repository construction, legacy migration, the underlying repository subscription, and final repository close; the React provider exposes one retained repository, state, event fanout, recovery completion, and child leases.
- Removed repository construction, migration, direct subscription, and close ownership from `useDocumentEditor`. `StudioShell` now passes the required provider API. Provider state is authoritative for opening, ready, recovery, blocked, and unavailable projection; bounded list completions reject stale generations and provider-state changes.
- Controller, unsubscribe, and lease now live in one exact persistence-session slot. Replacement settles the old controller before creation, failed flush retains the exact old session and lease, successful retirement performs unsubscribe -> close -> lease release once, and unmount holds the lease until its ordered drain settles.
- Recovery Retry and Reset publish provider completion only after durable record creation and the legacy cleanup attempt. Failed creation leaves recovery state and source bytes intact; cleanup failure remains visible; a later retain cannot rerun the completed migration generation.
- Independent review found and rejected a real Home/replacement race after the first green gate. The repair adds one synchronously claimed hook-level transition owner shared by Continue, replacement, recovery, and Home. First claimant wins; every async boundary revalidates identity; exact settle/retire work is deduplicated; failed overlap retains the old controller/record/lease; and unmount invalidates pending transitions without allowing late installation.
- Four deterministic race tests cover replacement-before-Home, Home-before-replacement with one flush/close/release, failed overlapping flush with zero create/close/release, and two same-tick replacements with one admitted create. The same independent reviewer reread the repaired code and reports **APPROVE with zero P0/P1/P2** in `persist-01b-ownership-cutover-review.md`.
- The repaired focused ownership gate passes **95/95 across ten files**; mounted persistence and StrictMode pass **46/46**; Studio typecheck, scoped ESLint, scoped Prettier, and `git diff --check` pass. A contended concurrent full Studio run completed **712/718** with six five-second scheduling/opening timeouts; every affected file then passed serially (**1/1, 45/45, 2/2, 6/6, and 29/29**). This is recorded as host-contention evidence rather than mislabeled as a green aggregate.

Recent/Trash phase entry:

- Revisited the approved PERSIST-01B matrix and the actual OpenPencil workspace controller, Loora dashboard/client, Canva-clone projects flow, Avnac file cards, current Studio repository, provider, Start model, and Start surface. `persist-01b-recent-trash-phase-map.md` records the bounded controller/model/view/provider contract before product edits.
- The completed implementation is metadata-only: independent active/deleted slots, 24-row opaque-cursor pages, repository-backed name search, one queued refresh rerun, stale completion rejection, sticky recovery inventory, soft-delete/Restore only, operation-local failures, explicit Load more, truthful no-preview tiles, and no purge UI. It reuses the approved hook-level transition owner for exact-ID open and removes the transitional one-card list owner rather than running both.

Recent/Trash controller evidence:

- Added one framework-independent Recent/Trash controller over injected repository commands. Construction is inert; the first activation installs one retained provider-fanout listener; deactivation retains confirmed pages and recovery inventory without background reads; terminal disposal invalidates requests/actions and unsubscribes once.
- Recent and Trash own independent metadata-only slots and opaque cursors. Repository search is name-only and server-side, query application uses an injected 180 ms scheduler, explicit refreshes and event bursts coalesce to one active request plus one queued rerun, and every replacement/append captures lifetime, collection, query, generation, cursor, and base revision before it may publish.
- Rename, Duplicate, Move to Trash, Restore, persistent undo Restore, and explicit JSON Download share per-document synchronous ownership. Rename retains its captured CAS version and input across refreshes; successful mutations supersede older reads before projecting the exact committed summary; query/tab/inactive/disposed completions cannot focus hidden or dead UI.
- Recovery inventory is sticky and structurally deduplicated. Local corrupt actions and external quarantine events both retain typed recovery descriptors even after metadata removal; later exact repository evidence replaces the generic event message without exposing purge or raw recovery actions.
- Independent review drove repairs for visible-collection lookup, Trash-first restore, refresh coalescing, Rename CAS drift, exhausted-pagination focus, late disposed results, hidden query/tab focus, mutation-versus-refresh rollback, rename reservations, externally quarantined documents, and exact recovery-key collisions. The final report `persist-01b-recent-controller-review.md` is **APPROVE with zero P0/P1/P2**.
- Root and independent focused gates both pass **45/45**. Studio typecheck, scoped ESLint, scoped Prettier, and controller diff-check are clean.

Recent provider evidence:

- Added `RecentDocumentsProvider` directly below `StudioPersistenceProvider` in the client-only `/_studio` route. Deferred persistence closures keep render and discarded StrictMode factories free of repository construction, calls, fanout subscription, and preference writes; `useSyncExternalStore` observes one retained controller.
- The provider projects persistence-first opening/recovery/blocked/unavailable/ready states, acquires one child lease after readiness, and exposes one unconditional visibility hook for the retained Studio shell. StrictMode generation plus deferred finalization disposes the controller before releasing that lease; deactivation is reversible and keeps cached pages and the fanout listener.
- Independent review initially rejected three ownership gaps: public lifecycle commands could bypass provider gating, child-first passive effects could start repository work before the child lease, and the route test could pass incorrect provider nesting. Lifecycle control now stays in a private context channel, desired visibility cannot activate until the lease exists, and the mounted order proof is exactly `lease.acquire -> fanout.subscribe -> list`. The route test now verifies the exact wrapper expression.
- The same reviewer reread the repaired slice and reports **APPROVE with zero P0/P1/P2** in `persist-01b-recent-provider-review.md`. Root and independent provider/route gates pass **8/8**; Studio typecheck, scoped ESLint, scoped Prettier, and `git diff --check` pass.

Exact-ID opening evidence:

- Added `openStoredDocument(documentId)` as the exact durable-document admission path while retaining the transitional Continue adapter only for blocked/unavailable fallback. Missing, deleted, and corrupt requests preserve the current admitted workspace and its exact history, source, session, and save identity instead of substituting the starter document.
- The opening transition now shares the hook-level owner, revalidates authoritative persistence readiness after every asynchronous boundary, clears only the exact transitional Start card, and installs the admitted record under the same owner before releasing it. Failed or superseded work cannot install late or retire the active session.
- Cross-tab hints are reconciled around the authoritative touch barrier. Own local open publication is suppressed; foreign save/delete/restore hints retain the highest observed record version with deterministic equal-version ordering; quarantine is sticky; metadata-only open/publication events refresh Recent without fabricating an editor conflict; and a stronger external-change/delete/quarantine result cannot be overwritten by a weaker touch-fallback warning.
- Independent review rejected stale Start identity, an over-broad event guard, non-production missing/deleted/corrupt fixtures, restored-version handling, readiness races, out-of-order event hints, touch-fallback error precedence, and one ownership regression exposed during repair. Every finding received a targeted proof and repair.
- The same reviewer reread the stable hook and mounted tests and reports **APPROVE with zero P0/P1/P2** in `persist-01b-open-stored-document-review.md`. Persistence mounted tests pass **67/67**; Start plus StrictMode mounted tests pass **12/12**; Studio typecheck, scoped ESLint, scoped Prettier, and `git diff --check` pass. No Vite, browser, Playwright, Worker, Wrangler, build, or deploy gate ran on the restricted host.

Recent/Trash view-model evidence:

- The pure model owns persistence-first provider states, truthful collection/loading/error/empty/no-results projection, metadata-only rows, operation-local action state, focus/announcement intent, and the 48-row virtualization boundary. Rename ownership/input/version/error survives a row leaving the visible page and remains independent across documents; query misses win over the recovery-only empty state while recovery inventory and provider warnings stay available.
- Independent review first rejected off-row Rename loss, search/recovery precedence, impossible-date normalization, mutable quarantine identity, and tests that could silently return before asserting their target state. The repaired matrix then exposed and closed two more P2 findings: repository-valid fractional timestamps beyond milliseconds and per-row `Intl` formatter construction. The final model accepts arbitrary valid fractional precision and normalizes to milliseconds, preserves repository-valid year `0000` without Intl's misleading year-1 label, and constructs one date formatter plus one number formatter for a ready 100-row projection.
- The same reviewer reread the final production model and tests and reports **APPROVE with zero P0/P1/P2** in `persist-01b-recent-model-review.md`. The focused model gate passes **41/41**; Studio typecheck, scoped ESLint, scoped Prettier, and untracked-file whitespace checks pass.
- The root combined controller/provider/model/exact-open/layout gate passes **161/161 across five files**. The complete serial Studio suite passes **833/833 across 107 files**. Sequential non-Studio package gates pass document **173/173**, editor **284/284**, WebMCP **42/42**, render-view **12/12**, Renderer **51/51**, and worker-boundary **11/11**, for **573/573**. All package typechecks and the repository lint gate pass; `@webmcp/ui` has no test script and passes its lint and typecheck. Browser-backed Recent/Trash view acceptance remains open because the visible view has not been implemented yet.

Visible Recent/Trash library and Start cutover evidence:

- Replaced the transitional one-card Start owner with one visible metadata-only document library. Recent and Trash expose repository-backed name search, grid/list parity, truthful document facts, explicit opaque-cursor Load more, Rename, Duplicate, Download JSON, Move to Trash, Restore, persistent Undo, recovery inventory, retained operation failures, and no permanent-delete control. The normal and virtualized paths share the same semantic list/list-item contract.
- Removed the hidden durable `currentDraft` and `continueCurrentDraft` compatibility ownership. Only a session-only recovery envelope remains. After Home, Blank, Template, Import, and Sample each create a distinct durable record; the active workspace still settles and flushes before Home or replacement. Sample creation clones to fresh document, page, output, and node identities.
- One pending Open owns the surface and uses `openStoredDocument(documentId)`. Failed Open returns focus to the exact still-connected Open target or the stable library heading. Rename failure remains in its dialog. Failed Download, Move to Trash, and Restore return focus to the exact action trigger when present, then the document Open target, then the same stable heading. Persistence preemption is covered for both deferred Open and deferred action failure.
- The library virtualizes only above 48 rows, measures rendered rows, performs estimated then exact scrolling for off-screen focus, and uses the same 1/2/3/4-column responsive breakpoints as the non-virtual grid. Compact coarse-pointer actions reach 44 px, reduced-motion users receive a non-rotating pending indicator, decorative icons are hidden from assistive technology, and status/failure announcements have one owner.
- Independent review rejected hidden replacement semantics, unmeasured virtualization, incomplete action gating, missing mounted interaction proof, duplicate announcements, final-pagination focus, competing Open ownership, coarse targets, detached failure identity/recovery, reduced-motion/icon semantics, disconnected failure focus, menu failure focus ownership, virtual-list semantics, breakpoint drift, and persistence-preemption focus loss. Each finding received a product repair and mounted regression. `persist-01b-recent-library-review.md` preserves the review history. The final reviewer verdict is **APPROVE with zero P0/P1/P2**.
- The final focused component/mounted gate passes **27/27**. The complete all-package gate passes **1,436/1,436 tests**: Studio **863**, document **173**, editor **284**, WebMCP **42**, render-view **12**, Renderer **51**, and worker-boundary **11**. Studio and all-package typecheck, Studio and UI lint, root format check, and `git diff --check` pass. The production build passes; its existing route-warning and chunk-size warning remain separately open.

Canonical document route evidence:

- Added `/documents/$documentId` under the retained client-only persistence layout. The route validates the actual TanStack parameter, admits one exact repository record, and mounts the complete Studio session only after `get -> validate -> touchOpened` succeeds. Route, summary, canonical document, session, and shell identity remain exact for ordinary and encoded IDs.
- One provider-owned admission controller survives keyed route children and serializes final touch mutations. Stale results cannot install; when an already-running A touch completes late, B touches afterward and remains the final Recent ordering mutation. Generation-delayed disposal survives React StrictMode replay and disposes on real provider unmount.
- Missing, deleted, invalid, recovery-required, and unavailable targets never expose the bootstrap document. They redirect once to `/` with a typed persistent notice that survives invalidation until dismissed. Admission failures retain an in-route Retry/Home surface with deterministic heading focus.
- TanStack's async blocker now owns every routed SPA/history exit. It blocks crop/review, commits text, and drains `flushActiveDraft()` without retiring the session. The URL and exact editor owner remain intact on false/rejected preparation; committed route unmount owns controller close and lease release. Routed Home delegates to the same boundary.
- Real mounted router tests cover direct deep linking, encoded slash/percent/space/Unicode IDs, A -> B -> Back ordering, persistent missing redirects, and dismissal. Mounted guard tests cover deferred success plus failed/rejected exits. StrictMode provider proof performs an exact create/admit after effect replay and proves final disposal.
- Independent review rejected premature unmount, stale recency, source-only tests, focus loss, redirect identity, StrictMode disposal, and pre-commit session retirement. Every finding received a repair and regression. `persist-01b-canonical-route-review.md` records the complete history and final **APPROVE with zero P0/P1/P2** verdict.
- A focused Chrome pass created `Route gate document`, observed navigation to its canonical `/documents/<id>` route, reloaded directly into the same exact editor, returned Home to the same Recent card, and used browser Back to reopen the exact route with a clean final console. The first load exposed an unbound browser `queueMicrotask` receiver in persistence-runtime finalization; the scheduler now calls `globalThis.queueMicrotask`, and a receiver-sensitive regression prevents recurrence.
- After that browser repair, the complete Studio suite passes **890/890 across 116 files**. The all-package suite passes **1,463/1,463**: Studio **890**, document **173**, editor **284**, WebMCP **42**, render-view **12**, Renderer **51**, and worker-boundary **11**. Focused reviewer proof passes **14/14**; root format, lint, every package typecheck, production build, and `git diff --check` pass.

Open evidence and next boundary:

- PERSIST-01C durable preview production/loading and healthy-browser compact,
  keyboard, two-tab IndexedDB, blocked-upgrade, quota, navigation, and shutdown
  acceptance remain open. Browser acceptance is not claimed by the code gate.

Routed conflict/external-change recovery evidence:

- Added route-entry unresolved-candidate discovery and one persistent recovery
  model/dialog for stale write, delete elsewhere, quarantine, migration
  collision, and storage failure. Download, Reload saved, Save as copy, Open
  saved copy, and Return to Documents share one synchronous operation owner;
  dialog dismissal cannot erase recovery state.
- Reload installs an admitted durable record into a fresh history/controller
  session before resolution. Resolution requires the exact conflict candidate
  snapshot and exact durable body/metadata head in one IndexedDB transaction;
  a changed head remains unresolved and is fed through a bounded reinstall
  loop.
- Save as copy remains atomic and replayable. A rediscovered conflict copies
  its exact stored candidate; a live controller conflict synchronously captures
  the newest canonical document/source context so a pending edit behind the
  failed save cannot be lost.
- Independent review rejected the first candidate for the pending-edit copy
  race and the final-read reload race. Deterministic regressions now reproduce
  both. The re-review verdict is **ACCEPT with no remaining P0/P1 finding**.
- The final focused gate passes **125/125 across four files**. Studio typecheck,
  scoped production ESLint, Prettier, and `git diff --check` pass.

## 2026-08-29 — Durable Recent previews (PERSIST-01C)

Status: **completed and independently accepted for the PERSIST-01C boundary**

- Added one summary-bound preview identity, a fixed raster contract, and a
  metadata-plus-preview-only repository read. Listing remains metadata-first;
  exact stored hits do not open or hash document bodies.
- Extracted a stateless multi-document thumbnail producer and added a dedicated
  preview controller with near-viewport admission, maximum-three production,
  exact-key deduplication, cancellation, bounded retry, final preview CAS, and
  card-local failure state.
- Object URL ownership is ref-count aware. Active URLs cannot be evicted;
  inactive LRU eviction removes the published ready state before revocation;
  failed previews do not silently retry when scrolled away and back.
- Development/local-only Artboard fallback is explicitly labelled and
  materializes both local Blob URLs and managed workspace content URLs. Partial
  load failure, cancellation, visibility loss, and provider disposal revoke
  every temporary URL.
- Grid and list share the same contained preview owner. The visual preview well
  and title are valid independent Open controls; Retry and document actions stay
  available without invalid nested controls.
- The complete focused slice passes **120/120 across seven files**; controller
  and mounted library evidence passes **24/24**. Studio typecheck, focused
  ESLint, Prettier, and `git diff --check` pass. A live localhost check showed
  the actual first-page preview and proved preview-click navigation to the exact
  canonical document route.
- The independent remediation reviewer reread the current repository,
  controller, provider, fallback, and library code and returned **ACCEPT with
  no remaining P0/P1 findings**. `persist-01c-preview-review.md` records the
  rejected first candidate, repairs, and final verdict.

Open evidence:

- The bounded two-tab and deployed Renderer-versus-Artboard conformance journeys
  remain tracked under CONFORM-01/browser acceptance and are not claimed by this
  fast close-out.

## 2026-08-29 — Complete-document WebMCP queries (WEBMCP-01A)

Status: **completed and independently accepted for the WEBMCP-01A boundary**

- Added compact, read-only whole-document tree, node, and search tools. Agents
  can discover and inspect non-active quotation pages without moving the user's
  editor, while every result carries exact document revision, snapshot, and
  operation identity.
- The semantic tree is a cursor-paginated pre-order stream bounded by total
  returned items, including layers. Node reads preserve page/output/group/field
  context; search preserves canonical page and stack order. Image renderer
  sources, browser-local aliases, and managed source aliases remain private.
- `inspect_design` now uses one captured snapshot for both document and asset
  policy. The React hook reports the registrar's real tool count and aborts all
  partially registered tools if any registration fails.
- The first independent review rejected unbounded layer responses, partial
  registration failure, and a stale workspace lock. All three were repaired;
  the final verdict is **ACCEPT with no remaining P0/P1 blocker**.
- WebMCP tests pass **46/46** and focused Studio WebMCP/inspector tests pass
  **6/6**. Both package typechecks, focused Studio ESLint, scoped Prettier, and
  `git diff --check` pass. The live canonical document route exposes all 13
  registered tools.

Next boundary:

- WEBMCP-01B: project the complete canonical `productCommandIds` vocabulary and
  exact disabled reasons by stable target before introducing any generic
  command execution surface.

## 2026-08-29 — Canonical WebMCP capability discovery (WEBMCP-01B)

Status: **completed and independently accepted for the WEBMCP-01B boundary**

- Added one read-only `get_capabilities` tool backed directly by the canonical
  editor command resolver. All 73 command IDs project to 85 concrete
  capabilities, including 12 alignment and two distribution variants.
- Current, page, and output targeting carries exact stable identity and reuses
  Studio's structure, PDF, locked/review, selection, and live-crop policy.
  Non-current targets never fabricate selection state.
- Each response belongs to one captured document revision/snapshot/operation
  version. Missing targets and stale context have typed errors; private runtime
  and asset context do not cross the tool boundary.
- The surface is discovery-only and returns `execution: "not_exposed"` for
  every capability. It does not add a generic mutation path or bypass Review.
- The independent code reviewer returned **ACCEPT with no P0/P1 findings**.
  `webmcp-01b-capability-review.md` preserves the reviewed evidence.
- Focused gates pass: editor **17/17**, WebMCP **47/47**, and Studio mounted
  policy **4/4**. Editor, WebMCP, and Studio typechecks, focused ESLint, scoped
  Prettier, and `git diff --check` pass. The live canonical route exposes all
  14 registered tools.

Next boundary:

- WEBMCP-01C: expose the same canonical commands through a safe execution
  contract with dry-run/proposal/direct modes, expected snapshot identity,
  idempotency, and the existing human Review owner.

## 2026-08-29 — Canonical WebMCP command execution (WEBMCP-01C)

Status: **completed and independently accepted for the WEBMCP-01C boundary**

- Added one `execute_product_command` adapter over the existing canonical
  product-command resolver. Callers select a projected capability and stable
  target; they cannot submit fabricated runtime targets or arbitrary editor
  arguments.
- Exact document, revision, snapshot, operation, active-page, and ordered
  selection preconditions fail closed. Every command is re-resolved against
  the live snapshot immediately before execution.
- `direct` is limited to an explicit allowlist of non-document session
  commands. Document changes compile to existing `DocumentCommand` operations
  and enter the existing Review owner as pending proposals; WebMCP cannot
  accept or apply them. Picker, dialog, export, publish/render, and other
  open-world workflows remain purpose-built or unsupported.
- The proposal compiler matches Studio's visibility, lock, group, geometry,
  arrange, image, and page semantics; rejects no-op previews; and bounds both
  operation and affected-entity counts.
- Request receipts reserve capacity before side effects, share an exact
  concurrent request, reject key reuse with different input, never evict
  pending work, and expose typed retryability. Receipts are intentionally
  registration-scoped; durable Review history and cross-reload proposal
  deduplication remain REVIEW-02.
- The independent code reviewer checked the current diff and returned **ACCEPT
  with no P0/P1 findings**. `webmcp-01c-execution-review.md` records the
  reviewed invariants and evidence.
- Current focused gates pass: editor **18/18**, WebMCP **51/51**, and mounted
  Studio WebMCP **4/4**. Editor, WebMCP, and Studio typechecks pass. A live
  localhost route renders the complete 15-tool catalog including
  `execute_product_command`; the separate automation Chrome lacks the WebMCP
  browser API and truthfully reports registration as unavailable there.

## 2026-08-29 — Cross-browser quotation content drift audit

Status: **cause recorded; prevention boundary implemented**

- Two browsers exposed separate persisted revisions of the same quotation ID:
  one flat document and one grouped document. This is persisted content drift,
  not responsive Layers rendering.
- `quotation-content-drift-audit.md` records the confirmed missing composition
  identity, unchanged version claims, current-composer materialization,
  permissive empty-group default, and the affected document/template/source/
  local-asset areas.
- Promoted the active quotation composer and all three active quotation styles
  to version 2 while preserving version 1 as retired historical identities.
  Retired identities remain available for validating persisted references but
  are excluded from the catalog and cannot silently invoke composer 2.
- Added deterministic canonical SHA-256 source identity for future provenance.
  Ordinary reads do not enrich or rewrite legacy source contexts, protecting
  exact persisted body/summary verification.
- The independent architecture review accepted the separation of source,
  composition, and appearance identity and required any legacy group repair to
  remain explicit, group-only, and undoable.
- Document template/composer tests pass **16/16**, Studio template lifecycle and
  catalog tests pass **13/13**, and both affected package typechecks pass.

Next boundary:

- Known composition identity now persists through new quotation template,
  quotation import, sample restore, and recovery reset flows. Style-only
  changes preserve structural lineage; admission rejects source/hash drift.
- The independent code reviewer rejected an optional-`undefined` fingerprint
  mismatch, verified its JSON-roundtrip repair, and returned **ACCEPT with no
  remaining P0/P1 finding**.
- Add the explicit group-only legacy organization upgrade with exact Undo and
  reload.

## 2026-08-29 — Explicit legacy quotation layer organization

Status: **completed and independently accepted**

- Added a pure quotation-structure analyzer and explicit **Organize layers**
  action for legacy flat drafts. It never silently repairs a document and never
  offers the action for known current composition or a previously recorded
  migration.
- Eligibility now proves every composer-owned node identity, type, and page,
  rejects stale/mismatched source structure and existing custom/partial groups,
  and anchors the proposal to the exact document ID and revision.
- The upgrade preserves copy, geometry, styling, current layer order, and
  user-created layers. It creates one history entry, is Review-gated, restores
  document plus provenance through Undo/Redo, and persists through the normal
  durable draft path without claiming composer-2 provenance.
- The first independent review found two P1 defects: incomplete compatibility
  checks and stale-analysis application. Both were repaired; the final verdict
  is **ACCEPT with no remaining P0/P1 finding**.
- Focused evidence passes: document migration **6/6**, Studio template and
  mounted persistence **81/81**, independent reviewer rerun **11/11**, affected
  typechecks, scoped ESLint, and `git diff --check`.

Remaining quotation data work is upstream Stuwiz reconciliation, shared asset
persistence, and explicit future semantic migrations. It is not part of this
layer-organization gate.

## 2026-08-29 — Durable Review provenance and history (REVIEW-02)

Status: **completed and independently accepted for the REVIEW-02 boundary**

- Added a bounded durable Review journal with proposal provenance, reason and
  request identity, affected targets, operation decisions, and applied or
  discarded resolution history.
- Review state persists through draft creation, admission, save, rename,
  migration, and reload without entering the canonical document or rendered
  output. Reload restores the pending proposal's exact base snapshot into the
  history owner.
- The Review panel exposes provenance, distinct field/layer target labels,
  preview-aware navigation, missing-target handling, and resolved history.
  WebMCP supplies the actual invoking tool while apply/discard stays human-only.
- The first independent review rejected three P1 durability and navigation
  defects. All received production repairs and regressions; the final verdict
  is **ACCEPT with no remaining P0/P1 blocker**.
- Focused Studio evidence passes **176/176 across seven files** and WebMCP
  registration passes **36/36**. All three affected package typechecks, scoped
  ESLint, Prettier, the production Studio build, and `git diff --check` pass.
- A clean live document proved pending provenance across reload, human Discard,
  and resolved history across a second reload with no save conflict. The reason,
  tool identity, discarded status, and distinct field/layer targets remained
  visible.

## 2026-08-29 — ASSET-02 desktop browser acceptance

Status: **completed and independently accepted for the desktop browser
boundary**

- Re-read the accepted ASSET-02 contracts plus OpenPencil and Loora gesture
  ownership before running the real workflow.
- The browser journey exposed a central lifecycle defect: the navigation hook
  subscribed while Studio still showed its start/loading surface, saw no
  workspace, and never attached when the canvas mounted. This was the reason a
  trackpad pinch could zoom the browser page instead of the editor camera.
- Studio now tracks the actual mounted workspace element. The navigation owner
  subscribes and cleans up with that element, while a native non-passive capture
  listener claims wheel events originating on Fabric's upper canvas.
- The first independent review rejected a second P1 path where a previously
  active Hand tool could steal the crop pointer. Canonical policy now disables
  Select/Hand during crop, workspace panning yields before pointer capture, and
  the Hand cursor is suppressed without destroying the retained tool state.
  The repaired independent verdict is **ACCEPT with no remaining P0/P1**.
- A clean browser journey proves library insertion, Inspector crop, pointer
  preview, exact Cancel identity and focus return, one-transaction Done, exact
  Undo/Redo snapshots, double-click crop entry, and modifier-wheel camera
  ownership without changing image zoom.
- The mounted gesture slice passes **6/6**, focused canonical command coverage
  passes **24/24**, and the production crop browser slice passes **2/2**. Studio
  and editor typechecks, scoped Studio ESLint, the production Studio build, and
  `git diff --check` pass.
  `asset-02-browser-phase-entry.md` preserves the defect, evidence, and retained
  release boundary.

Remaining boundary:

- Touch-device arbitration, compact 320 px / 200 percent zoom placement, a real
  Chrome performance profile, deployed rendering, and 1x/2x cross-renderer
  pixel evidence remain separate gates and are not claimed here.

## 2026-08-29 — Byte-bounded editor history (HIST-01)

Status: **completed and independently accepted**

- Undo and Redo retain at most 100 entries and at most 16 MiB of measured
  UTF-16 JSON payload per stack. Entry byte size is measured once and retained
  as canonical accounting; oversized changes still apply but do not advertise
  a false Undo step.
- Commit observation is now separate from undo retention. Coalesced edits emit
  the retained transaction identity, while an oversized commit reports
  `undoable: false` and becomes a hard unified-history barrier. Studio clears
  guide redo and cannot skip across that barrier into older guide or document
  actions.
- Redo clearing and coalescing breaks are editor-owned operations that keep byte
  counters exact. Studio no longer mutates stack shapes directly.
- The snapshot-to-source-context map is pruned to current, Undo, and Redo
  snapshot identities after every history transition, so evicted quotation
  source payloads cannot accumulate outside the bounded stacks.
- The independent reviewer found and drove repairs for stale Studio byte
  counters, lost oversized-commit observation, coalesced identity drift,
  unified Undo crossing an unretained change, and unbounded source-context
  retention. The final verdict is **ACCEPT with no remaining P0/P1 finding**.
- Focused evidence passes: editor history **19/19** and Studio mounted/session/
  source-context history **10/10**. Editor and Studio typechecks, scoped Studio
  ESLint, Prettier, and `git diff --check` pass.

## 2026-08-29 — Browser conformance diagnostic and text repair (CONFORM-01 / EXPORT-01)

Status: **bounded browser slice implemented and independently reviewed;
lossless Renderer PNG/PDF and deployed parity remain open**

- Revisited the CONFORM-01 audit and the actual Loora export/capture and
  OpenPencil visual-oracle code before editing. Added a dedicated diagnostic
  route that renders every canonical page through React Artboard and Fabric at
  exact page dimensions.
- Capture readiness is explicit. React waits for managed fonts, image load and
  decode, and two painted frames. Fabric waits for exact font faces before
  sync, reports terminal error state, and reports ready only after sync plus
  two painted frames.
- Repaired ambiguous intrinsic SVG dimensions in the golden fixture. Repaired
  Fabric auto-width text so it preserves explicit newlines without soft-wrap,
  while remaining a `Textbox` for editing, controls, and adapter identity.
- Normalized Fabric's internal 1.13 text line-height multiplier to CSS
  semantics and preserved canonical fixed-frame height during remeasurement.
  The long-text glyph rows moved from a 7-to-9-pixel cumulative drift to at
  most one pixel of vertical difference.
- Removed a second Fabric wrapping pass over the canonical projector's visual
  lines. Idle text now renders that projection exactly once, while direct edit
  and live width resize temporarily use raw content and normal reflow. Every
  accepted, rejected, cancelled, and no-op transform exit restores canonical
  content and geometry.
- The latest React/Fabric diagnostic is 2.3177% / RMSE 14.0508 for properties,
  5.5473% / 17.9172 for long text, and 0.3239% / 4.9801 for square. Square now
  passes the existing threshold and shows the full `AUTO WIDTH` line. The two
  text-heavy pages still fail, so no parity claim is made.
- The in-app browser returns JPEG screenshot bytes. Cropped PNGs, diffs, and
  the report are retained only as diagnostic evidence. They are not accepted
  as the lossless baseline required by the conformance contract.
- A direct local PNG-export request reached Studio but failed with an
  unhandled 500 because `env.RENDERER` is undefined in the local Worker setup.
  The next EXPORT work must provide a real local service binding or run the
  deployed binding, then collect Renderer PNG and rasterized PDF evidence.
- Focused evidence passes: Fabric adapter, Textbox resize, and FabricArtboard
  **93/93**; editor and Studio typechecks pass. Independent code review found
  no P0/P1, drove fail-closed font checks plus the two-frame capture barrier,
  and manually verified raw live reflow followed by canonical restoration for
  accepted, rejected, cancelled, and pointer-up/no-op resize exits.

## 2026-08-29 — Local Renderer service binding (CONFORM-01 / EXPORT-01)

Status: **local service path completed; lossless comparison and deployed parity remain open**

- Studio's Worker entry now forwards the request-scoped Cloudflare environment
  into TanStack Start request context. Export PNG, export PDF, page thumbnail,
  and render-job routes consume that exact request environment instead of a
  module-level binding proxy.
- The local auxiliary Renderer now declares the canonical remote Browser
  Rendering binding. Studio defaults to port 3001; Stuwiz on port 3000 is not
  touched.
- Sequential end-to-end requests through Studio, the `RENDERER` service
  binding, the auxiliary Renderer, and Browser Rendering return a valid
  9,181-byte PNG and a valid 41,087-byte two-page PDF.
- Studio typecheck passes and the focused thumbnail/admission/invocation suite
  passes **14/14**. A concurrent PNG/PDF probe correctly exposed Cloudflare's
  remote new-browser rate limit, so capture remains sequential until the
  durable job/concurrency boundary owns retry and scheduling.
- The independent reviewer rejected one P1 port-discipline defect: Playwright
  could reuse Stuwiz on 3000 and the README still advertised that port. Studio,
  Playwright, raw HTTP E2E hosts, and the README now consistently use 3001; the
  final verdict is **ACCEPT with no remaining P0/P1 finding**.

Remaining boundary:

- Capture and retain lossless Renderer PNG/PDF pages, complete JSON/page-order
  verification and pixel comparisons, then run the same evidence against the
  deployed Renderer.

## 2026-08-29 — Live editor breakpoint and camera closure

Status: **completed locally and independently accepted**

- Revisited the retained shell, guide, and performance audits plus OpenPencil
  and Loora workspace ownership before touching the implementation.
- The first six-width capture exposed defects missed by DOM-only assertions:
  the artboard retained compact camera placement after the viewport widened,
  and desktop panels remained at 208/280 instead of restoring 264/336.
- Both observers had executed against null refs while the start surface was
  mounted and never rebound to the later editor elements. Shell and workspace
  observation now follows the actual mounted elements.
- Auto-fit is recalculated from final viewport geometry. Manual camera mode
  preserves the same world point at the visual centre through browser and
  splitter resizing without changing zoom.
- The responsive browser matrix now runs one real routed document from 320
  through 1920 pixels and proves exact centring, action reachability, desktop
  defaults, no document overflow, compact focus containment, field labels,
  splitter persistence, and correct first-frame maximum widths. All 5 tests
  pass.
- The immutable selected visual run contains exact-size, hashed screenshots at
  320, 390, 1119, 1280, 1440, and 1920 pixels. Every screenshot was inspected;
  `live-editor-closure.md` records the cause, repair, and evidence.
- The first independent review accepted the editor lifecycle, camera math,
  shell restoration, tests, and Browser Run configuration but rejected a P1
  evidence weakness: incomplete images could be skipped and full-page height
  was not asserted. The runner now waits for or fails every image, rejects
  missing decoded pixels, checks both scroll axes, and requires exact PNG width
  and height. A new atomic run passed those stricter checks.
- The final independent verdict is **ACCEPT with no remaining P0/P1 finding**.
  The reviewer independently matched all six files to the selected report's
  byte lengths, SHA-256 hashes, dimensions, and scroll/client measurements.

## 2026-08-29 — Local render ink-geometry closure (CONFORM-01 / EXPORT-01)

Status: **completed locally and independently accepted; deployed parity open**

- Revisited the retained conformance contract, OpenPencil's visual-oracle and
  text visual-bounds code, and Loora's font-ready offscreen PNG capture before
  editing the gate.
- Cloudflare's local Browser Run simulation completed a cost-free sequential
  v2 capture through the real Studio and Renderer service bindings. The atomic
  run retains three React pages, three Fabric pages, three Renderer PNGs, the
  raw two-page vector PDF, and two exact-size PDF rasters with report-bound
  hashes.
- The raw thresholds remain unchanged and their failures remain in the report.
  Properties and square pages pass raw; the text-only page records cross-raster
  variance for Fabric, React, and PDF.
- Added a strict complete-page text geometry alternative. It can apply only
  when one configured visible canonical text node is the complete page content.
  The scan covers the whole page so overflow cannot hide outside the canonical
  text frame. It compares horizontal line count; top, bottom, left, and right
  ink edges; per-line ink coverage; upper-quartile contrast; and lower-decile
  foreground color direction. The limits are one edge pixel, 10% coverage,
  0.1 contrast fraction, and a minimum 0.98 direction cosine.
- The selected run has four matching line bands for Fabric, React, and PDF,
  each with a maximum one-pixel edge delta and 3.81% coverage variance.
  Synthetic tests prove missing glyph interiors, wrong foreground hue,
  materially reduced opacity, changed wrapping, and two-pixel movement fail.
- Deployed capture remains open. No remote Browser Run allowance was consumed
  or required for this local gate.
- Local Browser Run now uses Wrangler's local simulation; only the production
  config retains remote Browser Run. Local editor verification therefore does
  not consume the account's billable remote allowance.
- The first independent review rejected a real P1: matching line edges could
  hide missing glyph interiors, wrong hue, or reduced opacity. Per-line
  coverage, contrast, and foreground-direction guards plus adversarial tests
  close that hole. The same reviewer reran the comparator, rehashed all 12
  selected artifacts, and returned **ACCEPT with no remaining P0/P1 finding**.
  `render-conformance-local-review.md` preserves the reviewed invariants and
  evidence.

## 2026-08-29 — Real-browser scale interaction and render admission (PERF-01A)

Status: **completed locally and independently accepted; steady-state raster evidence open**

- Revisited `perf-01-renderer-thumbnails.md`, the ASSET-02 crop/preview seam,
  PERSIST-01C preview ownership, OpenPencil's viewport scheduling, and Loora's
  revision-keyed lazy thumbnail composition before editing the filmstrip.
- Added one reproducible real-Chromium profile around a canonical 100-page,
  800-node document. It instruments the actual Radix scroll viewport, frame
  cadence, page-switch acknowledgement, thumbnail request concurrency, Long
  Tasks, heap, live Artboards, raster placeholders, and Object URLs, then writes
  `artifacts/perf-01-scale-profile.json`.
- The first honest runs failed. Development's live fallback reached 60 ms p95.
  The renderer path launched 36–41 jobs, transiently reached six browser
  requests, and delayed page selection up to 26.7 seconds because cancellation
  freed client slots before local Browser processes stopped.
- Renderer-backed thumbnails now require 300 ms of filmstrip quiet before
  admission. Every scroll resets the gate; viewport exit still cancels
  immediately. Intersection visibility is published as an interruptible React
  transition so obsolete parent renders cannot monopolize the scroll path.
- The selected passing run holds 90 full-range alternating frames to 24.2 ms
  p95 / 32.1 ms maximum, page 100 acknowledgement to 361 ms, endpoint
  concurrency to three, and one live Artboard. Mounted filmstrip coverage is
  32/32; cache plus filmstrip is 43/43; Studio typecheck and scoped lint pass.
- The first independent review rejected two P1 holes. Viewport exit now updates
  raw observer truth, clears delayed admission, and cancels the exact raster
  synchronously before transition-deferred React publication. The browser gate
  now requires renderer mode, positive and bounded total starts, bounded
  concurrency, and promotes selected evidence atomically only after every
  assertion passes. Exit-before and exit-after regressions preserve both
  invariants.
- A second review found that an urgent editor render could still observe stale
  transition state and recreate a just-cancelled request. The request effect
  now treats synchronous observer truth as authoritative for both cancellation
  and admission. A `flushSync` regression forces that exact ordering and proves
  the producer remains at one call with its original signal aborted.
- The final independent verdict is **ACCEPT with no remaining P0/P1 finding**.
  `perf-01a-independent-review.md` retains the inspected code paths, rejected
  races, evidence contract, and final decision.
- The opt-in `VITE_STUDIO_RENDERER_THUMBNAILS=true` uses Wrangler's local,
  cost-free Browser Run simulation. That simulator logged Chrome readiness
  timeouts and completed zero rasters, so steady-state latency, visual parity,
  cache hits, memory after completion, and Object-URL release remain explicit
  PERF-01B work on a healthy host.

## 2026-08-29 — 1,000-layer active-page interaction (PERF-01 scale)

Status: **completed locally and independently accepted; healthy-host renderer evidence open**

- Revisited the retained PERF-01/NAV-01 evidence, OpenPencil's 5,000-row
  virtual Layers contract, and Loora's memoized layer/camera implementation.
  The phase was bounded to one visible 1,000-layer page and the direct editor
  interaction path; it did not substitute for healthy-host renderer evidence.
- Added a real Chromium gate for WebMCP model count, expanded-tree DOM bounds,
  tail search, selection, inspector edit, wheel pan, and gesture zoom. Evidence
  promotes atomically only after every budget passes.
- The first camera profile failed near 217 ms p95. Transient camera and zoom
  previews now use refs and imperative transforms; React state settles after
  the gesture. Pan and zoom now remain around one 60 Hz frame at p95.
- The first edit profile failed at 769–910 ms. It exposed two linked defects:
  the active filmstrip thumbnail synchronously rebuilt all 1,000 React nodes,
  and history's strict public command parser cloned every unchanged canonical
  node, defeating Fabric's incremental sync. Thumbnail refresh is now deferred
  and memoized. Internal canonical history preserves unchanged identities while
  command and semantic validation remain enforced; public/API application keeps
  full input/output schema parsing.
- Three consecutive Chromium runs pass, followed by a final passing run after
  the field-identity regression. The selected profile records 3,507 ms open,
  33 mounted rows, 111 ms search, 431 ms selection, 258 ms edit, 17.5 ms p95
  pan, and 17.4 ms p95 zoom. Focused document fields/validation is 31/31;
  editor history plus Fabric adapter is 94/94; document, editor, and Studio
  typechecks pass.
- Healthy-host Browser Rendering latency/parity/cache/Object-URL evidence is
  still open and is not implied by this active-page result.
- Independent review rejected five P1 correctness gaps beyond the timing
  fixture: stale guide hit/drag geometry during live camera preview, an
  unguarded canonical history fast path, a superseding image-decode race,
  hidden/off-page crop chrome, and a selected-image toolbar that lagged behind
  the live camera. All five are repaired with focused regressions.
- The final independent verdict is **ACCEPT with no remaining P0/P1 finding**.
  `perf-01-layer-scale-independent-review.md` preserves the rejected paths,
  repairs, evidence decision, and final code-review result.

## 2026-08-29 — Foreground export failure lifecycle (FAIL-01A)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread the current failure audit, Loora's bounded import cleanup,
  OpenPencil's AbortSignal timeout pattern, the existing thumbnail boundary,
  and current Cloudflare request-signal compatibility requirements before
  editing.
- PNG and PDF now use one identity-aware foreground operation owner. The
  60-second deadline requests abort and the always-mounted surface remains
  visibly `cancelling` until owned work acknowledges it; Retry cannot overlap a
  non-cooperative prerequisite or accept a stale completion.
- AbortSignal now crosses local asset preparation, Studio export fetch,
  managed-resource materialization, the private Renderer HTTP request, Browser
  Rendering, and response bodies. Browser close is idempotent. Foreground PNG
  and PDF are explicitly ephemeral and return bytes from memory without R2;
  the persistent render path retains its put/get abort cleanup.
- Incoming Worker cancellation and service-binding passthrough are explicitly
  enabled. Shared JSON parsing preserves AbortError. The adjacent thumbnail
  boundary cancels the Renderer body and fails its lease when its caller leaves.
  Failure settlement retries once per attempt; if both transport calls fail,
  the admission reservation TTL remains the final recovery.
- Focused tests cover the cancelling ownership lock, cancel/retry identity,
  visible recovery actions, pre-render cancellation, Browser close, exact
  in-memory foreground responses with no R2 calls, persistent R2 cleanup,
  request-body cancellation, and thumbnail lease settlement. Worker-boundary,
  Renderer and Studio typechecks pass. The real port-3001 PDF flow visibly
  entered progress, cancelled, exposed Retry, started a fresh operation and
  cancelled again; port 3000 was untouched.
- `fail-01a-foreground-export-lifecycle.md` records the exact gate and the
  remaining FAIL-01 boundaries. This phase does not claim Fabric, storage,
  upload, import, publish, WebMCP, render-job recovery, or overall server-side
  render deadlines are complete.
- Independent review accepted the final bounded diff with no remaining P0/P1
  after the cancelling-ownership, ephemeral-artifact, admission-settlement,
  and audit-truthfulness repairs.

## 2026-08-29 — Renderer execution deadline (FAIL-01B)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread the FAIL-01 audit and the actual Loora/OpenPencil deadline patterns
  before editing. Loora's bare race is suitable for readiness it does not own;
  it is not used to release a Browser/R2 request early.
- PNG, PDF, and thumbnail rendering now compose caller cancellation with a
  45-second server deadline. Stalled page work closes Browser once and returns
  a stable retryable 504 only after owned cleanup acknowledges abort.
- Browser acquisition/connection uses one signal-forwarding BrowserWorker
  proxy and the minimum 10-second idle keep-alive, including the thumbnail path.
- Persistent R2 put remains non-abortable. If it crosses the deadline, Renderer
  retains ownership, waits for settlement, deletes the late artifact, and then
  returns 504; Studio cannot release its admission lease while work continues.
- The contract is explicitly cooperative: the deadline prevents late success
  but does not claim a hard 45-second response when a platform primitive itself
  never settles.
- Renderer tests cover stalled acquisition, all three page paths, and the R2
  ownership race. The Worker boundary passes 35/35; the complete Renderer
  package passes 63/63; Renderer typecheck passes. The independent verdict is
  still pending.
- `fail-01b-renderer-execution-deadline.md` records the exact gate and remaining
  boundary work.
- Independent review accepted the final bounded diff with no remaining P0/P1
  after rejecting and rechecking early-response admission ownership, Browser
  acquisition cancellation, thumbnail lifecycle reuse, and evidence wording.

## 2026-08-29 — Export prerequisite cancellation (FAIL-01C)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread the FAIL-01 audit, Loora import/export cleanup, OpenPencil deadline
  patterns, and the actual Studio draft, local asset, PNG, and PDF code before
  editing.
- PNG and PDF now pass the foreground signal into draft flush. Cancellation
  releases only the export waiter. The controller-owned compare-and-swap write
  continues, Retry joins it, and newer captures drain afterward with one active
  write and exact version order.
- Local IndexedDB image reads accept cancellation through migration waiting,
  database open, readonly transactions, and quarantine. A database that opens
  after cancellation is closed, and transaction cancellation waits for the
  IndexedDB abort event before returning.
- Local image preparation now owns all started children. One image failure
  aborts pending siblings and waits for them to settle. Caller cancellation
  remains the reported error even when sibling cleanup reports other errors.
  PNG and PDF use the same implementation.
- Focused draft, PNG, materialization, and local asset tests pass 37/37. Studio
  typecheck and scoped ESLint pass.
- `fail-01c-export-prerequisite-cancellation.md` records the exact contract and
  keeps Fabric startup, upload, import, publish, WebMCP, durable jobs, public
  error identity, and deployed failure evidence open.
- Independent review rejected the first pass because a cancelled IndexedDB
  open could outlive the waiter and overlap Retry. The final reservation gate
  retains ownership through late close. The reviewer accepted the repaired
  gate with no remaining P0/P1.

## 2026-08-29 — Fabric runtime recovery (FAIL-01D)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread the retained FAIL-01 boundary and the actual Loora/OpenPencil
  lifecycle, abort, concurrency, and destroy-before-replacement code before
  implementation.
- Fabric adapter import/mount and exact document synchronization now have
  separate deadlines, exact attempt/document/revision/page reports, and one
  serialized lifecycle owner. Retry waits for old sync acknowledgement and
  async disposal; failed disposal exposes reload recovery rather than mounting
  a second canvas.
- Incremental sync visibly re-enters Preparing. The application canvas and its
  interaction chrome remain inert until exact readiness. A successful
  user-owned Retry restores focus to the Fabric canvas.
- Font work is limited to exact visible page text. Image decode is parent-
  cancellable, capped at six concurrent operations, and bounded to eight
  seconds per image; ordinary failure degrades one node while failed source
  replacement retains prior pixels. Visible image Retry has exact source/token
  identity, cancellation, timeout, stale-result rejection, and failure state.
- Product readiness no longer depends on background-tab animation frames. The
  conformance harness retains its separate painted-frame acknowledgement.
- Focused Studio runtime tests pass 19/19 and editor Fabric adapter tests pass
  76/76. Both typechecks and Studio scoped lint pass. Independent code review
  returned **ACCEPT with no remaining P0/P1 finding**.
- `fail-01d-fabric-runtime-recovery.md` records the exact ownership contract and
  keeps upload, import, publish, WebMCP, durable jobs, public error identity,
  and deployed failure evidence open.

## 2026-08-29 — Document and quotation import lifecycle (FAIL-01E)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread the FAIL-01 audit, Loora's bounded import/cleanup path, OpenPencil's
  finite AbortSignal and pending-open patterns, and Studio's actual local and
  managed resource admission before editing.
- Studio document JSON keeps its 32 MiB pre-read cap. Quotation JSON now uses
  the 2,000,000-byte Stuwiz API boundary instead of unbounded `file.text()`.
- Browser ingestion uses an owned `FileReader` lifecycle. Signals flow through
  local IndexedDB and managed-media verification; caller abort is never
  converted into a missing-resource validation error.
- Workspace and Home imports use the identity-aware critical action owner with
  an admission deadline, visible Cancel/Retry, no same-tick overlap, and stale
  completion rejection. Home explicitly leaves the cancellable phase before
  the atomic draft repository transition starts.
- Older imports cannot overwrite a newer import, session, or error surface.
  Ordinary edits receive an exact stale-import explanation; crop and Review
  retain their existing blockers.
- Studio typecheck, 30 document-admission tests, 17 critical-action/status
  tests, and nine focused mounted persistence races pass.
- `fail-01e-import-lifecycle.md` records the gate. Upload, publish, WebMCP,
  durable jobs, public error identity, and deployed failure evidence remain
  open.
- Independent review rejected the first pass because repository cancellation
  released before cleanup acknowledgement, dialog cancellation retained stale
  Retry authority, and Home storage still claimed it was reading. The repaired
  gate directly awaits cleanup, revokes invalid Retry operations, and reports
  storage truthfully. Final review returned **ACCEPT with no remaining P0/P1**.

## 2026-08-29 — Managed upload lifecycle (FAIL-01F)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread the FAIL-01 and MEDIA-01 audits, OpenPencil's bounded image admission,
  Loora's asset upload flow, and Studio's XHR/D1/R2 implementation before
  editing.
- Managed uploads now use a source-ordered queue with at most three concurrent
  requests, synchronous claims, exact attempt ownership, and stable
  idempotency keys across Retry.
- Queued and active cancellation are distinct. The UI waits for local abort
  acknowledgement and does not claim the Worker was cancelled. Network loss
  and timeout enter a truthful **Status unknown** state; Retry reuses the same
  key and explicitly checks/reconciles the server result.
- Retryability is typed. Deterministic validation/4xx failures do not expose a
  misleading Retry action.
- Workspace/content-hash R2 keys are deterministic. D1 race losers never
  delete shared content. A same-key, same-content, different-request regression
  proves the winner remains readable.
- Studio typecheck, scoped lint, and 30 focused queue/XHR/repository tests pass.
  `fail-01f-managed-upload-lifecycle.md` keeps local uploads, quota/rate
  admission, publish, WebMCP, durable jobs, and deployed failure evidence open.
- The first independent review rejected shared-object deletion and misleading
  timeout copy. After repair, final rereview returned **ACCEPT with no remaining
  P0/P1**. A mounted full-queue lifecycle regression remains P2 hardening.

## 2026-08-30 — Publication lifecycle and authority (FAIL-01G)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread FAIL-01 publication findings, Loora's transaction/agent/export paths,
  OpenPencil's finite attempt patterns, and Studio's route, D1, IndexedDB,
  dialog, and shell lifecycle before implementation.
- Removed origin-global publication replay. Workspace sessions and every
  publication obtain authenticated server authority before consuming a version
  stream; public template IDs are stable and document-owned.
- Publication is exact single-flight with a 45-second deadline, visible Cancel,
  session/document/snapshot guards, signal-aware draft flush, and serialized
  abortable IndexedDB prerequisites. Cancelled queued retries never start late.
- Cancellation projects **Status unknown**, because the Worker may already have
  committed. Dialog and shell expose syncing, stopping, unknown, failed, and
  synced states without claiming rollback.
- D1 responses are authoritative. Provisional candidates are not installed;
  actual same-slot races return the next ordinal and recover inside one
  operation. Exact durable-head linking preserves newer local edits as
  unpublished.
- Studio typecheck, scoped lint, and 84 focused mounted persistence/repository
  tests pass. `fail-01g-publication-lifecycle.md` keeps WebMCP execution,
  durable jobs, local promotion, public error identity, quotas, and deployed
  failure evidence open.
- Independent review rejected seven successive ownership/authority gaps. Final
  rereview returned **ACCEPT with no remaining P0/P1**.

## 2026-08-30 — WebMCP execution lifecycle (FAIL-01H)

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**

- Reread WEBMCP-01C, the remaining-product ledger, Loora's agent transaction,
  editor-client, and export/capture paths, plus Studio's live WebMCP adapters.
- Registered tools now have finite execution ownership, registration teardown
  and context-replacement cancellation, a 60-second deadline, typed cancelled
  or unknown status, and a bounded registration deadline/retry owner.
- Exact WebMCP publication cannot join another snapshot owner. The execution
  signal reaches the editor publication lifecycle, history-snapshot approval is
  distinct from the immutable content hash, and interrupted publication reports
  unknown status without allowing a late POST after a cancelled prerequisite.
- Managed asset lookup cancellation belongs to each caller. Render requires a
  stable idempotency key, admits three active requests, reconciles unknown
  transport outcomes with the same key, and de-duplicates local/restored server
  rows under adversarial GET/POST ordering.
- Studio and WebMCP typechecks, scoped Studio lint, and Prettier pass. Focused
  Studio suites pass 100/100 and WebMCP passes 38/38. Final independent rereview
  returned **ACCEPT with no remaining P0/P1**.

## 2026-08-30 — Durable render execution (FAIL-01I / JOB-01A)

Status: **implemented locally and independently accepted; deployed restart evidence remains open**

- Reread the retained JOB-01/FAIL-01 contracts, Loora export/transaction
  boundaries, and current Cloudflare Workflow/D1/Workers guidance.
- POST now persists one idempotent queued D1 job and dispatches a named Workflow.
  A scheduled reconciler repairs missing dispatch, restart gaps, stale attempts,
  pending admission settlement, and expired artifacts.
- Workflow execution is checkpointed across exact claim/admission,
  attempt-scoped artifacts, settlement/publication, and compensation. Every
  artifact and finalization is deadline-bound and refreshes a fenced heartbeat.
- Completion, cancellation, retry, admission, and R2 cleanup share exact attempt
  ownership. No stale attempt can publish, cancel, overwrite, or delete a newer
  attempt. D1 never exposes completed output before quota settlement is known.
- The playground exposes queued/rendering/retrying/cancelling/cancelled states,
  finite attempts, Cancel, retryability, status-unknown reconciliation, and
  restored polling after reload.
- Migration `0008` and its executable preservation harness cover malformed
  legacy JSON, missing terminal timestamps, output preservation, foreign keys,
  and required indexes.
- Studio/WebMCP typechecks, production build, 51 focused tests, migration proof,
  and `git diff --check` pass. A real port-3001 PDF render survived client
  connection loss and restored as completed with a 291.6 KB download.
- Independent review rejected three iterations. Final rereview returned
  **ACCEPT with no remaining P0/P1**.

## 2026-08-30 — Public API security and error contract (API-SEC-01 / API-ERR-01)

Status: **completed locally and independently accepted; deployed hostile-network evidence remains open**

- Reread the retained API security/error contracts, Loora's authentication and
  rate-limit boundaries, and Studio's principal, route, media, renderer, and
  durable-admission owners before implementation.
- A shared `/v1` boundary now assigns request identity, normalizes every error,
  hides unknown exceptions, bounds downstream-error inspection, and writes one
  safe asynchronous audit row with resolved principal/workspace attribution.
- Authentication precedes JSON and multipart parsing. Public validation issues
  have canonical field paths; session reset is localhost-only; forged internal
  identity headers are removed before route execution.
- Fixed-window API rate admission complements existing render budgets. Uploads
  reserve concurrency, daily bytes/requests, workspace bytes, and asset count
  before multipart parsing. Each transport attempt has a unique reservation,
  while the repository independently preserves caller idempotency.
- Studio and Renderer share structural PNG/JPEG/WebP inspection plus bounded
  dimensions and pixel area before browser decode. Managed asset ownership and
  the existing font allowlist remain authoritative.
- Migrations `0009`–`0011`, the audit migration/retention harness, all three
  package typechecks, 58 focused tests, and `git diff --check` pass. Live
  port-3001 probes retained request-ID and attributed audit evidence for success,
  malformed JSON, and path-aware validation failures.
- Independent review rejected one same-idempotency-key admission race. After
  separating transport reservation identity from repository idempotency and
  adding the concurrent regression, final rereview returned **ACCEPT with no
  remaining P0/P1**.
