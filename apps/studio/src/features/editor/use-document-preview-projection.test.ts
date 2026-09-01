import { describe, expect, it } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import { localAssetSource } from "./local-asset-store"
import {
  projectCanonicalDocumentPreview,
  projectEditorDocumentPreview,
} from "./use-document-preview-projection"

const requireImage = (
  nodes: typeof renderConformanceDocument.nodes,
  nodeId: string
) => {
  const node = nodes.find((candidate) => candidate.id === nodeId)
  if (node?.type !== "image") throw new Error("Expected projected image")
  return node
}

const imageFixture = () => {
  const document = structuredClone(renderConformanceDocument)
  const image = document.nodes.find((node) => node.type === "image")
  if (!image) throw new Error("Quotation fixture has no image")
  return { document, image }
}

describe("document editor preview projection", () => {
  it("returns the canonical document unchanged without an accepted review preview", () => {
    const { document } = imageFixture()
    expect(
      projectCanonicalDocumentPreview({
        document,
        snapshotId: "snapshot-1",
        pendingChangeSet: null,
        changeSetConflict: null,
      })
    ).toBe(document)
  })

  it("projects replacement and local URLs without mutating canonical data", () => {
    const { document, image } = imageFixture()
    const localAssetId = "local-preview-asset"
    const localSource = localAssetSource(localAssetId)
    const canonical = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === image.id
          ? { ...node, assetId: localAssetId, src: localSource }
          : node
      ),
    }
    const pendingAsset = {
      assetId: "replacement-asset",
      name: "Replacement",
      description: "Replacement description",
      src: "https://canonical.example/replacement.png",
      width: 640,
      height: 480,
    }
    const localProjected = projectEditorDocumentPreview({
      canonicalDocument: canonical,
      pendingImageReplacement: null,
      localAssetPreviewUrls: new Map([[localAssetId, "blob:local-preview"]]),
    })
    const projected = projectEditorDocumentPreview({
      canonicalDocument: canonical,
      pendingImageReplacement: {
        nodeId: image.id,
        previewSrc: "blob:replacement-preview",
        payload: { asset: pendingAsset },
      },
      localAssetPreviewUrls: new Map([[localAssetId, "blob:local-preview"]]),
    })
    const projectedImage = requireImage(projected.nodes, image.id)
    const canonicalImage = requireImage(canonical.nodes, image.id)
    const localProjectedImage = requireImage(localProjected.nodes, image.id)

    expect(localProjectedImage.src).toBe("blob:local-preview")
    expect(projectedImage.assetId).toBe(pendingAsset.assetId)
    expect(projectedImage.src).toBe("blob:replacement-preview")
    expect(canonicalImage.assetId).toBe(localAssetId)
    expect(canonicalImage.src).toBe(localSource)
  })
})
