# START-01 persistence, bootstrap, and start-surface independent code review

Date: 2026-08-28
Reviewer: independent subagent, source and static-test review
Status: **approved for the bounded single-current-draft START-01 slice; full START-01 remains open on PERSIST-01 and healthy-host browser gates**

## Review boundary

This review covers current-draft bootstrap and migration, the atomic draft
envelope, canonical JSON import and editable-resource admission, start-model
projection, start/workspace session integration, destructive-replacement
coordination, Home command integration, WebMCP registration lifetime, and the
start surface. It does not approve unrelated editor work in the dirty worktree.

Before reviewing the implementation, I reread:

- `start-01-start-surface-audit.md` in full;
- `workflow-and-feature-audit.md`, especially WF-03 and WF-09;
- `docs/loora-editor-reference.md`;
- OpenPencil's actual recent-file store and `HomeWorkspace.vue`;
- Loora's actual canvas-client persistence, queue, flush, and close paths;
- the local Canva clone's actual template and project surfaces.

The reference conclusion remains the governing contract: Studio exposes one
honest current browser draft. Every start action that can replace it uses one
controller that synchronously locks races, keeps confirmation available, settles
live editor state, flushes the prior draft, and installs a new validated session
only after explicit confirmation.

## Active findings

No P0, P1, or P2 correctness finding remains in the reviewed START-01 boundary.

## Closure evidence

### Bootstrap, migration, and recovery

- First-run bootstrap creates a private neutral in-memory document and does not
  write or expose sample content. Autosave is gated to workspace mode
  (`use-document-editor.ts:322-365, 715-765`).
- A valid atomic envelope is restored without a visit-time rewrite. Current,
  recovery, storage-unavailable, legacy, and empty outcomes are discriminated
  before the editor session is opened (`current-draft-repository.ts:450-598`).
- Legacy source-context keys are all read before migration writes. A failed
  read returns a recoverable in-memory envelope while retaining every legacy
  byte; cleanup starts only after the new atomic write succeeds
  (`current-draft-repository.ts:516-598`).
- The source-context-discarded warning is now truthful: it is emitted only when
  at least one legacy quotation/template association key actually existed
  (`current-draft-repository.ts:543-578`).
- Recovery remains the highest-priority shell branch, and normal current-draft
  writes stop while an owned recovery record exists.

### Start sessions, storage failure, and Home

- Start and workspace are mutually exclusive shell branches. Continue installs
  the exact validated envelope without rewriting it, while successful blank,
  template, import, and sample actions install their own first valid page and
  source context.
- Storage-unavailable mode is explicit and requires acknowledgement. Session-only
  work is validated and retained in the in-memory start envelope, rather than
  falsely reporting durable persistence (`use-document-editor.ts:594-630`). The
  mounted lifecycle test returns Home, reopens the current draft, and proves a
  newly added rectangle survives.
- Acknowledging session-only mode moves focus to the Current draft action or
  Blank action on the next animation frame (`studio-start-surface.tsx:905-917`),
  and the mounted start-surface test asserts the destination.
- `document.home` is a real product command, included in File and command-palette
  models (`product-commands.ts:384-391, 1274`). Its runtime supplies crop/review
  disabled reasons, commits active Fabric text, invokes the hook's flush-backed
  `returnToStart()`, and routes the header logo through that same runtime
  (`studio-shell.tsx:1834-1843, 1903-1907, 2262-2270`).

### Destructive replacement and live editor state

- Blank, create-from-template, start import, and sample actions all enter the
  shared replacement coordinator. Workspace template creation uses the same
  path. The editor-menu JSON and quotation imports retain their deliberate,
  undoable in-session replacement semantics.
- The controller uses refs for synchronous request and execution locks. It
  queues confirmation before any flush; confirmation orders settle, flush,
  replacement, then focus/open completion (`use-draft-replacement.ts:27-103`).
  Failed settlement, flush, or replacement leaves the pending confirmation
  mounted for Cancel, Download, and Retry.
- Both replacement-dialog download surfaces commit active Fabric text before
  capturing the JSON (`studio-shell.tsx:2230-2241, 3488-3499`). File and
  quotation import inputs also commit active text before parsing.
- Sample publication cleanup occurs only after the new local session installs.
  Its best-effort server reset does not delay opening or steal focus.

### Canonical import and editable-resource admission

- Import rejects empty and oversized files before allocating `text()`, then
  distinguishes read, JSON, schema, migration, aggregate, renderer-policy, and
  resource-policy failures (`document-import.ts:241-327`).
- Renderer-policy exemptions use exact local/managed parsers, not raw prefixes,
  so malformed Studio-looking identities remain blocking unmanaged assets
  (`document-import.ts:112-139`).
- Every referenced canonical local asset is resolved from IndexedDB and must
  have an exact ID, ready metadata, non-empty Blob, and matching size/media type.
  Every managed identity requires an exact authenticated workspace lookup
  (`document-import.ts:178-231`).
- Existing archived managed assets are admitted for round-trip even though they
  remain unavailable for new selection. Missing, mismatched, unreadable, and
  repository-failure cases return typed pre-install resource failures.
- Asset-field default/current identities are included and repeated references
  are deduplicated (`document-import.ts:141-165`).

### Publication and WebMCP isolation

- Publication restoration and synchronization are scoped by exact template and
  document identities, and remote synchronization runs only in workspace mode.
  A replacement therefore cannot inherit unrelated publication history.
- WebMCP registration is enabled only for the workspace. Returning to the start
  surface aborts every registration signal and disposes the managed catalog
  (`use-studio-webmcp.ts:72-140`). A mounted lifecycle test proves the
  enabled-to-disabled transition aborts all ten registrations.

## Static verification performed

No server, browser, build, Playwright, Wrangler, or deployment command was run,
as required by this review assignment.

Passed after the final source changes:

- Studio focused Vitest suite: **9 files, 92 tests**. This included repository,
  import, start model/surface, New Document, replacement coordinator, mounted
  editor start lifecycle, WebMCP projection, and mounted WebMCP cleanup.
- Editor product-command Vitest suite: **1 file, 15 tests**.
- `apps/studio` TypeScript check: passed.
- `packages/editor` TypeScript check: passed.
- Scoped Studio ESLint over the reviewed implementation and tests: passed.
- Prettier check over reviewed Studio and editor-package files: passed.

## Residual verification and follow-up

These are not source-level correctness blockers for this bounded slice:

- The source composition proves active-text settlement for Home and replacement
  downloads, but there is not yet one full mounted `StudioShell` test that drives
  real Fabric text editing through Download/Home, crop/review blocking, flush
  failure, successful replacement, and final canvas focus. The smaller mounted
  hook/controller tests cover the business boundaries independently. Keep the
  full-shell journey in the healthy-host/browser gate rather than claiming it was
  exercised here.
- Resource admission currently resolves unique local/managed identities in a
  sequential loop (`document-import.ts:190-231`). Correctness and request
  deduplication are bounded by the 5,000-node document policy, but an image-heavy
  import could be slow or make many workspace lookups. A batched lookup endpoint
  or bounded-concurrency admission pass is a production-scale follow-up; it does
  not permit missing data or data loss in the current implementation.
- The required healthy-host browser matrix remains outstanding: 320/390/1280/
  1440 layouts, keyboard-only start journeys, real file-picker cancel/reselect,
  browser Back/Forward, refresh/no-rewrite, flush/recovery visuals, focus, and
  artifact capture. This review was explicitly prohibited from running it.
- Full START-01 still requires PERSIST-01's genuine multi-document repository,
  stable document routes, real recents, version/conflict handling, and durable
  renderer-derived previews. The current UI correctly avoids pretending that
  the single draft is a recent-document collection.

## Approval decision

The bounded single-current-draft start surface and integration are approved by
source review and focused static verification. The previously blocking defects
in asset admission, Home command ownership, live-text download settlement,
storage-warning focus, and legacy-warning accuracy are closed. Do not mark full
START-01 or the product's persistence story complete until PERSIST-01 and the
healthy-host browser gates pass.
