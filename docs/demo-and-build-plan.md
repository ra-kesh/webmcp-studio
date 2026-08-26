# Demo and seven-day build plan

## Demo script

Seed the browser with the Northstar Weddings proposal pack and a fictional brief. Use one fixed agent prompt that is short enough to read on screen. Preload a licensed asset set with tags so image search is deterministic.

The required beats are:

1. Inspect seven artboards and shared fields.
2. Propose coordinated text, price, and image changes.
3. Show pending previews and affected-artboard summaries.
4. Reject one image, accept the other operations, and make one manual canvas edit.
5. Ask the agent to adapt to that manual edit.
6. Publish immutable version 1.
7. Copy a render request, change its values, and produce a new PDF and PNG.
8. Show the render record beside the editable source.

Record the final video from a fresh demo session. Keep a backup video and pre-rendered outputs in case the live browser agent or Browser Run has an outage, but do not fake the judged hosted path.

## Day 1

- repository, Bun workspace, docs, and CI gate
- deploy empty Studio and Renderer Workers
- canonical schema, reducer, field binding, validation, and seed
- render one artboard through Browser Run

Exit condition: `bun run check` passes, both Workers deploy, and one R2 PNG matches the in-app preview.

## Day 2

- Fabric adapter and lifecycle
- selection, text, image, rectangle, drag, resize, rotate, delete
- zoom, pan, layer ordering, and undo
- polished Northstar proposal pages

Exit condition: manual editing survives reload and undo.

Status: implemented except freeform canvas panning. The current workspace uses
scrolling plus fit/slider zoom because that is the clearer interaction for the fixed
artboards in the demo. Drafts survive reload in local storage; D1 autosave replaces
that checkpoint on Day 3.

## Day 3

- output and page management
- shared field creation and bindings
- immutable publishing
- D1 persistence and migrations
- public template inspection and render flow

Exit condition: a copied request changes at least two outputs.

## Day 4

- real WebMCP registration
- inspection, validation, and field proposal
- canvas proposal and pending preview
- per-operation accept and reject
- revision conflicts

Exit condition: the browser agent completes the human-review loop against the live document.

## Day 5

- licensed asset library and search tool
- fixed output variant proposal
- renderer PDF assembly
- thumbnails, status updates, and render history
- API playground

Exit condition: the complete demo works once without developer intervention.

## Day 6

- visual polish and empty/error/loading states
- keyboard and accessibility pass
- public demo isolation and reset
- browser tests for the exact demo path
- deployed smoke tests and logging

Exit condition: three consecutive clean runs on the hosted URL.

## Day 7

- feature freeze
- fix only demo-blocking or data-loss bugs
- README, architecture diagram, license, and submission copy
- record video and backup capture
- test from a signed-out browser and another device

Exit condition: public repository, hosted app, video, and submission text agree about what is implemented.

## Cut order when time slips

Cut ellipse and line editing first, then grouping, custom-size blank documents, JSON import UI, extra gallery templates, smart output proposal, and non-demo API response modes. Do not cut shared fields, human review, immutable publishing, real API rendering, or render history. Those make this a product rather than a canvas demo.
