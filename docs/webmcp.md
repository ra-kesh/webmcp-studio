# WebMCP integration

## Product rule

WebMCP is an adapter over product services. It does not maintain another document, mutate Fabric objects directly, or duplicate validation and publishing logic.

Tools register according to the current route and state. The library route exposes discovery. The editor exposes inspection and proposal. The review route adds resolution. A published template exposes rendering.

## Tool catalog

### `inspect_design`

Read-only. Returns revision, active output and page, selection, compact layer tree, shared fields, bindings, page sizes, pending changes, and current warnings. Stable node IDs replace DOM selectors and Fabric serialization.

### `search_assets`

Read-only. Searches the current workspace assets by query, orientation, dominant color, and tags. Results include asset ID, thumbnail, dimensions, alt text, license, and attribution.

### `validate_design`

Read-only. Validates the current page, one output, or the complete document. The result separates blocking errors from warnings and names affected fields, pages, and nodes.

### `propose_field_updates`

Creates a pending change set from typed field values. Input includes document ID, base revision, values, and optional reason. Output names every affected binding.

### `propose_canvas_edits`

Creates a pending change set of typed commands. Week-one operations are set text, replace image, set style, move, resize, show, hide, add, duplicate, delete, and reorder.

### `propose_output_variant`

Proposes a new fixed output preset using a seeded companion layout. It does not claim general responsive design.

### `resolve_change_set`

Accepts or rejects individual operations, applies accepted operations, or discards the change set. It requires the change-set ID and expected document revision.

### `publish_template`

Runs blocking validation and creates an immutable version. Returns version, parameter manifest, API playground route, and any blocking errors. Tool metadata marks it as consequential and human-confirmed.

### `render_template`

Renders one published version with supplied field values and output choices. The render appears in the same history panel used by API requests.

## Route map

| Route state        | Tools                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Library            | `search_assets`                                                                                                                 |
| Editor             | `inspect_design`, `search_assets`, `validate_design`, `propose_field_updates`, `propose_canvas_edits`, `propose_output_variant` |
| Review             | Editor read tools plus `resolve_change_set`                                                                                     |
| Published template | `validate_design`, `publish_template`, `render_template`                                                                        |
| Render history     | `render_template`                                                                                                               |

Registration cleans up on navigation and remains safe under React Strict Mode. Tool handlers capture current services through stable references rather than stale render closures.

## Human review contract

Proposal tools never write saved state. Their result creates a visible pending preview. The tool result should tell the agent that a human decision is required and give the change-set ID. A browser agent may continue inspecting and validating while the change set is pending, but it cannot describe the proposal as applied.

Resolution may accept a subset. Rejected operations remain in the audit record. If the current revision no longer matches the change set, resolution returns a conflict with enough state for another inspection.

## Security and privacy

- Tool output returns compact product data, not database records or secret URLs.
- Asset search returns only assets in the current demo workspace.
- External asset URLs pass an allowlist and renderer fetch check.
- Consequential tools state their side effects in metadata.
- Published versions cannot reference local blobs or private browser-only URLs.
- Tool errors never include secrets, binding names, SQL, or stack traces.
- Cancellation stops unfinished proposals and does not leave a hidden change set.

## Challenge proof

The demo should make the WebMCP contribution visible. An ordinary API-only agent cannot know which page is active, what the human selected, which image the human rejected, or whether a pending preview is still open. WebMCP supplies that shared live context while the product keeps all writes reviewable.
