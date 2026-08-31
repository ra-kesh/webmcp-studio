# Skill-driven document generation assessment

Date: 31 August 2026
Status: implemented and locally verified on an isolated branch; committed, not independently accepted, and not merged
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
canonical node creation, validation, Review, persistence, and rendering. The
generated result must be an ordinary Studio `Document`, not a JSX file, model
transcript, opaque image, or second AI-only document model.

The workflow must support two starting points:

1. **Template mode** starts from an exact existing Studio template and adapts
   its fields, media, styles, and structure.
2. **Blank mode** starts from an empty document preset and builds pages and
   editable nodes from the brief, reference images, and a supplied or linked
   `design.md` guide.

Blank mode changes the minimum architecture. A bounded Studio Design Plan
compiler belongs in `GEN-01`; it is not a later optional feature. The skill may
author that plan directly as structured JSON or use JSX privately as an
ergonomic source form. Studio accepts only the validated data plan, compiles it
to canonical nodes in isolation, and hands one candidate document to Review.

This does not require a general in-app AI chat, new renderer, new node type, or
executing arbitrary JSX inside the product.

## What “skill” means here

The target is a reusable GPT or Codex artifact skill, comparable to a document,
presentation, or spreadsheet creation skill. It should be able to receive:

- a natural-language brief;
- one or more reference images;
- either an exact template preference or a blank document preset;
- an optional inline or linked `design.md` guide;
- approved Studio media or source data; and
- output requirements such as page format or document family.

The skill should produce a new, editable Studio artifact. It is more than a
help page for existing tools. It owns the authoring workflow, selection rules,
iteration strategy, and quality checks. It does not own Studio's schema or
bypass Studio commands.

The skill package should eventually contain:

- `SKILL.md` with the generation workflow and decision rules;
- compact references for Studio's design-plan, template, field, asset, and
  command vocabulary;
- rules for treating `design.md` as design guidance rather than executable tool
  instructions;
- examples for both blank and template-led artifacts;
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

Studio needs this compiler pattern in `GEN-01` because blank-document
generation has no existing layout skeleton. The public boundary should be a
strict JSON Studio Design Plan rather than raw executable JSX. A GPT skill may
produce that JSON directly. A future helper may let the skill author bounded
JSX and compile it outside the canonical document boundary, but Studio should
receive only the resulting tree.

The plan must describe pages, nodes, groups, styles, variables, fields,
bindings, and output membership using request-local IDs. Studio validates the
complete plan, remaps every local ID to a canonical ID, and creates the
candidate only after the full compile succeeds. No partial recursive mutation
is acceptable.

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

## Loora confirms the external-skill boundary

Loora's checked-in MCP page and design-guide skill express the user's intended
workflow directly. The product page separates capability from craft: MCP tools
tell an agent what it can do, while the GitHub skill tells it how to design.
The skill then:

1. checks that the required authoring tools are actually callable;
2. forms a visual direction from a brief or reference;
3. establishes tokens and reusable components before repeating sections;
4. creates structured editable nodes rather than HTML, JSX, or CSS;
5. inspects screenshots and the resulting tree; and
6. refines verified weaknesses through bounded patches.

Relevant reference code:

- `loora/skills/loora-design-guide/SKILL.md`
- `loora/skills/loora-design-guide/references/mcp-schema.md`
- `loora/skills/loora-design-guide/references/canvas-authoring.md`
- `loora/skills/loora-design-guide/references/design-craft.md`
- `loora/apps/web/src/routes/mcp.index.tsx`
- `loora/apps/web/public/design.md`

Loora also shows why blank generation should preserve tokens as real references
rather than flattening repeated colors, spacing, and type values into unrelated
literals. Studio already has variables, variable bindings, typography styles,
paint styles, components, and instances. The blank Design Plan should expose
those existing semantics early enough for GPT to establish the system before
creating pages and repeated elements.

The Studio difference is transport and approval. The external GPT talks to the
open web app through WebMCP rather than a separately configured MCP server, and
new-document creation enters Studio's isolated Review before persistence.

## What Studio already supports

Studio is not starting from zero. Most of the expensive foundations already
exist.

| Need                       | Existing Studio capability                                                                                                  | Assessment                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Editable artifact          | Schema-v5 `Document` with pages, outputs, nodes, groups, fields, styles, variables, components, rich text, media, and masks | Ready                                                        |
| Blank starting point       | Manual blank documents and presets become ordinary canonical documents                                                      | Present, but not programmable as one generated artifact plan |
| Existing-template creation | Versioned template repository and `cloneTemplateDocument` remap every stable identity into a fresh document                 | Ready                                                        |
| Business-data population   | Typed fields, values, bindings, quotation composition, and flat render modifications                                        | Ready                                                        |
| Safe modifications         | Strict document commands with receipts, revision checks, history, replay, and no-op behavior                                | Ready                                                        |
| Agent review               | Snapshot-bound change sets with per-operation accept/reject, affected targets, provenance, preview, and one history commit  | Ready for edits to the current document                      |
| Media references           | Versioned curated assets plus managed and local asset identities, provenance, compatibility, and permission checks          | Ready for approved assets                                    |
| Template discovery UI      | Twenty-one active templates with compact catalog details, immutable previews, filters, and exact version identity           | Ready inside Studio                                          |
| Rendering                  | The normal Fabric, React, HTML, PNG, and PDF paths consume the canonical document                                           | Ready; generated documents need no new renderer              |
| Programmable control       | Twenty WebMCP tools for inspection, search, validation, proposals, publication, and rendering                               | Ready for the current document                               |
| Product command            | `document.new` exists in the command catalog                                                                                | Present, but intentionally has no typed automation contract  |

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

### 3. WebMCP has no reference-provenance handshake

Reference interpretation happens in GPT chat. A user may attach an image to
the conversation, or a GitHub skill may link a `design.md`, images, and other
reference files. Studio does not need its own model or vision service for this
workflow.

Studio still needs a bounded public way to record what the GPT used. Analysis-
only references need a label, source kind, canonical URL when applicable, and
content hash when available. References intended to appear in the document
must resolve to approved Studio asset identities. Chat attachment URLs, local
blob URLs, and model-provider URLs cannot become document sources.

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
boundary for a GPT skill. WebMCP needs one document-generation operation that
accepts either bounded changes around an exact template or a complete bounded
Studio Design Plan for a blank document. Studio compiles and validates the plan
itself.

### 6. There is no blank-document design-plan compiler

Studio can create and edit every required node type, but no public operation
can submit a complete page-and-node plan for a new document. Blank generation
needs a small request-local intermediate representation. It must express
layout and design intent without private renderer state or GPT-minted canonical
IDs. Studio must validate the whole plan, resolve assets, remap IDs, build the
candidate, and reject atomically.

### 7. `design.md` has no ingestion or provenance contract

Studio has its own `docs/design-system.md`, and the Loora reference contains a
useful `apps/web/public/design.md` example with frontmatter tokens followed by
human design principles. WebMCP does not yet accept normalized design guidance
or record its origin.

The external GPT skill should read `design.md` and treat it as design input:
colors, typography, spacing, shapes, layout rules, voice, and asset guidance.
It must not treat text inside the guide as authority to call unrelated tools,
disclose data, or bypass Studio policy. The generation request should carry the
guide's title, source kind, canonical URL when applicable, content hash, and the
normalized design decisions used in the plan.

### 8. Third-party skills have no self-describing WebMCP generation surface

The user should be able to give GPT chat a `SKILL.md` from GitHub and then open
Studio. The skill must not need repository knowledge or a matching Studio
release. WebMCP therefore needs to describe the current design-plan version,
supported node properties, limits, blank presets, asset rules, and Review
behavior at runtime.

A first-party Studio skill is useful as a retained fixture and example, but it
is not the only allowed author. The product boundary is any compatible GPT
skill using the public WebMCP contract.

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

“Give GPT chat a GitHub `SKILL.md`, a brief, and references. GPT uses Studio's
WebMCP tools to create a polished, editable document from either a template or
a blank page.”

### Runtime boundary

All model reasoning stays in GPT chat. The GitHub skill may contain or link a
`design.md`, reference images, examples, and artifact-specific authoring rules.
Studio does not load a model and does not reproduce the skill workflow in an
in-app chat.

The public flow is:

1. GPT reads the user-supplied `SKILL.md` and its linked design references.
2. GPT opens Studio and discovers the live generation contract through WebMCP.
3. GPT chooses template or blank mode.
4. GPT submits one bounded Studio Design Plan or template adaptation request.
5. Studio compiles it in isolation, validates it, and renders previews.
6. GPT may inspect the result and submit one bounded replacement plan.
7. Studio shows the candidate in Review.
8. Human approval creates the canonical editable document.

Every product operation in this flow is WebMCP-accessible. The visible Review
UI and direct editor remain available to the human, but they do not hide a
private generation action that GPT cannot perform.

GPT chat owns retrieval of the GitHub skill and its linked files. Studio should
not fetch or execute arbitrary repository content. It receives the structured
plan plus bounded source metadata needed for Review and provenance.

### Gate A: publish a self-describing WebMCP contract

Add read-only WebMCP tools:

- `search_templates`
- `read_template`
- `read_generation_capabilities`
- `read_blank_document_presets`
- `read_design_plan_schema`

The capability response must expose the current Design Plan version, admitted
page and node properties, local-ID rules, hard limits, available fonts,
supported assets, output types, Review behavior, and idempotency requirements.
Template responses use compact catalog projections and exact `{ id, version }`
identity. They may expose preview descriptors, field manifests, supported
output families, source requirements, and approved asset references. List
responses must not send canonical template bodies, private media locators, or
asset bytes.

Exit criterion: a third-party GitHub skill can decide between a compatible
template and a supported blank preset without reading Studio's repository or
relying on a hard-coded schema version.

### Gate B: compile a bounded Studio Design Plan

Add a strict request and plan contract in `packages/document` or a small
generation package:

```ts
type DesignGuideReference = {
  kind: "inline" | "url" | "repository"
  title: string
  canonicalUrl?: string
  contentHash?: string
  decisions: {
    colors?: Record<string, string>
    typography?: Record<string, string>
    spacingBase?: number
    radii?: Record<string, number>
    principles?: string[]
  }
}

type StudioDesignPlan = {
  version: 1
  documentName: string
  outputs: Array<{
    localId: string
    name: string
    kind: "proposal" | "social" | "custom"
    pageLocalIds: string[]
    exportFormats: Array<"png" | "pdf">
  }>
  pages: Array<{
    localId: string
    outputLocalId: string
    name: string
    width: number
    height: number
    background: string
    nodeLocalIds: string[]
  }>
  nodes: StudioDesignPlanNode[]
  groups?: StudioDesignPlanGroup[]
  typographyStyles?: StudioDesignPlanTypographyStyle[]
  paintStyles?: StudioDesignPlanPaintStyle[]
  variables?: StudioDesignPlanVariable[]
  fields?: StudioDesignPlanField[]
  bindings?: StudioDesignPlanBinding[]
}

type DocumentGenerationRequest = {
  requestId: string
  idempotencyKey: string
  prompt: string
  start:
    | {
        kind: "template"
        template: { id: string; version: number }
        fieldValues?: Record<string, unknown>
        assetSubstitutions?: Array<{ nodeId: string; assetId: string }>
        commands?: DocumentCommand[]
      }
    | {
        kind: "blank"
        presetId: string
        plan: StudioDesignPlan
      }
  designGuides?: DesignGuideReference[]
  references: Array<
    | {
        kind: "analysis"
        label: string
        canonicalUrl?: string
        contentHash?: string
      }
    | { kind: "asset"; assetId: string; assetVersion?: string }
  >
  requestedName?: string
}

type GeneratedDocumentPlan = {
  requestId: string
  start:
    | {
        kind: "template"
        template: { id: string; version: number; snapshotId: string }
      }
    | { kind: "blank"; presetId: string; designPlanVersion: 1 }
  candidate: Document
  summary: {
    pages: string[]
    nodesByType: Record<string, number>
    fields: string[]
    assets: string[]
    structuralChanges: string[]
  }
  provenance: {
    skill: { canonicalUrl?: string; contentHash?: string }
    designGuides: DesignGuideReference[]
    references: string[]
  }
  validation: ValidationIssue[]
  warnings: string[]
}
```

The public WebMCP tool should be `propose_document_generation`. Studio, not
GPT, must:

1. validate the request and current Design Plan version;
2. resolve the exact template or blank preset;
3. validate every request-local ID and reference before remapping IDs;
4. clone the template or compile the blank plan into a fresh canonical
   document;
5. resolve approved asset identities;
6. apply template fields and typed commands when in template mode;
7. reject the entire plan if any command, identity, permission, limit, or resource
   check fails;
8. validate the complete candidate; and
9. render preview thumbnails.

Template-mode command admission should remain narrow: field values, approved
image substitutions, text changes, visibility, and at most 24 existing typed
post-template commands. Blank mode may create multiple pages and nodes, but
only through the strict Design Plan vocabulary. Do not accept a model-supplied
full `Document`, canonical IDs, source URLs, executable JSX, HTML, CSS, or
renderer-private properties.

The first blank-plan budget should be measured and then frozen at a conservative
ceiling such as 20 pages, 1,000 nodes, 16 levels of group nesting, four
reference records, 64 KiB of normalized design-guide data, and 512 KiB for the
complete WebMCP request. Existing per-node, image, font, mask, page, and renderer
limits still apply. Studio should report the exact failing budget instead of
truncating a plan.

Exit criterion: the same request and idempotency key always resolve to the same
candidate identity or the same stable failure, with no live-document mutation.

### Gate C: review and create the artifact

Add a separate-document Review card. It should show the blank preset or exact
template, skill and `design.md` provenance, references, page thumbnails,
validation state, node counts, and a compact summary of fields, assets, and
structural decisions. The human gets one primary action: **Create editable
document**.

Approval persists the candidate and opens a fresh document session in one
atomic workflow. Rejection deletes the uncommitted candidate. A stale template,
unsupported plan version, missing asset, changed permission, repeated request,
or persistence failure must not leave a half-created document.

The created document then uses every existing Studio editor command, Review
tool, publish flow, and renderer without a generation-specific branch.

Exit criterion: approval creates exactly one editable document; rejection or
failure creates none.

### Gate D: prove external GitHub skills through WebMCP

Publish one first-party `studio-document` example skill, but treat it as a
client of the public contract. The product must also work with a compatible
third-party `SKILL.md` supplied to GPT chat.

The skill workflow is:

1. Read the brief and identify document job, audience, outputs, and required
   content.
2. Read its own linked `design.md`, examples, and reference images.
3. Ask WebMCP for the live Studio Design Plan schema, limits, blank presets,
   templates, and assets.
4. Choose template mode when a suitable structure exists; choose blank mode
   when the skill or user calls for a new composition.
5. Prepare one generation request rather than drawing the artifact through a
   long series of low-level live mutations.
6. Inspect validation, document structure, and rendered thumbnails through
   WebMCP.
7. Submit at most one bounded replacement plan if required.
8. Hand the candidate to Studio Review and stop before human approval.

Retain two end-to-end fixtures.

#### Blank fixture

> Use this GitHub skill and its linked `design.md` to create a five-page client
> proposal from a blank portrait document. Use these two visual references.

Expected result:

- GPT discovers the current plan vocabulary through WebMCP;
- the plan creates pages, editable text, shapes, images, groups, styles, fields,
  bindings, and outputs without private schema knowledge;
- `design.md` tokens and principles are visible in the candidate;
- Studio remaps local IDs and compiles one valid canonical document;
- Review shows skill, design-guide, and reference provenance;
- approval creates one multi-page editable document; and
- direct edits, undo, publication, PNG, and PDF use existing paths.

#### Template fixture

> Use this GitHub skill to adapt an editorial proposal template for a two-day
> destination wedding with these approved media references.

Expected result:

- GPT selects an exact template version;
- Studio clones it to a new identity;
- fields and approved media change visibly;
- Review shows provenance and every affected page; and
- replaying the same request does not create a duplicate.

Exit criterion: GPT chat can complete both fixtures with only the supplied
GitHub skill and Studio's public WebMCP tools. It must not need the Studio
repository, a private tool, or an in-app model.

## First-slice limits

`GEN-01` should initially support:

- both active Studio templates and blank document presets;
- a versioned JSON Studio Design Plan for blank artifacts;
- supplied or linked `design.md` guidance interpreted by GPT chat;
- existing node, field, style, variable, component, image, and mask semantics;
- approved catalog or workspace assets only;
- analysis-only references with bounded provenance metadata;
- one candidate at a time;
- one exact template version or blank preset per candidate;
- a bounded correction loop; and
- one human approval before persistence.

It should initially exclude:

- raw executable JSX, HTML, or CSS as the WebMCP payload;
- importing arbitrary HTML or React components;
- model-generated template publication;
- unbounded low-level live drawing;
- direct mutation of the open document while the skill reasons;
- remote image URLs as document sources;
- multiple autonomous candidates competing in Review; and
- an embedded general-purpose chat interface.

These limits still permit genuinely new compositions. The GPT skill decides the
design; the Studio Design Plan only makes that decision bounded, editable, and
reviewable.

## Later extension: JSX authoring convenience

The JSON Studio Design Plan is required in the first slice. If skill authors
find raw JSON cumbersome, add an optional JSX authoring helper later. It should
compile JSX to the same plan outside the canonical document boundary and use
OpenPencil-style limits for source bytes, output bytes, depth, node count,
strings, and execution time.

JSX remains an authoring convenience, not a second product model or a reason to
execute third-party code inside Studio. The stricter transaction rule remains:
compile and validate the whole plan first, then create one candidate.

## GEN-01 implementation checkpoint, 31 August 2026

Implementation is complete on branch `codex/gen-01-document-generation` in the
isolated worktree `webmcp-studio-worktrees/gen-01`. The branch starts at exact
`main` commit `6265561ab4c9aa70c7489c2a90b3dcac6c1179d3`. It has not been merged
to `main`.

State is recorded precisely:

- **Implemented:** Gates A through D are present in the branch.
- **Locally verified:** package typechecks, domain and WebMCP suites, focused
  Studio Review tests, mounted durable creation, and skill validation pass.
- **Committed:** each gate has its own commit.
- **Independently accepted:** no. No independent reviewer has accepted these
  commits yet.
- **Merged:** no.

### Gate commits

| Gate | Commit                                     | Result                                                                                                                                                                            |
| ---- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `fb48fc1ed714ebebce820821fb1fb9a77ed161e8` | Five read-only discovery tools publish exact templates, presets, capabilities, and the Design Plan vocabulary without canonical bodies or media sources.                          |
| B    | `a5804131398e7f64d7a4717b42aedd85f267f259` | A strict JSON compiler validates budgets and request-local references, remaps canonical IDs deterministically, and creates an isolated schema-v5 candidate.                       |
| C    | `1deca7833d1489bfbf4f2acd104d990f00d714c1` | `propose_document_generation` resolves approved assets, compiles one idempotent candidate, renders Review thumbnails, and persists a fresh editable document only after approval. |
| D    | `9053927d9f7a71079de7c39dfa92f173640b091f` | The first-party `studio-document` skill and third-party skill fixtures prove blank and template paths through public WebMCP tools.                                                |

### Frozen safety boundary

The first slice admits requests up to 512 KiB, prompts up to 16,000
characters, 20 pages, 20 outputs, 1,000 nodes, 250 groups, 16 group levels,
100 typography styles, 100 paint styles, 100 variables, 100 fields, 2,000
bindings, four references, four design guides, 64 KiB of normalized guide
decisions, and 24 template changes. Local IDs use a bounded request-local
grammar and are remapped from the request and idempotency identity.

The public generation boundary rejects model-supplied canonical documents,
canonical IDs, arbitrary media URLs, JSX, HTML, CSS, scripts, unsupported
fonts, unknown template identities, source-dependent quotation templates,
unapproved assets, invalid geometry, dangling references, and plans that fail
canonical validation or render policy. Template insertion is limited to an
approved image and the canonical `add_node` command. The public response omits
the candidate body and private media source. One candidate may wait in Review,
one explicitly linked replacement is allowed, and durable storage failure
leaves the candidate uncommitted.

### Retained evidence

- The five-page blank fixture creates editable text, shapes, approved media,
  a group, typography and paint styles, a variable and binding, a field and
  binding, one output, and five pages. The compiled candidate records the
  external skill, normalized `design.md`, two analysis references, and the
  approved asset identity.
- The template fixture discovers `editorial-one-pager@1`, reads its public page
  and field identities, changes bound text, inserts approved botanical media,
  and replays the same idempotency key without compiling a duplicate.
- The mounted Studio test proves discard performs zero repository creates and
  two concurrent approval attempts perform exactly one durable create.
- Review renders each candidate page through the canonical `Artboard` renderer
  and exposes the start identity, skill and guide provenance, structure,
  fields, assets, and validation state.

The host default `node` is v18.18.1, which cannot start the current Vitest
bundle because `rolldown` requires `util.styleText`. DOM-mounted Vitest evidence
was therefore run with the installed Node v22.23.2 binary. Non-DOM suites were
also run directly with Bun 1.2.5. This is a verification-environment constraint,
not a product fallback.

### Integration risks still open

- Independent review and merge reconciliation have not happened.
- The generated candidate itself is held in mounted editor memory until the
  human decides; browser reload before approval discards it by design.
- The first slice does not provide a WebMCP screenshot-inspection tool for a
  remote GPT. The human sees canonical Review thumbnails, while GPT receives
  the structural summary and validation result.
- Only built-in exact templates are discoverable for generation in this slice.
- The 512 KiB and graph ceilings are frozen conservative limits, not yet
  informed by production request telemetry.

## Final assessment

OpenPencil confirms that GPT can create sophisticated editable designs when it
has a small design vocabulary, normal editor tools, and a render-inspect-correct
loop. Studio already has the harder product foundations: a rich business-
document model, exact commands, safe Review, deterministic renderers, versioned
templates, and publishable API templates.

GEN-01 implements the missing piece as a self-describing WebMCP artifact
boundary, not a new canvas engine or in-app model. A compatible GitHub
`SKILL.md` can interpret its linked `design.md` and references, choose a
template or blank start, and submit one bounded design plan. Studio owns the
isolated candidate and creates one canonical editable document only after
human approval.
