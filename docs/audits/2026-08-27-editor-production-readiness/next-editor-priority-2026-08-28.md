# Next editor priority — template-led creation and start flow

Date: 2026-08-28

## Recommendation

After GUIDE-01B, the highest-value product slice is **TEMPLATE-01**, delivered
with the minimum **START-01** surface needed to make templates useful: a real
template catalog, a clear “create new” flow, and a useful blank-document
empty state.

This is the largest remaining gap between the current quotation demo and the
product we actually intend to sell. The editor now has credible interaction
substrate—canonical pages/outputs, hierarchical layers, typed inspector
controls, transactional transforms, command/context discovery, media
management, strict validation, and persistent guides. What it still does not
have is a truthful way to begin work. The current Templates panel is a set of
three quotation theme switches, unavailable for general documents, while a
blank document is effectively a dead end.

## What is closed enough to build on

- PAGE-01 makes page/output structure reachable and keeps the filmstrip as the
  visual gallery surface.
- NAV-01, INSPECT-01, MEDIA-01, and ASSET-02 provide the layer tree, typed
  property editing, reusable media, and safe image replacement foundations.
- HIST-01 follow-up gives ordinary move/resize/rotate gestures an explicit
  cancel/commit boundary.
- MENU-01 gives templates, pages, layers, menus, shortcuts, and context actions
  one command vocabulary.
- GUIDE-01A/B provide constraint, snapping, rulers, and persistent guide
  behavior without putting editor-only state into the canonical document.
- VALID-01 gives template/publish/import boundaries strict aggregate validation.

These phases are locally code-reviewed and non-browser verified. Their healthy
browser/pixel gates remain release evidence, not reasons to invent another
parallel implementation.

## Why this is next

The workflow audit explicitly classifies templates as misleading (WF-02) and
first run/blank creation as partial/dead-end (WF-03). The parity matrix gives
both TEMPLATE-01 and START-01 P1 priority. The current code still couples the
visible catalog to quotation themes and recomposes the whole quotation, which
is the wrong semantic model for documents and images. This blocks the Canva
side of the product: fast time-to-first-useful-result, reusable starting
points, and safe customization.

It also has a strong product-specific payoff. We can model proposal packs,
quotation covers, social images, and other document/image formats without
exposing private Stuwiz data. Each template can be a versioned, validated
canonical document with renderer-derived thumbnails, so the same asset is
trustworthy in the catalog, editor, API, and export paths.

## Bounded delivery order

1. **Template contract and repository.** Define immutable template metadata
   (id, version, name, category, tags, dimensions, preview, source document),
   validate the source with the aggregate gate, and derive previews through the
   existing renderer. Preserve quotation-specific source data semantics.
2. **Catalog experience.** Replace theme cards with searchable/category-filtered
   cards, loading/empty/error/retry states, real previews, keyboard selection,
   and compact-sheet parity. Keep templates in the left workflow panel; pages
   remain in the bottom filmstrip.
3. **Explicit creation semantics.** “Create from template” creates a new
   document by default. “Apply to current document” is a separate, confirmed,
   one-command transaction with an impact summary for pages, fields, bindings,
   and assets. Never silently recompose user work.
4. **Start and blank states.** Add recent/recovery entry points, document name
   and custom dimensions/units, and an empty-canvas action strip for Add text,
   Upload image, Add page, and Choose template. Keep the current sample clearly
   opt-in/identified rather than silently canonical.
5. **Parity and safety proof.** Test template validation/migration, preview
   identity, create/apply/undo, current-document preservation on cancel or
   failure, review-mode blocking, page/output order, media references, reload,
   compact focus behavior, and renderer/export equivalence.

## Explicitly defer

Do not start rich-text runs, components/variants, collaboration, plugins, or a
general-purpose Figma layer model in this slice. Those are valuable later, but
they do not fix the current first-run and template trust failure. Do not make
the template repository depend on private quotation data; use public fixture
documents and renderer-derived previews.

## Reference patterns to revisit at phase entry

- OpenPencil: `EditorWorkspace.vue`, page-list/theme primitives, and command /
  selection ownership for catalog and panel behavior.
- Loora: normalized document model, validated transactions, and shared agent/API
  operations; template creation and application must use the same command path
  as human actions.
- Local Canva reference: template JSON creation before navigation and template
  discovery semantics.
- Studio: `packages/document` aggregate validation, `packages/render-view`,
  managed media repository, page/output commands, and current shell's compact
  Sheet.

The phase should start only after rereading WF-02/WF-03, TEMPLATE-01/START-01,
the current remediation log, and these reference areas, then writing a bounded
phase-entry contract. The success criterion is not “more cards”; it is that a
new user can choose a trustworthy starting point, create a real multi-page
document/image, and undo or abandon the choice without losing work.
