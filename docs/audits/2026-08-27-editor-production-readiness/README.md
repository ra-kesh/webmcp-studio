# Editor production-readiness audit

Audit date: 2026-08-27
Repository: `/Users/rakesh/Developer/webmcp-studio`
Scope: current working tree, including uncommitted changes

## Executive verdict

WebMCP Studio is an effective quotation-demo prototype, but it is not production-ready as a general document and image editor. Its strongest path is coherent: a six-page starter, three quotation themes, Fabric rendering, a useful single-selection inspector, local image insertion, field bindings, agent-proposed review, publishing, and a visible API playground. Those pieces demonstrate the intended product thesis.

The product breaks at the point where a demo must become a trustworthy editor:

1. **The published API render loop fails.** Two safe attempts to render the published PDF ended in the same failed job with `Provided readable stream must have a known length`. Publishing works; the promised API output does not. See [test evidence](./test-evidence.md#api-01-published-render-fails-reproducibly).
2. **Visible capabilities do not match reachable capabilities.** Page and output CRUD exist in code but the live shell mounts a quotation-only sidebar. A blank document cannot add a second page. Templates are three whole-document quotation themes, not a reusable template system.
3. **Editor commands have no single owner.** Toolbars, keyboard listeners, the editor hook, and WebMCP call different paths. Pressing `V` clears the selection. During a pending review, Add text remains enabled, commits nothing, and leaves a selection pointing to a node that does not exist.
4. **The responsive shell loses functionality.** At 320 px, top-bar actions extend to about 361 px and are clipped by an overflow-hidden shell. Publish and API disappear at smaller widths without an overflow menu. Compact drawers have no dialog semantics, no focus trap, and do not close with Escape.
5. **Production boundaries are incomplete.** Direct export routes accept a caller-supplied document without a session boundary; persisted versions are schema-checked but not aggregate-validated; browser draft state and server-published state diverge; revision numbers can move backward through undo.
6. **Quality gates prove build health, not product readiness.** Lint, builds, package tests, and the three gesture E2E tests pass. There are no complete interaction, accessibility, visual-regression, renderer-conformance, failure-injection, route-security, or performance budgets.

### Maturity judgment

| Dimension               | Current maturity | Reason                                                                                                                             |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Scripted quotation demo | Late prototype   | Attractive starter and a largely coherent happy path, with a broken final API-render step                                          |
| General document editor | Early alpha      | Page/output management is unreachable; blank documents dead-end; text and templates are shallow                                    |
| Image workflow          | Early alpha      | Upload and insertion work; library persistence, listing, deletion, progress, and reuse are absent                                  |
| Interaction depth       | Early alpha      | Basic selection, pan, zoom, shapes, inspector, undo and redo work; action scope and transaction semantics do not                   |
| Accessibility           | Prototype        | Core canvas, drawers, icon controls, async status, and focus management lack production semantics                                  |
| API/WebMCP platform     | Prototype        | Ten useful demo tools and publish flow exist; command parity, validation, tenancy, durability, and output execution are incomplete |
| Production operations   | Not ready        | No durable job system, error recovery, quotas, observability contract, or tested failure-state matrix                              |

## Release recommendation

Do not represent the current build as a production document/image editor. It can be shown as a controlled quotation-editor prototype only after the demo-critical P0 items are resolved and rehearsed in a clean session.

The minimum credible challenge demo gate is:

- a published API render completes and returns the expected artifact;
- all pending-review mutations are consistently disabled, including keyboard and history commands;
- page management is reachable and a blank document can create page two;
- one command registry drives toolbar, shortcuts, menus, and WebMCP enablement;
- every hidden compact action remains reachable, and compact drawers meet dialog/focus requirements;
- published version validation rejects relationally invalid documents;
- a clean end-to-end browser test covers create, edit, asset, page, field, review, publish, render, and undo.

## Recommended sequence

Each slice should merge and ship independently, with its own regression coverage.

1. **Restore the promise:** fix and integration-test published render jobs, error envelopes, and retry behavior.
2. **Make editor state coherent:** introduce canonical command IDs and derived capabilities; fix `V`, Select, review lock, undo/redo scope, and action feedback.
3. **Expose the actual document model:** consolidate Templates, Pages/Outputs, and Layers into one reachable desktop and compact information architecture.
4. **Make history transactional:** begin/preview/commit/cancel gestures, coalesced property edits, stable selection, and monotonic server concurrency tokens.
5. **Turn templates and assets into repositories:** template-create versus explicit apply, real previews/search/categories, and user-media list/upload/delete/retry/reuse.
6. **Harden validation and API boundaries:** strict schemas, aggregate validation, session ownership, canonical command policies, durable job state, quotas, and observability.
7. **Build production evidence:** accessible interaction tests, visual oracles, renderer parity fixtures, corrupt-storage/failure tests, and measurable bundle/runtime budgets.

## Audit map

- [Feature parity matrix](./feature-parity-matrix.md)
- [Visual and interaction audit](./visual-and-interaction-audit.md)
- [Workflow and feature audit](./workflow-and-feature-audit.md)
- [Code architecture audit](./code-architecture-audit.md)
- [Production-readiness backlog](./production-readiness-backlog.md)
- [Reference patterns](./reference-patterns.md)
- [Test evidence](./test-evidence.md)

The backlog is the implementation contract. The other documents preserve the measurements, reproductions, benchmarks, and architectural evidence behind it.
