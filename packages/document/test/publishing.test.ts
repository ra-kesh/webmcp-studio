import { describe, expect, it } from "vitest"
import {
  createTemplateManifest,
  createTemplateVersion,
  getPublishReadiness,
  northstarSeed,
} from "../src"

describe("template publishing", () => {
  it("builds a parameter manifest with stable output and binding targets", () => {
    const manifest = createTemplateManifest(northstarSeed)
    const packageName = manifest.parameters.find(
      (parameter) => parameter.key === "package_name"
    )

    expect(packageName).toMatchObject({
      label: "Package name",
      required: true,
      exampleValue: "The Heirloom Weekend",
    })
    expect(packageName?.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outputId: "proposal",
          nodeId: "package-name",
          property: "text",
        }),
        expect.objectContaining({
          outputId: "whatsapp",
          nodeId: "wa-title",
          property: "text",
        }),
      ])
    )
    expect(manifest.outputs[0]?.pages).toHaveLength(5)
  })

  it("creates an immutable snapshot detached from later source edits", () => {
    const source = structuredClone(northstarSeed)
    const published = createTemplateVersion(source, {
      id: "template-version-1",
      templateId: "northstar-wedding-proposal",
      version: 1,
      publishedAt: "2026-08-26T10:00:00.000Z",
    })

    source.name = "Changed after publishing"
    source.fieldValues.package_name = "Changed after publishing"
    expect(published.document.name).toBe(northstarSeed.name)
    expect(published.document.fieldValues.package_name).toBe(
      "The Heirloom Weekend"
    )
    expect(published.sourceRevision).toBe(northstarSeed.revision)
  })

  it("blocks invalid documents and browser-local assets", () => {
    const withLocalAsset = {
      ...northstarSeed,
      nodes: [
        ...northstarSeed.nodes,
        {
          id: "local-image",
          type: "image" as const,
          name: "Local image",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          assetId: "asset-local",
          src: "asset:local/asset-local",
          fit: "cover" as const,
          cropX: 0.5,
          cropY: 0.5,
          alt: "",
        },
      ],
    }
    expect(getPublishReadiness(withLocalAsset).localAssetNodeIds).toEqual([
      "local-image",
    ])
    expect(() =>
      createTemplateVersion(withLocalAsset, {
        id: "template-version-1",
        templateId: "northstar-wedding-proposal",
        version: 1,
        publishedAt: "2026-08-26T10:00:00.000Z",
      })
    ).toThrow("Upload local images")
  })
})
