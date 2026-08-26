import { describe, expect, it } from "vitest"
import {
  applyCommand,
  createTemplateVersion,
  northstarSeed,
  type ChangeSet,
  type Document,
  type TemplateModifications,
} from "@webmcp/document"
import {
  registerStudioWebMcpTools,
  type StudioWebMcpRenderRecord,
  type StudioWebMcpRenderSelection,
  type WebMcpTool,
} from "../src"

const assets = [
  {
    id: "sandstone-arches",
    name: "Sandstone arches",
    description: "Architectural arches with restrained earth tones",
    tags: ["architecture", "arches", "sandstone"],
    width: 1600,
    height: 1200,
    license: "Original Studio artwork",
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
    src: "data:image/svg+xml,botanical",
  },
]

function setup(document: Document = northstarSeed) {
  const registered = new Map<string, WebMcpTool>()
  let proposed: ChangeSet | null = null
  const controller = new AbortController()
  const publishedVersion = createTemplateVersion(northstarSeed, {
    id: "version-1",
    templateId: "northstar-wedding-proposal",
    version: 1,
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
      activePageId: "cover",
      selection: null,
      pendingChangeSet: proposed,
      assets,
      publishedVersion,
      renderHistory,
    }),
    proposeChangeSet: (changeSet: ChangeSet) => {
      proposed = changeSet
      return changeSet
    },
    publishTemplate: () => publishedVersion,
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

    expect(count).toBe(9)
    expect([...state.registered.keys()]).toEqual([
      "inspect_design",
      "search_assets",
      "validate_design",
      "propose_field_updates",
      "propose_canvas_edits",
      "propose_output_variant",
      "publish_template",
      "inspect_render_history",
      "render_template",
    ])

    const inspected = await state.registered.get("inspect_design")?.execute({})
    expect(inspected?.structuredContent).toMatchObject({
      document: { id: northstarSeed.id, revision: northstarSeed.revision },
      activePage: { id: "cover" },
      activePageNodes: expect.arrayContaining([
        expect.objectContaining({ id: "cover-title", type: "text" }),
      ]),
    })

    const published = await state.registered.get("publish_template")?.execute({
      documentId: northstarSeed.id,
      expectedRevision: northstarSeed.revision,
    })
    expect(published?.structuredContent).toMatchObject({
      templateId: "northstar-wedding-proposal",
      version: 1,
      sourceRevision: northstarSeed.revision,
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
    })
    expect(JSON.stringify(result?.structuredContent)).not.toContain("src")
    expect(JSON.stringify(result?.structuredContent)).not.toContain(
      "data:image"
    )
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
    })

    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain("Unknown template parameter")
    expect(state.renderedWith()).toBeUndefined()
  })

  it("resolves approved asset IDs into reviewable image replacements", async () => {
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
        fit: "cover",
        cropX: 0.5,
        cropY: 0.5,
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
      edits: [
        {
          nodeId: "cover-photo",
          assetId: "sandstone-arches",
          patch: { cropY: 0.42 },
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
              alt: "Architectural arches with restrained earth tones",
              cropY: 0.42,
            },
          },
        },
      ],
    })
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
        { command: { type: "set_field", value: "₹4,10,000" } },
      ],
    })
    expect(result?.content[0]?.text).toContain("nothing has been applied")
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
      reason: "Refine the cover hierarchy",
      edits: [
        {
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
})
