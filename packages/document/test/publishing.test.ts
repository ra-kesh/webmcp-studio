import { describe, expect, it } from "vitest"
import {
  createTemplateManifest,
  createTemplateVersion,
  createTemplateVersionFromPublishRequest,
  deriveDocumentSnapshotId,
  getPublishReadiness,
  northstarSeed,
} from "../src"

const sourceSnapshotId = `sha256-${"a".repeat(64)}`

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

  it("publishes field agent descriptions and validation metadata", () => {
    const document = structuredClone(northstarSeed)
    document.fields.push({
      id: "tone",
      key: "tone",
      label: "Tone",
      type: "choice",
      required: true,
      defaultValue: "editorial",
      agentDescription: "Choose the visual voice for this output",
      validation: {
        options: [
          {
            value: "editorial",
            label: "Editorial",
            agentDescription: "Quiet and premium",
          },
        ],
      },
    })
    document.fieldValues.tone = "editorial"

    expect(
      createTemplateManifest(document).parameters.find(
        (parameter) => parameter.id === "tone"
      )
    ).toMatchObject({
      agentDescription: "Choose the visual voice for this output",
      validation: {
        options: [
          {
            value: "editorial",
            label: "Editorial",
            agentDescription: "Quiet and premium",
          },
        ],
      },
    })
  })

  it("blocks unresolved asset field defaults and current values even when unbound", () => {
    const document = structuredClone(northstarSeed)
    document.fields.push({
      id: "hero-image",
      key: "hero_image",
      label: "Hero image",
      type: "asset",
      required: true,
      defaultValue: "https://assets.example.test/default.png",
      agentDescription: "Primary hero image",
      validation: {},
    })
    document.fieldValues["hero-image"] =
      "https://assets.example.test/current.png"

    expect(getPublishReadiness(document).blocking).toContainEqual(
      expect.objectContaining({
        id: "field:hero-image:unresolved-asset",
        code: "unmanaged_asset",
      })
    )
    expect(() =>
      createTemplateVersion(document, {
        id: "unresolved-asset-field-version",
        templateId: "northstar-wedding-proposal",
        version: 1,
        sourceSnapshotId,
        publishedAt: "2026-08-28T12:00:00.000Z",
      })
    ).toThrow("network-isolated managed image")
  })

  it("creates an immutable snapshot detached from later source edits", () => {
    const source = structuredClone(northstarSeed)
    const published = createTemplateVersion(source, {
      id: "template-version-1",
      templateId: "northstar-wedding-proposal",
      version: 1,
      sourceSnapshotId,
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

  it("derives source revision, snapshot identity, and manifest from the server publish request", async () => {
    const version = await createTemplateVersionFromPublishRequest({
      id: "derived-template-version",
      templateId: "northstar-wedding-proposal",
      version: 1,
      publishedAt: "2026-08-26T10:00:00.000Z",
      document: northstarSeed,
    })

    expect(version.sourceRevision).toBe(northstarSeed.revision)
    expect(version.sourceSnapshotId).toBe(
      await deriveDocumentSnapshotId(northstarSeed)
    )
    expect(version.manifest).toEqual(createTemplateManifest(northstarSeed))
  })

  it("requires alternative text or explicit decorative intent before publishing", () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages[0]!
    page.nodeIds.push("unlabelled-image")
    document.nodes.push({
      id: "unlabelled-image",
      type: "image",
      name: "Unlabelled image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "asset-inline-image",
      src: "data:image/png;base64,AA==",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      alt: "",
      decorative: false,
    })

    expect(getPublishReadiness(document).blocking).toContainEqual(
      expect.objectContaining({
        code: "missing_alt_text",
        nodeId: "unlabelled-image",
      })
    )
    expect(() =>
      createTemplateVersion(document, {
        id: "unlabelled-image-version",
        templateId: "northstar-wedding-proposal",
        version: 1,
        sourceSnapshotId,
        publishedAt: "2026-08-26T10:00:00.000Z",
      })
    ).toThrow("needs alternative text or must be marked decorative")

    const image = document.nodes.find((node) => node.id === "unlabelled-image")
    if (!image || image.type !== "image") throw new Error("Image missing")
    image.decorative = true
    expect(getPublishReadiness(document).blocking).not.toContainEqual(
      expect.objectContaining({ code: "missing_alt_text" })
    )
  })

  it("blocks invalid documents and browser-local assets", () => {
    const firstPage = northstarSeed.pages[0]!
    const withLocalAsset = {
      ...northstarSeed,
      pages: northstarSeed.pages.map((page) =>
        page.id === firstPage.id
          ? { ...page, nodeIds: [...page.nodeIds, "local-image"] }
          : page
      ),
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
          placement: {
            mode: "fill" as const,
            focalX: 0.5,
            focalY: 0.5,
            zoom: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          frameMask: { shape: "rectangle" as const },
          alt: "Local image",
          decorative: false,
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
        sourceSnapshotId,
        publishedAt: "2026-08-26T10:00:00.000Z",
      })
    ).toThrow("Upload local images")
  })

  it("blocks fonts that the deterministic renderer cannot load", () => {
    const document = structuredClone(northstarSeed)
    const text = document.nodes.find((node) => node.type === "text")
    if (!text || text.type !== "text") throw new Error("Text fixture missing")
    text.fontFamily = "Unmanaged Brand Font"

    expect(getPublishReadiness(document).blocking).toContainEqual(
      expect.objectContaining({ code: "unsupported_font", nodeId: text.id })
    )
    expect(() =>
      createTemplateVersion(document, {
        id: "unsupported-font-version",
        templateId: "northstar-wedding-proposal",
        version: 1,
        sourceSnapshotId,
        publishedAt: "2026-08-26T10:00:00.000Z",
      })
    ).toThrow("unavailable to the renderer")
  })
})
