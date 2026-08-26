# Editor readiness

The editor is the product. Database, account, billing, and deployment work stays
behind the editor gate below.

## Current state

Working today:

- canonical document history with autosave, undo, and redo
- Fabric selection, multi-selection, drag, resize, rotate, and inline text editing
- text, rectangle, ellipse, line, SVG icon, and uploaded image insertion
- layer selection, visibility, locking, step ordering, duplicate, and delete
- multi-selection alignment, distribution, front/back ordering, and copy/paste
- zoom, fit, page switching, single-artboard PNG export, and ordered multi-page PDF export
- hand-tool, Space-drag, and middle-button workspace panning
- page-edge, page-center, and object snapping with visible guides
- equal-spacing snapping with measured horizontal and vertical gap guides
- align-to-page and zoom-to-selection controls
- local image restoration through IndexedDB without serializing blob URLs
- searchable original asset library with self-contained renderer-safe artwork
- deterministic image cover/contain, focal position, replacement, and alt text
- undoable Studio JSON import and self-contained document export
- canonical nested groups and full page/output management
- blank-format and proposal-starter document gallery
- basic text, shape, geometry, opacity, and field controls

This is a useful interaction base, not a finished editor.

## Editor gate

Do not schedule D1 persistence, accounts, billing, or production API-key work
until all four blocks below pass their exit conditions.

### 1. Authoring primitives and assets

- [x] ellipse, line, and simple SVG/icon nodes in the canonical schema
- [x] image upload with durable local asset storage
- [x] seeded licensed asset library, search, and insertion
- [x] image cover/contain, crop position, replace, and alt text
- [x] own-format JSON import and export

Exit condition: a new blank artboard can be designed without editing source code
or pasting an image URL.

### 2. Canvas precision

- [x] hand-tool pan, Space-drag pan, and middle-button pan
- [x] page-edge, center, and object snapping
- [x] visible alignment guides
- [x] equal-spacing guides
- [x] align to selection
- [x] align to page
- [x] reliable keyboard nudging
- [x] zoom to selection

Exit condition: a designer can create a clean layout without typing every
coordinate in the inspector.

### 3. Structure and document management

- [x] canonical groups with group and ungroup
- [x] complete layer ordering, rename, lock, hide, and nested group rows
- [x] add, duplicate, rename, reorder, and delete pages
- [x] create and manage named output groups and page dimensions
- [x] gallery and blank-document entry flow

Exit condition: the user can build and reorganize a multi-output pack entirely
inside the product.

### 4. Appearance and export fidelity

- [x] font family, weight, size, line height, letter spacing, and text alignment
- [x] fill, stroke color, stroke width, opacity, and corner radius
- [x] deterministic image fitting and crop position
- [x] validation for overflow, off-canvas nodes, missing assets, and invalid bindings
- [x] preview parity between Fabric, DOM render view, PNG, and multi-page PDF

Exit condition: the same document looks materially identical in the editor,
thumbnail, PNG, and PDF.

## Product loop after the editor gate

- [x] create and edit typed shared fields
- [x] bind and unbind compatible layer properties
- [x] propagate field values through every bound output
- [ ] preview agent change sets without mutating the document
- [ ] accept or reject operations individually, then apply once
- [ ] publish immutable template versions
- [ ] exercise published templates through the API playground
- [ ] inspect render requests and generated assets in render history

D1 and R2 support this proven workflow after the product loop is complete; they
do not define it prematurely.
