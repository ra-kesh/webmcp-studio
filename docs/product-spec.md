# Product specification

## Product decision

Build a programmable visual document studio for service businesses.

> Turn a client brief into a polished, reviewable visual pack, then publish that design as an API template.

The first workflow uses a fictional wedding photography studio. The workflow is personal to the kind of studio operations that motivated the idea, but the repository contains no private product code, customer information, or private dataset.

This is a visual production product. It is not a booking, quotation, CRM, or client-management product. A quotation may provide source data later, but the studio starts from a typed brief and creates collateral before a booking exists.

## User and job

The primary user is a small service business that repeatedly adapts polished designs for each inquiry. Today, a designer changes the same names, dates, prices, images, and package details in several files. The final work then gets copied into a message, proposal, or another system by hand.

The studio keeps visual control with the designer while making the repeatable parts accessible to an agent and an API.

## Demo outputs

One project contains three coordinated outputs:

1. A five-page proposal, exported as PDF.
2. A portrait package card, exported as a WhatsApp-ready PNG.
3. A square follow-up card, exported as PNG.

All outputs bind to shared fields such as names, event date, package, price, validity, and hero asset. One accepted field update changes every binding.

## Core product loop

1. The human opens or creates a visual pack.
2. A browser agent inspects the current document and selection through WebMCP.
3. The agent converts a brief into typed field changes and canvas commands.
4. The app previews these commands as a change set against a known revision.
5. The human accepts or rejects each operation and may edit the canvas directly.
6. Accepted commands enter the same undoable document history as manual commands.
7. Validation checks deterministic export problems.
8. The human publishes an immutable template version.
9. A REST request supplies flat modifications and renders PNG or PDF without changing the published template.

The key proof is continuity. The human, agent, API, editor, and renderer all operate on the same document model.

## Skill-generated documents (`GEN-01`)

Studio will expose a WebMCP-first artifact-generation contract. The user gives
GPT chat a GitHub `SKILL.md`, a brief, and optional references. That skill may
link a `design.md`, examples, and images. GPT performs the reasoning and uses
Studio WebMCP to create a new editable document. Studio does not require an
in-app model or a private generation path.

The first slice supports two starts. Template mode adapts an exact active
Studio template. Blank mode uses a versioned, bounded Studio Design Plan to
create pages and editable nodes according to the skill's design guidance.
Studio validates and compiles either request as an isolated candidate, remaps
request-local identities, resolves approved assets, renders previews, and shows
skill, design-guide, and reference provenance in a separate-document Review.
One human approval creates a fresh document session atomically. Rejection
leaves the current document unchanged.

Raw executable JSX, HTML, and CSS are not public payloads. A later JSX helper
may compile to the same JSON Design Plan, but the canonical saved artifact
remains a normal Studio `Document`. Every generation, inspection, correction,
and Review handoff operation needed by GPT must be available through WebMCP.

The detailed OpenPencil assessment and phased contract are recorded in
`docs/audits/2026-08-27-editor-production-readiness/skill-driven-document-generation-assessment.md`.

## Three-minute challenge demo

### 0:00 to 0:20, credible opening state

Open the Northstar Weddings project. The left rail shows seven artboards grouped as Proposal, WhatsApp package card, and Square follow-up. Start from a polished pack instead of drawing rectangles on camera.

### 0:20 to 1:15, agent collaboration

Ask the browser agent to adapt the selected pack from a raw fictional brief. The agent should:

- inspect the active document, shared fields, outputs, and current revision
- search a seeded, properly licensed asset library
- propose names, dates, package, price, copy, and image changes
- show affected pages and nodes for each operation
- run validation for missing values, overflow, off-canvas nodes, and broken assets

The canvas and thumbnails show the pending preview. The saved document does not change yet.

### 1:15 to 1:40, human correction

Reject one proposed hero image. Keep the other changes. Make one manual edit, then ask the agent to shorten copy without reducing the font size. This proves that agent work respects current human state.

### 1:40 to 2:25, design becomes an API

Open API mode, inspect the generated parameter manifest, and publish version 1. Copy the generated request, change names and city, then render a visibly different PDF and PNG without reopening the editor.

### 2:25 to 2:55, close the loop

Show render history with template version, request payload, status, and previews. End with the editable source beside the API-produced result.

## Challenge acceptance criteria

The demo is complete when all of these pass:

- A judge can open the hosted app without credentials.
- The seeded proposal looks finished before the agent acts.
- WebMCP reads the actual open document, not a parallel demo object.
- An agent creates one multi-page pending change set.
- The human rejects one operation and accepts the rest.
- Accepted changes remain editable and undoable.
- A selected layer can become a typed API field from the UI.
- Publishing creates an immutable version.
- A copied API request renders a visibly different PNG and PDF.
- Render history identifies the version and request.
- The editor remains usable when WebMCP is unavailable.

## Editor scope

### Must ship

- seeded project gallery and blank document presets
- multi-page documents grouped into named outputs
- text, image, rectangle, ellipse, line, and simple SVG/icon elements
- select, multi-select, drag, resize, rotate, duplicate, delete, group, reorder, lock, and hide
- snapping, alignment guides, zoom, pan, fit, autosave, undo, and redo
- typography, color, stroke, opacity, radius, and image fitting controls
- image upload and a licensed seeded asset library
- own-format JSON import and export
- single-artboard PNG and multi-page PDF export
- shared typed fields and field-to-layer bindings
- agent change-set preview and operation-level review
- deterministic validation
- immutable template publishing
- API playground and render history

### Non-goals for the challenge week

- bookings, quotations, CRM, payments, contracts, or signatures
- multiplayer, comments, presence, or team permissions
- video, audio, animation timeline, or in-app image generation
- direct social publishing
- Canva or Figma import
- arbitrary responsive layout or automatic smart resize
- mobile editing
- custom font upload
- billing, metering, or customer API-key management
- background removal
- long-form document layout
- batch spreadsheet generation unless the core demo finishes early

## Shared fields

Each field has a stable key, human label, type, default value, agent description, validation, and one or more property bindings. Initial field types are text, number, currency, date, asset, color, choice, and boolean.

Bindings target a stable node ID and one property. The first binding properties are text, image source, visibility, fill, and selected style values. Published versions freeze both the manifest and bindings.

## Agent change sets

Agent writes create a change set with:

- document ID and base revision
- typed commands with stable IDs
- a short human summary per operation
- affected outputs, pages, and nodes
- before and after values
- validation warnings
- pending, accepted, or rejected status per operation

The review rail supports accept, reject, accept all, and discard all. Manual edits remain immediate. When the document revision changes under a pending change set, safe field-only changes may rebase. Geometry, deletion, and ordering changes require a fresh inspection.

## Validation

Validation stays deterministic. It checks required fields, missing node and asset references, text overflow, off-canvas bounds, incompatible duplicate field keys, invalid bindings, and renderer reachability for published assets. Subjective design scores are out of scope.

## Privacy and public-demo data

The public repository and hosted demo use synthetic people, businesses, events, messages, and prices. Demo assets must have explicit licenses or be original. The seed process must be reproducible from committed metadata so reviewers can audit every asset.
