# Advanced editor depth phase map

Date: 2026-09-01

Status: active on isolated branch `codex/advanced-editor-depth-2026-09-01`

Base: `e35656d43ed71126ebfb0785fd9a9050251b2232`

## Boundary

This program owns the ten editor-depth gaps retained by
`open-issues-reconciliation-2026-09-01.md`. It extends the canonical document
model and its existing command, history, render, export, Inspector, Review,
menu, and WebMCP paths. It does not reopen the accepted Vercel foundation,
Inspector geometry, rich text, components, masks, library, generation, or
multi-artboard work.

The current model stores absolute page geometry and one flat fill, stroke, and
corner radius per supported shape. `update_page` changes the page dimensions
without changing node geometry. Fabric, `render-view`, and renderer HTML each
project the same scene nodes, but their paint implementations are separate.
Typed `update_node` commands already flow through document history and Review.
WebMCP has a separate strict JSON schema for the same typed node patches. Those
facts set the dependency order below.

## Reference decisions

OpenPencil's `SceneNode` keeps constraints, auto-layout fields, clipping, blend
mode, independent corners, paint arrays, advanced stroke fields, effects,
layout grids, export settings, and text layout fields as canonical data. Its
property sections edit those fields through transaction-owned controls. The
reference is especially useful for the complete property vocabulary and the
separation between container and child layout fields.

Loora groups layout and appearance into typed node records, merges nested
patches explicitly, validates transactions before applying them, and derives
CSS export from the same canonical records. Its responsive breakpoint model is
suited to websites, not Studio's fixed document pages, so Studio will implement
page-relative constraints instead of importing breakpoint overrides.

Studio keeps its existing normalized pages, nodes, groups, components, field
bindings, masks, and output variants. New data must survive semantic cloning,
component override reconciliation, publication, draft decoding, and every
render path without relying on Fabric serialization.

## Gate sequence

| Gate | Capability                                                              | Main dependency                                          | Required acceptance                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Constraints and responsive pinning                                      | Existing absolute page geometry and `update_page`        | Schema migration, typed node patch, deterministic page-resize geometry, undo/redo, Inspector pins, Review detail, WebMCP schema, focused render invariance           |
| 2    | Auto layout and container clipping/overflow                             | Gate 1 geometry rules                                    | Explicit container identity, child order and layout sizing, canonical layout solver, clip ownership, Fabric/React/HTML parity, Inspector and WebMCP controls         |
| 3    | Frame and layout-guide settings                                         | Gate 2 container model                                   | Frame background/size settings, per-frame grids and guides, editor overlays that never enter exports, persistence and menu discovery                                 |
| 4    | Blend modes                                                             | Stable paint order from Gate 2                           | Bounded blend vocabulary, Fabric composite mapping, CSS/SVG mapping, masks and opacity ordering, Inspector and WebMCP parity                                         |
| 5    | Independent corner radii and smoothing                                  | Container clips from Gate 2                              | Four-corner schema, legacy-radius migration, deterministic smoothing approximation, shape/image clip parity, compact Inspector controls                              |
| 6    | Multiple fills and strokes                                              | Gate 4 blend semantics and Gate 5 paths                  | Ordered paint arrays, legacy paint migration, typed list commands, style/variable compatibility, all renderers, Inspector list controls, Review and WebMCP summaries |
| 7    | Advanced strokes                                                        | Gate 6 stroke arrays and Gate 5 geometry                 | Alignment, independent sides, dashes, caps, joins, miter, deterministic bounds, Fabric/SVG/HTML parity and export fixtures                                           |
| 8    | Shadows, blur, and effects                                              | Gate 4 compositing and Gate 5 clip geometry              | Ordered effect stack, blur and shadow bounds, mask interaction, renderer resource limits, Inspector list controls and WebMCP                                         |
| 9    | Per-layer export settings                                               | Stable layer bounds after Gates 5-8                      | Node export settings, page/output relationship, direct and published export routing, menu action, Review/WebMCP inspection, deterministic naming                     |
| 10   | Text direction, vertical alignment, justification, case, and truncation | Existing rich-text layout plus stable container clipping | Canonical text fields and migration, range-style policy, measurement and overflow rules, Fabric/React/HTML/PDF parity, Inspector and WebMCP controls                 |

## Cross-cutting rules

- Increase the document schema version only when the decoder can upgrade every
  schema-v5 draft without changing its rendered result. Published template
  versions remain immutable and cross the boundary through republication.
- Define defaults in the schema and constructors. Do not let Fabric or CSS
  defaults become document behavior.
- Use typed document commands for every mutation. Preview state may be
  transient, but commit, Review, undo, redo, persistence, and WebMCP must share
  the same command payload.
- Preserve component and instance override behavior. A new property must be
  patchable on ordinary nodes and component source nodes before it is exposed
  on instances.
- Keep render projection as the common interpretation layer. Fabric,
  `render-view`, renderer HTML, page thumbnails, previews, PNG, and PDF must
  consume that interpretation or prove an equivalent mapping with fixtures.
- Keep editor-only guides out of exported artwork. Frame layout grids are
  authoring metadata unless a later product decision explicitly promotes them
  to printable content.
- Re-read the reconciliation, Vercel and OpenPencil records, original audit,
  and relevant OpenPencil and Loora code at every gate entry. Record exact
  reference files and deviations in the gate checkpoint.
- Run a separate review pass after implementation. Hold a gate for any P0 or P1
  finding, fix it, rerun the focused checks, then commit the accepted gate.
- After each accepted gate commit, append its exact commit, evidence, and
  remaining risks to `open-issues-reconciliation-2026-09-01.md`.

## Gate 1 entry contract

Gate 1 adds page-relative horizontal and vertical constraints to the base node
schema. Existing nodes migrate to `min` on both axes, which preserves their
top-left geometry. Page resizing applies one canonical projection per axis:

| Constraint | Position change                          | Size change                                 |
| ---------- | ---------------------------------------- | ------------------------------------------- |
| `min`      | none                                     | none                                        |
| `center`   | half of the page delta                   | none                                        |
| `max`      | full page delta                          | none                                        |
| `stretch`  | none                                     | full page delta, clamped to a positive size |
| `scale`    | scale the leading edge by the page ratio | scale the size by the page ratio            |

The command rejects a resize that would collapse a stretched node instead of
silently clamping authored geometry. Rotation remains around the node's own
frame and does not alter the constraint calculation. A width-only or
height-only page patch affects only that axis. Name and background-only patches
leave every node identity unchanged.

Focused evidence must cover decoder migration, command validation and geometry,
history round trips, semantic cloning, component patch compatibility, render
projection stability, Inspector interaction, Review summaries, and the strict
WebMCP node-edit schema. No local server is needed for this gate.
