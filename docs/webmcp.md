# WebMCP integration

## Product rule

WebMCP is an adapter over product services. It does not maintain another document, mutate Fabric objects directly, or duplicate validation and publishing logic.

The Studio registers one stable tool surface because editing, review, publishing, and render history share a single application route. Every state-dependent handler reads the current service snapshot when called. The human resolves proposals in the visible Review panel; an agent cannot approve its own changes.

## Tool catalog

### `inspect_design`

Read-only. Returns revision, the active page, its complete canonical layers, selection, shared fields, bindings, outputs, and pending changes. Stable node IDs replace DOM selectors and Fabric serialization.

### `search_assets`

Read-only. Searches the approved, renderer-safe Studio catalog by query, orientation, and tags. Results include a stable asset ID, dimensions, description, tags, and license while source URLs remain private to the product service.

### `validate_design`

Read-only. Validates the current page, one output, or the complete document. The result separates blocking errors from warnings and names affected fields, pages, and nodes.

### `propose_asset_insertion`

Creates one pending review that can combine typed shared-field updates with an image-layer insertion from an approved `search_assets` ID. Studio resolves the private renderer source; the agent supplies page-bound geometry, fit, and crop focus, and the human reviews each resulting operation before application.

### `propose_field_updates`

Creates a pending change set from typed field values. Input includes document ID, base revision, values, and optional reason. Output names every affected binding.

### `propose_canvas_edits`

Creates a pending change set of validated updates to existing layers. It supports geometry, visibility, typography, shape styling, image fit/crop, and replacement by an approved ID from `search_assets`. Bound content is rejected and routed through `propose_field_updates`; arbitrary asset URLs and raw Fabric properties are not accepted.

### `propose_output_variant`

Adapts one inspected source page into a fixed output size as a single atomic proposal. Geometry scales deterministically while layer order, groups, asset references, and shared-field bindings are cloned with fresh stable IDs. The tool does not claim unconstrained responsive design.

### `publish_template`

Runs blocking validation and creates an immutable version. Returns version, parameter manifest, API playground route, and any blocking errors. Tool metadata marks it as consequential and human-confirmed.

### `render_template`

Renders one published version with supplied field values and output choices. The render appears in the same history panel used by API requests.

### `inspect_render_history`

Read-only. Returns recent persisted render jobs, request selections, status, dimensions, byte sizes, and stable artifact download routes. Storage keys, object URLs, and database records remain private.

## Route map

| Route state        | Tools                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library            | `search_assets`                                                                                                                                            |
| Editor             | `inspect_design`, `search_assets`, `validate_design`, `propose_asset_insertion`, `propose_field_updates`, `propose_canvas_edits`, `propose_output_variant` |
| Review             | Editor read tools; acceptance and rejection remain human-only in the Review panel                                                                          |
| Published template | `validate_design`, `publish_template`, `render_template`, `inspect_render_history`                                                                         |
| Render history     | `render_template`, `inspect_render_history`                                                                                                                |

Registration cleans up with the Studio surface and remains safe under React Strict Mode. Tool handlers capture current services through stable references rather than stale render closures.

## Human review contract

Proposal tools never write saved state. Their result creates a visible pending preview. The tool result should tell the agent that a human decision is required and give the change-set ID. A browser agent may continue inspecting and validating while the change set is pending, but it cannot describe the proposal as applied.

The human may accept a subset in the Review panel. Rejected operations remain in the audit record. If the current revision no longer matches the change set, the UI blocks application and the agent must inspect again.

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
