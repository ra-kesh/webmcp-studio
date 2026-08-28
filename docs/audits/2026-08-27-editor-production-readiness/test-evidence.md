# Test evidence

## Environment

- Date: 2026-08-27
- Application: `http://localhost:3000`
- Primary browser viewport: 1280 × 720
- Additional live viewports: 390 × 844 and 320 × 720
- Repository state: current working tree including pre-existing uncommitted changes
- Browser: real in-app Chromium interaction against the running local app
- Console: no browser console warnings or errors appeared on the exercised editor path; the render error was persisted and shown in product UI

The audit avoided destructive replacement of the root browser session's starter when evidence could be obtained safely through dialogs or an isolated parallel browser track. A separate clean browser track verified the blank-document dead end. The live synthetic demo session now contains published version 1 and two failed render records created by this audit.

No product source files were changed by the audit. Only this audit directory and screenshots were added.

## Screenshot index

| File                                                                                            | Evidence                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [01-initial-editor-wide.png](./assets/01-initial-editor-wide.png)                               | Initial 1280 × 720 shell and six-page starter     |
| [02-selection-inspector-after-add-text.png](./assets/02-selection-inspector-after-add-text.png) | Text insertion and selection-linked inspector     |
| [03-template-switch-midnight-restored.png](./assets/03-template-switch-midnight-restored.png)   | Whole-document quotation theme behavior           |
| [04-layer-selection-linked-inspector.png](./assets/04-layer-selection-linked-inspector.png)     | Layers, canvas, and inspector selection linkage   |
| [05-new-document-dialog.png](./assets/05-new-document-dialog.png)                               | Three fixed blank presets and starter reset       |
| [06-asset-library-dialog.png](./assets/06-asset-library-dialog.png)                             | Six-item static asset library and search          |
| [07-fields-panel.png](./assets/07-fields-panel.png)                                             | Field value and binding surface                   |
| [08-pending-review-preview.png](./assets/08-pending-review-preview.png)                         | Pending proposal review state                     |
| [09-publish-readiness-dialog.png](./assets/09-publish-readiness-dialog.png)                     | Publish validation/readiness state                |
| [10-api-playground-version-1.png](./assets/10-api-playground-version-1.png)                     | Published version 1 API playground                |
| [11-mobile-390-editor.png](./assets/11-mobile-390-editor.png)                                   | 390 px compact composition                        |
| [12-narrow-320-clipped-toolbar.png](./assets/12-narrow-320-clipped-toolbar.png)                 | Unrecoverable action clipping at 320 px           |
| [13-compact-drawer-no-modal-semantics.png](./assets/13-compact-drawer-no-modal-semantics.png)   | Compact drawer open without dialog/focus behavior |
| [14-api-render-failure-history.png](./assets/14-api-render-failure-history.png)                 | Two retained failed API render jobs               |
| [15-blank-document-dead-end.png](./assets/15-blank-document-dead-end.png)                       | Clean-browser blank document dead end             |

## Browser interaction log

### SHELL-01: initial editor

**Steps.** Open localhost at 1280 × 720 and inspect layout/accessible DOM.

**Result.** Six-page Northstar quotation, one output, one shared field. Top bar 48 px; left 236 px; right 320 px; center about 724 px; filmstrip 128 px; fit zoom 22%; top icon buttons commonly 28 × 28 px.

**Classification:** Working starter, dense fixed shell.

### EDIT-01: text, shape, selection, inspector, history

**Steps and results**

- Add text: inserted and selected.
- Edit content in inspector: applied.
- Undo/redo: content round trip worked; undo cleared selection.
- Insert rectangle, ellipse, line, heart: each worked and was undoable.
- Select layer from Layers: canvas and inspector followed.
- Double-click layer: zoom changed from 22% to about 63%.
- Rectangle width/radius/alignment/lock/unlock/hide controls: exercised paths worked.
- Invalid Width `-1`: remained displayed but did not create history or mutate the document; Escape restored the canonical value.

**Classification:** Working primitives with history and property-state defects.

### EDIT-02: clipboard, group, order, deletion

**Steps.** Exercise copy, paste, duplicate, group, ungroup, toolbar ordering, and delete on temporary objects; undo back to the original starter revision.

**Result.** Exercised operations worked. Delete removed the temporary node and cleared selection; undo restored document snapshots. No persistent audit node remained.

**Classification:** Working in tested cases; no large/nested/mixed-lock conformance test.

### CMD-01: Select shortcut conflict

**Steps.** Select a valid layer, verify inspector and Zoom to selection are enabled, press `V`.

**Result.** Selection cleared; inspector changed to Nothing selected; Zoom to selection disabled.

**Classification:** Broken.

**Source evidence:** duplicate listeners in `studio-shell.tsx:290-362` and `use-document-editor.ts:1468-1579`; visible Select button also clears selection.

### VIEW-01: pan and zoom

**Steps and results**

- Reset: 100%.
- Zoom out: 83%.
- Zoom in: 100%.
- Fit: 22%.
- Zoom to selected layer: about 63%.
- Wheel/trackpad pan: camera transform changed.
- Hand tool drag: camera changed.

**Classification:** Working. Gesture ownership outside the canvas remains over-broad in code review.

### PAGE-01: filmstrip and page management

**Steps.** Open all six visible filmstrip pages and inspect every page tile/action.

**Result.** All pages selected and rendered. No add, duplicate, rename, resize, reorder, or delete action was reachable. No output management was reachable.

**Classification:** Navigation working; management absent from the live shell.

### TEMPLATE-01: themes/templates

**Steps.** Apply each of the three visible quotation themes and restore the original theme.

**Result.** All three visually recomposed the full quotation. The workflow remained quotation-specific and source revision behavior reflected recomposition rather than a reusable template catalog.

**Classification:** Working theme switch, misleading template label.

### DOC-01: new/import/export

**Steps and results**

- Open New document: Portrait 1240 × 1754, Square 1080 × 1080, Story 1080 × 1920; destructive Reset to starter also present.
- Separate clean-browser track created blank and confirmed no reachable add-page workflow.
- Open JSON import file chooser: entry point opened; no user file was supplied.
- Click JSON export: programmatic anchor path invoked; harness did not receive an inspectable download event.
- Click PNG export: returned to idle with no console error.
- Click six-page PDF export: showed Exporting and returned to idle after about seven seconds with no console error.

**Classification:** Creation/export entry points exist; artifact correctness was not independently verified. Blank document is structurally blocked.

### MEDIA-01: library and upload

**Steps and results**

- Open asset library: six static assets.
- Search for `dusk`: result filtering worked; tag matching also surfaced a floral item.
- Insert Dusk blocks and undo: worked.
- Upload a screenshot image: inserted; inspector exposed cover/contain, focal sliders, alt text, local asset ID, and Replace; undo restored starter.
- Reopen library: uploaded image was not available as a reusable asset.

**Classification:** Insertion working; media library partial.

### FIELD-01: fields and bindings

**Steps.** Open Fields, inspect the required `quotation_title` field, create/edit dialogs, value and binding controls.

**Result.** One required text field bound to one layer/output. Basic field dialogs and value path worked. A secondary combobox was unlabeled in the accessibility tree. Currency/date/asset depth was absent from the exercised UI.

**Classification:** Partial.

### WEBMCP-01: inspect, validate, proposal

**Steps and results**

- Inspect WebMCP tools: ten visible.
- Run `inspect_design`: returned active-page nodes, one output, and one field.
- Run `validate_design`: returned zero errors and warnings for the starter.
- Propose a quotation-title field update at revision 3.
- Review before/after, accept, and apply: revision advanced to 4.
- Undo the applied change: starter title restored at revision 3.

**Classification:** Working demo path, partial query/control scope.

### REVIEW-01: pending-mode mutation failure

**Steps.** With the proposal pending, click Add text and inspect document revision, node count, selection, and history controls.

**Result.** Add text remained enabled. Revision stayed 3 and node count did not change, but selection changed to a newly generated text ID absent from the document. Undo and redo remained enabled.

**Classification:** Broken and trust-damaging.

### PUBLISH-01: publish

**Steps.** Open Publish, inspect readiness, publish version 1, open API playground.

**Result.** Readiness validation passed. Version 1 published and displayed one modification plus one PDF output. Copy cURL worked and contained an opaque demo authorization token. The token value is intentionally not recorded.

**Classification:** Working happy path, with architectural validation/identity gaps from code review.

### API-01: published render fails reproducibly

**Steps.** Run output 1 as PDF in the API playground. Wait for History. Retry once.

**Result.** Both jobs persisted as Failed with the exact UI message:

```text
Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)
```

No browser console error was emitted. Direct six-page editor PDF export had completed earlier, so the evidence localizes the failure to the published API job/proxy/response path rather than proving a renderer-wide PDF failure.

**Classification:** Broken, P0.

### RESP-01: responsive widths

**390 × 844 result.** Composition fit, but title was nearly absent, controls remained about 28 px, and Publish/API were hidden.

**320 × 720 result.** Title region width reached 0; right action group extended to about x=361.42; shell overflow hid controls with no horizontal recovery.

**Classification:** 390 partial; 320 broken.

### A11Y-01: compact drawer

**Steps.** At compact width, open the Templates/Layers drawer, inspect roles/focus, press Escape, inspect background focusability.

**Result.** No dialog role or `aria-modal`; focus stayed on background opener; background remained focusable; Escape did not close; two close buttons were present.

**Classification:** Broken.

## Failure and empty-state coverage

| State                            | Safe test result                         | Gap                                                                       |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Blank document                   | Verified in isolated clean context       | No add-page or meaningful empty action                                    |
| Empty Review                     | Shows ten live tools and Copy demo brief | Clipboard action has no visible success feedback; failure handling absent |
| Asset search no/result           | Search behavior inspected                | User upload empty/error/retry states absent                               |
| Pending review                   | Tested                                   | Mutation lock incoherent                                                  |
| Publish validation               | Passed starter                           | Invalid aggregate publish requires route-level automated fixtures         |
| API render failure               | Reproduced twice                         | No successful artifact; no cancel/timeout/recovery contract               |
| Fabric dynamic import failure    | Code review only                         | `.then` path lacks catch/retry; can remain Preparing                      |
| Storage corruption/offline/quota | Code review only                         | No injectable recovery states                                             |
| Invalid inspector input          | Tested with width `-1`                   | Display can contradict canonical state                                    |

## Commands and checks run

Parallel tracks and synthesis inspected repository files with `rg`, `sed`, file listings, build outputs, and real browser DOM/interaction. The primary audit process independently ran the repository's complete check target and the Studio E2E target against the final working tree:

```text
bun run check
Result: passed lint, typecheck, package tests, and production builds.

Package test result:
- Studio: 8 passed
- Renderer: 5 passed
- Editor: 20 passed
- Document: 26 passed
- WebMCP: 15 passed
- Render view: no test files, passWithNoTests behavior

bun --filter @webmcp/studio test:e2e
Result: 3 passed in 6.9 seconds.
```

The existing E2E suite covers three canvas gesture/navigation cases. It does not cover the interaction matrix exercised manually in this audit.

Artifact-specific formatting and link checks are recorded after the documents are formatted. A repository-wide formatter was not used to avoid changing unrelated user work.

### Audit artifact checks

```text
bunx prettier --write 'docs/audits/2026-08-27-editor-production-readiness/*.md'
bunx prettier --check 'docs/audits/2026-08-27-editor-production-readiness/*.md'
Result: All matched files use Prettier code style.

Relative Markdown target check
Result: every linked local document and screenshot exists.

file docs/audits/2026-08-27-editor-production-readiness/assets/*.png
Result: all 15 assets are valid PNG image data at their recorded viewport dimensions.
```

## Evidence limitations

- The local server and its synthetic demo data are not a production deployment, so tenancy, restart durability, external asset policy, and deployed performance require a staging environment.
- Programmatic JSON/PNG/PDF download artifacts were not exposed to the browser harness for direct byte/content inspection.
- File-import failure was not induced with a user document.
- Destructive storage corruption, quota exhaustion, offline, renderer timeout, and server restart were not forced against the shared working session.
- Official Figma and Canva documentation describes current product behavior; this audit does not claim internal implementation knowledge.
