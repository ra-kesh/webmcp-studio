import { describe, expect, it } from "vitest"
import {
  RenderImageResourceAdmissionError,
  assertRenderImageResourceAdmission,
  northstarSeed,
  type Document,
  type RenderImageResourceExpectation,
} from "../src"

const source = "data:image/png;base64,AQIDBA=="

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
  const contentHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from([1, 2, 3, 4]))
    ),
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
        if (node.type === "image") node.src = "data:image/png;base64,AQIDBQ=="
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
})
