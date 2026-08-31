# ASSET-02 M4C bounded mask nesting plan

Date: 31 August 2026  
Status: C0/C1 accepted; C2 implementation committed and locally reviewed;
independent C2 acceptance and C3–C5 remain open

This checkpoint freezes the smallest mask-nesting slice that can be implemented
and verified honestly across the document model, editor, every renderer, and
published outputs. OpenPencil informs the bounded save-layer and
`destination-in` structure, but its current mask implementation does not prove
nested masks, recursive memory accounting, resource failure, or export parity.

## Frozen scope and semantics

M4C raises the admitted mask-composite chain from one level to exactly two: one
direct mask child may render inside one mask parent. A parent may contain
multiple sibling child masks, subject to the existing page budgets. A child mask
cannot contain another child mask.

- Each mask retains one through four ordered, unique source node IDs.
- Sources remain direct node members of their own mask group. A child group is
  content, never a mask source.
- M4C admits only a direct mask-to-mask nesting edge. Organize groups between or
  inside mask composites remain rejected instead of being silently flattened.
- A child mask is composed completely before its output is painted as one
  ordered content entry of its parent.
- Child placement is derived from the minimum page index of its descendants.
  Every child subtree and parent subtree must be contiguous. Sibling subtrees
  must not overlap; ancestor containment is the only admitted overlap.
- Hidden-source behavior remains local. An all-hidden child paints its content
  unmasked and contributes that output to the parent. An all-hidden parent
  paints all parent content, including completed child outputs, unmasked.
- Vector, alpha, and luminance source admission and ordered source-over union do
  not change.

### Bounds and resource accounting

A nested paint entry needs two conservative bounds:

1. allocation bounds cover the relation's visible sources and content and size
   that relation's offscreen composite;
2. output bounds cover the pixels the completed content subtree can contribute
   to its parent.

The parent unions its own source and direct-content bounds with each child's
output bounds. It must not use a child's source-only extent as visible parent
content, and it must not clip a child's completed output.

Every active inner and outer composite is charged exactly once at the admitted
pixel ratio. Existing limits remain unchanged:

- maximum pixel ratio: 2;
- maximum dimension per composite: 8192 pixels;
- maximum device pixels per composite: 16,777,216;
- maximum active composites per page: 32;
- maximum summed device pixels per page: 67,108,864;
- maximum masked leaf descendants per relation: 512.

An all-hidden relation allocates no composite. Cycles, depth greater than two,
noncontiguous subtrees, ambiguous ownership, and budget excess are rejected
before a renderer allocates resources.

### Structural command behavior

The existing typed `create_mask_group` command gains an optional canonical
parent group ID. It does not gain a parallel mutation architecture.

Creating a nested mask:

- accepts a contiguous selection of direct, non-source nodes from one mask
  parent;
- removes those nodes from the parent's direct `nodeIds`;
- creates the child with `parentGroupId` and its own direct source IDs;
- cannot move a parent source into the child;
- leaves at least one parent content entry, where the new child counts as one;
- is one replay-protected, revisioned, undoable transaction.

Releasing a child dissolves it into its parent atomically. Its direct nodes are
spliced back into the parent in canonical page order before the child group is
removed. No node becomes orphaned and the outer mask does not lose content.
Top-level release retains its existing behavior. Type and source mutations are
allowed on an admitted nested group and preserve all depth, ownership, lock,
binding, component, and budget invariants.

## Current code blockers

### Document and commands

- `packages/document/src/page-paint-plan.ts` rejects every group with a parent
  or child in `canonicalMaskRelationsForPage`. Its flat `relationByNodeId`
  treats intentional ancestor containment as overlap, and it emits only node
  content entries. It needs a cycle-safe recursive group tree and bottom-up
  budget projection.
- `packages/document/src/validation.ts` counts only direct non-source content,
  rejects every nested mask, and checks composite geometry independently. It
  must count leaf descendants, validate direct ownership and depth before
  recursion, and consume the same recursive 2x admission as projection.
- `packages/document/src/schema.ts` defines the group parent relationship but
  `create_mask_group` has no parent argument.
- `packages/document/src/commands.ts` rejects nested create and every mutation
  of a group with a parent or child. Release only deletes a group; it does not
  restore parent membership.

### Clone, component, and template paths

- `packages/document/src/semantic-clone.ts` already captures complete group
  subtrees, remaps `parentGroupId`, and requires mask sources to remain direct.
  It needs nested complete/incomplete capture and round-trip evidence.
- `packages/document/src/components.ts` already remaps group parents and mask
  sources during materialization and update. It needs nested component,
  instance, variant, and structural-protection evidence.
- `packages/document/src/design-templates.ts` already remaps parent group IDs.
  It needs deterministic nested template application evidence.

These paths should be proven and corrected narrowly; M4C does not redesign
their schemas.

### Renderers

- `packages/editor/src/fabric-adapter.ts` requires every mask content entry to
  be a node. It must build child composites bottom-up, pass the completed child
  object into its parent, preflight all descendant resources before clearing
  the mounted scene, and dispose each retained object exactly once.
- `packages/render-view/src/index.tsx` rejects a mask entry inside mask content.
  It must recursively render child `MaskGroupPaintEntry` values with correct
  local translation and one atomic readiness boundary for the subtree.
- `apps/renderer/src/html.ts` already calls
  `renderPagePaintPlanEntryToHtml` recursively, but nested coordinates, unique
  filter/mask IDs, descendant font/image readiness, and exact failure
  attribution are not proven.
- `apps/renderer/src/index.ts` must rely on canonical recursive admission and
  reject resource or limit failures before screenshot, PDF capture, or artifact
  persistence.

For every renderer, a failed or stale descendant image, font, or luminance
candidate cannot replace the last valid outer subtree. The outer composite must
not commit while a child composite is loading or invalid.

### Product surfaces

- `packages/editor/src/inspector.ts` currently reports nesting as unavailable.
  It needs exact eligibility and disabled reasons for parent, depth,
  contiguity, sources, content, component ownership, locks, and budgets.
- `packages/editor/src/history.ts` must retain one exact create/release undo step
  including restored parent membership.
- `packages/editor/src/product-commands.ts`, Studio dispatch, and
  `packages/webmcp/src/product-command-proposals.ts` must carry and capability-
  bind the exact parent group ID. No surface may infer or truncate it.

## Implementation gates

### C0 — contract and fixtures

- keep this contract frozen;
- add canonical two-level vector/alpha/luminance fixtures;
- define allocation bounds, output bounds, ownership, order, error codes, and
  retained pixel probes before changing admission.

Exit: fixture expectations are reviewable and no renderer-specific state leaks
into the document plan.

### C1 — recursive document plan and admission

- build a cycle-safe recursive paint plan;
- enforce depth, ownership, contiguity, source, leaf-content, and page limits;
- calculate allocation/output bounds and recursive memory totals once;
- preserve ordinary flat and one-level mask plans exactly.

Exit: invalid documents fail before allocation and valid plans deterministically
encode nested order and bounds.

Checkpoint `5381410` closes this document-only exit. The canonical plan now
admits one direct child level, emits completed child entries in page order,
separates allocation from visible output bounds, counts masked leaf content,
and charges every active child and parent composite exactly once. It rejects
cycles, third-level nesting, duplicate sources, mask/organize ownership
overlap, noncontiguous subtrees, invalid direct sources, and unchanged page
budget excess before allocation. This checkpoint does not make commands,
renderers, Inspector, Studio, or WebMCP nesting-capable; those remain C2–C4.

### C2 — commands, history, clone, components, and templates

- implement atomic nested create and dissolve release;
- admit nested type/source mutations without weakening protections;
- prove replay, no-op, exact undo/redo, semantic clone, component
  materialization/update, and template remapping.

Exit: structure survives every canonical copy and mutation path.

Checkpoint `fe5cc475eb7704a7665a2958d96f3a556be2f9d2` closes the C2
implementation on branch `codex/asset02-general-masks`, based on main
`6265561ab4c9aa70c7489c2a90b3dcac6c1179d3`. It adds the optional canonical
parent identity to `create_mask_group`, atomically removes a nested child's
direct nodes from its parent, restores them in page order on child release, and
keeps a child mask when its top-level parent is released. Parent-source capture,
noncontiguous selection, a third mask level, locks, bindings, component-owned
structure, stale revisions, and replay conflicts still fail before mutation.
Nested type and ordered-source changes use the existing command and receipt
boundary; semantic no-ops retain document identity.

The same checkpoint fixes document-template cloning so both `parentGroupId` and
every mask source ID map to fresh template identities. Focused tests prove
complete and incomplete semantic fragments, component materialization and
refresh, variant application, component structural protection, deterministic
template cloning, and exact nested create/release undo and redo.

Verification for the committed implementation:

- focused command, semantic-clone, component, template, and history files:
  123/123 tests passed;
- complete document suite: 416/416 tests passed;
- complete editor suite: 371/371 tests passed;
- document and editor typechecks passed;
- changed files passed Prettier and `git diff --check`; and
- in-thread code review found no remaining C2 correctness issue.

This is not an independent acceptance. C2 remains marked implemented, reviewed
locally, committed, not merged, and independently unaccepted until a separate
reviewer verifies the commit. At this checkpoint C3 renderer support had not
started. Inspector, Studio, and WebMCP still need C4 argument and capability
wiring; no retained or public output evidence is claimed.

### C3 — Fabric, React, and deterministic HTML

- render bottom-up with correct local coordinates and composite ownership;
- aggregate image, font, and luminance readiness across the subtree;
- retain the last valid subtree on failed or stale candidates;
- preserve all-hidden fallthrough and bounded cleanup.

Exit: the three renderers agree on structure, bounds, ordering, readiness, and
failure attribution.

Checkpoint `1245f4fb616ee5a816d39f356b27d8663cfbee9a` closes the C3
implementation on branch `codex/asset02-general-masks`. Fabric now constructs a
complete candidate tree bottom-up, hands each completed child composite to its
parent in canonical page geometry, preflights every image and luminance resource
in the mask subtree before replacing mounted pixels, preserves the prior scene
on descendant failure or stale work, flattens all-hidden child relations, and
disposes each superseded retained object once through Fabric's recursive group
ownership.

React now consumes recursive paint-plan entries and holds the complete outer
subtree behind one image, font, and luminance readiness transaction. A failed or
stale descendant retains the committed outer model and reports the exact node
and failure class. Deterministic HTML retains recursive canonical ordering,
unique group-derived mask and filter IDs, correct nested translation, and one
document-wide readiness scan that now includes fonts used by ordinary nested
text content. The renderer Worker admits a valid nested tree and rejects a
third mask level before browser allocation or capture.

Verification for the committed implementation:

- complete editor suite: 375/375 tests passed;
- complete React render-view suite: 34/34 tests passed;
- complete renderer suite: 101/101 tests passed;
- focused document projection and validation suites: 54/54 tests passed;
- document, editor, render-view, and renderer typechecks passed;
- changed files passed Prettier and `git diff --check`; and
- in-thread code review found and corrected Fabric's nested group recentering
  and recursive-disposal ownership before the checkpoint was committed.

This is not an independent acceptance. C3 is implemented, locally reviewed,
committed, not merged, and independently unaccepted. C4 product surfaces and C5
retained/public output evidence remain open; no pixel or public-output
acceptance is claimed by this checkpoint.

### C4 — inspector, Studio, history surfaces, and WebMCP

- expose only valid nested creation and release;
- carry the complete typed command through UI and API surfaces;
- bind capability IDs to parent, selection order, document, and snapshot;
- preserve keyboard, focus, and Layers-tree navigation.

Exit: every human and agent surface reaches one canonical command boundary.

### C5 — retained and public output evidence

- compare Fabric, React, and deterministic HTML at 1x and 2x;
- compare PNG, PDF raster, thumbnail, public PNG, and public PDF;
- include nested vector/alpha/luminance, image crop, rich text/run-font,
  multi-source, one-hidden, all-hidden, failure, and limit fixtures;
- perform an independent code and retained-output review.

Exit: nested pixels, resources, errors, and budgets conform across every output.
Only then may M4C acceptance change.

## Exact gate ledger

| Gate  | Implementation                                                                                    | Review and evidence                                                                                                                        | Accepted                 | Merged |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------ |
| C0/C1 | `5381410` document implementation; recorded on main at `6265561ab4c9aa70c7489c2a90b3dcac6c1179d3` | Existing independent document-plan acceptance                                                                                              | Yes, document scope only | Yes    |
| C2    | `fe5cc475eb7704a7665a2958d96f3a556be2f9d2`                                                        | 123 focused, 416 document, and 371 editor tests; local code review complete; independent review pending                                    | No                       | No     |
| C3    | `1245f4fb616ee5a816d39f356b27d8663cfbee9a`                                                        | 375 editor, 34 React, 101 renderer, and 54 document tests; local code review complete; independent review pending                          | No                       | No     |
| C4    | `41becdac5f9538ade2f8d871e2cd5879486ab91e`                                                        | 376 editor, 67 WebMCP, 24 focused Studio, and 1 keyboard E2E tests; three typechecks and local review complete; independent review pending | No                       | No     |
| C5    | Not started                                                                                       | No retained or public nesting evidence                                                                                                     | No                       | No     |

#### C4 product-surface checkpoint — 1 September 2026

The inspector now admits only a direct child of one exact mask parent and
mirrors the canonical parent-source, contiguity, depth, lock, component, and
paint-budget rules before dispatch. Nested release, type, and source operations
remain available when their complete subtree is valid. The required nullable
`parentGroupId` travels through the product-command contract, inspector,
shortcut, Studio editor hook, review details, WebMCP parser, capability ID, and
single-operation proposal without inference or source truncation.

Focused verification passed 96 editor tests, 54 WebMCP tests, 24 Studio tests,
and one real Chrome keyboard/Layers/history test on port 3001. Full editor
(376/376) and WebMCP (67/67) suites and editor, WebMCP, and Studio typechecks
also passed. Prettier and `git diff --check` passed, and local review corrected
outer-mask mutation admission to include locked or component-owned child
descendants.

An exploratory full Studio run passed 1,748 of 1,765 tests. Its 17 failures are
outside the C4 mask path: stale schema/template/catalog expectations, an
unmigrated curated-asset timeout, and existing mounted audit-hook/time-sensitive
fixtures. They are not counted as C4 evidence and remain explicit M5 cleanup;
the focused Studio surface tests and the nested keyboard E2E are green. C4 is
implemented and locally verified, but is not independently accepted or merged.

## Required focused tests

- Projection: parent/child type combinations, sibling child masks, canonical
  order, rotated and negative geometry, allocation versus output bounds,
  hidden combinations, cycles, depth, overlap, contiguity, ownership, and 2x
  composite/page budgets.
- Commands/history: nested create, dissolve release, type/source changes,
  replay conflict, no-op, locks, bindings, components, exact undo, and redo.
- Clone/components/templates: complete round trips, incomplete subtree
  rejection, deterministic IDs, variants, overrides, and parent/source mapping.
- Renderers: bottom-up order, translations, image/text/font/luminance readiness,
  stale and failed replacement, last-valid subtree, disposal, and memory limits.
- Product/API: truthful disabled reasons, focus, command arguments,
  capability binding, proposal preview, and atomic execution.
- Retained/public: coefficient-sensitive nested pixels and export parity across
  all C5 surfaces.

## Explicit non-goals

M4C does not admit arbitrary nesting depth, group-as-source masks, clipping or
intersection modes, mask inversion, boolean path operations, organize wrappers
inside a mask chain, unbounded composites, a new renderer architecture, or
structural editing inside component instances. It does not raise existing
source, content, dimension, area, count, or pixel-ratio limits. It does not
claim M4A, M4B, or M4C retained acceptance before their required corpus passes.
