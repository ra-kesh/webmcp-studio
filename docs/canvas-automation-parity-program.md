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

## Parity matrix

The status values are `yes`, `partial`, and `no`. A row reaches parity only when all six behavior columns are `yes` and browser evidence is recorded.

| Action family                                      | Canonical command                             | WebMCP                                    | Undo             | Persistence    | Renderer          | Review                    | Current status |
| -------------------------------------------------- | --------------------------------------------- | ----------------------------------------- | ---------------- | -------------- | ----------------- | ------------------------- | -------------- |
| Create existing node types                         | `add_node`                                    | Restricted generation and image insertion | yes              | yes            | yes               | partial                   | partial        |
| Update node properties                             | `update_node` and image commands              | Existing layers only                      | yes              | yes            | yes               | yes                       | partial        |
| Delete nodes                                       | `remove_node`                                 | Product capability only                   | yes              | yes            | yes               | yes                       | partial        |
| Clone nodes                                        | `duplicate_nodes`                             | Product capability only                   | yes              | yes            | yes               | yes                       | partial        |
| Reorder nodes                                      | `reorder_node`, `reorder_nodes`               | Product capability only                   | yes              | yes            | yes               | yes                       | partial        |
| Reparent nodes and groups                          | `reparent_node`, `reparent_group`             | Product capability only                   | yes              | yes            | yes               | yes                       | partial        |
| Group and ungroup                                  | `group_nodes`, `ungroup_nodes`                | Product capability only                   | yes              | yes            | yes               | yes                       | partial        |
| Mask and release                                   | mask command family                           | Product capability only                   | yes              | yes            | yes               | yes                       | partial        |
| Boolean operations                                 | no                                            | no                                        | no               | no             | no                | no                        | no             |
| Components and instances                           | component command family                      | Separate proposal tool                    | yes              | yes            | yes               | yes                       | partial        |
| Variants                                           | variant command family                        | Separate proposal tool                    | yes              | yes            | yes               | yes                       | partial        |
| Variables and bindings                             | variable command family                       | Separate proposal tool                    | yes              | yes            | yes               | yes                       | partial        |
| Typography and paint styles                        | style command family                          | Separate proposal tool                    | yes              | yes            | yes               | yes                       | partial        |
| Frames and auto layout                             | `add_node`, `update_node`                     | Update only                               | yes              | yes            | yes               | yes                       | partial        |
| Rich text                                          | `add_node`, `update_node`                     | Basic text creation, partial editing      | yes              | yes            | yes               | yes                       | partial        |
| Polygon, star, general vector, section             | no                                            | no                                        | no               | no             | no                | no                        | no             |
| Gradient and image paints                          | no                                            | no                                        | no               | no             | no                | no                        | no             |
| Asset upload and insertion                         | Separate media transaction plus node commands | Separate tools                            | partial          | partial        | yes               | partial                   | partial        |
| Asset crop and transform                           | Image placement commands                      | Existing images only                      | yes              | yes            | yes               | yes                       | partial        |
| Asset derivatives                                  | Separate job and repository                   | Separate tools                            | no document undo | separate       | output image only | separate                  | partial        |
| Page and output operations                         | page and output command families              | Split generation and product tools        | yes              | yes            | yes               | yes                       | partial        |
| Declarative scene render                           | Restricted `StudioDesignPlan` direct compiler | Separate generation tools                 | partial          | partial        | yes               | separate candidate review | partial        |
| Inspect tree and bounds                            | read-only queries                             | several tools                             | not applicable   | not applicable | partial           | partial                   | partial        |
| Verify overflow and assets                         | validation issues                             | `validate_design`                         | not applicable   | not applicable | partial           | yes                       | partial        |
| Verify overlap, clipping, fonts, bounds comparison | no unified operation                          | no                                        | not applicable   | not applicable | partial           | no                        | no             |

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
