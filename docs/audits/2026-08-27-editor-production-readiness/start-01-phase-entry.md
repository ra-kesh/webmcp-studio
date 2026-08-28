# START-01 phase entry: truthful document start and empty-canvas flow

Date: 2026-08-28
Status: first and second single-draft slices implemented; final second-slice review, healthy-host acceptance, and PERSIST-01 real recents remain open

## Current product truth

TEMPLATE-01 is already integrated, so the older audit statement that Templates is only three quotation themes is stale. The remaining WF-03 defect is still real:

- `useDocumentEditor` begins every clean browser session from the Northstar quotation, then restores one draft in an effect. The sample is useful, but it is still presented as if it were the user's canonical work.
- `NewDocumentDialog` offers three fixed pixel presets. It does not accept a document name or custom dimensions and closes before it can report a rejected creation.
- A blank page is technically editable and PAGE-01 makes page growth reachable, but the canvas itself has no useful empty-state actions. A new user must infer the toolbar/sidebars.
- Persistence owns one current draft key plus recovery bytes. There is no honest multi-document recent repository, so a decorative “Recent documents” grid would be fake. Multiple recents belong with the durable PERSIST-01 repository rather than an array of pointers to one mutable draft.

## References reread

- OpenPencil `components/home/HomeWorkspace.vue` and `app/recent-files/store.ts` separate a bounded recent index from document sources, remove stale entries on failed open, preserve loading/error/empty states, and use real button cards. We should adopt the repository/source separation and preview boundary, not its desktop file-path model.
- The local Canva clone dashboard separates “Start creating,” template-led creation, and recent projects. A template creates a distinct project before navigation. Its useful lesson is explicit starting intent; its raw JSON/project API and spinner-only states are not our canonical document contract.
- OpenPencil's editor shell remains the interaction reference once a document is open. Loora reinforces that creation must compile into the same validated document/transaction vocabulary used by human, command, and API surfaces.
- Studio already has the stronger building blocks: validated immutable design templates, explicit create/apply semantics, strict document validation, page/output commands, draft recovery, import, media, and a command registry.

## Bounded delivery order

1. **Truthful blank creation.** Add a validated model for name and custom pixel dimensions. Keep page units explicitly pixel-based because the canonical schema and PDF renderer currently store CSS-pixel page sizes; do not offer mm/in and imply physical-print semantics that the renderer does not preserve. Enforce finite integer dimensions, the 8,192 px edge limit, and 33,554,432 px page-area limit before mutation.
2. **Useful blank canvas.** When the active page has no nodes, show one quiet canvas-owned action surface: Add text, Add image, Choose template, and Add page. These dispatch the existing product/editor actions; no duplicate mutation path. Pending Review and recovery states must disable or hide mutation actions truthfully.
3. **Start mode.** Introduce an explicit start surface with Continue current draft, template-led creation, blank/custom creation, Import JSON, and an opt-in labeled Northstar sample. Do not silently replace a recoverable draft. First-run explanation should teach document → output → ordered pages in one sentence, not a tour overlay.
4. **Real recents repository.** Build this only on a versioned multi-document draft repository with stable IDs, update times, source/template context, corruption quarantine, bounded previews, safe delete/rename/duplicate, and multi-tab conflict handling. Until then, show one truthful Continue card rather than fake recents.
5. **Routing and return.** The editor may remain the root during migration, but Home/New/Import must share one start controller and preserve unsaved work. A later `/documents/:id` route must not be introduced before stable multi-document persistence exists.

## First implementation slice

- Extract pure name/dimension parsing and validation with preset and custom inputs.
- Rebuild `NewDocumentDialog` around a controlled form with visible errors, document name, width, height, preset selection, and an explicit Create document action. The starter remains clearly labeled “Sample proposal” and never looks like a user's recent document.
- Add a tested `EmptyCanvasActions` component and mount it over an actually empty active page. It uses existing `insertTextPreset`, media picker, template tab, and page command callbacks.
- Preserve current work on cancel or invalid input. Creation succeeds before the dialog closes, starts fresh history/source context, focuses the new canvas, and offers immediate page growth.

## Acceptance boundary

Pure/component tests must cover whitespace names, invalid/non-finite/fractional/oversized dimensions, area overflow, preset-to-custom transitions, submit/cancel, review lockout, and all four empty-state callbacks. Existing template, page, media, history, import, render-policy, and compact accessibility suites must stay green. A healthy-host browser pass must verify 320/390/1280/1440 layouts, keyboard focus, no software-keyboard surprise, creation error retention, action reachability, and visual hierarchy before START-01 is closed.

The full home/recent-document phase is not complete when this first slice lands. It becomes complete only after the multi-document persistence boundary is real and independently reviewed.

## First-slice completion evidence

- Blank creation is now a semantic keyboard form with stable field metadata, explicit preset/custom dimensions, render-policy feedback, first-invalid-field focus, Cancel, contained creation/sample errors, and in-flight sample/blank race protection.
- The same validator runs again at `createBlankDocument`; the dialog is not the business-invariant boundary. The created canonical output uses `square` only for equal dimensions and the new honest `custom` kind otherwise. New blank outputs support PNG and PDF, and the `custom` kind is propagated through document and WebMCP schemas.
- An actually empty active page exposes Add text, Add image, Choose template, and Add page through the existing editor paths. The card is excluded from captured panning and double-click viewport zoom, uses 44 px compact controls, and becomes one column at the narrowest width.
- Successful blank/sample creation returns focus to the interactive canvas and requests fit. Rejected creation and restore attempts stay in the dialog with local explanations.
- The independent review initially failed the slice on canonical output semantics, boundary validation, canvas gesture capture, keyboard form behavior, async failure containment, and compact behavior. All findings, including a late sample-restore race, were remediated. The retained re-review verdict is **PASS** in `start-01-independent-code-review.md`.

Static verification after remediation: the full Studio suite passes **458/458 across 84 files**, document passes **173/173**, and WebMCP passes **42/42**. All package typechecks, full lint, scoped Prettier, and `git diff --check` pass. No Vite, browser, build, Wrangler, or Playwright process was started on the restricted host.

The healthy-host 320/390/1280/1440 visual, keyboard, focus, and gesture gate is still required. The explicit start surface, truthful Continue state, real multi-document repository/recents, routing, deletion/rename/duplicate, and conflict handling remain subsequent START-01/PERSIST-01 work and are not claimed here.

## Second implementation slice

- Added a synchronous start/workspace bootstrap over one versioned atomic current-draft envelope. Document and source context cannot drift across separate writes.
- Added the explicit start surface promised by the bounded delivery order: one truthful Continue card, complete design-template browser states, blank/custom creation, bounded canonical JSON import, and an opt-in sample.
- Added one replacement coordinator for every visible blank/template/import/sample path. It settles live edits and flushes before replacement, keeps recovery actions available after failure, and locks competing requests.
- Registered Home in the product-command vocabulary so the logo, File menu, command palette, capability reasons, text settlement, flush, and focus return share one path.
- Added editable asset admission before import installation and lifecycle gating that removes WebMCP tools from the start surface.

Second-slice static evidence: Studio **543/543 across 91 files**, editor **284/284**, document **173/173**, WebMCP **42/42**, Renderer **51/51**, render-view **12/12**, and worker-boundary **11/11**. All package typechecks and full lint pass. The final independent second-slice verdict is retained separately in `start-01-integration-independent-review.md` once issued.
