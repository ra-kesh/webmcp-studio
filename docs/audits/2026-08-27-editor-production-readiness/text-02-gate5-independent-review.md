# TEXT-02 Gate 5 independent code review

- Date: 2026-08-30
- Reviewed commits: `dbdab41f46722ac5b608a72ae820afa25ec0cbde` through `786bf35ff34b1f4795dbf06772ed9908bed58cb5`, inclusive
- Final verdict: **TEXT-02 Gate 5 may close.** The two original P1 findings were repaired, the corrected retained evidence passed, and the independent closure review found no remaining P0/P1 issue. The original findings remain below as the audit trail; final closure evidence is recorded at the end of this document.

## Final closure re-review — 2026-08-31

- The adverse 7,000-character/1,000-run late-wrap path now uses bounded incremental layout and is exercised through canonical layout, Fabric paste/edit, React/Renderer projection and the retained 100-page browser workload.
- The exact resource-bearing and component-bearing documents now cross immutable publication, Renderer HTML, real PNG and real PDF raster comparison. Fresh captures report zero page errors and pass their pixel/geometry policies:
  - resources: `2026-08-30T20-24-21.290Z-eced26b5-0ce1-4445-95fd-c0223d05e89d`;
  - components: `2026-08-30T20-24-01.428Z-ffdf6a4f-3f2d-43a0-bc6b-4dea01935749`;
  - component journey: `2026-08-30T20-24-34.290Z-13d3a12d-6e8a-4df5-9c8c-59d1f4855f95`.
- The performance oracle now counts every long task overlapping the interaction interval rather than excluding the click task because it began immediately before the capture listener.
- The retained PERF-01 profile captured at `2026-08-30T20:42:11.360Z` passes: click-to-ready 203.4 ms / 500 ms, click-to-paint 224.9 ms / 750 ms, maximum overlapping long task 206 ms / 500 ms, p95 frame 23.5 ms / 32 ms and heap growth 16.43 MB / 64 MiB. The filmstrip retained zero live Artboards, renderer thumbnail concurrency stayed at three, and font readiness used one descriptor request with a one-codepoint sample.
- Page switching no longer changes the canonical command/menu runtime identity and therefore no longer invalidates every memoized page control. Closed Publish readiness scans are memoized by document identity instead of revalidating and laying out the complete document on a page-only selection change.
- Independent focused reruns passed 147/147 document/editor/conformance tests and 116/116 final Fabric/artboard/textbox tests. The final integrated runs passed Document 314/314, Editor 327/327, Render View 16/16, Renderer 70/70 and focused Studio 71/71. `git diff --check` passes.
- Independent final verdict: no remaining P0 or P1 finding; TEXT-02 Gate 5 may close.

## Findings

### P0

No P0 defect was found in the reviewed slice.

### P1 - A legal rich-text shape can block the editor thread for seconds

Classification: confirmed implementation defect.

Files and lines:

- `packages/document/src/text-layout.ts:261-325`, especially `:291-311`
- `packages/editor/src/fabric-adapter.ts:3931-3957` and `:4003-4035`
- `packages/document/test/text-layout.test.ts:44-78`

User and business impact:

A paste, API update, or ordinary edit can make the editor unresponsive for several seconds even at the advertised 1,000-run scale. The delay occurs synchronously on the main thread before Fabric redraws or publishes the editing state. The same projector is also on React and Renderer paths, so the shape can increase preview and export latency. This violates the Gate 5 interactive-scale claim and is reachable through valid document data because text and node width are not bounded to the narrow test fixture.

Causal path:

1. `wrapStyledGlyphs` constructs `candidate = [...line, ...token]` and fully measures it at `text-layout.ts:292-294`.
2. When an unbroken token is wider than the frame, the fallback loop constructs `next = [...line, glyph]` and fully remeasures the growing line for every glyph at `:308-311`.
3. The work therefore repeatedly copies and scans the current line. A wide frame that breaks a long token near its midpoint is the adverse case.
4. Fabric paste calls `pasteTextClipboardPayload` or `replaceRichTextRange` at `fabric-adapter.ts:4019-4035`, then `applyTextClipboardResult` immediately calls `projectFabricTextState` at `:3943`. The expensive canonical layout is synchronous.

Independent reproduction with the real `projectTextLayout` implementation and 1,000 runs:

| Text shape                                                                   |      Width |                               Result |
| ---------------------------------------------------------------------------- | ---------: | -----------------------------------: |
| Gate fixture, 7,000 characters split into 1,000 short space-delimited tokens |     760 px | 10.5-15.1 ms across ten warm samples |
| 7,000 unbroken characters                                                    |  29,400 px |                             4,841 ms |
| 14,000 unbroken characters                                                   |  58,800 px |                            11,667 ms |
| 28,000 unbroken characters                                                   | 117,600 px |                            17,880 ms |

Why the existing test did not catch it:

`text-layout.test.ts:45-62` creates 1,000 six-character tokens, each followed by a space, inside a 760 px frame. That keeps the accumulated line short and never exercises the long-token fallback at `text-layout.ts:308-311`. Warming the same favorable input and asserting a 250 ms wall-clock threshold does not cover the production input class.

Required acceptance test:

- Add a deterministic complexity regression using at least 1,000 distinct runs over an unbroken token and a valid width that forces one late wrap. Assert an interactive bound on a release-like runtime and a bounded projection size.
- Exercise the same input through an actual Fabric paste/edit session and through React/Renderer projection, not only the pure helper.
- Include the rich-text adverse case in the retained 100-page workload, with long-task and memory assertions.
- Replace repeated line copying and full remeasurement with incremental width accounting or another demonstrably linear/bounded algorithm.

### P1 - The required resource-bearing PNG/PDF/publication conformance corpus does not exist

Classification: missing Gate 5 evidence and inaccurate completion claim.

Files and lines, at reviewed commit `786bf35`:

- `packages/document/src/render-conformance.ts:516-579` and `:602-730`
- `packages/document/test/render-conformance.test.ts:40-76`
- `packages/editor/test/fabric-adapter.test.ts:176-206`
- `packages/render-view/test/conformance.test.ts:28-54`
- `apps/renderer/test/html.test.ts:118-139`
- `apps/renderer/test/html.test.ts:307-318`
- `apps/renderer/test/index.test.ts:102-164`
- `packages/document/test/publishing.test.ts:136-165`
- `docs/audits/2026-08-27-editor-production-readiness/text-02-phase-entry.md:133-140` and `:590-606`

User and business impact:

Gate 5 requires a Fabric/React/Renderer/PNG/PDF mixed-style corpus. A regression that loses a variable update, drops a range binding during publication, or paints different output in Browser Rendering can still pass every newly added test. Closing TEXT-02 on this evidence would certify artifact parity that the suite does not test.

Causal and test path:

1. The new typography style exactly repeats the existing `long-text-only` node's already-resolved values: Geist, 24 px, weight 450, line height 1.6, and letter spacing -0.5. The paint style and every variable likewise repeat the pre-existing target values. Applying or binding them is visually a no-op.
2. The document test asserts resource counts, target-kind counts, JSON serialization, and three values that were already present before any resource command. It would still pass if binding propagation stopped changing render values.
3. The Fabric test checks one rectangle and base text properties. It does not assert the resource identities, the exact text-range color binding, style-target bindings, or a post-bind variable update.
4. The React test calls `renderNodeStyle`; it does not mount the resource-bearing document or inspect computed segment styles.
5. The Renderer test stops at HTML substring checks. Repository-wide usage of `textDesignSystemConformanceDocument` is limited to these canonical/Fabric/style-object/HTML tests. It is not passed to the Worker PNG/PDF tests or the publication tests.
6. The apparent PDF/PNG assertions at `apps/renderer/test/html.test.ts:307-318` cover the separate image parity document and still inspect HTML strings. The Worker PDF test at `apps/renderer/test/index.test.ts:102-164` uses `northstarSeed` and mocked PDF bytes. Neither paints the resource-bearing corpus.

Why the existing tests did not catch it:

They mostly restate fixture construction and shared projector output. Shared helper agreement is valuable structural coverage, but it is not an independent visual or artifact oracle. The phase record's statement that "Renderer HTML/PNG/PDF and immutable publication tests assert the same resolved geometry, text, resources and binding targets" at `text-02-phase-entry.md:593-594` is inaccurate.

Required acceptance test:

- Start the conformance seed with values deliberately different from every resource value, bind all four variable types and all target kinds, then change each variable after binding.
- Assert whole-layer and exact-range resolved values in a mounted React render and a real Fabric object/session.
- Publish an immutable version and prove that styles, variables, bindings, and resolved values survive the snapshot boundary.
- Send that exact published document through the real Renderer page and output paths. Capture PNG and PDF, rasterize the PDF page, and compare retained artifacts against an independent oracle with explicit tolerances.
- Ensure the test fails if any one of style propagation, variable application, publication retention, HTML serialization, PNG painting, or PDF painting is disabled.

### P2 - Quotation resource restyling has no ownership boundary

Classification: architectural risk with user-data consequences.

Files and lines:

- `packages/document/src/quotation-template-application.ts:19-33`, `:137-169`
- `packages/document/test/quotation-template-application.test.ts:161-238`

Impact:

Applying a quotation style rewrites every paint style and every color variable whose value happens to equal any active quotation palette color. The code does not distinguish a template-owned token from a customer-created brand resource. A custom resource that coincidentally uses the olive accent, muted, surface, background, or ink value is restyled and then propagated to all of its consumers.

Causal path:

`createPaletteMap` keys only by lowercase color value. `applyQuotationTemplate` maps every `paintStyles[].color` and every color `variables[].value` at `:146-154`, then propagates all mapped styles and bindings at `:157-169`. Resource ID, name, source, and semantic ownership do not participate. The new test names its fixtures `Template / Accent` and `Template / Surface`, but the implementation never reads those names and the test has no coincidental custom-resource control.

Existing-test expectation:

The current exact-token contract explains why generated quotation resources change, so this is not recorded as a confirmed defect without a product decision about ownership. The test should nevertheless have exposed the collision because prior template acceptance promises preservation of custom visual work.

Required acceptance test:

- Add one template-owned and one customer-owned paint style/color variable with the same current value; apply a new quotation style; require only the template-owned resource and its consumers to change.
- Define a stable ownership/token identity in the document model or composition sidecar. Names and color equality are not adequate provenance.
- Cover Undo and Stuwiz refresh after the restyle so resource ownership remains stable across both flows.

### P2 - HMR and Layers regression coverage does not exercise HMR, compact non-overlap, or the large scrolled tree

Classification: test-quality gap; the reviewed implementation is plausible, but the permanent regression claim is unsupported.

Files and lines:

- `apps/studio/src/features/persistence/studio-persistence-context.ts:21-34`
- `apps/studio/src/features/persistence/studio-persistence-provider.tsx:9-17`, `:69-89`
- `apps/studio/src/routes/studio-persistence-layout.test.ts:54-65`
- `apps/studio/src/features/editor/layer-tree.tsx:584-605`, `:1156-1208`
- `apps/studio/test/e2e/layer-tree-production.spec.ts:299-321`, `:330-369`, `:372-414`, `:808-869`

Impact:

The reported live-update failure previously left the app in an error boundary, removed styled surfaces, and collapsed virtual rows. The automated suite can pass if that runtime failure returns. It can also pass if compact rows overlap or if a 1,000-row tree overlaps only after scrolling, because those combinations are not asserted.

Causal and test path:

- Moving `createContext` to a dependency-only module is a sound identity boundary, and fixed `index * rowHeight` positioning is internally consistent with the explicit 28/44 px row heights.
- The persistence test only reads source files and checks for strings. It never performs a module hot replacement, retains provider state, opens Publish, or inspects loaded stylesheets.
- `expectVisibleTreeRowsNotToOverlap` is a real bounding-box assertion, but it is called only in the small desktop hierarchy case. The 1,000-layer case checks DOM count, search, scrolling, ownership, and persistence, not row bounds. The compact case checks one row/control size, not all visible row offsets.
- The clean-commit browser run was not cold-start reliable. `beforeEach` uses the default 5-second visibility timeout for `Open sample` at `:362-366` and the default 30-second test timeout while the editor initializes at `:330-369`. On a fresh isolated server, the first attempts timed out before the already-rendering start surface/editor became ready; after warm-up, the 1,000-layer case and the hierarchy/non-overlap case passed. A retained gate should not depend on an undocumented warm server.
- The only actual HMR evidence is the manual two-update account in the phase record. That is useful acceptance evidence but not the claimed permanent regression gate.

Required acceptance test:

- Run the Vite development server on port 3001, open compact Layers and Publish, trigger a real update to the provider module, and assert no route error, stable persistence state, retained stylesheet links/computed dialog styles, and retained active panel state.
- Assert bounding boxes for every mounted row on desktop and compact, before and after scrolling a 1,000-layer tree and after the hot update.
- Give the explicit start/editor admission waits a gate-owned timeout and prove one clean-server run, not only a warmed rerun.
- Retain the current IndexedDB plus canonical-import fixture path.

### P3

No separate P3 defect was found. The lower-severity issues relevant to closure are included in the evidence corrections below.

## Evidence corrections

The following prior claims are inaccurate or insufficiently supported:

1. `text-02-phase-entry.md:593-594` claims Renderer PNG/PDF and immutable-publication coverage for the resource-bearing document. The document is referenced only by the new document, Fabric, React style-object, and Renderer HTML tests.
2. `text-02-phase-entry.md:601-603` presents the 1,000-run benchmark as the rich-text scale bound. It covers one favorable token/width distribution and misses the seconds-long valid input above.
3. `text-02-phase-entry.md:624-628` and `remediation-progress.md:3281-3285` describe HMR style retention and row spacing as accepted, permanent evidence. The hot-update portion is manual only; the automated non-overlap assertion is neither compact nor part of the 1,000-layer case.
4. The cited 40/40 WebMCP run is broad regression evidence, not Gate 5 text-system evidence. The only change in `packages/webmcp/test/registration.test.ts:881-890` repairs an image fixture by adding `assetId`; it adds no clipboard, resource-conformance, rich-text scale, or published-style assertion.
5. The focused test counts are reproducible for the clean reviewed commits, but passing counts do not repair the missing input classes and artifact paths above.

## Areas with no confirmed defect

### Portable clipboard semantics

No implementation defect was confirmed in the reviewed change. `packages/document/src/text-clipboard.ts:67-109` materializes base appearance and strips local typography/paint IDs; parsing repeats materialization at `:215-225`; paste repeats it at `:268-300`. Paragraph and link normalization remain in the payload, payload sizes are bounded, and link targets are restricted to HTTPS, mail, and telephone schemes in `packages/document/src/rich-text.ts:73-94`. Fabric writes plain text, HTML fallback, and custom MIME, and reads them in that order at `packages/editor/src/fabric-adapter.ts:953-988`.

This conclusion is limited: tests use in-memory `Map`/payload objects rather than copying between two live documents. A retained two-document browser test should still assert that pasted appearance survives and no source-document IDs remain.

### Intended quotation resource coherence

For resources intended to belong to the quotation palette, the update order is coherent: node/run values are mapped, paint styles and color variables are mapped, paint styles are propagated, then variable bindings reassert their authoritative values. The focused domain test validates the aggregate after application. The ownership collision above is the unresolved boundary.

### Provider identity and fixed-row implementation

The new context module creates one shared Context object outside provider implementation refreshes. The provider imports that identity and memoizes a complete API value. The virtual tree uses one canonical row height for total size, row container height, and transform. Static inspection found no contradictory second geometry source. Runtime HMR and combined-scale coverage remain missing as described above.

## Coverage map

| Area                           | Production paths read                                                                                        | Tests/evidence read                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Canonical rich text and layout | `rich-text.ts`, `text-range-editing.ts`, `text-layout.ts`, `render-projection.ts`, `text-clipboard.ts`       | document clipboard, layout, conformance, publishing tests                                        |
| Reusable styles and variables  | `design-styles.ts`, `variables.ts`, command application, conformance fixture                                 | quotation application, conformance, Fabric, React render-view, Renderer HTML                     |
| Fabric editing                 | text projection, clipboard bridge, paste application, editing state publication in `fabric-adapter.ts`       | focused Fabric adapter suite                                                                     |
| React rendering                | text line/segment styles, node style, Artboard node rendering in `packages/render-view/src/index.tsx`        | render-view conformance suite                                                                    |
| Renderer and PDF path          | HTML text serialization, resource readiness, output HTML, Worker PDF/PNG request path                        | Renderer HTML and Worker tests; no resource-bearing painted artifact test exists                 |
| Publication                    | immutable `createTemplateVersion` path and rich-text retention tests                                         | publishing tests; no resource-bearing conformance publication case exists                        |
| Quotation                      | template application, exact-token mapping, style propagation, variable reapplication, source refresh callers | quotation application and template lifecycle tests                                               |
| Live update and persistence    | context/provider split, route ownership, StrictMode runtime lifecycle                                        | source-layout and mounted StrictMode tests; manual HMR record                                    |
| Layers                         | model consumption, virtual range, ARIA ownership, fixed geometry, selection/focus and drag bindings          | IndexedDB/import E2E fixture, small-tree non-overlap, compact sizing, 1,000-layer virtualization |
| WebMCP                         | registration suite change and existing publication/render path                                               | full focused registration suite; no new Gate 5 text assertion                                    |

## Commands and results

All clean-commit verification used Node `v22.23.2`, satisfying the repository `>=22.12.0` engine. The host default Node `v18.18.1` cannot load the current Vitest/Rolldown stack and was not treated as a product failure.

- `git diff dbdab41^..786bf35`, complete tracked range: 21 files, 860 insertions, 137 deletions; every changed source/test file was inspected.
- `git diff --check dbdab41^..786bf35`: passed.
- Clean archive of `786bf35`, focused document tests: 35/35 passed.
- Clean archive, render-view conformance: 14/14 passed.
- Clean archive, Renderer HTML: 23/23 passed.
- Clean archive, Fabric adapter: 83/83 passed.
- Clean archive, WebMCP registration: 40/40 passed.
- Clean archive, persistence route plus StrictMode provider: 4/4 passed.
- Clean archive typechecks for document, editor, render-view, Renderer, WebMCP, and Studio: passed.
- Independent favorable-fixture benchmark: 10.5-15.1 ms over ten warm projections.
- Independent adverse valid-input benchmark: 4.841 s at 7,000 characters, 11.667 s at 14,000, and 17.880 s at 28,000.
- `curl http://localhost:3001/` against the initially running reviewed app: HTTP 200, confirming that only the required port was used.
- In-app browser navigation to the host's port 3001 was unavailable in the selected browser environment (`localhost` was client-blocked and `127.0.0.1` could not reach the host listener), so it was not substituted with port 3000.
- Focused Playwright run on the changing shared port-3001 server: both cases were blocked in `beforeEach` by a mixed COMPONENT-01 schema-v4 route error. This failure is not attributed to commits `dbdab41..786bf35`.
- Isolated clean `786bf35` server on port 3001: the first cold two-case run timed out during start/editor admission; on the warmed rerun, the 1,000-layer case passed in the combined run and the hierarchy/non-overlap case passed alone in 29.8 seconds. This earns behavior evidence for both cases but also confirms a cold-start reliability gap in the test harness.
- After the concurrent COMPONENT-01 work landed as `85c3989`, a clean restart of current HEAD returned HTTP 500 with `.pick() cannot be used on object schemas containing refinements`. That later-commit failure is outside this review range and is not included in the TEXT-02 finding count.

## Current working tree note

During this review, another active change set modified document schema, seed, composer, decoder, validation, conformance fixtures, tests, and COMPONENT-01 audit files, then landed as `85c3989` after the requested endpoint `786bf35`. Those changes were preserved and not reviewed as part of TEXT-02. They explain the shared-server route errors and are not included in this report's defect count. No implementation or test file was modified by this review.

## Closure verdict

TEXT-02 **may not close** at `786bf35`.

The portable clipboard change, intended quotation-resource update order, context identity split, and fixed virtual-row geometry are credible. They do not offset the confirmed rich-text UI-freeze path or the absence of the Gate 5 resource-bearing PNG/PDF/publication oracle. Close P1 layout complexity, add the actual artifact conformance path, rerun the port-3001 desktop/compact journey on a stable working tree, and obtain a follow-up independent review before changing the phase to complete.
