# ASSET-02 general masks phase entry

Date: 2026-08-31
Status: Gate M0 accepted; Gate M1 implementation next
Scope: local, non-destructive masks and clipping
Out of scope: background-removal services and generated replacement assets

## Decision

The accepted image foundation does not need to be replaced. Image placement, crop, frame masks, managed source identity, replacement, and renderer admission are already distinct and useful product capabilities.

General masks are a different feature. They combine several layers into one rendered result and therefore belong to page structure and paint order. They must not be encoded as another `ImageNode.frameMask` variant, a Fabric `clipPath`, a private canvas property, or an opaque URL.

The recommended model is an explicit semantic mask group. A mask group owns an ordered, contiguous set of layers, identifies which direct members are mask sources, and defines how those sources affect the remaining content. The document owns that relation. The editor, both renderers, export, review, API, and WebMCP consume the same projected paint plan.

Implementation should start only after a renderer feasibility gate proves the same vector result in the interactive canvas and deterministic renderers. The current flat render loops cannot support general masks safely without that shared projection.

## Current accepted truth

### Image-local operations

The current schema is version 4. An image node owns:

- placement mode: `fill`, `fit`, or `manual`
- focal position, zoom, rotation, and flips
- a frame-local mask: rectangle, rounded rectangle, or ellipse
- canonical asset identity and accessibility metadata

The document exposes typed `set_image_placement`, `set_image_frame_mask`, and `replace_image_source` commands. Replacement rejects source-bound layers. The editor keeps crop gestures ephemeral and commits one final command. The React render view and renderer HTML use the same image projection concepts for placement and frame clipping. WebMCP proposes the same typed operations.

Relevant files:

- `packages/document/src/schema.ts`
- `packages/document/src/commands.ts`
- `packages/document/src/render-projection.ts`
- `packages/editor/src/image-crop-session.ts`
- `packages/editor/src/image-crop-frame-resize.ts`
- `packages/editor/src/fabric-adapter.ts`
- `packages/editor/src/commands.ts`
- `packages/render-view/src/index.tsx`
- `apps/renderer/src/html.ts`
- `packages/webmcp/src/registration.ts`
- `packages/webmcp/src/change-sets.ts`
- `packages/webmcp/src/product-command-proposals.ts`

These operations remain the preferred path for cropping an image into a simple shape. General masks must not reopen or weaken them.

### Groups and paint order

`GroupDefinition` is currently organizational. It contains an ID, page ID, name, direct node IDs, and an optional parent group ID. It has no rendering semantics.

`page.nodeIds` remains the canonical flat paint order. Validation requires each group's descendants to occupy one contiguous block in that order, and a layer can be a direct member of at most one group. The layer tree presents the hierarchy, but the Fabric adapter, React render view, and renderer HTML still paint nodes independently from the flat page order.

This gives us a useful structural base, but not a compositor. Changing a group's meaning without changing the page paint projection would produce an editor-only illusion.

### Clone, components, templates, and publication

Semantic fragment capture and clone already preserve complete groups and remap node, group, binding, variable-binding, and component-instance IDs. A mask relation added to a group must participate in the same mapping. It cannot retain source IDs from the original document.

Component definitions and instances also map groups. A structural mask cannot become a silent instance override. Published template versions are immutable and reject in-place migration. Any schema change must preserve that rule.

Relevant files:

- `packages/document/src/groups.ts`
- `packages/document/src/validation.ts`
- `packages/document/src/semantic-clone.ts`
- `packages/document/src/components.ts`
- `packages/document/src/document-decoder.ts`
- `packages/document/src/publishing.ts`

## Exact missing capabilities

The accepted crop foundation does not provide:

1. a layer or group that clips arbitrary sibling content
2. alpha masks derived from rendered layer transparency
3. luminance masks derived from rendered layer brightness and alpha
4. multiple mask sources contributing to one composite
5. nested mask composites
6. deterministic selection and hit testing through a composite
7. shared compositing across Fabric, React preview, server PNG, PDF, thumbnails, and publication
8. typed structural mask commands with exact undo and review effects
9. component, duplicate, clipboard, template, and semantic-clone preservation of mask relations
10. WebMCP inspection and proposal tools for public mask semantics
11. resource and memory admission for large offscreen composites
12. visible failure and recovery when a mask source cannot render

The remaining product plan correctly treats these as general masks, separate from the finished image frame work.

## Reference findings

### OpenPencil

The OpenPencil repository was inspected directly at phase entry from a read-only temporary clone. It provides the strongest implementation pattern for mask semantics:

- `packages/scene-graph/src/types.ts` gives nodes an explicit mask role and `ALPHA`, `VECTOR`, or `LUMINANCE` type.
- `packages/core/src/canvas/masks.ts` scans ordered children, renders content into a bounded offscreen layer, and combines mask sources using destination-in compositing. Luminance uses a luma filter.
- `packages/core/src/canvas/scene.ts` invokes the mask renderer as part of the normal scene paint path.
- `packages/vue/src/controls/mask/use.ts` and `packages/vue/src/editor/commands/selection.ts` route UI changes through one named command and one undo step.
- `tests/engine/render/canvas/masks.test.ts` proves that a visible mask clips the following content, consecutive visible mask nodes combine, luminance installs a luma filter, bounded layers receive an explicit rectangle, and mask nodes do not paint as ordinary layers.
- unsupported editable export targets rasterize a mask-containing result rather than emitting a structurally incorrect file.

Useful lessons:

- mask meaning depends on ordered structure, not on a style sidebar alone
- offscreen compositing must use the bounded union of contributing source and content bounds
- mask type is canonical data
- the UI and shortcuts invoke the same product command
- visual conformance is part of feature acceptance

OpenPencil's exact paint implementation renders content into a saved layer, changes the effect paint to destination-in, renders the mask sources, and resets the shared paint in a `finally` block. A luminance source is rendered through a luma color filter before destination-in. Hidden mask nodes are not treated as active masks. This is useful renderer evidence, but not Studio's canonical relation model.

We should not copy OpenPencil's adjacency-only relation. In Studio, ordinary reordering must not silently change which layer is the mask. Our documents are also externally controlled and must explain their semantics through API and WebMCP.

Inspected source: `https://github.com/open-pencil/open-pencil`.

### Loora

Loora does not supply a general mask implementation. Its repository was also inspected directly from a read-only temporary clone and remains relevant to the transaction boundary:

- `packages/canvas/src/model.ts` uses normalized structural identities.
- `packages/canvas/src/engine.ts` rejects unknown transaction and operation fields, validates finite serializable operations, applies multi-operation transactions atomically, constructs exact inverses, treats repeated transaction IDs as idempotent, and coalesces compatible history entries within a bounded window.
- `packages/agent/src/canvas-tools.ts` compiles agent changes into the same operations used by the human editor.

The lesson is one typed transaction for create, release, and reconfigure mask operations. Neither the inspector nor WebMCP should assemble partial group and reorder mutations independently.

Inspected source: `https://github.com/lassejlv/loora`.

### Polotno and Canva notes

The checked-in Polotno documentation exposes image crop state and SVG `maskSrc`. Its Pexels example recalculates crop when replacing an image and can assign an SVG URL as a mask. This is useful for simple template UX, but an opaque mask URL is insufficient for Studio's canonical, inspectable, and deterministic contract.

The audited Canva-clone background-removal flow reads a private Fabric image element URL, sends it to an external service, and inserts the returned URL. That is specifically not a local mask architecture and must not be reused.

Reference root:

`outputs/reference-repos/engines-and-rendering/polotno-site`

## Canonical document model

### Separate frame masks from general masks

`ImageNode.frameMask` remains image-local. It answers: "What shape is this image frame?"

A semantic mask group answers: "Which rendered layers define the visible region of these other layers?"

The two features may coexist. An image can have its own crop and frame mask while also being content or a source inside a semantic mask group.

### Proposed schema

Use a discriminated group role in schema version 5:

```ts
type GroupDefinition =
  | {
      role: "organize"
      id: string
      pageId: string
      name: string
      nodeIds: string[]
      parentGroupId?: string
    }
  | {
      role: "mask"
      id: string
      pageId: string
      name: string
      nodeIds: string[]
      parentGroupId?: string
      mask: {
        type: "vector" | "alpha" | "luminance"
        sourceNodeIds: [string, ...string[]]
      }
    }
```

All descendants not named as mask sources are masked content. In the first implementation, every mask source must be a direct member of its mask group. This keeps validation and movement predictable while leaving room for nested compositing later.

An explicit `sourceNodeIds` relation is preferred over adjacency. Reordering content within the group does not change mask identity. The effect is reviewable, serializable, and safe for external commands.

### Required invariants

A valid mask group must satisfy all of these rules:

1. every source exists on the group's page
2. every source is a direct member of that group
3. source IDs are unique
4. the group contains at least one non-source descendant
5. a node cannot be both source and content in the same group
6. the existing contiguous page-stack invariant still holds
7. a source cannot be source-bound in a way that structural mutation would break
8. component-instance structure cannot be changed outside its source component
9. configured nesting depth and composite count limits are enforced
10. deletion, ungrouping, reparenting, and page movement cannot leave an invalid relation

Version 4 documents migrate by explicitly assigning `role: "organize"` to every existing group. Do not use a permissive schema default for the new role. A missing role must be distinguishable from an intentional organizational group. Published versions continue to require republication under a new immutable version identity.

### Paint semantics

The mask group occupies its existing contiguous block in `page.nodeIds`. Within that block:

- content paints in canonical page order
- source layers contribute to the mask and do not paint independently
- vector mode uses source geometry coverage
- alpha mode uses rendered source alpha
- luminance mode uses rendered luminance multiplied by alpha
- group opacity and later effects apply to the completed composite, not to each source independently

For the initial vertical slice, vector sources should be limited to geometry with deterministic path coverage, such as rectangle, ellipse, and icon layers. Image and text sources require the alpha readiness gate. Calling an image a vector mask would be misleading.

Hidden mask behavior must be explicit. The proposed rule follows the inspected OpenPencil behavior: only visible sources contribute; if no source is visible, content renders unmasked. Hiding the only source therefore disables the mask without destroying the relation. This rule must be fixed in schema tests and pixel tests before UI work begins.

Source opacity is part of the source's rendered mask contribution. For vector and alpha masks, effective source alpha is geometry coverage multiplied by the source's effective opacity. For luminance masks, contribution is rendered luminance multiplied by effective alpha. Content opacity is evaluated while painting content; mask-group opacity and group-level effects, when introduced, apply once to the completed composite.

### Structural failure rules

Mask relations cannot be repaired implicitly by unrelated generic commands:

- deleting, ungrouping, reparenting, or moving a source out of its group is rejected unless the same typed transaction changes or releases the mask relation
- deleting content is rejected when it would leave the mask group without content
- ordinary reordering within the group's contiguous page block does not change the explicit source relation
- crossing the mask-group boundary requires a structural group command that proves the relation remains valid
- removing a mask source through component materialization, duplicate, clipboard, or template application is invalid unless every remapped relation remains valid
- a failed transaction changes no document state, creates no history entry, and produces one stable error code with the affected group and node identities

## Shared page paint projection

The P0 architectural gap is the absence of a page-level compositor. Add one shared document projection before adding production UI.

Conceptually:

```ts
type PagePaintPlanEntry =
  | { kind: "node"; nodeId: string }
  | {
      kind: "mask_group"
      groupId: string
      maskType: "vector" | "alpha" | "luminance"
      sourceNodeIds: string[]
      content: PagePaintPlanEntry[]
      bounds: Rect
    }
```

The projection owns ordering, source/content partitioning, nested plans, and conservative union bounds. It does not own loaded bitmaps, Fabric objects, DOM nodes, or provider URLs.

Consumers:

- Fabric translates the plan into interactive objects and bounded composites.
- React preview renders the plan through shared mask markup or a shared canvas compositor.
- renderer HTML uses the same plan and readiness barriers.
- thumbnails, publication, PNG, and PDF consume those renderer paths.
- selection geometry and hit testing consult the same structural relation.

Do not implement separate mask ordering rules in `fabric-adapter.ts`, `render-view`, and renderer HTML.

## Command and history boundary

Introduce typed product commands rather than exposing generic group patches:

- `create_mask_group`
- `set_mask_type`
- `set_mask_sources`
- `release_mask_group`

`create_mask_group` may need to create a group, move or reparent layers, preserve their page order, and assign sources. Those mutations are one validated transaction and one history step. `release_mask_group` is the inverse structural operation, not a series of UI calls.

Each command requires exact document revision, page identity, group identity, node identities, lock state, and component-structure preconditions. A semantic no-op creates no history entry and no usage receipt.

The same command compiler serves:

- context menu
- application menu and shortcut
- inspector
- command palette
- API proposal
- WebMCP proposal

Undo must restore exact group nesting, page order, source identities, and selection-relevant structure.

The command envelope follows the inspected Loora transaction discipline: unknown fields are rejected, payloads must be finite and serializable, every structural command carries one transaction identity, and replaying an already-applied identity is an idempotent no-op. A command that needs several group and page-order mutations either applies all of them or none of them.

## Editor boundary

The editor should expose capabilities with truthful disabled reasons:

- `canCreateMask`
- `canReleaseMask`
- `canSetMaskType`
- `canSetMaskSources`

Common rejection reasons include incompatible selection, locked layer, review mode, component-instance structure, missing image readiness, mixed pages, and unsupported nesting.

The layer tree needs explicit visual semantics. A mask group should be labeled as a mask, mask sources should have a badge, and the content relation must remain understandable when the group is expanded. The tree cannot rely on the source's physical adjacency to explain the relation.

Canvas selection needs a defined path to both the visible result and the source layer. Normal clicks select the rendered content result. The layer tree, Enter/deep-select, or a modifier can reach the source. Selection bounds and resize handles must not accidentally use an unclipped offscreen source extent.

Fabric `clipPath` state is adapter-owned. It may be used as an implementation detail for a proven subset, but it is never serialized as document truth. More complex alpha and luminance masks will likely require a bounded composite rather than one Fabric clip path.

## Render and export boundary

Before schema or UI implementation, build a test-only renderer oracle for one rectangle source and one content layer. Prove matching results in:

- Fabric canvas
- React render view
- renderer HTML
- PNG at 1x and 2x
- PDF

Then expand the oracle to rotation, opacity, off-page bounds, hidden source, and image decode failure.

Gate M0 uses the existing conformance corpus and harness rather than creating a parallel renderer test system:

- document oracle: `packages/document/test/render-conformance.test.ts`
- React consumer: `packages/render-view/test/conformance.test.ts`
- deterministic HTML/PNG/PDF structure: `apps/renderer/test/html.test.ts`
- Fabric consumer: `packages/editor/test/fabric-adapter.test.ts`
- retained browser comparison: `apps/studio/src/routes/render-conformance.tsx`

The first retained mask scene is intentionally bounded: one rectangle source, one content layer, vector mode, visible and hidden-source states, 1x and 2x projection, and one serialized browser capture. PNG and PDF share the renderer HTML source and therefore receive structure assertions plus one endpoint smoke each; the gate does not create a redundant full artifact corpus.

The compositor must define and enforce:

- maximum composite pixel area
- maximum mask sources per group
- maximum masked descendants per group
- maximum mask nesting depth
- bounded offscreen union calculation
- device-scale behavior
- alpha and color-space behavior for luminance
- resource decode and font readiness
- node-specific failure reporting
- cancellation and timeout behavior in the server renderer

Initial production admission for Gate M2 is deliberately narrower than the final model: one direct vector source, no nested mask group, a maximum of 512 masked descendants, maximum bounded composite dimension of 8192 pixels, and maximum bounded composite area of 16,777,216 device pixels. Gate M0 records actual retained fixture dimensions and rejects rather than allocates when a test exceeds these limits. Later gates may raise the source count or nesting depth only with measured browser and renderer evidence.

If a future editable export target cannot represent a mask, rasterize only the affected mask group and record that fallback. Do not silently drop the mask or rasterize the entire document.

## WebMCP and API boundary

Public inspection should expose:

- mask group ID and name
- mask type
- source layer IDs
- content layer IDs
- visibility and lock state
- supported operation capabilities and disabled reasons

It must not expose private asset URLs, Fabric objects, decoded image elements, or offscreen buffer details.

WebMCP proposals compile to the same typed product commands as the UI. Proposals validate the current document revision, page, source identities, group membership, lock state, component restrictions, and renderer capability. Review details name every layer whose grouping or visible output changes.

Raw adjacency mutations and generic Fabric property patches are not an acceptable API.

## Background removal is a separate track

Background removal changes image pixels. It is not a local mask type.

A future background-removal flow should:

1. submit a canonical managed asset identity to an authorized asynchronous service
2. create a new immutable managed asset containing transparent pixels
3. preserve provenance from input asset, model or provider version, and job identity
4. enforce consent, privacy, quotas, cost, cancellation, retry, and idempotency
5. apply the result through the accepted renderer-acknowledged image replacement command

It must not write `ImageNode.frameMask`, create a semantic mask group, depend on Fabric private image elements, or retain a temporary provider URL as document truth.

This service work can proceed as its own later phase after the media-action foundation. Its acceptance does not block local vector masks, and local masks do not satisfy background removal.

## Safe implementation gates

### Gate M0: semantics and renderer feasibility

- freeze the group relation and hidden-source rule
- build a test-only paint plan and oracle
- prove vector compositing across Fabric, React, HTML, PNG, and PDF
- choose bounded composite primitives from evidence
- record resource and pixel limits

Exit: the same hard-coded scene produces matching pixels and failure behavior. No production schema or user-facing control ships before this gate.

### Gate M1: schema, migration, and projection

- add schema version 5 with explicit group roles
- migrate every version 4 group to `organize`
- add strict mask relation validation
- add the shared page paint plan
- update semantic clone, components, clipboard, duplicate, templates, and publication decoding

Exit: structural tests, migration identity tests, and clone/component tests pass without changing version 4 rendered output.

### Gate M2: vector mask vertical slice

- support one direct vector source and one or more content layers
- implement typed create, release, and type commands
- implement exact undo and no-op behavior
- render through all accepted paths
- add layer-tree semantics, selection, inspector, menu, and shortcut
- reject nesting and unsupported sources truthfully

Exit: a user can create, edit, undo, release, duplicate, save, reload, publish, and export a vector mask with matching output.

### Gate M3: alpha masks

- admit image and text sources only after readiness is deterministic
- render alpha consistently across browser and server
- test image decode, font readiness, crop, frame mask, opacity, and source failure
- enforce memory and pixel admission

Exit: alpha output and errors conform across editor, PNG, PDF, thumbnails, and publication.

### Gate M4: luminance, multiple sources, and nesting

- define union behavior for multiple mask sources
- add luminance color-space rules
- support bounded nested paint plans
- complete component, variant, instance, clipboard, and template behavior

Exit: nested and multi-source cases have strict limits, exact undo, deterministic cloning, and pixel conformance.

### Gate M5: API, WebMCP, and product polish

- add public inspection and proposal tools
- use shared product commands and review effects
- finish keyboard, focus, 200% zoom, 320px width, and touch alternatives
- add performance fixtures and browser journeys
- complete an independent code and browser review

Exit: every surface uses one command boundary, and no surface can create document state the renderers do not understand.

## File-level implementation map

### Document and domain

- `packages/document/src/schema.ts`
- `packages/document/src/document-decoder.ts`
- `packages/document/src/validation.ts`
- `packages/document/src/groups.ts`
- `packages/document/src/commands.ts`
- `packages/document/src/render-projection.ts` or a new `page-paint-plan.ts`
- `packages/document/src/semantic-clone.ts`
- `packages/document/src/components.ts`
- `packages/document/src/publishing.ts`

Primary tests:

- `packages/document/src/image-schema.test.ts`
- `packages/document/src/image-projection.test.ts`
- new mask schema and paint-plan tests
- `packages/document/src/semantic-clone.test.ts`
- `packages/document/src/components.test.ts`
- `packages/document/src/component-full-journey.test.ts`
- `packages/document/src/render-conformance.test.ts`

### Editor package

- `packages/editor/src/commands.ts`
- `packages/editor/src/product-commands.ts`
- `packages/editor/src/layer-tree.ts`
- `packages/editor/src/fabric-adapter.ts`
- inspector capability and selection helpers

Primary tests:

- `packages/editor/src/layer-tree.test.ts`
- `packages/editor/src/fabric-adapter.test.ts`
- product-command tests
- history and interaction-session tests

### Studio UI

- `apps/studio/src/features/editor/layer-tree.tsx`
- `apps/studio/src/features/editor/inspector-sidebar.tsx`
- a selected-mask toolbar or the existing contextual toolbar boundary
- `apps/studio/src/features/editor/use-document-editor.ts`
- `apps/studio/src/features/editor/review-operation-details.ts`
- `apps/studio/src/features/studio-shell.tsx`

Primary tests:

- mounted layer-tree and inspector tests
- command routing and one-history-step tests
- focus, close, Escape, and document-switch tests
- browser journeys for create, reorder, deep-select, undo, reload, and export

### Render paths

- `packages/render-view/src/index.tsx`
- `apps/renderer/src/html.ts`
- render-view tests
- `apps/renderer/src/html.test.ts`
- `apps/renderer/src/index.test.ts`
- conformance fixtures and pixel artifacts

### WebMCP and review

- `packages/webmcp/src/registration.ts`
- `packages/webmcp/src/change-sets.ts`
- `packages/webmcp/src/product-command-proposals.ts`
- `packages/webmcp/src/design-queries.ts`

Primary tests:

- `packages/webmcp/src/registration.test.ts`
- `packages/webmcp/src/change-sets.test.ts`
- `packages/webmcp/src/product-command-proposals.test.ts`
- `packages/webmcp/src/design-queries.test.ts`

## Required test matrix

### Domain and migration

- reject missing, duplicate, cross-page, or indirect source IDs
- reject a mask group with no content
- reject deletion, ungrouping, reparenting, or page movement that orphans the relation
- preserve contiguous paint order
- detect cycles and nesting-limit violations
- migrate version 4 groups to explicit organizational groups without visual change
- preserve immutable published versions

### Transactions and history

- create and release are each one command and one undo step
- undo restores exact page order, parent groups, and source IDs
- semantic no-ops create no history or usage
- component-instance structural guards cannot be bypassed
- simultaneous or stale proposals fail exact preconditions

### Clone and reuse

- duplicate and clipboard remap every mask source ID
- semantic clone never retains an original source identity
- component creation and instantiation preserve valid relations
- variants and allowed overrides cannot corrupt structural semantics
- templates and publication reload the same result

### Visual conformance

- rectangle, ellipse, icon, and rotated vector source
- source and content opacity
- crop and frame-masked image used as masked content
- hidden and locked source
- off-page and negative coordinates
- multiple sources and nesting when those gates open
- alpha image decode failure and text font failure
- 1x and 2x PNG, PDF, thumbnails, and published output

### Interaction and accessibility

- visible-result selection and explicit source deep-selection
- layer-tree badges and expansion
- keyboard create, release, and type change
- exact disabled reason for every rejected selection
- Escape and document switch cancel pending interaction without partial state
- usable at 200% browser zoom and 320 CSS pixels

### Admission and performance

- maximum composite area and nesting limits
- many small masks without unbounded offscreen allocation
- large transparent source bounds
- server timeout and cancellation
- 100-page documents and representative layer counts

## Phase-entry blockers

There are two P0 blockers before production implementation:

1. no shared page paint plan currently replaces the flat node loops
2. no cross-renderer oracle proves general compositing, readiness, and failure behavior

There are four P1 decisions that must be frozen during Gate M0:

1. exact geometry eligible for the first vector-source slice
2. hidden-source behavior
3. bounds, pixel, source-count, and nesting limits
4. selection and deep-selection behavior for source versus visible result

None of these blockers require changing the accepted crop, frame mask, replacement, or media-browser work. They define the next independent image-effects phase.

## Phase-entry acceptance

The relation model, hidden-source behavior, source/content opacity order, structural failure rules, first-slice geometry, transaction envelope, and initial admission limits above are now frozen for Gate M0. Changing any of them requires an explicit audit amendment with renderer evidence; an adapter must not quietly invent different semantics.

The production schema and controls remain intentionally unchanged at this checkpoint. The next commit is the bounded, test-first shared paint-plan/oracle slice. It must prove the contract before schema version 5 makes mask state persistent.

## Gate M0 checkpoint A — shared structural oracle

Accepted on 2026-08-31 as an intermediate checkpoint, not as the complete M0 exit.

Implemented:

- a package-internal `page-paint-plan.ts` projector with explicit test-only relations
- one rectangle/vector source, canonical page-order content, hidden-source fallthrough, and source suppression from ordinary paint
- top-left rotation bounds matching Fabric, React, and renderer HTML
- explicit `maskEnabled` versus `compositeRequired` so hidden content allocates no offscreen surface
- stable failures for duplicate identities, overlapping relations, missing or non-contiguous members, unsupported M0 mode/source, empty content, invalid scale, and admission limits
- 1x/2x device-pixel admission and fractional ceil-boundary coverage

Independent code review found and the checkpoint fixes:

- duplicate group identities that could have silently dropped a relation
- accidental admission of alpha, luminance, and non-rectangle sources before their gates
- an exported API that could be mistaken for canonical direct-membership validation
- allocation for a visible source when all content was hidden
- a repeated 1x/2x assertion that did not exercise device-pixel admission
- incorrect centre-rotation wording despite correct top-left renderer semantics

The projector remains deliberately absent from the package public index. Gate M1 will derive trusted relations from canonical schema-v5 groups and then expose the validated projection boundary.

Evidence:

- focused document and retained render-conformance tests: 26 passed
- document package typecheck: passed
- formatting and diff checks: passed

Required for the M0 exit and satisfied by checkpoint B:

- translate the retained rectangle/vector oracle through Fabric, React, and renderer HTML
- prove the shared HTML structure through one PNG and one PDF endpoint smoke
- retain one serialized browser comparison for the Fabric and React result

## Gate M0 checkpoint B — cross-renderer feasibility accepted

Accepted on 2026-08-31. Gate M0 is complete.

Implemented:

- Fabric renders the bounded mask group as one object-cached composite whose final child uses `destination-in`; source opacity participates in mask alpha and the source is not painted independently.
- React render view uses a bounded presentational SVG alpha mask while preserving accessibility from rendered content inside `foreignObject`.
- deterministic renderer HTML applies the mask to the bounds-local wrapper and translates content into that coordinate space.
- visible-source and hidden-source fallthrough states are retained for both React and Fabric in the browser harness.
- the direct renderer HTML is retained as 1x and 2x PNG plus PDF and PDF raster for both states.
- the capture job fails when Fabric and React, direct HTML and React, PNG and PDF raster, or downsampled 2x and 1x output exceed explicit pixel thresholds.
- one ordinary schema-v4 document exercises the real Worker PNG and PDF endpoints in the same run; this is transport/readiness evidence, not mask-semantic evidence.

The accepted endpoint wording is clarified here rather than introducing a private raw-HTML renderer ingress. Gate M0 intentionally predates schema version 5, so the production Worker request contract cannot carry a mask relation yet. Exact mask semantics are proved through the same deterministic HTML helper and real Chromium PNG/PDF boundaries used by the renderer. Gate M2 must additionally pass the canonical schema-v5 mask document through the public Worker PNG and PDF endpoints before vector masks are considered end to end.

Retained evidence:

- report: `mask-conformance-capture-report.json`
- artifact run: `artifacts/runs/2026-08-31T10-06-25.744Z-843e8534-8cd3-4f63-8557-6440ece79d6b`
- 148 focused tests: 14 document paint-plan, 18 React conformance, 28 deterministic HTML, and 88 Fabric adapter
- document, render-view, renderer, editor, and Studio typechecks passed
- retained browser run emitted no page errors
- visible Fabric versus React: 0 pixels above channel delta 8, mean channel delta 0.0021, maximum 3
- hidden-source Fabric versus React: 3 pixels above channel delta 8, mean channel delta 0.0011, maximum 48 at an antialiased edge
- direct HTML versus React: 0 pixels above channel delta 8 in both states
- 1x versus downsampled 2x: 669 affected pixels for visible and 986 for hidden-source, both below the 1,100-pixel gate with maximum channel delta 24
- PNG versus PDF raster: 173 affected pixels for visible and 42 for hidden-source, both below the 250-pixel gate

The first production slice remains unchanged: one visible unstroked rectangle vector source, one or more content nodes, no nested mask group, the accepted resource limits, and unmasked fallthrough when no source is visible. Schema, persistence, commands, and user-facing controls begin in Gate M1 and Gate M2.
