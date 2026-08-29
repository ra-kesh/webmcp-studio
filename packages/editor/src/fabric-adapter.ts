import {
  ActiveSelection,
  Canvas,
  controlsUtils,
  Ellipse,
  FabricImage,
  FabricObject,
  FixedLayout,
  Group,
  LayoutManager,
  Line,
  Path,
  Point,
  Rect,
  Textbox,
  type TextboxProps,
  type ModifiedEvent,
  type TPointerEvent,
  type TPointerEventInfo,
  type Transform,
  type TOptions,
} from "fabric"
import {
  IMAGE_PLACEMENT_MAX_ZOOM,
  projectImagePaint,
  projectNodeForRender,
  projectSvgViewport,
  type Document,
  type ImagePlacement,
  type RenderImageAffine,
  type RenderImageClip,
  type SceneNode,
} from "@webmcp/document"
import type {
  CanvasAdapter,
  CanvasAdapterEvents,
  CanvasImageCropDraft,
  CanvasImageCropMode,
  CanvasNodeChange,
  Selection,
} from "./index"
import {
  calculateSnap,
  type AlignmentSnapTarget,
  type MoveSnapLatch,
  type SnapGuide,
} from "./snapping"
import { resolvePlainTextListKey, type PlainTextListEdit } from "./text-lists"
import {
  applyResizeConstraint,
  normalizeRotation,
  snapRotation,
  type ResizeHandle,
  type ResizeSnapLatch,
  type RotationSnapLatch,
  type TransformRect,
} from "./transform-constraints"
import {
  CanvasTransformSessionController,
  canvasTransformGeometryChanged,
  type CanvasTransformKind,
  type CanvasTransformSession,
} from "./transform-session"

// Figma-style blue stays legible on both paper and dark cinematic templates.
const SELECTION_COLOR = "#0d99ff"
const GUIDE_COLOR = "#2563eb"
// Fabric multiplies every unstyled glyph box by 1.13 before applying its
// lineHeight value. CSS line-height multiplies fontSize directly.
const FABRIC_TEXT_LINE_HEIGHT_MULTIPLIER = 1.13
// Geist's Canvas baseline lands one device pixel below the shared CSS frame at
// DSF 1. Keep the adjustment explicit and covered by the conformance fixture.
const FABRIC_TEXT_BASELINE_ADJUSTMENT = 1

const TEXT_CONTROL_KEYS = [
  "tl",
  "tr",
  "bl",
  "br",
  "ml",
  "mr",
  "mt",
  "mb",
  "mtr",
] as const

const ACTIVE_SELECTION_SIDE_CONTROLS = ["ml", "mr", "mt", "mb"] as const
const ACTIVE_SELECTION_CORNER_CONTROLS = ["tl", "tr", "bl", "br"] as const

type TextSizingMode = Extract<SceneNode, { type: "text" }>["sizingMode"]

/**
 * Idle rendering consumes the canonical projector's explicit visual lines,
 * so Fabric must not wrap them a second time. Editing and live width resize
 * switch fixed/auto-height text back to raw content and normal Textbox reflow;
 * auto-width preserves only explicit source newlines in every state. Keep one
 * subtype so these mode changes preserve object and editing identity.
 */
class StudioTextbox<
  Props extends TOptions<TextboxProps> = Partial<TextboxProps>,
> extends Textbox<Props> {
  studioSizingMode: TextSizingMode | undefined
  studioTopOffset = 0
  studioUsesCanonicalLines = true

  override initDimensions() {
    const fixedHeight =
      this.studioSizingMode === "fixed" ? this.height : undefined
    super.initDimensions()
    if (fixedHeight !== undefined && Number.isFinite(fixedHeight)) {
      this.height = fixedHeight
    }
  }

  setStudioTextLayout(mode: TextSizingMode, topOffset: number) {
    if (this.studioSizingMode === mode && this.studioTopOffset === topOffset) {
      return
    }
    this.studioSizingMode = mode
    this.studioTopOffset = topOffset
    this.initDimensions()
    this.dirty = true
  }

  setStudioUsesCanonicalLines(value: boolean) {
    if (this.studioUsesCanonicalLines === value) return
    this.studioUsesCanonicalLines = value
    this.initDimensions()
    this.dirty = true
  }

  override _wrapText(lines: string[], desiredWidth: number): string[][] {
    if (
      this.studioUsesCanonicalLines !== false ||
      this.studioSizingMode === "auto_width"
    ) {
      return lines.map((line) => this.graphemeSplit(line))
    }
    return super._wrapText(lines, desiredWidth)
  }

  override _getTopOffset(): number {
    return super._getTopOffset() + (this.studioTopOffset ?? 0)
  }

  override _renderChars(
    method: "fillText" | "strokeText",
    context: CanvasRenderingContext2D,
    line: string[],
    left: number,
    top: number,
    lineIndex: number
  ) {
    const canRenderCanonicalLine =
      this.studioUsesCanonicalLines &&
      !this.isEditing &&
      !this.path &&
      this.direction === "ltr" &&
      !this.textAlign.includes("justify") &&
      this.isEmptyStyles(lineIndex) &&
      "letterSpacing" in context
    if (!canRenderCanonicalLine) {
      super._renderChars(method, context, line, left, top, lineIndex)
      return
    }

    const value = line.join("")
    context.save()
    this._setTextStyles(context)
    context.letterSpacing = `${this._getWidthOfCharSpacing()}px`
    context.fontKerning = "normal"
    context.textRendering = "geometricPrecision"
    const nativeWidth = context.measureText(value).width
    const measuredWidth = this.getLineWidth(lineIndex)
    if (this.textAlign === "center") {
      left += (measuredWidth - nativeWidth) / 2
    } else if (this.textAlign === "right") {
      left += measuredWidth - nativeWidth
    }
    top -=
      (this.getHeightOfLine(lineIndex) / this.lineHeight) *
      this._fontSizeFraction
    this._renderChar(method, context, lineIndex, 0, value, left, top)
    context.restore()
  }
}

function setFabricTextboxContent(
  object: Textbox,
  text: string,
  content: "canonical" | "editing"
) {
  if (object instanceof StudioTextbox) {
    object.setStudioUsesCanonicalLines(content === "canonical")
  }
  object.set({ text })
}

/**
 * Fabric's default Shift behavior is the inverse of the editor convention:
 * corners scale proportionally until Shift is held. Keep the policy explicit
 * so every canvas mount uses Figma/Canva-style modifier semantics instead.
 */
export const FABRIC_TRANSFORM_MODIFIER_POLICY = Object.freeze({
  uniformScaling: false,
  uniScaleKey: "shiftKey" as const,
  centeredScaling: false,
  centeredKey: "altKey" as const,
  // The canonical document has no skew. Fabric otherwise assigns Shift to
  // side-handle skew and changes the action underneath an active resize.
  altActionKey: null,
})

const round = (value: number) => Math.round(value * 10) / 10
const normalizeDegrees = (value: number) =>
  ((((value + 180) % 360) + 360) % 360) - 180

export function equivalentImageSources(
  renderedSource: string,
  documentSource: string,
  baseUrl = typeof document === "undefined" ? undefined : document.baseURI
) {
  if (renderedSource === documentSource) return true
  if (!baseUrl) return false
  try {
    return (
      new URL(renderedSource, baseUrl).href ===
      new URL(documentSource, baseUrl).href
    )
  } catch {
    return false
  }
}

export function fabricResizeHandle(corner: string): ResizeHandle | null {
  return corner === "nw" ||
    corner === "n" ||
    corner === "ne" ||
    corner === "e" ||
    corner === "se" ||
    corner === "s" ||
    corner === "sw" ||
    corner === "w"
    ? corner
    : corner === "tl"
      ? "nw"
      : corner === "mt"
        ? "n"
        : corner === "tr"
          ? "ne"
          : corner === "mr"
            ? "e"
            : corner === "br"
              ? "se"
              : corner === "mb"
                ? "s"
                : corner === "bl"
                  ? "sw"
                  : corner === "ml"
                    ? "w"
                    : null
}

function snapBoundsForObject(object: FabricObject) {
  if (
    !(object instanceof ActiveSelection) &&
    Math.abs(object.angle % 360) < 0.01
  ) {
    return {
      left: object.left ?? 0,
      top: object.top ?? 0,
      width: (object.width || 1) * Math.abs(object.scaleX),
      height: (object.height || 1) * Math.abs(object.scaleY),
    }
  }
  return object.getBoundingRect()
}

function applyFabricRectPreview(
  object: FabricObject,
  current: TransformRect,
  constrained: TransformRect,
  action: string | undefined,
  textSizingMode?: Extract<SceneNode, { type: "text" }>["sizingMode"],
  anchor?: Pick<Transform, "originX" | "originY"> & { point?: Point }
) {
  const widthRatio = constrained.width / current.width
  const heightRatio = constrained.height / current.height
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio))
    return false
  const position = {
    left: (object.left ?? 0) + constrained.x - current.x,
    top: (object.top ?? 0) + constrained.y - current.y,
  }
  const anchorPoint = anchor
    ? (anchor.point ?? object.getPointByOrigin(anchor.originX, anchor.originY))
    : null
  if (object instanceof Textbox && action === "resizing") {
    const width = object.width * widthRatio
    const height =
      textSizingMode === "fixed" ? object.height * heightRatio : object.height
    object.set({ ...position, width, height })
    if (textSizingMode === "fixed" && object.clipPath instanceof Rect) {
      object.clipPath.set({ width, height })
    }
  } else {
    object.set({
      ...position,
      scaleX: object.scaleX * widthRatio,
      scaleY: object.scaleY * heightRatio,
    })
  }
  if (anchorPoint && anchor) {
    if (object instanceof Textbox && textSizingMode === "fixed") {
      const horizontalRatio =
        anchor.originX === "right" || anchor.originX === 1
          ? 1
          : anchor.originX === "center" || anchor.originX === 0.5
            ? 0.5
            : 0
      const verticalRatio =
        anchor.originY === "bottom" || anchor.originY === 1
          ? 1
          : anchor.originY === "center" || anchor.originY === 0.5
            ? 0.5
            : 0
      const radians = (object.getTotalAngle() * Math.PI) / 180
      const localCenterX = constrained.width * (0.5 - horizontalRatio)
      const localCenterY = constrained.height * (0.5 - verticalRatio)
      object.setPositionByOrigin(
        new Point(
          anchorPoint.x +
            Math.cos(radians) * localCenterX -
            Math.sin(radians) * localCenterY,
          anchorPoint.y +
            Math.sin(radians) * localCenterX +
            Math.cos(radians) * localCenterY
        ),
        "center",
        "center"
      )
    } else {
      object.setPositionByOrigin(anchorPoint, anchor.originX, anchor.originY)
    }
  }
  object.setCoords()
  return true
}

function localResizeProposal(
  baseline: TransformRect,
  current: TransformRect,
  handle: ResizeHandle,
  centered: boolean
): TransformRect {
  const movesWest = handle.includes("w")
  const movesEast = handle.includes("e")
  const movesNorth = handle.includes("n")
  const movesSouth = handle.includes("s")
  const changesWidth = movesWest || movesEast
  const changesHeight = movesNorth || movesSouth
  const width = changesWidth ? current.width : baseline.width
  const height = changesHeight ? current.height : baseline.height
  return {
    x: centered
      ? baseline.x + (baseline.width - width) / 2
      : movesWest
        ? baseline.x + baseline.width - width
        : baseline.x,
    y: centered
      ? baseline.y + (baseline.height - height) / 2
      : movesNorth
        ? baseline.y + baseline.height - height
        : baseline.y,
    width,
    height,
  }
}

function resizeAnchor(
  handle: ResizeHandle,
  centered: boolean,
  keepCanonicalTop: boolean
): Pick<Transform, "originX" | "originY"> {
  if (centered) {
    return {
      originX: "center",
      // Intrinsic Textbox width changes reflow the layout-owned height. Keep
      // the canonical top fixed while only the horizontal axis grows centered.
      originY: keepCanonicalTop ? "top" : "center",
    }
  }
  return {
    originX: handle.includes("w")
      ? "right"
      : handle.includes("e")
        ? "left"
        : "center",
    originY: keepCanonicalTop
      ? "top"
      : handle.includes("n")
        ? "bottom"
        : handle.includes("s")
          ? "top"
          : "center",
  }
}

function textResizeBaselineAnchor(
  baseline: TransformRect & Readonly<{ rotation: number }>,
  originX: Transform["originX"],
  originY: Transform["originY"]
) {
  const horizontalRatio =
    originX === "right" || originX === 1
      ? 1
      : originX === "center" || originX === 0.5
        ? 0.5
        : 0
  const verticalRatio =
    originY === "bottom" || originY === 1
      ? 1
      : originY === "center" || originY === 0.5
        ? 0.5
        : 0
  const radians = (baseline.rotation * Math.PI) / 180
  const localX = baseline.width * horizontalRatio
  const localY = baseline.height * verticalRatio
  return new Point(
    baseline.x + Math.cos(radians) * localX - Math.sin(radians) * localY,
    baseline.y + Math.sin(radians) * localX + Math.cos(radians) * localY
  )
}

export function fabricObjectToNodePatch(
  object: FabricObject
): Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation"> {
  const objectPosition = object.group
    ? object.getXY()
    : { x: object.left ?? 0, y: object.top ?? 0 }
  const borderedShape = object instanceof Rect || object instanceof Ellipse
  const worldScale = object.getObjectScaling()
  const worldScaleX = Math.abs(worldScale.x)
  const worldScaleY = Math.abs(worldScale.y)
  const ownScaleX = Math.abs(object.scaleX) || 1
  const ownScaleY = Math.abs(object.scaleY) || 1
  const fixedTextFrame =
    object instanceof Textbox && object.clipPath instanceof Rect
      ? object.clipPath
      : null
  const fixedTextInset = fixedTextFrame
    ? {
        x: ((object.width - fixedTextFrame.width) * worldScaleX) / 2,
        y: ((object.height - fixedTextFrame.height) * worldScaleY) / 2,
      }
    : null
  const radians = (object.getTotalAngle() * Math.PI) / 180
  const lineInset =
    object instanceof Line
      ? {
          x:
            Math.cos(radians) * (object.strokeWidth / 2) * worldScaleX -
            Math.sin(radians) * (object.strokeWidth / 2) * worldScaleY,
          y:
            Math.sin(radians) * (object.strokeWidth / 2) * worldScaleX +
            Math.cos(radians) * (object.strokeWidth / 2) * worldScaleY,
        }
      : null
  const position = fixedTextInset
    ? {
        // Fabric centers a fixed Textbox clip inside its intrinsic layout box.
        // Canonical x/y belong to the visible clip frame, not that often-taller
        // internal line-layout box.
        x:
          objectPosition.x +
          Math.cos(radians) * fixedTextInset.x -
          Math.sin(radians) * fixedTextInset.y,
        y:
          objectPosition.y +
          Math.sin(radians) * fixedTextInset.x +
          Math.cos(radians) * fixedTextInset.y,
      }
    : lineInset
      ? {
          x: objectPosition.x + lineInset.x,
          y: objectPosition.y + lineInset.y,
        }
      : objectPosition
  return {
    x: round(position.x),
    y: round(position.y),
    width: Math.max(
      1,
      round(
        borderedShape
          ? (object.getScaledWidth() / ownScaleX) * worldScaleX
          : (fixedTextFrame?.width || object.width || 1) * worldScaleX
      )
    ),
    height: Math.max(
      1,
      round(
        borderedShape
          ? (object.getScaledHeight() / ownScaleY) * worldScaleY
          : (fixedTextFrame?.height || object.height || 1) * worldScaleY
      )
    ),
    rotation: round(normalizeDegrees(object.getTotalAngle())),
  }
}

export function fabricComparableNodeGeometry(
  geometry: Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation">
) {
  return {
    x: round(geometry.x),
    y: round(geometry.y),
    width: Math.max(1, round(geometry.width)),
    height: Math.max(1, round(geometry.height)),
    rotation: round(normalizeDegrees(geometry.rotation)),
  }
}

function scaleActiveSelectionUniformly(
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number
) {
  const canvas = transform.target.canvas
  if (!canvas) {
    return controlsUtils.scalingEqually(eventData, transform, x, y)
  }
  // Fabric normally lets Shift invert `uniformScaling`. A nonuniform scale of
  // a group containing rotated children introduces skew, which our canonical
  // document deliberately cannot represent. Disable the toggle only while a
  // multi-selection corner handler runs.
  const uniformScaleKey = canvas.uniScaleKey
  canvas.uniScaleKey = null
  try {
    return controlsUtils.scalingEqually(eventData, transform, x, y)
  } finally {
    canvas.uniScaleKey = uniformScaleKey
  }
}

function isRepresentableActiveSelectionTransform(
  target: FabricObject,
  session: CanvasTransformSession | null
) {
  if (!(target instanceof ActiveSelection) || session?.kind !== "resize") {
    return true
  }
  return (
    target.scaleX > 0 &&
    target.scaleY > 0 &&
    Math.abs(target.scaleX - target.scaleY) < 0.000001
  )
}

export function fabricTransformKind(
  action: string | undefined
): CanvasTransformKind | null {
  if (action === "drag") return "move"
  if (action === "rotate") return "rotate"
  if (
    action === "scale" ||
    action === "scaleX" ||
    action === "scaleY" ||
    action === "resizing"
  ) {
    return "resize"
  }
  return null
}

function sharedOptions(node: SceneNode) {
  const { frame } = projectNodeForRender(node)
  return {
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    angle: frame.rotation,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false,
    opacity: frame.opacity,
    visible: frame.visible,
    originX: "left" as const,
    originY: "top" as const,
    selectable: true,
    evented: true,
    hasControls: !node.locked,
    lockMovementX: node.locked,
    lockMovementY: node.locked,
    lockScalingX: node.locked,
    lockScalingY: node.locked,
    lockScalingFlip: true,
    lockRotation: node.locked,
    borderColor: SELECTION_COLOR,
    borderScaleFactor: 2,
    cornerColor: "#ffffff",
    cornerStrokeColor: SELECTION_COLOR,
    cornerStyle: "circle" as const,
    cornerSize: 22,
    transparentCorners: false,
    padding: 5,
    objectCaching: true,
  }
}

function borderedShapeDimensions(
  node: Extract<SceneNode, { type: "rect" | "ellipse" }>
) {
  const strokeWidth = node.stroke ? node.strokeWidth : 0
  return {
    width: Math.max(1, node.width - strokeWidth),
    height: Math.max(1, node.height - strokeWidth),
    strokeWidth,
  }
}

function positionFabricLineFrame(
  object: Line,
  node: Extract<SceneNode, { type: "line" }>
) {
  const inset = object.strokeWidth / 2
  const radians = (node.rotation * Math.PI) / 180
  object.set({
    left: node.x - Math.cos(radians) * inset + Math.sin(radians) * inset,
    top: node.y - Math.sin(radians) * inset - Math.cos(radians) * inset,
  })
}

function fixedTextClip(node: Extract<SceneNode, { type: "text" }>) {
  return node.sizingMode === "fixed"
    ? new Rect({
        width: node.width,
        height: node.height,
        originX: "center",
        originY: "center",
        fill: "#000000",
        strokeWidth: 0,
        selectable: false,
        evented: false,
      })
    : undefined
}

function positionFixedTextboxFrame(
  object: Textbox,
  node: Extract<SceneNode, { type: "text" }>
) {
  if (node.sizingMode !== "fixed") return
  const radians = (node.rotation * Math.PI) / 180
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  object.setPositionByOrigin(
    new Point(
      node.x + Math.cos(radians) * halfWidth - Math.sin(radians) * halfHeight,
      node.y + Math.sin(radians) * halfWidth + Math.cos(radians) * halfHeight
    ),
    "center",
    "center"
  )
}

export function projectFabricTextState(
  node: Extract<SceneNode, { type: "text" }>
) {
  const projection = projectNodeForRender(node)
  if (projection.type !== "text") throw new Error("Expected text projection")
  return {
    text: projection.content.text,
    displayText: projection.content.displayText,
    width: projection.frame.width,
    height: projection.frame.height,
    fill: projection.content.color,
    fontFamily: projection.content.fontFamily,
    fontSize: projection.content.fontSize,
    fontWeight: projection.content.fontWeight,
    textAlign: projection.content.align,
    lineHeight:
      projection.content.lineHeight / FABRIC_TEXT_LINE_HEIGHT_MULTIPLIER,
    topOffset:
      ((projection.content.lineHeight - 1) * projection.content.fontSize) / 2 -
      FABRIC_TEXT_BASELINE_ADJUSTMENT,
    charSpacing:
      (projection.content.letterSpacing / projection.content.fontSize) * 1000,
    sizingMode: projection.content.sizingMode,
    overflow: projection.content.layout.overflow,
    clipOverflow: projection.content.sizingMode === "fixed",
  }
}

export function fabricTextControlVisibility(
  mode: Extract<SceneNode, { type: "text" }>["sizingMode"]
): Record<(typeof TEXT_CONTROL_KEYS)[number], boolean> {
  const scalable =
    mode === "fixed"
      ? new Set(TEXT_CONTROL_KEYS)
      : mode === "auto_height"
        ? new Set(["ml", "mr", "mtr"] as const)
        : new Set(["mtr"] as const)
  return Object.fromEntries(
    TEXT_CONTROL_KEYS.map((key) => [key, scalable.has(key)])
  ) as Record<(typeof TEXT_CONTROL_KEYS)[number], boolean>
}

function applyFabricTextControlPolicy(
  object: Textbox,
  node: Extract<SceneNode, { type: "text" }>
) {
  object.setControlsVisibility(fabricTextControlVisibility(node.sizingMode))
  object.set({
    hasControls: !node.locked,
    lockScalingX: node.locked || node.sizingMode === "auto_width",
    lockScalingY: node.locked || node.sizingMode !== "fixed",
  })
}

export function createFabricSyncObject(
  node: Exclude<SceneNode, { type: "image" }>
) {
  if (node.type === "rect") {
    const dimensions = borderedShapeDimensions(node)
    return new Rect({
      ...sharedOptions(node),
      width: dimensions.width,
      height: dimensions.height,
      fill: node.fill,
      rx: Math.max(0, node.radius - dimensions.strokeWidth / 2),
      ry: Math.max(0, node.radius - dimensions.strokeWidth / 2),
      stroke: node.stroke,
      strokeWidth: dimensions.strokeWidth,
    })
  }

  if (node.type === "ellipse") {
    const dimensions = borderedShapeDimensions(node)
    return new Ellipse({
      ...sharedOptions(node),
      width: dimensions.width,
      height: dimensions.height,
      fill: node.fill,
      rx: dimensions.width / 2,
      ry: dimensions.height / 2,
      stroke: node.stroke,
      strokeWidth: dimensions.strokeWidth,
    })
  }

  if (node.type === "line") {
    const line = new Line([0, 0, node.width, node.height], {
      ...sharedOptions(node),
      fill: undefined,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
    positionFabricLineFrame(line, node)
    return line
  }

  if (node.type === "icon") {
    const { width: _width, height: _height, ...options } = sharedOptions(node)
    const path = new Path(node.path, {
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      selectable: false,
      evented: false,
    })
    layoutIcon(path, node)
    return new Group([vectorFrame(node), path], {
      ...options,
      scaleX: 1,
      scaleY: 1,
      subTargetCheck: false,
    })
  }

  const projection = projectFabricTextState(node)
  const text = new StudioTextbox(projection.displayText, {
    ...sharedOptions(node),
    fill: projection.fill,
    fontFamily: projection.fontFamily,
    fontSize: projection.fontSize,
    fontWeight: projection.fontWeight,
    textAlign: projection.textAlign,
    lineHeight: projection.lineHeight,
    charSpacing: projection.charSpacing,
    splitByGrapheme: false,
    editable: !node.locked,
    strokeWidth: 0,
    clipPath: fixedTextClip(node),
  })
  text.set({ width: node.width, height: node.height })
  text.setStudioTextLayout(node.sizingMode, projection.topOffset)
  text.set({ height: node.height })
  positionFixedTextboxFrame(text, node)
  applyFabricTextControlPolicy(text, node)
  return text
}

async function createImageObject(
  node: Extract<SceneNode, { type: "image" }>,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const image = await FabricImage.fromURL(node.src, {
    crossOrigin: "anonymous",
    signal,
  })
  signal?.throwIfAborted()
  return createFabricImageGroup(node, image)
}

const missingImagePlaceholders = new WeakSet<FabricObject>()

class MissingImageLabel extends FabricObject {
  readonly text = "Image unavailable"

  constructor(width: number, height: number) {
    super({
      width,
      height,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
      strokeWidth: 0,
    })
  }

  override _render(context: CanvasRenderingContext2D) {
    const width = this.width
    const height = this.height
    const fontSize = Math.max(10, Math.min(18, height * 0.72))
    context.save()
    context.fillStyle = "#f4f4f5"
    context.fillRect(-width / 2, -height / 2, width, height)
    context.fillStyle = "#52525b"
    context.font = `500 ${fontSize}px Arial, sans-serif`
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(this.text, 0, 0, width)
    context.restore()
  }

  override toObject(propertiesToInclude: string[] = []) {
    return {
      ...super.toObject(propertiesToInclude),
      text: this.text,
    }
  }
}

function createMissingImagePlaceholder(
  node: Extract<SceneNode, { type: "image" }>
) {
  const minimumDimension = Math.min(node.width, node.height)
  const borderWidth = minimumDimension >= 2 ? 1 : 0
  const frame = new Rect({
    left: borderWidth / 2,
    top: borderWidth / 2,
    width: node.width - borderWidth,
    height: node.height - borderWidth,
    originX: "left",
    originY: "top",
    fill: "#f4f4f5",
    stroke: "#a1a1aa",
    strokeWidth: borderWidth,
    selectable: false,
    evented: false,
  })
  const crossStrokeWidth = Math.max(2, minimumDimension * 0.025)
  const inset = Math.max(8, minimumDimension * 0.12, crossStrokeWidth)
  const cross =
    minimumDimension >= 20
      ? [
          new Line([inset, inset, node.width - inset, node.height - inset], {
            stroke: "#71717a",
            strokeWidth: crossStrokeWidth,
            strokeLineCap: "round" as const,
            selectable: false,
            evented: false,
          }),
          new Line([node.width - inset, inset, inset, node.height - inset], {
            stroke: "#71717a",
            strokeWidth: crossStrokeWidth,
            strokeLineCap: "round" as const,
            selectable: false,
            evented: false,
          }),
        ]
      : []
  const labelWidth = node.width - inset * 2
  const labelHeight = Math.min(25, node.height * 0.16)
  const message =
    labelWidth >= 96 && labelHeight >= 14
      ? new MissingImageLabel(labelWidth, labelHeight).set({
          left: node.width / 2,
          top: node.height / 2,
        })
      : null
  const group = new Group(
    [frame, ...cross, ...(message ? [message] : [])],
    imageGroupOptions(node)
  )
  missingImagePlaceholders.add(group)
  return group
}

export const isMissingImagePlaceholder = (object: FabricObject) =>
  missingImagePlaceholders.has(object)

export async function createFabricObjectForSync(
  node: SceneNode,
  loadImage: (
    imageNode: Extract<SceneNode, { type: "image" }>,
    signal?: AbortSignal
  ) => Promise<FabricObject> = createImageObject,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  if (node.type !== "image") return createFabricSyncObject(node)
  try {
    const image = await loadImage(node, signal)
    signal?.throwIfAborted()
    return image
  } catch {
    signal?.throwIfAborted()
    return createMissingImagePlaceholder(node)
  }
}

const FABRIC_IMAGE_DECODE_CONCURRENCY = 6
const FABRIC_IMAGE_DECODE_TIMEOUT_MS = 8_000

async function createImageObjectWithinDeadline(
  node: Extract<SceneNode, { type: "image" }>,
  parentSignal?: AbortSignal
) {
  parentSignal?.throwIfAborted()
  const controller = new AbortController()
  const forwardParentAbort = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener("abort", forwardParentAbort, { once: true })
  const timeout = globalThis.setTimeout(
    () =>
      controller.abort(
        new DOMException("Canvas image decode timed out", "TimeoutError")
      ),
    FABRIC_IMAGE_DECODE_TIMEOUT_MS
  )
  try {
    return await createImageObject(node, controller.signal)
  } finally {
    globalThis.clearTimeout(timeout)
    parentSignal?.removeEventListener("abort", forwardParentAbort)
  }
}

function prepareFabricImageObjects(
  nodes: readonly Extract<SceneNode, { type: "image" }>[],
  signal?: AbortSignal
) {
  const workerTails = Array.from(
    { length: Math.min(FABRIC_IMAGE_DECODE_CONCURRENCY, nodes.length) },
    () => Promise.resolve()
  )
  const prepared = new Map<string, Promise<FabricObject>>()
  for (const [index, node] of nodes.entries()) {
    const workerIndex = index % workerTails.length
    const task = workerTails[workerIndex]!.then(() =>
      createImageObjectWithinDeadline(node, signal)
    )
    workerTails[workerIndex] = task.then(
      () => undefined,
      () => undefined
    )
    prepared.set(node.id, task)
  }
  return prepared
}

function imageFrame(node: Extract<SceneNode, { type: "image" }>) {
  return new Rect({
    left: 0,
    top: 0,
    width: node.width,
    height: node.height,
    originX: "left",
    originY: "top",
    fill: "rgba(0,0,0,0)",
    strokeWidth: 0,
    selectable: false,
    evented: false,
  })
}

function vectorFrame(node: Extract<SceneNode, { type: "icon" }>) {
  return new Rect({
    left: 0,
    top: 0,
    width: node.width,
    height: node.height,
    originX: "left",
    originY: "top",
    fill: "rgba(0,0,0,0)",
    strokeWidth: 0,
    selectable: false,
    evented: false,
  })
}

function layoutIcon(
  path: Path,
  node: Extract<SceneNode, { type: "icon" }>,
  relativeToGroup = false
) {
  const viewport = projectSvgViewport(node, node.viewBox)
  const sourceMinX = path.pathOffset.x - path.width / 2
  const sourceMinY = path.pathOffset.y - path.height / 2
  const strokeInset = node.stroke ? (node.strokeWidth * viewport.scale) / 2 : 0
  const groupOffsetX = relativeToGroup ? node.width / 2 : 0
  const groupOffsetY = relativeToGroup ? node.height / 2 : 0
  path.set({
    left:
      viewport.offsetX +
      (sourceMinX - viewport.viewBox.minX) * viewport.scale -
      groupOffsetX -
      strokeInset,
    top:
      viewport.offsetY +
      (sourceMinY - viewport.viewBox.minY) * viewport.scale -
      groupOffsetY -
      strokeInset,
    scaleX: viewport.scale,
    scaleY: viewport.scale,
    fill: node.fill,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    originX: "left",
    originY: "top",
    selectable: false,
    evented: false,
  })
  path.setCoords()
}

type ImageNaturalSize = { width: number; height: number }

export type FabricImagePaintState = {
  sourceToFrame: RenderImageAffine
  clip: RenderImageClip
  left: number
  top: number
  width: number
  height: number
  scaleX: number
  scaleY: number
  angle: number
  flipX: boolean
  flipY: boolean
}

function verifiedImageNaturalSize(image: FabricImage): ImageNaturalSize {
  const { width, height } = image.getOriginalSize()
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw new Error(
      "Decoded image must have finite positive natural dimensions"
    )
  }
  return { width, height }
}

/**
 * Converts the canonical source-pixel-to-frame affine into Fabric's
 * center-origin object properties. The optional group-local projection moves
 * the frame's top-left origin to the fixed image group's center.
 */
export function projectFabricImagePaint(
  node: Extract<SceneNode, { type: "image" }>,
  naturalSize: ImageNaturalSize,
  relativeToGroup = true
): FabricImagePaintState {
  const projection = projectImagePaint({
    frame: { width: node.width, height: node.height },
    naturalSize,
    placement: node.placement,
    frameMask: node.frameMask,
  })
  const { sourceToFrame, normalizedPlacement } = projection
  const sourceCenterX = naturalSize.width / 2
  const sourceCenterY = naturalSize.height / 2
  const groupOffsetX = relativeToGroup ? node.width / 2 : 0
  const groupOffsetY = relativeToGroup ? node.height / 2 : 0

  return {
    sourceToFrame,
    clip: projection.clip,
    left:
      sourceToFrame.a * sourceCenterX +
      sourceToFrame.c * sourceCenterY +
      sourceToFrame.e -
      groupOffsetX,
    top:
      sourceToFrame.b * sourceCenterX +
      sourceToFrame.d * sourceCenterY +
      sourceToFrame.f -
      groupOffsetY,
    width: naturalSize.width,
    height: naturalSize.height,
    scaleX: projection.scale,
    scaleY: projection.scale,
    angle: normalizedPlacement.rotation,
    flipX: normalizedPlacement.flipX,
    flipY: normalizedPlacement.flipY,
  }
}

function projectedImageCenter(
  node: Extract<SceneNode, { type: "image" }>,
  naturalSize: ImageNaturalSize,
  placement: ImagePlacement
) {
  const { sourceToFrame } = projectImagePaint({
    frame: { width: node.width, height: node.height },
    naturalSize,
    placement,
    frameMask: node.frameMask,
  })
  return {
    x:
      sourceToFrame.a * (naturalSize.width / 2) +
      sourceToFrame.c * (naturalSize.height / 2) +
      sourceToFrame.e,
    y:
      sourceToFrame.b * (naturalSize.width / 2) +
      sourceToFrame.d * (naturalSize.height / 2) +
      sourceToFrame.f,
  }
}

function manualCropPlacement(
  node: Extract<SceneNode, { type: "image" }>,
  naturalSize: ImageNaturalSize,
  placement: ImagePlacement
): ImagePlacement {
  if (placement.mode !== "fit") return { ...placement, mode: "manual" }
  const fit = projectImagePaint({
    frame: { width: node.width, height: node.height },
    naturalSize,
    placement,
    frameMask: node.frameMask,
  })
  const manualBase = projectImagePaint({
    frame: { width: node.width, height: node.height },
    naturalSize,
    placement: { ...placement, mode: "manual", zoom: 1 },
    frameMask: node.frameMask,
  })
  return {
    ...placement,
    mode: "manual",
    zoom: fit.scale / manualBase.scale,
  }
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Converts a page-coordinate pointer drag into canonical image placement. The
 * outer node rotation is removed before solving focal travel through the same
 * projector used for rendering.
 */
export function projectFabricImageCropDrag(
  node: Extract<SceneNode, { type: "image" }>,
  naturalSize: ImageNaturalSize,
  placement: ImagePlacement,
  pageDelta: { x: number; y: number }
): ImagePlacement {
  const manual = manualCropPlacement(node, naturalSize, placement)
  const outerRadians = (node.rotation * Math.PI) / 180
  const cosine = Math.cos(outerRadians)
  const sine = Math.sin(outerRadians)
  const frameDelta = {
    x: cosine * pageDelta.x + sine * pageDelta.y,
    y: -sine * pageDelta.x + cosine * pageDelta.y,
  }
  const focalOrigin = projectedImageCenter(node, naturalSize, {
    ...manual,
    focalX: 0,
    focalY: 0,
  })
  const focalXEnd = projectedImageCenter(node, naturalSize, {
    ...manual,
    focalX: 1,
    focalY: 0,
  })
  const focalYEnd = projectedImageCenter(node, naturalSize, {
    ...manual,
    focalX: 0,
    focalY: 1,
  })
  const focalXVector = {
    x: focalXEnd.x - focalOrigin.x,
    y: focalXEnd.y - focalOrigin.y,
  }
  const focalYVector = {
    x: focalYEnd.x - focalOrigin.x,
    y: focalYEnd.y - focalOrigin.y,
  }
  const focalXLengthSquared =
    focalXVector.x * focalXVector.x + focalXVector.y * focalXVector.y
  const focalYLengthSquared =
    focalYVector.x * focalYVector.x + focalYVector.y * focalYVector.y
  const focalXDelta = focalXLengthSquared
    ? (frameDelta.x * focalXVector.x + frameDelta.y * focalXVector.y) /
      focalXLengthSquared
    : 0
  const focalYDelta = focalYLengthSquared
    ? (frameDelta.x * focalYVector.x + frameDelta.y * focalYVector.y) /
      focalYLengthSquared
    : 0

  return projectImagePaint({
    frame: { width: node.width, height: node.height },
    naturalSize,
    placement: {
      ...manual,
      focalX: clampUnit(manual.focalX + focalXDelta),
      focalY: clampUnit(manual.focalY + focalYDelta),
    },
    frameMask: node.frameMask,
  }).normalizedPlacement
}

/**
 * Projects a keyboard nudge expressed in screen pixels through the active
 * camera zoom. Keeping this conversion beside the pointer projector ensures
 * Arrow and Shift+Arrow move the visible image by an exact, zoom-independent
 * distance even when the frame or image is rotated/flipped.
 */
export function projectFabricImageCropScreenNudge(
  node: Extract<SceneNode, { type: "image" }>,
  naturalSize: ImageNaturalSize,
  placement: ImagePlacement,
  screenDelta: { x: number; y: number },
  cameraZoom: number
): ImagePlacement {
  if (!Number.isFinite(cameraZoom) || cameraZoom <= 0) {
    throw new RangeError("Image crop camera zoom must be a positive number.")
  }
  return projectFabricImageCropDrag(node, naturalSize, placement, {
    x: screenDelta.x / cameraZoom,
    y: screenDelta.y / cameraZoom,
  })
}

export type FabricImageCropPinchGesture = Readonly<{
  scale: number
  anchorPage: Readonly<{ x: number; y: number }>
  screenTranslation: Readonly<{ x: number; y: number }>
  cameraZoom: number
}>

/**
 * Projects a two-touch gesture while keeping the source point under the
 * initial midpoint anchored. Midpoint movement translates the content, and
 * distance movement scales it. All screen-space input is converted through
 * camera zoom before the canonical placement is solved.
 */
export function projectFabricImageCropPinch(
  node: Extract<SceneNode, { type: "image" }>,
  naturalSize: ImageNaturalSize,
  placement: ImagePlacement,
  gesture: FabricImageCropPinchGesture
): ImagePlacement {
  if (!Number.isFinite(gesture.cameraZoom) || gesture.cameraZoom <= 0) {
    throw new RangeError("Image crop camera zoom must be a positive number.")
  }
  if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) {
    throw new RangeError("Image crop pinch scale must be a positive number.")
  }

  const manual = manualCropPlacement(node, naturalSize, placement)
  const nextZoom = Math.min(
    IMAGE_PLACEMENT_MAX_ZOOM,
    Math.max(0.01, manual.zoom * gesture.scale)
  )
  const scaled = { ...manual, zoom: nextZoom }
  const beforePaint = projectImagePaint({
    frame: { width: node.width, height: node.height },
    naturalSize,
    placement: manual,
    frameMask: node.frameMask,
  })
  const afterPaint = projectImagePaint({
    frame: { width: node.width, height: node.height },
    naturalSize,
    placement: scaled,
    frameMask: node.frameMask,
  })
  const visualScale = afterPaint.scale / beforePaint.scale
  const beforeCenter = projectedImageCenter(node, naturalSize, manual)
  const afterCenter = projectedImageCenter(node, naturalSize, scaled)
  const outerRadians = (node.rotation * Math.PI) / 180
  const cosine = Math.cos(outerRadians)
  const sine = Math.sin(outerRadians)
  const pageToFrame = (point: Readonly<{ x: number; y: number }>) => ({
    x: cosine * point.x + sine * point.y,
    y: -sine * point.x + cosine * point.y,
  })
  const frameToPage = (point: Readonly<{ x: number; y: number }>) => ({
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  })
  const anchorFrame = pageToFrame({
    x: gesture.anchorPage.x - node.x,
    y: gesture.anchorPage.y - node.y,
  })
  const translationFrame = pageToFrame({
    x: gesture.screenTranslation.x / gesture.cameraZoom,
    y: gesture.screenTranslation.y / gesture.cameraZoom,
  })
  const desiredCenter = {
    x:
      anchorFrame.x +
      (beforeCenter.x - anchorFrame.x) * visualScale +
      translationFrame.x,
    y:
      anchorFrame.y +
      (beforeCenter.y - anchorFrame.y) * visualScale +
      translationFrame.y,
  }
  return projectFabricImageCropDrag(
    node,
    naturalSize,
    scaled,
    frameToPage({
      x: desiredCenter.x - afterCenter.x,
      y: desiredCenter.y - afterCenter.y,
    })
  )
}

export function isPagePointInsideImageFrame(
  node: Extract<SceneNode, { type: "image" }>,
  pagePoint: Readonly<{ x: number; y: number }>
) {
  const radians = (node.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const offsetX = pagePoint.x - node.x
  const offsetY = pagePoint.y - node.y
  const x = cosine * offsetX + sine * offsetY
  const y = -sine * offsetX + cosine * offsetY
  if (x < 0 || y < 0 || x > node.width || y > node.height) return false
  if (node.frameMask.shape === "rectangle") return true
  if (node.frameMask.shape === "ellipse") {
    const normalizedX = (x - node.width / 2) / (node.width / 2)
    const normalizedY = (y - node.height / 2) / (node.height / 2)
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1
  }
  const radius = Math.min(node.width, node.height) * node.frameMask.radius
  if (
    (x >= radius && x <= node.width - radius) ||
    (y >= radius && y <= node.height - radius)
  ) {
    return true
  }
  const cornerX = x < radius ? radius : node.width - radius
  const cornerY = y < radius ? radius : node.height - radius
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2
}

export function twoTouchGestureMetrics(
  touches: ArrayLike<Pick<Touch, "clientX" | "clientY">>
) {
  if (touches.length < 2) return null
  const first = touches[0]
  const second = touches[1]
  return {
    distance: Math.hypot(
      second.clientX - first.clientX,
      second.clientY - first.clientY
    ),
    midpoint: {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    },
  }
}

function createImageFrameClip(clip: RenderImageClip) {
  const shared = {
    left: 0,
    top: 0,
    originX: "center" as const,
    originY: "center" as const,
    fill: "#000000",
    strokeWidth: 0,
    selectable: false,
    evented: false,
  }
  if (clip.shape === "ellipse") {
    return new Ellipse({
      ...shared,
      rx: clip.radiusX,
      ry: clip.radiusY,
    })
  }
  return new Rect({
    ...shared,
    width: clip.width,
    height: clip.height,
    rx: clip.shape === "rounded_rectangle" ? clip.radius : 0,
    ry: clip.shape === "rounded_rectangle" ? clip.radius : 0,
  })
}

function layoutImage(
  image: FabricImage,
  node: Extract<SceneNode, { type: "image" }>,
  relativeToGroup = false
) {
  const state = projectFabricImagePaint(
    node,
    verifiedImageNaturalSize(image),
    relativeToGroup
  )
  image.set({
    left: state.left,
    top: state.top,
    width: state.width,
    height: state.height,
    cropX: 0,
    cropY: 0,
    scaleX: state.scaleX,
    scaleY: state.scaleY,
    angle: state.angle,
    flipX: state.flipX,
    flipY: state.flipY,
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
  })
  image.setCoords()
  return state
}

function imageGroupOptions(node: Extract<SceneNode, { type: "image" }>) {
  const { width: _width, height: _height, ...options } = sharedOptions(node)
  return {
    ...options,
    scaleX: 1,
    scaleY: 1,
    subTargetCheck: false,
  }
}

export function createFabricImageGroup(
  node: Extract<SceneNode, { type: "image" }>,
  image: FabricImage
) {
  const group = new Group([imageFrame(node), image], {
    ...imageGroupOptions(node),
    width: node.width,
    height: node.height,
    layoutManager: new LayoutManager(new FixedLayout()),
  })
  syncImageGroup(group, node)
  return group
}

function syncImageGroup(
  group: Group,
  node: Extract<SceneNode, { type: "image" }>,
  { clipToFrame = true }: { clipToFrame?: boolean } = {}
) {
  const frame = group
    .getObjects()
    .find((object): object is Rect => object instanceof Rect)
  const image = group
    .getObjects()
    .find((object): object is FabricImage => object instanceof FabricImage)
  if (!frame || !image) return
  frame.set({
    left: -node.width / 2,
    top: -node.height / 2,
    width: node.width,
    height: node.height,
  })
  const imageState = layoutImage(image, node, true)
  group.set({
    ...imageGroupOptions(node),
    width: node.width,
    height: node.height,
    clipPath: clipToFrame ? createImageFrameClip(imageState.clip) : undefined,
    objectCaching: clipToFrame,
    dirty: true,
  })
  group.setCoords()
}

export function syncFabricObjectFromNode(
  object: FabricObject,
  node: SceneNode
) {
  const options: Record<string, unknown> = {
    ...sharedOptions(node),
    scaleX: 1,
    scaleY: 1,
  }

  if (node.type === "rect" && object instanceof Rect) {
    const dimensions = borderedShapeDimensions(node)
    Object.assign(options, {
      width: dimensions.width,
      height: dimensions.height,
      fill: node.fill,
      rx: Math.max(0, node.radius - dimensions.strokeWidth / 2),
      ry: Math.max(0, node.radius - dimensions.strokeWidth / 2),
      stroke: node.stroke,
      strokeWidth: dimensions.strokeWidth,
    })
  } else if (node.type === "ellipse" && object instanceof Ellipse) {
    const dimensions = borderedShapeDimensions(node)
    Object.assign(options, {
      width: dimensions.width,
      height: dimensions.height,
      fill: node.fill,
      rx: dimensions.width / 2,
      ry: dimensions.height / 2,
      stroke: node.stroke,
      strokeWidth: dimensions.strokeWidth,
    })
  } else if (node.type === "line" && object instanceof Line) {
    Object.assign(options, {
      x1: 0,
      y1: 0,
      x2: node.width,
      y2: node.height,
      fill: undefined,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
  } else if (node.type === "icon" && object instanceof Group) {
    const frame = object
      .getObjects()
      .find((child): child is Rect => child instanceof Rect)
    const path = object
      .getObjects()
      .find((child): child is Path => child instanceof Path)
    if (!frame || !path) return
    frame.set({
      left: -node.width / 2,
      top: -node.height / 2,
      width: node.width,
      height: node.height,
    })
    layoutIcon(path, node, true)
    const {
      width: _width,
      height: _height,
      ...groupOptions
    } = sharedOptions(node)
    object.set({
      ...groupOptions,
      width: node.width,
      height: node.height,
      scaleX: 1,
      scaleY: 1,
      subTargetCheck: false,
    })
    object.setCoords()
    return
  } else if (node.type === "text" && object instanceof Textbox) {
    const text = projectFabricTextState(node)
    if (!object.isEditing) {
      if (object instanceof StudioTextbox) {
        object.setStudioUsesCanonicalLines(true)
      }
      options.text = text.displayText
    }
    Object.assign(options, {
      fill: text.fill,
      fontFamily: text.fontFamily,
      fontSize: text.fontSize,
      fontWeight: text.fontWeight,
      textAlign: text.textAlign,
      lineHeight: text.lineHeight,
      charSpacing: text.charSpacing,
      editable: !node.locked,
      clipPath: fixedTextClip(node),
    })
  } else if (node.type === "image" && object instanceof Group) {
    syncImageGroup(object, node)
    return
  }

  object.set(options)
  // Fabric recomputes a Line's position when its endpoints change. Canonical
  // top-left placement must therefore be applied after x1/y1/x2/y2.
  if (node.type === "line" && object instanceof Line) {
    positionFabricLineFrame(object, node)
  }
  if (node.type === "text" && object instanceof Textbox) {
    if (object instanceof StudioTextbox) {
      object.setStudioTextLayout(
        node.sizingMode,
        projectFabricTextState(node).topOffset
      )
    }
    object.set({ height: node.height })
    positionFixedTextboxFrame(object, node)
    applyFabricTextControlPolicy(object, node)
  }
  object.setCoords()
}

type CropInteractionSnapshot = {
  selectable: boolean
  evented: boolean
  hasControls: boolean
  lockMovementX: boolean
  lockMovementY: boolean
  lockScalingX: boolean
  lockScalingY: boolean
  lockRotation: boolean
  hoverCursor: string | null
  moveCursor: string | null
}

type ImageCropDrag = {
  nodeId: string
  startPoint: { x: number; y: number }
  placement: ImagePlacement
  naturalSize: ImageNaturalSize
}

type ImageCropPinch = {
  nodeId: string
  placement: ImagePlacement
  naturalSize: ImageNaturalSize
  startDistance: number
  startMidpoint: { x: number; y: number }
  anchorPage: { x: number; y: number }
  cameraZoom: number
}

type ImageCropVisualSnapshot = {
  target: Group
  clipPath: Group["clipPath"]
  objectCaching: boolean
}

export class FabricCanvasAdapter implements CanvasAdapter {
  private canvas: Canvas | null = null
  private documentId: string | null = null
  private pageId: string | null = null
  private pageWidth: number | null = null
  private pageHeight: number | null = null
  private pageBackground: string | null = null
  private pageNodeOrder: string[] = []
  private generation = 0
  private syncing = false
  private activeGuides: SnapGuide[] = []
  private snapTargets: AlignmentSnapTarget[] = []
  private snapTargetPageId: string | null = null
  private moveSnapLatch: MoveSnapLatch | null = null
  private rotationSnapLatch: RotationSnapLatch | null = null
  private resizeSnapLatch: ResizeSnapLatch | null = null
  private viewportZoom = 1
  private readonly objectByNodeId = new Map<string, FabricObject>()
  private readonly nodeIdByObject = new WeakMap<FabricObject, string>()
  private readonly textByNodeId = new Map<string, string>()
  private readonly textSizingModeByNodeId = new Map<
    string,
    Extract<SceneNode, { type: "text" }>["sizingMode"]
  >()
  private readonly nodeByNodeId = new Map<string, SceneNode>()
  private readonly transformSessions = new CanvasTransformSessionController()
  private readonly transformTextPreviewNodeIds = new Set<string>()
  private imageCropMode: CanvasImageCropMode | null = null
  private imageCropDraftNode: Extract<SceneNode, { type: "image" }> | null =
    null
  private imageCropDrag: ImageCropDrag | null = null
  private imageCropPinch: ImageCropPinch | null = null
  private suppressCropTouchUntilRelease = false
  private imageCropVisualSnapshot: ImageCropVisualSnapshot | null = null
  private readonly cropInteractionSnapshots = new Map<
    FabricObject,
    CropInteractionSnapshot
  >()
  private textEditSession: {
    nodeId: string
    target: Textbox
    baseline: string
    cancelled: boolean
  } | null = null

  constructor(private readonly events: CanvasAdapterEvents) {}

  mount(element: HTMLCanvasElement) {
    if (this.canvas) throw new Error("Fabric canvas is already mounted")
    this.canvas = new Canvas(element, {
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
      ...FABRIC_TRANSFORM_MODIFIER_POLICY,
      selectionColor: "rgba(24, 24, 27, 0.06)",
      selectionBorderColor: SELECTION_COLOR,
      selectionLineWidth: 2,
      stopContextMenu: false,
      fireRightClick: true,
    })
    this.canvas.on("selection:created", this.onSelection)
    this.canvas.on("selection:updated", this.onSelection)
    this.canvas.on("selection:cleared", this.onSelectionCleared)
    this.canvas.on("mouse:dblclick", this.onMouseDoubleClick)
    this.canvas.on("mouse:down", this.onContextMenuPointerDown)
    this.canvas.on("mouse:down", this.onImageCropPointerDown)
    this.canvas.on("mouse:move", this.onImageCropPointerMove)
    this.canvas.on("mouse:up", this.onImageCropPointerUp)
    this.canvas.on("mouse:up", this.onTransformPointerUp)
    this.canvas.on("text:editing:entered", this.onTextEditingEntered)
    this.canvas.on("before:transform", this.onBeforeTransform)
    this.canvas.on("object:modified", this.onObjectModified)
    this.canvas.on("object:moving", this.onObjectMoving)
    this.canvas.on("object:scaling", this.onObjectTransformPreview)
    this.canvas.on("object:resizing", this.onObjectTransformPreview)
    this.canvas.on("object:rotating", this.onObjectTransformPreview)
    this.canvas.on("text:editing:exited", this.onTextEditingExited)
    this.canvas.on("after:render", this.onAfterRender)
    this.canvas.upperCanvasEl.addEventListener(
      "touchstart",
      this.onImageCropTouchStart,
      { capture: true, passive: false }
    )
    this.canvas.upperCanvasEl.addEventListener(
      "touchmove",
      this.onImageCropTouchMove,
      { capture: true, passive: false }
    )
    this.canvas.upperCanvasEl.addEventListener(
      "touchend",
      this.onImageCropTouchEnd,
      { capture: true, passive: false }
    )
    this.canvas.upperCanvasEl.addEventListener(
      "touchcancel",
      this.onImageCropTouchEnd,
      { capture: true, passive: false }
    )
    this.canvas.upperCanvasEl.setAttribute(
      "aria-label",
      "Interactive design canvas"
    )
    this.canvas.upperCanvasEl.setAttribute("role", "application")
  }

  async unmount() {
    this.generation += 1
    const canvas = this.canvas
    this.cancelTextEditing()
    this.cancelTransform()
    this.transformSessions.release()
    this.clearGuides()
    this.setImageCropMode(null)
    this.canvas = null
    this.documentId = null
    this.pageId = null
    this.snapTargets = []
    this.snapTargetPageId = null
    this.objectByNodeId.clear()
    this.textByNodeId.clear()
    this.textSizingModeByNodeId.clear()
    this.nodeByNodeId.clear()
    this.transformTextPreviewNodeIds.clear()
    this.clearTextEditSession()
    if (!canvas) return
    canvas.off("selection:created", this.onSelection)
    canvas.off("selection:updated", this.onSelection)
    canvas.off("selection:cleared", this.onSelectionCleared)
    canvas.off("mouse:dblclick", this.onMouseDoubleClick)
    canvas.off("mouse:down", this.onContextMenuPointerDown)
    canvas.off("mouse:down", this.onImageCropPointerDown)
    canvas.off("mouse:move", this.onImageCropPointerMove)
    canvas.off("mouse:up", this.onImageCropPointerUp)
    canvas.off("mouse:up", this.onTransformPointerUp)
    canvas.off("text:editing:entered", this.onTextEditingEntered)
    canvas.off("before:transform", this.onBeforeTransform)
    canvas.off("object:modified", this.onObjectModified)
    canvas.off("object:moving", this.onObjectMoving)
    canvas.off("object:scaling", this.onObjectTransformPreview)
    canvas.off("object:resizing", this.onObjectTransformPreview)
    canvas.off("object:rotating", this.onObjectTransformPreview)
    canvas.off("text:editing:exited", this.onTextEditingExited)
    canvas.off("after:render", this.onAfterRender)
    canvas.upperCanvasEl.removeEventListener(
      "touchstart",
      this.onImageCropTouchStart,
      true
    )
    canvas.upperCanvasEl.removeEventListener(
      "touchmove",
      this.onImageCropTouchMove,
      true
    )
    canvas.upperCanvasEl.removeEventListener(
      "touchend",
      this.onImageCropTouchEnd,
      true
    )
    canvas.upperCanvasEl.removeEventListener(
      "touchcancel",
      this.onImageCropTouchEnd,
      true
    )
    await canvas.dispose()
  }

  async sync(document: Document, pageId: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const canvas = this.canvas
    if (!canvas) return
    this.clearGuides()
    if (this.transformSessions.active) {
      this.cancelTransform()
      this.transformSessions.release()
    }
    const page = document.pages.find((candidate) => candidate.id === pageId)
    if (!page) return
    if (this.documentId && this.documentId !== document.id) {
      this.finalizeTextEditing("document_replace")
      this.imageCropDrag = null
    } else if (this.pageId && this.pageId !== pageId) {
      this.finalizeTextEditing("page_change")
      this.imageCropDrag = null
    }
    this.documentId = document.id
    const generation = ++this.generation
    const previousSelection = this.getSelection()?.nodeIds ?? []
    this.syncing = true
    this.activeGuides = []

    try {
      if (this.pageId !== pageId) {
        this.restoreCropInteractionPolicy()
        canvas.discardActiveObject()
        canvas.clear()
        this.objectByNodeId.clear()
        this.textByNodeId.clear()
        this.textSizingModeByNodeId.clear()
        this.nodeByNodeId.clear()
        this.transformTextPreviewNodeIds.clear()
        this.clearTextEditSession()
        this.pageId = pageId
        this.pageWidth = null
        this.pageHeight = null
        this.pageBackground = null
        this.pageNodeOrder = []
      }

      if (this.pageWidth !== page.width || this.pageHeight !== page.height) {
        canvas.setDimensions({ width: page.width, height: page.height })
        this.pageWidth = page.width
        this.pageHeight = page.height
      }
      if (this.pageBackground !== page.background) {
        canvas.backgroundColor = page.background
        this.pageBackground = page.background
      }

      const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
      const wanted = new Set(page.nodeIds)
      const orderChanged =
        this.pageNodeOrder.length !== page.nodeIds.length ||
        page.nodeIds.some(
          (nodeId, index) => this.pageNodeOrder[index] !== nodeId
        )
      for (const [nodeId, object] of this.objectByNodeId) {
        if (!wanted.has(nodeId)) {
          canvas.remove(object)
          this.objectByNodeId.delete(nodeId)
          this.textByNodeId.delete(nodeId)
          this.textSizingModeByNodeId.delete(nodeId)
          this.nodeByNodeId.delete(nodeId)
        }
      }

      const imagesToPrepare = page.nodeIds.flatMap((nodeId) => {
        const node = nodesById.get(nodeId)
        if (node?.type !== "image") return []
        const object = this.objectByNodeId.get(nodeId)
        if (!object) return [node]
        if (this.nodeByNodeId.get(nodeId) === node) return []
        const image =
          object instanceof Group
            ? object
                .getObjects()
                .find(
                  (child): child is FabricImage => child instanceof FabricImage
                )
            : undefined
        return !image || !equivalentImageSources(image.getSrc(), node.src)
          ? [node]
          : []
      })
      const preparedImages = prepareFabricImageObjects(imagesToPrepare, signal)
      const loadPreparedImage = (node: Extract<SceneNode, { type: "image" }>) =>
        preparedImages.get(node.id) ??
        createImageObjectWithinDeadline(node, signal)

      for (const [index, nodeId] of page.nodeIds.entries()) {
        signal?.throwIfAborted()
        const node = nodesById.get(nodeId)
        if (!node) continue
        const previousNode = this.nodeByNodeId.get(node.id)
        let object = this.objectByNodeId.get(nodeId)
        let objectNeedsPlacement = false

        if (object && node.type === "image" && previousNode !== node) {
          const image =
            object instanceof Group
              ? object
                  .getObjects()
                  .find(
                    (child): child is FabricImage =>
                      child instanceof FabricImage
                  )
              : undefined
          if (!image || !equivalentImageSources(image.getSrc(), node.src)) {
            const previousObject = object
            const replacement = await createFabricObjectForSync(
              node,
              loadPreparedImage,
              signal
            )
            signal?.throwIfAborted()
            if (generation !== this.generation || !this.canvas) return
            // A replacement is a staged visual swap. Keep the last decoded
            // pixels mounted until the requested source can be installed.
            if (!isMissingImagePlaceholder(replacement)) {
              canvas.remove(previousObject)
              this.objectByNodeId.set(node.id, replacement)
              this.nodeIdByObject.set(replacement, node.id)
              canvas.add(replacement)
              object = replacement
              objectNeedsPlacement = true
            }
          }
        }

        if (!object) {
          object = await createFabricObjectForSync(
            node,
            loadPreparedImage,
            signal
          )
          signal?.throwIfAborted()
          if (generation !== this.generation || !this.canvas) return
          this.objectByNodeId.set(node.id, object)
          this.nodeIdByObject.set(object, node.id)
          canvas.add(object)
          objectNeedsPlacement = true
        } else if (previousNode !== node) {
          syncFabricObjectFromNode(object, node)
        }
        // Commit the applied identity only after every awaited visual update
        // survives the generation guard. A superseding sync must still see
        // the old identity and finish installing the requested image source.
        this.nodeByNodeId.set(node.id, node)
        if (node.type === "text" && previousNode !== node) {
          this.textByNodeId.set(node.id, node.text)
          this.textSizingModeByNodeId.set(node.id, node.sizingMode)
        }
        if (orderChanged || objectNeedsPlacement) {
          canvas.moveObjectTo(object, index)
        }
      }
      this.pageNodeOrder = [...page.nodeIds]

      const selectionObjects = previousSelection
        .map((nodeId) => this.objectByNodeId.get(nodeId))
        .filter((object): object is FabricObject => Boolean(object))
      const activeObjects = canvas.getActiveObjects()
      const selectionUnchanged =
        activeObjects.length === selectionObjects.length &&
        activeObjects.every(
          (object, index) => object === selectionObjects[index]
        )
      if (!selectionUnchanged) {
        if (selectionObjects.length === 1 && selectionObjects[0]) {
          canvas.setActiveObject(selectionObjects[0])
        } else if (selectionObjects.length > 1) {
          canvas.setActiveObject(this.createActiveSelection(selectionObjects))
        }
      }
      this.applyImageCropInteractionPolicy()
      signal?.throwIfAborted()
      canvas.requestRenderAll()
    } finally {
      if (generation === this.generation) this.syncing = false
    }
  }

  setViewportZoom(zoom: number) {
    this.viewportZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  }

  setSnapTargets(pageId: string, targets: readonly AlignmentSnapTarget[]) {
    const next = targets
      .filter(
        (target) =>
          Number.isFinite(target.value) &&
          (target.axis === "x" || target.axis === "y")
      )
      .map((target) => ({ ...target }))
    const unchanged =
      this.snapTargetPageId === pageId &&
      this.snapTargets.length === next.length &&
      this.snapTargets.every(
        (target, index) =>
          target.axis === next[index]?.axis &&
          target.value === next[index]?.value &&
          target.source === next[index]?.source
      )
    if (unchanged) return
    this.snapTargetPageId = pageId
    this.snapTargets = next
    this.clearGuides()
  }

  private activeSnapTargets() {
    return this.snapTargetPageId === this.pageId ? this.snapTargets : []
  }

  select(selection: Selection | null) {
    const canvas = this.canvas
    if (!canvas) return
    if (
      shouldPreserveTextEditingSelection(
        this.textEditSession?.nodeId ?? null,
        selection
      )
    ) {
      canvas.requestRenderAll()
      return
    }
    if (this.transformSessions.active) {
      this.cancelTransform()
    }
    this.finalizeTextEditing("select")
    this.syncing = true
    try {
      canvas.discardActiveObject()
      const objects = (selection?.nodeIds ?? [])
        .map((nodeId) => this.objectByNodeId.get(nodeId))
        .filter((object): object is FabricObject => Boolean(object))
      if (objects.length === 1 && objects[0]) {
        canvas.setActiveObject(objects[0])
      } else if (objects.length > 1) {
        canvas.setActiveObject(this.createActiveSelection(objects))
      }
      canvas.requestRenderAll()
    } finally {
      this.syncing = false
    }
  }

  getSelection(): Selection | null {
    if (!this.canvas || !this.pageId) return null
    const nodeIds = this.canvas
      .getActiveObjects()
      .map((object) => this.nodeIdByObject.get(object))
      .filter((nodeId): nodeId is string => Boolean(nodeId))
    return nodeIds.length ? { pageId: this.pageId, nodeIds } : null
  }

  enterTextEditing(nodeId: string): boolean {
    const canvas = this.canvas
    const object = this.objectByNodeId.get(nodeId)
    if (!canvas || !(object instanceof Textbox)) return false
    const rawText = this.textByNodeId.get(nodeId)
    if (object instanceof StudioTextbox) {
      object.setStudioUsesCanonicalLines(false)
    }
    if (rawText !== undefined && object.text !== rawText) {
      setFabricTextboxContent(object, rawText, "editing")
      object.setCoords()
    }
    const entered = enterFabricTextEditing(canvas, object)
    if (entered) canvas.requestRenderAll()
    return entered
  }

  commitTextEditing(): boolean {
    const session = this.textEditSession
    if (!session) return false
    session.target.exitEditing()
    return true
  }

  cancelTextEditing(): boolean {
    const session = this.textEditSession
    if (!session) return false
    session.cancelled = true
    this.textByNodeId.set(session.nodeId, session.baseline)
    cancelFabricTextEditing(session.target, session.baseline)
    const node = this.nodeByNodeId.get(session.nodeId)
    if (node?.type === "text") {
      setFabricTextboxContent(
        session.target,
        projectFabricTextState(node).displayText,
        "canonical"
      )
      session.target.setCoords()
    }
    this.clearTextEditSession()
    this.canvas?.requestRenderAll()
    return true
  }

  cancelTransform(): boolean {
    const context = this.transformContext()
    if (!context) return false
    const result = this.transformSessions.cancel(context)
    if (
      result.status !== "cancelled" &&
      result.status !== "already_cancelled"
    ) {
      return false
    }
    // This is Fabric's public transform terminator. It synchronously emits the
    // trailing object:modified event, which sees the cancelled phase below and
    // therefore cannot publish a canonical mutation.
    this.canvas?.endCurrentTransform()
    this.restoreTransformBaseline(result.session)
    this.transformSessions.release()
    return true
  }

  setImageCropMode(mode: CanvasImageCropMode | null): boolean {
    if (!mode) {
      const previousTargetId = this.imageCropMode?.nodeId
      const previousNode = previousTargetId
        ? this.nodeByNodeId.get(previousTargetId)
        : undefined
      this.imageCropMode = null
      this.imageCropDraftNode = null
      this.imageCropDrag = null
      this.imageCropPinch = null
      this.suppressCropTouchUntilRelease = false
      const previousTarget = previousTargetId
        ? this.objectByNodeId.get(previousTargetId)
        : undefined
      if (previousTarget && previousNode) {
        syncFabricObjectFromNode(previousTarget, previousNode)
      }
      this.restoreCropInteractionPolicy()
      if (this.canvas && previousTarget) {
        const wasSyncing = this.syncing
        this.syncing = true
        this.canvas.setActiveObject(previousTarget)
        this.syncing = wasSyncing
      }
      this.canvas?.requestRenderAll()
      return true
    }

    const requestedNode = this.nodeByNodeId.get(mode.nodeId)
    const requestedObject = this.objectByNodeId.get(mode.nodeId)
    const requestedImage =
      requestedObject instanceof Group
        ? requestedObject
            .getObjects()
            .find((child): child is FabricImage => child instanceof FabricImage)
        : undefined
    if (
      requestedNode?.type !== "image" ||
      !requestedObject ||
      isMissingImagePlaceholder(requestedObject) ||
      !requestedImage
    ) {
      this.imageCropMode = null
      this.imageCropDraftNode = null
      this.imageCropDrag = null
      this.restoreCropInteractionPolicy()
      this.canvas?.requestRenderAll()
      return false
    }

    if (this.imageCropMode?.nodeId !== mode.nodeId) {
      this.imageCropDrag = null
      this.imageCropPinch = null
      this.suppressCropTouchUntilRelease = false
      this.restoreCropInteractionPolicy()
    } else if (this.imageCropDraftNode?.id === mode.nodeId) {
      const applied = this.applyImageCropInteractionPolicy()
      this.canvas?.requestRenderAll()
      return applied
    }
    this.imageCropMode = {
      nodeId: mode.nodeId,
      placement: { ...mode.placement },
    }
    this.imageCropDraftNode = {
      ...requestedNode,
      placement: { ...mode.placement },
    }
    const applied = this.applyImageCropInteractionPolicy()
    this.canvas?.requestRenderAll()
    return applied
  }

  previewImageCropDraft(draft: CanvasImageCropDraft): boolean {
    const mode = this.imageCropMode
    const node = this.nodeByNodeId.get(draft.nodeId)
    const object = this.objectByNodeId.get(draft.nodeId)
    if (
      !mode ||
      mode.nodeId !== draft.nodeId ||
      node?.type !== "image" ||
      !(object instanceof Group)
    ) {
      return false
    }

    this.imageCropMode = {
      nodeId: draft.nodeId,
      placement: { ...draft.placement },
    }
    this.imageCropDraftNode = {
      ...node,
      ...draft.frame,
      placement: { ...draft.placement },
      frameMask: { ...draft.frameMask },
    }
    const applied = this.applyImageCropInteractionPolicy()
    this.canvas?.requestRenderAll()
    return applied
  }

  nudgeImageCrop(
    screenDelta: { x: number; y: number },
    cameraZoom: number
  ): boolean {
    const mode = this.imageCropMode
    if (!mode) return false
    const node = this.activeImageCropNode(mode.nodeId)
    const object = this.objectByNodeId.get(mode.nodeId)
    if (node?.type !== "image" || !(object instanceof Group)) return false
    const image = object
      .getObjects()
      .find((child): child is FabricImage => child instanceof FabricImage)
    if (!image) return false

    const placement = projectFabricImageCropScreenNudge(
      node,
      verifiedImageNaturalSize(image),
      mode.placement,
      screenDelta,
      cameraZoom
    )
    if (
      placement.mode === mode.placement.mode &&
      placement.focalX === mode.placement.focalX &&
      placement.focalY === mode.placement.focalY &&
      placement.zoom === mode.placement.zoom &&
      placement.rotation === mode.placement.rotation &&
      placement.flipX === mode.placement.flipX &&
      placement.flipY === mode.placement.flipY
    ) {
      return false
    }

    this.imageCropMode = { nodeId: mode.nodeId, placement }
    this.imageCropDraftNode = { ...node, placement }
    this.applyImageCropInteractionPolicy()
    this.events.onImageCropPreview?.({
      nodeId: mode.nodeId,
      placement: { ...placement },
    })
    this.canvas?.requestRenderAll()
    return true
  }

  getImageSourceReadiness(nodeId: string) {
    const node = this.nodeByNodeId.get(nodeId)
    const object = this.objectByNodeId.get(nodeId)
    if (node?.type !== "image" || !object) return null
    if (isMissingImagePlaceholder(object)) return "unavailable" as const
    if (!(object instanceof Group)) return "unavailable" as const
    const image = object
      .getObjects()
      .find((child): child is FabricImage => child instanceof FabricImage)
    return image && equivalentImageSources(image.getSrc(), node.src)
      ? ("ready" as const)
      : ("unavailable" as const)
  }

  async retryImageSource(nodeId: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const canvas = this.canvas
    const node = this.nodeByNodeId.get(nodeId)
    const previousObject = this.objectByNodeId.get(nodeId)
    if (!canvas || node?.type !== "image" || !previousObject) return null
    if (this.getImageSourceReadiness(nodeId) === "ready")
      return "ready" as const

    const generation = this.generation
    const expectedSource = node.src
    let replacement: Group
    try {
      replacement = await createImageObject(node, signal)
    } catch {
      signal?.throwIfAborted()
      return "unavailable" as const
    }
    signal?.throwIfAborted()
    const currentNode = this.nodeByNodeId.get(nodeId)
    if (
      this.canvas !== canvas ||
      this.generation !== generation ||
      currentNode?.type !== "image" ||
      currentNode.src !== expectedSource ||
      this.objectByNodeId.get(nodeId) !== previousObject
    ) {
      return this.getImageSourceReadiness(nodeId)
    }

    const index = canvas.getObjects().indexOf(previousObject)
    const wasSelected = canvas.getActiveObjects().includes(previousObject)
    canvas.remove(previousObject)
    this.objectByNodeId.set(nodeId, replacement)
    this.nodeIdByObject.set(replacement, nodeId)
    canvas.add(replacement)
    if (index >= 0) canvas.moveObjectTo(replacement, index)
    if (wasSelected) canvas.setActiveObject(replacement)
    this.applyImageCropInteractionPolicy()
    canvas.requestRenderAll()
    return "ready" as const
  }

  getImageNaturalSize(nodeId: string) {
    const node = this.nodeByNodeId.get(nodeId)
    const object = this.objectByNodeId.get(nodeId)
    if (node?.type !== "image" || !(object instanceof Group)) return null
    const image = object
      .getObjects()
      .find((child): child is FabricImage => child instanceof FabricImage)
    if (!image || !equivalentImageSources(image.getSrc(), node.src)) return null
    return verifiedImageNaturalSize(image)
  }

  private applyImageCropInteractionPolicy(): boolean {
    const mode = this.imageCropMode
    if (!mode) return false
    const targetNode = this.activeImageCropNode(mode.nodeId)
    const targetObject = this.objectByNodeId.get(mode.nodeId)
    if (targetNode?.type !== "image" || !(targetObject instanceof Group)) {
      return false
    }
    const image = targetObject
      .getObjects()
      .find((child): child is FabricImage => child instanceof FabricImage)
    if (!image) return false

    if (this.imageCropVisualSnapshot?.target !== targetObject) {
      this.imageCropVisualSnapshot = {
        target: targetObject,
        clipPath: targetObject.clipPath,
        objectCaching: targetObject.objectCaching,
      }
    }
    syncImageGroup(
      targetObject,
      {
        ...targetNode,
        placement: { ...mode.placement },
      },
      { clipToFrame: false }
    )
    for (const object of this.objectByNodeId.values()) {
      if (!this.cropInteractionSnapshots.has(object)) {
        this.cropInteractionSnapshots.set(object, {
          selectable: object.selectable,
          evented: object.evented,
          hasControls: object.hasControls,
          lockMovementX: object.lockMovementX,
          lockMovementY: object.lockMovementY,
          lockScalingX: object.lockScalingX,
          lockScalingY: object.lockScalingY,
          lockRotation: object.lockRotation,
          hoverCursor: object.hoverCursor,
          moveCursor: object.moveCursor,
        })
      }
      const cropTarget = object === targetObject
      object.set({
        selectable: false,
        evented: cropTarget,
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hoverCursor: cropTarget ? "grab" : object.hoverCursor,
        moveCursor: cropTarget ? "grabbing" : object.moveCursor,
      })
      object.setCoords()
    }
    return true
  }

  private activeImageCropNode(nodeId: string) {
    if (this.imageCropDraftNode?.id === nodeId) return this.imageCropDraftNode
    const node = this.nodeByNodeId.get(nodeId)
    return node?.type === "image" ? node : null
  }

  private restoreCropInteractionPolicy() {
    const visualSnapshot = this.imageCropVisualSnapshot
    if (visualSnapshot) {
      visualSnapshot.target.set({
        clipPath: visualSnapshot.clipPath,
        objectCaching: visualSnapshot.objectCaching,
        dirty: true,
      })
      visualSnapshot.target.setCoords()
      this.imageCropVisualSnapshot = null
    }
    for (const [object, snapshot] of this.cropInteractionSnapshots) {
      object.set(snapshot)
      object.setCoords()
    }
    this.cropInteractionSnapshots.clear()
  }

  private finalizeTextEditing(transition: TextEditTransition): boolean {
    return textEditFinalizationPolicy(transition) === "commit"
      ? this.commitTextEditing()
      : this.cancelTextEditing()
  }

  exportPng() {
    return (
      this.canvas?.toDataURL({
        format: "png",
        multiplier: 1,
        enableRetinaScaling: false,
      }) ?? null
    )
  }

  private onSelection = () => {
    if (this.imageCropMode) return
    const activeObject = this.canvas?.getActiveObject()
    if (activeObject instanceof ActiveSelection) {
      this.applyActiveSelectionTransformPolicy(activeObject)
      activeObject.setCoords()
      this.canvas?.requestRenderAll()
    }
    if (!this.syncing) this.events.onSelectionChange(this.getSelection())
  }

  private onSelectionCleared = () => {
    this.clearGuides()
    if (this.imageCropMode) return
    if (!this.syncing) this.events.onSelectionChange(null)
  }

  private onMouseDoubleClick = ({
    e,
    target,
  }: TPointerEventInfo<TPointerEvent>) => {
    if (target instanceof Textbox) {
      const nodeId = this.nodeIdByObject.get(target)
      if (nodeId) this.enterTextEditing(nodeId)
      return
    }
    if (target) {
      const nodeId = this.nodeIdByObject.get(target)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      if (node?.type === "image") {
        this.events.onImageDoubleClick?.(node.id)
      }
      return
    }
    const point = "clientX" in e ? e : e.changedTouches[0]
    if (point) {
      this.events.onCanvasDoubleClick?.({
        clientX: point.clientX,
        clientY: point.clientY,
      })
    }
  }

  private onContextMenuPointerDown = ({
    e,
    target,
  }: TPointerEventInfo<TPointerEvent>) => {
    if (!("button" in e) || e.button !== 2) return
    this.events.onContextMenu?.({
      clientX: e.clientX,
      clientY: e.clientY,
      nodeId: target ? (this.nodeIdByObject.get(target) ?? null) : null,
    })
  }

  private onImageCropTouchStart = (event: TouchEvent) => {
    if (this.suppressCropTouchUntilRelease) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const mode = this.imageCropMode
    const canvas = this.canvas
    const metrics = twoTouchGestureMetrics(event.touches)
    if (!mode || !canvas || !metrics || metrics.distance <= 0) return
    const node = this.activeImageCropNode(mode.nodeId)
    const object = this.objectByNodeId.get(mode.nodeId)
    if (node?.type !== "image" || !(object instanceof Group)) return
    const image = object
      .getObjects()
      .find((child): child is FabricImage => child instanceof FabricImage)
    if (!image) return
    const bounds = canvas.upperCanvasEl.getBoundingClientRect()
    const cameraZoom = bounds.width / canvas.getWidth()
    if (!Number.isFinite(cameraZoom) || cameraZoom <= 0) return
    const anchorPage = {
      x: (metrics.midpoint.x - bounds.left) / cameraZoom,
      y: (metrics.midpoint.y - bounds.top) / cameraZoom,
    }
    if (!isPagePointInsideImageFrame(node, anchorPage)) return

    this.imageCropDrag = null
    this.imageCropPinch = {
      nodeId: node.id,
      placement: { ...mode.placement },
      naturalSize: verifiedImageNaturalSize(image),
      startDistance: metrics.distance,
      startMidpoint: metrics.midpoint,
      anchorPage,
      cameraZoom,
    }
    object.set({ hoverCursor: "grabbing" })
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private onImageCropTouchMove = (event: TouchEvent) => {
    if (this.suppressCropTouchUntilRelease) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const pinch = this.imageCropPinch
    const mode = this.imageCropMode
    const metrics = twoTouchGestureMetrics(event.touches)
    if (!pinch || !mode || mode.nodeId !== pinch.nodeId || !metrics) return
    const node = this.activeImageCropNode(pinch.nodeId)
    if (node?.type !== "image") return
    const placement = projectFabricImageCropPinch(
      node,
      pinch.naturalSize,
      pinch.placement,
      {
        scale: metrics.distance / pinch.startDistance,
        anchorPage: pinch.anchorPage,
        screenTranslation: {
          x: metrics.midpoint.x - pinch.startMidpoint.x,
          y: metrics.midpoint.y - pinch.startMidpoint.y,
        },
        cameraZoom: pinch.cameraZoom,
      }
    )
    this.imageCropMode = { nodeId: pinch.nodeId, placement }
    this.imageCropDraftNode = { ...node, placement }
    this.applyImageCropInteractionPolicy()
    this.events.onImageCropPreview?.({
      nodeId: pinch.nodeId,
      placement: { ...placement },
    })
    event.preventDefault()
    event.stopImmediatePropagation()
    this.canvas?.requestRenderAll()
  }

  private onImageCropTouchEnd = (event: TouchEvent) => {
    if (!this.imageCropPinch && !this.suppressCropTouchUntilRelease) return
    const nodeId = this.imageCropPinch?.nodeId
    this.imageCropPinch = null
    this.suppressCropTouchUntilRelease = event.touches.length > 0
    if (nodeId) {
      this.objectByNodeId.get(nodeId)?.set({ hoverCursor: "grab" })
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    this.canvas?.requestRenderAll()
  }

  private onImageCropPointerDown = ({
    e,
    target,
    scenePoint,
  }: TPointerEventInfo<TPointerEvent>) => {
    const mode = this.imageCropMode
    if (!mode || !target || this.nodeIdByObject.get(target) !== mode.nodeId) {
      return
    }
    if ("button" in e && e.button !== 0) return
    const node = this.activeImageCropNode(mode.nodeId)
    if (node?.type !== "image" || !(target instanceof Group)) return
    const image = target
      .getObjects()
      .find((child): child is FabricImage => child instanceof FabricImage)
    if (!image) return

    this.imageCropDrag = {
      nodeId: node.id,
      startPoint: { x: scenePoint.x, y: scenePoint.y },
      placement: { ...mode.placement },
      naturalSize: verifiedImageNaturalSize(image),
    }
    target.set({ hoverCursor: "grabbing" })
    e.preventDefault()
    this.canvas?.requestRenderAll()
  }

  private onImageCropPointerMove = ({
    e,
    scenePoint,
  }: TPointerEventInfo<TPointerEvent>) => {
    const drag = this.imageCropDrag
    const mode = this.imageCropMode
    if (!drag || !mode || mode.nodeId !== drag.nodeId) return
    const node = this.activeImageCropNode(drag.nodeId)
    if (node?.type !== "image") return
    const placement = projectFabricImageCropDrag(
      node,
      drag.naturalSize,
      drag.placement,
      {
        x: scenePoint.x - drag.startPoint.x,
        y: scenePoint.y - drag.startPoint.y,
      }
    )
    if (
      placement.mode === mode.placement.mode &&
      placement.focalX === mode.placement.focalX &&
      placement.focalY === mode.placement.focalY &&
      placement.zoom === mode.placement.zoom &&
      placement.rotation === mode.placement.rotation &&
      placement.flipX === mode.placement.flipX &&
      placement.flipY === mode.placement.flipY
    ) {
      return
    }

    this.imageCropMode = { nodeId: drag.nodeId, placement }
    this.imageCropDraftNode = { ...node, placement }
    this.applyImageCropInteractionPolicy()
    this.events.onImageCropPreview?.({
      nodeId: drag.nodeId,
      placement: { ...placement },
    })
    e.preventDefault()
    this.canvas?.requestRenderAll()
  }

  private onImageCropPointerUp = ({ e }: TPointerEventInfo<TPointerEvent>) => {
    const drag = this.imageCropDrag
    if (!drag) return
    this.imageCropDrag = null
    this.objectByNodeId.get(drag.nodeId)?.set({ hoverCursor: "grab" })
    e.preventDefault()
    this.canvas?.requestRenderAll()
  }

  private transformContext() {
    return this.documentId && this.pageId
      ? { documentId: this.documentId, pageId: this.pageId }
      : null
  }

  private createActiveSelection(objects: FabricObject[]) {
    const canvas = this.canvas
    const selection = new ActiveSelection(objects, {
      canvas: canvas ?? undefined,
    })
    this.applyActiveSelectionTransformPolicy(selection)
    return selection
  }

  private activeSelectionContainsLockedNode(selection: ActiveSelection) {
    return selection.getObjects().some((object) => {
      const nodeId = this.nodeIdByObject.get(object)
      return nodeId ? this.nodeByNodeId.get(nodeId)?.locked === true : false
    })
  }

  private applyActiveSelectionTransformPolicy(selection: ActiveSelection) {
    const containsLockedNode = this.activeSelectionContainsLockedNode(selection)
    selection.set({
      hasControls: !containsLockedNode,
      lockMovementX: containsLockedNode,
      lockMovementY: containsLockedNode,
      lockScalingX: containsLockedNode,
      lockScalingY: containsLockedNode,
      lockScalingFlip: true,
      lockRotation: containsLockedNode,
    })
    if (!containsLockedNode) {
      selection.controls = controlsUtils.createObjectDefaultControls()
      for (const key of ACTIVE_SELECTION_CORNER_CONTROLS) {
        selection.controls[key]!.actionHandler = scaleActiveSelectionUniformly
      }
      selection.setControlsVisibility(
        Object.fromEntries(
          ACTIVE_SELECTION_SIDE_CONTROLS.map((key) => [key, false])
        )
      )
    }
  }

  private transformObjects(target: FabricObject) {
    return target instanceof ActiveSelection ? target.getObjects() : [target]
  }

  private onBeforeTransform = ({ transform }: { transform: Transform }) => {
    const context = this.transformContext()
    const kind = fabricTransformKind(transform.action)
    if (
      this.syncing ||
      this.imageCropMode ||
      this.textEditSession ||
      !context ||
      !kind
    ) {
      return
    }
    this.moveSnapLatch = null
    this.rotationSnapLatch = null
    this.resizeSnapLatch = null
    this.activeGuides = []
    if (
      transform.target instanceof ActiveSelection &&
      this.activeSelectionContainsLockedNode(transform.target)
    ) {
      this.applyActiveSelectionTransformPolicy(transform.target)
      transform.target.setCoords()
      this.canvas?.requestRenderAll()
      return
    }
    const baseline = new Map<
      string,
      Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation">
    >()
    for (const object of this.transformObjects(transform.target)) {
      const nodeId = this.nodeIdByObject.get(object)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      if (!nodeId || !node) continue
      baseline.set(nodeId, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
      })
    }
    this.transformSessions.begin({ ...context, kind, baseline })
    if (
      kind === "resize" &&
      !(transform.target instanceof ActiveSelection) &&
      transform.target instanceof Textbox
    ) {
      const nodeId = this.nodeIdByObject.get(transform.target)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      const rawText = nodeId
        ? (this.textByNodeId.get(nodeId) ??
          (node?.type === "text" ? node.text : undefined))
        : undefined
      if (nodeId && rawText !== undefined) {
        // Idle rendering consumes the document projector's already-wrapped
        // lines exactly once. A live width transform must instead give
        // Fabric the raw source so its control can preview the new reflow.
        setFabricTextboxContent(transform.target, rawText, "editing")
        transform.target.setCoords()
        this.transformTextPreviewNodeIds.add(nodeId)
      }
    }
  }

  private onTransformPointerUp = () => {
    const session = this.transformSessions.active
    if (!session || session.phase === "cancelled") return
    // Fabric emits object:modified before mouse:up when a transform changed.
    // A click without movement emits no modified event, so mouse:up releases
    // that no-op session after Fabric has finalized it.
    this.restoreTransformTextPreviews()
    this.transformSessions.release()
    this.clearGuides()
  }

  private onObjectTransformPreview = ({
    e,
    target,
    transform,
  }: {
    e?: TPointerEvent
    target?: FabricObject
    transform?: Transform
  }) => {
    const session = this.transformSessions.active
    if (session?.phase === "cancelled") {
      this.restoreTransformBaseline(session)
      return
    }
    const canvas = this.canvas
    if (!canvas || !session || !target || !transform) return
    const shiftKey = Boolean(e?.shiftKey ?? transform.shiftKey)

    if (session.kind === "rotate") {
      const result = snapRotation({
        proposedAngle: target.angle,
        enabled: shiftKey,
        previousLatch: this.rotationSnapLatch,
      })
      this.rotationSnapLatch = result.latch
      if (target.angle !== result.angle) {
        target.set({ angle: result.angle })
        target.setCoords()
        canvas.requestRenderAll()
      }
      return
    }

    if (session.kind !== "resize" || target instanceof ActiveSelection) return
    const handle = fabricResizeHandle(transform.corner)
    const nodeId = this.nodeIdByObject.get(target)
    const baseline = nodeId ? session.baseline.get(nodeId) : undefined
    if (!handle || !nodeId || !baseline) return
    const textSizingMode =
      target instanceof Textbox
        ? this.textSizingModeByNodeId.get(nodeId)
        : undefined
    const canonicalCurrent = fabricObjectToNodePatch(target)
    const objectScale = target.getObjectScaling()
    const current =
      target instanceof Textbox &&
      textSizingMode === "fixed" &&
      transform.action === "resizing"
        ? {
            ...canonicalCurrent,
            // A fixed Textbox stores its canonical frame in the clip. During
            // Fabric's side-handle action, however, the proposed width lives
            // on the intrinsic Textbox until this preview updates the clip.
            width: Math.max(1, round(target.width * Math.abs(objectScale.x))),
            height: Math.max(1, round(target.height * Math.abs(objectScale.y))),
          }
        : canonicalCurrent
    const movingObjects = new Set([target])
    const peers = [...this.objectByNodeId.values()]
      .filter((object) => !movingObjects.has(object) && object.visible)
      .map(snapBoundsForObject)
    const centered =
      transform.originX === "center" && transform.originY === "center"
    const proposed = localResizeProposal(baseline, current, handle, centered)
    const intrinsicTextWidth =
      target instanceof Textbox && transform.action === "resizing"
    const usesCanonicalTextFrameAnchor =
      target instanceof Textbox &&
      (textSizingMode === "fixed" || intrinsicTextWidth)
    const anchor = resizeAnchor(
      handle,
      centered,
      intrinsicTextWidth && textSizingMode === "auto_height"
    )
    const constrained = applyResizeConstraint({
      baseline,
      proposed,
      handle,
      modifiers: {
        // Auto-height text owns its height through layout, so a width handle
        // must reflow instead of manufacturing a height the commit discards.
        shiftKey: shiftKey && textSizingMode !== "auto_height",
        // Fabric resolves centered scaling at pointer-down and records that
        // decision in the transform origin. Reading the origin avoids a
        // mid-gesture Alt keyup from moving the supposedly fixed center.
        altKey: centered,
      },
      snap: {
        enabled: true,
        page: { width: canvas.getWidth(), height: canvas.getHeight() },
        peers,
        targets: this.activeSnapTargets(),
        previousLatch: this.resizeSnapLatch,
        screenThreshold: {
          acquirePixels: 8,
          releasePixels: 12,
          zoom: this.viewportZoom,
        },
        basis:
          Math.abs(normalizeRotation(baseline.rotation)) < 0.01
            ? { kind: "axis_aligned" }
            : { kind: "non_axis_aligned", source: "node" },
      },
    })
    this.resizeSnapLatch = constrained.latch
    this.activeGuides = [...constrained.guides]
    // A rotated basis declines only world-axis snapping. Local size and aspect
    // constraints still apply, with Fabric preserving the opposite handle in
    // the object's rotated coordinate space.
    if (
      applyFabricRectPreview(
        target,
        current,
        constrained.rect,
        transform.action,
        textSizingMode,
        usesCanonicalTextFrameAnchor
          ? {
              ...anchor,
              point: textResizeBaselineAnchor(
                baseline,
                anchor.originX,
                anchor.originY
              ),
            }
          : anchor
      )
    ) {
      canvas.requestRenderAll()
    }
  }

  private restoreTransformBaseline(session: CanvasTransformSession) {
    const canvas = this.canvas
    if (!canvas) return
    const previousSyncing = this.syncing
    this.syncing = true
    try {
      // Discarding an ActiveSelection applies its public group transform back
      // into its children. Canonical geometry can then be restored in the
      // canvas plane before rebuilding the exact same selection.
      canvas.discardActiveObject()
      const selectionObjects: FabricObject[] = []
      for (const nodeId of session.nodeIds) {
        const object = this.objectByNodeId.get(nodeId)
        const node = this.nodeByNodeId.get(nodeId)
        const geometry = session.baseline.get(nodeId)
        if (!object || !node || !geometry) continue
        syncFabricObjectFromNode(object, { ...node, ...geometry })
        selectionObjects.push(object)
      }
      if (selectionObjects.length === 1 && selectionObjects[0]) {
        canvas.setActiveObject(selectionObjects[0])
      } else if (selectionObjects.length > 1) {
        canvas.setActiveObject(this.createActiveSelection(selectionObjects))
      }
    } finally {
      this.syncing = previousSyncing
    }
    this.activeGuides = []
    this.rotationSnapLatch = null
    this.resizeSnapLatch = null
    this.moveSnapLatch = null
    this.transformTextPreviewNodeIds.clear()
    canvas.requestRenderAll()
  }

  private restoreTransformTextPreviews() {
    if (!this.transformTextPreviewNodeIds.size) return
    const canvas = this.canvas
    for (const nodeId of this.transformTextPreviewNodeIds) {
      const object = this.objectByNodeId.get(nodeId)
      const node = this.nodeByNodeId.get(nodeId)
      if (object instanceof Textbox && node?.type === "text") {
        syncFabricObjectFromNode(object, node)
      }
    }
    this.transformTextPreviewNodeIds.clear()
    canvas?.requestRenderAll()
  }

  private queueTransformBaselineRestore(session: CanvasTransformSession) {
    // object:modified fires from inside Fabric's finalizer. Rebuild an
    // ActiveSelection only after that stack has cleared its transform.
    const rejectedCanvas = this.canvas
    const rejectedGeneration = this.generation
    const rejectedDocumentId = this.documentId
    const rejectedPageId = this.pageId
    queueMicrotask(() => {
      if (
        this.canvas !== rejectedCanvas ||
        this.generation !== rejectedGeneration ||
        this.documentId !== rejectedDocumentId ||
        this.pageId !== rejectedPageId
      ) {
        return
      }
      this.restoreTransformBaseline(session)
    })
  }

  private onObjectMoving = ({ target }: { target?: FabricObject }) => {
    const canvas = this.canvas
    if (this.syncing || !canvas || !target) return
    const transformSession = this.transformSessions.active
    if (transformSession?.phase === "cancelled") {
      this.restoreTransformBaseline(transformSession)
      return
    }
    if (this.imageCropMode) {
      const nodeId = this.nodeIdByObject.get(target)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      if (node) syncFabricObjectFromNode(target, node)
      this.applyImageCropInteractionPolicy()
      canvas.requestRenderAll()
      return
    }
    const movingObjects = new Set(
      target instanceof ActiveSelection ? target.getObjects() : [target]
    )
    const bounds = snapBoundsForObject(target)
    const peers = [...this.objectByNodeId.values()]
      .filter((object) => !movingObjects.has(object) && object.visible)
      .map(snapBoundsForObject)
    const snap = calculateSnap(
      {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      { width: canvas.getWidth(), height: canvas.getHeight() },
      peers,
      {
        targets: this.activeSnapTargets(),
        previousLatch: this.moveSnapLatch,
        screenThreshold: {
          acquirePixels: 8,
          releasePixels: 12,
          zoom: this.viewportZoom,
        },
      }
    )
    this.moveSnapLatch = snap.latch
    if (snap.deltaX || snap.deltaY) {
      target.set({
        left: (target.left ?? 0) + snap.deltaX,
        top: (target.top ?? 0) + snap.deltaY,
      })
      target.setCoords()
    }
    this.activeGuides = snap.guides
    canvas.requestRenderAll()
  }

  private onAfterRender = () => {
    const canvas = this.canvas
    if (!canvas || !this.activeGuides.length) return
    const context = canvas.contextTop
    context.save()
    context.strokeStyle = GUIDE_COLOR
    context.lineWidth = 2
    for (const guide of this.activeGuides) {
      if (guide.source === "spacing") {
        context.setLineDash([])
        context.lineWidth = 2
        context.font = "500 28px 'Geist Mono', ui-monospace, monospace"
        context.textAlign = "center"
        context.textBaseline = "middle"
        for (const span of guide.spans) {
          context.beginPath()
          if (guide.axis === "x") {
            context.moveTo(span.start, span.cross)
            context.lineTo(span.end, span.cross)
            context.moveTo(span.start, span.cross - 8)
            context.lineTo(span.start, span.cross + 8)
            context.moveTo(span.end, span.cross - 8)
            context.lineTo(span.end, span.cross + 8)
          } else {
            context.moveTo(span.cross, span.start)
            context.lineTo(span.cross, span.end)
            context.moveTo(span.cross - 8, span.start)
            context.lineTo(span.cross + 8, span.start)
            context.moveTo(span.cross - 8, span.end)
            context.lineTo(span.cross + 8, span.end)
          }
          context.stroke()

          const label = `${Math.round(guide.gap)}`
          const labelX =
            guide.axis === "x" ? (span.start + span.end) / 2 : span.cross
          const labelY =
            guide.axis === "x" ? span.cross : (span.start + span.end) / 2
          const labelWidth = context.measureText(label).width + 14
          context.fillStyle = "rgba(255,255,255,0.96)"
          context.fillRect(labelX - labelWidth / 2, labelY - 18, labelWidth, 36)
          context.fillStyle = GUIDE_COLOR
          context.fillText(label, labelX, labelY + 1)
        }
        continue
      }

      context.setLineDash([8, 6])
      context.lineWidth = 2
      context.beginPath()
      if (guide.axis === "x") {
        context.moveTo(guide.value, 0)
        context.lineTo(guide.value, canvas.getHeight())
      } else {
        context.moveTo(0, guide.value)
        context.lineTo(canvas.getWidth(), guide.value)
      }
      context.stroke()
    }
    context.restore()
  }

  private clearGuides() {
    this.moveSnapLatch = null
    this.rotationSnapLatch = null
    this.resizeSnapLatch = null
    if (!this.activeGuides.length) return
    this.activeGuides = []
    this.canvas?.requestRenderAll()
  }

  private onObjectModified = ({ target }: ModifiedEvent) => {
    this.clearGuides()
    if (this.syncing || !target) return
    const context = this.transformContext()
    const transformSession = this.transformSessions.active
    if (transformSession?.phase === "cancelled") {
      // cancelTransform owns restoration after endCurrentTransform returns.
      return
    }
    if (
      transformSession &&
      (!context ||
        transformSession.documentId !== context.documentId ||
        transformSession.pageId !== context.pageId)
    ) {
      this.queueTransformBaselineRestore(transformSession)
      this.transformSessions.release()
      return
    }
    if (this.imageCropMode) {
      const nodeId = this.nodeIdByObject.get(target)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      if (node) syncFabricObjectFromNode(target, node)
      this.applyImageCropInteractionPolicy()
      this.canvas?.requestRenderAll()
      return
    }
    if (
      transformSession &&
      !isRepresentableActiveSelectionTransform(target, transformSession)
    ) {
      this.queueTransformBaselineRestore(transformSession)
      this.transformSessions.release()
      return
    }
    const targets =
      target instanceof ActiveSelection ? target.getObjects() : [target]
    const changes: CanvasNodeChange[] = []
    for (const object of targets) {
      const nodeId = this.nodeIdByObject.get(object)
      if (!nodeId) continue
      const geometry = fabricObjectToNodePatch(object)
      const sizingMode =
        object instanceof Textbox
          ? this.textSizingModeByNodeId.get(nodeId)
          : undefined
      const patch = sizingMode
        ? constrainTextGeometryPatch(sizingMode, geometry)
        : geometry
      const baseline =
        transformSession?.baseline.get(nodeId) ?? this.nodeByNodeId.get(nodeId)
      if (
        baseline &&
        !canvasTransformGeometryChanged(
          fabricComparableNodeGeometry(baseline),
          patch
        )
      ) {
        continue
      }
      changes.push({ nodeId, patch })
    }
    if (!changes.length) {
      this.restoreTransformTextPreviews()
      if (context) this.transformSessions.commit(context)
      return
    }
    const accepted = this.events.onNodesChange(changes)
    if (accepted === false) {
      if (transformSession) {
        this.queueTransformBaselineRestore(transformSession)
      } else {
        for (const change of changes) {
          const object = this.objectByNodeId.get(change.nodeId)
          const node = this.nodeByNodeId.get(change.nodeId)
          if (object && node) syncFabricObjectFromNode(object, node)
        }
        this.canvas?.requestRenderAll()
      }
    } else {
      for (const change of changes) {
        const node = this.nodeByNodeId.get(change.nodeId)
        if (node) {
          this.nodeByNodeId.set(change.nodeId, {
            ...node,
            ...change.patch,
          } as SceneNode)
        }
      }
      this.restoreTransformTextPreviews()
    }
    if (context) this.transformSessions.commit(context)
    else this.transformSessions.release()
  }

  private onTextEditingExited = ({ target }: { target: FabricObject }) => {
    if (this.syncing || !(target instanceof Textbox)) return
    const nodeId = this.nodeIdByObject.get(target)
    if (!nodeId) return
    const session =
      this.textEditSession?.nodeId === nodeId ? this.textEditSession : null
    const baseline =
      session?.baseline ?? this.textByNodeId.get(nodeId) ?? target.text
    const resolved = resolveTextEditExit(
      baseline,
      target.text,
      session?.cancelled ?? false
    )
    this.clearTextEditSession()
    if (resolved.cancelled) {
      const node = this.nodeByNodeId.get(nodeId)
      setFabricTextboxContent(
        target,
        node?.type === "text"
          ? projectFabricTextState(node).displayText
          : resolved.text,
        "canonical"
      )
      this.textByNodeId.set(nodeId, resolved.text)
      target.setCoords()
      this.canvas?.requestRenderAll()
      return
    }
    const patch = recordTextEdit(this.textByNodeId, nodeId, resolved.text)
    if (!patch) {
      const node = this.nodeByNodeId.get(nodeId)
      if (node?.type === "text") {
        setFabricTextboxContent(
          target,
          projectFabricTextState(node).displayText,
          "canonical"
        )
        target.setCoords()
        this.canvas?.requestRenderAll()
      }
      return
    }
    const accepted = this.events.onNodesChange([
      {
        nodeId,
        patch,
      },
    ])
    if (accepted === false) {
      const settled = settleTextEditCache(
        this.textByNodeId,
        nodeId,
        baseline,
        resolved.text,
        accepted
      )
      const node = this.nodeByNodeId.get(nodeId)
      setFabricTextboxContent(
        target,
        node?.type === "text"
          ? projectFabricTextState(node).displayText
          : settled,
        "canonical"
      )
    } else {
      const node = this.nodeByNodeId.get(nodeId)
      if (node?.type === "text") {
        setFabricTextboxContent(
          target,
          projectFabricTextState({
            ...node,
            text: resolved.text,
          }).displayText,
          "canonical"
        )
      }
    }
    target.setCoords()
    this.canvas?.requestRenderAll()
  }

  private onTextEditingEntered = ({ target }: { target: FabricObject }) => {
    if (!(target instanceof Textbox)) return
    if (target instanceof StudioTextbox) {
      target.setStudioUsesCanonicalLines(false)
    }
    const nodeId = this.nodeIdByObject.get(target)
    if (!nodeId) return
    this.clearTextEditSession()
    this.textEditSession = {
      nodeId,
      target,
      baseline: this.textByNodeId.get(nodeId) ?? target.text,
      cancelled: false,
    }
    target.hiddenTextarea?.addEventListener(
      "keydown",
      this.onTextEditingKeyDown,
      true
    )
  }

  private onTextEditingKeyDown = (event: KeyboardEvent) => {
    const session = this.textEditSession
    if (!session) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cancelTextEditing()
      return
    }
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    const textarea = session.target.hiddenTextarea
    if (!textarea) return
    const edit = resolvePlainTextListKey({
      key: event.key,
      shiftKey: event.shiftKey,
      text: textarea.value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    })
    if (!edit) return

    event.preventDefault()
    event.stopImmediatePropagation()
    if (applyFabricTextListEdit(session.target, edit)) {
      this.canvas?.requestRenderAll()
    }
  }

  private clearTextEditSession() {
    this.textEditSession?.target.hiddenTextarea?.removeEventListener(
      "keydown",
      this.onTextEditingKeyDown,
      true
    )
    this.textEditSession = null
  }
}

export function constrainTextGeometryPatch(
  mode: Extract<SceneNode, { type: "text" }>["sizingMode"],
  patch: Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation">
): Partial<Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation">> {
  if (mode === "fixed") return patch
  const { height: _height, ...withoutHeight } = patch
  if (mode === "auto_height") return withoutHeight
  const { width: _width, ...managedGeometry } = withoutHeight
  return managedGeometry
}

export function applyFabricTextListEdit(
  object: Textbox,
  edit: PlainTextListEdit
): boolean {
  const textarea = object.hiddenTextarea
  if (!textarea) return false
  textarea.value = edit.text
  textarea.selectionStart = edit.selectionStart
  textarea.selectionEnd = edit.selectionEnd
  object.updateFromTextArea()
  return true
}

export type TextEditTransition =
  "select" | "page_change" | "document_replace" | "review_lock"

export function textEditFinalizationPolicy(
  transition: TextEditTransition
): "commit" | "cancel" {
  return transition === "select" || transition === "page_change"
    ? "commit"
    : "cancel"
}

export function shouldPreserveTextEditingSelection(
  editingNodeId: string | null,
  selection: Selection | null
): boolean {
  return (
    editingNodeId !== null &&
    selection?.nodeIds.length === 1 &&
    selection.nodeIds[0] === editingNodeId
  )
}

export function resolveTextEditExit(
  baseline: string,
  nextText: string,
  cancelled: boolean
): { cancelled: boolean; text: string; patch: { text: string } | null } {
  if (cancelled) return { cancelled: true, text: baseline, patch: null }
  return {
    cancelled: false,
    text: nextText,
    patch: textEditPatch(baseline, nextText),
  }
}

export function textEditPatch(
  previousText: string | undefined,
  nextText: string
): { text: string } | null {
  return previousText === nextText ? null : { text: nextText }
}

export function recordTextEdit(
  textByNodeId: Map<string, string>,
  nodeId: string,
  nextText: string
): { text: string } | null {
  const patch = textEditPatch(textByNodeId.get(nodeId), nextText)
  if (patch) textByNodeId.set(nodeId, nextText)
  return patch
}

export function settleTextEditCache(
  textByNodeId: Map<string, string>,
  nodeId: string,
  baseline: string,
  nextText: string,
  accepted: boolean | void
): string {
  const settled = accepted === false ? baseline : nextText
  textByNodeId.set(nodeId, settled)
  return settled
}

export function enterFabricTextEditing(
  canvas: Pick<Canvas, "setActiveObject" | "requestRenderAll">,
  object: FabricObject | undefined
): boolean {
  if (
    !(object instanceof Textbox) ||
    !object.editable ||
    object.lockMovementX ||
    object.lockMovementY
  ) {
    return false
  }

  canvas.setActiveObject(object)
  object.enterEditing()
  object.hiddenTextarea?.focus()
  canvas.requestRenderAll()
  return object.isEditing
}

export function cancelFabricTextEditing(
  object: Textbox,
  baseline: string
): boolean {
  if (!object.isEditing) return false
  const textarea = object.hiddenTextarea
  object.set({ text: baseline })
  if (textarea) textarea.value = baseline
  object.exitEditing()
  textarea?.blur()
  return true
}
