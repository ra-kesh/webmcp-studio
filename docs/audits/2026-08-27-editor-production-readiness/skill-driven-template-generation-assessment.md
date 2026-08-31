# Skill-driven template generation assessment

Date: 31 August 2026
Status: assessment complete; implementation not started
Roadmap item: `GEN-01`

## Decision

OpenPencil is a strong reference for a GPT skill that creates editable Studio
artifacts. The useful pattern is not its chat panel by itself. It is the split
between:

1. a skill that understands a brief, references, and the available design
   vocabulary;
2. a bounded intermediate design description;
3. editor-owned tools that compile that description into ordinary editable
   nodes; and
4. structural and visual checks against the rendered result.

Studio should adopt that split without adopting OpenPencil's direct live
mutation behavior. A GPT skill should author the artifact, but Studio must own
template identity, canonical node creation, validation, Review, persistence,
and rendering. The generated result must be an ordinary Studio `Document`, not
a JSX file, model transcript, opaque image, or second AI-only document model.

The smallest useful addition is one **Generate from template** workflow. A GPT
skill takes a prompt plus approved reference images, selects an exact existing
template version, proposes field values, media substitutions, and a bounded set
of typed structural edits, then hands one candidate editable document to
Studio Review. Approval creates a new document session atomically. Rejection
leaves the current document and document list unchanged.

This does not require a general in-app AI chat, new renderer, new node type, or
arbitrary JSX execution.

## What “skill” means here

The target is a reusable GPT or Codex artifact skill, comparable to a document,
presentation, or spreadsheet creation skill. It should be able to receive:

- a natural-language brief;
- one or more reference images;
- an optional template preference;
- approved Studio media or source data; and
- output requirements such as page format or document family.

The skill should produce a new, editable Studio artifact. It is more than a
help page for existing tools. It owns the authoring workflow, selection rules,
iteration strategy, and quality checks. It does not own Studio's schema or
bypass Studio commands.

The skill package should eventually contain:

- `SKILL.md` with the generation workflow and decision rules;
- compact references for Studio's template, field, asset, and command
  vocabulary;
- examples that map common briefs to template families and field plans;
- a visual-review checklist; and
- one or more small helper scripts only if deterministic preprocessing is
  required.

Studio remains the execution runtime. The skill calls Studio tools and receives
stable, inspectable results.

## How OpenPencil creates editable designs

The source was inspected at OpenPencil commit
`88c1077071328b8df68f282543f16e20e97930b4`. Its separate skill repository was
inspected at commit `623927958f277b0d8810a2582a38ae24409f7577`.

### Prompt to tool operations

OpenPencil creates a tool-loop agent with one system prompt, a typed editor tool
set, and a 50-step ceiling. Its prompt tells the model to plan the design, build
a skeleton, fill content, inspect structure, fix mistakes, and then polish. It
also tells the model to search reusable components before drawing primitives
and to batch operations rather than spend one tool call per property.

Relevant code:

- `src/app/ai/chat/transports.ts`
- `src/app/ai/chat/system-prompt.md`
- `src/app/ai/tools/index.ts`
- `packages/core/src/tools/ai-adapter.ts`

The important implementation choice is that AI operations use the same core
tool definitions as other programmable clients. After a mutation, OpenPencil
loads fonts, computes layout, renders, and records an undo entry. It does not
maintain a second graph for AI-created work.

Studio already follows the stronger form of this rule: manual changes, Review
changes, WebMCP proposals, publication, and rendering all use the canonical
document and typed command system.

### JSX as an intermediate design language

OpenPencil's `render` tool accepts a limited JSX vocabulary. It compiles JSX to
a small tree of `{ type, props, children }`, validates known element and
property names, and recursively creates normal scene-graph nodes. The JSX is
authoring syntax. It is not the saved document.

Relevant code:

- `packages/core/src/tools/create/render.ts`
- `packages/core/src/design-jsx/schema.ts`
- `packages/core/src/design-jsx/tree.ts`
- `packages/core/src/design-jsx/render.ts`
- `packages/core/src/design-jsx/renderer.ts`
- `packages/mcp/src/jsx-preprocess.ts`
- `src/app/automation/bridge/tool-handlers.ts`

Its MCP path preprocesses JSX into the same structured tree before the browser
applies it. This is the most valuable architectural lesson for Studio: a model
friendly design language should compile into the canonical model through a
small, typed boundary.

OpenPencil also has a sandboxed code-preview path with strict limits for source
bytes, output bytes, node count, depth, strings, arrays, and time. Preview
restores a captured baseline after every failed attempt and commit produces one
undoable editor operation.

Relevant code:

- `src/app/code/sandbox/types.ts`
- `src/app/code/sandbox/evaluate.ts`
- `src/app/code/sandbox/validate.ts`
- `src/app/code/sandbox/convert.ts`
- `src/app/code/live-preview.ts`

Studio should not add JSX in `GEN-01`. Existing templates already provide the
layout skeleton, and Studio's typed commands can express the bounded changes
needed for the first artifact skill. If free-form structural generation later
becomes necessary, a Studio-specific design description can use the same
compiler pattern and sandbox limits. It must compile to a complete plan before
any canonical mutation occurs.

### Reference images as untrusted design evidence

OpenPencil accepts PNG, JPEG, and WebP references, limits the count and decoded
size, downsizes them, and sends them to a separate vision pass. That pass
describes composition, hierarchy, spacing, typography, color, and shape. The
main design agent receives compact observations, not executable instructions
from the image. Visible image text is explicitly treated as design content.

Relevant code:

- `src/app/ai/attachment/image/types.ts`
- `src/app/ai/attachment/image/prepare.ts`
- `src/app/ai/attachment/image/analyze.ts`
- `src/components/ChatPanel.vue`

This boundary should be copied conceptually. A Studio reference may have one of
two roles:

1. **analysis-only reference**: the skill receives visual observations and the
   source is recorded as provenance, but the image never enters the document;
2. **approved media reference**: the skill receives a stable catalog or
   workspace asset identity that Studio may bind to an image node.

An attachment URL, local blob URL, vision-model URL, or provider-private source
must never become canonical document truth.

### Verification and skill packaging

OpenPencil can describe the resulting structure and render the current page or
selection for a separate visual critique. Its published skill teaches an agent
how to discover a document, inspect it, render JSX, modify it with tools, and
save or export it.

Relevant code:

- `src/app/ai/tools/vision.ts`
- `packages/mcp/src/tool/registration.ts`
- `packages/mcp/src/tool/manifest.ts`
- `packages/docs/programmable/mcp-server.md`
- `open-pencil/skills/skills/open-pencil/SKILL.md`

The skill does not add a new OpenPencil document model. It gives GPT a reliable
workflow over editor-owned capabilities. Studio should do the same, while
making the artifact-generation contract first class rather than relying on a
long sequence of loosely related low-level calls.

## What Studio already supports

Studio is not starting from zero. Most of the expensive foundations already
exist.

| Need                       | Existing Studio capability                                                                                                  | Assessment                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Editable artifact          | Schema-v5 `Document` with pages, outputs, nodes, groups, fields, styles, variables, components, rich text, media, and masks | Ready                                                       |
| Existing-template creation | Versioned template repository and `cloneTemplateDocument` remap every stable identity into a fresh document                 | Ready                                                       |
| Business-data population   | Typed fields, values, bindings, quotation composition, and flat render modifications                                        | Ready                                                       |
| Safe modifications         | Strict document commands with receipts, revision checks, history, replay, and no-op behavior                                | Ready                                                       |
| Agent review               | Snapshot-bound change sets with per-operation accept/reject, affected targets, provenance, preview, and one history commit  | Ready for edits to the current document                     |
| Media references           | Versioned curated assets plus managed and local asset identities, provenance, compatibility, and permission checks          | Ready for approved assets                                   |
| Template discovery UI      | Twenty-one active templates with compact catalog details, immutable previews, filters, and exact version identity           | Ready inside Studio                                         |
| Rendering                  | The normal Fabric, React, HTML, PNG, and PDF paths consume the canonical document                                           | Ready; generated documents need no new renderer             |
| Programmable control       | Twenty WebMCP tools for inspection, search, validation, proposals, publication, and rendering                               | Ready for the current document                              |
| Product command            | `document.new` exists in the command catalog                                                                                | Present, but intentionally has no typed automation contract |

Key implementation areas:

- `packages/document/src/schema.ts`
- `packages/document/src/commands.ts`
- `packages/document/src/design-templates.ts`
- `packages/document/src/change-sets.ts`
- `apps/studio/src/features/editor/template-lifecycle.ts`
- `apps/studio/src/content/library/library-template-actions.ts`
- `apps/studio/src/features/editor/review-journal.ts`
- `apps/studio/src/features/editor/use-document-editor.ts`
- `packages/webmcp/src/change-sets.ts`
- `packages/webmcp/src/registration.ts`

## What is missing

### 1. GPT cannot discover the template catalog through WebMCP

The UI can search and resolve exact templates, but WebMCP cannot list template
summaries, search by product job or format, or read one template's compact
manifest and preview identity. A skill would have to guess an ID or rely on
prompt knowledge that can become stale.

### 2. There is no new-document proposal contract

Current Review proposals target the open document at an exact revision and
snapshot. `propose_canvas_edits` updates existing nodes, while the asset,
styles, variables, components, fields, and output tools cover focused changes.
There is no proposal whose result is a different document.

Encoding a seven-page generated document as hundreds of `add_node` operations
would be the wrong abstraction. It would exceed current affected-target and
operation budgets, create a noisy Review experience, and allow partial
construction failures.

### 3. Reference analysis is not a product capability

Studio has safe asset identities but no bounded attachment-preparation and
visual-observation boundary. It cannot yet distinguish analysis-only references
from assets intended for insertion, nor record reference-analysis provenance on
a generated artifact.

The skill may perform vision analysis itself in the first slice, but Studio
still needs stable reference tokens and provenance. Otherwise the resulting
document cannot explain what influenced it.

### 4. There is no candidate-document Review

Current Review previews mutations against the active document. A generated
artifact needs a separate Review state with:

- exact base template identity;
- generated page thumbnails;
- field and media substitutions;
- structural edit summary;
- reference and skill provenance;
- validation warnings; and
- one approve or reject decision.

It must not replace or persist over the current document before approval.

### 5. The current WebMCP write surface is too low level for artifact creation

Low-level commands are useful after creation. They are not a good artifact
boundary for a GPT skill. The first tool should accept intent plus bounded
changes around an exact template and return one candidate plan. Studio should
materialize the template and run the commands itself.

### 6. No Studio artifact skill exists

There is no checked-in skill that teaches GPT how to choose a template, handle
references, respect template bindings, iterate through structural and visual
checks, and finish with an editable Studio document. That skill is a product
deliverable, not just documentation for WebMCP.

## What to adopt from OpenPencil

- A compact skill-specific vocabulary instead of asking GPT to understand the
  entire internal schema.
- One explicit plan before mutation.
- Templates or reusable components as the starting skeleton.
- Batched changes and a bounded step budget.
- A compiler from model-friendly structure to canonical nodes.
- Strict limits before any code or structure is evaluated.
- Isolated reference-image analysis whose output is untrusted evidence.
- Structural inspection after generation and visual inspection after render.
- One editor-owned undo or creation boundary for an accepted result.

## What not to copy

- Directly applying every model tool call to the live document.
- Treating JSX as the persisted artifact.
- Allowing an arbitrary image URL or attachment locator into the document.
- Letting the model choose or fabricate private renderer fields.
- Recursive mutation that can leave a partial graph when a later child fails.
- Asking the model to create a complete document one primitive at a time when a
  compatible template already exists.
- Combining new-document creation and current-document Review into one vague
  command.

OpenPencil can roll live AI steps into undo history, but Studio's current Review
boundary is safer and more legible. Generation should preserve that advantage.

## `GEN-01`: smallest production-shaped roadmap addition

### User promise

“Give GPT a brief and references. It chooses one of my Studio templates and
returns a polished, editable draft for approval.”

### Gate A: discover exact inputs

Add read-only WebMCP tools:

- `search_templates`
- `read_template`
- `read_generation_capabilities`

The response must use compact catalog projections and exact `{ id, version }`
identity. It may expose preview descriptors, field manifests, supported output
families, source requirements, and approved asset references. It must not send
canonical template document bodies, private media locators, or bytes in a list
response.

Exit criterion: a skill can select one active compatible template without
guessing or reading Studio's source code.

### Gate B: materialize one bounded candidate

Add a strict request and plan contract in `packages/document` or a small
generation package:

```ts
type DocumentGenerationRequest = {
  requestId: string
  idempotencyKey: string
  prompt: string
  template: { id: string; version: number }
  references: Array<
    | { kind: "analysis"; referenceId: string }
    | { kind: "asset"; assetId: string; assetVersion?: string }
  >
  fieldValues?: Record<string, unknown>
  assetSubstitutions?: Array<{
    nodeId: string
    assetId: string
  }>
  commands?: DocumentCommand[]
  requestedName?: string
}

type GeneratedDocumentPlan = {
  requestId: string
  template: { id: string; version: number; snapshotId: string }
  candidate: Document
  summary: {
    fields: string[]
    assets: string[]
    structuralChanges: string[]
    affectedPages: string[]
  }
  provenance: {
    skillId: string
    skillVersion: string
    references: string[]
  }
  validation: ValidationIssue[]
  warnings: string[]
}
```

The public WebMCP tool should be `propose_document_from_template`. Studio, not
GPT, must:

1. resolve the exact template again;
2. clone or compose it into a fresh canonical document;
3. resolve approved asset identities;
4. apply fields and typed commands to an isolated candidate;
5. reject the entire plan if any command, identity, permission, or resource
   check fails;
6. validate the complete candidate; and
7. render preview thumbnails.

Initial command admission should be intentionally narrow. Permit field values,
approved image substitutions, text changes, visibility, and at most 24 existing
typed post-template commands. Do not accept a model-supplied full `Document`.

Exit criterion: the same request and idempotency key always resolve to the same
candidate identity or the same stable failure, with no live-document mutation.

### Gate C: review and create the artifact

Add a separate-document Review card. It should show the selected template,
references, page thumbnails, validation state, and a compact summary of fields,
assets, and structural edits. The human gets one primary action:
**Create editable document**.

Approval persists the candidate and opens a fresh document session in one
atomic workflow. Rejection deletes the uncommitted candidate. A stale template,
missing asset, changed permission, repeated request, or persistence failure
must not leave a half-created document.

The created document then uses every existing Studio editor command, Review
tool, publish flow, and renderer without a generation-specific branch.

Exit criterion: approval creates exactly one editable document; rejection or
failure creates none.

### Gate D: package the GPT artifact skill

Add a `studio-document` skill with this workflow:

1. Read the brief and identify document job, audience, outputs, and required
   content.
2. Search exact active templates.
3. Inspect the selected template's fields, compatible outputs, and asset slots.
4. Analyze references or resolve approved asset identities.
5. Prepare one generation request rather than drawing the document node by
   node.
6. Inspect validation and rendered thumbnails.
7. Make one bounded correction if required.
8. Hand the candidate to Studio Review and stop before approval.

The first retained fixture should be:

> Create a client proposal for a two-day destination wedding using an
> editorial proposal template and these two approved visual references.

Expected result:

- the skill selects an exact template version;
- Studio clones it to a new identity;
- fields and approved media change visibly;
- the Review card shows provenance and every affected page;
- approval creates one multi-page editable document;
- direct edits, undo, publication, PNG, and PDF work through existing paths;
- a replay of the same request does not create a duplicate.

Exit criterion: a GPT with only the skill and public Studio tools can complete
the fixture without repository knowledge or private document data.

## First-slice limits

`GEN-01` should initially support:

- active Studio templates only;
- existing node, field, style, variable, component, image, and mask semantics;
- approved catalog or workspace assets only;
- analysis-only image references with bounded preparation;
- one candidate at a time;
- one exact template version per candidate;
- a bounded correction loop; and
- one human approval before persistence.

It should initially exclude:

- generating a completely blank design from arbitrary JSX;
- importing arbitrary HTML or React components;
- model-generated template publication;
- unbounded primitive-by-primitive drawing;
- direct mutation of the open document while the skill reasons;
- remote image URLs as document sources;
- multiple autonomous candidates competing in Review; and
- an embedded general-purpose chat interface.

These limits still produce a useful artifact skill. The user receives a new
editable document based on proven layouts and their references, while Studio
keeps deterministic data, Review, and render behavior.

## Later extension: structured free-form generation

If template-based generation proves too restrictive, add a Studio Design Tree
as a second phase. It should be a small JSON vocabulary, optionally authored
through JSX, that compiles to `DocumentCommand[]` in a sandbox. The compiler
must enforce node types, properties, depth, node count, text size, asset
identity, and layout bounds before applying anything.

That later phase can borrow OpenPencil's Design JSX ergonomics. It should keep
Studio's stricter transaction rule: compile and validate the whole plan first,
then create one candidate. Never mutate recursively and hope a later failure can
be undone.

## Final assessment

OpenPencil confirms that GPT can create sophisticated editable designs when it
has a small design vocabulary, reusable starting structures, normal editor
tools, and a render-inspect-correct loop. Studio already has the harder product
foundations: versioned templates, a richer business-document model, exact
commands, safe Review, deterministic renderers, and publishable API templates.

The missing piece is not a new canvas engine. It is a first-class artifact
generation envelope that lets a GPT skill choose an exact template, submit
bounded content and design decisions, preview a separate candidate, and create
one canonical editable document after approval.
