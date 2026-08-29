# PERSIST-01B routed conflict and external-change recovery phase map

Date: 2026-08-29
Status: implemented; focused code gate independently approved

## Decision

The repository already preserves exact conflict candidates, and the save
controller already stops after an authoritative compare-and-swap conflict. The
missing product is the routed recovery coordinator and its persistent,
accessible UI.

This slice must make an open routed document recoverable after a foreign save,
delete, quarantine, storage failure, or actual CAS conflict. It must not add an
Overwrite action, silently merge snapshots, clear a candidate when a dialog is
closed, or navigate away while the only preserved copy remains in memory.

The implementation order is:

1. close the routed exit bypass;
2. add a framework-independent recovery coordinator and model;
3. rediscover unresolved repository candidates on route entry;
4. add the persistent dialog/status surface;
5. implement Download, Reload saved, and atomic Save as copy through that one
   coordinator;
6. prove route, StrictMode, race, and two-repository behavior before browser
   acceptance.

## Governing contracts reread

- `persist-01b-phase-entry.md`, especially Conflict and external change;
- `persist-01b-acceptance-plan.md`, P1B-M10 and P1B-M12 through P1B-B08;
- `persist-01b-reference-patterns.md`, Conflict, route blockers, route entry and
  exit;
- `remediation-progress.md`, current PERSIST-01A/01B evidence and open items;
- `persist-01b-conflict-copy-review.md`, the independently approved atomic
  save-copy contract.

Reference source inspected:

- Loora `packages/editor/src/lib/canvas-client.ts`;
- Loora `packages/editor/src/components/app.tsx`;
- OpenPencil `src/app/tabs/open/coordinator.ts` and `src/app/tabs/index.ts`;
- OpenPencil `packages/vue/src/document/workspace/use.ts`.

Loora is inspect-only under its license. No source is copied.

## Exact current truth

### Repository: strong reusable foundation

`DocumentDraftConflict` retains the exact candidate envelope, expected and
observed versions, base and candidate snapshot IDs, reason, detection time, and
resolution (`document-draft-repository.ts:225-243`).

Ordinary stale/deleted saves write the candidate in the same transaction that
detects the failed CAS. `listConflicts(documentId)` parses and canonically admits
every candidate before returning newest-first results
(`document-draft-repository.ts:3658-3728`). A corrupt candidate is a typed
failure, not editable content.

`resolveConflict(conflictId, "reload_saved")` is idempotent for an already
resolved row and emits `conflict_resolved` after commit
(`document-draft-repository.ts:3730-3777`). It intentionally rejects
`save_copy`; that path must use `saveConflictAsCopy`.

`saveConflictAsCopy` is already the correct primitive
(`document-draft-repository.ts:2225-2552`):

- validates the conflict ID and expected candidate draft snapshot;
- admits the stored candidate, not a mutable UI object;
- creates a new canonical document ID, revision, timestamps and duplicate
  provenance;
- re-reads the conflict and target inside one transaction;
- writes body, metadata, and resolved conflict atomically;
- converges retries on the committed `resolutionDocumentId`;
- returns the exact created/replayed record for route admission.

The independent conflict-copy review is approved with no open P0/P1/P2.

### Save controller: terminal conflict is already honest

`DocumentDraftSaveController` keeps one immutable pending capture, serializes
writes, and pauses permanently on repository conflict
(`document-draft-save-controller.ts:133-176,221-303`). On stale write or delete,
it restores the exact capture, marks the controller terminal, and publishes
`{status:"conflict", conflictId, reason}`. Normal flush cannot resume it.

This is the correct lower-level rule. The recovery UI must replace the whole
session/controller after resolution. It must not attempt to reset the terminal
controller.

### Hook: detection and exact download exist; resolution does not

The hook projects foreign content, restore, delete and quarantine events to
`external_change` without replacing the visible document
(`use-document-editor.ts:620-680`). BroadcastChannel remains a freshness hint;
the repository CAS remains authority.

The hook blocks ordinary flush immediately while `external_change`
(`use-document-editor.ts:1224-1232`). A later edit may still be committed because
`allowMutation` does not inspect local-save state
(`use-document-editor.ts:1940-1954`), but the public flush path cannot currently
materialize that branch as a durable conflict candidate.

The exact in-memory Download path exists and deliberately does not flush
(`use-document-editor.ts:1655-1671`). Mounted tests prove byte-equivalent JSON,
no additional save, unchanged durable head, and unchanged conflict rows for
both failed save and CAS conflict
(`use-document-editor.persistence.mounted.test.tsx:2642-2780`).

The hook has no production call to `listConflicts`, `resolveConflict`, or
`saveConflictAsCopy`. Reloaded routed sessions therefore do not rediscover
unresolved candidates.

### Current UI: warning menu, not recovery

The header labels failed, conflict and external-change states accurately
(`studio-shell.tsx:1919-1951`). Its status menu describes the risk and exposes
Retry for retryable storage failure plus Download my version
(`studio-shell.tsx:2990-3065`).

It does not expose candidate identity, reason, detection time, durable-head
state, Reload saved, Save as copy, confirmation, operation-local progress,
resolution failure, or recovery after reload. Closing the menu hides the only
explanation, even though it does not resolve the underlying state.

### Routed navigation: current P0 bypass

`StudioShell` correctly has a legacy `returnToStart()` path that settles the
active persistence session and refuses conflict, but the routed Home command
prefers `onHome` and calls it directly (`studio-shell.tsx:2131-2159`). The
document route supplies `onHome={() => navigate({to:"/"})}`. Therefore routed
Home bypasses capture/flush/conflict refusal and can unmount the session while
its newest version exists only in memory.

The same route owns document-to-document navigation after a session open. There
is not yet one router blocker/transition coordinator for browser Back/Forward,
Home, card Open, Create, Import, Template, active Delete and conflict exits.

Visible conflict recovery is not production-safe until this bypass is closed.

## Reference conclusions

### Loora

Loora keys pending work by the exact sync target, loads it before controller
construction, rebases it, and restores conflict on reopen
(`canvas-client.ts:68-70,420-465`). Pending transaction IDs are deduplicated;
normal flush returns immediately during conflict (`:699-720`). Close flushes,
persists pending work, then marks the controller closed (`:735-750`). Ordered
pending persistence prevents an older snapshot landing after a newer
acknowledgement (`:1249-1270`).

Safe adaptation: target-key recovery state, terminal conflict, ordered work,
and reopen discovery. Do not import Loora's transaction rebase, remote protocol,
or offline collaboration model; Studio owns whole-document CAS candidates.

### OpenPencil

OpenPencil serializes open decisions and deduplicates matching pending opens in
`src/app/tabs/open/coordinator.ts:5-46`. It persists recovery before disposing a
tab (`src/app/tabs/index.ts:144-165`). Its workspace controller coalesces one
refresh plus one queued rerun and ignores completions after disposal
(`packages/vue/src/document/workspace/use.ts:46-83,103-112`).

Safe adaptation: one synchronous recovery action owner, stale-generation
rejection, disposal checks, and repository refresh after resolution. Do not
adopt desktop tabs or file-provider identity.

## Target state model

Use a framework-independent `DocumentConflictRecoveryController`, projected by
a pure model and consumed by one mounted surface.

```text
inactive
  -> discovering(documentId, generation)
  -> external_change(reason, observedVersion, liveEnvelope)
  -> conflict(conflict, durableHeadSummary)
  -> recovery_required(conflict/list failure)

external_change | conflict
  -> downloading(actionToken)
  -> confirming_reload
  -> reloading(reading -> installing -> resolving -> complete)
  -> saving_copy(preparing -> committing -> navigating -> complete)
  -> failed(action, exact identity, message, retryable)

route change | unmount -> disposed
```

Rules:

- state is keyed by route document ID and session generation;
- only one critical recovery action can own the controller synchronously;
- a late list/get/install/resolve/copy completion cannot update a newer route;
- UI dismissal changes presentation only; it never resolves a row, clears the
  terminal save state, or permits unsafe navigation;
- unresolved repository candidates are rediscovered on every document route
  entry and on focus/visibility invalidation;
- `conflict_resolved` is a refresh hint. The command result/repository read is
  authoritative;
- resolved rows are history, not actionable recovery items;
- corrupt candidate/list results route to recovery-required UI and never expose
  the candidate as editable JSON.

## User experience contract

### Persistent surface

Conflict or external change opens a non-destructive persistent dialog or
equivalent blocking recovery panel. Closing it leaves a visible, keyboard-
reachable status banner/button. It cannot disappear into the existing status
dropdown.

The surface shows:

- document name and exact reason in plain language;
- whether the durable record changed, was deleted, or requires recovery;
- candidate detection time when a durable conflict exists;
- Download my version;
- Reload saved version, or Accept deletion and return Home for a tombstone;
- Save my changes as a copy;
- operation-local progress with `role="status"`;
- failures with `role="alert"` and Retry;
- explicit confirmation before discarding the open branch.

Initial focus enters the heading, actions have stable focus order, Escape may
collapse to the persistent banner but cannot dismiss recovery, failure restores
focus to the exact invoking action, and successful install focuses the canvas.

### Download my version

For a live routed session, serialize a synchronous structured clone of the
canonical document and source context at action claim time. Do not flush, read
the renderer, or substitute the repository candidate. Keep the action available
during external change, failed save, unresolved conflict, and resolution errors.

After page reload there may be no live in-memory branch. Then Download uses only
the exact admitted unresolved repository candidate. The model must label the
source truthfully; it cannot imply it is a newer live edit.

### Reload saved version

For `stale_write`:

1. claim the recovery owner and confirm destructive replacement;
2. settle text/crop/transform/review modes without attempting the terminal save;
3. `get(documentId)` and perform exact route admission;
4. install the returned durable head into a fresh history/save controller;
5. verify the same route/session generation and conflict ID;
6. resolve that exact conflict as `reload_saved`;
7. refresh recovery inventory and focus the canvas.

If read, admission, install, or resolve fails, the candidate remains visible and
downloadable. If install succeeds but resolution fails, the new durable head may
remain active, but the unresolved candidate must stay in the recovery surface
until resolution is retried.

For `deleted_elsewhere`, there is no editable durable head. The action is
`Accept deletion and return Home`: confirm, close the terminal session, resolve
the exact conflict as `reload_saved`, navigate with replace to `/`, refresh
Trash, then focus the relevant recovery/Trash item. If resolution fails, do not
pretend completion. Quarantine takes precedence and enters the existing recovery
surface rather than resolving as an ordinary deletion.

For `external_change` without a durable conflict row, Reload may admit and
install the durable head after confirmation; there is no conflict row to
resolve.

### Save my changes as a copy

For an existing unresolved conflict, use only:

```ts
repository.saveConflictAsCopy({
  conflictId,
  expectedCandidateDraftSnapshotId,
  newDocumentId,
  name,
})
```

Never compose `create()` with `resolveConflict("save_copy")`. On success, retain
the returned created/replayed record, navigate to its canonical route, let route
admission verify it, and focus the new canvas. If navigation/admission fails, the
copy still exists and the resolved row points to it; show an exact Open copy
recovery action rather than recreating it.

For `external_change` before a conflict row exists, the coordinator must first
create durable recovery authority. The current public `flushActiveDraft()`
short-circuits at `external_change`, so this requires one of two explicit
contracts before UI work:

1. a hook command that captures the exact live envelope and asks the existing
   controller to perform the authoritative stale CAS, producing a conflict ID;
   then call atomic `saveConflictAsCopy`; or
2. a new repository atomic operation that creates a copy directly from an
   admitted live envelope with explicit expected base identity.

Prefer the first because it reuses the already tested CAS candidate and avoids a
second conflict model. Do not temporarily clear `external_change` or call an
unversioned create.

## Route and navigation ownership

Before this surface can ship, every routed exit must share one transition owner:

1. synchronously claim action ownership;
2. settle editor-local interactions;
3. capture the exact live envelope;
4. if saved, flush normally; if external/conflicted/failed, refuse ordinary
   navigation and open recovery;
5. permit navigation only after a preserving recovery action commits;
6. invalidate the old route/session generation and close its controller;
7. navigate once, then focus once.

TanStack Router Back/Forward needs an async blocker. Native `beforeunload` is
only for unsaved in-memory work and must not claim that a durable unresolved
candidate is lost. `pagehide` remains best effort.

## Race, StrictMode and multi-tab matrix

- Two recovery button activations in one turn produce one operation.
- Conflict A cannot resolve conflict B, even for the same document/session.
- A newer candidate draft snapshot makes an old action `stale_conflict` and
  refreshes the surface; it never resolves the new row.
- Late Reload A cannot install after route B begins.
- Late Save-copy navigation cannot replace a newer route.
- StrictMode replay creates one active recovery subscription/action owner and
  disposes abandoned generations without closing the shared repository.
- A `conflict_resolved` event from another tab refreshes inventory but does not
  mark a local action successful.
- BroadcastChannel disabled: focus refresh plus repository CAS still finds the
  unresolved candidate.
- Foreign save while the editor is clean projects external change without
  merging. Local mutation followed by preservation creates a durable conflict.
- Foreign delete while clean/dirty/saving produces no resurrection. A terminal
  controller can never save after accepting deletion.
- Candidate survives reload and remains downloadable.
- Copy transaction success plus navigation failure converges on the stored
  resolution document on Retry.
- Resolve failure after durable-head install retains actionable recovery.
- Route unmount during list/get/resolve/copy prevents stale state and focus.

## Proposed files

New:

- `apps/studio/src/features/editor/document-conflict-recovery-controller.ts`
- `apps/studio/src/features/editor/document-conflict-recovery-controller.test.ts`
- `apps/studio/src/features/editor/document-conflict-model.ts`
- `apps/studio/src/features/editor/document-conflict-model.test.ts`
- `apps/studio/src/features/editor/document-conflict-dialog.tsx`
- `apps/studio/src/features/editor/document-conflict-dialog.test.tsx`
- `apps/studio/src/features/editor/document-conflict-recovery.mounted.test.tsx`
- `apps/studio/test/e2e/document-multitab-conflict.spec.ts`

Modify:

- `use-document-editor.ts`: exact recovery snapshot/candidate materialization,
  fresh record replacement, session identity and focus ports;
- `studio-shell.tsx`: persistent surface and one routed transition call;
- `_studio/documents/$documentId.tsx`: route-keyed recovery owner and navigation
  completion;
- persistence/provider layer only if conflict discovery must outlive the editor
  route;
- `remediation-progress.md` after independent approval.

Repository changes are not expected for ordinary conflict resolution. Add one
only if tests prove the external-change-to-conflict command cannot safely reuse
the save controller.

## Required tests

### Pure/controller

- projection for stale write, deleted elsewhere, migration collision, corrupt
  candidate, resolved row, external change and operation failures;
- private source context never appears in UI text;
- newest unresolved selection and exact conflict/snapshot identity;
- synchronous action ownership, stale generations, disposal and retry;
- external-change candidate materialization;
- Reload install-before-resolve ordering and every failure boundary;
- atomic save-copy command, replay, target collision, stale candidate,
  resolution-document recovery and navigation failure;
- deletion acceptance and quarantine precedence.

### Mounted

- actual CAS conflict opens persistent recovery UI and pauses autosave;
- closing dialog retains banner and candidate;
- Download is byte-exact before and after reload;
- Reload creates fresh history/controller, keeps route identity, resolves only
  after install, and focuses canvas;
- Save-copy opens the exact returned document route and does not double-create;
- failed actions retain candidate, input and exact focus;
- Home/card Open/Back remain blocked until preserving resolution;
- StrictMode replay and route A to B stale completion rejection;
- compact keyboard order, status/alert semantics and reduced motion.

### Healthy browser

- two real tabs produce stale-write and deleted-elsewhere candidates;
- exercise Download, Reload, then repeat and Save as copy;
- reload each route and prove both final documents and source context;
- disable BroadcastChannel and repeat using focus invalidation;
- Back/Forward and reload during pending resolution;
- deterministic IndexedDB resolve/copy failure injection;
- compact focus and accessibility scan.

## Explicit deferrals

- operation-level rebase or automatic merge;
- collaborative presence, cursors and remote selection;
- cloud sync, authentication, authorization and server heads;
- conflict diff/visual comparison beyond document metadata and exact download;
- multi-conflict batch resolution;
- permanent purge policy and retention UI;
- PERSIST-01C preview generation/loading and storage estimates;
- background service-worker recovery;
- WebMCP conflict-resolution commands until the human command contract is
  independently approved. Later WebMCP must call the same typed commands.

## P0 prerequisites

1. **Close routed navigation bypass.** Routed Home, browser Back/Forward and all
   document replacement must pass the exact settle/capture/flush/recovery gate.
2. **External-change preservation command.** Define how a live external-change
   branch becomes a durable conflict candidate before Save as copy. The current
   public flush refuses before CAS.
3. **Route-keyed recovery discovery.** Unresolved candidates must be listed and
   verified before the route claims a recoverable clean session after reload.
4. **Fresh-session replacement port.** Reload must install an admitted record
   into fresh history/controller identity without bootstrap content and expose
   completion/failure to the recovery coordinator.
5. **Exact conflict action identity.** Every resolve/copy command carries both
   `conflictId` and expected candidate draft snapshot ID; no latest-row shortcut.
6. **Deletion/quarantine policy.** Deleted durable heads cannot be reinstalled;
   accepting deletion and quarantine recovery need distinct typed flows.

No dialog implementation should begin until prerequisites 1 through 5 have
deterministic red tests and a reviewed ownership boundary.

## Implementation close-out

The routed recovery gate is implemented. The editor now rediscovers unresolved
conflicts on route entry and retains a persistent recovery surface for stale
writes, deletion elsewhere, quarantine, migration collision, and storage
failure. Download, Reload saved, Save as copy, Open saved copy, and Return to
Documents are routed through one operation owner; closing the dialog cannot
discard or falsely resolve the preserved candidate.

The final independent review initially rejected two timing races:

- Save as copy could preserve conflict candidate A while omitting a newer live
  edit B queued behind the failed save.
- Reload saved could install head R2, lose a race to R3, and resolve against the
  stale R2 observation.

Both are closed. A live conflict copy captures the exact current canonical
document and source context at action claim time, while rediscovered conflicts
continue to use their immutable stored candidate. Conflict resolution now
requires both the exact candidate snapshot ID and the exact durable head. The
repository compares conflict, body, and metadata in one IndexedDB transaction;
`head_changed` retains the unresolved row and feeds the verified newer head
back into the hook's bounded reinstall loop.

Focused evidence passes **125/125 across four files**: repository conflict/CAS,
pure recovery model, accessible dialog, and mounted persistence/recovery. Studio
typecheck, scoped production ESLint, Prettier, and `git diff --check` pass. The
independent re-review verdict is **ACCEPT with no remaining P0/P1 finding** in
the repaired paths.

Healthy-browser two-tab, blocked-upgrade, quota, and failure-injection evidence
remains an acceptance boundary; it is not mislabeled as complete by this code
gate. The next implementation slice is PERSIST-01C durable preview
production/loading, governed by `persist-01c-preview-phase-map.md`.
