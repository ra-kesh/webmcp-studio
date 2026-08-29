# WebMCP integration

## Product rule

WebMCP is an adapter over product services. It does not maintain another document, mutate Fabric objects directly, or duplicate validation and publishing logic.

The Studio registers one stable tool surface because editing, review, publishing, and render history share a single application route. Every state-dependent handler reads the current service snapshot when called. The human resolves proposals in the visible Review panel; an agent cannot approve its own changes.

## Tool catalog

### `inspect_design`

Read-only. Returns revision, the active page, its public canonical layers, selection, shared fields, bindings, outputs, pending changes, and the host's current typed command capabilities. Stable node IDs replace DOM selectors and Fabric serialization. Image layers expose stable asset IDs and crop metadata, never private renderer sources. Every field includes its agent description, executable validation contract, display value, and exact binding targets across pages and outputs. Command availability is projected by the same runtime policy used by Studio controls, including transient reasons such as image decode readiness; clients must not infer enablement from document shape alone.

### `get_capabilities`

Read-only. Projects every canonical Studio product command through the same `resolveProductCommand` policy used by menus, command search, structure controls, shortcuts, and canvas actions. Results include exact snapshot identity, stable target, typed argument contract, concrete alignment/distribution variants, enabled/checked state, exact disabled reason, mutation/destructive metadata, and the command's permitted execution modes. Optional filters cover command ID, category, scope, enabled state, and stable current/page/output targets. Commands that require a picker, dialog, download, publish/render workflow, or another purpose-built contract remain discovery-only and name the specialized tool when one exists.

### `execute_product_command`

Executes only capabilities returned by the canonical command resolver. The caller supplies a capability ID, mode, stable target selector, exact document/revision/snapshot/operation/active-page/selection preconditions, and an idempotency key; it cannot submit an invented command target or arbitrary editor arguments. `dry_run` validates without side effects. `proposal` compiles the same document operations used by Studio and creates a pending Review item without accepting or applying it. `direct` is restricted to an explicit allowlist of non-document session commands such as tool selection, canvas fit/reset, and selection copy. Document mutations are proposal-only; file pickers, dialogs, exports, publishing, rendering, and other open-world workflows remain purpose-built or unsupported.

Receipts are concurrency-safe, bounded, and scoped to the live WebMCP registration. Exact concurrent/repeated requests share their result; reusing a key for different input fails. Proposal IDs are deterministic for the request, but proposal receipt persistence across a page reload is deliberately not claimed until Review history is durable.

### `read_design_tree`

Read-only. Returns the canonical front-to-back page, group, and layer tree without navigating the editor. The tree is a bounded pre-order stream whose items include `pageId`, `outputId`, `parentId`, and `depth`, so a continuation can resume inside a large page without repeating or dumping the complete hierarchy. Callers can request one page, cap hierarchy depth, and paginate the total semantic item stream with an opaque snapshot-bound cursor. Every response carries document ID, revision, snapshot ID, and operation version.

### `read_design_node`

Read-only. Returns one stable layer with its page, output, group ancestry, and shared-field bindings. Image layers retain public crop and geometry data but never expose renderer URLs, managed source aliases, or browser-local references.

### `search_design_nodes`

Read-only. Searches stable layer names and text across the complete multi-page document, with optional page and layer-type filters. Results preserve canonical page and stack order, are capped and cursor-paginated, and contain enough context to request a precise node read.

### `search_assets`

Read-only. Searches the approved, renderer-safe Studio catalog by query, orientation, and tags. Results include a stable asset ID, dimensions, description, tags, and license while source URLs remain private to the product service.

### `validate_design`

Read-only. Runs both aggregate document validation and the publication/render policy. The result separates blocking errors from warnings and names affected fields, pages, and nodes, so a design cannot pass agent validation and then fail the same policy at publish time.

### `propose_asset_insertion`

Creates one pending review that can combine typed shared-field updates with an image-layer insertion from an approved `search_assets` ID. Studio resolves the private renderer source; the agent supplies page-bound geometry, fit, and crop focus, and the human reviews each resulting operation before application.

### `propose_field_updates`

Creates a pending change set from typed field values. Input includes document ID, base revision, values, and optional reason. Values must honor the inspected field type and validation metadata. Dates use ISO `YYYY-MM-DD`, quotation currency uses canonical INR decimals, colors use the safe CSS subset, choices use configured values, and asset fields accept only approved IDs returned by `search_assets`. Output names every affected binding without exposing renderer sources.

### `propose_canvas_edits`

Creates a pending change set of validated updates to existing layers. It supports geometry, visibility, typography, shape styling, image fit/crop, and replacement by an approved ID from `search_assets`. Bound content is rejected and routed through `propose_field_updates`; arbitrary asset URLs and raw Fabric properties are not accepted.

### `propose_output_variant`

Adapts one inspected source page into a fixed output size as a single atomic proposal. Geometry scales deterministically while layer order, groups, asset references, and shared-field bindings are cloned with fresh stable IDs. The tool does not claim unconstrained responsive design.

### `publish_template`

Runs blocking validation and creates an immutable version. The call must include the exact document ID, revision, and snapshot ID returned by `inspect_design`; revision equality alone is not enough because Undo branches can reuse a revision number for different bytes. Returns version, parameter manifest, API playground route, and any blocking errors. Registration metadata marks it as a non-read-only, non-destructive, idempotent open-world operation; Studio policy still requires explicit human intent before calling it.

### `render_template`

Renders one published version with supplied field values and output choices. The render appears in the same history panel used by API requests. Registration metadata marks it as a non-read-only, non-destructive, non-idempotent open-world operation because each call creates a persisted job.

### `inspect_render_history`

Read-only. Returns recent persisted render jobs, request selections, status, dimensions, byte sizes, and stable artifact download routes. Storage keys, object URLs, and database records remain private.

## Route map

| Route state        | Tools                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Library            | `search_assets`                                                                                                                                                                                                                                                          |
| Editor             | `inspect_design`, `get_capabilities`, `execute_product_command`, `read_design_tree`, `read_design_node`, `search_design_nodes`, `search_assets`, `validate_design`, `propose_asset_insertion`, `propose_field_updates`, `propose_canvas_edits`, `propose_output_variant` |
| Review             | Editor read tools; acceptance and rejection remain human-only in the Review panel                                                                                                                                                                                        |
| Published template | `validate_design`, `publish_template`, `render_template`, `inspect_render_history`                                                                                                                                                                                       |
| Render history     | `render_template`, `inspect_render_history`                                                                                                                                                                                                                              |

Registration cleans up with the Studio surface and remains safe under React Strict Mode. Tool handlers capture current services through stable references rather than stale render closures.

## Human review contract

Proposal tools never write saved state. Their result creates a visible pending preview. The tool result should tell the agent that a human decision is required and give the change-set ID. A browser agent may continue inspecting and validating while the change set is pending, but it cannot describe the proposal as applied.

The human may accept a subset in the Review panel. Rejected operations remain in the audit record. If the current revision no longer matches the change set, the UI blocks application and the agent must inspect again.

## Security and privacy

- Tool output returns compact product data, not database records or secret URLs.
- Asset search returns only assets in the current demo workspace.
- WebMCP asset writes accept approved catalog IDs; arbitrary external URLs are rejected before a proposal is created.
- Consequential tools state their side effects in metadata.
- Published versions cannot reference local blobs or private browser-only URLs.
- Tool errors never include secrets, binding names, SQL, or stack traces.
- Cancellation stops unfinished proposals and does not leave a hidden change set.

## Challenge proof

The demo should make the WebMCP contribution visible. An ordinary API-only agent cannot know which page is active, what the human selected, which image the human rejected, or whether a pending preview is still open. WebMCP supplies that shared live context while the product keeps all writes reviewable.
