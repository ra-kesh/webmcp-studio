# Canvas automation parity program

Base commit: `3b7741d8064f68d46ee0d7c17584b21008a82342`

Branch: `codex/canvas-automation-parity-2026-09-02`

## Audit findings

Studio has a canonical document schema and a broad `DocumentCommand` union, but it does not have one transaction boundary. The editor history, WebMCP proposal builders, Studio Design Plan compiler, document import, media repositories, and verification code each own part of the mutation flow.

The current scene schema supports text, rectangles, ellipses, lines, icon paths, images, and frames. It also supports rich text, constraints, auto layout, clipping, multiple solid paints, strokes, effects, blend modes, masks, components, variables, and styles. It does not yet model sections, polygons, stars, general vector nodes, boolean results, gradient paints, image paints, or canonical asset records.

`StudioDesignPlan` accepts only text, rectangle, ellipse, line, icon, and image nodes. It creates a candidate document directly. Components are disabled. Existing-page generation later translates the candidate into commands, which confirms that generation and editing take different routes.

WebMCP registers 31 tools. The descriptor test sets a 60 KiB total limit. Canvas work is spread across inspection, capability, proposal, style, variable, component, asset, generation, and validation tools. The target compact tool set needs on-demand schemas before it can replace these registrations safely.

Review proposals check document revision and snapshot. Product commands also check operation and selection state. Mask commands have a bounded replay ledger, and some WebMCP calls have in-memory receipts. These protections do not form one durable transaction contract.

## Phases

1. Add the canonical transaction kernel and public scene projection.
2. Route editor commits, Review apply, import, and WebMCP mutation through that kernel.
3. Add the missing scene node and paint types, then close renderer and inspector gaps.
4. Compile bounded `render_scene` trees into canonical transactions.
5. Add canonical asset records, import operations, provenance, derivatives, and export references.
6. Add structured canvas inspection and verification.
7. Register six compact WebMCP tools with capability schemas returned on demand.
8. Close every matrix row with focused tests and real-browser evidence.

## Implementation ledger

| Slice | Scope                                                                                       | State                                                   |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1     | Canonical bounded transaction envelope and editor history adapter                           | Committed as `6455e6d2a945a7f4f2d044e3c2a125e7e9c09133` |
| 2     | Durable receipts, editor and Review routing, clone/import identity rules, persistence gates | Committed as `61f9425978889b4d9a8e3f43427828650e2d539f` |
| 3     | Public schema projection and WebMCP registration cutover                                    | Committed as `d92ad2bf7a39fae43759a4f15863ed086e4554b4` |
| 4     | Vector scene nodes, boolean results, gradients, image paints, and renderer/Inspector parity | Current reviewable commit                               |

## Parity matrix

The status values are `yes`, `partial`, and `no`. A row reaches parity only when all six behavior columns are `yes` and browser evidence is recorded.

| Action family                                      | Canonical command                             | WebMCP                    | Undo             | Persistence    | Renderer          | Review                    | Current status |
| -------------------------------------------------- | --------------------------------------------- | ------------------------- | ---------------- | -------------- | ----------------- | ------------------------- | -------------- |
| Create existing node types                         | `add_node`                                    | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Update node properties                             | `update_node` and image commands              | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Delete nodes                                       | `remove_node`                                 | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Clone nodes                                        | `duplicate_nodes`                             | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Reorder nodes                                      | `reorder_node`, `reorder_nodes`               | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Reparent nodes and groups                          | `reparent_node`, `reparent_group`             | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Group and ungroup                                  | `group_nodes`, `ungroup_nodes`                | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Mask and release                                   | mask command family                           | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Boolean operations                                 | `create_boolean_result`                       | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Components and instances                           | component command family                      | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Variants                                           | variant command family                        | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Variables and bindings                             | variable command family                       | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Typography and paint styles                        | style command family                          | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Frames and auto layout                             | `add_node`, `update_node`                     | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Rich text                                          | `add_node`, `update_node`                     | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Polygon, star, general vector, section             | `add_node`, `update_node`, vector conversion  | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Gradient and image paints                          | `add_node`, `update_node`                     | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Asset upload and insertion                         | Separate media transaction plus node commands | Separate tools            | partial          | partial        | yes               | partial                   | partial        |
| Asset crop and transform                           | Image placement commands                      | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Asset derivatives                                  | Separate job and repository                   | Separate tools            | no document undo | separate       | output image only | separate                  | partial        |
| Page and output operations                         | page and output command families              | `transact_canvas`         | yes              | yes            | yes               | yes                       | yes            |
| Declarative scene render                           | Restricted `StudioDesignPlan` direct compiler | Separate generation tools | partial          | partial        | yes               | separate candidate review | partial        |
| Inspect tree and bounds                            | read-only queries                             | several tools             | not applicable   | not applicable | partial           | partial                   | partial        |
| Verify overflow and assets                         | validation issues                             | `validate_design`         | not applicable   | not applicable | partial           | yes                       | partial        |
| Verify overlap, clipping, fonts, bounds comparison | no unified operation                          | no                        | not applicable   | not applicable | partial           | no                        | no             |

## Slice 1 acceptance

The first slice adds a bounded transaction envelope around the existing command engine. It checks document, revision, snapshot, and operation identity. It requires an idempotency key, evaluates commands on a private candidate, reports the failing command, returns structured validation warnings, supports preflight, preview, review, and commit modes, and provides a bounded replay executor. The editor adapter commits the batch through existing history as one undo entry.

This slice does not claim durable receipt persistence or new node parity. Those remain explicit matrix gaps.

## Slice 1 browser evidence

Verified on 2 September 2026 with the real Studio editor at the isolated local origin `http://localhost:3002`. Port 3001 was already occupied, and port 3000 was not used.

1. Opened the seeded "Aditi & Kabir — Wedding Story" document at revision 31.
2. Ran Text, Add text through the application menu. Studio added one editable `Body` layer and advanced the document to revision 32.
3. Ran Undo once. Studio removed that layer and restored revision 31.
4. Ran Redo once. Studio restored the same layer and revision 32.

The page registered 31 WebMCP tools during this run. That visible count matches the descriptor audit and confirms why the compact-tool phase must consolidate registrations rather than add another public tool for each command family.

## Slice 2 durable receipt contract

Committed scene transactions store a schema-versioned receipt ledger in `Document.sceneTransactionMetadata`, outside `pages` and `nodes`. The carrier is document metadata because replay protection belongs to the saved document identity rather than to anything drawable. Renderers continue to consume page, node, and paint projections only.

- The ledger schema version is `1` and the maximum is 128 receipts.
- Receipts are ordered by successful commit. When the limit is exceeded, the oldest entries are pruned. A replay does not refresh its position.
- Reusing an idempotency key with the same canonical request hash returns the already-committed document, even after reload and even if the request's expected revision, snapshot, or operation identity is now stale.
- Reusing that key with a different canonical request hash fails with `idempotency_key_reused` and makes no change.
- Only successful `commit` mode writes a durable receipt. `preflight`, `preview`, and `review` never do.
- The receipt is persisted concurrency state, so it participates in the document snapshot hash. It does not add a document revision; only the transaction's canonical commands advance revision.
- Canonical JSON save/import and reload preserve the ledger for the same document identity. New documents, template instances, duplicate drafts, and conflict copies clear both transaction and command receipt ledgers so keys cannot collide across cloned identities.

Focused tests cover replay after JSON round-trip, key collision, bounded pruning, unchanged rendering, rollback on command failure, one history entry and one undo for a transaction, Review preserving the exact command list, and structural equality between an editor-created node and the same node committed through automation.

## Slice 2 browser evidence

Verified on 2 September 2026 in the real Studio editor at `http://localhost:3002`; port 3000 was not used.

1. Opened the persisted six-page "Aditi & Kabir — Wedding Story" document at revision 32.
2. Added a rectangle through the human `Insert shape` control. The document advanced to revision 33 and returned a transaction-derived snapshot identity.
3. Renamed that exact node to `Browser transaction rectangle` in the human inspector. The document advanced once to revision 34.
4. Ran Undo once and observed the exact node revert to `Rectangle` at revision 33. Ran Redo once and observed the same node ID return to the renamed state at revision 34.
5. Reloaded the document route. Studio reported `All changes saved`, restored the six pages and 17 layers, rendered the scene, and returned the same node ID, geometry, fill, and renamed value at revision 34 with no pending Review.

## Slice 3 public schema and registration cutover

`read_canvas_schema` returns JSON Schema generated directly from the canonical runtime transaction, command, node, or document schema. `transact_canvas` deliberately keeps only a compact envelope description in its browser registration and points callers to the on-demand schema. No reduced scene-edit contract is copied into the new public API.

Registration-level coverage compares the fallback and cutover tool lists. Every removed tool must have a non-empty mapping to command types present in the generated canonical command schema. Side-by-side tests run one legacy proposal and the equivalent canonical transaction for product commands, asset insertion, field updates, canvas edits, styles, variables, components, and output variants, then assert equal candidate documents.

The safe cutover removes these fully represented proposal tools:

- `propose_design_style_changes`
- `propose_design_variable_changes`
- `propose_component_changes`
- `propose_output_variant`

`execute_product_command` remains because it also owns non-scene application actions. `propose_asset_insertion`, `propose_field_updates`, and `propose_canvas_edits` remain until the canonical asset slice can privately resolve catalog IDs into renderer-safe sources, including asset-valued fields and image replacement. This prevents descriptor consolidation from dropping a production capability.

The worst-case registration fixture contains 29 tools and serializes to 40,094 compact UTF-8 bytes, below the 60 KiB gate. The real local browser registered 27 tools and measured 37,049 compact UTF-8 bytes. Its largest descriptor was the retained asset-aware `propose_canvas_edits` at 10,307 bytes.

## Slice 3 browser evidence

Verified on 2 September 2026 at `http://localhost:3002`; port 3000 was not used.

1. Before suppression, used `transact_canvas` in preview mode for one command from all eight mapped families: `duplicate_nodes`, managed-image `add_node`, `set_field`, `update_node`, `create_typography_style`, `create_variable`, `create_component`, and `add_output`. A stale snapshot was rejected, and all eight succeeded after a fresh inspection.
2. Reloaded after the safe cutover and rediscovered the live registration. The four removed tools were absent; the product-command and three asset-aware tools remained.
3. Committed one six-command transaction spanning every removed family: typography style creation, variable creation and binding, component creation, output/page creation, and a styled text node on that page. Revision advanced from 39 to 45 with no warnings.
4. One Undo removed the output, page, node, style, variable, binding, and component and returned revision 39. No earlier undo entry remained. One Redo restored the complete revision-45 state.
5. Reloaded and visibly opened page 7, `Canonical cutover`, showing the editable `CANONICAL CUTOVER` text layer. Inspection confirmed the output, style, variable binding, component, and exact text node all persisted.
6. Replayed the original stale-identity request after reload. The durable receipt returned `replayed: true`, `changed: false`, at revision 45. Reusing its key with a changed title was rejected as `idempotency_key_reused`.

## Slice 4 vector scene and paint contract

The canonical node union now includes `section`, `polygon`, `star`, `vector`, and `boolean_result`. Vector geometry uses normalized SVG paths with an explicit view box and fill rule. `convert_node_to_vector` provides a canonical conversion path for supported primitives, while `create_boolean_result` records the boolean operation, stable source IDs, derived path, and source-preservation policy in one command.

The fill union remains backward compatible with legacy solid paints whose `type` is omitted and adds typed solid, linear-gradient, radial-gradient, and image paints. Gradient geometry and stops are normalized and bounded. Image paints carry an approved asset identity, renderer-safe source, and invertible normalized affine transform.

The new nodes and paints flow through document decoding, validation, semantic clone, components, variables, styles, templates, generation summaries, publishing, layer export, render-resource admission, render projection, editor history, layer trees, and Inspector projections. Fabric, the React render view, and renderer HTML share the same projected geometry and paint interpretation.

Image-fill sources participate in the existing asset lifecycle instead of bypassing it. Local, managed, and curated assets are discovered and accounted for; draft/import/catalog paths retain safe sources; preview, page-thumbnail, materialized export, and server-render paths resolve the exact bytes; and public WebMCP summaries keep private locators redacted. Focused tests cover hashes and byte preservation, missing-asset validation, renderer admission, thumbnail fallbacks, export materialization, and source redaction.

## Slice 4 browser evidence

Verified on 2 September 2026 in the real Studio editor at `http://localhost:3002`; port 3000 was not used.

1. Read the live canonical schema and confirmed all five new node types, all three new typed paint families, `convert_node_to_vector`, and `create_boolean_result` were present before mutation.
2. Committed transaction `transaction-browser-scene-parity-20260902`, an eight-command batch on a new 1080 × 1080 page. It created a section, six-point polygon with a linear gradient, seven-point star with a radial gradient, general vector with an affine image paint, converted rounded rectangle, and exclude boolean result, then parented the five rendered results to the section. Revision advanced from 45 to 53, operation version advanced from 0 to 1, and the transaction returned no warnings.
3. Visually inspected the rendered page and the live tree. The section contained vector, vector, boolean-result, star, and polygon children. The canvas showed the blue gradient hexagon, orange/red radial star, turquoise image-filled wave, purple converted vector, and teal boolean cutout.
4. Inspected the polygon, image-filled vector, and boolean-result controls. The Inspector exposed polygon points; gradient endpoints, stops, colors, positions, and opacity; image asset/source plus affine A–F; and boolean operation, source IDs, path, view box, and fill rule.
5. One UI Undo removed the complete eight-command scene and returned revision 45. One UI Redo restored every new node and returned revision 53. Reload preserved the page and exact node types. The original stale request then returned `replayed: true`, `changed: false`; changing its title while reusing the key was rejected as `idempotency_key_reused`.
6. At the normal 1280 × 720 viewport, the established Studio hierarchy remained intact: the 336 px Properties panel, `Design | Data | Review` tabs, and document/page save-status row all rendered without horizontal overflow. The Data tab kept Content fields and advanced Design variables in one continuous scroll surface with flat rows and compact actions.
7. At a 900 × 720 viewport, Properties opened as an exact 448 px sheet. The compact ellipsis appeared, the desktop file-actions button hid, the two constraint selects measured 202.5 px each, the blend-mode select measured 413 px, and the document remained horizontally contained.
8. Rechecked the existing text and rectangle Inspectors at normal width. A temporary standard image layer also exercised the unchanged image placement, frame, accessibility, crop, and replace controls; one Undo removed that sample and restored revision 53 before the final reload.
