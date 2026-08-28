import type { Document } from "./schema"

export type RenderImageResourceExpectation = {
  nodeId: string
  assetId: string
  width: number
  height: number
  contentHash: string
  revision: number
}

export type RenderImageResourceAdmissionErrorCode =
  | "image_resource_duplicate"
  | "image_resource_identity_mismatch"
  | "image_resource_node_missing"
  | "image_resource_source_mismatch"
  | "image_resource_type_mismatch"

export class RenderImageResourceAdmissionError extends Error {
  constructor(
    readonly code: RenderImageResourceAdmissionErrorCode,
    readonly nodeId: string,
    readonly assetId?: string
  ) {
    super(`Managed render resource admission failed for image node ${nodeId}`)
    this.name = "RenderImageResourceAdmissionError"
  }
}

const inlineRasterSource =
  /^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/]+=*)$/i

const decodeInlineRaster = (source: string): Uint8Array | null => {
  const match = inlineRasterSource.exec(source)
  if (!match?.[1]) return null
  try {
    const decoded = atob(match[1])
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

/**
 * Proves that every managed-resource expectation belongs to one exact image
 * node and to the exact inline bytes passed to the private renderer. Natural
 * dimensions are intentionally verified after browser decode; metadata alone
 * is not accepted as proof that the renderer decoded the same geometry.
 */
export async function assertRenderImageResourceAdmission(
  document: Document,
  expectations: readonly RenderImageResourceExpectation[]
): Promise<void> {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const seenNodeIds = new Set<string>()

  for (const expectation of expectations) {
    if (seenNodeIds.has(expectation.nodeId)) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_duplicate",
        expectation.nodeId,
        expectation.assetId
      )
    }
    seenNodeIds.add(expectation.nodeId)

    const node = nodeById.get(expectation.nodeId)
    if (!node) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_node_missing",
        expectation.nodeId,
        expectation.assetId
      )
    }
    if (node.type !== "image") {
      throw new RenderImageResourceAdmissionError(
        "image_resource_type_mismatch",
        expectation.nodeId,
        expectation.assetId
      )
    }
    if (node.assetId !== expectation.assetId) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_identity_mismatch",
        expectation.nodeId,
        expectation.assetId
      )
    }

    const bytes = decodeInlineRaster(node.src)
    if (!bytes || (await sha256Hex(bytes)) !== expectation.contentHash) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_source_mismatch",
        expectation.nodeId,
        expectation.assetId
      )
    }
  }
}
