import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  applyCommand,
  createTemplateVersion,
  northstarSeed,
  previewChangeSet,
  type ChangeSet,
  type Document,
  type GeneratedDocumentPlan,
  type TemplateModifications,
} from "@webmcp/document"
import { productCommandIds } from "@webmcp/editor/product-commands"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import {
  registerStudioWebMcpTools,
  type StudioWebMcpProposalProvenance,
  type StudioWebMcpMediaDerivationInspection,
  type StudioWebMcpMediaDerivationJob,
  type StudioWebMcpMediaDerivationMutation,
  type StudioWebMcpServices,
  type StudioWebMcpRenderRecord,
  type StudioWebMcpRenderSelection,
  type WebMcpTool,
} from "../src"
import { componentDocumentFixture } from "./component-fixture"
import {
  blankExternalSkillRequest,
  templateExternalSkillRequest,
} from "./fixtures/document-generation/requests"

const assets = [
  {
    id: "sandstone-arches",
    name: "Sandstone arches",
    description: "Architectural arches with restrained earth tones",
    tags: ["architecture", "arches", "sandstone"],
    width: 1600,
    height: 1200,
    license: "Original Studio artwork",
    ownership: "built_in" as const,
    selectable: true,
    src: "data:image/svg+xml,approved",
  },
  {
    id: "olive-botanical",
    name: "Olive botanical",
    description: "Soft botanical composition on warm ivory",
    tags: ["botanical", "olive", "wedding"],
    width: 1200,
    height: 1500,
    license: "Original Studio artwork",
    ownership: "built_in" as const,
    selectable: true,
    src: "data:image/svg+xml,botanical",
  },
]

const managedAsset = {
  id: "asset-abcdefghij",
  name: "Reception portrait.jpg",
  description: undefined,
  tags: [] as string[],
  width: 1_600,
  height: 1_200,
  ownership: "workspace" as const,
  selectable: true,
  src: "asset:managed/asset-abcdefghij",
}

const archivedManagedAsset = {
  ...managedAsset,
  selectable: false,
}

const derivationJob: StudioWebMcpMediaDerivationJob = {
  id: "derivation-01234567-89ab-cdef-0123-456789abcdef",
  sourceAssetId: managedAsset.id,
  operation: "remove_background",
  state: "queued",
  outputAssetId: null,
  attemptCount: 0,
  maxAttempts: 3,
  retryable: false,
  safeFailureCode: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
  cancellationRequestedAt: null,
  updatedAt: "2026-08-31T12:00:00.000Z",
}

const fillPlacement = {
  mode: "fill" as const,
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
}

function productCommandContext(
  document: Document,
  snapshotId = "snapshot-seed"
): ProductCommandRuntimeContext {
  const activePage = document.pages[0]!
  return {
    documentId: document.id,
    snapshotId,
    activePageId: activePage.id,
    activeOutputId: activePage.outputId,
    pageIds: document.pages.map((page) => page.id),
    outputIds: document.outputs.map((output) => output.id),
    pdfOutputIds: document.outputs
      .filter((output) => output.exportFormats.includes("pdf"))
      .map((output) => output.id),
    nodeIds: document.nodes.map((node) => node.id),
    pageNodeCounts: Object.fromEntries(
      document.pages.map((page) => [page.id, page.nodeIds.length])
    ),
    groupIds: document.groups.map((group) => group.id),
    documentDisplayName: document.name,
    pageDisplayNames: Object.fromEntries(
      document.pages.map((page) => [page.id, page.name])
    ),
    outputDisplayNames: Object.fromEntries(
      document.outputs.map((output) => [output.id, output.name])
    ),
    selection: null,
    activeTool: "select",
    editor: {
      reviewPending: false,
      hasSelection: false,
      selectedNodeCount: 0,
      hasSelectedGroup: false,
      hasClipboard: false,
      hasUndo: false,
      hasRedo: false,
      hasZoomSelection: false,
      canCropImage: false,
      canTransformImage: false,
      imageCropActive: false,
    },
    structureByTarget: Object.fromEntries([
      ...document.pages.map((page) => {
        const output = document.outputs.find(
          (candidate) => candidate.id === page.outputId
        )
        return [
          page.id,
          {
            reviewPending: false,
            outputCount: document.outputs.length,
            outputPageCount: output?.pageIds.length ?? 0,
            pageIndex: output?.pageIds.indexOf(page.id),
          },
        ] as const
      }),
      ...document.outputs.map(
        (output) =>
          [
            output.id,
            {
              reviewPending: false,
              outputCount: document.outputs.length,
              outputPageCount: output.pageIds.length,
            },
          ] as const
      ),
    ]),
  }
}

function withImageLayer({
  id = "contract-image",
  alt = "Authored alternative description",
  decorative = false,
}: {
  id?: string
  alt?: string
  decorative?: boolean
} = {}) {
  return applyCommand(northstarSeed, {
    id: `add-${id}`,
    type: "add_node",
    actor: "human",
    at: "2026-08-26T09:30:00.000Z",
    pageId: "cover",
    node: {
      id,
      type: "image",
      name: "Contract image",
      assetId: "current-contract-asset",
      src: "data:image/svg+xml,current-contract-asset",
      alt,
      placement: fillPlacement,
      frameMask: { shape: "rectangle" },
      decorative,
      x: 610,
      y: 0,
      width: 630,
      height: 800,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    },
  })
}

function setup(
  document: Document = northstarSeed,
  publishedDocument: Document = document,
  catalogAssets = assets,
  commandCapabilities: readonly {
    id: string
    label: string
    enabled: boolean
    reason?: string
  }[] = [],
  canonicalCommandContext: ProductCommandRuntimeContext | null = null
) {
  const registered = new Map<string, WebMcpTool>()
  let proposed: ChangeSet | null = null
  let proposedProvenance: StudioWebMcpProposalProvenance | null = null
  let proposedGeneration: GeneratedDocumentPlan | null = null
  const controller = new AbortController()
  const publishedVersion = createTemplateVersion(publishedDocument, {
    id: "version-1",
    templateId: "northstar-wedding-proposal",
    version: 1,
    sourceSnapshotId: `sha256-${"a".repeat(64)}`,
    publishedAt: "2026-08-26T10:00:00.000Z",
  })
  const renderHistory: StudioWebMcpRenderRecord[] = [
    {
      id: "render-existing",
      templateId: publishedVersion.templateId,
      version: publishedVersion.version,
      createdAt: "2026-08-26T10:05:00.000Z",
      completedAt: "2026-08-26T10:05:01.000Z",
      status: "completed",
      modifications: { couple_names: "Mira & Dev" },
      selections: [{ outputId: "whatsapp", format: "png" }],
      artifacts: [
        {
          id: "artifact-existing",
          outputId: "whatsapp",
          pageId: "whatsapp-card",
          format: "png",
          filename: "whatsapp-package-card.png",
          bytes: 18420,
          width: 1080,
          height: 1350,
        },
      ],
    },
  ]
  let renderedWith:
    | {
        modifications: TemplateModifications
        selections: StudioWebMcpRenderSelection[]
      }
    | undefined
  const services = {
    getSnapshot: () => ({
      document,
      snapshotId: "snapshot-seed",
      operationVersion: 0,
      activePageId: "cover",
      selection: null,
      pendingChangeSet: proposed,
      assets,
      publishedVersion,
      renderHistory,
      commandCapabilities,
      productCommandContext: canonicalCommandContext,
    }),
    searchAssets: async ({
      query,
      orientation,
      tags,
      limit,
    }: {
      query: string
      orientation?: "portrait" | "landscape" | "square"
      tags: readonly string[]
      limit: number
    }) => {
      const normalizedQuery = query.toLowerCase()
      const matches = catalogAssets.filter((asset) => {
        if (!asset.selectable) return false
        const ratio = asset.width / asset.height
        const assetOrientation =
          Math.abs(ratio - 1) <= 0.08
            ? "square"
            : ratio > 1
              ? "landscape"
              : "portrait"
        return (
          (!orientation || orientation === assetOrientation) &&
          tags.every((tag) => asset.tags.includes(tag)) &&
          (!normalizedQuery ||
            [asset.name, asset.description ?? "", ...asset.tags]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery))
        )
      })
      return { assets: matches.slice(0, limit), nextCursor: null }
    },
    resolveAsset: async (assetId: string) =>
      catalogAssets.find((asset) => asset.id === assetId) ?? null,
    mediaDerivations: {
      inspect: vi.fn(
        async (
          input: Parameters<
            NonNullable<StudioWebMcpServices["mediaDerivations"]>["inspect"]
          >[0]
        ): Promise<StudioWebMcpMediaDerivationInspection> => {
          if (input.kind === "policy") {
            return {
              kind: "policy",
              policy: {
                operation: "remove_background",
                privacyPolicyVersion: "privacy-v1",
                subprocessor: "Configured processor",
                retention: "Deleted within 24 hours",
                region: "India",
                cost: "1 credit",
                cancellationLimits: "Cancellation is cooperative",
              },
            }
          }
          if (input.kind === "source") {
            return {
              kind: "source",
              policy: {
                operation: "remove_background",
                privacyPolicyVersion: "privacy-v1",
                subprocessor: "Configured processor",
                retention: "Deleted within 24 hours",
                region: "India",
                cost: "1 credit",
                cancellationLimits: "Cancellation is cooperative",
              },
              job: derivationJob,
            }
          }
          if (input.kind === "job") return { kind: "job", job: derivationJob }
          return { kind: "output", provenance: null }
        }
      ),
      mutate: vi.fn(
        async (
          _input: StudioWebMcpMediaDerivationMutation
        ): Promise<StudioWebMcpMediaDerivationJob> => derivationJob
      ),
    },
    proposeChangeSet: (
      changeSet: ChangeSet,
      provenance: StudioWebMcpProposalProvenance
    ) => {
      proposed = changeSet
      proposedProvenance = provenance
      return changeSet
    },
    proposeDocumentGeneration: (
      plan: GeneratedDocumentPlan,
      provenance: StudioWebMcpProposalProvenance
    ) => {
      proposedGeneration = plan
      proposedProvenance = provenance
      return plan
    },
    runProductCommand: vi.fn(() => ({ status: "accepted" as const })),
    publishTemplate: vi.fn(() => publishedVersion),
    renderTemplate: async (
      _version: typeof publishedVersion,
      modifications: TemplateModifications,
      selections: StudioWebMcpRenderSelection[]
    ) => {
      renderedWith = { modifications, selections }
      const record: StudioWebMcpRenderRecord = {
        id: "render-new",
        templateId: publishedVersion.templateId,
        version: publishedVersion.version,
        createdAt: "2026-08-26T10:10:00.000Z",
        completedAt: "2026-08-26T10:10:01.000Z",
        status: "completed",
        modifications,
        selections,
        artifacts: [
          {
            id: "artifact-new",
            outputId: selections[0]!.outputId,
            format: selections[0]!.format,
            filename: "five-page-proposal.pdf",
            bytes: 72500,
          },
        ],
      }
      renderHistory.unshift(record)
      return record
    },
    id: (() => {
      let sequence = 0
      return () => String(++sequence)
    })(),
    now: () => "2026-08-26T10:00:00.000Z",
  }
  return {
    registered,
    controller,
    services,
    proposed: () => proposed,
    proposedProvenance: () => proposedProvenance,
    proposedGeneration: () => proposedGeneration,
    renderedWith: () => renderedWith,
  }
}

describe("WebMCP registration", () => {
  it("registers current-state inspection, validation, and proposal tools", async () => {
    const state = setup()
    const count = await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    expect(count).toBe(29)
    expect([...state.registered.keys()]).toEqual([
      "search_templates",
      "read_template",
      "read_generation_capabilities",
      "read_blank_document_presets",
      "read_design_plan_schema",
      "propose_document_generation",
      "inspect_design",
      "read_design_tree",
      "get_capabilities",
      "execute_product_command",
      "read_design_node",
      "read_design_styles",
      "read_design_variables",
      "read_design_components",
      "search_design_nodes",
      "search_assets",
      "inspect_background_removal",
      "manage_background_removal",
      "validate_design",
      "propose_asset_insertion",
      "propose_field_updates",
      "propose_canvas_edits",
      "propose_design_style_changes",
      "propose_design_variable_changes",
      "propose_component_changes",
      "propose_output_variant",
      "publish_template",
      "inspect_render_history",
      "render_template",
    ])
    expect(state.registered.get("publish_template")?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      untrustedContentHint: true,
    })
    expect(state.registered.get("render_template")?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      untrustedContentHint: true,
    })
    for (const tool of state.registered.values()) {
      expect(tool.annotations?.untrustedContentHint, tool.name).toBe(true)
    }

    const getSnapshot = vi.spyOn(state.services, "getSnapshot")
    const inspected = await state.registered.get("inspect_design")?.execute({})
    expect(getSnapshot).toHaveBeenCalledTimes(1)
    const inspectedNodes = (
      inspected?.structuredContent as {
        activePageNodes: Array<Record<string, unknown>>
      }
    ).activePageNodes
    expect(Array.isArray(inspectedNodes)).toBe(true)
    expect(
      inspectedNodes.some((node) => node.type === "image" && "src" in node)
    ).toBe(false)
    expect(inspected?.structuredContent).toMatchObject({
      document: { id: northstarSeed.id, revision: northstarSeed.revision },
      activePage: { id: "cover" },
      activePageNodes: expect.arrayContaining([
        expect.objectContaining({ id: "cover-title", type: "text" }),
      ]),
      activePageGroups: expect.any(Array),
      commandCapabilities: [],
      fields: expect.arrayContaining([
        expect.objectContaining({
          id: "package_price",
          value: "385000",
          displayValue: "₹3,85,000",
          bindings: 2,
          bindingTargets: expect.arrayContaining([
            expect.objectContaining({
              bindingId: "bind-package-price",
              nodeId: "package-price",
              property: "text",
              pageId: "package",
              outputId: "proposal",
            }),
            expect.objectContaining({
              bindingId: "bind-wa-price",
              nodeId: "wa-price",
              property: "text",
              pageId: "whatsapp-card",
              outputId: "whatsapp",
            }),
          ]),
          affectedPages: expect.arrayContaining([
            expect.objectContaining({ id: "package" }),
            expect.objectContaining({ id: "whatsapp-card" }),
          ]),
          affectedOutputs: expect.arrayContaining([
            expect.objectContaining({ id: "proposal" }),
            expect.objectContaining({ id: "whatsapp" }),
          ]),
        }),
      ]),
    })

    getSnapshot.mockClear()
    const tree = await state.registered.get("read_design_tree")?.execute({
      pageId: "package",
    })
    expect(getSnapshot).toHaveBeenCalledTimes(1)
    expect(tree?.structuredContent).toMatchObject({
      identity: {
        documentId: northstarSeed.id,
        revision: northstarSeed.revision,
        snapshotId: "snapshot-seed",
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "package",
          kind: "page",
          outputId: "proposal",
        }),
      ]),
    })

    const node = await state.registered.get("read_design_node")?.execute({
      nodeId: "package-price",
    })
    expect(node?.structuredContent).toMatchObject({
      page: { id: "package" },
      output: { id: "proposal" },
      node: { id: "package-price", type: "text" },
    })

    const search = await state.registered
      .get("search_design_nodes")
      ?.execute({ query: "package", pageId: "package", types: ["text"] })
    expect(search?.structuredContent).toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ pageId: "package", type: "text" }),
      ]),
    })

    const missing = await state.registered.get("read_design_node")?.execute({
      nodeId: "missing-node",
    })
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: {
        status: "error",
        code: "node_not_found",
        retryable: false,
      },
    })
    expect(JSON.stringify(inspected?.structuredContent)).not.toContain(
      "data:image"
    )
    const published = await state.registered.get("publish_template")?.execute({
      documentId: northstarSeed.id,
      expectedRevision: northstarSeed.revision,
      expectedSnapshotId: "snapshot-seed",
    })
    expect(published?.structuredContent).toMatchObject({
      templateId: "northstar-wedding-proposal",
      version: 1,
      sourceRevision: northstarSeed.revision,
    })
    expect(state.services.publishTemplate).toHaveBeenCalledWith(
      {
        documentId: northstarSeed.id,
        revision: northstarSeed.revision,
        snapshotId: "snapshot-seed",
      },
      { signal: expect.any(AbortSignal) }
    )

    const staleBranch = await state.registered
      .get("publish_template")
      ?.execute({
        documentId: northstarSeed.id,
        expectedRevision: northstarSeed.revision,
        expectedSnapshotId: "snapshot-other-branch",
      })
    expect(staleBranch?.isError).toBe(true)
    expect(staleBranch?.content[0]?.text).toContain("branch changed")
  })

  it("compiles one idempotent isolated document candidate for Review", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const request = {
      requestId: "generation-request-1",
      idempotencyKey: "generation-request-1",
      prompt: "Create a blank portrait proposal.",
      skill: {
        kind: "repository",
        title: "Proposal skill",
        canonicalUrl: "https://github.com/example/proposal/blob/main/SKILL.md",
        contentHash: "a".repeat(64),
      },
      start: {
        kind: "blank",
        presetId: "portrait",
        plan: {
          version: 1,
          documentName: "Generated proposal",
          outputs: [
            {
              localId: "proposal",
              name: "Proposal",
              kind: "proposal",
              pageLocalIds: ["cover"],
              exportFormats: ["png", "pdf"],
            },
          ],
          pages: [
            {
              localId: "cover",
              outputLocalId: "proposal",
              name: "Cover",
              width: 1240,
              height: 1754,
              background: "#ffffff",
              nodeLocalIds: [],
            },
          ],
          nodes: [],
        },
      },
      references: [],
    }
    const tool = state.registered.get("propose_document_generation")!
    const first = await tool.execute(request)
    const replay = await tool.execute(request)

    expect(first.isError).not.toBe(true)
    expect(state.proposedGeneration()).toMatchObject({
      requestId: "generation-request-1",
      candidate: { name: "Generated proposal" },
    })
    expect(state.proposedProvenance()).toMatchObject({
      toolName: "propose_document_generation",
      requestId: "generation-request-1",
    })
    expect(first.structuredContent).toMatchObject({
      candidate: {
        id: expect.any(String),
        name: "Generated proposal",
        snapshotId: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
      },
      review: { status: "pending", currentDocumentMutated: false },
      replayed: false,
    })
    expect(first.structuredContent).not.toHaveProperty("candidate.nodes")
    expect(replay.structuredContent).toMatchObject({ replayed: true })

    const conflict = await tool.execute({
      ...request,
      prompt: "Create a different proposal with the same key.",
    })
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: { code: "idempotency_key_reused" },
    })
  })

  it("accepts blank and template plans from an external skill through public WebMCP tools", async () => {
    const fixtureRoot = new URL(
      "./fixtures/document-generation/external-skill/",
      import.meta.url
    )
    expect(readFileSync(new URL("SKILL.md", fixtureRoot), "utf8")).toContain(
      "propose_document_generation"
    )
    expect(readFileSync(new URL("design.md", fixtureRoot), "utf8")).toContain(
      "#b8663b"
    )

    const register = async (state: ReturnType<typeof setup>) =>
      registerStudioWebMcpTools(
        {
          registerTool: async (tool) => {
            state.registered.set(tool.name, tool)
            return undefined
          },
        },
        state.services,
        state.controller.signal
      )

    const blank = setup()
    await register(blank)
    const capabilities = await blank.registered
      .get("read_generation_capabilities")!
      .execute({})
    const schema = await blank.registered
      .get("read_design_plan_schema")!
      .execute({})
    const presets = await blank.registered
      .get("read_blank_document_presets")!
      .execute({})
    const assetSearch = await blank.registered.get("search_assets")!.execute({
      query: "sandstone arches",
      limit: 8,
    })
    const blankResult = await blank.registered
      .get("propose_document_generation")!
      .execute(blankExternalSkillRequest)

    expect(capabilities.isError).not.toBe(true)
    expect(schema.structuredContent).toMatchObject({ version: 1 })
    expect(presets.structuredContent).toMatchObject({
      presets: expect.arrayContaining([
        expect.objectContaining({ id: "portrait" }),
      ]),
    })
    expect(assetSearch.structuredContent).toMatchObject({
      assets: expect.arrayContaining([
        expect.objectContaining({ id: "sandstone-arches" }),
      ]),
    })
    expect(blankResult.isError).not.toBe(true)
    expect(blankResult.structuredContent).not.toHaveProperty("candidate.pages")
    const blankCandidate = blank.proposedGeneration()!.candidate
    expect(blankCandidate.pages).toHaveLength(5)
    expect(blankCandidate.nodes.some((node) => node.type === "image")).toBe(
      true
    )
    expect(blankCandidate.groups).toHaveLength(1)
    expect(blankCandidate.typographyStyles).toHaveLength(1)
    expect(blankCandidate.paintStyles).toHaveLength(1)
    expect(blankCandidate.variables).toHaveLength(1)
    expect(blankCandidate.variableBindings).toHaveLength(1)
    expect(blankCandidate.fields).toHaveLength(1)
    expect(blankCandidate.bindings).toHaveLength(1)
    expect(blank.proposedGeneration()!.provenance).toMatchObject({
      skill: { title: "editorial-proposal-maker" },
      designGuides: [{ title: "Field Notes proposal system" }],
      references: expect.arrayContaining([
        expect.objectContaining({ label: "Editorial pacing reference" }),
      ]),
    })

    const template = setup()
    await register(template)
    const search = await template.registered.get("search_templates")!.execute({
      query: "editorial proposal",
      limit: 8,
    })
    const detail = await template.registered.get("read_template")!.execute({
      id: "editorial-one-pager",
      version: 1,
    })
    await template.registered.get("search_assets")!.execute({
      query: "olive botanical",
      limit: 8,
    })
    const searchContent = search.structuredContent as {
      templates: Array<{ id: string; version: number }>
    }
    const detailContent = detail.structuredContent as {
      id: string
      version: number
      fields: Array<{ key: string; label: string }>
      outputs: Array<{ pages: Array<{ id: string }> }>
      editableNodes: Array<{
        id: string
        name: string
        allowedChanges: string[]
      }>
    }
    const discoveredTemplate = searchContent.templates.find(
      (candidate) => candidate.id === detailContent.id
    )!
    const templateIdentity = {
      id: discoveredTemplate.id,
      version: discoveredTemplate.version,
    }
    const pageId = detailContent.outputs[0]!.pages[0]!.id
    const copyTarget = detailContent.editableNodes.find(
      (node) =>
        node.name === "Summary copy" && node.allowedChanges.includes("set_text")
    )!
    const visibilityTarget = detailContent.editableNodes.find(
      (node) =>
        node.name === "Footer" && node.allowedChanges.includes("set_visibility")
    )!
    const titleFieldKey = detailContent.fields.find(
      (field) => field.label === "Document title"
    )!.key
    const subtitleFieldKey = detailContent.fields.find(
      (field) => field.label === "Document subtitle"
    )!.key
    const discoveredTemplateRequest = {
      ...templateExternalSkillRequest,
      start: {
        ...templateExternalSkillRequest.start,
        template: templateIdentity,
        fieldValues: {
          [titleFieldKey]: "Mira & Dev in Udaipur",
          [subtitleFieldKey]:
            "A two-day destination wedding shaped around place",
        },
        commands: [
          {
            ...templateExternalSkillRequest.start.commands[0]!,
            pageId,
          },
          {
            type: "set_text",
            nodeId: copyTarget.id,
            text: "Two days of place-led gatherings, considered hospitality, and clear production decisions.",
          },
          {
            type: "set_visibility",
            nodeId: visibilityTarget.id,
            visible: false,
          },
        ],
      },
    }
    const templateTool = template.registered.get("propose_document_generation")!
    const first = await templateTool.execute(discoveredTemplateRequest)
    const replay = await templateTool.execute(discoveredTemplateRequest)

    expect(search.structuredContent).toMatchObject({
      templates: expect.arrayContaining([
        expect.objectContaining({ id: "editorial-one-pager", version: 1 }),
      ]),
    })
    expect(detail.structuredContent).toMatchObject({
      id: "editorial-one-pager",
      version: 1,
      outputs: [
        expect.objectContaining({
          pages: [expect.objectContaining({ id: "editorial-one-pager-page" })],
        }),
      ],
      editableNodes: expect.arrayContaining([
        expect.objectContaining({
          id: "editorial-card-copy",
          allowedChanges: expect.arrayContaining(["set_text"]),
        }),
        expect.objectContaining({
          id: "editorial-footer",
          allowedChanges: expect.arrayContaining(["set_visibility"]),
        }),
      ]),
    })
    if (first.isError) {
      throw new Error(first.content[0]?.text ?? "Template generation failed")
    }
    expect(replay.structuredContent).toMatchObject({ replayed: true })
    const templateCandidate = template.proposedGeneration()!.candidate
    expect(templateCandidate.name).toBe(
      "Mira and Dev destination wedding proposal"
    )
    expect(
      templateCandidate.nodes.find((node) => node.name === "Document title")
    ).toMatchObject({ text: "Mira & Dev in Udaipur" })
    expect(
      templateCandidate.nodes.find(
        (node) => node.name === "Udaipur botanical study"
      )
    ).toMatchObject({ type: "image", assetId: "olive-botanical" })
    expect(
      templateCandidate.nodes.find((node) => node.name === "Summary copy")
    ).toMatchObject({
      text: "Two days of place-led gatherings, considered hospitality, and clear production decisions.",
    })
    expect(
      templateCandidate.nodes.find((node) => node.name === "Footer")
    ).toMatchObject({ visible: false })
  })

  it("requires exact consent and workspace ownership for background removal", async () => {
    const state = setup(northstarSeed, northstarSeed, [...assets, managedAsset])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const inspection = await state.registered
      .get("inspect_background_removal")
      ?.execute({ kind: "policy" })
    expect(inspection?.structuredContent).toEqual({
      kind: "policy",
      policy: expect.objectContaining({
        privacyPolicyVersion: "privacy-v1",
        subprocessor: "Configured processor",
      }),
    })

    const missingConsent = await state.registered
      .get("manage_background_removal")
      ?.execute({ action: "start", assetId: managedAsset.id })
    expect(missingConsent).toMatchObject({
      isError: true,
      structuredContent: { code: "invalid_query" },
    })
    expect(state.services.mediaDerivations.mutate).not.toHaveBeenCalled()

    const builtIn = await state.registered
      .get("manage_background_removal")
      ?.execute({
        action: "start",
        assetId: assets[0].id,
        consent: {
          accepted: true,
          privacyPolicyVersion: "privacy-v1",
        },
      })
    expect(builtIn).toMatchObject({ isError: true })
    expect(state.services.mediaDerivations.mutate).not.toHaveBeenCalled()

    const started = await state.registered
      .get("manage_background_removal")
      ?.execute({
        action: "start",
        assetId: managedAsset.id,
        consent: {
          accepted: true,
          privacyPolicyVersion: "privacy-v1",
        },
      })
    expect(state.services.mediaDerivations.mutate).toHaveBeenCalledWith(
      {
        action: "start",
        assetId: managedAsset.id,
        consent: {
          accepted: true,
          privacyPolicyVersion: "privacy-v1",
        },
      },
      expect.any(AbortSignal)
    )
    expect(started?.structuredContent).toEqual({
      job: expect.objectContaining({
        id: derivationJob.id,
        state: "queued",
      }),
    })
    expect(JSON.stringify(started?.structuredContent)).not.toMatch(
      /provider|url|hash|storage|workspace/i
    )
  })

  it("discovers and proposes reviewed reusable-style operations", async () => {
    const typographyStyle = {
      id: "typography-style-editorial-hero",
      name: "Editorial / Hero",
      fontFamily: "Geist Variable",
      fontSize: 72,
      fontWeight: 600,
      italic: false,
      decoration: "none" as const,
      lineHeight: 1.05,
      letterSpacing: -1.4,
    }
    const document: Document = {
      ...northstarSeed,
      typographyStyles: [typographyStyle],
    }
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const styles = await state.registered
      .get("read_design_styles")
      ?.execute({ kind: "typography" })
    expect(styles?.structuredContent).toMatchObject({
      styles: [
        {
          kind: "typography",
          id: typographyStyle.id,
          name: typographyStyle.name,
          usage: { totalAttachmentCount: 0, nodeIds: [] },
        },
      ],
    })

    const result = await state.registered
      .get("propose_design_style_changes")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        reason: "Use the approved hero style",
        changes: [
          {
            kind: "typography",
            action: "apply",
            styleId: typographyStyle.id,
            targets: [{ nodeId: "cover-title" }],
          },
        ],
      })

    expect(result?.isError).toBeUndefined()
    expect(result?.structuredContent).toMatchObject({
      operations: [
        {
          command: {
            type: "apply_typography_style",
            styleId: typographyStyle.id,
            targets: [{ nodeId: "cover-title" }],
          },
        },
      ],
    })
    expect(state.proposedProvenance()).toMatchObject({
      toolName: "propose_design_style_changes",
      reason: "Use the approved hero style",
    })
    const proposed = state.proposed()
    expect(proposed).not.toBeNull()
    expect(
      previewChangeSet(document, proposed!).nodes.find(
        (node) => node.id === "cover-title"
      )
    ).toMatchObject({
      typographyStyleId: typographyStyle.id,
      fontSize: typographyStyle.fontSize,
    })
  })

  it("discovers and proposes reviewed design-variable operations", async () => {
    const document: Document = {
      ...northstarSeed,
      variables: [
        {
          id: "variable-brand-panel",
          name: "Brand / Panel",
          type: "color",
          value: "#335C4A",
        },
      ],
      variableBindings: [
        {
          id: "variable-binding-brand-panel",
          variableId: "variable-brand-panel",
          target: { kind: "node", nodeId: "cover-panel", property: "fill" },
        },
      ],
      nodes: northstarSeed.nodes.map((node) =>
        node.id === "cover-panel" && node.type === "rect"
          ? { ...node, fill: "#335C4A" }
          : node
      ),
    }
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const variables = await state.registered
      .get("read_design_variables")
      ?.execute({ type: "color" })
    expect(variables?.structuredContent).toMatchObject({
      variables: [
        {
          id: "variable-brand-panel",
          usage: { totalBindingCount: 1, nodeIds: ["cover-panel"] },
        },
      ],
      bindings: [{ id: "variable-binding-brand-panel" }],
    })

    const result = await state.registered
      .get("propose_design_variable_changes")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        reason: "Warm the brand panel",
        changes: [
          {
            action: "update",
            variableId: "variable-brand-panel",
            patch: { value: "#B45309" },
          },
        ],
      })

    expect(result?.isError).toBeUndefined()
    expect(result?.structuredContent).toMatchObject({
      operations: [
        {
          command: {
            type: "update_variable",
            variableId: "variable-brand-panel",
          },
        },
      ],
    })
    expect(state.proposedProvenance()).toMatchObject({
      toolName: "propose_design_variable_changes",
      reason: "Warm the brand panel",
    })
    expect(
      previewChangeSet(document, state.proposed()!).nodes.find(
        (node) => node.id === "cover-panel"
      )
    ).toMatchObject({ fill: "#B45309" })
  })

  it("discovers and proposes reviewed component-instance operations", async () => {
    const document = componentDocumentFixture()
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const components = await state.registered
      .get("read_design_components")
      ?.execute({ componentId: "component-hero" })
    expect(components?.structuredContent).toMatchObject({
      components: [
        {
          id: "component-hero",
          instanceIds: ["instance-hero"],
          capabilities: { createInstance: true },
        },
      ],
      instances: [
        {
          id: "instance-hero",
          capabilities: {
            switchVariant: true,
            setOverride: true,
            detach: true,
          },
        },
      ],
    })

    const result = await state.registered
      .get("propose_component_changes")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        reason: "Personalize the hero instance",
        changes: [
          {
            action: "set_override",
            instanceId: "instance-hero",
            sourceNodeId: "cover-eyebrow",
            patch: { text: "Celebration story" },
          },
        ],
      })

    expect(result?.isError).toBeUndefined()
    expect(result?.structuredContent).toMatchObject({
      operations: [
        {
          command: {
            type: "update_component_instance",
          },
        },
      ],
    })
    expect(state.proposedProvenance()).toMatchObject({
      toolName: "propose_component_changes",
      reason: "Personalize the hero instance",
    })
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_component_instance",
      instanceId: "instance-hero",
      sourceNodeId: "cover-eyebrow",
      patch: { text: "Celebration story" },
    })
    expect(
      previewChangeSet(document, state.proposed()!).nodes.find(
        (node) => node.id === "instance-cover-eyebrow"
      )
    ).toMatchObject({ text: "Celebration story" })
  })

  it("reports an interrupted publication with stable unknown-status identity", async () => {
    const state = setup()
    state.services.publishTemplate.mockRejectedValueOnce(
      new DOMException("Publication caller stopped waiting.", "AbortError")
    )
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("publish_template")?.execute({
      documentId: northstarSeed.id,
      expectedRevision: northstarSeed.revision,
      expectedSnapshotId: "snapshot-seed",
    })

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "error",
        code: "execution_status_unknown",
        retryable: true,
      },
    })
  })

  it("projects the complete canonical product command policy", async () => {
    const context = productCommandContext(northstarSeed)
    const state = setup(northstarSeed, northstarSeed, assets, [], context)
    const getSnapshot = vi.spyOn(state.services, "getSnapshot")
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    getSnapshot.mockClear()

    const result = await state.registered.get("get_capabilities")?.execute({})
    expect(getSnapshot).toHaveBeenCalledTimes(1)
    const structured = result?.structuredContent as {
      identity: { snapshotId: string }
      capabilities: Array<{
        commandId: string
        enabled: boolean
        disabledReason: string | null
        execution: { modes: string[] }
        arguments?: { kind: string }
      }>
    }
    expect(structured.identity.snapshotId).toBe("snapshot-seed")
    expect(
      new Set(structured.capabilities.map(({ commandId }) => commandId))
    ).toEqual(new Set(productCommandIds))
    expect(
      structured.capabilities.filter(
        ({ commandId }) => commandId === "arrange.align"
      )
    ).toHaveLength(12)
    expect(
      structured.capabilities.filter(
        ({ commandId }) => commandId === "arrange.distribute"
      )
    ).toHaveLength(2)
    expect(
      structured.capabilities.find(
        ({ commandId }) => commandId === "object.delete"
      )
    ).toMatchObject({
      enabled: false,
      execution: { modes: ["dry_run", "proposal"] },
    })
    expect(JSON.stringify(result?.structuredContent)).not.toContain(
      "hasClipboard"
    )

    const outputResult = await state.registered
      .get("get_capabilities")
      ?.execute({
        commandIds: ["output.export-pdf"],
        target: { kind: "output", outputId: "whatsapp" },
      })
    expect(outputResult?.structuredContent).toMatchObject({
      target: { kind: "output", outputId: "whatsapp" },
      capabilities: [
        expect.objectContaining({
          commandId: "output.export-pdf",
          label: "1-page PDF",
          enabled: false,
          disabledReason: "This output does not support PDF export.",
        }),
      ],
    })

    const missing = await state.registered.get("get_capabilities")?.execute({
      target: { kind: "output", outputId: "missing-output" },
    })
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: { code: "output_not_found", retryable: false },
    })
  })

  it("mints and executes ordered multi-source mask capabilities", async () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    const panel = document.nodes.find((node) => node.id === "cover-panel")!
    document.nodes.push({
      ...panel,
      id: "cover-mask-alternate",
      name: "Alternate mask",
      x: panel.x + 24,
    })
    page.nodeIds.splice(
      page.nodeIds.indexOf("cover-panel") + 1,
      0,
      "cover-mask-alternate"
    )
    document.groups.push({
      id: "cover-mask",
      role: "mask",
      pageId: page.id,
      name: "Cover mask",
      nodeIds: ["cover-panel", "cover-mask-alternate", "cover-eyebrow"],
      mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
    })
    const base = productCommandContext(document)
    const selectedNodeIds = [
      "cover-panel",
      "cover-mask-alternate",
      "cover-eyebrow",
    ]
    const context: ProductCommandRuntimeContext = {
      ...base,
      selection: {
        pageId: page.id,
        nodeIds: selectedNodeIds,
        nodeTypes: ["rect", "rect", "text"],
        groupId: "cover-mask",
        anyLocked: false,
        allLocked: false,
        allVisible: true,
        allHidden: false,
      },
      editor: {
        ...base.editor,
        hasSelection: true,
        selectedNodeCount: selectedNodeIds.length,
        hasSelectedGroup: true,
        mask: {
          canCreate: false,
          createDisabledReason: "Already grouped.",
          canRelease: true,
          releaseDisabledReason: null,
          canSetVector: false,
          vectorDisabledReason: "This mask already uses Vector.",
          canSetAlpha: true,
          alphaDisabledReason: null,
          canSetLuminance: false,
          luminanceDisabledReason: "Unavailable.",
          canSetSources: true,
          sourcesDisabledReason: null,
        },
      },
      mask: {
        groupId: "cover-mask",
        createParentGroupId: "cover-mask",
        type: "vector",
        sourceNodeIds: ["cover-panel"],
        eligibleSourceNodeIds: ["cover-panel", "cover-mask-alternate"],
        createSourceNodeIds: ["cover-panel"],
        reassignmentSourceNodeIds: [],
        create: { enabled: false, disabledReason: "Already grouped." },
        release: { enabled: true, disabledReason: null },
        setVector: {
          enabled: false,
          disabledReason: "This mask already uses Vector.",
        },
        setAlpha: { enabled: true, disabledReason: null },
        setLuminance: { enabled: false, disabledReason: "Unavailable." },
        setSources: { enabled: true, disabledReason: null },
      },
    }
    const state = setup(document, document, assets, [], context)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const getCapabilities = state.registered.get("get_capabilities")!
    const argumentsForward = {
      kind: "mask-sources",
      sourceNodeIds: ["cover-mask-alternate", "cover-panel"],
    }
    const forward = await getCapabilities.execute({
      commandIds: ["mask.sources.set"],
      arguments: argumentsForward,
    })
    const reverse = await getCapabilities.execute({
      commandIds: ["mask.sources.set"],
      arguments: {
        kind: "mask-sources",
        sourceNodeIds: ["cover-panel", "cover-mask-alternate"],
      },
    })
    const forwardCapability = (
      forward.structuredContent as {
        capabilities: Array<{ id: string; arguments: unknown }>
      }
    ).capabilities[0]!
    const reverseCapability = (
      reverse.structuredContent as { capabilities: Array<{ id: string }> }
    ).capabilities[0]!
    expect(forwardCapability.arguments).toEqual(argumentsForward)
    expect(forwardCapability.id).not.toBe(reverseCapability.id)

    const nestedCreateArguments = {
      kind: "mask-create",
      sourceNodeIds: ["cover-mask-alternate"],
      parentGroupId: "cover-mask",
    }
    const nestedCreate = await getCapabilities.execute({
      commandIds: ["mask.create"],
      arguments: nestedCreateArguments,
    })
    const topLevelCreate = await getCapabilities.execute({
      commandIds: ["mask.create"],
      arguments: {
        ...nestedCreateArguments,
        parentGroupId: null,
      },
    })
    const nestedCreateCapability = (
      nestedCreate.structuredContent as {
        capabilities: Array<{ id: string; arguments: unknown }>
      }
    ).capabilities[0]!
    const topLevelCreateCapability = (
      topLevelCreate.structuredContent as {
        capabilities: Array<{ id: string }>
      }
    ).capabilities[0]!
    expect(nestedCreateCapability.arguments).toEqual(nestedCreateArguments)
    expect(nestedCreateCapability.id).not.toBe(topLevelCreateCapability.id)

    expect(
      await getCapabilities.execute({
        commandIds: ["mask.create"],
        arguments: {
          kind: "mask-create",
          sourceNodeIds: ["cover-mask-alternate"],
        },
      })
    ).toMatchObject({
      isError: true,
      structuredContent: { code: "invalid_query" },
    })

    for (const invalidArguments of [
      {
        kind: "mask-sources",
        sourceNodeIds: ["cover-panel", "cover-panel"],
      },
      {
        kind: "mask-sources",
        sourceNodeIds: ["a", "b", "c", "d", "e"],
      },
    ]) {
      const invalid = await getCapabilities.execute({
        commandIds: ["mask.sources.set"],
        arguments: invalidArguments,
      })
      expect(invalid).toMatchObject({
        isError: true,
        structuredContent: { code: "invalid_query" },
      })
    }

    const expected = {
      documentId: document.id,
      revision: document.revision,
      snapshotId: "snapshot-seed",
      operationVersion: 0,
      activePageId: page.id,
      selection: {
        pageId: page.id,
        nodeIds: selectedNodeIds,
        groupId: "cover-mask",
      },
    }
    const proposed = await state.registered
      .get("execute_product_command")!
      .execute({
        capabilityId: forwardCapability.id,
        mode: "proposal",
        expected,
        idempotencyKey: "multi-mask-sources",
      })
    expect(proposed?.structuredContent).toMatchObject({
      status: "review_pending",
    })
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "set_mask_sources",
      groupId: "cover-mask",
      sourceNodeIds: ["cover-mask-alternate", "cover-panel"],
    })

    const stale = await state.registered
      .get("execute_product_command")!
      .execute({
        capabilityId: reverseCapability.id,
        mode: "dry_run",
        expected: { ...expected, revision: document.revision + 1 },
        idempotencyKey: "multi-mask-stale",
      })
    expect(stale).toMatchObject({
      isError: true,
      structuredContent: { code: "stale_context" },
    })
  })

  it("projects Select all availability from the explicitly targeted page", async () => {
    const populatedPage = northstarSeed.pages[0]!
    const emptyPage = {
      ...populatedPage,
      id: "empty-page",
      name: "Empty page",
      nodeIds: [],
    }
    const document: Document = {
      ...northstarSeed,
      pages: [...northstarSeed.pages, emptyPage],
      outputs: northstarSeed.outputs.map((output) =>
        output.id === emptyPage.outputId
          ? { ...output, pageIds: [...output.pageIds, emptyPage.id] }
          : output
      ),
    }
    const context = productCommandContext(document)
    const state = setup(document, document, assets, [], context)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const emptyResult = await state.registered
      .get("get_capabilities")
      ?.execute({
        commandIds: ["selection.select-all"],
        target: { kind: "page", pageId: emptyPage.id },
      })
    expect(emptyResult?.structuredContent).toMatchObject({
      capabilities: [
        {
          commandId: "selection.select-all",
          enabled: false,
          disabledReason: "This page does not contain any layers.",
        },
      ],
    })

    const populatedResult = await state.registered
      .get("get_capabilities")
      ?.execute({
        commandIds: ["selection.select-all"],
        target: { kind: "page", pageId: populatedPage.id },
      })
    expect(populatedResult?.structuredContent).toMatchObject({
      capabilities: [
        {
          commandId: "selection.select-all",
          enabled: true,
          disabledReason: null,
        },
      ],
    })
  })

  it("dry-runs, proposes, replays, and directly runs canonical commands safely", async () => {
    const document = withImageLayer({ id: "private-image" })
    document.nodes = document.nodes.map((node) =>
      node.id === "private-image"
        ? {
            ...node,
            assetId: "asset-private-renderer-secret",
            src: "asset:managed/asset-private-renderer-secret",
          }
        : node
    )
    const baseContext = productCommandContext(document)
    const context: ProductCommandRuntimeContext = {
      ...baseContext,
      selection: {
        pageId: "cover",
        nodeIds: ["private-image"],
        nodeTypes: ["image"],
        groupId: null,
        anyLocked: false,
        allLocked: false,
        allVisible: true,
        allHidden: false,
      },
      editor: {
        ...baseContext.editor,
        hasSelection: true,
        selectedNodeCount: 1,
      },
    }
    const state = setup(document, document, assets, [], context)
    const propose = vi.spyOn(state.services, "proposeChangeSet")
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const expected = {
      documentId: document.id,
      revision: document.revision,
      snapshotId: "snapshot-seed",
      operationVersion: 0,
      activePageId: "cover",
      selection: {
        pageId: "cover",
        nodeIds: ["private-image"],
        groupId: null,
      },
    }
    const execute = state.registered.get("execute_product_command")!

    const dryRun = await execute.execute({
      capabilityId: "object.duplicate",
      mode: "dry_run",
      expected,
      idempotencyKey: "duplicate-dry-run",
    })
    expect(dryRun?.structuredContent).toMatchObject({
      status: "validated",
      result: null,
      predictedRevision: document.revision + 1,
      affected: { nodes: { added: [expect.any(String)] } },
    })
    expect(propose).not.toHaveBeenCalled()
    expect(JSON.stringify(dryRun?.structuredContent)).not.toContain(
      "private-renderer-secret"
    )

    const request = {
      capabilityId: "object.duplicate",
      mode: "proposal",
      expected,
      idempotencyKey: "duplicate-proposal",
    } as const
    const concurrentResults = await Promise.all([
      execute.execute(request),
      execute.execute(request),
    ])
    const first = concurrentResults.find(
      (result) => result?.structuredContent?.replayed === false
    )
    const replay = concurrentResults.find(
      (result) => result?.structuredContent?.replayed === true
    )
    expect(first?.structuredContent).toMatchObject({
      status: "review_pending",
      result: null,
      review: { status: "pending" },
    })
    expect(replay?.structuredContent).toMatchObject({ replayed: true })
    expect(propose).toHaveBeenCalledTimes(1)
    expect(state.proposedProvenance()).toEqual({
      source: "webmcp",
      actorLabel: "WebMCP agent",
      toolName: "execute_product_command",
      reason: "Duplicate",
      requestId: "duplicate-proposal",
    })
    expect(JSON.stringify(first?.structuredContent)).not.toContain(
      "private-renderer-secret"
    )

    const reused = await execute.execute({
      ...request,
      mode: "dry_run",
    })
    expect(reused).toMatchObject({
      isError: true,
      structuredContent: {
        code: "idempotency_key_reused",
        retryable: false,
      },
    })

    const direct = await execute.execute({
      capabilityId: "tool.select",
      mode: "direct",
      expected,
      idempotencyKey: "select-tool",
    })
    expect(direct?.structuredContent).toMatchObject({
      status: "executed",
      session: { accepted: true },
    })
    expect(state.services.runProductCommand).toHaveBeenCalledTimes(1)

    const nonCurrentDirect = await execute.execute({
      capabilityId: "tool.select",
      mode: "direct",
      target: { kind: "page", pageId: "story" },
      expected,
      idempotencyKey: "select-tool-other-page",
    })
    expect(nonCurrentDirect).toMatchObject({
      isError: true,
      structuredContent: { code: "mode_not_supported" },
    })

    const staleSelection = await execute.execute({
      capabilityId: "object.duplicate",
      mode: "dry_run",
      expected: {
        ...expected,
        selection: {
          ...expected.selection,
          nodeIds: ["cover-title"],
        },
      },
      idempotencyKey: "stale-selection",
    })
    expect(staleSelection).toMatchObject({
      isError: true,
      structuredContent: { code: "stale_context", retryable: true },
    })
  })

  it("projects the host's exact command policy without inferring enablement", async () => {
    const commandCapabilities = [
      {
        id: "image.crop",
        label: "Crop image",
        enabled: false,
        reason: "Image pixels are still loading.",
      },
      {
        id: "image.replace",
        label: "Replace image",
        enabled: true,
      },
    ] as const
    const state = setup(
      northstarSeed,
      northstarSeed,
      assets,
      commandCapabilities
    )
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const inspected = await state.registered.get("inspect_design")?.execute({})
    expect(inspected?.structuredContent).toMatchObject({
      commandCapabilities,
    })
  })

  it("searches approved assets without exposing their source URLs", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("search_assets")?.execute({
      query: "arches",
      orientation: "landscape",
    })
    expect(result?.structuredContent).toEqual({
      assets: [
        expect.objectContaining({
          id: "sandstone-arches",
          orientation: "landscape",
          license: "Original Studio artwork",
        }),
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(result?.structuredContent)).not.toContain("src")
    expect(JSON.stringify(result?.structuredContent)).not.toContain(
      "data:image"
    )
  })

  it("searches workspace-owned assets without inventing a license or exposing private sources", async () => {
    const state = setup(northstarSeed, northstarSeed, [...assets, managedAsset])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("search_assets")?.execute({
      query: "reception portrait",
      orientation: "landscape",
    })
    expect(result?.structuredContent).toEqual({
      assets: [
        {
          id: managedAsset.id,
          name: managedAsset.name,
          tags: [],
          width: managedAsset.width,
          height: managedAsset.height,
          orientation: "landscape",
          ownership: "workspace",
        },
      ],
      nextCursor: null,
    })
    const serialized = JSON.stringify(result?.structuredContent)
    expect(serialized).not.toContain("src")
    expect(serialized).not.toContain("license")
    expect(serialized).not.toContain("asset:managed/")
    expect(serialized).not.toContain("r2")
  })

  it("passes opaque catalog cursors through without preloading later pages", async () => {
    const state = setup()
    const search = vi
      .fn<typeof state.services.searchAssets>()
      .mockResolvedValueOnce({
        assets: [assets[0]!],
        nextCursor: "catalog-page-2",
      })
      .mockResolvedValueOnce({
        assets: [managedAsset],
        nextCursor: null,
      })
    state.services.searchAssets = search
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const first = await state.registered.get("search_assets")?.execute({
      query: "portrait",
      limit: 1,
    })
    expect(first?.structuredContent).toMatchObject({
      nextCursor: "catalog-page-2",
    })
    expect(search).toHaveBeenCalledTimes(1)

    await state.registered.get("search_assets")?.execute({
      query: "portrait",
      limit: 1,
      cursor: "catalog-page-2",
    })
    expect(search).toHaveBeenNthCalledWith(
      2,
      {
        query: "portrait",
        orientation: undefined,
        tags: [],
        limit: 1,
        cursor: "catalog-page-2",
      },
      expect.any(AbortSignal)
    )
  })

  it("round-trips archived managed field identities for inspection and validation", async () => {
    const document: Document = {
      ...northstarSeed,
      fields: [
        ...northstarSeed.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset",
          required: true,
          agentDescription: "",
          validation: {},
          defaultValue: archivedManagedAsset.src,
        },
      ],
      fieldValues: {
        ...northstarSeed.fieldValues,
        hero_asset: archivedManagedAsset.src,
      },
    }
    const state = setup(document, document, [...assets, archivedManagedAsset])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const inspected = await state.registered.get("inspect_design")?.execute({})
    const fields = (
      inspected?.structuredContent as {
        fields: Array<Record<string, unknown>>
      }
    ).fields
    expect(fields.find((field) => field.id === "hero_asset")).toMatchObject({
      defaultValue: archivedManagedAsset.id,
      value: archivedManagedAsset.id,
      displayValue: archivedManagedAsset.name,
    })
    const validation = await state.registered
      .get("validate_design")
      ?.execute({})
    expect(validation?.structuredContent).toMatchObject({
      errors: expect.not.arrayContaining([
        expect.objectContaining({ code: "unmanaged_asset" }),
      ]),
    })
    expect(JSON.stringify(inspected?.structuredContent)).not.toContain(
      archivedManagedAsset.src
    )
  })

  it("keeps device-local asset aliases and IDs unavailable to public tools", async () => {
    const localSource = "asset:local/private-device-id"
    const withImage = applyCommand(northstarSeed, {
      id: "add-local-test-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      node: {
        id: "local-cover-photo",
        type: "image",
        name: "Local cover photo",
        assetId: "private-device-id",
        src: localSource,
        alt: "Local image",
        placement: fillPlacement,
        frameMask: { shape: "rectangle" },
        decorative: false,
        x: 610,
        y: 0,
        width: 630,
        height: 800,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      },
    })
    const document: Document = {
      ...withImage,
      fields: [
        ...withImage.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset",
          required: true,
          agentDescription: "",
          validation: {},
          defaultValue: localSource,
        },
      ],
      fieldValues: { ...withImage.fieldValues, hero_asset: localSource },
    }
    const state = setup(document, northstarSeed)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const inspected = await state.registered.get("inspect_design")?.execute({})
    const serialized = JSON.stringify(inspected?.structuredContent)
    expect(serialized).not.toContain(localSource)
    expect(serialized).not.toContain("private-device-id")
    expect(serialized).toContain("unavailable-local-asset")
    const validation = await state.registered
      .get("validate_design")
      ?.execute({})
    expect(validation?.structuredContent).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "unmanaged_asset" }),
      ]),
    })
  })

  it("validates exact managed image-node ownership while allowing archived existing references", async () => {
    const imageNode = {
      id: "managed-cover-photo",
      type: "image" as const,
      name: "Managed cover photo",
      assetId: archivedManagedAsset.id,
      src: archivedManagedAsset.src,
      alt: "Managed image",
      placement: fillPlacement,
      frameMask: { shape: "rectangle" as const },
      decorative: false,
      x: 610,
      y: 0,
      width: 630,
      height: 800,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    }
    const knownDocument = applyCommand(northstarSeed, {
      id: "add-managed-known-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      node: imageNode,
    })
    const known = setup(knownDocument, northstarSeed, [
      ...assets,
      archivedManagedAsset,
    ])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          known.registered.set(tool.name, tool)
          return undefined
        },
      },
      known.services,
      known.controller.signal
    )
    const knownValidation = await known.registered
      .get("validate_design")
      ?.execute({})
    const knownErrors = (
      knownValidation?.structuredContent as {
        errors: Array<Record<string, unknown>>
      }
    ).errors
    expect(knownErrors).toEqual([])

    const unknownDocument: Document = {
      ...knownDocument,
      nodes: knownDocument.nodes.map((node) =>
        node.id === imageNode.id
          ? {
              ...node,
              assetId: "asset-unknown0000",
              src: "asset:managed/asset-unknown0000",
            }
          : node
      ),
    }
    const unknown = setup(unknownDocument, northstarSeed)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          unknown.registered.set(tool.name, tool)
          return undefined
        },
      },
      unknown.services,
      unknown.controller.signal
    )
    const unknownValidation = await unknown.registered
      .get("validate_design")
      ?.execute({})
    expect(unknownValidation?.structuredContent).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "unmanaged_asset",
          nodeId: imageNode.id,
        }),
      ]),
    })
  })

  it("inspects the canonical managed source identity and reports an assetId mismatch", async () => {
    const document = structuredClone(northstarSeed)
    document.nodes.push({
      id: "mismatched-managed-image",
      type: "image",
      name: "Mismatched managed image",
      assetId: "asset-aaaaaaaaaa",
      src: managedAsset.src,
      alt: "Managed image",
      placement: fillPlacement,
      frameMask: { shape: "rectangle" },
      decorative: false,
      x: 610,
      y: 0,
      width: 630,
      height: 800,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    })
    document.pages[0]!.nodeIds.push("mismatched-managed-image")
    const conflictingAsset = {
      ...managedAsset,
      id: "asset-aaaaaaaaaa",
      src: "asset:managed/asset-aaaaaaaaaa",
    }
    const state = setup(document, northstarSeed, [
      ...assets,
      conflictingAsset,
      managedAsset,
    ])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const inspected = await state.registered.get("inspect_design")?.execute({})
    expect(inspected?.structuredContent).toMatchObject({
      activePageNodes: expect.arrayContaining([
        expect.objectContaining({
          id: "mismatched-managed-image",
          assetId: managedAsset.id,
        }),
      ]),
    })
    expect(JSON.stringify(inspected?.structuredContent)).not.toContain(
      managedAsset.src
    )

    const validation = await state.registered
      .get("validate_design")
      ?.execute({})
    expect(validation?.structuredContent).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_asset",
          nodeId: "mismatched-managed-image",
        }),
      ]),
    })
  })

  it("reports render-policy blockers through the canonical validation tool", async () => {
    const document: Document = {
      ...northstarSeed,
      pages: northstarSeed.pages.map((page, index) =>
        index === 0 ? { ...page, background: "url(https://evil.test)" } : page
      ),
    }
    const state = setup(document, northstarSeed)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("validate_design")?.execute({})
    expect(result?.structuredContent).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "unsafe_render_value" }),
      ]),
    })
  })

  it("reports asset fields without approved public identities before publish", async () => {
    const inlineAsset =
      "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%3E%3C%2Fsvg%3E"
    const document: Document = {
      ...northstarSeed,
      fields: [
        ...northstarSeed.fields,
        {
          id: "inline_asset",
          key: "inline_asset",
          label: "Inline asset",
          type: "asset",
          required: true,
          defaultValue: inlineAsset,
          agentDescription: "Hero artwork",
          validation: {},
        },
      ],
      fieldValues: {
        ...northstarSeed.fieldValues,
        inline_asset: inlineAsset,
      },
    }
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("validate_design")?.execute({})

    expect(result?.structuredContent).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "unmanaged_asset" }),
      ]),
    })
  })

  it("uses approved asset IDs for field inspection and proposals without exposing sources", async () => {
    const document: Document = {
      ...northstarSeed,
      fields: [
        ...northstarSeed.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset",
          required: true,
          defaultValue: assets[1]!.src,
        },
      ],
      fieldValues: {
        ...northstarSeed.fieldValues,
        hero_asset: assets[1]!.src,
      },
    }
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const inspected = await state.registered.get("inspect_design")?.execute({})
    const fields = (
      inspected?.structuredContent as {
        fields: Array<Record<string, unknown>>
      }
    ).fields
    expect(fields.find((field) => field.id === "hero_asset")).toMatchObject({
      defaultValue: "olive-botanical",
      value: "olive-botanical",
      displayValue: "Olive botanical",
    })

    const proposed = await state.registered
      .get("propose_field_updates")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        values: { hero_asset: "sandstone-arches" },
        reason: "Use the approved hero asset",
      })

    expect(proposed?.isError).toBeUndefined()
    expect(JSON.stringify(proposed?.structuredContent)).not.toContain(
      "data:image"
    )
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "set_field",
      fieldId: "hero_asset",
      value: assets[0]!.src,
    })
    expect(state.proposedProvenance()).toEqual({
      source: "webmcp",
      actorLabel: "WebMCP agent",
      toolName: "propose_field_updates",
      reason: "Use the approved hero asset",
      requestId: null,
    })

    const unapproved = await state.registered
      .get("propose_field_updates")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        values: { hero_asset: "https://example.test/unapproved.png" },
      })
    expect(unapproved?.isError).toBe(true)
    expect(unapproved?.content[0]?.text).toContain("Use search_assets first")
  })

  it("inserts an approved asset as a private reviewable layer", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("propose_asset_insertion")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-seed",
        pageId: "cover",
        assetId: "sandstone-arches",
        x: 620,
        y: 120,
        width: 540,
        height: 900,
        placement: fillPlacement,
        values: {
          couple_names: "Mira & Dev",
          package_name: "The Moonlit Weekend",
        },
      })

    expect(result?.isError).toBeUndefined()
    expect(JSON.stringify(result?.structuredContent)).not.toContain(
      "data:image"
    )
    expect(state.proposed()).toMatchObject({
      operations: [
        { command: { type: "set_field", value: "Mira & Dev" } },
        {
          command: { type: "set_field", value: "The Moonlit Weekend" },
        },
        {
          command: {
            type: "add_node",
            pageId: "cover",
            node: {
              type: "image",
              assetId: "sandstone-arches",
              src: "data:image/svg+xml,approved",
              x: 620,
              y: 120,
              width: 540,
              height: 900,
            },
          },
        },
      ],
    })
  })

  it("inspects compact render history with stable artifact URLs", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("inspect_render_history")
      ?.execute({ status: "completed", limit: 1 })

    expect(result?.structuredContent).toEqual({
      renders: [
        expect.objectContaining({
          id: "render-existing",
          status: "completed",
          artifacts: [
            expect.objectContaining({
              id: "artifact-existing",
              downloadUrl:
                "/v1/renders/render-existing/outputs/artifact-existing",
            }),
          ],
        }),
      ],
    })
    expect(JSON.stringify(result?.structuredContent)).not.toContain("r2_key")
    expect(JSON.stringify(result?.structuredContent)).not.toContain("objectUrl")
  })

  it("renders the exact published version through the shared history service", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("render_template")?.execute({
      templateId: "northstar-wedding-proposal",
      version: 1,
      modifications: { couple_names: "Mira & Dev" },
      outputs: [{ outputId: "proposal", format: "pdf" }],
      idempotencyKey: "render-exact-version",
    })

    expect(result?.isError).toBeUndefined()
    expect(state.renderedWith()).toEqual({
      modifications: { couple_names: "Mira & Dev" },
      selections: [{ outputId: "proposal", format: "pdf" }],
    })
    expect(result?.structuredContent).toMatchObject({
      id: "render-new",
      status: "completed",
      artifacts: [
        {
          id: "artifact-new",
          downloadUrl: "/v1/renders/render-new/outputs/artifact-new",
        },
      ],
    })
  })

  it("keeps approved asset IDs public until the Studio render boundary", async () => {
    const document: Document = {
      ...northstarSeed,
      fields: [
        ...northstarSeed.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset",
          required: true,
          defaultValue: assets[1]!.src,
        },
      ],
      fieldValues: {
        ...northstarSeed.fieldValues,
        hero_asset: assets[1]!.src,
      },
    }
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("render_template")?.execute({
      templateId: "northstar-wedding-proposal",
      version: 1,
      modifications: { hero_asset: "sandstone-arches" },
      outputs: [{ outputId: "proposal", format: "pdf" }],
      idempotencyKey: "render-public-asset",
    })

    expect(result?.isError).toBeUndefined()
    expect(state.renderedWith()?.modifications).toEqual({
      hero_asset: "sandstone-arches",
    })
    expect(result?.structuredContent).toMatchObject({
      modifications: { hero_asset: "sandstone-arches" },
    })
    expect(JSON.stringify(result?.structuredContent)).not.toContain(
      "data:image"
    )
  })

  it("renders an existing archived managed field but rejects new archived, local, and unknown values", async () => {
    const document: Document = {
      ...northstarSeed,
      fields: [
        ...northstarSeed.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset",
          required: true,
          agentDescription: "",
          validation: {},
          defaultValue: archivedManagedAsset.src,
        },
      ],
      fieldValues: {
        ...northstarSeed.fieldValues,
        hero_asset: archivedManagedAsset.src,
      },
    }
    const state = setup(document, document, [...assets, archivedManagedAsset])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const render = state.registered.get("render_template")
    const input = {
      templateId: "northstar-wedding-proposal",
      version: 1,
      outputs: [{ outputId: "proposal", format: "pdf" }],
      idempotencyKey: "render-archived-asset",
    }

    const existing = await render?.execute({
      ...input,
      modifications: { hero_asset: archivedManagedAsset.id },
    })
    expect(existing?.isError).toBeUndefined()
    expect(state.renderedWith()?.modifications).toEqual({
      hero_asset: archivedManagedAsset.id,
    })
    expect(JSON.stringify(existing?.structuredContent)).not.toContain(
      archivedManagedAsset.src
    )

    const local = await render?.execute({
      ...input,
      modifications: { hero_asset: "asset:local/private-device-id" },
    })
    expect(local?.isError).toBe(true)

    const unknown = await render?.execute({
      ...input,
      modifications: { hero_asset: "asset-unknown0000" },
    })
    expect(unknown?.isError).toBe(true)
  })

  it("does not borrow archived render eligibility from another asset parameter", async () => {
    const document: Document = {
      ...northstarSeed,
      fields: [
        ...northstarSeed.fields,
        {
          id: "existing_archived_asset",
          key: "existing_archived_asset",
          label: "Existing archived asset",
          type: "asset",
          required: true,
          agentDescription: "",
          validation: {},
          defaultValue: archivedManagedAsset.src,
        },
        {
          id: "new_asset_target",
          key: "new_asset_target",
          label: "New asset target",
          type: "asset",
          required: true,
          agentDescription: "",
          validation: {},
          defaultValue: assets[0]!.src,
        },
      ],
      fieldValues: {
        ...northstarSeed.fieldValues,
        existing_archived_asset: archivedManagedAsset.src,
        new_asset_target: assets[0]!.src,
      },
    }
    const state = setup(document, document, [...assets, archivedManagedAsset])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("render_template")?.execute({
      templateId: "northstar-wedding-proposal",
      version: 1,
      modifications: { new_asset_target: archivedManagedAsset.id },
      outputs: [{ outputId: "proposal", format: "pdf" }],
      idempotencyKey: "render-archived-new-target",
    })

    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain(
      `Archived asset ${archivedManagedAsset.id} is not available as a new value for New asset target.`
    )
    expect(state.renderedWith()).toBeUndefined()
  })

  it("rejects duplicate output and format pairs before the render service", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("render_template")?.execute({
      templateId: "northstar-wedding-proposal",
      version: 1,
      modifications: {},
      outputs: [
        { outputId: "proposal", format: "pdf" },
        { outputId: "proposal", format: "pdf" },
      ],
      idempotencyKey: "render-duplicate-output",
    })

    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain(
      "Duplicate render selection: proposal:pdf"
    )
    expect(state.renderedWith()).toBeUndefined()
  })

  it("rejects unknown parameters before starting a render", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("render_template")?.execute({
      templateId: "northstar-wedding-proposal",
      version: 1,
      modifications: { invented_parameter: "unsafe" },
      outputs: [{ outputId: "proposal", format: "pdf" }],
      idempotencyKey: "render-unknown-parameter",
    })

    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain("Unknown template parameter")
    expect(state.renderedWith()).toBeUndefined()
  })

  it("resolves approved replacements without overwriting authored alt text", async () => {
    const document = applyCommand(northstarSeed, {
      id: "add-test-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      node: {
        id: "cover-photo",
        type: "image",
        name: "Cover photo",
        assetId: "current",
        src: "data:image/svg+xml,current",
        alt: "Current image",
        placement: fillPlacement,
        frameMask: { shape: "rectangle" },
        decorative: false,
        x: 610,
        y: 0,
        width: 630,
        height: 800,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      },
    })
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("propose_canvas_edits")?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "cover-photo",
          assetId: "sandstone-arches",
          patch: {
            placement: { ...fillPlacement, focalY: 0.42 },
          },
        },
      ],
    })

    expect(result?.isError).toBeUndefined()
    expect(JSON.stringify(result?.structuredContent)).not.toContain(
      "data:image"
    )
    expect(state.proposed()).toMatchObject({
      operations: [
        {
          command: {
            type: "update_node",
            nodeId: "cover-photo",
            patch: {
              assetId: "sandstone-arches",
              src: "data:image/svg+xml,approved",
              placement: { ...fillPlacement, focalY: 0.42 },
            },
          },
        },
      ],
    })
    const proposed = state.proposed()
    expect(proposed).not.toBeNull()
    expect(
      previewChangeSet(document, proposed!).nodes.find(
        (node) => node.id === "cover-photo"
      )
    ).toMatchObject({
      assetId: "sandstone-arches",
      alt: "Current image",
      decorative: false,
    })
  })

  it("changes image alt text only when the replacement request supplies it", async () => {
    const document = withImageLayer()
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("propose_canvas_edits")?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "contract-image",
          assetId: "sandstone-arches",
          patch: { alt: "Couple beneath sandstone arches" },
        },
      ],
    })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_node",
      patch: {
        assetId: "sandstone-arches",
        src: "data:image/svg+xml,approved",
        alt: "Couple beneath sandstone arches",
      },
    })
  })

  it("preserves decorative accessibility intent and rejects a conflicting alt", async () => {
    const document = withImageLayer({
      id: "decorative-contract-image",
      alt: "",
      decorative: true,
    })
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const tool = state.registered.get("propose_canvas_edits")

    const replacement = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "decorative-contract-image",
          assetId: "sandstone-arches",
        },
      ],
    })
    expect(replacement?.isError).toBeUndefined()
    const proposed = state.proposed()
    expect(proposed).not.toBeNull()
    expect(
      previewChangeSet(document, proposed!).nodes.find(
        (node) => node.id === "decorative-contract-image"
      )
    ).toMatchObject({ alt: "", decorative: true })

    const conflict = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "decorative-contract-image",
          patch: { alt: "This must not coexist with decorative true" },
        },
      ],
    })
    expect(conflict?.isError).toBe(true)
    expect(conflict?.content[0]?.text).toContain(
      "Decorative images must use an empty alternative description"
    )
  })

  it("advertises and accepts a discriminated canonical image patch", async () => {
    const document = withImageLayer()
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const tool = state.registered.get("propose_canvas_edits")
    const schema = JSON.stringify(tool?.inputSchema)
    expect(schema).toContain('"oneOf"')
    expect(schema).toContain('"nodeType":{"const":"image"}')
    expect(schema).toContain('"placement"')
    expect(schema).toContain('"frameMask"')
    expect(schema).not.toContain('"additionalProperties":true')
    expect(schema).not.toContain('"cropX"')
    expect(schema).not.toContain('"transformMatrix"')

    const result = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "contract-image",
          patch: {
            placement: {
              ...fillPlacement,
              mode: "manual",
              focalX: 0.27,
              zoom: 1.8,
              rotation: 18,
              flipX: true,
            },
            frameMask: {
              shape: "rounded_rectangle",
              radius: 0.16,
              cornerRadii: {
                topLeft: 0.04,
                topRight: 0.08,
                bottomRight: 0.12,
                bottomLeft: 0.16,
              },
              cornerSmoothing: 0.5,
            },
          },
        },
      ],
    })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_node",
      patch: {
        placement: {
          mode: "manual",
          focalX: 0.27,
          zoom: 1.8,
          rotation: 18,
          flipX: true,
        },
        frameMask: {
          shape: "rounded_rectangle",
          radius: 0.16,
          cornerRadii: {
            topLeft: 0.04,
            topRight: 0.08,
            bottomRight: 0.12,
            bottomLeft: 0.16,
          },
          cornerSmoothing: 0.5,
        },
      },
    })
  })

  it("advertises and proposes strict canonical layer constraints", async () => {
    const document = withImageLayer()
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const tool = state.registered.get("propose_canvas_edits")
    expect(JSON.stringify(tool?.inputSchema)).toContain('"constraints"')

    const result = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "contract-image",
          patch: {
            constraints: { horizontal: "stretch", vertical: "center" },
            blendMode: "multiply",
          },
        },
      ],
    })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_node",
      nodeId: "contract-image",
      patch: {
        constraints: { horizontal: "stretch", vertical: "center" },
        blendMode: "multiply",
      },
    })

    const malformed = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "contract-image",
          patch: { constraints: { horizontal: "stretch" } },
        },
      ],
    })
    expect(malformed?.isError).toBe(true)
    expect(malformed?.content[0]?.text).toContain("patch is invalid")

    const malformedBlend = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "image",
          nodeId: "contract-image",
          patch: { blendMode: "source-in" },
        },
      ],
    })
    expect(malformedBlend?.isError).toBe(true)
  })

  it("advertises and proposes strict independent corner geometry", async () => {
    const document = withImageLayer()
    const rect = document.nodes.find((node) => node.type === "rect")!
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const tool = state.registered.get("propose_canvas_edits")
    const schema = JSON.stringify(tool?.inputSchema)
    expect(schema).toContain('"independentCorners"')
    expect(schema).toContain('"cornerSmoothing"')

    const result = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "rect",
          nodeId: rect.id,
          patch: {
            independentCorners: true,
            cornerRadii: {
              topLeft: 4,
              topRight: 8,
              bottomRight: 12,
              bottomLeft: 16,
            },
            cornerSmoothing: 0.65,
          },
        },
      ],
    })
    expect(result?.isError).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_node",
      nodeId: rect.id,
      patch: {
        independentCorners: true,
        cornerRadii: {
          topLeft: 4,
          topRight: 8,
          bottomRight: 12,
          bottomLeft: 16,
        },
        cornerSmoothing: 0.65,
      },
    })
  })

  it("advertises and proposes strict frame layout and clipping", async () => {
    const document = structuredClone(withImageLayer())
    const page = document.pages[0]!
    page.nodeIds.unshift("contract-frame")
    document.nodes.push({
      id: "contract-frame",
      type: "frame",
      name: "Contract frame",
      x: 0,
      y: 0,
      width: 400,
      height: 240,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "#ffffff",
      radius: 12,
      strokeWidth: 0,
      children: [],
      autoLayout: null,
      clipsContent: false,
    })
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const tool = state.registered.get("propose_canvas_edits")
    expect(JSON.stringify(tool?.inputSchema)).toContain('"autoLayout"')
    expect(JSON.stringify(tool?.inputSchema)).toContain('"layoutGrids"')
    const result = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "frame",
          nodeId: "contract-frame",
          patch: {
            clipsContent: true,
            layoutGrids: [
              {
                id: "contract-columns",
                pattern: "columns",
                visible: true,
                color: "#2563eb",
                opacity: 0.12,
                alignment: "stretch",
                count: 12,
                offset: 24,
                sectionSize: 1,
                gutter: 16,
              },
            ],
            autoLayout: {
              direction: "vertical",
              horizontalSizing: "fixed",
              verticalSizing: "hug",
              gap: 12,
              padding: { top: 8, right: 8, bottom: 8, left: 8 },
              primaryAlign: "start",
              counterAlign: "stretch",
            },
          },
        },
      ],
    })
    expect(result?.isError, result?.content[0]?.text).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_node",
      nodeId: "contract-frame",
      patch: { clipsContent: true },
    })
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      patch: {
        layoutGrids: [{ id: "contract-columns", pattern: "columns" }],
      },
    })

    const malformed = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "frame",
          nodeId: "contract-frame",
          patch: { autoLayout: { direction: "vertical" } },
        },
      ],
    })
    expect(malformed?.isError).toBe(true)

    const malformedGrid = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "frame",
          nodeId: "contract-frame",
          patch: {
            layoutGrids: [
              {
                id: "unbounded-grid",
                pattern: "columns",
                visible: true,
                color: "#2563eb",
                opacity: 0.12,
                alignment: "stretch",
                count: 65,
                offset: 24,
                sectionSize: 1,
                gutter: 16,
              },
            ],
          },
        },
      ],
    })
    expect(malformedGrid?.isError).toBe(true)
  })

  it("advertises, persists, and rejects malformed ordered paint stacks", async () => {
    const document = structuredClone(northstarSeed)
    const target = document.nodes.find((node) => node.type === "rect")
    if (!target || target.type !== "rect") throw new Error("Expected rectangle")
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const tool = state.registered.get("propose_canvas_edits")
    const schema = JSON.stringify(tool?.inputSchema)
    expect(schema).toContain('"fills"')
    expect(schema).toContain('"strokes"')
    expect(schema).toContain('"maxItems":8')

    const result = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "rect",
          nodeId: target.id,
          patch: {
            fills: [
              {
                id: "base",
                color: "#102030",
                opacity: 0.4,
                visible: false,
                blendMode: "multiply",
              },
              {
                id: "accent",
                color: "#abcdef",
                opacity: 1,
                visible: true,
              },
            ],
            strokes: [
              {
                id: "edge",
                color: "#fedcba",
                width: 3,
                opacity: 0.8,
                visible: true,
                blendMode: "overlay",
              },
            ],
          },
        },
      ],
    })
    expect(result?.isError, result?.content[0]?.text).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_node",
      nodeId: target.id,
      patch: {
        fills: [{ id: "base" }, { id: "accent" }],
        strokes: [{ id: "edge" }],
      },
    })
    expect(
      previewChangeSet(document, state.proposed()!).nodes.find(
        (node) => node.id === target.id
      )
    ).toMatchObject({ fill: "#102030", stroke: "#fedcba", strokeWidth: 3 })

    const malformed = await tool?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      edits: [
        {
          nodeType: "rect",
          nodeId: target.id,
          patch: {
            fills: [
              { id: "same", color: "#000", opacity: 1, visible: true },
              { id: "same", color: "#fff", opacity: 1, visible: true },
            ],
          },
        },
      ],
    })
    expect(malformed?.isError).toBe(true)
  })

  it("rejects untyped, malformed, legacy, and renderer-private image patches", async () => {
    const document = withImageLayer()
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const tool = state.registered.get("propose_canvas_edits")
    const proposal = (edit: Record<string, unknown>) =>
      tool?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        edits: [edit],
      })

    const untyped = await proposal({
      nodeId: "contract-image",
      patch: { placement: fillPlacement },
    })
    expect(untyped?.isError).toBe(true)
    expect(untyped?.content[0]?.text).toContain("nodeType")

    const malformed = await proposal({
      nodeType: "image",
      nodeId: "contract-image",
      patch: { placement: { mode: "fill" } },
    })
    expect(malformed?.isError).toBe(true)
    expect(malformed?.content[0]?.text).toContain("patch is invalid")

    for (const patch of [
      { fit: "cover" },
      { cropX: 0.25, cropY: 0.75 },
      { transformMatrix: [1, 0, 0, 1, 20, 30] },
    ]) {
      const legacy = await proposal({
        nodeType: "image",
        nodeId: "contract-image",
        patch,
      })
      expect(legacy?.isError).toBe(true)
      expect(legacy?.content[0]?.text).toContain("is not canonical")
    }
  })

  it("uses canonical managed identities in field, insertion, and replacement proposals", async () => {
    const withImage = applyCommand(northstarSeed, {
      id: "add-managed-test-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      node: {
        id: "managed-cover-photo",
        type: "image",
        name: "Cover photo",
        assetId: "olive-botanical",
        src: assets[1]!.src,
        alt: "Current image",
        placement: fillPlacement,
        frameMask: { shape: "rectangle" },
        decorative: false,
        x: 610,
        y: 0,
        width: 630,
        height: 800,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      },
    })
    const document: Document = {
      ...withImage,
      fields: [
        ...withImage.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset",
          required: true,
          agentDescription: "",
          validation: {},
          defaultValue: assets[1]!.src,
        },
      ],
      fieldValues: {
        ...withImage.fieldValues,
        hero_asset: assets[1]!.src,
      },
    }
    const state = setup(document, document, [...assets, managedAsset])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const field = await state.registered.get("propose_field_updates")?.execute({
      documentId: document.id,
      baseRevision: document.revision,
      baseSnapshotId: "snapshot-seed",
      values: { hero_asset: managedAsset.id },
    })
    expect(field?.isError).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "set_field",
      value: managedAsset.src,
    })

    const insertion = await state.registered
      .get("propose_asset_insertion")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        pageId: "cover",
        assetId: managedAsset.id,
        x: 10,
        y: 10,
        width: 300,
        height: 200,
        placement: fillPlacement,
      })
    expect(insertion?.isError).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "add_node",
      node: { assetId: managedAsset.id, src: managedAsset.src },
    })

    const replacement = await state.registered
      .get("propose_canvas_edits")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        edits: [
          {
            nodeType: "image",
            nodeId: "managed-cover-photo",
            assetId: managedAsset.id,
            patch: {
              placement: { ...fillPlacement, focalX: 0.4 },
            },
          },
        ],
      })
    expect(replacement?.isError).toBeUndefined()
    expect(state.proposed()?.operations[0]?.command).toMatchObject({
      type: "update_node",
      patch: {
        assetId: managedAsset.id,
        src: managedAsset.src,
        placement: { ...fillPlacement, focalX: 0.4 },
      },
    })
    for (const result of [field, insertion, replacement]) {
      const serialized = JSON.stringify(result?.structuredContent)
      expect(serialized).not.toContain(managedAsset.src)
      expect(serialized).not.toContain("data:image")
    }
  })

  it("rejects archived, local, and unknown identities for new proposals", async () => {
    const state = setup(northstarSeed, northstarSeed, [
      ...assets,
      archivedManagedAsset,
    ])
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )
    const base = {
      documentId: northstarSeed.id,
      baseRevision: northstarSeed.revision,
      baseSnapshotId: "snapshot-seed",
      pageId: "cover",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      placement: fillPlacement,
    }
    for (const assetId of [
      archivedManagedAsset.id,
      "asset:local/private-device-id",
      "asset-unknown0000",
    ]) {
      const result = await state.registered
        .get("propose_asset_insertion")
        ?.execute({ ...base, assetId })
      expect(result?.isError).toBe(true)
    }
  })

  it("creates a pending preview through the registered proposal handler", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("propose_field_updates")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-seed",
        reason: "Adapt the pack for a smaller celebration",
        values: {
          package_name: "The Saffron Weekend",
          package_price: "₹4,10,000",
        },
      })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()).toMatchObject({
      status: "pending",
      title: "Adapt the pack for a smaller celebration",
      operations: [
        { command: { type: "set_field", value: "The Saffron Weekend" } },
        { command: { type: "set_field", value: "410000" } },
      ],
    })
    expect(result?.content[0]?.text).toContain("nothing has been applied")
  })

  it("rejects field proposal values that violate the inspected field type", async () => {
    const document: Document = {
      ...northstarSeed,
      fields: northstarSeed.fields.map((field) =>
        field.id === "event_date"
          ? {
              ...field,
              type: "date",
              defaultValue: "2027-01-18",
            }
          : field
      ),
      fieldValues: {
        ...northstarSeed.fieldValues,
        event_date: "2027-01-18",
      },
    }
    const state = setup(document)
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("propose_field_updates")
      ?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-seed",
        values: { event_date: "18 January 2027" },
      })

    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain("Invalid value")
    expect(state.proposed()).toBeNull()
  })

  it("rejects numeric currency at proposal and render boundaries", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const proposal = await state.registered
      .get("propose_field_updates")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-seed",
        values: { package_price: 9_007_199_254_740_992 },
      })
    expect(proposal?.isError).toBe(true)
    expect(proposal?.content[0]?.text).toContain("exact decimal string")

    const render = await state.registered.get("render_template")?.execute({
      templateId: "northstar-wedding-proposal",
      version: 1,
      modifications: { package_price: 9_007_199_254_740_992 },
      outputs: [{ outputId: "proposal", format: "pdf" }],
      idempotencyKey: "render-unsafe-currency",
    })
    expect(render?.isError).toBe(true)
    expect(render?.content[0]?.text).toContain("exact decimal string")
    expect(state.renderedWith()).toBeUndefined()
  })

  it("rejects a stale snapshot even when the document revision matches", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("propose_field_updates")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-from-abandoned-branch",
        values: { package_name: "Stale package" },
      })

    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain("document snapshot changed")
    expect(state.proposed()).toBeNull()
  })

  it("creates a reviewable canvas proposal from stable node IDs", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered.get("propose_canvas_edits")?.execute({
      documentId: northstarSeed.id,
      baseRevision: northstarSeed.revision,
      baseSnapshotId: "snapshot-seed",
      reason: "Refine the cover hierarchy",
      edits: [
        {
          nodeType: "text",
          nodeId: "cover-title",
          patch: { y: 760, fontSize: 76 },
        },
      ],
    })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()).toMatchObject({
      title: "Refine the cover hierarchy",
      operations: [
        {
          command: {
            type: "update_node",
            nodeId: "cover-title",
            patch: { y: 760, fontSize: 76 },
          },
        },
      ],
    })
  })

  it("creates one atomic output adaptation proposal", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("propose_output_variant")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-seed",
        sourcePageId: "cover",
        name: "Instagram portrait",
        kind: "whatsapp_portrait",
        width: 1080,
        height: 1350,
        exportFormats: ["png"],
      })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()).toMatchObject({
      operations: [
        {
          command: {
            type: "add_output_variant",
            output: { name: "Instagram portrait" },
            page: { width: 1080, height: 1350 },
          },
        },
      ],
    })
  })

  it("accepts the canonical custom output kind through WebMCP", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("propose_output_variant")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-seed",
        sourcePageId: "cover",
        name: "Custom document",
        kind: "custom",
        width: 1600,
        height: 900,
        exportFormats: ["png", "pdf"],
      })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()).toMatchObject({
      operations: [
        {
          command: {
            type: "add_output_variant",
            output: {
              name: "Custom document",
              kind: "custom",
              exportFormats: ["png", "pdf"],
            },
          },
        },
      ],
    })
  })
})
