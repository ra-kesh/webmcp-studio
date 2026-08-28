# PERSIST-01A hook cutover plan

Date: 2026-08-28
Status: implementation-ready audit; no production hook code changed by this pass

## Decision

Cut `useDocumentEditor` over to `DocumentDraftRepository` and one `DocumentDraftSaveController` per open document in bounded steps. Do not translate the old `localStorage` effect line-for-line. The target is a route-owned document session with an exact `{ document, sourceContext }` capture boundary, compare-and-swap durability, and a separate publication state.

The cutover is not complete until every destructive transition awaits a critical flush. A synchronous `boolean` facade over the asynchronous repository would recreate the data-loss race this phase is intended to remove.

## Evidence reread

- `persist-01-phase-entry.md`, especially Identity contract, Save state, Autosave and critical flush, Multi-tab contract, and Migration from START-01.
- `use-document-editor.ts` bootstrap, start/session lifecycle, replacement, autosave, recovery, publication, import, template replacement, Undo/Redo, and returned API.
- `document-draft-repository.ts` create/migration/save/get/list/touch behavior.
- `document-draft-save-controller.ts` capture, ordered save, retry, flush, close-generation, and local save state.
- `use-draft-replacement.ts` and its mounted tests.
- `studio-start-model.ts`, `studio-start-surface.tsx`, `new-document-dialog.tsx`, and start-session mounted tests.
- `studio-shell.tsx` Home, replacement, export, download, publish, and WebMCP wiring.
- Loora `canvas-client.ts` pending persistence and flush logic reviewed in the phase entry: a single ordered chain, coalesced pending snapshots, and explicit flush.

All line references below describe the tree as inspected on 2026-08-28. They are intended as cutover anchors; implementation patches will naturally move later lines.

## Current ownership and exact hazards

### Bootstrap and start ownership

`useDocumentEditor` synchronously calls the single-draft `bootstrapCurrentDraft()` during React initialization (`use-document-editor.ts:322-325`). It then creates a real `DocumentHistory` around either that envelope or a private neutral document (`:329-333`) and installs private page/source defaults (`:334-350`). The start surface itself is correctly explicit because `sessionMode` starts as `"start"` (`:326-328`).

The neutral document is not user content. Its fixed IDs and 1970 timestamps are at `:213-247`. The current autosave avoids writing it only because it gates on `sessionMode === "workspace"` (`:761-798`), and the regression is covered by `use-document-editor.start.mounted.test.tsx:71-80`.

Target rule: the private neutral history may remain temporarily as a render-safe placeholder, but it must never acquire a repository record or controller. No autosave path may gate only on `sessionMode`; it must require a live controller whose `documentId` exactly matches `historyRef.current.document.id`. `/` remains the start route and must not silently continue the last document.

`startModel` currently projects one recoverable localStorage envelope (`use-document-editor.ts:426-428`, `studio-start-model.ts:29-43,82-117`). Its `updatedAt` comes from the document (`studio-start-model.ts:53-79`), not repository activity. During PERSIST-01A it should become an adapter over bounded repository metadata; in PERSIST-01B it becomes a true recent-documents list. Do not keep mutating it through `rememberStartEnvelope` (`use-document-editor.ts:503-522`) once repository metadata is authoritative.

Repository bootstrap belongs in an effect/provider, not in render-time creation of document history. The adapter must run `repository.open()`, then legacy recovery precedence and `migrateCurrentDraft`, then a bounded metadata list. `DocumentDraftRepository.open` reports blocked/unavailable explicitly (`document-draft-repository.ts:687-715`); it must not be caught and projected as an empty start page. The repository instance and its tab `sessionId` live for the mounted shell lifetime, not one instance per opened document.

### Session installation and persistence

`installEditorSession` currently owns history replacement, source-context restoration, active page, selection/error cleanup, save-label mutation, and the `start -> workspace` transition (`use-document-editor.ts:524-550`). It accepts an envelope rather than a durable record, so it has no `recordVersion`, `contentSnapshotId`, or `draftSnapshotId`.

`persistAndInstallSession` synchronously writes the global localStorage key before installation (`:552-581`). That is used by:

- opening a document file with `sourceContext: null` (`:2533-2551`);
- creating from a design template with the produced source context (`:3180-3211`);
- creating a blank document with an explicit source context (`:3270-3329`);
- restoring the sample with its quotation payload and design-template identity (`:3332-3375`).

Target split:

1. `createDraftAndOpen(snapshot, origin): Promise<boolean>` calls `repository.create` and receives `DocumentDraftRecord`.
2. `openDraftRecord(record): void` creates history and a controller from the same exact record.
3. `openDraftById(documentId, generation): Promise<boolean>` calls `repository.get`, validates the route identity, optionally `touchOpened`, then installs only if its generation is still current.
4. `installSessionOnly(snapshot, message): void` is an explicit fallback with no repository/controller and `LocalSaveState.status === "session_only"`.

The repository already accepts an exact snapshot and returns a record (`document-draft-repository.ts:818-830,925-941`). Migration produces the same record shape (`:953-996,1013-1030`). The controller initializes from that record and owns the durable identities (`document-draft-save-controller.ts:65-99`). Do not construct a controller from a caller-invented version or from `document.revision`.

### Autosave and exact source context

The current autosave is a React effect over `history.document`, compares object identity through `persistedDocumentRef`, waits 450 ms, then reads `historyRef.current.document` and `templateSourceContextRef.current` (`use-document-editor.ts:443-445,761-798`). This has no CAS token and lets unrelated React state and timing define the write boundary.

The source context is maintained separately from history (`:457-473`). It is correctly restored from a per-history-snapshot map during Undo/Redo (`:3377-3397`) and installed synchronously through `installTemplateSourceContext` (`:492-501`). Direct history-changing sites are:

- ordinary command commit (`:1050-1078`);
- accepted review change set (`:1563-1574`);
- in-place document import (`:2474-2530`);
- quotation source import (`:2554-2624`);
- applying a design template (`:3214-3267`);
- Undo (`:3399-3418`);
- Redo (`:3445-3464`).

`clearRedo` and `breakHistoryCoalescing` (`:3420-3443`) alter history metadata but not canonical document/source content and must not create repository writes.

Target rule: capture at the settled canonical transition, after both `historyRef.current` and `templateSourceContextRef.current` have been updated. Introduce one helper with this shape:

```ts
captureSettledDraft(nextDocument, nextSourceContext) {
  const controller = activeSaveControllerRef.current
  if (!controller) return // start or explicit session-only mode
  if (controller.documentId !== nextDocument.id) return // generation/route guard
  controller.capture({ document: nextDocument, sourceContext: nextSourceContext })
}
```

Call it from the seven content-changing boundaries listed above. Do not use `onHistoryCommit`: its current contract intentionally excludes Undo, Redo, and history maintenance (`use-document-editor.history-commit.mounted.test.tsx:44-95`). Do not use a broad effect over `history.document`: an effect makes source-context ordering implicit and risks capturing the private bootstrap or an opening/replaced session.

For Undo/Redo, make `restoreTemplateSourceForSnapshot` return the exact restored `TemplateSourceContext`; then capture `{ next.document, returnedContext }` in the same callback. A document revision may go backward while `recordVersion` advances; the controller/repository already keep those identities separate.

For imports and template applications, preserve the explicit contexts already constructed at `:2497-2507`, `:2588-2597`, and `:3235-3242`. Never derive a saved source context later from visible template selection. For a document-only JSON import, `sourceContext: null` is an explicit product decision (`:2544-2548`), not an accidental omission.

### Save status versus publish status

The current `SaveStatus` union is `saved | saving | restored | recovery_required | error` (`use-document-editor.ts:193-195`) and the shell labels it as one local-draft status (`studio-shell.tsx:1737-1746`). Publication already has a distinct `PublishSyncStatus` (`use-document-editor.ts:195,397-399`) and a distinct shell label (`studio-shell.tsx:1747-1756`). Preserve and strengthen that separation.

Replace `saveStatus` with the controller's `LocalSaveState`, projected verbatim enough for UI decisions:

- `opening`: repository/open route is unresolved;
- `saved`: `Saved on this device`, with repository `recordVersion` and `savedAt`;
- `saving`: unsaved in-memory capture exists or a write is ordered;
- `failed`: retained candidate; explicit retry/download affordances;
- `conflict`: autosave paused; reload saved or save copy;
- `session_only`: work exists only in memory.

Do not map `publishSyncStatus === "synced"` to local `saved`, or local IndexedDB failure to publish failure. `publishTemplate` currently performs network reconciliation at `use-document-editor.ts:1585-1689`; that remains cloud/publication state. A successful local flush followed by a failed publish must display `Saved on this device` and `Publish failed` simultaneously.

## Target state machine

Use one repository lifecycle and one active-session lifecycle. Do not encode both into a single string.

```text
Repository lifecycle
  opening
    -> ready
    -> recovery_required
    -> session_only (blocked/unavailable, after explicit acknowledgement)

Active session
  start (no record, no controller)
    -> opening(documentId, generation)
    -> workspace(record, controller, generation)
    -> replacing(current generation locked)
    -> start (only after awaited flush and controller close)

Workspace local durability (owned by controller)
  saved -> saving -> saved
                   -> failed --explicit retry--> saving
                   -> conflict (terminal for that controller)
  session_only (no controller; validate/capture in memory only)

Publication (independent)
  idle -> syncing -> synced | error
```

Session invariants:

- `activeRecord.summary.documentId === history.document.id === controller.documentId`.
- `activeRecord.envelope.sourceContext` is installed before the workspace becomes interactive.
- One generation token is captured by every async open/create/flush callback. A late result may have committed storage, but it cannot install history, change active IDs, publish save state, or close a newer controller.
- A controller is closed only after a successful/terminal flush decision and immediately before its session is replaced. `close()` does not cancel an IndexedDB transaction already issued; it suppresses late adoption (`document-draft-save-controller.ts:173-184,216-247`).
- Start/session-only mode has no controller. It cannot claim durability.
- Conflict is terminal for the controller. New captures stay retained but are not autosaved until conflict resolution opens a new/reloaded controller (`document-draft-save-controller.ts:128-155,268-288`).
- Repository `BroadcastChannel` events are invalidation hints only (`document-draft-repository.ts:630-685`). A foreign saved/deleted event may refresh inactive metadata. It must not overwrite an active dirty history. The next active save still goes through CAS and creates the durable conflict candidate.

## Async callback ramifications

The repository and controller are asynchronous. The following APIs must change together; leaving one synchronous creates a fire-and-forget transition:

1. `flushActiveDraft: () => Promise<boolean>`. It captures the latest history/source tuple, awaits `controller.flush()`, then returns true only for `saved` (including an unchanged durable head) or explicit `session_only`. `failed` and `conflict` block destructive transitions even though the controller's flush promise has settled.
2. `returnToStart: () => Promise<boolean>`. It keeps the crop/review guards (`use-document-editor.ts:632-644`), awaits flush, captures the current envelope for session-only start recovery if applicable, closes the old controller, increments generation, and only then navigates/enters start.
3. `useDraftReplacement.flushCurrentDraft` changes from `() => boolean` (`use-draft-replacement.ts:12-25`) to `() => Promise<boolean>` and `confirm` awaits it at `:71-92`. Preserve the synchronous `runningRef` lock before the first await (`:71-77`). Its tests at `use-draft-replacement.test.tsx:50-178` must use deferred flushes and verify exact settle -> flush -> replace -> open order.
4. `persistAndInstallSession` becomes `createDraftAndOpen(...): Promise<boolean>`. `createDocumentFromTemplate`, `createBlankDocument`, and every caller must await it. `NewDocumentDialog` already accepts promises and has action locks (`new-document-dialog.tsx:33-56,104-168`).
5. `continueCurrentDraft` becomes `openDraftById` and is asynchronous. `StudioStartSurfaceProps.onContinue` is currently `() => void` (`studio-start-surface.tsx:60-74,200-245`); add pending/error handling rather than launching an untracked promise.
6. Product command execution currently returns synchronous `boolean` (`studio-shell.tsx:1882-1907`). Home and exports cannot honestly retain that signature after critical flush. Either make product-command execution awaitable end-to-end or route those commands through a synchronous lock that starts one owned async operation and reports pending state. Do not return `true` before Home/export has passed its flush gate.
7. `PublishDialog` currently receives `editor.publishTemplate` directly (`studio-shell.tsx:3532-3540`). The hook's `publishTemplate` can and should await its own local flush before deriving `sourceSnapshotId` at `use-document-editor.ts:1603-1616`; this also protects WebMCP because it calls the same service (`use-studio-webmcp.ts:96-110`). Shell text editing must be committed before the dialog action, so pass a shell wrapper that calls `commitActiveTextEditing()` before the hook method.
8. PNG, PDF, and JSON exports are currently synchronous/async shell functions with no durability gate (`studio-shell.tsx:1568-1656`) and are dispatched directly at `:1917-1929`. Convert all three to owned async actions: settle text/crop/review as appropriate, await `editor.flushActiveDraft()`, snapshot the exact document to a local variable, then render/serialize that snapshot. Do not reread `editor.document` after an await.
9. `downloadCurrentDocument` is synchronous and serializes only the document (`use-document-editor.ts:825-850`). Make it await the critical flush and snapshot before generating the Blob. If `.studio.json` is meant as a fully reopenable Studio draft, a follow-up contract must export the versioned envelope so source context is not silently lost; until that format changes, persistence still must retain source context.

## Critical flush matrix

| Boundary                             | Current anchor                                                                                       | Required order                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home product command                 | `studio-shell.tsx:1903-1907`, `use-document-editor.ts:632-649`                                       | settle active text/crop/review -> capture exact tuple -> await flush -> close controller/increment generation -> navigate `/` or show start                                                                              |
| Replace current draft                | `studio-shell.tsx:959-975`, `use-draft-replacement.ts:71-92`                                         | lock request -> settle live edit -> await old controller flush -> run async create/open -> close old controller only when new record is ready -> install new generation                                                  |
| Open another repository document     | future `/documents/$documentId`; current open-file replacement at `use-document-editor.ts:2533-2551` | block route -> flush active -> increment generation -> get target -> install only matching generation -> touch opened                                                                                                    |
| Create blank                         | `use-document-editor.ts:3270-3329`                                                                   | flush replaced draft through coordinator -> repository.create with `{kind:"blank"}` -> controller from returned record -> install                                                                                        |
| Create from template                 | `:3180-3211`                                                                                         | flush replaced draft -> repository.create with template origin/version -> preserve mutation source context -> install                                                                                                    |
| Open imported JSON as a new document | `:2533-2551`                                                                                         | parse/admit first -> flush replaced draft -> repository.create with `{kind:"import"}` -> install returned exact envelope                                                                                                 |
| Restore sample                       | `:3332-3375`                                                                                         | flush replaced draft -> create/open explicit sample record -> install -> server reset remains best-effort publication/demo cleanup                                                                                       |
| Publish from UI or WebMCP            | `:1585-1689`, `use-studio-webmcp.ts:96-110`                                                          | settle shell text -> capture -> await local flush -> freeze exact document/content ID -> publish -> link publication only if recordVersion/content ID still match                                                        |
| Export PNG                           | `studio-shell.tsx:1568-1588`                                                                         | settle -> await flush -> freeze page/document -> export pixels                                                                                                                                                           |
| Export PDF                           | `:1590-1635`                                                                                         | settle -> await flush -> freeze document/output -> resolve local assets -> request PDF                                                                                                                                   |
| Export/download JSON                 | `:1637-1656`; `use-document-editor.ts:825-850`; replacement dialog `studio-shell.tsx:2237-2240`      | settle -> await flush -> freeze exact snapshot -> serialize/download; failed/conflict keeps Download-my-version path explicit                                                                                            |
| Recovery reset                       | `use-document-editor.ts:903-932`                                                                     | if a workspace exists, flush/capture it first; then perform explicit reset/migration action; never overwrite a recoverable candidate implicitly                                                                          |
| Conflict reload/save-copy            | future conflict UI                                                                                   | Download remains available -> resolve candidate -> close terminal controller -> get saved record or create copy -> install new controller/generation                                                                     |
| Route navigation/unmount             | route currently only `/` at `routes/index.tsx:1-14`                                                  | router blocker awaits/blocks on saving, failed, conflict; normal navigation performs explicit flush. `pagehide`/`visibilitychange` may start best-effort drain only and must never be described as guaranteed durability |

Recovery-file download (`use-document-editor.ts:810-823`) is intentionally not a normal active-draft flush: it exports quarantined raw bytes without modifying them. A published-version render through `renderTemplate(version, ...)` renders an already selected immutable version; it does not need an active-draft flush unless the command first publishes the active draft.

## Safe incremental patch order

### Patch 1: async transition plumbing, behavior unchanged

- Change `useDraftReplacement` critical flush to `Promise<boolean>` and update its tests.
- Make Home/replacement/export command adapters own an async in-flight lock.
- Add explicit pending UI where start Continue and product commands become asynchronous.
- Keep old localStorage persistence behind the existing `flushActiveDraft` for this patch so behavior is reviewable independently.

Exit gate: replacement tests prove no action runs before the deferred flush resolves, double confirmation remains locked, and a rejected flush retains the confirmation dialog.

### Patch 2: repository lifecycle adapter

- Create one repository instance per mounted Studio shell/session provider, not per render.
- Open it once; run current-draft migration through `migrateCurrentDraft` (`document-draft-repository.ts:953-1085`).
- Represent `opening`, recovery/blocked, ready list, and explicit session-only acknowledgement separately.
- Do not install a document and do not create a controller during repository open or start-page list.
- Keep the private neutral history inaccessible to autosave.

Exit gate: first run creates no document; `/` stays start; migrated source context and exact draft identity survive; blocked IndexedDB is visible and never becomes an empty durable list.

### Patch 3: record-based open/install and generation guard

- Replace envelope-only `installEditorSession` with `openDraftRecord(record, generation)`.
- Store `activeRecordRef`, `activeSaveControllerRef`, unsubscribe function, and monotonically increasing `sessionGenerationRef`.
- Subscribe controller state to local durability UI. Listener callbacks capture generation/controller identity and ignore mismatches.
- Subscribe once to repository invalidations. Refresh inactive start metadata; for the active document, mark external change/delete awareness but let CAS remain authoritative. Never install event payload as document data.
- `continue`/route open uses repository `get`; new/template/import/sample uses repository `create` with correct origin.
- Close/unsubscribe the old controller only at the replacement commit point. If new create/open fails, leave the old session/controller intact.
- Hook teardown unsubscribes and closes the active controller/repository. It may start a best-effort drain earlier through visibility/pagehide handling, but teardown itself must not claim that an async browser-shutdown write completed.

Exit gate: a deferred old open/save completion cannot install or relabel a newer session; document, source context, record, and controller IDs always match.

### Patch 4: autosave cutover at canonical boundaries

- Add `captureSettledDraft` and call it from ordinary commits, applied reviews, in-place document import, quotation import, applied design template, Undo, and Redo.
- Update source context before capture where it changes.
- Delete the 450 ms localStorage effect (`use-document-editor.ts:761-798`) and `persistedDocumentRef` (`:443-445`). The controller supplies debounce and ordering.
- Remove manual `setSaveStatus("saving")` calls at `:1067,1573,2519,2608,3255`; controller state is authoritative.
- Retain `onHistoryCommit` only as the external history observation contract.

Exit gate: source-context-only changes are durable; Undo to a lower document revision advances repository version; neutral bootstrap never saves; rapid commits coalesce; stale CAS produces terminal conflict.

### Patch 5: critical flush cutover

- Replace `flushActiveDraft` with the awaited controller flush described above.
- Wire every row in the critical flush matrix.
- Freeze canonical document/source values immediately after flush for publish/export.
- Add route blocker and native unload warning only while in-memory work remains. A pagehide drain is best effort and is not a substitute for normal autosave.

Exit gate: Home, replacement, publish, exports, downloads, conflict recovery, and route navigation cannot cross their boundary on failed/conflicted local durability.

### Patch 6: remove single-draft ownership

- Stop using `rememberStartEnvelope` and the mutable one-draft start projection.
- Remove `writeCurrentDraft`/`flushCurrentDraft` imports and ordinary writes from the hook.
- Keep legacy decode/bootstrap only inside the migration adapter until migration tests and recovery UI are fully moved.
- Update shell labels and disabling logic from string comparisons (`studio-shell.tsx:1737-1756,2550-2678`) to `LocalSaveState`.
- Keep `publishSyncStatus` independent.

Exit gate: no ordinary edit writes `CURRENT_DRAFT_STORAGE_KEY`; no UI says “All changes saved” from publish state; all legacy recovery bytes remain recoverable.

## Required tests

### Hook/session mounted tests

1. Empty repository opens start mode, keeps `private-bootstrap-document` private, waits beyond debounce, and has zero repository creates/saves.
2. Repository opening exposes `opening`; blocked/unavailable state is explicit and cannot claim an empty durable workspace.
3. Continue/get installs the exact record envelope, including quotation payload, quotation template ID, and design-template identity, without rewriting it.
4. Create blank/template/import/sample awaits repository create before switching to workspace; failed create leaves start/old workspace unchanged.
5. Controller identity always matches active document ID; a mismatched record or route result is rejected.
6. Ordinary commit captures exact document plus current source context once; rapid commits coalesce in controller tests.
7. Quotation import and design-template application save their newly installed contexts, not the previous ref.
8. Undo/Redo save the source context associated with the restored history snapshot. Undo may lower `document.revision` while durable `recordVersion` increases.
9. Source-context-only capture changes `draftSnapshotId` even when `contentSnapshotId` is unchanged.
10. A deferred completion from controller/session generation N cannot update history, local save state, start metadata, or active IDs after generation N+1 installs.
11. Storage failure retains the latest candidate, exposes retry, and blocks Home/replacement/publish/export until resolved or explicitly downloaded.
12. Stale/deleted save enters conflict, performs no more autosaves, and keeps Download my version available.
13. Session-only mode keeps exact document/source context in memory, returns Home without claiming durability, and does not instantiate a repository controller.
14. A foreign repository event refreshes inactive metadata but never replaces active history; the subsequent dirty save proves conflict through CAS.

### Replacement and routing tests

15. Deferred flush order is exactly settle -> flush resolves -> create/open -> controller switch -> focus.
16. Failed/conflict flush retains replacement confirmation and never calls the action.
17. Double request/confirm remains synchronously locked across async flush/create.
18. Route change to another document is blocked while saving/failed/conflicted and installs only the requested route generation.
19. Returning Home closes/unregisters WebMCP tools only after flush succeeds; current WebMCP lifecycle coverage is `use-studio-webmcp.lifecycle.mounted.test.tsx:77-114`.

### Publish/export tests

20. Publish awaits local flush before deriving `sourceSnapshotId`; local saved + publish error are simultaneously representable.
21. UI and WebMCP publication use the same flush-aware hook service.
22. PNG, PDF, and JSON export do not start before flush resolves and use the exact frozen post-flush document.
23. Export is blocked on failed/conflict durability except the explicit candidate/recovery download path.
24. Publication linkage succeeds only against the same `recordVersion` and `contentSnapshotId`; a concurrent edit leaves the publication valid but does not link it to the newer head.

### Migration/recovery tests retained or adapted

25. Existing recovery bytes have precedence; migration neither consumes nor overwrites them.
26. Current atomic envelope migrates with exact source context and is reread before cleanup.
27. Migration collision creates a retained conflict; it is never last-write-wins.
28. Legacy cleanup failure is a warning after a verified durable repository record, not data loss.
29. First-run and current-draft tests at `use-document-editor.start.mounted.test.tsx:71-219` are ported from localStorage assertions to repository observations without weakening their behavioral claims.

## Rollback boundary

Do not merge or enable a half-cut hook. Patches 1-3 may land while the old localStorage adapter remains the active ordinary persistence port because they do not yet redirect canonical edits. Patch 4 is the one-way behavioral boundary: after the first repository-only edit, the legacy current-draft key may be stale and a code rollback to localStorage can lose newer work.

Therefore:

- keep Patches 4-6 in one releasable cutover branch or behind one repository-persistence switch tested in both positions;
- do not dual-write IndexedDB and localStorage—two authorities with different failure timing are worse than one;
- retain legacy bytes as migration/recovery input until the repository record has been atomically written, reread, and matched;
- after repository-only editing is enabled, rollback must first export/down-migrate the newest repository envelopes or ship a forward fix. A bare source-code revert is not safe;
- never delete the repository database or purge conflict/quarantine records as rollback.

The safe code-review rollback point is immediately before deleting the 450 ms effect and `writeCurrentDraft` path. The safe production rollback point ends when a user has made the first repository-only edit.

## Definition of cutover complete

- Start mode has no active controller and cannot persist the neutral bootstrap.
- Every open durable workspace has one record and one matching controller.
- Every canonical document/source-context transition is captured once at its settled boundary.
- All destructive/navigation/publish/export boundaries await critical flush.
- Failed and conflict states retain the candidate and block unsafe transitions.
- Late callbacks from closed/replaced generations cannot mutate visible state.
- Local durability and publication sync remain separate in state, labels, tests, and WebMCP behavior.
- The old localStorage path is migration/recovery-only, not an ordinary save authority.
