# TEXT-02 phase entry

Date: 2026-08-30

Status: active; architecture and Gates 1–3 accepted, Gate 4 next

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

## Gate 2E result — semantic paragraph and list editing

Implemented:

- paragraph alignment and bulleted/numbered list state now live in canonical
  paragraph annotations rather than being written into the authored string;
- the canvas toolbar and Design inspector resolve shared/mixed paragraph state
  from the active caret or selection and apply changes to only the affected
  paragraphs;
- Enter continues a semantic list, Enter on an empty item exits it, Backspace
  at the start outdents or removes it, and Tab/Shift+Tab changes nesting without
  inserting a literal tab;
- Fabric idle rendering projects list markers while direct editing keeps the
  hidden textarea canonical. Projected marker and soft-wrap offsets are mapped
  back to source offsets before the edit session starts, preventing caret drift
  or marker text from leaking into the document.

Acceptance evidence:

- 6/6 paragraph-engine tests and 80/80 Fabric-adapter tests pass alongside the
  focused inspector/toolbar suite and document, editor and Studio typechecks;
- the live port-3001 editor created a Body layer, applied a semantic bullet,
  retained `Add body text` as canonical text, rendered the marker after edit
  exit and saved the paragraph annotation; the temporary layer was deleted and
  the saved document reloaded cleanly;
- direct-edit inspection exposed and closed a hidden-textarea/caret mismatch
  between projected markers and authored text.

Gate 2 remains active. Rich internal clipboard/plain-text paste, active-edit
marker affordance, and compact keyboard/screen-reader/focus acceptance remain
open.

## Gate 2F result — rich and plain text clipboard

Implemented:

- native copy/cut/paste events remain owned by Fabric's focused textarea, so
  browser clipboard data is available without an asynchronous permission path
  and canvas-level layer commands continue to stand down during text editing;
- internal copies write `text/plain`, a strict versioned Studio rich-text MIME
  payload and a self-identifying HTML fallback. The payload materializes
  effective character appearance, paragraph/list semantics and safe links, and
  is size-bounded and normalized as untrusted input before paste;
- rich paste replaces the selected range while retaining source runs,
  paragraphs and links; external or malformed clipboard content falls back to
  normalized plain text with the destination typing style;
- `Cmd/Ctrl+Shift+V` explicitly ignores Studio rich data and pastes plain text;
  copy/cut/paste remain one direct-edit session and therefore one history
  command on exit.

Acceptance evidence:

- 3/3 clipboard-model tests and 81/81 Fabric-adapter tests pass with document
  and editor typechecks;
- a real port-3001 `Cmd+C`/`Cmd+V` journey copied a bold 13-character range,
  inserted a newline and pasted it. The saved node retained marker-free text,
  two rich run ranges and paragraph metadata; the temporary layer was deleted
  and the browser viewport restored.

Gate 2 remains active only for the active-edit list-marker affordance and the
compact keyboard/screen-reader/focus acceptance matrix.

## Gate 2G result — active-edit markers and compact acceptance

Implemented:

- direct text editing paints semantic bullet and numbered markers as hanging
  canvas affordances while the hidden textarea, caret offsets, clipboard and
  saved document retain only authored text;
- Fabric's editing overlay owns the active marker and the normal React
  selection outline stands down, removing the duplicate badge and selection
  chrome during direct editing;
- the floating text toolbar is bounded by the compact viewport and exposes its
  complete control set through horizontal overflow without moving the editor
  shell;
- focus handoff to Fabric's hidden textarea restores document and fixed-body
  scroll positions, and the active workspace guards against the browser
  scrolling fixed chrome to reveal that textarea;
- list controls expose truthful radio state, formatting controls expose
  `aria-pressed`, and the compact Properties sheet has a labelled dialog and a
  deterministic initial focus target.

Acceptance evidence:

- 85/85 focused Bun tests and 7/7 mounted Fabric-artboard tests pass with editor
  and Studio typechecks and a clean diff check;
- live desktop and 390 px port-3001 journeys proved that markers remain visible
  during editing, canonical text and caret offsets remain marker-free, the
  toolbar stays inside the viewport, focus remains on the editing textarea,
  `Tab`, `Shift+Tab` and `Cmd+B` do not scroll the shell, and compact dialog
  semantics report the current list state;
- the temporary acceptance layer was removed and the browser viewport was
  restored to its normal size.

Gate 2 is accepted and closed. Gate 3 now owns reusable typography and paint
styles, including their complete lifecycle, propagation, history, publication
and API/WebMCP surfaces.

## Gate 3A result — canonical reusable-style lifecycle

Implemented:

- typography and paint styles are document-owned resources with stable IDs,
  unique names and strict validated values;
- one atomic command vocabulary creates, renames/updates, applies, detaches and
  deletes each resource kind across whole layers or exact text ranges;
- application stores the stable attachment and explicit resolved values;
  resource updates propagate to every attached layer/range in the same command
  and recompute managed text geometry where typography changed;
- direct edits detach the affected node or range attachment while preserving
  its last resolved appearance;
- paint styles cover text, rectangles, ellipses, lines and icons, while
  unsupported image/range targets are rejected;
- usage analysis reports affected layers and node/range attachment counts, and
  deletion is refused while any attachment remains;
- canonical validation rejects dangling attachments and duplicate resource
  names, including attachments inside rich-text runs.

Acceptance evidence:

- 268/268 document tests pass, including focused create/apply/propagate/detach,
  range, paint, direct-edit and protected-deletion coverage;
- document, editor and Studio typechecks pass, and publication/template cloning
  continues to preserve the canonical resource arrays through the existing
  immutable snapshot boundary.

Gate 3 remains active. The next slice owns the production editor UI for the
complete lifecycle, mixed/missing states and affected-layer navigation; the
following slice owns API/WebMCP discovery and control.

## Gate 3B result — reusable-style editor lifecycle

Implemented:

- text and supported shape inspectors expose document typography and paint
  resources through compact named-style controls;
- users can create a style from the current layer or active text selection,
  apply and detach it, update it from the current appearance, rename it and
  delete it once every attachment has been detached;
- the control represents no-style, mixed and missing-reference states without
  inventing a resolved value;
- exact whole-layer and rich-range usage counts are visible, deletion is
  disabled while the style is in use, and affected layers can be focused from
  the inspector;
- direct text editing resolves attachment state for the active selection, so
  applying a style to a range updates the Fabric draft immediately and commits
  through the existing direct-edit transaction boundary.

Acceptance evidence:

- document, editor and Studio typechecks pass; 16 focused document lifecycle
  tests and 15 focused inspector/toolbar/Fabric tests pass under the required
  Node 22 runtime;
- a live port-3001 compact journey created `Editorial / Hero` from the selected
  title, attached it, advanced the saved document and reported one affected
  layer with working navigation.

Gate 3 remains active only for API/WebMCP discovery and control.

## Gate 3C result — API/WebMCP discovery and reviewed control

Implemented:

- `inspect_design` now includes the document typography/paint catalog and exact
  usage, while `read_design_styles` provides a focused kind-filtered query;
- every resource exposes its stable ID, resolved values, affected layer IDs and
  whole-layer/range attachment counts;
- `propose_design_style_changes` accepts strict kind/action-specific contracts
  for create, update/rename, apply, detach and protected delete, including
  bounded UTF-16 text-range targets;
- proposals compile to the same canonical document commands used by the human
  inspector, retain exact snapshot conflict protection and stay unapplied until
  a human reviews them;
- public proposal results expose safe style IDs, values, patches and targets
  rather than reducing the operation to an opaque command name;
- the immutable published-template/render API continues to preserve and render
  these resources. Per-render mutation remains field/variable-driven rather
  than silently rewriting a published visual system.

Acceptance evidence:

- the WebMCP package typechecks; two focused canonical proposal tests and one
  end-to-end registration/provenance/preview test pass under Node 22;
- the live port-3001 document registered both tools and
  `read_design_styles({kind:"typography"})` returned `Editorial / Hero`, its
  exact values, stable ID and one whole-layer attachment;
- the existing full registration test file retains one unrelated legacy media
  fixture whose malformed managed renderer source is rejected by the current
  stricter media validator; the new style registration test is independently
  green.

Gate 3 is accepted and closed. Gate 4 next owns typed variables and bindings.
