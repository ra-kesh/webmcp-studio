# COMPONENT-01 phase entry

Date: 2026-08-30

Status: active; Gates 1 and 2 locally accepted, Gate 3 next

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
