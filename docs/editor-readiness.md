# Editor readiness

The editor is the product. Database, account, billing, and deployment work stays
behind the editor gate below.

## Current state

Working today:

- canonical document history with autosave, undo, and redo
- Fabric selection, multi-selection, drag, resize, rotate, and inline text editing
- text and rectangle insertion
- layer selection, visibility, locking, step ordering, duplicate, and delete
- multi-selection alignment, distribution, front/back ordering, and copy/paste
- zoom, fit, page switching, and single-artboard PNG export
- basic text, rectangle, image URL, geometry, opacity, and field controls

This is a useful interaction base, not a finished editor.

## Editor gate

Do not schedule D1 persistence, accounts, billing, or production API-key work
until all four blocks below pass their exit conditions.

### 1. Authoring primitives and assets

- ellipse, line, and simple SVG/icon nodes in the canonical schema
- image upload with durable local asset storage
- seeded licensed asset library, search, and insertion
- image cover/contain, crop position, replace, and alt text
- own-format JSON import and export

Exit condition: a new blank artboard can be designed without editing source code
or pasting an image URL.

### 2. Canvas precision

- hand-tool pan and space-drag pan
- page-edge, center, and object snapping
- visible alignment and equal-spacing guides
- align to selection and align to page
- zoom to selection and reliable keyboard nudging

Exit condition: a designer can create a clean layout without typing every
coordinate in the inspector.

### 3. Structure and document management

- canonical groups with group and ungroup
- complete layer ordering, rename, lock, hide, and nested group rows
- add, duplicate, rename, reorder, and delete pages
- create and manage named output groups and page dimensions
- gallery and blank-document entry flow

Exit condition: the user can build and reorganize a multi-output pack entirely
inside the product.

### 4. Appearance and export fidelity

- font family, weight, size, line height, letter spacing, and text alignment
- fill, stroke color, stroke width, opacity, and corner radius
- deterministic image fitting and crop position
- validation for overflow, off-canvas nodes, missing assets, and invalid bindings
- preview parity between Fabric, DOM render view, PNG, and multi-page PDF

Exit condition: the same document looks materially identical in the editor,
thumbnail, PNG, and PDF.

## Product loop after the editor gate

Once the four blocks pass, finish shared field creation and binding, agent change
set previews, operation-level review, immutable publishing, the API playground,
and render history. D1 and R2 then support a proven workflow instead of defining
one prematurely.
