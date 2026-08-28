# START-01 start-surface phase-entry audit

Date: 2026-08-28
Status: read-only phase-entry recommendation; no source implementation in this audit

## Decision

The next slice should be an explicit start surface over one truthful current
browser draft. It should not pretend that Studio already has a multi-document
home or a recent-document repository.

The smallest production-grade boundary is not just a new React screen. Startup
must first stop treating the Northstar sample as the editor's implicit document
and stop autosaving it when the browser has no draft. The start controller then
owns five explicit intents:

1. Continue the current browser draft.
2. Create from a compatible immutable template.
3. Create a blank/custom-pixel document.
4. Import a canonical Studio document JSON file.
5. Open the clearly labeled Northstar sample proposal.

The screen may show one **Current browser draft** card. It must not call that
card “Recent,” render a grid of aliases to the same storage key, invent a
thumbnail, or imply that multiple documents can be retained. Real recents and
document routes remain part of PERSIST-01.

## Sources reread

### Studio product and architecture contracts

- `workflow-and-feature-audit.md`, WF-03: first run must expose the product
  model, returning work, template/blank/import choices, and opt-in sample
  content without silently replacing stored work.
- `start-01-phase-entry.md`: the completed first slice covers truthful blank
  creation and empty-canvas actions; the next slice is the explicit start mode.
- `production-readiness-backlog.md`, START-01 and PERSIST-01: START-01 depends on
  a draft boundary, while versioned multi-document CRUD, migration, recovery,
  offline behavior, and multi-tab conflict resolution are PERSIST-01.
- `next-editor-priority-2026-08-28.md`: template creation must be explicit and
  use validated canonical documents; the success criterion is a trustworthy
  starting point, not more cards.
- `code-architecture-audit.md`, ARCH-05: the current local draft and server
  publication model is split-brain and has no durable draft repository or
  concurrency protocol.
- `remediation-progress.md`: TEMPLATE-01 and the bounded blank/empty-canvas
  START-01 slice are locally complete. The retained statement that full
  START-01 still needs this start surface and PERSIST-01 remains accurate.
- `start-01-independent-code-review.md`: the first slice now passes source
  review, including canonical output semantics, repeated creation validation,
  keyboard form behavior, failure containment, focus transfer, and gesture
  exclusion.

### Actual reference code

- OpenPencil `src/app/recent-files/store.ts` keeps a bounded index of stable
  source identities separate from the document source itself. It deduplicates
  by identity, stores update time, and removes stale entries only after an open
  attempt fails.
- OpenPencil `src/components/home/HomeWorkspace.vue` uses real buttons, explicit
  loading/error/empty/search states, bounded preview concurrency, and source-
  specific open paths. Its local file paths and storage-provider model do not
  map directly to this browser product.
- The local Canva clone's dashboard separates Start creating, Start from a
  template, and Recent projects. `templates-section.tsx` creates a persisted
  project from the template's actual JSON and dimensions before navigation.
  `projects-section.tsx` exposes loading/error/empty and real rename/duplicate/
  delete operations. Its raw JSON state, optimistic navigation, spinner-only
  mutations, and weak failure preservation are not sufficient Studio contracts.
- Loora `packages/editor/src/lib/canvas-client.ts` restores pending operations
  by a stable design/draft target, persists the queue in IndexedDB, serializes
  writes so an older snapshot cannot land after a newer one, flushes on close
  and page hide, and exposes ready/offline/syncing/conflict states. For this
  slice, the applicable lesson is explicit session identity and ordered flush
  before replacement—not Loora's collaboration or website-builder model.
- `docs/loora-editor-reference.md` remains the governing use rule: study the
  state and transaction boundary, then implement against Studio's document,
  quotation, template, render, and WebMCP contracts without importing Loora.

## Current code truth

### Startup is still sample-first

`use-document-editor.ts` initializes history, active page, quotation source,
quotation style, and active design template from `quotationStarter` before its
restore effect runs. When `webmcp-studio:northstar-document:v2` is absent, the
450 ms persistence effect saves the sample as the current draft. A visual start
overlay alone would therefore be dishonest: the hidden sample would become a
returning user's “draft” even if they never chose it.

The route is already `ssr: false`, so a synchronous client bootstrap can inspect
browser storage before the editor paints. This is preferable to painting the
sample, then changing modes in an effect.

### One mutable document and several independent context keys

The active document uses one local-storage key. Publication history, quotation
template, quotation source, and active design-template identity use separate
keys. They are written independently. Restoration decodes the document, then
loads the three template/source keys globally. No atomic record proves that
those keys belong to the restored document.

That creates a concrete source-context risk: a non-quotation/imported document
can first clear `quotationSource`, then the later global-key restore can attach
the previously stored quotation payload again. Template compatibility,
publication identity, and a later source-backed style can consequently operate
with context from another document.

The next start slice must not project those independent keys into start cards
as if they were a coherent persisted session. Either migrate to one versioned
single-draft envelope now or restore uncertain legacy source context as null
with a visible relink warning. Silent guessing is not acceptable.

### Autosave has no critical-boundary flush

The current autosave waits 450 ms and cancels its timer when the document
changes. If a user edits and immediately creates a blank document, creates from
a template, imports, or opens the sample, the replacement can cancel the old
timer before the latest state is written. Template and blank creation also
start a fresh history, so the replaced state is not recoverable through Undo.

Every start-mode transition that can replace a current draft needs a shared
`flushCurrentDraft()` boundary. Replacement must stop if that flush fails. The
failure surface should offer Download current JSON and Retry; it must not
continue on the assumption that “autosave probably ran.”

### Current import is an editor replacement, not a start/open operation

The toolbar-owned hidden input calls `importDocumentFile()`. That function
reads the whole file with `file.text()`, decodes and aggregate-validates it, then
uses `replaceDocument()` against the existing history. It reports errors only
through editor status and returns no typed success result.

The start surface will not have the editor toolbar, so import ownership must
move to a shared start controller. The start path should validate before any
replacement, install the imported document as a fresh session/history, return a
typed result, and activate the editor only on success. The current editor-menu
import path may keep explicit replace/undo semantics, but both paths should
share one bounded parser and aggregate/policy gate.

The parser currently has no explicit local JSON byte limit. Exposing import as
a primary start action should add a documented finite limit before `file.text()`
and tests for empty, oversized, malformed, schema-invalid, migration-failed,
aggregate-invalid, and valid legacy input.

### Template creation is usable but context-sensitive

`prepareCreateFromTemplate()` correctly materializes an immutable fresh
document and validates quotation-source requirements. `createDocumentFromTemplate()`
creates fresh history and installs source context. The start surface can reuse
that command path, but it must begin with `quotationSource: null` when there is
no real current source.

General templates are valid first-run choices. Quotation-style templates must
remain visibly unavailable with “Quotation required” until a real quotation
source has been imported or the user explicitly opens the sample. The hidden
Northstar source must never make them look compatible.

The current `TemplateCatalogPanel` mixes Create new and Apply to this design.
The start surface should reuse its catalog model, preview, search, category,
loading/error/empty, and compatibility logic, but use a start-specific
presentation or explicit `mode="create"` that never exposes Apply.

### Recovery is real but belongs before start choices

The corrupt-draft path correctly blocks persistence, preserves raw bytes, and
requires Download, Retry, or Reset. That dialog must remain the highest-priority
startup state. The start surface must not appear behind it as an actionable
alternative, and it must not call a placeholder/sample document “current.”

The existing Reset to starter action is an explicit destructive choice, so it
does not violate opt-in sample semantics. Its label and confirmation should
continue to state exactly what is restored.

## Required startup state boundary

Use one pure bootstrap result before rendering either start or editor UI:

| State                 | Meaning                                                        | Initial surface                                   | Persistence behavior                                                                                     |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `empty`               | No current draft or recovery record exists                     | Start surface with no Continue card               | Autosave disabled                                                                                        |
| `current`             | A validated current single-draft envelope was restored         | Start surface with one Current browser draft card | Read-only until Continue; no rewrite on bootstrap                                                        |
| `recovery_required`   | Existing bytes failed JSON/schema/migration/aggregate checks   | Blocking recovery dialog                          | All ordinary writes blocked                                                                              |
| `storage_unavailable` | Storage access itself failed                                   | Start surface with durable warning                | Creation may run ephemerally only after explicit acknowledgment; replacement/persistence claims disabled |
| `workspace`           | User explicitly continued, created, imported, or opened sample | Full editor                                       | Autosave enabled for the active session                                                                  |

Do not call the initial state `loading` if the repository is synchronous. If a
future IndexedDB/server repository makes boot asynchronous, add a real loading
state that cannot dispatch actions until the exact result settles.

The in-memory bootstrap document, if keeping `history` non-null avoids a broad
hook refactor, must be a private neutral empty placeholder with null quotation
and design-template context. It must never render, publish, appear in Continue,
or persist. Prefer a nullable editor session if that refactor is tractable.

## Versioned single-draft envelope for this slice

This is not the PERSIST-01 multi-document repository. It is the minimum atomic
record needed to stop document/context drift while the product still owns one
browser draft.

The envelope should contain:

- envelope schema version;
- exact canonical document;
- document ID and update time derived from that document, not duplicated
  free-form metadata;
- template source context: optional quotation payload, quotation template ID,
  and optional immutable design-template `{id, version}`;
- the editor/document snapshot identity required by publication and later
  conflict work, if it is already stable;
- no Blob URLs, local file paths, raw image bytes, renderer preview URL, or
  publication-history copy.

Repository reads return an explicit discriminated result. Writes validate the
document aggregate and template identity before serializing. The new envelope
write must succeed before legacy keys are removed. A migration failure keeps
the old bytes and routes to recovery; it never replaces them with the sample.

Legacy source context may be migrated only when association can be proven. A
safe default is to retain the validated document, set source context to null,
and explain that linked quotation data must be re-imported. If implementation
chooses a stronger association check, it needs focused fixtures for imported
quotation, manually edited quotation, general template, blank document, stale
source key, stale design-template key, and mismatched document ID.

## End-to-end start flow

### First visit

1. Bootstrap returns `empty`; no document is saved.
2. Focus enters the start page heading or first primary action, not a hidden
   name field. Compact devices do not open the software keyboard.
3. The page teaches the model in one sentence: a document contains outputs,
   and each output contains ordered pages that export to PNG or PDF.
4. Template, blank/custom, import, and sample are separate explicit buttons.
5. A successful action installs a validated session, enables persistence,
   swaps to the editor, fits the active page, and focuses the interactive
   canvas. Failure remains on the start surface with an inline alert and retry.

### Returning visit

1. Bootstrap validates the one current draft and its atomic context.
2. The start page displays one card labeled **Current browser draft**, with the
   real name, updated time, page count, output count, and first-page dimensions.
3. Continue activates that exact session without rewriting it or adding an Undo
   entry.
4. A source/template badge is shown only when validated context belongs to the
   envelope. Do not show a thumbnail until a bounded renderer-derived preview
   is persisted by PERSIST-01.

### Starting something else while a current draft exists

With a single storage slot, this is destructive. The product must say so.

1. The selected action opens one shared **Replace current browser draft?**
   confirmation naming the current document and requested start intent.
2. The latest current document and source context are flushed first. If flush
   fails, replacement is blocked.
3. The confirmation offers Cancel, Download current JSON, and Replace. It must
   state that Studio currently retains one browser draft and that the previous
   document will not remain in a Recent list.
4. The requested template/new/import/sample transition runs only after explicit
   Replace and only closes the surface after validated installation succeeds.

This confirmation is an honest migration product, not the desired final
multi-document behavior. Once PERSIST-01 lands, creation writes a new document
record and this replacement warning disappears.

### Returning from editor to start

Add one reachable Home/Back to documents action generated through the product
command registry. It must:

1. settle or block active text/crop/review operations using existing mutation
   capability rules;
2. flush the current draft;
3. remain in the editor and show an error if flush fails;
4. switch to start mode only after the flush succeeds;
5. restore focus to the Current browser draft card.

Do not use a hard navigation that unmounts the editor before the flush. Do not
add `/documents/:id` until a repository can resolve that ID durably.

## Surface and interaction contract

### Information architecture

- Full-page start surface, not a modal layered over the editor.
- Top row: Studio identity and a quiet explanation of document → output → page.
- Primary section: Continue current browser draft, when one exists.
- Creation section: template-led start first, then blank/custom and import.
- Sample proposal is visually secondary and labeled as sample data.
- Template search/category/list states reuse TEMPLATE-01's real catalog and
  renderer-derived previews.
- No Recent heading unless the repository can return two distinct stable
  document records.

### Compact and focus behavior

- Use one column at 320/390 px and bounded two/four-column composition only when
  width permits; all coarse-pointer actions keep the established 44 px target.
- Start cards are buttons or links with one interactive owner. Do not nest an
  overflow trigger inside a card button.
- Blank/custom opens `NewDocumentDialog` from the explicit card. Cancel returns
  focus to that card. Successful creation transfers focus to the canvas.
- Import uses a named hidden input outside editor-only toolbar composition.
  Canceling the picker returns focus to Import. Re-selecting the same file must
  work because the input value is reset after settlement.
- Template details and creation controls must remain keyboard reachable in
  loading, empty, error, compatible, and incompatible states. Start mode has no
  Apply-to-current action.
- Error and save/flush status use `role="alert"` or a persistent polite live
  region as appropriate. A toast alone is not sufficient.
- Browser Back must not unexpectedly discard the current session. Until there
  is a route per document, internal start/workspace state should not manufacture
  browser history entries that cannot be restored.

## Data-loss and integrity gates

The slice is not acceptable unless all of these are true:

- No storage means no sample autosave.
- A valid stored draft is not rewritten merely by visiting the start surface.
- Corrupt bytes remain unchanged until the recovery user chooses an action.
- Storage getter/setter/quota failures are caught and made visible.
- Every replacing start action flushes or blocks before destroying current
  state.
- A failed template materialization, import, blank validation, or sample reset
  leaves the prior current draft and start mode intact.
- Document plus source/template context settles atomically; a new document
  cannot inherit stale quotation data.
- Start-surface template compatibility uses the candidate session's context,
  never the hidden sample's context.
- Import is byte-bounded and runs schema, migration, aggregate, renderer policy,
  asset/font admission policy appropriate to an editable draft before install.
- Successful start installs the first valid page ID; it does not retain
  `quotation-page-1` from bootstrap.
- An active review, crop, pending async sample restore, or concurrent template
  action cannot race a second replacement.
- Publication history is not silently attached to a new document. Current
  published-version storage is global and must be filtered/cleared by exact
  template/document identity during session replacement.

## Ordered implementation recommendation

### 1. Extract current-draft bootstrap and repository

Recommended new files:

- `apps/studio/src/features/editor/current-draft-repository.ts`
- `apps/studio/src/features/editor/current-draft-repository.test.ts`
- `apps/studio/src/features/editor/studio-start-model.ts`
- `apps/studio/src/features/editor/studio-start-model.test.ts`

Move storage keys and draft/context encode/decode/migration out of
`use-document-editor.ts`. Expose pure bootstrap results, validated envelope
write, critical flush, and explicit clear/replace operations. Reuse
`draft-recovery.ts`; do not create a second corrupt-record format.

### 2. Make editor session activation explicit

Change:

- `apps/studio/src/features/editor/use-document-editor.ts`

Add a start/workspace session state, neutral bootstrap context, persistence
gating, shared install-session helper, exact active-page reconciliation, typed
results for blank/template/import/sample transitions, and a flush method. Keep
ordinary editor mutations on the existing document/history command paths.

Do not let the hook initialize quotation source/template identity from
`quotationStarter` unless the user opens that sample or restores a proven
starter envelope.

### 3. Build a start-only template/create/import surface

Recommended new files:

- `apps/studio/src/features/editor/studio-start-surface.tsx`
- `apps/studio/src/features/editor/studio-start-surface.test.tsx`
- `apps/studio/src/features/editor/replace-current-draft-dialog.tsx`
- `apps/studio/src/features/editor/replace-current-draft-dialog.test.tsx`
- `apps/studio/src/features/editor/document-import.ts`
- `apps/studio/src/features/editor/document-import.test.ts`

Refactor, without duplicating business logic:

- `apps/studio/src/features/editor/template-catalog-panel.tsx`
- `apps/studio/src/features/editor/template-catalog-model.ts`
- `apps/studio/src/features/editor/new-document-dialog.tsx`

The start surface consumes the existing catalog model and a create-only
template view. The shared import parser returns a typed result before the start
controller installs anything. The current New Document dialog remains the
single blank/custom form.

### 4. Integrate one controller into the shell

Change:

- `apps/studio/src/features/studio-shell.tsx`
- `apps/studio/src/routes/index.tsx` only if a route-level loader/bootstrap is
  needed; keep the route client-only
- `packages/editor/src/product-commands.ts` and its tests for a reachable Home /
  Back to documents command

Render either the start surface or the editor shell, not both as interactive
layers. Move the canonical document file input out of toolbar-only ownership so
both File → Import and the start action dispatch the same parser/controller.
Keep quotation import separate unless it is deliberately added to the start
contract.

### 5. Verify behavior before visual closure

Unit/pure tests:

- empty/current/recovery/storage-unavailable bootstrap;
- no implicit sample write;
- atomic envelope round trip and legacy migration;
- stale/mismatched source and design-template keys;
- getter, setter, quota, malformed JSON, schema, migration, and aggregate
  failures;
- ordered flush and old-timer cancellation;
- import byte and validation matrix;
- start model metadata derived from the real document;
- no fake recents or preview URL.

Mounted component/hook tests:

- first visit renders all four creation choices plus secondary sample and no
  Continue card;
- returning visit renders exactly one current draft and Continue opens its
  exact document/context;
- blank dialog cancel/failure/success focus paths;
- create-only templates, compatibility, loading/error/empty/retry, and failed
  materialization preservation;
- import picker cancel, same-file reselection, malformed/oversized failure, and
  valid fresh-session install;
- replacement confirmation, download, failed flush block, successful replace,
  and async action race lock;
- recovery preempts all normal start actions;
- Home command settles/blocks active modes, flushes, and restores focus;
- compact one-column structure, no auto-focused text input, and 44 px controls.

Healthy-host browser gates, still prohibited on the current host:

- first-run and returning-run journeys at 320, 390, 1280, and 1440 px;
- refresh proves no sample or start-surface flash and no draft rewrite;
- keyboard-only Continue/template/blank/import/sample journeys;
- real file chooser cancel and same-file retry;
- focus after Cancel, validation error, Continue, successful start, and Home;
- flush failure and recovery dialog visual/readability states;
- browser Back/Forward does not discard or invent a document;
- screenshots of empty, current, template loading/error/ready, replace warning,
  and storage-unavailable states.

## Explicitly deferred to PERSIST-01

Do not claim or implement these as aliases over the single draft:

- Recent documents grid or list;
- stable multi-document list/get/create/save APIs;
- `/documents/:documentId` editor routes;
- persisted renderer-derived document previews and preview cache invalidation;
- rename, duplicate, delete, archive, sort, search, or pagination across
  documents;
- multi-tab optimistic concurrency, BroadcastChannel/storage-event conflict UI,
  or server ETag reconciliation;
- offline operation queue and reconnect/rebase;
- published snapshot linkage to a durable draft version;
- cross-device/server workspace sync.

PERSIST-01 should introduce stable record IDs, atomic validated records,
expected-version writes, migration/quarantine, bounded preview identity,
transaction-aware autosave with flush, and a real list index. At that point the
single Current browser draft card becomes a genuine Recent documents section,
template/new/import create distinct records without replacement warnings, and
`/documents/:id` becomes an honest route.

## Closure statement

Completing this slice will close the misleading first-run behavior and make all
current start intents explicit and failure-safe. It will not close START-01's
recent-document requirement. START-01 can be marked “start surface complete;
recents blocked on PERSIST-01” only after independent source review and the
healthy-host browser gates above. Full START-01 closes only with the real
multi-document repository.
