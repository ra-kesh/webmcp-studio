# Independent code review

Reviewed working tree: `/Users/rakesh/Developer/webmcp-studio`
Review date: 2026-08-27
Disposition: production blocked

## Confirmed defects

### P0-1. The deployed shape exposes an unauthenticated, unmetered browser-rendering primitive with attacker-controlled fetches and dimensions

`POST /v1/studio/export-png` and `POST /v1/studio/export-pdf` accept a complete caller-supplied document and invoke the Browser Rendering service without resolving even the demo session (`apps/studio/src/routes/v1/studio/export-png.ts:19-94`, `apps/studio/src/routes/v1/studio/export-pdf.ts:19-89`). The normal publish/render path is not an authentication boundary either: `resolveDemoSession` creates a new workspace and bearer credential for any caller (`apps/studio/src/server/demo-session.ts:38-70`, `apps/studio/src/server/demo-session.ts:75-103`). The public Studio Worker has Browser Rendering, D1, and R2 bindings (`apps/studio/wrangler.jsonc:11-32`), but I found no rate limit, quota, tenant budget, abuse check, or authenticated production mode.

The request schema permits any positive node and page dimensions and arbitrary CSS-like strings (`packages/document/src/schema.ts:5-17`, `packages/document/src/schema.ts:81-140`). Aggregate validation permits any `https://` image (`packages/document/src/validation.ts:225-250`). The renderer interpolates unvalidated `fill`, `stroke`, `color`, `fontFamily`, page background, and image source into inline styles and HTML (`apps/renderer/src/html.ts:16-67`, `apps/renderer/src/html.ts:81-119`). HTML escaping does not make a string safe as a CSS value: semicolons and `url(...)` remain meaningful CSS. Rendering then opens a browser, uses the requested viewport, fetches page resources, and writes an R2 object (`apps/renderer/src/index.ts:66-115`, `apps/renderer/src/index.ts:145-217`). At minimum this is a direct cost-exhaustion endpoint. It also creates an application-level server-side fetch surface for arbitrary HTTPS hosts, redirects, and CSS URLs. Whether Cloudflare blocks a particular private address does not repair the missing application policy.

User/business impact: a public deployment can be used to consume Browser Rendering, R2, and D1 capacity, create unbounded demo tenants, and fetch attacker-selected remote resources. A production API cannot safely expose this shape.

Existing tests: no test should be considered adequate here. The browser suite exercises a cooperative publish/render journey, and renderer unit tests use mocked Browser/R2 bindings. There is no unauthenticated abuse, quota, DNS/IP, redirect, CSS-value, oversized-viewport, or concurrency test.

Acceptance test: in a deployed-worker integration environment, assert that an unauthenticated caller cannot invoke the renderer binding; that a valid principal is subject to request, page, node, pixel-area, render-frequency, and storage budgets; that image/CSS resources must resolve through approved asset identifiers or a fetch proxy that rejects private, loopback, link-local, multicast, and redirect-to-private addresses; and that every rejection occurs before Browser Rendering or R2 is called. Include concurrent requests and a document with CSS `url(...)` tokens. Avnac Studio's reviewed media path is a useful behavioral reference because it checks IP classes, redirects, and body sizes before accepting remote media; its code should not be copied across license boundaries.

### P1-1. Publication identity still collapses distinct undo branches that reuse the same revision number

History now has a real snapshot identity. Undoing and branching can intentionally produce two different snapshots with the same document revision (`packages/editor/src/history.ts:111-155`, `packages/editor/src/history.ts:184-205`). The E2E suite explicitly proves that condition (`apps/studio/test/e2e/history-transaction-integrity.spec.ts:123-131`). Publication ignores it: `publishTemplate` treats the latest version as already published whenever only `sourceRevision` matches and returns the prior immutable version (`apps/studio/src/features/editor/use-document-editor.ts:600-640`, especially `:610-625`).

The persistence audit trail has the same identity error. `document_revisions` is keyed by `(document_id, revision)` (`migrations/0001_initial.sql:19-25`), and publishing uses `INSERT OR IGNORE` (`apps/studio/src/server/template-repository.ts:87-99`). If branch A at revision N has been stored and branch B reaches the same revision N with different JSON, the document-revision row silently continues to describe A even if a later template-version row describes B.

User/business impact: publish A, undo, create B at the same revision, and press Publish. The UI can report a successful immutable publication while returning A. This violates the advertised immutable-version boundary and makes the revision audit trail unreliable.

Existing tests: the history test should have led to a cross-boundary publication test, but it stops after validating WebMCP snapshot conflicts. Publish tests only cover monotonic happy paths. The remediation claim that `REV-01` established durable snapshot identity is therefore only true inside history and WebMCP proposals, not at publication or D1 revision storage.

Acceptance test: publish snapshot A at revision N, undo, branch to snapshot B at revision N, publish again, and assert that version N+1 contains B, the server returns a new immutable version, both snapshots remain addressable in the audit store, and the second publish is idempotent only for B's content identity. Use a server-derived content hash or immutable snapshot ID rather than revision alone.

### P1-2. The inspector's group-level “To front/To back” action throws on the first command

The inspector offers edge reordering for a movable multi-selection (`apps/studio/src/features/editor/inspector-sidebar.tsx:566-588`, `apps/studio/src/features/editor/inspector-sidebar.tsx:740-761`), and both desktop and compact shells wire it to `editor.reorderSelection` (`apps/studio/src/features/studio-shell.tsx:1417-1447`, `apps/studio/src/features/studio-shell.tsx:1514-1544`). That callback emits a sequence of single-node `reorder_node` commands (`apps/studio/src/features/editor/use-document-editor.ts:1206-1230`). Every command is aggregate-validated immediately (`packages/document/src/commands.ts:344-367`, `packages/document/src/commands.ts:913-919`), while group descendants are required to remain one contiguous stack (`packages/document/src/validation.ts:358-377`).

I reproduced this directly against the current quotation document. `quotation-group-2` contains `text-2` through `text-5` at indexes 1 through 4. Moving its first node to the front throws `Cover identity must occupy one contiguous layer stack` before the rest of the transaction can run. `commit` does not convert this into a recoverable UI result, so the event can reach the route error boundary.

This is also proof of stale parallel command paths. Layer-tree drag/drop correctly builds the atomic `reorder_nodes` command (`packages/editor/src/layer-tree.ts:342-421`), while the inspector toolbar still uses the older per-node loop.

User impact: selecting a semantic group and invoking a prominently enabled arrangement action can crash the editor instead of moving the group. The same defect affects compact Properties because it shares the callback.

Existing tests: the 27 browser tests cover tree drag/drop, keyboard operations, mixed inspector edits, and compact inspector parity, but none invokes multi-layer “To front” or “To back.” Unit tests prove `reorder_nodes`, not that every UI caller uses it. `CMD-01` and the layer-tree completion claim are insufficient because a second visible command path bypasses the canonical operation.

Acceptance test: select a nested semantic group on desktop and compact widths, invoke both edge actions, and assert one atomic history entry, preserved group contiguity/parentage, exact paint order, no uncaught error, and exact undo/redo. The test should fail if any UI caller emits multiple `reorder_node` commands for a multi-node block.

### P1-3. Page and selection duplication silently remove shared-field semantics

The `duplicate_page` command can carry only a page, nodes, and groups (`packages/document/src/schema.ts:311-316`). The UI clones those three structures (`apps/studio/src/features/editor/use-document-editor.ts:1439-1490`), and the reducer appends exactly those structures (`packages/document/src/commands.ts:663-704`). Bindings are not remapped to the cloned node IDs. A duplicated page can therefore look correct at the moment it is created but stop responding to shared fields and API modifications. Selection duplicate and copy/paste repeat the same semantic loss by cloning only nodes (`apps/studio/src/features/editor/use-document-editor.ts:1079-1136`), and also discard group membership.

This is not hypothetical in the starter: Cover has a text binding, while Overview has none. The existing page test duplicates Overview (`apps/studio/test/e2e/page-output-management.spec.ts:47-53`) and asserts only page count and name, so it selects the one page that cannot reveal the defect.

User/business impact: a designer can duplicate a page or bound content for a variant, publish it, and later discover that Stuwiz/API field updates change only the original. The duplicated visual becomes stale commercial content.

Existing tests: `page-output-management.spec.ts` should have caught this but uses an unbound source and never inspects the manifest or materialized values. This makes the `PAGE-01 complete` claim inaccurate. Command tests do cover binding cloning for `add_output_variant`, which shows the required behavior exists elsewhere but is not reused.

Acceptance test: duplicate a page containing text, `src`, `visible`, and `fill` bindings. Assert fresh binding IDs target fresh node IDs, field values materialize on both pages, the published manifest lists both targets, IDs do not collide, and one undo removes the entire clone. Repeat for duplicating/copying a selected group and define whether bindings are cloned or intentionally detached with an explicit UI choice.

### P1-4. Switching quotation templates discards manual document work despite promising that content stays fixed

The template catalog tells the user, “The content stays fixed. Only the visual system changes” (`apps/studio/src/features/editor/quotation-sidebar.tsx:52-71`). The handler does not apply a visual-system delta. It recomposes a brand-new document from the stored quotation source and replaces the entire current aggregate (`apps/studio/src/features/editor/use-document-editor.ts:1684-1713`). Any manual text edit, added page, added layer, accepted agent change, reorder, group edit, or output adjustment made after quotation import disappears. Undo can recover the previous aggregate, but there is no warning, diff, or scope choice before the destructive replacement.

User/business impact: selecting a template card can erase substantial design work under copy that explicitly promises preservation. That is a high-trust data-loss interaction even though undo exists.

Existing tests: composer tests prove that three cleanly composed documents have stable source content and pagination (`packages/document/test/quotation-composer.test.ts:108-118`). They do not mutate a document before switching. The clean E2E journey does not switch templates after edits. Prior audit guidance correctly rejected destructive template replacement; remediation did not close this path.

Acceptance test: import a quotation, edit bound and unbound text, add/reorder/group layers, add a page, and accept a WebMCP change set. Switch templates and assert that preserved semantic content and user structure survive while documented style tokens change. If some changes cannot be mapped, require an explicit confirmation with a concrete diff and a cancel path, then verify one-step undo.

### P1-5. A corrupt local draft is silently overwritten by the starter document after reload

Draft restore parses local storage and reports relationship errors only when the JSON passes the schema (`apps/studio/src/features/editor/use-document-editor.ts:220-244`). A schema-invalid parse has no error branch. In all cases the effect sets `didRestore.current = true` (`:277`), and the persistence effect writes the current in-memory seed after 450 ms (`:307-319`). Relationship-invalid JSON follows the same overwrite path after showing an error. The original draft is neither quarantined nor retained for recovery.

User impact: a schema migration, partial browser write, extension corruption, or prior-version draft can be replaced by the starter quotation simply by opening the app. The UI's “autosave” framing overstates durability.

Existing tests: the validation E2E imports invalid JSON through the file picker (`apps/studio/test/e2e/document-validation-boundaries.spec.ts:34-62`). It does not seed malformed or relationship-invalid local storage before boot and therefore cannot detect overwrite-on-restore.

Acceptance test: seed malformed JSON, schema-invalid JSON, and aggregate-invalid JSON under the production key, reload, wait longer than the save debounce, and assert the original bytes remain unchanged in a quarantine/recovery record. The editor must display a persistent recovery/reset choice and must not write a new draft until the user chooses one.

### P1-6. The renderer can mark an artifact successful when required images or the managed font failed to load

Renderer HTML loads the only supported font from an external CDN and marks the page ready when `document.fonts.ready` resolves (`apps/renderer/src/html.ts:3-6`). That promise resolves after font loading settles; it does not mean the required face succeeded. Image markup has no decode/error barrier (`apps/renderer/src/html.ts:52-53`). PNG and PDF paths wait for network idle and the marker, then immediately capture (`apps/renderer/src/index.ts:71-87`, `apps/renderer/src/index.ts:154-168`). An HTTPS image may return 404 or an undecodable body and still yield a completed artifact containing a broken/blank image. A font outage may silently fall back to sans-serif and change wrapping and pagination.

User/business impact: the API can return status `completed`, persist an R2 artifact, and charge for a render that does not match the published template. For quotations, missing imagery or reflowed commercial terms is not a cosmetic failure.

Existing tests: HTML tests assert emitted substrings, including the CDN URL, rather than browser decode success (`apps/renderer/test/html.test.ts:87-110`, `apps/renderer/test/html.test.ts:157-160`). Renderer Worker tests mock a successful PDF body. The clean browser journey uses cooperative assets and checks PDF structure/text, not visual equivalence or resource failure.

Acceptance test: render with a 404 image, corrupt image bytes, a redirect failure, and a blocked font origin. Assert the job fails before R2 write with a stable resource error. For success, evaluate every required image as `complete && naturalWidth > 0`, verify the exact managed font face with `document.fonts.check`, and run pixel/geometry comparison against the editor at representative pages and long-text boundaries. Prefer versioned first-party assets instead of a runtime CDN dependency.

### P2-1. Malformed JSON produces an unhandled 500 on public API routes

The Studio render, preview export, and publish handlers call `request.json()` outside a parse-error boundary (`apps/studio/src/routes/v1/studio/render.ts:213-245`, `apps/studio/src/routes/v1/studio/export-png.ts:22-48`, `apps/studio/src/routes/v1/studio/export-pdf.ts:22-48`, `apps/studio/src/routes/v1/studio/templates/index.ts:54-88`). The private renderer repeats the pattern and only enforces body size when `Content-Length` exists (`apps/renderer/src/index.ts:28-47`, `apps/renderer/src/index.ts:119-130`).

I sent a one-byte `{` body with `Content-Type: application/json` to `/v1/studio/export-png`, `/v1/studio/render`, and `/v1/studio/templates/`. All three returned HTTP 500 with `{"status":500,"unhandled":true,"message":"HTTPError"}` instead of the documented error contract.

User/business impact: ordinary client truncation is misclassified as a server fault, pollutes error telemetry, and makes retry behavior unsafe. The renderer's missing-header path also lacks a bounded streaming reader.

Existing tests: schema-invalid but syntactically valid JSON is covered. Malformed, empty, truncated, and chunked bodies are not.

Acceptance test: for every JSON POST route, submit empty, malformed, truncated, wrong-content-type, invalid `Content-Length`, and headerless chunked bodies. Require a stable 400/411/413 contract, no stack-shaped response, no DB/renderer/R2 call, and a byte-capped reader independent of the header.

### P2-2. The HTTP render API accepts duplicate output/format selections and creates duplicate artifact records

The render schema limits the selection array but does not require unique `(outputId, format)` pairs (`apps/studio/src/routes/v1/studio/render.ts:11-36`). Validation checks existence and format support only (`apps/studio/src/routes/v1/studio/render.ts:317-344`). The execution loop invokes the same renderer again for every duplicate (`apps/studio/src/routes/v1/studio/render.ts:388-416`) and inserts every returned artifact (`:418-441`). Renderer keys are deterministic per render/output/page (`apps/renderer/src/index.ts:88-96`, `apps/renderer/src/index.ts:193-202`), so duplicates overwrite the same R2 key while producing multiple DB artifact rows.

WebMCP rejects the same invalid input correctly with a `seen` set (`packages/webmcp/src/registration.ts:479-515`). This is a confirmed parity split between API control surfaces.

User/business impact: duplicate work is charged, response/history contains ambiguous duplicates, and multiple artifact IDs can point to one overwritten object.

Existing tests: WebMCP parser coverage does not protect the HTTP route. No route test submits duplicates.

Acceptance test: send a repeated output/format pair and require 400 or 422 before render-job insertion or renderer invocation. Add a database uniqueness constraint for the artifact identity expected by the product and run the same contract cases through UI, HTTP, and WebMCP adapters.

### P2-3. The gesture implementation globally disables browser zoom, including over inspector and dialogs

Canvas wheel handling is correctly attached to the workspace (`apps/studio/src/features/editor/use-canvas-gesture-navigation.ts:157-174`, `:204-207`), but a second listener is attached to `document` and calls `preventDefault` for every Ctrl/Meta-wheel event (`:176-178`, `:208-216`). This blocks browser page zoom while the pointer is over the toolbar, inspector, fields, template catalog, or modal content.

The browser test explicitly encodes the regression: “a modifier-wheel outside the canvas cannot zoom the application” and asserts the visual viewport does not change (`apps/studio/test/e2e/canvas-gesture-navigation.spec.ts:75-110`). The test proves isolation from the canvas camera by violating the browser's accessibility zoom behavior. OpenPencil's reviewed wheel/gesture code scopes cancellation to the canvas input surface.

User impact: keyboard/mouse users who need page magnification lose a standard browser accessibility feature across the entire application.

Existing tests: an existing test should have caught this, but its expected result is backwards. Passing is evidence of the defect.

Acceptance test: dispatch a cancelable Ctrl/Meta-wheel event over inspector and dialog controls and assert it is not `defaultPrevented`; verify browser zoom remains available manually. Over the canvas, assert camera zoom changes around the pointer and browser zoom does not. Test Windows/Linux Ctrl and macOS Meta/pinch behavior separately.

### P3-1. The new-document dialog still advertises a starter that no longer exists

The Starter gallery says “Five proposal pages plus WhatsApp and follow-up outputs” (`apps/studio/src/features/editor/new-document-dialog.tsx:96-124`). `Reset to starter` actually restores `quotationSeed` (`apps/studio/src/features/editor/use-document-editor.ts:1646-1664`), which currently contains six pages in one `Quotation` output and no WhatsApp or follow-up output (`packages/document/src/quotation-composer.ts:730-780`; the fixture page count is also exercised at `packages/document/test/quotation-composer.test.ts:50-64`). This is stale parallel UI left over from the earlier Northstar seed architecture.

User impact: the entry point promises an output pack that the user cannot find after choosing it, undermining trust in templates and output management.

Existing tests: responsive tests prove the dialog is reachable and focusable but do not compare its claims with the restored aggregate. The audit asset `05-new-document-dialog.png` visibly contains the stale copy.

Acceptance test: make starter metadata a single typed source consumed by the dialog and reset command. Assert the preview's page/output names and counts equal the restored document, including after a composer change.

## Architectural risks

These are not presented as reproduced user failures, but the code path is incomplete enough that production acceptance needs explicit evidence.

### P2 risk. Asset import crosses an asynchronous mutation boundary without revalidation or rollback

`addImageFile` checks review mode once, captures the active page, awaits image decode and IndexedDB persistence, then commits using the stale page (`apps/studio/src/features/editor/use-document-editor.ts:813-878`). `replaceImageFile` follows the same pattern (`:924-964`). A pending WebMCP review, page/document replacement, or node deletion can occur during the awaits. The later commit may reject while the blob and object URL remain orphaned. The asset store implements only put/get, with no delete/list transaction for rollback or garbage collection (`apps/studio/src/features/editor/local-asset-store.ts:15-71`).

Acceptance test: pause decode/storage, introduce a pending change set or replace/delete the target, resume, and assert no document mutation, no orphaned IndexedDB row/object URL, and a clear recoverable status. Recheck snapshot/page/node after awaits and make persistence plus document reference atomic or compensating.

### P2 risk. The quotation group “migration” infers schema version from IDs/topology and can replace user-authored grouping

Restore recognizes a quotation by one document ID, absence of `quotation-group-*`, exact page/node topology, and whether each existing group happens to equal any seed block (`apps/studio/src/features/editor/use-document-editor.ts:71-124`). It then replaces the entire group collection with today's seed grouping. There is no document-format migration version, source hash, or applied-migration marker. A custom group that coincides with a seed block can lose its name or parent structure. The claim that unrelated custom grouping is preserved is not demonstrated for coincidental matches.

Acceptance test: migrate versioned flat legacy fixtures, partially grouped fixtures, custom groups that match and overlap seed blocks, and already migrated fixtures. Assert only explicitly versioned legacy shapes transform, user metadata is retained, and repeated restore is idempotent.

### P2 risk. PDF artifact handling can exceed Worker memory near its nominal 64 MiB limit

The renderer copies every stream chunk (`apps/renderer/src/artifact-body.ts:59-76`) and creates a Blob from all chunks (`:92-94`), then supplies that Blob to R2 and a new Response (`apps/renderer/src/index.ts:176-217`). At the 64 MiB application limit (`apps/renderer/src/artifact-body.ts:1`), chunks, Blob backing storage, browser response state, and platform serialization may coexist. Unit tests use tiny synthetic bodies, not a near-limit Worker execution.

Acceptance test: render and store artifacts just below and above the chosen production threshold in the deployed Worker with memory telemetry. Demonstrate bounded peak memory and correct cancellation. Lower the cap or use a platform-supported fixed-length/streaming strategy if the current copy pattern cannot stay within the runtime budget.

### P3 risk. Migration-added publication identity columns remain nullable

Migration 0002 adds `template_versions.id` and `source_revision` without `NOT NULL`, backfills from JSON, then creates only a unique index on `id` (`migrations/0002_published_version_identity.sql:1-9`). Runtime row types assume both are present (`apps/studio/src/server/template-repository.ts:9-17`), and parsing a legacy/null row can fail far from migration time.

Acceptance test: migrate databases containing valid legacy rows, malformed document JSON, and null/missing revisions. The migration should either rebuild the table with `NOT NULL` and verified checks or fail transactionally with an actionable repair path; all successfully migrated rows must pass the runtime schema.

### P3 risk. Editor, thumbnails, and export use three rendering implementations without a shared visual oracle

The editor uses Fabric, thumbnails use the React renderer (`packages/render-view/src/index.tsx:4-120`, `:123-162`), and published artifacts use hand-built HTML/CSS (`apps/renderer/src/html.ts:16-119`). The latter two duplicate node-type styling, and `@webmcp/render-view` has no tests. The passing PDF journey verifies file bytes, page count, and extractable text, not editor-to-artifact geometry.

Acceptance test: build a golden corpus for every node type, rotation, opacity, line-height, crop, border, page size, long text, and mixed output. Compare Fabric, thumbnail, PNG, and PDF rasterizations with explicit tolerances and fail releases on drift.

## Missing product depth

These are not bugs in implemented promises; they are gaps between the current product and the stated Figma/Canva/Orshot/Stuwiz production goal.

- The quotation “catalog” is three hard-coded palettes that recompose one quotation (`packages/document/src/quotation-composer.ts:33-76`, `apps/studio/src/features/editor/quotation-sidebar.tsx:52-111`). There is no template repository UX with categories, search, preview state, thumbnail pipeline, provenance/licensing, reusable components, or safe mapping of user edits.
- Persistence is one fixed local-storage document key and one local array of published versions (`apps/studio/src/features/editor/use-document-editor.ts:61-69`, `:220-319`). There is no document list, create/open/rename/duplicate/delete lifecycle, conflict resolution, storage quota UX, schema-version repository, cloud synchronization, or multi-tab coordination.
- Local assets are blobs with put/get only (`apps/studio/src/features/editor/local-asset-store.ts:15-71`). There is no asset inventory, delete/garbage collection, durable upload state, R2 promotion, content hash/deduplication, licensing metadata, or published-document asset pinning.
- Text remains a plain box with estimated overflow checks. There is no rich text, inline spans, auto-size policy, text-on-path, deterministic hyphenation, brand font management, or robust overflow repair workflow. The audit documents already identify these gaps; the current remediation does not turn them into a production text system.
- WebMCP exposes ten useful tools, but tests primarily inject a fake `modelContext` map (`packages/webmcp/test/registration.test.ts:40-137`) or call `window.__studioTestTools` directly. Manual browser inspection confirmed that ten tools register, but there is no end-to-end client/transport conformance, authorization/scope model, audit persistence for proposals, or rate policy.
- Output rendering works synchronously in the request path (`apps/studio/src/routes/v1/studio/render.ts:346-460`). There is no queue, durable retry, cancellation, progress, lease/heartbeat, worker crash recovery, or production concurrency control despite the schema carrying queued/rendering states.

## Prior claims that are inaccurate or insufficiently supported

- `REV-01 snapshot identity` is real for history and WebMCP proposal conflicts, but not for publication deduplication or `document_revisions`. Calling the product-level problem complete would be false.
- `CMD-01 canonical commands` is only partially true. Layer-tree movement uses atomic canonical commands, while inspector edge ordering still emits a fragile sequence of legacy single-node commands.
- `PAGE-01 page/output management complete` overstates the implementation because page duplicate discards field bindings and its test deliberately duplicates an unbound page.
- `NAV/A11Y-01 complete` is supported for hierarchy, virtualization, focus, search, keyboard selection, compact controls, and modal focus. It is not sufficient for application accessibility because the gesture layer globally blocks browser zoom.
- `QUOT-01 semantic group migration preserves unrelated custom grouping` lacks migration-version evidence and does not cover coincidental seed-block groups. The composer does produce 78 groups for the current fixture, but count is not migration safety.
- `autosave/local persistence` is not production durability. A corrupt draft is overwritten, local assets cannot be reconciled, and there is only one fixed document slot.
- `renderer/publication path complete` is earned only for the cooperative happy path. It is not complete for resource integrity, abuse control, malformed input, branch identity, queues/retries, or visual parity.
- The test count is not proof of these boundaries. The current suite has good focused coverage, but several passing tests restate implementation choices: HTML tests assert emitted strings; the outside-canvas gesture test asserts browser zoom is blocked; page duplication asserts only count/name; WebMCP registration tests mostly exercise an in-memory service harness.

## Areas where the current evidence did earn a positive conclusion

I did not assume correctness from screenshots or test counts. The following conclusions are limited to the evidence named.

- **Aggregate validation:** document commands validate the full aggregate after each command (`packages/document/src/commands.ts:913-919`), and import, publish, renderer, and materialization boundaries use document validation. Unit tests cover duplicate IDs, relationship failures, unsafe image schemes, binding incompatibility, group cycles/contiguity, local-asset publication, and managed fonts. Browser tests confirm invalid imports preserve the current document and invalid publish requests do not create a version. This earns correctness for the relationships covered, not for bounded dimensions/CSS values or remote-resource policy.
- **History and review identity:** history transactions carry before/after snapshots and snapshot IDs, coalescing is explicit, undo/redo restore snapshot identity, and WebMCP proposals require `baseSnapshotId`. The browser branch test proves same-revision snapshots are rejected by the proposal path. The publication exception is documented above.
- **Layer tree:** the tree is built from real nested groups, not a flat list with indentation (`packages/editor/src/layer-tree.ts:65-188`). It computes aggregate lock/visibility, implements search with ancestor context, emits atomic reorder/reparent commands, and the React view uses virtualization with active/ancestor retention (`apps/studio/src/features/editor/layer-tree.tsx:484-636`). Browser coverage includes ARIA metadata, tree-local focus, keyboard selection, rename, atomic group state, review blocking, pointer reparenting, compact controls, and a 1,000-layer restored document. This is substantive implementation, subject to the parallel inspector defect.
- **Responsive shell:** manual runs at 1440×900 and 390×844 showed the same business actions reachable through the desktop shell and compact More/Document/Properties surfaces. Compact Layers used a modal sheet with focus handling. The viewport-matrix and modal-focus browser tests passed. This earns action reachability and modal mechanics, not browser zoom accessibility or complete product workflows.
- **Quotation composition:** the contract is strict and validates cross-references and totals. Composition produces a dynamic six-page document with more than 50 groups (78 for the reviewed fixture), and expanded terms add pages rather than clipping. It is a serious deterministic composition scaffold. Template switching and migration safety remain incomplete.
- **Happy-path publication/render:** the browser journey published the actual document, requested a PDF, downloaded it, matched artifact byte counts, parsed it, and verified seven pages plus text. The route is not a screenshot-only mock. This earns one cooperative end-to-end path, not security, failure handling, resource completeness, or visual equivalence.
- **WebMCP registration:** manual browser inspection showed ten tools registered on the live route, and the code exposes snapshot identity, active page groups, outputs, fields, review state, publication, render history, and render actions. Parser code correctly rejects duplicate render selections. HTTP parity and real transport/security coverage remain gaps.

## Coverage map

| Area                     | Main code paths read                                                                                                                                                                                                                                                                                                                        | Tests/evidence read or run                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit and product intent | Every file in `docs/audits/2026-08-27-editor-production-readiness`, all 15 audit assets, `editor-interaction-model.md`, `openpencil-editor-north-star.md`, `stuwiz-quotation-composition.md`, `api.md`, product/architecture/editor-readiness/reference docs, and all ADRs                                                                  | Compared remediation statements to current code and runtime; visually inspected representative desktop, mobile, clipped-toolbar, and blank-document assets                                           |
| Studio state/runtime     | Full `use-document-editor.ts`; material portions of `studio-shell.tsx`, Fabric artboard, inspector, inspector controls, page/output panel, filmstrip, quotation panel, layer tree, gestures, local assets, WebMCP hook, render history                                                                                                      | Manual desktop/compact exercise; all Studio unit and browser tests; focused group-reorder reproduction                                                                                               |
| Document model           | Schema, validation, commands, change sets, fields, groups, publishing, quotation contract/composer/fixture/seed                                                                                                                                                                                                                             | 45 document tests; targeted fixture inspection for groups and page bindings                                                                                                                          |
| Editor core              | History, command catalog, inspector model, layer-tree model, structure commands, viewport, geometry, Fabric adapter                                                                                                                                                                                                                         | 46 editor tests; history and layer-tree browser tests                                                                                                                                                |
| API and persistence      | Studio export/render/template/composition/session/render-download routes; demo session; template repository; migrations; Wrangler config                                                                                                                                                                                                    | Malformed-body HTTP probes; publish/render E2E; inspected D1/R2 identity and ownership queries                                                                                                       |
| WebMCP                   | Registration, public projection, proposal parsers, change-set creation/application                                                                                                                                                                                                                                                          | 16 WebMCP tests; browser tool registration/inspection; compared HTTP duplicate behavior                                                                                                              |
| Rendering                | Renderer Worker, HTML serializer, artifact reader, React render-view, renderer/studio Wrangler bindings                                                                                                                                                                                                                                     | 11 renderer tests; real seven-page PDF journey; render-view has no tests                                                                                                                             |
| UI primitives            | Sheet, slider, responsive shell composition                                                                                                                                                                                                                                                                                                 | Compact dialog/focus manual check and E2E                                                                                                                                                            |
| References               | OpenPencil commands/actions/capabilities, selection state, canvas wheel/gesture/pan/zoom/pointer and workspace shell; cited Avnac vector/IDB/document paths; Avnac Studio appdata/media/engine docs; Canva-clone templates/project states; react-design-editor shell/theme; Polotno templates/uploads/side panel/images/size/page/text docs | Behavior and architecture comparison only. No reference code copied. One cited Avnac Studio `workspace_sync.go` path was absent from the checked-out reference tree and was not treated as evidence. |

I inspected the complete tracked change list and current versions of every changed source/config/test path, plus every untracked source and test file. Generated route-tree and lockfile changes were checked for their route/dependency effects. Audit assets were supporting evidence only; conclusions above come from code, runtime, and focused tests.

## Commands and results

- `git status --short`, `git diff --stat`, `git diff --name-status`, and `git ls-files --others --exclude-standard`: reviewed 36 tracked changed/deleted files plus all untracked source, test, docs, and assets. The tracked diff at final reconciliation was 4,288 insertions and 2,340 deletions.
- `git diff --check`: passed.
- `bun run typecheck`: passed for Studio, renderer, document, editor, UI, WebMCP, and render-view.
- `bun run test`: 126 tests passed: Studio 8, renderer 11, WebMCP 16, document 45, editor 46. `packages/render-view` has no test files and exits successfully only because `--passWithNoTests` is enabled.
- `bun run --cwd apps/studio test:e2e`: 27 passed in 3.2 minutes on the final run.
- Focused Bun command against `quotation-group-2`: confirmed the first `reorder_node` throws `Cover identity must occupy one contiguous layer stack`.
- Malformed JSON probes against the live local server: `/v1/studio/export-png`, `/v1/studio/render`, and `/v1/studio/templates/` each returned HTTP 500 with the unhandled `HTTPError` envelope.
- Manual browser exercise at 1440×900 and 390×844: verified desktop and compact action reachability, compact modal Layers, page filmstrip, template/page panels, and registration of ten WebMCP tools. Browser use was supporting evidence, not a substitute for code review.

## Verdict

Truly implemented: a strict aggregate document model; meaningful history transactions and WebMCP snapshot conflict handling; a real nested, virtualized, accessible layer tree; canonical page/output CRUD foundations; deterministic Stuwiz quotation composition with semantic groups; responsive action reachability; and a cooperative publish-to-PDF path that produces an inspectable artifact.

Not production complete: security and cost control, publication identity across undo branches, semantic duplication, non-destructive template application, corrupt-draft recovery, remote-resource/render integrity, API error discipline, API/WebMCP parity, durable asset/document repositories, queued rendering, and visual parity testing. The current build is a strong editor platform scaffold with several substantial vertical slices. It is not yet a safe production editor/API, and the P0/P1 findings should block deployment under the stated goal.
