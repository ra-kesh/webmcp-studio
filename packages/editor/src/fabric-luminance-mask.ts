import { FabricImage, type FabricObject, getEnv } from "fabric"
import type { PagePaintBounds } from "@webmcp/document/internal/page-paint-plan"
import {
  assertCompositeAdmission,
  supportedMaskPaintPixelRatio,
} from "@webmcp/document/internal/page-paint-plan"
import { convertSrgbPixelsToLuminanceMask } from "./luminance-mask"

export type FabricLuminanceSource = readonly [
  nodeId: string,
  object: FabricObject,
]

export type FabricLuminanceMaskUnion = Readonly<{
  maskObject: FabricImage
  sourceObjects: ReadonlyMap<string, FabricObject>
}>

const canvas2d = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d", {
    colorSpace: "srgb",
    willReadFrequently: true,
  })
  if (!context) throw new Error("Fabric luminance mask canvas is unavailable")
  return context
}

/**
 * Renders each prepared Fabric source independently, converts its ordinary
 * sRGB pixels to Y times A, and unions those converted masks in canonical
 * source order. Only the final bounded union canvas remains attached to the
 * returned Fabric image; each source readback canvas is released after use.
 */
export const createFabricLuminanceMaskUnion = (
  groupId: string,
  sources: readonly FabricLuminanceSource[],
  bounds: PagePaintBounds,
  requestedPixelRatio: number
): FabricLuminanceMaskUnion => {
  if (sources.length === 0) {
    throw new Error("Fabric luminance masks require a visible source")
  }
  const pixelRatio = supportedMaskPaintPixelRatio(requestedPixelRatio)
  assertCompositeAdmission(groupId, bounds, pixelRatio)

  const environment = getEnv()
  const unionCanvas = environment.document.createElement(
    "canvas"
  ) as HTMLCanvasElement
  unionCanvas.width = Math.max(1, Math.ceil(bounds.width * pixelRatio))
  unionCanvas.height = Math.max(1, Math.ceil(bounds.height * pixelRatio))
  const unionContext = canvas2d(unionCanvas)
  unionContext.globalCompositeOperation = "source-over"

  try {
    for (const [nodeId, sourceObject] of sources) {
      const sourceBounds = sourceObject.getBoundingRect()
      let sourceCanvas: HTMLCanvasElement | undefined
      try {
        sourceCanvas = sourceObject.toCanvasElement({
          multiplier: pixelRatio,
          enableRetinaScaling: false,
        })
        const sourceContext = canvas2d(sourceCanvas)
        const sourcePixels = sourceContext.getImageData(
          0,
          0,
          sourceCanvas.width,
          sourceCanvas.height,
          { colorSpace: "srgb" }
        )
        convertSrgbPixelsToLuminanceMask(sourcePixels.data)
        sourceContext.putImageData(sourcePixels, 0, 0)
        unionContext.drawImage(
          sourceCanvas,
          Math.round((sourceBounds.left - bounds.x) * pixelRatio),
          Math.round((sourceBounds.top - bounds.y) * pixelRatio)
        )
      } catch (error) {
        throw new Error(
          `Fabric luminance mask source ${nodeId} conversion failed`,
          { cause: error }
        )
      } finally {
        if (sourceCanvas) environment.dispose(sourceCanvas)
      }
    }

    const maskObject = new FabricImage(unionCanvas, {
      left: bounds.x,
      top: bounds.y,
      originX: "left",
      originY: "top",
      scaleX: bounds.width / unionCanvas.width,
      scaleY: bounds.height / unionCanvas.height,
      opacity: 1,
      globalCompositeOperation: "destination-in",
      objectCaching: true,
      selectable: false,
      evented: false,
    })
    maskObject.setCoords()
    return {
      maskObject,
      sourceObjects: new Map(sources),
    }
  } catch (error) {
    environment.dispose(unionCanvas)
    throw error
  }
}
