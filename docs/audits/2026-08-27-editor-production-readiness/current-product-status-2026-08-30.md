# Current product status

Date: 2026-08-30

Status: authoritative short-form continuation ledger

This page exists to prevent the long audit history or a conversation compaction
from obscuring current truth. Detailed evidence remains in
`remediation-progress.md` and each named phase entry.

## What is genuinely built

- A canonical multi-page document and output model with nested groups, pages in
  the filmstrip, template-led creation and Stuwiz quotation composition.
- A real editor substrate: Fabric canvas, selection/multi-selection, direct
  manipulation, pointer-centred zoom/pan, guides/rulers/snapping, commands,
  context menus, command search and bounded Undo/Redo.
- Reachable desktop and compact Templates, Pages, Layers, Assets, Fields,
  Design and Review workflows with durable drafts, Recent/Trash, recovery and
  conflict handling.
- Typed text/shape/image Inspector workflows, local continuous color preview
  with one canonical commit, direct rich-text editing, links, paragraphs,
  lists, clipboard, reusable typography/paint styles and typed variables.
- Reusable components with main/instance/variant/override semantics across the
  document model, commands/history, Layers, Assets, Inspector, canvas,
  templates, Review and WebMCP.
- Immutable publication, local PNG/PDF rendering, durable render jobs,
  renderer recovery, request identity, API admission/security and Review
  provenance.
- Complete-document WebMCP queries, capability discovery, reviewed proposals
  and direct execution policy using the same canonical command boundaries as
  the visible editor.

These are not README-only claims: the repository contains 127 committed slices
through COMPONENT-01 Gate 4, focused unit/integration/browser evidence, and
retained conformance/scale artifacts.

## What is not honestly complete

1. **COMPONENT-01 Gate 5:** renderer/PDF parity, 1,000-instance behavior,
   persistence/migration/clipboard/template matrix, complete create-to-render
   journey and independent P0/P1 review.
2. **TEXT-02 closure:** the independent review found a valid long unbroken token
   that can block layout for seconds, plus missing immutable publication → real
   PNG/PDF resource-conformance evidence.
3. **OpenPencil-level visual sophistication:** core control workflows are
   accepted, including the formerly freezing color picker, but density,
   spacing, hierarchy and finish still need a deliberate visual pass.
4. **LIBRARY-02:** the template/media system works, but catalog breadth,
   categories, collections, favorites/team ownership and discovery quality are
   still far below Canva.
5. **ASSET-02 depth:** placement, crop and frame masks are real; general masks
   and a production background-removal workflow are not built.
6. **Environment proof:** deployed migrations 0012/0013 and the remaining
   deployed restart/parity/hostile-input evidence require explicit production
   authorization. Live Stuwiz retrieval still needs its upstream authenticated
   complete-source contract.

## No-bounce execution order

1. Finish COMPONENT-01 Gate 5 and close its independent review.
2. Close the two TEXT-02 P1 findings.
3. Run one bounded OpenPencil comparison and visual-sophistication pass without
   reopening already accepted command semantics.
4. Build LIBRARY-02 catalog breadth.
5. Build remaining ASSET-02 mask/background-removal depth.
6. Perform authorized deployed evidence/migrations separately from local
   product development.

Do not reopen a completed phase merely because a later phase shares its code.
Record a concrete regression against the owning phase, repair it, retain a
focused test and resume the active boundary.

## Reference ownership

- OpenPencil: editor interaction fidelity, information density and polish.
- Loora: typed transactions, shared human/agent operations, history, gestures,
  synchronization and render verification.
- Canva: template-led accessibility and ease of use.
- Orshot: external generation API and render-job workflow.
- Studio: Stuwiz/quotation contracts, deterministic multi-page docs/images,
  reviewable automation and production rendering.

## Operating constraints

- Port 3000 belongs to Stuwiz. Studio uses port 3001.
- Preserve persisted user documents and media; never solve migration problems
  by clearing storage.
- Before a gate, revisit its phase entry and the matching reference code. After
  a gate, run focused essential evidence, update the ledger and commit before
  moving forward.
