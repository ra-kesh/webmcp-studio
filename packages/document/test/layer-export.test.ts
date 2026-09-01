import { describe, expect, it } from "vitest"
import {
  createTemplateManifest,
  documentSchema,
  layerExportFilename,
  northstarSeed,
  projectLayerExportDocument,
  resolveLayerExportRoutes,
} from "../src"

describe("per-layer export routing", () => {
  const fixture = () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages[0]!
    const nodeId = page.nodeIds.find((id) =>
      document.nodes.some((node) => node.id === id && node.type === "rect")
    )!
    document.nodes = document.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            exportSettings: [
              {
                id: "png-2x",
                format: "png" as const,
                scale: 2,
                suffix: "-hero",
              },
              { id: "pdf", format: "pdf" as const, scale: 1, suffix: "" },
            ],
            effects: [
              {
                id: "shadow",
                type: "drop_shadow" as const,
                color: "#00000040",
                offsetX: 4,
                offsetY: 6,
                blur: 8,
                visible: true,
              },
            ],
          }
        : node
    )
    return { document, nodeId, page }
  }

  it("derives stable page/output routes and collision-resistant filenames", () => {
    const { document, nodeId, page } = fixture()
    const routes = resolveLayerExportRoutes(document, nodeId)
    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({
      nodeId,
      pageId: page.id,
      outputId: page.outputId,
      filename: expect.stringMatching(/-hero@2x\.png$/),
    })
    expect(layerExportFilename("  !!!  ", routes[1]!.setting)).toBe("layer.pdf")
  })

  it("projects an isolated transparent render document with scaled effect bounds", () => {
    const { document, nodeId } = fixture()
    const route = resolveLayerExportRoutes(document, nodeId)[0]!
    const projected = projectLayerExportDocument(document, route)
    expect(() => documentSchema.parse(projected)).not.toThrow()
    const page = projected.pages.find(
      (candidate) => candidate.id === route.pageId
    )!
    const node = projected.nodes.find((candidate) => candidate.id === nodeId)!
    expect(page).toMatchObject({ background: "transparent", nodeIds: [nodeId] })
    expect(
      projected.outputs.find((output) => output.id === route.outputId)
    ).toMatchObject({
      pageIds: [route.pageId],
      exportFormats: ["png"],
    })
    expect(node.width).toBeGreaterThan(0)
    expect(node.effects?.[0]).toMatchObject({
      offsetX: 8,
      offsetY: 12,
      blur: 16,
    })
  })

  it("publishes the same deterministic layer routes in the output manifest", () => {
    const { document, nodeId } = fixture()
    const manifest = createTemplateManifest(document)
    const published = manifest.outputs.flatMap((output) => output.layerExports)
    expect(published).toEqual(
      resolveLayerExportRoutes(document, nodeId).map((route) => ({
        nodeId: route.nodeId,
        pageId: route.pageId,
        settingId: route.setting.id,
        format: route.setting.format,
        scale: route.setting.scale,
        filename: route.filename,
      }))
    )
  })
})
