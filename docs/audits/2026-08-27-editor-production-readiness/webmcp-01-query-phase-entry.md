# WEBMCP-01 queryable document graph phase entry

Date: 2026-08-29

Status: implemented and independently accepted

## Outcome

Make the complete Studio document inspectable before expanding mutation
breadth. An agent must be able to discover every page, group, layer, output,
field binding, and relevant node without changing the user's active page or
dumping the complete private document into one response.

This is the first bounded WEBMCP-01 slice. It closes active-page-biased
inspection and hard-coded tool registration count. Canonical command
capability discovery and command-backed page/output/node mutations follow in
the next slice; this phase must not create a parallel mutation engine.

## Evidence reread

- `code-architecture-audit.md` ARCH-10 and the WEBMCP-01 backlog contract.
- `workflow-and-feature-audit.md`, `feature-parity-matrix.md`,
  `reference-patterns.md`, and the current remediation ledger.
- `packages/webmcp/src/registration.ts`, its complete registration tests, and
  `apps/studio/src/features/editor/use-studio-webmcp.ts`.
- `packages/editor/src/product-commands.ts` and Studio's actual product command
  runtime composition.
- Loora's `packages/agent/src/canvas-tools.ts` and MCP tool manifest, especially
  its compact context, tree, node, and search read vocabulary. Studio adopts
  the query separation and bounded semantic results, not Loora's website node
  model or direct-mutation policy.

## Current truth

`inspect_design` is useful but takes no query. It always returns the active
page's complete nodes and groups plus every field and output. An agent cannot
read another page precisely, inspect one complete layer with its bindings and
ancestry, or search the document graph without asking the user to navigate the
UI. This does not scale to long proposal packs or image-heavy documents.

Registration currently reports a literal tool count of ten in the React hook,
even though the registrar already returns the authoritative count. Adding a
tool can therefore make visible status lie.

## Product contract

Add three read-only tools beside the backward-compatible `inspect_design`:

1. `read_design_tree` returns a compact, ordered semantic page tree as a flat
   pre-order stream. It accepts optional `pageId`, `depth`, `cursor`, and
   `limit`. Page, group, and node records carry stable parent/page/output
   identity; the item limit applies to the complete stream, including layers,
   so a continuation can resume safely inside a very large page.
2. `read_design_node` returns one public node with page/output identity, group
   ancestry, and field bindings. Image renderer sources and browser-local IDs
   remain private.
3. `search_design_nodes` searches names and text with optional page/type
   filters and bounded opaque pagination. Results contain stable IDs and enough
   context to call `read_design_node`.

Every result includes document ID, revision, snapshot ID, and operation version
so later proposals can prove their base. Missing/stale targets return a stable
tool error and do not move selection or active page.

The existing no-input `inspect_design` shape stays compatible. It remains the
one-call active context summary and points callers to the precise graph tools.

## Safety and privacy

- Never expose image `src`, local asset IDs, R2 keys, or managed aliases.
- Bound depth, page count, result count, query length, and type filters.
- Preserve canonical page/node ordering; do not sort by display name.
- Query tools are pure reads and must not focus, select, navigate, save, or
  create review state.
- Build one graph index per tool execution. Avoid repeated whole-document scans
  inside nested projection loops.
- Tool registration count comes from the registrar result, not a literal.

## Focused acceptance

- A non-active page is readable without changing the active page.
- Nested group ancestry and canonical node order are correct.
- One node read returns exact page/output/binding context.
- Search filters by page and node type, uses deterministic pagination, rejects
  malformed cursors, and never leaks private image identities.
- Unknown page/node IDs are card-local tool errors with no state mutation.
- Existing `inspect_design` callers remain compatible.
- Registration, tool catalog, inspector tool list, and visible tool count agree.
- WebMCP package tests, Studio hook lifecycle tests, both package typechecks,
  focused lint/format, and an independent code reread pass before commit.

## Deliberate next boundary

The next WEBMCP-01 slice will expose canonical product-command capabilities by
target and route mutations through the existing command/change-set owners with
idempotency. This phase does not add direct delete/reorder/page commands, persist
review provenance, or invent a second command schema merely to increase tool
count.

## Completion evidence

- Added `read_design_tree`, `read_design_node`, and `search_design_nodes` as
  privacy-safe, snapshot-identified reads over the complete canonical document.
  `inspect_design` remains backward compatible and now resolves assets from the
  same captured snapshot instead of reading live state twice.
- Tree pagination limits the total flat pre-order semantic stream rather than
  only pages. Every continuation item retains page, output, parent, and depth
  context, and the opaque cursor is bound to the exact snapshot and filters.
- Registration now reports the registrar's actual tool count. If any one tool
  fails to register, the hook aborts every already-started registration and
  disposes the catalog before reporting Error/0.
- The first independent review rejected unbounded layer results, partial live
  registration after failure, and a stale workspace lock. All three received
  targeted repairs and regressions. The same reviewer returned **ACCEPT with no
  remaining P0/P1 blocker**.
- WebMCP tests pass **46/46**; focused Studio lifecycle/inspector tests pass
  **6/6**. WebMCP and Studio typechecks, focused Studio ESLint, scoped Prettier,
  and `git diff --check` pass. A live document route exposed all 13 registered
  tools, including the three complete-document reads.
