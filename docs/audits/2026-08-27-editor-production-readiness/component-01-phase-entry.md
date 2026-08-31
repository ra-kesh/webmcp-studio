# COMPONENT-01 phase entry

Date: 2026-08-30

Status: completed; Gates 1–5 independently accepted on 2026-08-31

## Purpose

Add reusable components, instances, variants and controlled overrides without
creating a second document model or a renderer-only approximation. A Studio
component must remain a normal document structure that can be selected, saved,
copied, templated, reviewed, controlled through WebMCP, rendered, exported and
recovered through the same boundaries as ordinary content.

This phase follows `TEXT-02`. Gate 5 of `TEXT-02` is under separate code review
while this contract is prepared. No `TEXT-02` completion claim is implied here.

## Sources revisited before implementation

- `remaining-product-work-2026-08-29.md`, row `COMPONENT-01`;
- `reference-patterns.md` and `openpencil-editor-north-star.md`;
- Studio `packages/document/src/{schema,commands,semantic-clone,validation}.ts`;
- Studio page/group/layer, history, template, clipboard, render-conformance and
  WebMCP command paths;
- OpenPencil:
  - `packages/core/src/editor/components.ts`;
  - `packages/core/src/editor/components/instances.ts`;
  - `packages/scene-graph/src/instances.ts`;
  - `packages/vue/src/editor/commands/selection.ts`;
  - `src/components/DesignPanel.vue`;
  - `src/components/assets-panel/AssetsPanel.vue`;
  - `src/components/properties/component-properties/`;
  - `tests/e2e/components.spec.ts`;
- Loora:
  - `packages/canvas/src/model.ts` component, instance, resolution and cycle
    validation paths;
  - `packages/canvas/src/engine.ts` transaction boundary;
  - `packages/agent/src/canvas-tools.ts` shared human/agent operation model.

The references are behavioral and architectural evidence. No reference code is
copied into Studio.

## Reference conclusions

OpenPencil materializes instance children as real scene nodes, retains a stable
source-component mapping, synchronizes non-overridden properties and turns an
instance into ordinary content when detached. This gives its Layers, selection
and rendering paths real objects instead of a decorative preview.

Loora keeps component definitions and instances normalized, resolves variants
before instance overrides, validates override targets, and rejects recursive
component graphs. Its strongest lesson is that component behavior belongs in
the canonical model and transaction engine, not in panel callbacks.

Studio should combine those lessons with its existing flat page node/group
model. Instance descendants will be materialized as ordinary canonical Studio
nodes and groups. A normalized instance record will retain the source mapping,
selected variant and override ownership. Rendering continues to consume normal
nodes; the component resolver proves and repairs their derived state.

## Product invariants

1. **One render model.** Fabric, React previews, Renderer HTML, PNG and PDF
   continue to render canonical scene nodes. They do not each implement their
   own component expansion algorithm.
2. **Stable source identity.** Every materialized instance node and nested group
   maps to exactly one source node or group. Renames and reorder do not break
   that identity.
3. **Explicit override ownership.** An instance edit records the exact source
   node property it owns. Main-component propagation updates every other
   property and never silently discards an override.
4. **Variant before instance.** Resolution applies the selected variant patch
   to source content, then applies the instance override. Switching variants
   preserves compatible instance overrides and reports incompatible ones.
5. **Atomic commands.** Create component, create instance, update source,
   switch variant, reset override and detach instance are named document
   commands with one history entry, one revision and one save boundary.
6. **No recursive graphs.** A component may contain an instance of another
   component, but direct or transitive self-reference is rejected with a
   bounded iterative graph check.
7. **No orphan authority.** Removing a source group, variant or component is
   blocked while dependent instances exist unless the same explicit command
   detaches or removes those dependants atomically.
8. **Portable semantics.** Duplicate, clipboard, page/output duplication,
   templates and quotation style changes must declare whether they retain the
   component link or detach to ordinary content. They may not leave an instance
   record whose source is absent.
9. **Inspectable derived state.** Validation can compare a materialized instance
   with source + variant + overrides and identify the exact stale mapping or
   property. Schema decoding alone must not hide semantic drift.
10. **Review/API parity.** Human controls, menus, command search, Review and
    WebMCP use the same command and capability policy.

## Canonical model contract

The first implementation will add two normalized document resources.

### Component definition

A component owns:

- stable `id`, user-facing `name` and optional description;
- one `sourceGroupId` whose existing page-owned nodes/groups are the editable
  main component;
- a stable default variant ID;
- one or more named variants;
- per-variant patches keyed by source node ID;
- later, an explicit exposed-property list for safe text, visibility, media and
  nested-instance controls.

Variant patches use the existing typed node-patch vocabulary. A variant cannot
target a node outside the source-group subtree.

### Component instance

An instance owns:

- stable `id`, `componentId`, selected `variantId` and `rootGroupId`;
- complete source-to-instance node and group mappings;
- typed instance patches keyed by source node ID;
- override provenance needed by Review and WebMCP.

The instance root and descendants remain ordinary entries in `document.groups`
and `document.nodes`. Existing page order, Layers, selection, Fabric and render
paths therefore keep operating. Instance metadata supplies linkage and update
semantics rather than replacing the rendered content.

## Command behavior

The minimum command set is:

- `create_component` from one group or a bounded selection;
- `update_component` for name, description and default variant;
- `delete_component` with explicit dependant policy;
- `create_component_variant`, `update_component_variant`,
  `delete_component_variant`;
- `create_component_instance` on a target page/group and position;
- `switch_component_variant`;
- `update_component_instance` for controlled overrides;
- `reset_component_override` and `reset_all_component_overrides`;
- `detach_component_instance`;
- `synchronize_component_instances` as an internal deterministic repair command,
  never a silent UI-only mutation.

Direct `update_node` against a main-component descendant propagates the changed
properties to instances that do not own them. Direct `update_node` against an
instance descendant records the corresponding override in the same command.

## Required UI

- Layers distinguishes main components, component instances and ordinary
  groups without flattening their children.
- Assets/Templates exposes reusable document components separately from media.
- The Inspector shows component name, selected variant, override count, source
  navigation, reset actions and Detach.
- Selecting an instance child makes override ownership visible at the property,
  not only at the instance root.
- Main-component edits show affected instance count before destructive or broad
  propagation.
- Switching a variant previews the result and names incompatible overrides
  before commit.
- Compact layouts retain the same actions through the existing panel/menu
  projections.

## Gates

### Gate 1 — model, migration and resolver

- explicit schema-version migration;
- strict component/instance schemas;
- source-subtree and mapping validation;
- variant -> instance resolution;
- deterministic materialization and stale-instance comparison;
- iterative component-cycle rejection;
- bounded fixtures for nested groups and 1,000 instances.

### Gate 2 — commands, history and semantic clone

- canonical create/update/switch/reset/detach commands;
- direct-edit override capture and source propagation;
- atomic Undo/Redo and measured payload admission;
- duplicate/page/output/clipboard policies;
- deletion and dependant integrity.

### Gate 3 — editor interaction

- Layers icons/tree semantics and source navigation;
- Assets component browser and insertion;
- Inspector variant/override workflow;
- canvas selection, transform and detached-content behavior;
- desktop and compact real-use acceptance.

### Gate 4 — templates, Review and WebMCP

- template application and portable component resources;
- reviewed component proposals and affected-object navigation;
- read/query/capability/execute parity;
- API-safe component instance creation and controlled overrides.

### Gate 5 — conformance, scale and independent closure

- Fabric/React/Renderer/PDF parity for default, variant, overridden, nested and
  detached instances;
- migration, history, clipboard, template and persistence matrix;
- bounded propagation and selection latency at 1,000 instances;
- full create -> insert -> override -> variant -> source update -> reset ->
  detach -> publish -> render journey;
- separate code review with every P0/P1 closed before `COMPONENT-01` completes.

## Deliberate exclusions from Gate 1

Team libraries, remote package publishing, semantic slots, responsive layout,
real-time multi-user conflict resolution and arbitrary executable component
logic are not hidden inside the initial schema. The model leaves room for those
programs without claiming them now.

## Gate 1 result — model, migration and resolver

Status: **implemented and locally accepted on 2026-08-30**

- Advanced the canonical document schema to version 4 and added explicit
  `components` and `componentInstances` resources. Drafts from versions 1–3
  receive the resources through the decoder migration; immutable version-3
  publications require republishing instead of being silently reinterpreted.
- Added strict component definitions, variants, source/instance node and group
  mappings, uniform instance transforms and controlled per-source-node
  overrides.
- Added one shared resolver/materializer. It resolves source -> variant ->
  instance override, transforms the resulting ordinary scene nodes, and can
  report the exact stale materialized property.
- Added source-subtree, mapping, variant-target, instance-target and iterative
  component-cycle integrity checks to canonical document validation.
- Current producers, built-in templates and conformance fixtures now emit
  schema version 4 explicitly; older migration fixtures remain older on
  purpose.
- Acceptance evidence: all 31 document-package test files pass (284 tests),
  including migration, stale-property, invalid-target, cycle and 1,000-instance
  bounds. Every workspace package passes TypeScript checking.

Gate 1 does not claim user-facing component creation yet. Gate 2 owns canonical
commands, history, propagation/override capture, detach and semantic cloning.

## Gate 2A result — canonical lifecycle and semantic clone

Status: **implemented and locally accepted on 2026-08-30; Gate 2 remains
active**

- Added named canonical commands for component definitions, variants,
  instances, switching, controlled overrides, property/all reset, detach,
  dependent-aware deletion and deterministic repair.
- Instance creation derives ordinary page nodes/groups from complete stable
  mappings. It rejects reused IDs, invalid parents, incomplete source mappings
  and structural insertion inside an existing instance.
- Direct `update_node` edits on main-component descendants rematerialize linked
  instances. Direct edits on instance descendants record the matching source
  property override first, so later source edits preserve user intent.
- Materialization now walks nested component dependencies child-first and
  scales text size, letter spacing, rich-text run metrics, radii and strokes in
  addition to geometry.
- Complete instance selection/page duplication retains the component link with
  fresh instance/node/group identities and translated transform. Partial
  selection deliberately becomes ordinary detached content.
- Component lifecycle commands use the existing snapshot history boundary;
  create/instance Undo and Redo restore exact canonical documents.
- Current evidence: 31 document test files pass (292 tests), the focused editor
  history suite passes (23 tests), focused WebMCP proposal/change/registration
  suites pass (54 tests), and every workspace package typechecks.

Gate 2 is not closed. Gate 2B must still make style/media/variable-specific
node commands participate in exact override capture, represent removal of
optional properties such as reusable-style attachments, add explicit
structural dependant guards, and finish the remaining page/output ownership
policies. No component UI is claimed by Gate 2A.

## Gate 2B result — cross-command overrides and structural integrity

Status: **implemented and locally accepted on 2026-08-30; Gate 2 is closed**

- Added one post-command reconciliation boundary for ordinary editor commands.
  It compares only properties actually mutated on an instance with its newly
  resolved source/variant state, records the true differences, and then
  rematerializes the dependency graph.
- Reusable typography/paint application and propagation, variable binding and
  updates, field projection, image placement, image frame masks and image
  source replacement now participate in the same override contract as direct
  `update_node` edits.
- Instance metadata has a canonical rename/transform command. Uniform instance
  transforms continue to materialize exact flat-node geometry and visual
  metrics.
- Optional-property removal is explicit canonical state. Detaching reusable
  style IDs, optional strokes or image-alt provenance no longer reappears
  during synchronization; property and all-override reset clear both value
  patches and removals.
- Materialization now propagates safe main-component group names, group member
  order, nested parentage and relative page layer order. Unsupported structural
  changes to a linked source or instance are blocked with explicit guidance.
- Component validation now detects stale group names, hierarchy, group members
  and relative page layer order in addition to stale node properties.
- Acceptance evidence: all 31 document test files pass (297 tests), including
  style detach, variables, image controls, metadata transforms, safe source
  order/name propagation and structural guard cases. Every workspace package,
  including Studio, typechecks.

Gate 2 closure means the canonical lifecycle/history/clone boundary is ready
for product controls. It does not claim that Layers, Assets or Inspector expose
components yet; those are Gate 3.

## Gate 3A result — Layers component semantics

Status: **implemented and locally accepted on 2026-08-30; Gate 3 remains
active**

- Revisited the Gate 3 contract and OpenPencil's actual Layer/Design/Assets
  component surfaces before editing. The implementation follows its semantic
  distinction between main components and instances without copying its code
  or flattening Studio's existing group tree.
- The shared Layers projection now identifies a main-component root, an
  instance root, their descendants, the owning component/instance, source
  node/group mapping, and exact value/removal overrides using indexed lookup.
- Studio renders dedicated main-component and instance icons, component color,
  accessible role descriptions and an override marker while preserving the
  existing virtualized tree, selection, hierarchy, rename, visibility and lock
  behavior.
- Focused evidence: the Layers suite passes 11 tests including root/child and
  override ownership, and both Editor and Studio typecheck.

Gate 3A is projection only. Assets insertion, Inspector variant/reset/detach,
source navigation, canvas behavior and compact acceptance remain Gate 3 work.

## Gate 3B result — component Assets and insertion

Status: **implemented and locally accepted on 2026-08-30; Gate 3 remains
active**

- Added a first-class Assets tab to the shared desktop/compact document panel.
  It is deliberately separate from the image/media picker, matching the
  OpenPencil distinction between reusable components and uploaded media.
- Components are searchable and grouped by source page. Each item uses a live
  render of the actual source subtree, reports variant and instance counts,
  inserts on click/keyboard, and exposes Go to main component.
- Selection-to-component and component-to-instance actions now cross the same
  canonical command/history boundary as every other editor mutation. Ungrouped
  multi-selection is grouped atomically; a lone ungrouped layer is rejected
  with explicit guidance instead of inventing a hidden wrapper.
- Instances are inserted at the visible canvas centre, mapped with fresh stable
  node/group identities, selected after creation and fully Undo/Redo-able.
- Focused projection tests pass, and Studio typechecks. Gate 3C now owns the
  component-aware Inspector and its variant/reset/detach/source controls.

## Gate 3C result — component-aware Inspector

Status: **implemented and locally accepted on 2026-08-30; Gate 3 remains
active**

- Revisited OpenPencil's component-first Inspector ordering before editing.
  Component identity and lifecycle controls now precede ordinary geometry and
  style controls instead of being mixed into layer naming.
- Selecting a main component exposes its independent component name, linked
  instance count and default variant. Selecting an instance or one of its
  mapped children exposes the active variant, aggregate overrides, exact
  selected-layer override properties, property/all reset, source navigation
  and detach.
- The projection resolves root-group selection as well as mapped child-node
  selection, so Studio does not depend on a single selected Fabric node to
  identify an instance.
- The same controls are wired through the shared Inspector used by desktop and
  compact layouts and invoke canonical component commands/history.
- Focused projection tests cover source usage, root-instance aggregate
  overrides and exact child overrides. Studio typechecks.
- Clean live-browser acceptance on port 3001 selected a real instance from the
  Layers tree, verified Variant/Main component/Reset all/Detach, navigated to
  its source, and verified source name/default variant/linked usage. No runtime
  errors were recorded.

Gate 3D/3E still own canvas direct-manipulation semantics and compact real-use
acceptance. Gate 3 is not closed yet.

## Gate 3D result — component canvas semantics

Status: **implemented and locally accepted on 2026-08-30; Gate 3 remains
active**

- Revisited OpenPencil's container hit-testing, entered-container and root
  transform behavior plus Studio's Fabric selection/transform boundary before
  implementation.
- Ordinary canvas clicks now select the complete main-component or instance
  root. Explicit double-click supplies the child drill-in intent, preserving
  existing text-edit and image-crop routing instead of making every second
  single click ambiguous.
- Uniform move/scale/rotate changes for a complete instance are projected back
  to one canonical `update_component_instance_metadata` command. They no
  longer create geometry overrides on every materialized child.
- Root transforms rebase transform-sensitive instance-owned geometry, text-run
  metrics, radii and strokes before rematerialization. Existing overrides keep
  their visual relationship while source-linked properties continue to flow
  from the component.
- The live acceptance caught and closed an identity-transform bug where a
  whole-instance non-geometry edit such as Unlock could be mistaken for a root
  transform. The projector now requires a real non-identity geometry change.
- Focused document, canvas-projection and Fabric double-click tests pass, and
  Document, Editor and Studio typecheck. Live port-3001 acceptance preserved a
  9-layer root selection through drag, kept the override count stable, saved,
  Undo restored the move, Reset all restored the lock state, and no runtime
  errors were recorded.

Gate 3E compact real-use acceptance remains before Gate 3 closes.

## Gate 3E result — compact real-use acceptance

Status: **accepted on 2026-08-30; Gate 3 complete**

- Revisited the retained compact-layout contract and both shared
  `QuotationSidebar` and `InspectorSidebar` mounts before acceptance.
- At an 820 × 900 viewport, the compact Document sheet exposes the Components
  Assets surface, searchable component preview, insertion action and source
  navigation without substituting the image/media library.
- Compact Layers preserves both the main-component and instance roots as
  expandable trees with their semantic identities and ordinary child layers.
- Selecting the real 9-layer instance from compact Layers opens the compact
  Inspector with variant, source navigation, override count, Reset all and
  Detach controls before ordinary geometry. Source navigation returns to the
  real main component and exposes its name, default variant and linked usage.
- The acceptance used the running port-3001 application and the existing saved
  document without clearing browser storage or mutating the fixture.

Gate 3 is closed. Gate 4 now owns template portability, Review and WebMCP/API
parity.

## Gate 4A result — portable template component resources

Status: **implemented and locally accepted on 2026-08-30; Gate 4 remains
active**

- Revisited the template materialization boundary before implementation. Fresh
  document starters previously re-keyed pages, groups and layers while leaving
  component definitions and instances attached to their canonical template
  identities.
- Fresh template materialization now re-keys component definitions, variants
  and instances together with source/instance groups and layers. Variant
  patches, instance overrides, removed-property ownership, node/group mappings,
  root groups and active/default variants all point at the cloned graph.
- Node-targeted variable bindings are also re-keyed at this boundary instead of
  retaining template-layer identities.
- Template replacement review now reports component and instance count changes
  alongside pages, objects, groups, fields, bindings and assets.
- Focused document and Studio projection tests pass, including validation of a
  real component-bearing fresh template clone.

Gate 4B/4C still own Review affected-object navigation and WebMCP/API command
parity.

## Gate 4B result — component-aware Review

Status: **implemented and locally accepted on 2026-08-30; Gate 4 remains
active**

- Audited the persisted Review journal, affected-target projection and shell
  navigation before implementation. Component commands previously produced no
  affected targets even when a source edit propagated to linked instances.
- Review targets now represent main components and component instances as
  explicit, persisted object kinds with their names and page ownership.
- Source/variant updates and component deletion name the reusable component and
  every linked instance. Instance variant/override/reset/detach operations name
  the controlling component and exact instance, and layer-specific overrides
  also name the mapped instance layer.
- Affected-object navigation focuses the complete component source or instance
  root in the preview document. Generic group review navigation now also keeps
  the full group selection instead of choosing an arbitrary first child.
- Focused Review journal/operation tests pass and Studio typechecks.

## Gate 4C result — WebMCP/API component parity

Status: **implemented and locally accepted on 2026-08-30; Gate 4 complete**

- Revisited Loora's shared human/agent transaction boundary and Studio's
  existing style/variable WebMCP tools before implementation.
- `read_design_components` exposes component definitions, variants, instances,
  source/instance mappings, override-property names and exact supported actions
  without returning private override values or image source URLs.
- `propose_component_changes` supports reviewed instance creation, variant
  switching, metadata/transform changes, source-layer-controlled overrides,
  selective/all reset and detach against an exact document snapshot.
- Component creation maps the complete canonical source subtree to fresh node,
  group and instance identities. Override input is checked against the mapped
  source layer and the existing type-safe canvas patch contract.
- Agent operations compile to the same canonical component commands used by
  the editor and remain non-destructive until accepted in Review. Public
  proposal responses retain command type and impact while private patch values
  stay inside the reviewed proposal.
- The Review tool inventory now derives from the canonical WebMCP catalog
  instead of a stale handwritten subset.
- Focused query, proposal and registration coverage passes 59/59; WebMCP and
  Studio typechecks pass under Node 22.

Gate 4 is closed. Gate 5 now owns component renderer/PDF conformance, scale,
persistence, the complete user journey and independent closure.

## Gate 5A result — browser draft persistence matrix

Status: **implemented and locally accepted on 2026-08-30; Gate 5 remains
active**

- Revisited the Gate 5 persistence contract and Studio's atomic browser draft
  boundary before editing.
- Added a validated schema-v4 document carrying a main component, two variants,
  a nested instance mapping and a real instance text override.
- Atomic write and bootstrap now have focused evidence that the complete
  component graph returns with its identities, variant choice, mappings and
  override ownership intact.
- The same focused run exposed a stale pre-component migration expectation;
  the legacy draft assertion now correctly requires migration through schema
  version 4 rather than stopping at version 3.
- Focused draft tests pass 34/34 and Studio typecheck passes.

Gate 5 conformance, full-journey and independent-review work remains active.

## Gate 5B result — canonical create-to-publication journey

Status: **implemented and locally accepted on 2026-08-30; Gate 5 remains
active**

- Revisited OpenPencil's create/instance/propagate/detach journey and Loora's
  shared transaction/export boundary before writing the acceptance case.
- One focused journey now creates a main component and variant set, inserts a
  mapped nested instance, captures a child override, switches variant, updates
  the source while preserving the override, resets ownership, detaches to
  ordinary content and publishes an immutable schema-v4 version.
- The published snapshot retains the detached rendered nodes and main
  component while correctly removing the instance relationship.
- The focused journey passes and the Document package typechecks.

Renderer/PDF parity, the final combined user journey and independent review
remain active.

## Gate 5C result — renderer parity, scale and independent closure

Status: **completed and independently accepted on 2026-08-31**

- Added retained default, variant, overridden, reset, detached and complete component-journey conformance across Fabric, React, Renderer HTML, real PNG and rasterized PDF.
- The canonical full journey now asserts the materialized reset state before detach and the same state after immutable publication; it cannot pass by checking metadata alone.
- Fresh component capture `2026-08-30T20-24-01.428Z-ffdf6a4f-3f2d-43a0-bc6b-4dea01935749` and component-journey capture `2026-08-30T20-24-34.290Z-13d3a12d-6e8a-4df5-9c8c-59d1f4855f95` pass their PNG/PDF comparisons with zero page errors.
- Component indexing, reconciliation, migration, semantic clone, history, template portability, persistence and the public 1,000-instance `applyCommand` benchmark are retained in focused coverage.
- The final independent review found no remaining P0/P1 issue and explicitly approved COMPONENT-01 Gate 5 closure. Integrated evidence passed Document 314/314, Editor 327/327, Render View 16/16, Renderer 70/70 and focused Studio 71/71.

COMPONENT-01 is closed. Team/remote libraries and the broader catalog experience remain owned by LIBRARY-02 rather than being hidden inside this phase.

## Gate 5 current-HEAD revalidation entry

Status: **completed on 2026-08-31; current checked-in HEAD revalidated**

- Started from checked-in commit `9faade81` in the isolated
  `codex/component-gate-5` worktree. The dirty main checkout is not part of
  this review.
- Re-read this gate, the retained production-readiness and conformance audits,
  OpenPencil's component creation, materialized instance, synchronization and
  detach paths, and Loora's component resolver, validation, transaction,
  history and agent-operation boundaries.
- Confirmed that commit `a116d03` already supplied the Gate 5 implementation
  and accepted closure. The authoritative continuation ledger did not receive
  the matching COMPONENT-01 update and still describes Gates 1 through 4 as
  current.
- This revalidation will check the retained component and complete-journey
  pixel reports, the create-to-publication journey, renderer projections,
  browser persistence, history, clone/template behavior and both 1,000-instance
  bounds against the current checked-in code.
- General masks and schema-v5 work are excluded. No live server will run on
  port 3000.

## Gate 5 current-HEAD revalidation result

- Fresh component run
  `2026-08-31T10-10-15.177Z-62370e02-7cfc-46dc-8836-1c085963e47a`
  and complete-journey run
  `2026-08-31T10-10-58.646Z-9e91e255-6f73-4d53-b369-56e89ce35b72`
  completed through an isolated local Studio on port 3015. Both reports retain
  Chrome runtime identity, report-bound byte counts and SHA-256 hashes, exact
  dimensions and zero browser page errors.
- All three component comparisons pass. The largest changed-pixel ratio is
  0.4864 percent and the largest RGBA RMSE is 4.0191, below the retained 1.5
  percent and 6.0 limits.
- All six complete-journey source and detached-instance comparisons pass. The
  largest changed-pixel ratio is 0.4367 percent and the largest RGBA RMSE is
  4.8532 under the same limits. The five-page proposal PDF keeps canonical
  order and dimensions.
- The focused matrix passes 93 Document tests, 120 Editor tests, 16 Render View
  tests, 63 Renderer tests and 51 Studio tests. Document, Editor, Render View,
  Renderer and Studio typechecks pass. The matrix includes migration, history,
  component-aware semantic clone and clipboard behavior, template portability,
  browser persistence, Inspector and Review projections, the canonical
  create-to-publication journey, and the 1,000-instance propagation and
  selection bounds.
- Revalidation found one stale Studio Inspector fixture that applied `fill` to
  a text node. The canonical text property is `color`; commit `d5d54ac` repairs
  the fixture and its expected override names. No production path changed.
- The report-bound pixel verifier is separate from the capture runner and
  rejects missing, resized or hash-mismatched input before comparison. Its
  fresh pass, plus the retained independent closure review in
  `text-02-gate5-independent-review.md`, leaves no open Component Gate 5 P0 or
  P1 finding.

COMPONENT-01 remains closed. No mask or schema-v5 code was changed, no process
used port 3000, and the continuation ledger now matches the accepted phase
state.
