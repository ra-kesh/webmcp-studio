# TEXT-02 phase entry

Date: 2026-08-30

Status: active; architecture and Gate 1 accepted, Gate 2 active

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

## Gate 1C result — mixed-style projection and retained parity

Implemented:

- one deterministic rich-text projector for per-run family, size, weight,
  italic, decoration, color, line height and letter spacing;
- UTF-16 source offsets, safe link annotations, paragraph alignment and
  semantic list-prefix projection without changing canonical authored text;
- mixed-height soft wrapping, deterministic justified intermediate lines and
  unstretched final lines;
- explicit React and Renderer HTML line/segment output, including safe anchors;
- Fabric canonical display styles and raw-edit styles, mixed line heights,
  measured per-segment Canvas placement, edit/cancel restoration and run-aware
  font readiness;
- render-policy rejection of unmanaged run fonts;
- golden rich-text structural and lossless visual fixtures across React,
  Fabric, Renderer PNG and Renderer PDF;
- rich-range preservation through semantic duplication and immutable template
  publication. Full-document history already snapshots this same golden rich
  fixture exactly.

Acceptance evidence:

- 177/177 focused tests pass across document, editor, render view, renderer,
  Studio and the ink-geometry boundary (including 8/8 geometry cases);
- document, editor, render-view, renderer and Studio typechecks pass;
- the canonical structural verifier passes;
- immutable local capture run
  `2026-08-30T09-50-42.082Z-461a7857-e1fa-434a-b02d-c10a1a64dbbe`
  retains all 12 report-bound artifacts at exact page dimensions;
- the existing raw thresholds remain unchanged. The simple centered-text page
  retains the one-pixel complete-page geometry rule. The mixed-color rich-text
  page additionally requires the raw changed-pixel ratio to remain below 1.5%,
  exact line count, at most four edge pixels for synthesized italic/variable
  Canvas glyph metrics, at most 10% coverage and contrast drift, and at most
  0.01 baseline-relative foreground-direction drift. Fabric, React and PDF all
  pass; raw failures remain visible in the report rather than being erased;
- visual inspection of the retained rich page confirms matching run styling,
  list marker, whitespace, wrapping, decoration, shapes and page geometry.

Gate 1 is accepted. Gate 2 now owns selection-aware range editing and the
everyday rich-text toolbar/inspector workflow.

## Gate 2A/2B result — selection engine and first direct-edit surface

Implemented:

- one canonical UTF-16 selection/range-editing engine with directional
  selection normalization, surrogate-safe boundaries, shared/mixed style
  reporting, collapsed-caret inheritance and explicit typing overrides;
- interval-based character-style application plus text replacement that remaps
  runs, paragraphs and links together without expanding the document into one
  record per character;
- a Fabric direct-edit session that translates grapheme indexes to canonical
  offsets, preserves rich payload through typing/deletion/paste, applies live
  selection formatting and commits the complete text edit as one history step;
- a first context toolbar for bold, italic, underline, strike, size, weight and
  color, including mixed states and focus-safe mouse interaction;
- a fixed workspace scroll boundary so focusing Fabric's hidden editing
  textarea cannot zoom or scroll the surrounding application chrome away.

Acceptance evidence:

- 91/91 focused document, Fabric-adapter and toolbar tests pass;
- document, editor and Studio typechecks pass;
- the live port-3001 editor retained the formatting toolbar while applying a
  bold selection, kept `window.scrollY` at zero during direct editing, and
  returned to the fitted page without leaving the temporary verification layer;
- Prettier and `git diff --check` pass.

Gate 2 remains active. Link set/remove UX, selection-aware inspector state,
semantic paragraph/list keyboard behavior, rich internal clipboard/plain-text
paste and compact keyboard/screen-reader/focus acceptance remain open.

## Gate 2C result — selection-aware text links

Implemented:

- canonical shared/mixed/none link state for a selected UTF-16 range or a
  collapsed caret inside an existing link;
- exact set, replace, split and remove operations that preserve unaffected
  annotations and reject a collapsed caret outside a link;
- a compact focus-safe link editor with schemeless `https://` normalization,
  explicit `https`, `mailto` and `tel` admission, new-tab policy, inline errors
  and no browser prompt;
- direct-edit handoff that commits the current rich text once, applies the link
  as one document update, waits for the latest Fabric sync, then restores the
  exact directional text selection for continued editing.

Acceptance evidence:

- 102/102 focused document, Fabric-adapter, artboard-lifecycle, toolbar and link
  editor tests pass;
- document, editor and Studio typechecks pass;
- the live port-3001 editor added, reopened and removed an `https` link, kept
  the same text range active across both document synchronizations, and left
  the canonical link array empty after removal;
- the temporary verification layer was removed after the live journey.

Gate 2 remains active. Selection-aware inspector state, semantic paragraph/list
keyboard behavior, rich internal clipboard/plain-text paste and compact
keyboard/screen-reader/focus acceptance remain open.

## Gate 2D result — truthful selection inspector

Implemented:

- the Design inspector now receives the same live character-selection model as
  the canvas toolbar instead of reading only whole-layer defaults;
- caret/selection identity, grapheme-aware selected-character count,
  shared/mixed font, color, size, weight, line-height, tracking, decoration and
  link state are exposed without inventing a value;
- focus-safe inspector controls apply size, weight, emphasis, decoration, color
  and link actions to the active range while retaining Fabric textarea focus;
- whole-layer typography is explicitly separated under `Layer defaults`, so a
  selected range and the layer's fallback values no longer look like two
  conflicting controls.

Acceptance evidence:

- 7/7 focused inspector and formatting-model tests pass, including mixed font
  sizes, linked text and the selection/default boundary;
- Studio typecheck, Prettier and `git diff --check` pass;
- at the live desktop breakpoint, selecting all 13 characters updated both the
  canvas bar and Design inspector, clicking Bold kept the hidden textarea
  focused with offsets 0–13, and both surfaces changed to weight 700;
- the temporary layer was removed and the browser viewport override reset.

Gate 2 remains active. Semantic paragraph/list keyboard behavior, rich internal
clipboard/plain-text paste and compact keyboard/screen-reader/focus acceptance
remain open.
