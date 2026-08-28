# START-01 first-slice independent code review

Date: 2026-08-28
Reviewer: independent read-only subagent
Initial verdict: **FAIL**

The slice is headed in the right direction, but it is not ready to close. The pure validator is sound for the paths it covers, rejected creates keep the dialog open, sample content is labeled honestly, and empty-page actions reuse existing editor callbacks. The phase-entry document also tells the truth that home, recents, and multi-document persistence remain unfinished.

The failures below are product-contract and interaction problems, not formatting preferences.

## Release-blocking findings

### P1: every new output claims to be square and supports PNG only

`apps/studio/src/features/editor/use-document-editor.ts:3111`

`createBlankDocument` writes `kind: "square"` and `exportFormats: ["png"]` for Portrait document, Social story, Square social, and every custom size. Output kind is canonical and API-visible through publishing and WebMCP. A 1240 x 1754 document therefore identifies itself as square, while the format named "Portrait document" cannot export PDF.

This is release-blocking for START-01. Mapping portrait and story to `whatsapp_portrait` would still mislabel arbitrary documents. Add an honest general document/image output kind, migrate all schema and API consumers, and derive supported export formats from explicit creation intent. Until that contract exists, the preset cards are changing dimensions but not creating the output they name.

### P1: renderer limits are enforced in the dialog, not at the creation boundary

`apps/studio/src/features/editor/new-document-model.ts:54`
`apps/studio/src/features/editor/use-document-editor.ts:3098`

The dialog checks whole pixels, the 8,192 px edge limit, and page area. `createBlankDocument` only runs `documentSchema.parse`, whose page schema accepts positive numbers without the renderer limits. Another caller can create a fractional or oversized canonical document that saves successfully but later fails rendering.

Move or repeat the policy check in a canonical document factory or in `createBlankDocument` before history installation. UI validation should improve feedback, not own the business invariant.

### P1: the empty-page card participates in canvas pan and double-click zoom

`apps/studio/src/features/editor/empty-canvas-actions.tsx:18`
`apps/studio/src/features/studio-shell.tsx:1643`
`apps/studio/src/features/studio-shell.tsx:2757`

The workspace captures pointer-down for Hand, Space, and middle-button panning. It exempts descendants marked with `data-editor-overlay-control="true"`, but `EmptyCanvasActions` has no marker. The same workspace double-click handler zooms unless the target is Fabric's upper canvas. As a result, the empty-state controls can be hijacked by panning and a double click anywhere on the card zooms the canvas.

Mark the card as an editor overlay and make both pointer capture and double-click zoom use the same interactive-overlay exclusion. Add an integration test that mounts the card inside the viewport handler, not only a component callback test.

### P1: keyboard submission and validation focus are missing

`apps/studio/src/features/editor/new-document-dialog.tsx:138`
`apps/studio/src/features/editor/new-document-dialog.tsx:231`

The phase contract calls this a controlled form, but the fields and buttons are plain sections with a click handler. Enter in Document name, Width, or Height does not create the document. On validation failure, errors render with `role="alert"`, but focus stays on Create document instead of moving to the first invalid field.

Use a semantic form with `onSubmit`, explicit button types, and refs that focus the first invalid control after validation. Add tests for Enter, Cancel, and error focus.

### P1: sample restore has an unhandled rejection path

`apps/studio/src/features/editor/new-document-dialog.tsx:84`
`apps/studio/src/features/editor/use-document-editor.ts:3161`

The dialog uses `try/finally` but no `catch`. `restoreDemoDocument` touches `localStorage` before its fetch `try` block. A storage exception rejects the handler, leaves the dialog with no local explanation, and can surface as an unhandled promise rejection. The current test only covers a resolved `false` callback.

Contain storage failures before mutating in-memory publication state, return a typed result, and show an inline recovery message in the dialog. Test a rejected callback and a storage exception. Do not close unless the local document transition completed.

## Required follow-up findings

### P2: editing a name incorrectly clears format selection, and choosing a format can erase the name

`apps/studio/src/features/editor/new-document-dialog.tsx:69`
`apps/studio/src/features/editor/new-document-dialog.tsx:118`

`updateDraft` clears `selectedPreset` for every patch, including a name-only edit. A name does not change format identity, so the selected size loses `aria-pressed` while its dimensions remain exact. In the other direction, clicking a preset replaces the full draft and can erase a name the user already entered.

Preserve selected format for name edits. Clear or recompute it only when width or height changes. Preset clicks should normally preserve the current name, or only replace an untouched generated default. This is not the largest bug, but it makes a simple dialog feel unreliable.

### P2: the 320 px empty state is likely to overflow and uses 32 px touch targets

`apps/studio/src/features/editor/empty-canvas-actions.tsx:21`
`apps/studio/src/features/editor/empty-canvas-actions.tsx:30`

At 320 px, the card has about 256 px of inner width. Its 2-column buttons receive about 124 px each, while `Choose template` uses the shared `whitespace-nowrap` button style and needs more width once icon, gap, and padding are included. All four default buttons are 32 px tall on touch layouts.

Use one column at the narrowest size or allow a deliberate wrap, and use the established 44 px compact target metric. Keep the healthy-host 320/390 browser gate open until this is measured.

### P2: dialog inputs omit stable form metadata

`apps/studio/src/features/editor/new-document-dialog.tsx:147`
`apps/studio/src/features/editor/new-document-dialog.tsx:168`
`apps/studio/src/features/editor/new-document-dialog.tsx:198`

The inputs have associated labels and `aria-describedby`, which is good. They do not have `name` or `autoComplete` attributes. Add stable names and `autoComplete="off"` for these non-auth creation fields.

### P2: the promised test boundary is not met

`apps/studio/src/features/editor/new-document-model.test.ts:21`
`apps/studio/src/features/editor/new-document-dialog.test.tsx:58`
`apps/studio/src/features/editor/empty-canvas-actions.test.tsx:25`

The 13 focused tests pass, but the phase-entry acceptance boundary calls for non-finite dimensions, preset-to-custom transitions, submit and cancel, review lockout, all four callbacks, and compact behavior. Missing coverage includes Infinity/NaN, maximum name length, name-only preset preservation, preset change after a custom name, Enter submit, Cancel, first-error focus, async restore rejection, output kind/export semantics, canonical boundary validation, viewport gesture exclusion, desktop left-panel expansion, compact sheet opening/focus return, and 320 px fit.

## What passed

- `validateNewDocumentDraft` trims names and rejects blank, fractional, zero, over-edge, and over-area values before the current dialog callback.
- A rejected `onCreateBlank` or resolved-false sample restore keeps the controlled dialog open.
- Creation installs a fresh document history, clears the design-template identity, clears quotation source data, selects the first page, and schedules draft persistence.
- Cancel and invalid input do not mutate the document through the reviewed callback paths.
- Empty-page Add text, Add image, and Add page use existing editor paths. Choose template sets the shared Templates tab, expands the left panel on desktop, and opens the document Sheet with a focus-return target on compact layouts.
- Pending review and draft recovery disable all four empty-page mutation buttons. The underlying editor mutation guard remains a second line of defense.
- The implementation does not fake recent documents. The phase-entry document explicitly keeps multi-document recents behind PERSIST-01.

## Static verification

Run from `apps/studio` without starting a server, browser, Playwright, Wrangler, or a build:

```text
bunx vitest run --config vitest.config.ts \
  src/features/editor/new-document-model.test.ts \
  src/features/editor/new-document-dialog.test.tsx \
  src/features/editor/empty-canvas-actions.test.tsx --maxWorkers=1
Result: 3 files passed, 13 tests passed

bun run typecheck
Result: passed

bunx eslint <reviewed START-01 files plus use-document-editor.ts and studio-shell.tsx>
Result: passed
```

The green static checks do not change the FAIL verdict because the release-blocking paths are untested or semantically wrong. Browser and pixel review remain pending on a healthy host.

## Reference comparison

- The local Canva clone creates a persisted project with its actual width, height, JSON, and identity before navigation. START-01 now has clearer local validation, but its output-kind and export contract is less truthful than its visible format choice.
- OpenPencil keeps recent metadata separate from source loading and exposes loading, error, empty, stale-entry removal, and real button-card behavior. Deferring recents until a real repository exists is the correct call.
- Loora's relevant lesson is one validated transaction vocabulary at every entry point. Keeping render limits only in the dialog falls short of that rule.

START-01 can move back to review after the five P1 findings are fixed and their missing tests are added. The full START-01 phase still remains open for start mode, real recents, routing, and durable multi-document persistence.

## Remediation re-review, 2026-08-28

Verdict: **PASS**

The completed remediation resolves every P1 and P2 finding from the initial review. I found no remaining actionable source finding in the bounded START-01 first slice.

### Contract and validation

- `packages/document/src/schema.ts` now accepts a canonical `custom` output kind in editable documents and published manifests.
- `packages/webmcp/src/change-sets.ts` and `packages/webmcp/src/registration.ts` carry `custom` through the typed proposal input, parser, and generated tool schema. Document and WebMCP contract tests cover it.
- `docs/architecture.md` now lists proposal, WhatsApp portrait, square, and general custom outputs. No stale three-kind contract language remains under `docs`.
- `validatedOptions` assigns `square` only when width equals height. Every other preset or custom dimension becomes `custom`.
- Blank outputs support both PNG and PDF.
- `createBlankDocument` accepts only the raw name and dimensions, runs `validateNewDocumentOptions` again, and derives kind and formats at that boundary. A caller cannot smuggle UI-derived kind or format values past the validator.

### Dialog behavior and failure paths

- The creation fields now live in a semantic form. Enter uses the submit path, Cancel is explicitly non-submit, and Create is explicitly submit.
- Invalid submission reports inline errors and focuses the first invalid input on the next animation frame.
- Name edits preserve the selected format. Dimension edits recompute format identity. A later preset choice preserves a user-edited name while replacing generated default names.
- False and thrown creation results stay in the dialog with inline `role="alert"` feedback.
- False and rejected sample restores stay in the dialog with inline feedback. Promise rejection no longer escapes the event handler.
- While sample restoration is pending, presets, blank fields, and Create are disabled, and the submit handler also short-circuits. Cancel remains available. The pending-promise test proves that competing blank creation cannot dispatch.
- All three fields have stable names and `autocomplete="off"` metadata.
- A successful blank or sample transition overrides Radix focus restoration, refits the page, and focuses Fabric's interactive canvas.

### Empty-page actions and shell integration

- The empty-page card carries `data-editor-overlay-control="true"`, so the workspace's captured pan handler ignores its descendants.
- The card stops double-click propagation, so it cannot trigger viewport zoom.
- All four mutation controls remain disabled during pending review or recovery. The underlying editor mutation guard remains in place.
- Add text, Add image, Choose template, and Add page still use the existing editor and shell paths.
- Choose template selects the shared Templates tab, expands the desktop left panel when needed, and opens the compact document Sheet with a focus-return target.
- The action grid uses one column below 420 px and two columns when enough width exists. Compact controls use the established 44 px minimum height.

### Remediation verification

Run without starting Vite, a browser, Playwright, Wrangler, or a build:

```text
Studio focused START-01 tests: 3 files passed, 23 tests passed
Document validation tests: 1 file passed, 10 tests passed
WebMCP registration tests: 1 file passed, 34 tests passed
Studio typecheck: passed
Document typecheck: passed
WebMCP typecheck: passed
Targeted Studio ESLint: passed
Targeted Prettier check: passed
Targeted git diff check: passed
```

The healthy-host 320/390/1280/1440 browser and pixel gate remains unexecuted, as required by the host restriction. That gate is still release evidence for visual fit, real focus timing, and compact Sheet behavior. It does not change this source-code remediation verdict.

This PASS applies only to the bounded first slice. The full START-01 phase remains open for explicit start mode, real recent documents, routing, and the durable multi-document repository described in the phase-entry contract.
