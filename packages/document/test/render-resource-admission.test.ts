import { describe, expect, it } from "vitest"
import {
  RenderImageResourceAdmissionError,
  assertRenderImageResourceAdmission,
  northstarSeed,
  renderImageResourceExpectationSchema,
  type Document,
  type RenderImageResourceExpectation,
} from "../src"

const source =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

const documentWithManagedImage = (): Document => {
  const document = structuredClone(northstarSeed)
  document.pages[0]!.nodeIds.push("managed-image")
  document.nodes.push({
    id: "managed-image",
    name: "Managed image",
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    constraints: { horizontal: "min", vertical: "min" },
    assetId: "asset-abcdefghij",
    src: source,
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
    alt: "Managed image",
    decorative: false,
  })
  return document
}

const expectation = async (): Promise<RenderImageResourceExpectation> => {
  const bytes = Uint8Array.from(
    atob(source.slice(source.indexOf(",") + 1)),
    (character) => character.charCodeAt(0)
  )
  const contentHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")
  return {
    nodeId: "managed-image",
    assetId: "asset-abcdefghij",
    width: 1200,
    height: 800,
    contentHash,
    revision: 3,
  }
}

describe("render image resource admission", () => {
  it("accepts immutable curated catalog identities in the renderer contract", async () => {
    expect(
      renderImageResourceExpectationSchema.parse({
        ...(await expectation()),
        assetId: "olive-botanical",
      }).assetId
    ).toBe("olive-botanical")
  })

  it("admits an exact node, asset identity, and inline source digest", async () => {
    await expect(
      assertRenderImageResourceAdmission(documentWithManagedImage(), [
        await expectation(),
      ])
    ).resolves.toBeUndefined()
  })

  it.each([
    [
      "image_resource_node_missing",
      (document: Document, resource: RenderImageResourceExpectation) => {
        resource.nodeId = "missing-image"
      },
    ],
    [
      "image_resource_type_mismatch",
      (document: Document, resource: RenderImageResourceExpectation) => {
        resource.nodeId = document.nodes.find(
          (node) => node.type === "text"
        )!.id
      },
    ],
    [
      "image_resource_identity_mismatch",
      (_document: Document, resource: RenderImageResourceExpectation) => {
        resource.assetId = "asset-zyxwvutsrq"
      },
    ],
    [
      "image_resource_source_mismatch",
      (document: Document) => {
        const node = document.nodes.find(
          (candidate) => candidate.id === "managed-image"
        )!
        if (node.type === "image") node.src = source.replace("Nk+A8", "Nk+B8")
      },
    ],
  ] as const)("rejects %s node-specifically", async (code, mutate) => {
    const document = documentWithManagedImage()
    const resource = await expectation()
    mutate(document, resource)

    await expect(
      assertRenderImageResourceAdmission(document, [resource])
    ).rejects.toEqual(
      expect.objectContaining<Partial<RenderImageResourceAdmissionError>>({
        code,
        nodeId: resource.nodeId,
      })
    )
  })

  it("rejects duplicate node expectations before render", async () => {
    const resource = await expectation()
    await expect(
      assertRenderImageResourceAdmission(documentWithManagedImage(), [
        resource,
        { ...resource },
      ])
    ).rejects.toMatchObject({
      code: "image_resource_duplicate",
      nodeId: "managed-image",
    })
  })

  it("rejects inline raster dimensions before Browser decode", async () => {
    const document = documentWithManagedImage()
    const node = document.nodes.find(
      (candidate) => candidate.id === "managed-image"
    )
    if (!node || node.type !== "image") throw new Error("Missing image fixture")
    const bytes = Uint8Array.from(
      atob(source.slice(source.indexOf(",") + 1)),
      (character) => character.charCodeAt(0)
    )
    new DataView(bytes.buffer).setUint32(16, 20_000)
    node.src = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`

    await expect(
      assertRenderImageResourceAdmission(document, [])
    ).rejects.toMatchObject({
      code: "image_resource_inline_dimensions_exceeded",
      nodeId: "managed-image",
    })
  })
})
