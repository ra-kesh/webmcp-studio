# LIBRARY-02 phase entry

Date: 2026-08-31

Status: Gate 1 closed; Gate 2 content and provenance is active

## Purpose

Turn Studio's working template and media paths into a library that helps people
find a useful starting point quickly, then reuse it safely. This is product
work, not a larger set of demo cards.

The result must support document and image work across several formats and use
cases. It must also keep the rules that already protect quotation data, manual
edits, media ownership, history and published output.

For a user, the finished phase should answer five questions without guesswork:

1. What can I make?
2. Which template fits this format and job?
3. Where did this template or image come from, and may I use it?
4. What have I used, saved or organized before?
5. Will choosing this item create new work or change the current document?

## Sources revisited before implementation

- `current-product-status-2026-08-30.md`;
- `remaining-product-work-2026-08-29.md`, row `LIBRARY-02`;
- `remediation-progress.md`, especially `TEMPLATE-01`, `MEDIA-01`,
  `PERSIST-01C` and `COMPONENT-01`;
- `reference-patterns.md`;
- `openpencil-editor-north-star.md`;
- `loora-editor-reference.md`;
- Studio template code:
  - `packages/document/src/design-templates.ts`;
  - `packages/document/src/built-in-design-templates.ts`;
  - `apps/studio/src/features/editor/template-catalog-model.ts`;
  - `apps/studio/src/features/editor/template-catalog-panel.tsx`;
  - `apps/studio/src/features/editor/studio-start-surface.tsx`;
  - `apps/studio/src/features/editor/template-lifecycle.ts`;
- Studio media code:
  - `packages/document/src/media.ts`;
  - `apps/studio/src/features/editor/asset-catalog.ts`;
  - `apps/studio/src/features/editor/asset-library-model.ts`;
  - `apps/studio/src/features/editor/asset-library-components.tsx`;
  - `apps/studio/src/features/editor/asset-library-dialog.tsx`;
  - `apps/studio/src/features/editor/managed-media-repository.ts`;
  - `apps/studio/src/server/media-asset-repository.ts`;
  - `migrations/0007_workspace_media_assets.sql`;
- Studio component and preview code:
  - `apps/studio/src/features/editor/component-assets-panel.tsx`;
  - `apps/studio/src/features/editor/document-preview-controller.ts`;
  - `apps/studio/src/server/page-thumbnail-http.ts`;
- local Canva clone, Avnac and Polotno files recorded in
  `reference-patterns.md`.

The reference repositories remain research material. Studio does not import or
copy their source.

## Current code state

The current paths are real and tested. They are also too small for the intended
product.

| Area                  | What works now                                                                                                                                                                                           | Missing product depth                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design templates      | Five active catalog items: two document starters and three quotation styles. The repository validates definitions, sorts deterministically, materializes fresh IDs and keeps create separate from apply. | Only three categories exist. There is no paging, recent use, favorites, collections, ownership filter or broad format coverage.                                  |
| Template previews     | Start and editor cards render the canonical first page with `Artboard`. Loading, failure, no-results and compatibility states exist.                                                                     | Every list item carries a complete preview document and every card mounts live rendering. That will not scale to a large catalog.                                |
| Template safety       | General apply shows impact and uses one canonical replacement transaction. Quotation style apply preserves source-backed content and manual structure.                                                   | New discovery work must keep these semantics. Catalog selection cannot become direct document replacement.                                                       |
| Curated media         | Six original Studio SVG assets have name, description, tags, dimensions and a license label. Local search covers that metadata.                                                                          | The set is narrow, bundled as data URIs and has no durable source manifest, categories, favorites or collections.                                                |
| Workspace media       | D1/R2 upload, recent use, name search, pagination, exact ownership, archive, recovery and reference-safe rendering exist.                                                                                | Server search is name-only. Public metadata has no description, tags, provenance, license or library category.                                                   |
| Media interface       | Recent, Uploads and Library are distinct. The dialog has upload, progress, retry, error, empty, no-results and compact states.                                                                           | There are no custom collections, durable favorites or a persistent editor-side media browser. Curated recent use is browser-local only.                          |
| Components            | The document-local Assets panel searches components, groups them by source page and inserts through canonical commands.                                                                                  | It is not a cross-document component library. The left tab is named Assets even though it contains only components.                                              |
| Start and recent work | Blank, Import, Sample, Templates and repository-backed Recent/Trash are separate choices.                                                                                                                | Template discovery is still a small flat grid. There is no recent-template or favorite-template path.                                                            |
| Ownership             | Every server media operation is constrained to the current workspace.                                                                                                                                    | Cloudflare Access currently maps one identity to one personal workspace. There is no workspace membership or role model, so a visible Team claim would be false. |

Two boundaries must remain separate:

- `DesignTemplateRepository` describes design starters and quotation styles.
- `/v1/studio/templates` stores immutable API publication versions.

LIBRARY-02 must not merge them because both contain the word template.

## Reference conclusions

Canva's useful lesson is the route to a result. A person can search by job and
format, inspect a visual preview and create a new design without understanding
the editor first. Blank work, uploads and recent designs remain separate.

The local Canva clone confirms that choosing a template should create a new
project by default. Its direct JSON loading and weak ownership checks are not
appropriate for Studio.

Polotno confirms that a large template catalog needs paged metadata and raster
previews. Studio will keep its own validation, impact explanation and canonical
transaction instead of calling raw `loadJSON`.

Avnac confirms that stored library records need validation, migration,
deterministic ordering and explicit repository methods. Its last-write-wins
behavior is not acceptable here. The Avnac repositories also carry licenses
that keep them in read-only research use.

OpenPencil sets the interaction standard. Search, filters, cards, selected
states, loading and keyboard focus should use the same compact measurements and
quiet state language as the rest of the editor.

Loora confirms the architecture already in use. Library choices must resolve to
typed document commands and the same render path used by people, APIs and
WebMCP. React cards do not own document mutation or persistence.

## Product invariants

1. **Create stays primary.** Choosing a template creates a new document unless
   the user explicitly asks to apply it to current work.
2. **Apply stays safe.** General apply keeps its impact review and one-step
   Undo. Quotation style apply keeps commercial content, source identity and
   manual edits.
3. **One canonical document.** Library metadata never becomes a second scene
   model. Materialization still produces a validated Studio document.
4. **One media identity.** Selecting managed media still refetches its exact
   workspace record before the canonical commit. List metadata cannot grant
   use permission.
5. **Private bytes stay private.** Catalog responses contain metadata and
   approved preview identities, never R2 keys, local Blob URLs, customer data
   or renderer-only sources.
6. **Published versions stay immutable.** Catalog metadata changes do not
   reinterpret a saved template version or source context.
7. **History remains meaningful.** Favorite and collection mutations do not
   enter document history. Insert, replace and apply still use named document
   transactions.
8. **Human and automation behavior agree.** WebMCP and API use the same item
   identity, compatibility and permission checks as the visible interface.
9. **Preview identity is exact.** A raster preview is tied to item ID, item
   version, renderer revision, page identity, dimensions and checksum.
10. **No invented team model.** Studio labels current content as Studio or Your
    workspace. It does not expose Team until multiple principals can be
    authorized for one workspace through explicit roles.

## Catalog contracts

List responses need a compact summary. They must not include the full canonical
document or media bytes.

A template summary needs:

- stable ID and immutable version;
- kind, name and description;
- category and use-case IDs;
- format family, orientation, dimensions and page count;
- normalized tags;
- owner kind and permission projection;
- source, license and attribution metadata;
- compatibility requirements;
- exact preview descriptor;
- favorite, recent and collection projection where authorized.

A media summary needs the same discovery and ownership fields plus MIME type,
pixel dimensions, byte count and exact selectable state. The existing strict
`PublicMediaAsset` remains the authoritative selection record. A catalog
summary does not replace it.

The shared query contract needs:

- text search;
- item kind;
- category and use case;
- format and orientation;
- ownership;
- favorites and collection;
- recent, newest and curated ordering;
- bounded limit and opaque cursor.

Query, generation and cursor identity must travel together. A response for an
old search or collection cannot append to the current result.

## Data and permission contract

The first durable library migration should add preference and collection
records rather than widen proven document or media-reference tables without
need.

Required records:

- per-principal favorite and last-used state keyed by workspace, item kind,
  item ID and immutable version;
- collections with owner principal, workspace, name, scope, revision and
  timestamps;
- ordered collection membership keyed by collection and item identity;
- optional media catalog metadata keyed to a workspace asset, with description,
  tags, source, license and attribution.

Favorite, collection and ordering changes require idempotency and an expected
revision. Repository methods must constrain workspace and principal before
returning or changing data.

Current workspaces are personal. The schema may use a forward-compatible
`workspace` scope, but the interface must call it Your workspace. Shared team
collections require a later workspace-membership and role program. LIBRARY-02
will not infer membership from a Cloudflare Access team domain.

## Implementation gates

### Gate 1 - catalog domain and compatibility

- add strict template and media summary, detail, query and page schemas;
- keep list metadata separate from materializable definitions;
- add explicit owner and permission projections;
- retain current template identity, source context and media identity;
- prove parsing, immutability, ordering, filters, cursors and malformed-data
  rejection.

Result: **closed and independently accepted on 2026-08-31.** The shared
document package now owns strict compact template/media summary, detail, query,
page and cursor contracts plus an immutable searchable index. Real projections
cover every current built-in template, curated Studio asset, authoritative
managed-media summary and browser-local asset without exposing complete
documents, data URIs, Blob URLs, R2 keys or private bytes. Provenance URLs are
HTTP(S)-only; quotation styles cannot claim availability without a quotation
source; curated asset versions and SHA-256 checksums are source-owned and
verified against exact bytes; managed selection requires authoritative
refetch; local selection retains its exact revision and rejects archived,
missing-byte or incomplete records. Locale-independent search and ordering,
cursor/query isolation, immutable snapshots and the 500-item query budget are
covered. Independent re-review found no P0/P1 blocker; 18 focused tests and
both affected package typechecks pass.

### Gate 2 - content and provenance

- split the monolithic built-in definitions into validated manifest-backed
  modules;
- add a first useful catalog of 16 to 20 templates across proposals, briefs,
  reports, media kits, presentations, invitations, social posts, stories and
  carousels;
- add 30 to 40 curated media items across photographs, backgrounds, textures,
  illustrations and graphic elements;
- record source URL, license ID and URL, attribution rule, checksum and
  dimensions for every non-original item;
- reject an item without complete provenance during the catalog build;
- keep private studio and customer data out of all seed content.

These counts are a first quality bar, not a reason to duplicate weak designs.
Each item needs distinct composition, useful defaults and a stated job.

### Gate 3 - raster preview production

- produce template previews through the existing Renderer path;
- store immutable preview metadata and hashes in the catalog manifest;
- load raster previews only for cards in or near view;
- limit preview work to three concurrent jobs;
- retain live `Artboard` only as a labelled fallback;
- keep failure local to one card with Retry while selection and other results
  remain usable.

### Gate 4 - discovery controller and interface

- add one framework-independent controller for query, cursor, refresh,
  cancellation and stale-result ownership;
- make Start and the editor Templates panel consume the same model;
- add format, use-case, category, ownership, favorite and collection filters;
- add featured, recent and favorite entry points without hiding complete search;
- retain the last successful grid during background refresh;
- keep loading, repository failure, empty catalog, no results and partial
  preview failure visibly different;
- preserve compact targets, keyboard navigation, focus return and polite result
  announcements.

### Gate 5 - favorites, recent use and collections

- add durable preference and collection migrations;
- add workspace-owned repository methods and `/v1/studio/library/*` routes;
- implement favorite, unfavorite, add, remove, rename and reorder with expected
  revision and idempotency;
- update recent use only after a successful create, insert or replace;
- reconcile cross-tab hints against an authoritative read;
- keep an item usable when a preference write fails, and show the exact failed
  preference action.

### Gate 6 - media catalog integration

- move curated media from growing JavaScript data URIs to a validated manifest
  and approved first-party content route;
- add searchable metadata for workspace media without weakening the current
  upload, archive, reference or R2 integrity rules;
- compose curated, managed and local items in one discovery model while keeping
  their ownership and availability distinct;
- refetch the exact managed record before insert, replace or field assignment;
- preserve current missing-local recovery and archive-impact behavior.

### Gate 7 - Assets information architecture

- replace the misleading Assets-equals-Components tab with one clear Assets
  workspace containing Media and Components views;
- use the same media controller and canonical insert action as the dialog;
- retain the dialog for replace, field selection and recovery tasks that need a
  focused modal flow;
- keep components document-local in this phase;
- retain current component creation, insertion, source navigation and compact
  behavior.

### Gate 8 - acceptance, scale and independent closure

- run the complete focused contract below;
- capture desktop and compact library states against the retained editor visual
  system;
- obtain an independent code review;
- close every P0 and P1 finding;
- update `remediation-progress.md`, the current status and remaining-work
  ledger before marking LIBRARY-02 complete.

## Required acceptance

### Template journeys

- find a proposal by use case, a portrait document by format and a social story
  by orientation;
- create each as a distinct durable document with remapped internal IDs;
- apply a general template only after exact impact confirmation;
- apply a quotation style without replacing quotation content or manual edits;
- Undo restores the exact prior document and source context;
- a retired or incompatible version never appears as selectable current
  content.

### Media journeys

- find curated and workspace media by name, tag, category and orientation;
- favorite an item, add it to a collection, reload and find it again;
- insert and replace from recent, favorites and a collection;
- preserve image geometry, crop, bindings, order and one-step Undo on replace;
- prevent a stale, archived, foreign or unselectable item from committing;
- keep source and license information visible before use;
- retain loading, empty, no-results, failed-list and failed-preview recovery.

### State and permission journeys

- stale query, cursor, favorite and collection responses cannot overwrite the
  active state;
- cross-tab hints cause an authoritative refresh and carry no private data;
- unauthorized collection and asset reads look the same as missing records;
- a failed preference action does not roll back a completed document change;
- Studio and Your workspace labels remain accurate in local demo and Access
  modes;
- no Team label appears without a real shared-workspace capability.

### Automation journeys

- search results expose the same stable identities and compatibility facts to
  WebMCP as the visible library;
- a WebMCP insert or template create repeats exact permission and selectability
  checks before execution;
- tool results contain no full template document, local source, R2 key or
  private media bytes;
- the resulting document command and history label match the human action.

## Performance criteria

- A 500-template query projects locally in under 50 ms on the test host.
- A warm server list response for 50 summaries completes in under 200 ms on the
  local Worker test path.
- A 1,000-item media collection keeps mounted cards bounded by virtualization
  or `content-visibility`; the acceptance report must record the actual bound.
- No more than three preview jobs run at once.
- Changing query or filters never shows an old result as current.
- Search-to-visible-result interaction stays below 250 ms p95 after the search
  debounce in the browser scale fixture.
- Opening or scrolling a catalog must not mount complete document renderers for
  every item.
- Preview and object URLs have bounded caches and release after their last
  consumer.

These are acceptance budgets, not estimates. Evidence must record the fixture,
browser, machine and measured result.

## Data-safety criteria

- catalog manifests reject malformed documents, missing previews, bad hashes,
  unsupported licenses and incomplete attribution;
- list endpoints never include canonical document bodies, R2 keys or private
  sources;
- template details resolve by exact ID and version before materialization;
- managed media resolves by exact workspace and current revision before use;
- favorites and collections cannot make an archived or foreign asset
  selectable;
- migration failure leaves existing template and media workflows readable;
- no acceptance step clears IndexedDB, local media or persisted documents;
- seed assets contain no personal or customer data;
- deployment migrations remain separately authorized.

## Deliberate exclusions

LIBRARY-02 does not include:

- real-time collaboration or presence;
- organization roles, workspace invitations or shared-team administration;
- publishing components across documents or workspaces;
- a public marketplace, payments or creator payouts;
- arbitrary remote image search or URL ingestion;
- general masks or background removal;
- AI-generated template or media content;
- destructive replacement that bypasses the existing apply contract.

The schema may leave room for a shared workspace. The product cannot call a
personal workspace a team to make the library appear more complete.

## Completion rule

LIBRARY-02 is complete only when the catalog has useful breadth, every item has
trustworthy metadata and preview identity, discovery works at the stated scale,
favorites and collections survive reload, ownership labels are true, template
and media selection retain their existing safety checks, desktop and compact
journeys pass, and independent review has no open P0 or P1 finding.

Adding more hard-coded cards or a palette-only template does not satisfy this
phase.
