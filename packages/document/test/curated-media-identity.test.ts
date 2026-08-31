import { describe, expect, it } from "vitest"
import {
  applyCommand,
  curatedAssetIdentityFromSource,
  documentSchema,
  northstarSeed,
} from "../src"

const source = `/library/media/star/v1/${"a".repeat(64)}.svg`

describe("curated media identity", () => {
  it("parses only exact immutable first-party paths", () => {
    expect(curatedAssetIdentityFromSource(source)).toEqual({
      assetId: "star",
      version: 1,
      contentSha256: "a".repeat(64),
    })
    expect(
      curatedAssetIdentityFromSource(
        "https://example.test/library/media/star.svg"
      )
    ).toBeNull()
    expect(
      curatedAssetIdentityFromSource("/library/media/../star.svg")
    ).toBeNull()
    expect(
      curatedAssetIdentityFromSource("/library/media/star/v0/x.svg")
    ).toBeNull()
  })

  it("requires an image node's asset ID to match its curated source", () => {
    const document = structuredClone(northstarSeed)
    const image = {
      id: "curated-image",
      name: "Curated image",
      type: "image" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "star",
      src: source,
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
      alt: "Star",
      decorative: false,
    }
    document.nodes.push(image)
    document.pages.at(0)?.nodeIds.push(image.id)
    expect(documentSchema.safeParse(document).success).toBe(true)
    expect(
      documentSchema.safeParse({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === image.id ? { ...node, assetId: "wrong" } : node
        ),
      }).success
    ).toBe(false)
  })

  it("projects a curated asset field source and ID atomically", () => {
    const document = structuredClone(northstarSeed)
    const image = {
      id: "bound-curated-image",
      name: "Bound curated image",
      type: "image" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "previous",
      src: "data:image/png;base64,iVBORw0KGgo=",
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
      alt: "Star",
      decorative: false,
    }
    document.nodes.push(image)
    document.pages.at(0)?.nodeIds.push(image.id)
    document.fields.push({
      id: "curated-field",
      key: "curated_field",
      label: "Curated field",
      type: "asset",
      required: true,
      defaultValue: source,
      agentDescription: "Curated media",
      validation: {},
    })
    document.fieldValues["curated-field"] = source
    document.bindings.push({
      id: "curated-binding",
      fieldId: "curated-field",
      nodeId: image.id,
      property: "src",
    })

    const updated = applyCommand(document, {
      id: "set-curated-field",
      type: "set_field",
      actor: "human",
      at: "2026-08-31T00:00:00.000Z",
      fieldId: "curated-field",
      value: source,
    })
    expect(updated.nodes.find((node) => node.id === image.id)).toMatchObject({
      assetId: "star",
      src: source,
    })
  })
})
