# TEXT-02 phase entry

Date: 2026-08-30

Status: active; architecture, Gate 1A and Gate 1B accepted

## Product outcome

Text must stop behaving like one uniformly styled string in a box. A user must
be able to select words or paragraphs, format only that selection, create and
reuse named typography/paint decisions, bind controlled values, and receive the
same result in Fabric, React previews, Renderer HTML, PNG and PDF. The same
operations must be available through product commands and WebMCP.

This phase extends the accepted `TEXT-01` direct-editing, presets, sizing and
overflow foundation. It does not replace that geometry or history model.

## Sources revisited before implementation

- `remaining-product-work-2026-08-29.md`, row `TEXT-02`;
- `production-readiness-backlog.md`, `TEXT-02`;
- `feature-parity-matrix.md`, `workflow-and-feature-audit.md`, and the explicit
  `TEXT-01` rich-text limitations;
- Studio document schema/decoder, text layout/render projection, command and
  history boundary, Fabric adapter, React render view, Renderer HTML, inspector
  and WebMCP registration;
- OpenPencil `TypographySection.vue`, scene-graph `StyleRun`, shared-style
  attachment/detachment, text drawing and Figma import/export paths;
- Loora canvas `TextRun`, typography/style model, transaction engine, export,
  React renderer and token panel.

OpenPencil remains the fidelity north star. Loora is the transaction and
API/agent-control reference. Neither source is copied or imported.

## Decisions

### Canonical rich-text representation

Each text node retains one canonical JavaScript string. Character formatting is
stored as sorted, non-overlapping half-open ranges over UTF-16 code-unit offsets:
`[start, end)`. This matches browser and Fabric selection offsets without an
adapter-specific index table.

Run invariants:

- `0 <= start < end <= text.length`;
- a boundary may not split a surrogate pair;
- runs are ordered and may not overlap;
- empty overrides are rejected;
- adjacent equal overrides normalize to one run;
- base node typography remains the fallback outside runs;
- text replacement must remap or explicitly replace ranges in the same command;
- bindings that replace the complete string clear character/paragraph ranges
  unless the command supplies a validated replacement rich-text payload.

The model will not use HTML, Markdown or editor-library JSON as canonical data.
Those formats hide selection/range semantics and make renderer parity dependent
on a particular UI library.

### Paragraph and link semantics

Paragraph metadata is separate from character appearance. It is attached to
newline-delimited paragraph ranges and owns list kind/level/start, alignment and
link-free block semantics. Links are character annotations with a validated
`https`, `mailto`, or `tel` target and explicit external-navigation behavior.

This separation prevents bullets/numbers from being baked into the text, which
is the accepted limitation of `TEXT-01` lists.

### Reusable styles and variables

The document owns named resources with stable IDs:

- typography styles: family, size, weight, italic, line height, letter spacing,
  decoration and case;
- paint styles: text/shape color and opacity decisions;
- typed variables: color, number, string and font-family values, with a later
  mode/theme extension that does not change binding identity.

A node or range can attach to a named style. Direct edits to a style-owned
property detach that attachment unless the command explicitly updates the
shared style. Updating a shared style propagates to every attachment in one
transaction. Variable bindings remain references, cannot dangle, and block
deletion while in use.

Resolved render values remain explicit and validator-checked at the canonical
boundary. Renderers never reach into UI state or silently invent a fallback.

### Migration and immutability

This feature introduces document schema version 3. Version 2 drafts migrate
explicitly to empty runs, paragraph annotations, styles and variables, with a
recorded migration result. Published version-2 templates remain immutable and
must be republished under a new version identity. No permissive schema default
may disguise old content as deliberately unstyled version-3 content.

## Implementation gates

### Gate 1 — rich-text schema, normalization and render projection

- schema version 3 and deterministic version-2 draft migration;
- character-run and paragraph contracts with normalization/validation;
- mixed-run layout measurement and line projection;
- exact Fabric, React and Renderer/PDF projection;
- clone/import/template/publish/history preservation;
- golden structural and visual parity fixtures.

### Gate 2 — range editing and everyday UX

- selection-aware bold, italic, underline, strike, color, size, weight and link;
- correct collapsed-caret typing attributes and selection-state reporting;
- paragraph/list semantics with indentation and keyboard behavior;
- floating canvas text toolbar plus inspector selection state;
- paste-as-plain and rich internal clipboard behavior;
- keyboard, screen-reader, focus and compact-sheet acceptance.

### Gate 3 — reusable typography and paint styles

- create, apply, rename, update, detach and delete-with-usage-protection;
- mixed/missing style states and clear affected-layer navigation;
- atomic propagation, undo/redo, persistence and publication;
- template catalog and API/WebMCP discovery/control.

### Gate 4 — typed variables and bindings

- color, number, string and font-family variables;
- bind/unbind controls at eligible properties;
- dependency/usage validation and protected deletion;
- atomic updates across nodes, runs, styles and field/template bindings;
- API/WebMCP capabilities and deterministic renderer resolution.

### Gate 5 — conformance and real-use closure

- Fabric/React/Renderer/PNG/PDF mixed-style corpus;
- migration, copy/paste, direct edit, history, template, field and API matrix;
- 1,000-run/100-page performance and memory bounds;
- full desktop/compact visual journey through edit, style, publish and render;
- independent code review with all P0/P1 findings closed before phase status can
  change to complete.

## Gate discipline

Before each gate, reread this contract and the exact matching reference code.
After each accepted gate, update this file, `remediation-progress.md`, and the
remaining-work row, then commit the bounded result before starting the next
gate.

## Gate 1A result — canonical range foundation

Implemented:

- strict character-style, paragraph-style and link schemas;
- one public `normalizeRichTextContent` boundary plus focused normalizers;
- sorted, non-overlapping UTF-16 half-open character and link ranges;
- surrogate-pair boundary protection so an edit cannot split an emoji;
- deterministic merging of adjacent equal character styles;
- newline-aligned paragraph annotations, including empty paragraphs;
- semantic bulleted/numbered list metadata with bounded nesting and starts;
- explicit `https`, `mailto` and `tel` link admission;
- rejection of empty style overrides and ambiguous overlapping ranges.

Evidence:

- 7/7 focused range tests pass;
- the document package typecheck passes;
- Prettier and `git diff --check` pass.

## Gate 1B result — schema attachment and migration

Implemented:

- document schema version 3 with explicit text runs, paragraph annotations,
  links, typography styles, paint styles and typed variables;
- deterministic version-1/version-2 draft migration that records initialized
  rich-text and resource collections without mutating persisted input;
- immutable version-1/version-2 template rejection in the read path, with the
  existing replacement-publication path retained;
- semantic validation for canonical ranges, duplicate resource IDs and dangling
  typography/paint attachments;
- command normalization that sorts and merges supplied ranges, rejects invalid
  boundaries, and clears stale character/paragraph/link data whenever a full
  string changes through direct editing or a bound field;
- schema-version-3 seed, quotation composition, built-in templates, render
  fixtures and Studio text-node creation.

Evidence:

- 240/240 document-package tests pass;
- every workspace package typechecks;
- focused tests cover direct and bound replacement, normalization, surrogate
  rejection, v2 migration, immutable v2 publication and dangling styles;
- Prettier and `git diff --check` pass.

Gate 1B rollout follow-up:

- Studio's neutral bootstrap and blank-document constructors now emit schema
  version 3, so the editor can mount before a routed persisted document is
  installed;
- a recognized version-1/version-2 durable draft is decoded first, then its
  body, summary, snapshot IDs, encoded length and preview invalidation are
  rewritten atomically instead of treating the expected identity change as
  corruption;
- a draft already quarantined by this exact rollout mismatch is restored from
  its retained bytes, migrated and returned to the active stores. Unrelated
  invalid quarantine records remain blocked;
- focused repository coverage proves both the direct durable migration and
  already-quarantined recovery paths. The affected live routed document was
  reopened on port 3001 and `inspect_design` confirmed its six-page document,
  canonical groups and explicit rich-text ranges.

Gate 1 remains active. Gate 1C now owns mixed-style layout and exact
Fabric/React/Renderer/PDF projection.
