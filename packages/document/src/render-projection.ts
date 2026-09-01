import type {
  BlendMode,
  ImageFrameMask,
  ImagePlacement,
  Page,
  SceneNode,
} from "./schema"
import { projectTextLayout, type TextLayoutProjection } from "./text-layout"

export type RenderFrameProjection = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipX: boolean
  flipY: boolean
  opacity: number
  blendMode: BlendMode
  visible: boolean
  locked: boolean
}

type ProjectedNode<Type extends SceneNode["type"], Content> = {
  type: Type
  frame: RenderFrameProjection
  content: Content
}

export type RenderNodeProjection =
  | ProjectedNode<
      "text",
      {
        text: string
        displayText: string
        color: string
        fontFamily: string
        fontSize: number
        fontWeight: number
        lineHeight: number
        letterSpacing: number
        align: "left" | "center" | "right"
        whiteSpace: "pre"
        overflowWrap: "normal"
        sizingMode: Extract<SceneNode, { type: "text" }>["sizingMode"]
        layout: TextLayoutProjection
      }
    >
  | ProjectedNode<
      "rect",
      {
        fill: string
        radius: number
        stroke?: string
        strokeWidth: number
      }
    >
  | ProjectedNode<
      "frame",
      {
        fill: string
        radius: number
        stroke?: string
        strokeWidth: number
        clipsContent: boolean
      }
    >
  | ProjectedNode<
      "ellipse",
      { fill: string; stroke?: string; strokeWidth: number }
    >
  | ProjectedNode<"line", { stroke: string; strokeWidth: number }>
  | ProjectedNode<
      "icon",
      {
        path: string
        viewBox: string
        fill: string
        stroke?: string
        strokeWidth: number
      }
    >
  | ProjectedNode<
      "image",
      {
        assetId: string
        src: string
        placement: ImagePlacement
        frameMask: ImageFrameMask
        alt: string
        decorative: boolean
      }
    >

export type RenderPageProjection = {
  id: string
  outputId: string
  name: string
  width: number
  height: number
  background: string
  nodeIds: string[]
}

const projectFrame = (node: SceneNode): RenderFrameProjection => ({
  id: node.id,
  name: node.name,
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
  rotation: node.rotation,
  flipX: node.flipX ?? false,
  flipY: node.flipY ?? false,
  opacity: node.opacity,
  blendMode: node.blendMode ?? "normal",
  visible: node.visible,
  locked: node.locked,
})

export function projectNodeForRender(node: SceneNode): RenderNodeProjection {
  const frame = projectFrame(node)
  switch (node.type) {
    case "text":
      const layout = projectTextLayout(node)
      return {
        type: node.type,
        frame,
        content: {
          text: node.text,
          displayText: layout.displayText,
          color: node.color,
          fontFamily: node.fontFamily,
          fontSize: node.fontSize,
          fontWeight: node.fontWeight,
          lineHeight: node.lineHeight,
          letterSpacing: node.letterSpacing,
          align: node.align,
          whiteSpace: "pre",
          overflowWrap: "normal",
          sizingMode: node.sizingMode,
          layout,
        },
      }
    case "rect":
      return {
        type: node.type,
        frame,
        content: {
          fill: node.fill,
          radius: node.radius,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
        },
      }
    case "frame":
      return {
        type: node.type,
        frame,
        content: {
          fill: node.fill,
          radius: node.radius,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          clipsContent: node.clipsContent,
        },
      }
    case "ellipse":
      return {
        type: node.type,
        frame,
        content: {
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
        },
      }
    case "line":
      return {
        type: node.type,
        frame,
        content: { stroke: node.stroke, strokeWidth: node.strokeWidth },
      }
    case "icon":
      return {
        type: node.type,
        frame,
        content: {
          path: node.path,
          viewBox: node.viewBox,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
        },
      }
    case "image":
      return {
        type: node.type,
        frame,
        content: {
          assetId: node.assetId,
          src: node.src,
          placement: node.placement,
          frameMask: node.frameMask,
          alt: node.alt,
          decorative: node.decorative,
        },
      }
  }
}

export const projectPageForRender = (page: Page): RenderPageProjection => ({
  id: page.id,
  outputId: page.outputId,
  name: page.name,
  width: page.width,
  height: page.height,
  background: page.background,
  nodeIds: [...page.nodeIds],
})

export type SvgViewBox = {
  minX: number
  minY: number
  width: number
  height: number
}

export function parseSvgViewBox(value: string): SvgViewBox {
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const [minX, minY, width, height] = parts
  if (
    parts.length !== 4 ||
    minX === undefined ||
    minY === undefined ||
    width === undefined ||
    height === undefined ||
    ![minX, minY, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid SVG viewBox: ${value}`)
  }
  return { minX, minY, width, height }
}

export function projectSvgViewport(
  viewport: { width: number; height: number },
  viewBoxValue: string
) {
  const viewBox = parseSvgViewBox(viewBoxValue)
  const scale = Math.min(
    viewport.width / viewBox.width,
    viewport.height / viewBox.height
  )
  return {
    viewBox,
    scale,
    offsetX: (viewport.width - viewBox.width * scale) / 2,
    offsetY: (viewport.height - viewBox.height * scale) / 2,
  }
}

export type RenderImageLayout = {
  source: { x: number; y: number; width: number; height: number }
  destination: { x: number; y: number; width: number; height: number }
  scale: number
}

export type LegacyImageLayoutInput = {
  width: number
  height: number
  fit: "cover" | "contain"
  cropX: number
  cropY: number
}

export function projectImageLayout(
  node: LegacyImageLayoutInput,
  naturalSize: { width: number; height: number }
): RenderImageLayout {
  const naturalWidth = Math.max(1, naturalSize.width)
  const naturalHeight = Math.max(1, naturalSize.height)
  const focusX = Math.min(1, Math.max(0, node.cropX))
  const focusY = Math.min(1, Math.max(0, node.cropY))

  if (node.fit === "cover") {
    const scale = Math.max(
      node.width / naturalWidth,
      node.height / naturalHeight
    )
    const sourceWidth = node.width / scale
    const sourceHeight = node.height / scale
    return {
      source: {
        x: (naturalWidth - sourceWidth) * focusX,
        y: (naturalHeight - sourceHeight) * focusY,
        width: sourceWidth,
        height: sourceHeight,
      },
      destination: { x: 0, y: 0, width: node.width, height: node.height },
      scale,
    }
  }

  const scale = Math.min(node.width / naturalWidth, node.height / naturalHeight)
  const renderedWidth = naturalWidth * scale
  const renderedHeight = naturalHeight * scale
  return {
    source: { x: 0, y: 0, width: naturalWidth, height: naturalHeight },
    destination: {
      x: (node.width - renderedWidth) * focusX,
      y: (node.height - renderedHeight) * focusY,
      width: renderedWidth,
      height: renderedHeight,
    },
    scale,
  }
}

export const IMAGE_PLACEMENT_MAX_ZOOM = 64

/** Maps natural source pixels into frame-local pixels. */
export type RenderImageAffine = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export type RenderImageClip =
  | {
      shape: "rectangle"
      x: 0
      y: 0
      width: number
      height: number
    }
  | {
      shape: "rounded_rectangle"
      x: 0
      y: 0
      width: number
      height: number
      radius: number
    }
  | {
      shape: "ellipse"
      centerX: number
      centerY: number
      radiusX: number
      radiusY: number
    }

export type RenderImagePaintProjection = {
  sourceToFrame: RenderImageAffine
  clip: RenderImageClip
  scale: number
  normalizedPlacement: ImagePlacement
}

export type ImagePaintProjectionInput = {
  frame: { width: number; height: number }
  naturalSize: { width: number; height: number }
  placement: ImagePlacement
  frameMask: ImageFrameMask
}

function finitePositive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`)
  }
  return value
}

function finite(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`)
  }
  return value
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeDegrees(value: number) {
  const wrapped = (((value + 180) % 360) + 360) % 360
  return wrapped - 180
}

function projectImageClip(
  frame: ImagePaintProjectionInput["frame"],
  mask: ImageFrameMask
): RenderImageClip {
  if (mask.shape === "ellipse") {
    return {
      shape: mask.shape,
      centerX: frame.width / 2,
      centerY: frame.height / 2,
      radiusX: frame.width / 2,
      radiusY: frame.height / 2,
    }
  }

  if (mask.shape === "rounded_rectangle") {
    const normalizedRadius = clamp(
      finite(mask.radius ?? 0, "Image frame mask radius"),
      0,
      0.5
    )
    return {
      shape: mask.shape,
      x: 0,
      y: 0,
      width: frame.width,
      height: frame.height,
      radius: normalizedRadius * Math.min(frame.width, frame.height),
    }
  }

  return {
    shape: "rectangle",
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
  }
}

/**
 * Derives the complete image paint transform from the ergonomic document
 * fields. Fill and manual use a rotation-aware cover scale as their zoom base.
 * Fit uses the largest scale that keeps the oriented source bounds inside the
 * frame. Manual zoom below 1 may expose the frame so a Fit-to-Manual
 * conversion can preserve the visible pixels.
 */
export function projectImagePaint({
  frame: frameInput,
  naturalSize: naturalSizeInput,
  placement: placementInput,
  frameMask,
}: ImagePaintProjectionInput): RenderImagePaintProjection {
  const frame = {
    width: finitePositive(frameInput.width, "Image frame width"),
    height: finitePositive(frameInput.height, "Image frame height"),
  }
  const naturalSize = {
    width: finitePositive(naturalSizeInput.width, "Image natural width"),
    height: finitePositive(naturalSizeInput.height, "Image natural height"),
  }
  const placement: ImagePlacement = {
    ...placementInput,
    focalX: clamp(finite(placementInput.focalX, "Image focalX"), 0, 1),
    focalY: clamp(finite(placementInput.focalY, "Image focalY"), 0, 1),
    zoom: Math.min(
      finitePositive(placementInput.zoom, "Image zoom"),
      IMAGE_PLACEMENT_MAX_ZOOM
    ),
    rotation: normalizeDegrees(
      finite(placementInput.rotation, "Image rotation")
    ),
  }

  const radians = (placement.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const absoluteCosine = Math.abs(cosine)
  const absoluteSine = Math.abs(sine)

  const orientedWidth =
    absoluteCosine * naturalSize.width + absoluteSine * naturalSize.height
  const orientedHeight =
    absoluteSine * naturalSize.width + absoluteCosine * naturalSize.height

  let scale: number
  let centerX: number
  let centerY: number

  const fitBaseScale = Math.min(
    frame.width / orientedWidth,
    frame.height / orientedHeight
  )
  const requiredSourceWidth =
    absoluteCosine * frame.width + absoluteSine * frame.height
  const requiredSourceHeight =
    absoluteSine * frame.width + absoluteCosine * frame.height
  const coverBaseScale = Math.max(
    requiredSourceWidth / naturalSize.width,
    requiredSourceHeight / naturalSize.height
  )

  if (placement.mode === "fit") {
    scale = fitBaseScale * placement.zoom
    const renderedWidth = orientedWidth * scale
    const renderedHeight = orientedHeight * scale
    centerX =
      renderedWidth / 2 + (frame.width - renderedWidth) * placement.focalX
    centerY =
      renderedHeight / 2 + (frame.height - renderedHeight) * placement.focalY
  } else {
    scale = coverBaseScale * placement.zoom
    if (scale < coverBaseScale) {
      const renderedWidth = orientedWidth * scale
      const renderedHeight = orientedHeight * scale
      centerX =
        renderedWidth / 2 + (frame.width - renderedWidth) * placement.focalX
      centerY =
        renderedHeight / 2 + (frame.height - renderedHeight) * placement.focalY
    } else {
      // These are the half-extents of the frame after inverse rotation into
      // the source's local axes. Travel inside the remaining source area keeps
      // all four frame corners covered, including at non-right angles where a
      // bounding-box cover would leave gaps.
      const localFrameExtentX = requiredSourceWidth / 2
      const localFrameExtentY = requiredSourceHeight / 2
      const localTravelX = Math.max(
        0,
        (naturalSize.width * scale) / 2 - localFrameExtentX
      )
      const localTravelY = Math.max(
        0,
        (naturalSize.height * scale) / 2 - localFrameExtentY
      )
      const frameCenterInSourceX = localTravelX * (placement.focalX * 2 - 1)
      const frameCenterInSourceY = localTravelY * (placement.focalY * 2 - 1)

      centerX =
        frame.width / 2 -
        (cosine * frameCenterInSourceX - sine * frameCenterInSourceY)
      centerY =
        frame.height / 2 -
        (sine * frameCenterInSourceX + cosine * frameCenterInSourceY)
    }
  }

  const flipX = placement.flipX ? -1 : 1
  const flipY = placement.flipY ? -1 : 1
  const a = scale * cosine * flipX
  const b = scale * sine * flipX
  const c = -scale * sine * flipY
  const d = scale * cosine * flipY

  return {
    sourceToFrame: {
      a,
      b,
      c,
      d,
      e: centerX - a * (naturalSize.width / 2) - c * (naturalSize.height / 2),
      f: centerY - b * (naturalSize.width / 2) - d * (naturalSize.height / 2),
    },
    clip: projectImageClip(frame, frameMask),
    scale,
    normalizedPlacement: placement,
  }
}

/**
 * Returns a self-contained browser expression for the canonical image paint
 * projector. Export HTML uses this after an image decodes because natural
 * dimensions are unavailable while the Worker builds the document markup.
 */
export function serializeImagePaintProjector(): string {
  const declarations = [
    `const IMAGE_PLACEMENT_MAX_ZOOM=${IMAGE_PLACEMENT_MAX_ZOOM}`,
    finitePositive.toString(),
    finite.toString(),
    clamp.toString(),
    normalizeDegrees.toString(),
    projectImageClip.toString(),
    projectImagePaint.toString(),
  ].join(";")
  return `(()=>{${declarations};return ${projectImagePaint.name}})()`
}
