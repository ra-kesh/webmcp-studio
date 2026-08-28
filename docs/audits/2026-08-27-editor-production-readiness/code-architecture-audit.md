# Code architecture audit

## Architectural verdict

The repository has a promising separation on paper:

- `packages/document` defines document data, fields, commands, validation, change sets, and quotation composition.
- `packages/editor` contains history, viewport math, and the Fabric adapter.
- `apps/studio` owns the React editor, local draft, WebMCP, publication, and API playground.
- `apps/renderer` converts documents to output artifacts.

In practice, `use-document-editor.ts` and `studio-shell.tsx` have become integration centers that recreate policy at each boundary. The document package is not yet the enforced source of truth. Fabric events, hook methods, toolbar callbacks, keyboard listeners, WebMCP tools, API routes, publication, and renderer inputs do not all pass through the same command, validation, concurrency, and authorization contracts.

The corrective architecture is one pipeline:

```text
UI / keyboard / menu / WebMCP / HTTP
                  |
          command adapter
                  |
       capability + policy check
                  |
      canonical document command
                  |
 transaction / revision / audit event
        |                     |
  editor projection       durable repository
        |                     |
      Fabric             publish / render job
```

Fabric should render and report interaction intent. It should not define document semantics. API and WebMCP should be adapters to the same canonical commands, not parallel editors.

## P0 findings

### ARCH-01: no canonical action registry

**Evidence.** `studio-shell.tsx:290-362` handles tool/navigation keys. `use-document-editor.ts:1468-1579` handles document shortcuts independently. Buttons call hook methods directly. WebMCP registers a separate set of tool handlers. The verified `V` conflict is the first visible symptom.

**Impact.** Enablement, labels, shortcuts, review lock, telemetry, undo policy, and errors drift by invocation surface. A no-op can still perform caller-side selection effects.

**Target.** Stable action definitions with `id`, `label`, `scope`, platform keybindings, `canExecute`, `checked`, `execute`, transaction policy, error mapping, and optional WebMCP exposure. Components render actions; they do not own policy.

**Acceptance criteria**

- Toolbar, menu, shortcut, context menu, inspector action, and WebMCP call the same action ID.
- Duplicate key ownership is rejected by tests.
- Review state, selection capabilities, document validity, and async locks feed one enablement projection.
- Every mutation creates a named canonical transaction or returns a typed rejection before side effects.

**Owners:** new `packages/editor/src/actions/**`; migration from `studio-shell.tsx`, `use-document-editor.ts`, `inspector-sidebar.tsx`, WebMCP registration.

### ARCH-02: publication can persist schema-valid but relationally invalid versions

**Evidence.** Template/version POST routes parse Zod shapes but do not consistently run document aggregate validation and manifest recomputation. Public schemas are not uniformly `.strict()` even though API documentation promises unknown-key rejection. `update_node.patch` is effectively `Record<string, unknown>` and later spread/cast as a scene node.

**Impact.** Invalid page/node/group/field/output relationships can become immutable published data. Different callers can mutate fields that another caller would reject. Renderer failure may occur far from the invalid write.

**Target.** One strict public command schema and one aggregate validator at every trust boundary. Server recomputes derived manifest/output metadata; clients cannot assert it.

**Acceptance criteria**

- Unknown public request keys are rejected.
- Every create/import/publish/apply path runs schema, aggregate, policy, and asset/font checks.
- Node patches are discriminated by node type and property, not arbitrary records.
- Manifest and derived output metadata are server-computed.
- Invalid relation fixtures fail before persistence and never reach renderer queues.

**Owners:** `packages/document/src/validation.ts`, public schemas/commands, template/version routes, import and change-set paths.

### ARCH-03: direct export routes bypass production ownership boundaries

**Evidence.** `/v1/studio/export-png` and `/export-pdf` proxy caller-supplied whole documents to the renderer. The reviewed paths do not establish the same session/tenancy/version/job/audit/quota boundary promised by a published API product.

**Impact.** The renderer becomes a general unmetered document execution surface. Abuse, cross-tenant data handling, memory pressure, audit gaps, and inconsistent validation become route-specific risks.

**Target.** Separate preview export from published render, but authenticate and validate both. Resolve documents/assets/fonts by owned IDs or signed upload references. Enforce size/page/node/image/time quotas and durable job accounting.

**Acceptance criteria**

- Every render request has principal, tenant/session, document/version identity, request ID, limits, and audit event.
- Caller-supplied documents pass strict size and aggregate validation before renderer contact.
- Renderer cannot fetch arbitrary assets or exceed defined resource/time limits.
- Rate limits and failure behavior are tested.

**Owners:** Studio export/render routes, auth/session layer, renderer service, durable job repository.

### ARCH-04: published render execution fails in the live product

**Evidence.** Two retained jobs fail with `Provided readable stream must have a known length`. The likely investigation boundary includes response-body teeing/construction in `apps/renderer/src/index.ts:123-169` and proxy/job handling in `apps/studio/src/routes/v1/studio/render.ts:129-173,353-452`. This is an evidence-based investigation pointer, not a proven root cause; the direct editor PDF export completed in the same session.

**Target.** A fixed-length or intentionally streamed response contract, correct headers, durable state transitions, and artifact verification.

**Acceptance criteria.** See `WF-08` in [workflow audit](./workflow-and-feature-audit.md#wf-08-p0-publish-succeeds-but-the-promised-api-output-loop-is-broken).

## State and domain findings

### ARCH-05, P1: local draft and server publication form a split-brain document model

**Evidence.** The editor's active draft and history are browser-local. Published versions are server-side. Render history is memory-backed in the exercised environment. There is no explicit durable draft repository, autosave state machine, reconciliation, or recovery protocol.

**Impact.** Reload, multi-tab use, storage corruption, server restart, publication conflict, and offline edits can lose or fork state without an understandable user contract.

**Target.** Versioned draft repository with normalized records, migration, debounced transaction persistence, flush-on-critical-boundary, conflict detection, recovery, and explicit publish-from-draft snapshot.

**Acceptance criteria**

- Draft state has saving/saved/failed/offline/conflict status.
- Browser reload and process restart recover the same canonical revision.
- Corrupt local records are quarantined with recovery rather than trusted.
- Publish captures a validated immutable snapshot and records its draft base.
- Multi-tab edits use optimistic concurrency and a visible conflict path.

**Owners:** editor initialization/persistence, API repositories, document migrations.

### ARCH-06, P1: revision numbers are used as both history position and concurrency token

**Evidence.** Undo replaces a prior full-document snapshot, including the earlier revision. Review change sets compare a base revision. A number that can rewind is not a safe globally monotonic version token.

**Impact.** A state can revisit an old revision value with different surrounding history, undermining stale-write and review-conflict reasoning.

**Target.** Separate concepts:

- immutable operation/server version or ETag that always advances;
- document content revision/snapshot ID;
- local undo cursor;
- review base snapshot ID.

**Acceptance criteria**

- Undo never rewinds the server concurrency token.
- Review conflict compares immutable base identity, not a reusable integer.
- Save/publish APIs require an expected version/ETag.
- Tests cover edit, undo, branch edit, stale proposal, and multi-client collision.

**Owners:** document model, history, change sets, draft/version APIs.

### ARCH-07, P1: editor state is concentrated in a monolithic hook

**Evidence.** `use-document-editor.ts` is roughly 1,700 lines and owns initialization, document commits, selection, fields, change sets, publication-adjacent state, page/output commands, clipboard, images, shortcuts, viewport effects, and history.

**Impact.** Policy boundaries are implicit; stale closure/ref workarounds multiply; features can bypass each other's locks; unit testing requires constructing a full editor.

**Target modules**

- document session/repository;
- command bus and capability projection;
- selection/tool/viewport state;
- transaction history;
- media repository;
- fields/change-set services;
- publish/render client;
- Fabric projection adapter.

**Acceptance criteria**

- Pure reducers/services cover commands, capability rules, and selection reconciliation.
- React hooks only bind lifecycle and subscriptions.
- No feature owns a second keyboard listener or direct document mutation.
- Each module has focused fixtures and failure tests.

### ARCH-08, P1: Fabric, document, and renderer consistency is assumed rather than proven

**Evidence.** Fabric defaults and event semantics influence editor behavior. The renderer is a separate implementation. No fixture suite compares editor projection, document canonical geometry, PNG, and PDF for text, image crop/focal, groups, transforms, visibility, fonts, and quotation themes.

**Impact.** A design can look valid in the editor and differ at export or API render. The current API failure demonstrates the cost of testing these systems separately.

**Target.** A conformance corpus with canonical documents and expected geometry/artifacts. Render editor snapshots and server outputs from the same fixtures and compare layout invariants plus visual diffs.

**Acceptance criteria**

- Fixtures cover every node type/property, nested groups, hidden/locked state, text overflow/fonts, image fit/focal, pages/outputs, and themes.
- Browser canvas, PNG, and PDF agree within defined tolerances.
- Missing font/asset and corrupt input have deterministic failures.
- CI publishes diff artifacts.

**Owners:** `packages/editor`, `packages/document`, `apps/renderer`, visual test tooling.

### ARCH-09, P1: duplicate-page and other commands can violate cross-domain relations

**Evidence.** The reviewed duplicate-page path does not preserve or intentionally remap all field bindings. More broadly, commands are tested as local transforms more often than as aggregate changes across pages, outputs, fields, groups, and assets.

**Target.** Aggregate commands define remapping policies for node IDs, groups, bindings, assets, and output membership and return an impact/result object.

**Acceptance criteria**

- Duplicate page clones all intended nodes/groups/bindings with fresh IDs.
- Delete page reports/removes or remaps dependent outputs/bindings according to explicit policy.
- Aggregate validation passes after every command.
- Property-based tests cover ID/reference integrity.

**Owners:** `packages/document/src/commands.ts`, fields/groups/output modules and tests.

## API and WebMCP controllability

### ARCH-10, P1: WebMCP is useful but partial and separately wired

**Positive evidence.** Ten tools are visible. `inspect_design`, `validate_design`, and proposal/review paths worked in the browser. Proposal application is atomic after decisions and rechecks its base revision.

**Gaps**

- Registration is effectively one-shot and tied to the current host state.
- Inspection is active-page-biased rather than a queryable document graph.
- Tool capabilities do not derive from the same action registry as UI.
- Error and policy behavior can differ from toolbar/API callers.
- Full page/output/template/media workflows are not controllable with clear idempotency.

**Target WebMCP contract**

- `get_capabilities` exposes action IDs, schemas, enablement, reason, and document/version identity.
- `inspect_design` supports page/output/node/field queries and pagination without dumping the whole document.
- Mutations use canonical commands with dry-run/proposal/direct modes as policy allows.
- Every response includes stable status/code, affected IDs, base/result snapshot, warnings, and idempotency key.
- UI can focus the exact affected result.

**Acceptance criteria**

- UI, WebMCP, and HTTP conformance tests run the same command fixtures.
- Disabled UI actions are disabled with the same reason in WebMCP.
- Proposals survive reload and retain provenance.
- Repeating an idempotent request cannot duplicate nodes/jobs.

**Owners:** WebMCP registration/tools, command registry, change-set persistence, public API schemas.

### ARCH-11, P1: API error and parsing contracts are inconsistent

**Evidence.** Reviewed routes do not consistently catch malformed JSON into the documented error envelope. Demo authentication can silently create a session. Render state is synchronous/in-memory in important paths. There is no common typed error registry across validation, authorization, conflict, quota, render, and storage failures.

**Target.** Shared request parsing and response/error helpers with status, stable code, safe message, field/path details where relevant, request ID, retryability, and observability correlation.

**Acceptance criteria**

- Malformed JSON, unknown keys, unauthorized, forbidden, missing, conflict, invalid aggregate, quota, timeout, renderer failure, and internal failure have contract tests.
- Production never silently creates demo identity.
- Logs contain correlation and internal cause without exposing secrets to clients.

## File and domain ownership map

| Area                                                     | Current finding                                                                   | Target ownership                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/studio/src/features/studio-shell.tsx`              | Layout, keyboard, toolbar, dialogs, export/publish/API wiring are coupled         | Composition and action rendering only                           |
| `apps/studio/src/features/editor/use-document-editor.ts` | Monolithic session, command, selection, history, media, fields, review, shortcuts | Thin React composition over focused services                    |
| `quotation-sidebar.tsx`                                  | Quotation themes plus flat layers, active but limited                             | Merge into canonical navigation panels                          |
| `document-sidebar.tsx`                                   | Rich capabilities but dead code                                                   | Either mount and refactor or remove after consolidation         |
| `page-filmstrip.tsx`                                     | Selection-only thumbnails                                                         | Page command consumer with virtualization/cached previews       |
| `inspector-sidebar.tsx`                                  | Broad capabilities, local parsing/policy, large mixed concern                     | Capability-derived property/review/field modules                |
| `fabric-artboard.tsx`                                    | Renderer/input bridge with load and interaction failure gaps                      | Projection plus explicit interaction-intent events              |
| `packages/editor/src/history.ts`                         | Whole-document snapshots and local cursor                                         | Named transaction log/coalescing/selection reconciliation       |
| `packages/editor/src/fabric-adapter.ts`                  | Fabric semantics can leak into document behavior                                  | Deterministic projection and geometry conversion                |
| `packages/document/src/commands.ts`                      | Useful pure transforms; cross-domain policies incomplete                          | Sole canonical mutation layer with impact results               |
| `packages/document/src/validation.ts`                    | Validation exists but is not universal at trust boundaries                        | Strict aggregate gate for import/save/publish/render            |
| quotation composer/contract/fixture                      | Strong specialized demo generator                                                 | Versioned template/composition domain with migration            |
| Studio API routes                                        | Route-specific parsing/auth/validation/jobs                                       | Shared middleware, repositories, command service                |
| `apps/renderer/src/index.ts`                             | Output execution and response streaming; live failure boundary                    | Isolated, resource-limited render worker with artifact contract |

## Testability requirements

Before expanding feature breadth, add these layers:

1. Pure command/capability fixtures for every UI/WebMCP/API mutation.
2. Aggregate invariant and property-based tests for ID/reference remapping.
3. Interaction transaction tests for drag, transform, text edit, sliders, cancel, and undo.
4. Accessible component tests for menus, tree, inspector controls, fields, review, and compact sheets.
5. Browser journeys at supported breakpoints.
6. Renderer conformance and visual-oracle fixtures.
7. Route contract/security/failure tests.
8. Persistence migration, corrupt record, multi-tab, offline, and recovery tests.
9. Published API smoke test that verifies the downloaded artifact.

Passing the current build and package tests is necessary, but it does not cover these production contracts.
