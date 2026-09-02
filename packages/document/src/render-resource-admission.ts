import type { Document, SceneNode } from "./schema"
import { z } from "zod"
import { sceneNodeImageReferences } from "./media"
import {
  inspectInlineRasterSource,
  RasterInspectionError,
} from "./raster-inspection"

/**
 * Private renderer contract for an exact image resource. Asset identities are
 * deliberately broader than uploaded-media IDs because immutable first-party
 * catalog assets retain their catalog identity through materialization.
 */
export const renderImageResourceExpectationSchema = z
  .object({
    nodeId: z.string().min(1),
    paintId: z.string().min(1).optional(),
    assetId: z.string().min(1).max(200),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().positive(),
  })
  .strict()

export type RenderImageResourceExpectation = z.infer<
  typeof renderImageResourceExpectationSchema
>

export type RenderImageResourceAdmissionErrorCode =
  | "image_resource_duplicate"
  | "image_resource_identity_mismatch"
  | "image_resource_node_missing"
  | "image_resource_source_mismatch"
  | "image_resource_type_mismatch"
  | "image_resource_inline_invalid"
  | "image_resource_inline_dimensions_exceeded"

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

const decodeInlineImage = (source: string): Uint8Array | null => {
  const raster = decodeInlineRaster(source)
  if (raster) return raster
  if (!/^data:image\/svg\+xml(?:;charset=utf-8)?,/i.test(source)) return null
  const separator = source.indexOf(",")
  if (separator < 0) return null
  try {
    return new TextEncoder().encode(
      decodeURIComponent(source.slice(separator + 1))
    )
  } catch {
    return null
  }
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

const expectedReferenceKey = (nodeId: string, paintId?: string) =>
  `${nodeId}\u0000${paintId ?? ""}`

const expectedNodeImageReference = (
  node: SceneNode,
  paintId: string | undefined
) =>
  sceneNodeImageReferences(node).find((reference) =>
    paintId === undefined
      ? reference.location === "node"
      : reference.location === "fill" && reference.paintId === paintId
  )

/**
 * Proves that every managed-resource expectation belongs to one exact image
 * layer or image fill and to the exact inline bytes passed to the private renderer. Natural
 * dimensions are intentionally verified after browser decode; metadata alone
 * is not accepted as proof that the renderer decoded the same geometry.
 */
export async function assertRenderImageResourceAdmission(
  document: Document,
  expectations: readonly RenderImageResourceExpectation[]
): Promise<void> {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const seenReferences = new Set<string>()

  for (const node of document.nodes) {
    for (const reference of sceneNodeImageReferences(node)) {
      try {
        inspectInlineRasterSource(reference.src)
      } catch (error) {
        if (error instanceof RasterInspectionError) {
          throw new RenderImageResourceAdmissionError(
            error.code === "raster_dimensions_exceeded"
              ? "image_resource_inline_dimensions_exceeded"
              : "image_resource_inline_invalid",
            node.id,
            reference.assetId
          )
        }
        throw error
      }
    }
  }

  for (const expectation of expectations) {
    const referenceKey = expectedReferenceKey(
      expectation.nodeId,
      expectation.paintId
    )
    if (seenReferences.has(referenceKey)) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_duplicate",
        expectation.nodeId,
        expectation.assetId
      )
    }
    seenReferences.add(referenceKey)

    const node = nodeById.get(expectation.nodeId)
    if (!node) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_node_missing",
        expectation.nodeId,
        expectation.assetId
      )
    }
    const reference = expectedNodeImageReference(node, expectation.paintId)
    if (!reference) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_type_mismatch",
        expectation.nodeId,
        expectation.assetId
      )
    }
    if (reference.assetId !== expectation.assetId) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_identity_mismatch",
        expectation.nodeId,
        expectation.assetId
      )
    }

    const bytes = decodeInlineImage(reference.src)
    if (!bytes || (await sha256Hex(bytes)) !== expectation.contentHash) {
      throw new RenderImageResourceAdmissionError(
        "image_resource_source_mismatch",
        expectation.nodeId,
        expectation.assetId
      )
    }
  }
}
