import {
  imagePlacementSchema,
  projectImagePaint,
  type ImageFrameMask,
  type ImagePlacement,
  type RenderImageAffine,
} from "@webmcp/document"
import type { ImageCropFrame } from "./image-crop-session"

export type ImageCropFrameHandle =
  "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

export type ImageCropFrameResizeInput = Readonly<{
  handle: ImageCropFrameHandle
  frame: ImageCropFrame
  naturalSize: Readonly<{ width: number; height: number }>
  placement: Readonly<ImagePlacement>
  frameMask: Readonly<ImageFrameMask>
  screenDelta: Readonly<{ x: number; y: number }>
  cameraZoom: number
  preserveAspectRatio?: boolean
  symmetric?: boolean
  minimumFrameSize?: number
}>

export type ImageCropFrameResizeProjection = Readonly<{
  frame: ImageCropFrame
  placement: Readonly<ImagePlacement>
  frameMask: Readonly<ImageFrameMask>
}>

export type ImageCropFrameLocalBounds = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const EPSILON = 1e-9

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const finitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`)
  }
  return value
}

const movedFromWest = (handle: ImageCropFrameHandle) => handle.includes("w")
const movedFromEast = (handle: ImageCropFrameHandle) => handle.includes("e")
const movedFromNorth = (handle: ImageCropFrameHandle) => handle.includes("n")
const movedFromSouth = (handle: ImageCropFrameHandle) => handle.includes("s")

function clampLocalSize(
  rect: ImageCropFrameLocalBounds,
  frame: ImageCropFrame,
  handle: ImageCropFrameHandle,
  symmetric: boolean,
  minimum: number
): ImageCropFrameLocalBounds {
  let { left, top, right, bottom } = rect
  if (right - left < minimum) {
    if (symmetric) {
      const center = frame.width / 2
      left = center - minimum / 2
      right = center + minimum / 2
    } else if (movedFromWest(handle)) {
      left = right - minimum
    } else {
      right = left + minimum
    }
  }
  if (bottom - top < minimum) {
    if (symmetric) {
      const center = frame.height / 2
      top = center - minimum / 2
      bottom = center + minimum / 2
    } else if (movedFromNorth(handle)) {
      top = bottom - minimum
    } else {
      bottom = top + minimum
    }
  }
  return { left, top, right, bottom }
}

function aspectConstrainedRect(
  rect: ImageCropFrameLocalBounds,
  frame: ImageCropFrame,
  handle: ImageCropFrameHandle,
  symmetric: boolean,
  minimum: number
): ImageCropFrameLocalBounds {
  const horizontal = movedFromWest(handle) || movedFromEast(handle)
  const vertical = movedFromNorth(handle) || movedFromSouth(handle)
  const rawWidth = rect.right - rect.left
  const rawHeight = rect.bottom - rect.top
  const widthScale = rawWidth / frame.width
  const heightScale = rawHeight / frame.height
  const requestedScale =
    horizontal && vertical
      ? Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale
      : horizontal
        ? widthScale
        : heightScale
  const minimumScale = Math.max(minimum / frame.width, minimum / frame.height)
  const scale = Math.max(minimumScale, requestedScale)
  const width = frame.width * scale
  const height = frame.height * scale

  let left: number
  let right: number
  if (symmetric || !horizontal) {
    left = (frame.width - width) / 2
    right = left + width
  } else if (movedFromWest(handle)) {
    right = frame.width
    left = right - width
  } else {
    left = 0
    right = width
  }

  let top: number
  let bottom: number
  if (symmetric || !vertical) {
    top = (frame.height - height) / 2
    bottom = top + height
  } else if (movedFromNorth(handle)) {
    bottom = frame.height
    top = bottom - height
  } else {
    top = 0
    bottom = height
  }
  return { left, top, right, bottom }
}

export function projectImageCropLocalResizeRect(
  frame: ImageCropFrame,
  handle: ImageCropFrameHandle,
  localDelta: Readonly<{ x: number; y: number }>,
  options: Readonly<{
    preserveAspectRatio?: boolean
    symmetric?: boolean
    minimumFrameSize?: number
  }> = {}
): ImageCropFrameLocalBounds {
  const minimum = finitePositive(
    options.minimumFrameSize ?? 1,
    "Minimum frame size"
  )
  const symmetric = options.symmetric ?? false
  let left = 0
  let top = 0
  let right = frame.width
  let bottom = frame.height

  if (movedFromWest(handle)) {
    left = localDelta.x
    if (symmetric) right -= localDelta.x
  }
  if (movedFromEast(handle)) {
    right += localDelta.x
    if (symmetric) left -= localDelta.x
  }
  if (movedFromNorth(handle)) {
    top = localDelta.y
    if (symmetric) bottom -= localDelta.y
  }
  if (movedFromSouth(handle)) {
    bottom += localDelta.y
    if (symmetric) top -= localDelta.y
  }

  const raw = { left, top, right, bottom }
  return options.preserveAspectRatio
    ? aspectConstrainedRect(raw, frame, handle, symmetric, minimum)
    : clampLocalSize(raw, frame, handle, symmetric, minimum)
}

function solveFocalPoint(
  frame: Readonly<{ width: number; height: number }>,
  naturalSize: Readonly<{ width: number; height: number }>,
  placement: ImagePlacement,
  frameMask: ImageFrameMask,
  target: Readonly<{ e: number; f: number }>
) {
  const projectAt = (focalX: number, focalY: number) =>
    projectImagePaint({
      frame,
      naturalSize,
      frameMask,
      placement: { ...placement, focalX, focalY },
    }).sourceToFrame
  const origin = projectAt(0, 0)
  const xBasis = projectAt(1, 0)
  const yBasis = projectAt(0, 1)
  const x = { e: xBasis.e - origin.e, f: xBasis.f - origin.f }
  const y = { e: yBasis.e - origin.e, f: yBasis.f - origin.f }
  const delta = { e: target.e - origin.e, f: target.f - origin.f }
  const determinant = x.e * y.f - x.f * y.e

  if (Math.abs(determinant) > EPSILON) {
    return {
      focalX: clamp((delta.e * y.f - delta.f * y.e) / determinant, 0, 1),
      focalY: clamp((x.e * delta.f - x.f * delta.e) / determinant, 0, 1),
    }
  }

  const xLengthSquared = x.e * x.e + x.f * x.f
  const yLengthSquared = y.e * y.e + y.f * y.f
  return {
    focalX:
      xLengthSquared > EPSILON
        ? clamp((delta.e * x.e + delta.f * x.f) / xLengthSquared, 0, 1)
        : placement.focalX,
    focalY:
      yLengthSquared > EPSILON
        ? clamp((delta.e * y.e + delta.f * y.f) / yLengthSquared, 0, 1)
        : placement.focalY,
  }
}

function sameAffine(left: RenderImageAffine, right: RenderImageAffine) {
  return (Object.keys(left) as Array<keyof RenderImageAffine>).every(
    (key) => Math.abs(left[key] - right[key]) <= 1e-6
  )
}

export function projectImageCropFrameResize({
  handle,
  frame,
  naturalSize,
  placement,
  frameMask,
  screenDelta,
  cameraZoom,
  preserveAspectRatio = false,
  symmetric = false,
  minimumFrameSize = 1,
}: ImageCropFrameResizeInput): ImageCropFrameResizeProjection {
  finitePositive(cameraZoom, "Image crop camera zoom")
  finitePositive(naturalSize.width, "Image natural width")
  finitePositive(naturalSize.height, "Image natural height")
  if (!Number.isFinite(screenDelta.x) || !Number.isFinite(screenDelta.y)) {
    throw new RangeError("Image crop frame resize delta must be finite.")
  }

  const radians = (frame.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const pageDelta = {
    x: screenDelta.x / cameraZoom,
    y: screenDelta.y / cameraZoom,
  }
  const localDelta = {
    x: cosine * pageDelta.x + sine * pageDelta.y,
    y: -sine * pageDelta.x + cosine * pageDelta.y,
  }
  const localRect = projectImageCropLocalResizeRect(frame, handle, localDelta, {
    preserveAspectRatio,
    symmetric,
    minimumFrameSize,
  })
  return projectImageCropFrameToLocalBounds({
    frame,
    naturalSize,
    placement,
    frameMask,
    localBounds: localRect,
  })
}

export function projectImageCropFrameToLocalBounds({
  frame,
  naturalSize,
  placement,
  frameMask,
  localBounds,
}: Readonly<{
  frame: ImageCropFrame
  naturalSize: Readonly<{ width: number; height: number }>
  placement: Readonly<ImagePlacement>
  frameMask: Readonly<ImageFrameMask>
  localBounds: ImageCropFrameLocalBounds
}>): ImageCropFrameResizeProjection {
  finitePositive(naturalSize.width, "Image natural width")
  finitePositive(naturalSize.height, "Image natural height")
  if (
    !Number.isFinite(localBounds.left) ||
    !Number.isFinite(localBounds.top) ||
    !Number.isFinite(localBounds.right) ||
    !Number.isFinite(localBounds.bottom) ||
    localBounds.right - localBounds.left <= 0 ||
    localBounds.bottom - localBounds.top <= 0
  ) {
    throw new RangeError("Image crop frame bounds must be finite and positive.")
  }

  const radians = (frame.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const nextFrame = Object.freeze({
    x: frame.x + cosine * localBounds.left - sine * localBounds.top,
    y: frame.y + sine * localBounds.left + cosine * localBounds.top,
    width: localBounds.right - localBounds.left,
    height: localBounds.bottom - localBounds.top,
    rotation: frame.rotation,
  })

  if (
    Math.abs(localBounds.left) <= EPSILON &&
    Math.abs(localBounds.top) <= EPSILON &&
    Math.abs(localBounds.right - frame.width) <= EPSILON &&
    Math.abs(localBounds.bottom - frame.height) <= EPSILON
  ) {
    return Object.freeze({
      frame: Object.freeze({ ...frame }),
      placement: Object.freeze({ ...placement }),
      frameMask: Object.freeze({ ...frameMask }),
    })
  }

  const previousPaint = projectImagePaint({
    frame,
    naturalSize,
    placement,
    frameMask,
  })
  const targetAffine = {
    ...previousPaint.sourceToFrame,
    e: previousPaint.sourceToFrame.e - localBounds.left,
    f: previousPaint.sourceToFrame.f - localBounds.top,
  }
  const unitManual = projectImagePaint({
    frame: nextFrame,
    naturalSize,
    placement: { ...placement, mode: "manual", zoom: 1 },
    frameMask,
  })
  const zoom = previousPaint.scale / unitManual.scale
  if (zoom > 64 + EPSILON) {
    throw new RangeError(
      "Image crop frame is too small to preserve its content."
    )
  }
  const manual = imagePlacementSchema.parse({
    ...placement,
    mode: "manual",
    zoom: Math.min(64, zoom),
  })
  const focal = solveFocalPoint(
    nextFrame,
    naturalSize,
    manual,
    frameMask,
    targetAffine
  )
  const nextPlacement = Object.freeze(
    imagePlacementSchema.parse({ ...manual, ...focal })
  )
  const nextPaint = projectImagePaint({
    frame: nextFrame,
    naturalSize,
    placement: nextPlacement,
    frameMask,
  })
  if (!sameAffine(nextPaint.sourceToFrame, targetAffine)) {
    throw new RangeError(
      "Image crop frame resize cannot preserve the current visible content."
    )
  }

  return Object.freeze({
    frame: nextFrame,
    placement: nextPlacement,
    frameMask: Object.freeze({ ...frameMask }),
  })
}

/**
 * Matches the outer frame to the complete transformed source bounds while
 * preserving the source-to-page affine. The source scale and filtering stay
 * unchanged; only frame geometry and equivalent placement fields change.
 */
export function projectResizeImageFrameToImage(
  input: Readonly<{
    frame: ImageCropFrame
    naturalSize: Readonly<{ width: number; height: number }>
    placement: Readonly<ImagePlacement>
    frameMask: Readonly<ImageFrameMask>
  }>
): ImageCropFrameResizeProjection {
  const paint = projectImagePaint(input)
  const { width, height } = input.naturalSize
  const { a, b, c, d, e, f } = paint.sourceToFrame
  const corners = [
    { x: e, y: f },
    { x: a * width + e, y: b * width + f },
    { x: c * height + e, y: d * height + f },
    { x: a * width + c * height + e, y: b * width + d * height + f },
  ]
  const xValues = corners.map((corner) => corner.x)
  const yValues = corners.map((corner) => corner.y)
  return projectImageCropFrameToLocalBounds({
    ...input,
    localBounds: {
      left: Math.min(...xValues),
      top: Math.min(...yValues),
      right: Math.max(...xValues),
      bottom: Math.max(...yValues),
    },
  })
}
