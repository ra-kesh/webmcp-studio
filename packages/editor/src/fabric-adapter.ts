import {
  ActiveSelection,
  Canvas,
  config,
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
  util,
  type TextboxProps,
  type TextStyle,
  type ModifiedEvent,
  type TPointerEvent,
  type TPointerEventInfo,
  type Transform,
  type TOptions,
} from "fabric"
import {
  IMAGE_PLACEMENT_MAX_ZOOM,
  applyTextParagraphStyleToRange,
  applyTextStyleToRange,
  createTextClipboardPayload,
  deriveTextReplacement,
  normalizeTextSelection,
  parseTextClipboardPayload,
  parseTextClipboardHtml,
  patchTextRunStyle,
  pasteParsedTextClipboardPayload,
  projectImagePaint,
  projectFrameClipStack,
  projectNodeForRender,
  projectSvgViewport,
  replaceRichTextRange,
  resolveCornerRadii,
  roundedRectanglePath,
  roundedRectanglePaintPath,
  hasExplicitPaintStack,
  strokeGeometryInset,
  layerEffectFilter,
  resolveTextSelectionStyle,
  resolveTextSelectionStyleAttachment,
  resolveTextSelectionLink,
  resolveTextSelectionParagraphState,
  serializeTextClipboardPayload,
  serializeTextClipboardHtml,
  STUDIO_RICH_TEXT_CLIPBOARD_MIME,
  editTextParagraphListByKey,
  textNodeBaseStyle,
  textRunOverrideAtCaret,
  type Document,
  type BlendMode,
  type ImagePlacement,
  type LayerEffect,
  type RenderImageAffine,
  type RenderImageClip,
  type ProjectedTextLine,
  type ProjectedTextSegment,
  type SceneNode,
  type TextNode,
  type TextRunStyle,
  type TextRunStylePatch,
  type TextParagraphStylePatch,
  type ReplaceRichTextRangeResult,
  type TextSelection,
} from "@webmcp/document"
import type {
  PagePaintBounds,
  PagePaintPlan,
  PagePaintPlanEntry,
} from "@webmcp/document/internal/page-paint-plan"
import {
  isAdmittedAlphaMaskSource,
  isAdmittedVectorMaskSource,
  projectPagePaintPlan,
  supportedMaskPaintPixelRatio,
} from "@webmcp/document/internal/page-paint-plan"

const frameClippedObjects = new WeakSet<FabricObject>()

const usesCornerPath = (node: Extract<SceneNode, { type: "rect" | "frame" }>) =>
  ((node.independentCorners ?? false) && node.cornerRadii !== undefined) ||
  (node.cornerSmoothing ?? 0) > 0

const usesPaintStack = (node: SceneNode) =>
  node.type === "rect" ||
  node.type === "frame" ||
  node.type === "ellipse" ||
  node.type === "line" ||
  node.type === "icon"
    ? hasExplicitPaintStack(node)
    : false

export function syncFabricFrameClip(
  object: FabricObject,
  node: SceneNode,
  document: Document
) {
  const clips = projectFrameClipStack(document, node.id)
  if (clips.length === 0) {
    if (frameClippedObjects.has(object)) {
      object.set({
        clipPath:
          node.type === "text" && node.sizingMode === "fixed"
            ? fixedTextClip(node)
            : undefined,
      })
      frameClippedObjects.delete(object)
    }
    return
  }
  const effectiveClips =
    node.type === "text" && node.sizingMode === "fixed"
      ? [
          {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            radius: 0,
            cornerRadii: {
              topLeft: 0,
              topRight: 0,
              bottomRight: 0,
              bottomLeft: 0,
            },
            cornerSmoothing: 0,
            path: roundedRectanglePath({
              width: node.width,
              height: node.height,
            }),
          },
          ...clips,
        ]
      : clips
  const clipPaths = effectiveClips.map((clip) => {
    const cornerRadii = clip.cornerRadii ?? {
      topLeft: clip.radius,
      topRight: clip.radius,
      bottomRight: clip.radius,
      bottomLeft: clip.radius,
    }
    const cornerSmoothing = clip.cornerSmoothing ?? 0
    const shared = {
      left: clip.x,
      top: clip.y,
      originX: "left",
      originY: "top",
      absolutePositioned: true,
      fill: "#000000",
      strokeWidth: 0,
      selectable: false,
      evented: false,
    } as const
    return cornerSmoothing > 0 || new Set(Object.values(cornerRadii)).size > 1
      ? new Path(
          clip.path ??
            roundedRectanglePath({
              width: clip.width,
              height: clip.height,
              cornerRadii,
              cornerSmoothing,
            }),
          shared
        )
      : new Rect({
          ...shared,
          width: clip.width,
          height: clip.height,
          rx: clip.radius,
          ry: clip.radius,
        })
  })
  for (let index = 0; index < clipPaths.length - 1; index += 1) {
    clipPaths[index]!.set({ clipPath: clipPaths[index + 1] })
  }
  object.set({
    clipPath: clipPaths[0],
  })
  frameClippedObjects.add(object)
}
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
import {
  createFabricLuminanceMaskUnion,
  disposeFabricLuminanceMaskUnion,
  type FabricLuminanceMaskUnion,
} from "./fabric-luminance-mask"

// VBG blue-700 is reserved for focus, selection, and canvas guides.
const SELECTION_COLOR = "#0070f3"
const GUIDE_COLOR = SELECTION_COLOR
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
  studioProjectedLines: readonly ProjectedTextLine[] = []
  studioEditingListMarkers: readonly (string | null)[] = []
  studioDirectClip = false

  constructor(
    text: string,
    options: Props,
    layout: {
      mode: TextSizingMode
      topOffset: number
      lines: readonly ProjectedTextLine[]
      editingListMarkers: readonly (string | null)[]
      directClip: boolean
    }
  ) {
    super("", options)
    this.studioSizingMode = layout.mode
    this.studioTopOffset = layout.topOffset
    this.studioProjectedLines = layout.lines
    this.studioEditingListMarkers = layout.editingListMarkers
    this.studioDirectClip = layout.directClip
    this.text = text
    this.initDimensions()
    this.setCoords()
  }

  override initDimensions() {
    if (
      this.initialized &&
      this.studioUsesCanonicalLines &&
      this.studioProjectedLines.length
    ) {
      this._clearCache()
      this.dynamicMinWidth = 0
      const lines = this.studioProjectedLines.map((line) =>
        line.segments.map((segment) => segment.text).join("")
      )
      this.textLines = lines
      this._textLines = lines.map((line) => [line])
      this._unwrappedTextLines = this._textLines
      this._text = lines.flatMap((line, index) =>
        index < lines.length - 1 ? [line, "\n"] : [line]
      )
      this._styleMap = Object.fromEntries(
        lines.map((_, line) => [line, { line, offset: 0 }])
      )
      this.styles = fabricMetricStylesForLines(this.studioProjectedLines)
      this.__charBounds = []
      this.height = this.calcTextHeight()
      this.dirty = true
      return
    }
    const fixedHeight =
      this.studioSizingMode === "fixed" ? this.height : undefined
    super.initDimensions()
    if (fixedHeight !== undefined && Number.isFinite(fixedHeight)) {
      this.height = fixedHeight
    }
  }

  setStudioTextLayout(
    mode: TextSizingMode,
    topOffset: number,
    lines: readonly ProjectedTextLine[] = [],
    editingListMarkers: readonly (string | null)[] = [],
    reinitialize = true
  ) {
    if (
      this.studioSizingMode === mode &&
      this.studioTopOffset === topOffset &&
      this.studioProjectedLines === lines &&
      this.studioEditingListMarkers === editingListMarkers
    ) {
      if (this.studioUsesCanonicalLines && !this.isEditing) {
        this.styles = fabricMetricStylesForLines(lines)
        this._clearCache()
      }
      return
    }
    this.studioSizingMode = mode
    this.studioTopOffset = topOffset
    this.studioProjectedLines = lines
    this.studioEditingListMarkers = editingListMarkers
    if (this.studioUsesCanonicalLines && !this.isEditing) {
      this.styles = fabricMetricStylesForLines(lines)
      this._clearCache()
    }
    if (reinitialize) this.initDimensions()
    this.dirty = true
  }

  setStudioUsesCanonicalLines(value: boolean, reinitialize = true) {
    if (this.studioUsesCanonicalLines === value) return
    this.studioUsesCanonicalLines = value
    if (reinitialize) this.initDimensions()
    this.dirty = true
  }

  setStudioDirectClip(value: boolean) {
    if (this.studioDirectClip === value) return
    this.studioDirectClip = value
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

  override _getLineLeftOffset(lineIndex: number): number {
    return this.studioUsesCanonicalLines && !this.isEditing
      ? 0
      : super._getLineLeftOffset(lineIndex)
  }

  override getSelectionStartFromPointer(event: TPointerEvent): number {
    // Fabric's draggable-text delegate asks every idle Textbox for a character
    // index before it checks `isEditing`. Idle Studio text is painted from the
    // canonical line projection, which deliberately does not populate
    // Fabric's per-character `__charBounds`; delegating in that state therefore
    // throws before the click can enter editing. Fabric discards this value for
    // idle text, so use its character hit-testing only after editing restores
    // the authored string and normal Textbox layout.
    if (this.studioUsesCanonicalLines && !this.isEditing) return 0
    return super.getSelectionStartFromPointer(event)
  }

  override getHeightOfLine(lineIndex: number): number {
    const projected =
      this.studioUsesCanonicalLines && !this.isEditing
        ? this.studioProjectedLines[lineIndex]
        : undefined
    return projected?.height ?? super.getHeightOfLine(lineIndex)
  }

  override getLineWidth(lineIndex: number): number {
    const projected =
      this.studioUsesCanonicalLines && !this.isEditing
        ? this.studioProjectedLines[lineIndex]
        : undefined
    return projected?.width ?? super.getLineWidth(lineIndex)
  }

  override calcTextHeight(): number {
    if (
      this.studioUsesCanonicalLines &&
      !this.isEditing &&
      this.studioProjectedLines.length
    ) {
      return this.studioProjectedLines.reduce(
        (height, line) => height + line.height,
        0
      )
    }
    return super.calcTextHeight()
  }

  override _render(context: CanvasRenderingContext2D) {
    if (!this.studioDirectClip) {
      super._render(context)
      return
    }
    context.save()
    context.beginPath()
    context.rect(-this.width / 2, -this.height / 2, this.width, this.height)
    context.clip()
    super._render(context)
    context.restore()
  }

  private canonicalLineMeasurements(
    context: CanvasRenderingContext2D,
    line: ProjectedTextLine
  ) {
    const metricCache = new Map<string, number>()
    const segmentWidths = line.segments.map((segment) => {
      const style = fabricStyleForSegment(segment)
      this._setTextStyles(context, style)
      if ("letterSpacing" in context) {
        context.letterSpacing = `${segment.style.letterSpacing}px`
      }
      if ("wordSpacing" in context) {
        context.wordSpacing = `${line.justifySpacing}px`
      }
      const key = [
        context.font,
        segment.style.letterSpacing,
        line.justifySpacing,
        segment.text,
      ].join("\u0000")
      const cached = metricCache.get(key)
      if (cached !== undefined) return cached
      const width = context.measureText(segment.text).width
      metricCache.set(key, width)
      return width
    })
    const lineWidth = segmentWidths.reduce((sum, width) => sum + width, 0)
    const offset =
      line.align === "center"
        ? (this.width - lineWidth) / 2
        : line.align === "right"
          ? this.width - lineWidth
          : 0
    return {
      left: this._getLeftOffset() + offset,
      segmentWidths,
    }
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
      Boolean(this.studioProjectedLines[lineIndex]) &&
      "letterSpacing" in context &&
      (this.studioProjectedLines[lineIndex]?.justifySpacing === 0 ||
        "wordSpacing" in context)
    if (!canRenderCanonicalLine) {
      super._renderChars(method, context, line, left, top, lineIndex)
      return
    }

    const projected = this.studioProjectedLines[lineIndex]
    if (!projected) {
      super._renderChars(method, context, line, left, top, lineIndex)
      return
    }
    context.save()
    context.fontKerning = "normal"
    context.textRendering = "geometricPrecision"
    const measurements = this.canonicalLineMeasurements(context, projected)
    left = measurements.left
    const maxFontSize = Math.max(
      this.fontSize,
      ...projected.segments.map((segment) => segment.style.fontSize)
    )
    top -=
      maxFontSize * FABRIC_TEXT_LINE_HEIGHT_MULTIPLIER * this._fontSizeFraction
    const viewport = this.objectCaching
      ? null
      : localCanvasViewportBounds(
          context.getTransform(),
          context.canvas.width,
          context.canvas.height
        )
    const overdraw = maxFontSize * 2
    const lineTop = top - overdraw
    const lineBottom = top + overdraw
    const lineIsVisible =
      !viewport || (lineBottom >= viewport.top && lineTop <= viewport.bottom)
    for (const [segmentIndex, segment] of projected.segments.entries()) {
      const width = measurements.segmentWidths[segmentIndex] ?? segment.width
      const segmentRight = left + width
      if (
        lineIsVisible &&
        (!viewport ||
          projectedSegmentIntersectsViewport(
            left,
            segmentRight,
            overdraw,
            viewport
          ))
      ) {
        const style = fabricStyleForSegment(segment)
        this._setTextStyles(context, style)
        if ("letterSpacing" in context) {
          context.letterSpacing = `${segment.style.letterSpacing}px`
        }
        if ("wordSpacing" in context) {
          context.wordSpacing = `${projected.justifySpacing}px`
        }
        if (method === "fillText" && style.fill) {
          const fillOffsets = this._setFillStyles(context, style)
          context.fillText(
            segment.text,
            left - fillOffsets.offsetX,
            top - fillOffsets.offsetY
          )
        }
      }
      left = segmentRight
      if (viewport && left - overdraw > viewport.right) break
    }
    context.restore()
  }

  override _renderTextDecoration(
    context: CanvasRenderingContext2D,
    type: "underline" | "linethrough" | "overline"
  ) {
    if (!this.studioUsesCanonicalLines || this.isEditing) {
      super._renderTextDecoration(context, type)
      return
    }
    if (type === "overline") return

    const decoration = type === "linethrough" ? "line_through" : "underline"
    if (
      !this.studioProjectedLines.some((line) =>
        line.segments.some((segment) => segment.style.decoration === decoration)
      )
    ) {
      return
    }
    const offsetAligner = type === "linethrough" ? 0.5 : 0
    const offsetY = this.offsets[type]
    const thickness = (this.fontSize * this.textDecorationThickness) / 1000
    let topOffset = this._getTopOffset()

    context.save()
    const viewport = this.objectCaching
      ? null
      : localCanvasViewportBounds(
          context.getTransform(),
          context.canvas.width,
          context.canvas.height
        )
    for (const line of this.studioProjectedLines) {
      const measurements = this.canonicalLineMeasurements(context, line)
      const top =
        topOffset +
        (line.height / this.lineHeight) * (1 - this._fontSizeFraction)
      let left = measurements.left
      const lineIsVisible =
        !viewport ||
        (top + line.height >= viewport.top && top <= viewport.bottom)
      for (const [segmentIndex, segment] of line.segments.entries()) {
        const width = measurements.segmentWidths[segmentIndex] ?? segment.width
        const segmentRight = left + width
        if (
          lineIsVisible &&
          segment.style.decoration === decoration &&
          width > 0 &&
          (!viewport ||
            (segmentRight >= viewport.left && left <= viewport.right))
        ) {
          context.fillStyle = segment.style.color
          context.fillRect(
            left,
            top + offsetY * segment.style.fontSize - offsetAligner * thickness,
            width,
            thickness
          )
        }
        left = segmentRight
        if (viewport && left > viewport.right) break
      }
      topOffset += line.height
      if (viewport && topOffset > viewport.bottom) break
    }
    context.restore()
    this._removeShadow(context)
  }

  /**
   * Direct editing uses the authored string so Fabric's hidden textarea and
   * caret offsets never contain synthetic list markers. Draw those markers on
   * the live canvas after Fabric has rendered the textbox cache/clip path.
   * Rendering inside `_renderChars` would crop a hanging marker at the object
   * cache boundary (and fixed text clip paths), which makes the marker vanish
   * precisely while the user is editing it.
   */
  renderEditingListMarkers(context: CanvasRenderingContext2D) {
    if (
      !this.isEditing ||
      !this.studioEditingListMarkers.some(Boolean) ||
      this.isNotVisible()
    ) {
      return
    }

    context.save()
    this._setOpacity(context)

    const leftOffset = this._getLeftOffset()
    const topOffset = this._getTopOffset()
    let accumulatedLineHeight = 0
    for (let lineIndex = 0; lineIndex < this._textLines.length; lineIndex++) {
      const map = this._styleMap?.[lineIndex]
      const sourceLine = map?.line ?? lineIndex
      const marker =
        (map?.offset ?? 0) === 0
          ? this.studioEditingListMarkers[sourceLine]
          : null
      const lineHeight = this.getHeightOfLine(lineIndex)
      if (!marker) {
        accumulatedLineHeight += lineHeight
        continue
      }

      const style = this.getCompleteStyleDeclaration(lineIndex, 0)
      this._setTextStyles(context, style)
      const markerWidth = context.measureText(marker).width
      const markerLeft =
        leftOffset + this._getLineLeftOffset(lineIndex) - markerWidth
      const unscaledLineHeight = lineHeight / this.lineHeight
      const markerTop =
        topOffset +
        accumulatedLineHeight +
        unscaledLineHeight -
        unscaledLineHeight * this._fontSizeFraction
      if (typeof style.fill === "string" && style.fill) {
        context.fillStyle = style.fill
        context.fillText(marker, markerLeft, markerTop)
      }
      if (
        typeof style.stroke === "string" &&
        style.stroke &&
        style.strokeWidth
      ) {
        context.strokeStyle = style.stroke
        context.lineWidth = style.strokeWidth
        context.strokeText(marker, markerLeft, markerTop)
      }
      accumulatedLineHeight += lineHeight
    }
    context.restore()
  }

  override renderCursorOrSelection() {
    super.renderCursorOrSelection()
    const canvas = this.canvas
    if (!canvas || !this.isEditing) return
    const context = canvas.contextTop
    const viewport = canvas.viewportTransform
    context.save()
    context.transform(
      viewport[0],
      viewport[1],
      viewport[2],
      viewport[3],
      viewport[4],
      viewport[5]
    )
    this.transform(context)
    this.renderEditingListMarkers(context)
    context.restore()
    canvas.contextTopDirty = true
  }
}

function setFabricTextboxContent(
  object: Textbox,
  text: string,
  content: "canonical" | "editing",
  styles?: TextStyle
) {
  if (object instanceof StudioTextbox) {
    object.setStudioUsesCanonicalLines(content === "canonical", false)
  }
  object.set({ text, ...(styles ? { styles } : {}) })
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

function sharedOptions(
  node: SceneNode,
  frame = projectNodeForRender(node).frame
) {
  return {
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    angle: frame.rotation,
    skewX: 0,
    skewY: 0,
    flipX: node.flipX ?? false,
    flipY: node.flipY ?? false,
    opacity: frame.opacity,
    globalCompositeOperation: fabricBlendMode(frame.blendMode),
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

export function fabricBlendMode(
  blendMode: BlendMode
): GlobalCompositeOperation {
  return blendMode === "normal" ? "source-over" : blendMode
}

function borderedShapeDimensions(
  node: Extract<SceneNode, { type: "rect" | "ellipse" | "frame" }>
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
  let sourceStart = 0
  const editingListMarkers = node.text.split("\n").map((paragraph) => {
    const line = projection.content.layout.lines.find(
      (candidate) =>
        candidate.sourceStart === sourceStart &&
        candidate.segments.some((segment) => segment.synthetic)
    )
    const marker = line?.segments
      .filter((segment) => segment.synthetic)
      .map((segment) => segment.text)
      .join("")
    sourceStart += paragraph.length + 1
    return marker || null
  })
  return {
    frame: projection.frame,
    text: projection.content.text,
    displayText: projection.content.displayText,
    get editingStyles() {
      return projectFabricTextEditingStyles(node)
    },
    width: projection.frame.width,
    height: projection.frame.height,
    fill: projection.content.color,
    fontFamily: projection.content.fontFamily,
    fontSize: projection.content.fontSize,
    fontWeight: projection.content.fontWeight,
    fontStyle: node.italic ? ("italic" as const) : ("normal" as const),
    underline: node.decoration === "underline",
    linethrough: node.decoration === "line_through",
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
    layoutLines: projection.content.layout.lines,
    editingListMarkers,
  }
}

/**
 * Direct editing consumes the authored string on one explicit source line per
 * paragraph. Keep that projection separate from idle canvas rendering so a
 * paste or keystroke does not also build the canonical display style map.
 */
export function projectFabricTextEditingStyles(
  node: Extract<SceneNode, { type: "text" }>
) {
  const projection = projectNodeForRender({
    ...node,
    paragraphs: [],
    sizingMode: "auto_width",
  })
  if (projection.type !== "text") {
    throw new Error("Expected editing text projection")
  }
  return fabricStylesForLines(projection.content.layout.lines)
}

/**
 * Exact constructor contract for the Fabric text object. Keeping this pure
 * lets conformance tests verify every resolved option without pretending that
 * Fabric's browser-owned Textbox constructor is a Node primitive.
 */
export function fabricTextObjectOptions(
  node: Extract<SceneNode, { type: "text" }>,
  projection = projectFabricTextState(node)
) {
  const objectCaching = shouldUseFabricTextObjectCache(
    projection.width,
    projection.height
  )
  return {
    ...sharedOptions(node, projection.frame),
    fill: projection.fill,
    fontFamily: projection.fontFamily,
    fontSize: projection.fontSize,
    fontWeight: projection.fontWeight,
    fontStyle: projection.fontStyle,
    underline: projection.underline,
    linethrough: projection.linethrough,
    textAlign: projection.textAlign,
    lineHeight: projection.lineHeight,
    charSpacing: projection.charSpacing,
    styles: {},
    splitByGrapheme: false,
    editable: !node.locked,
    strokeWidth: 0,
    objectCaching,
    clipPath: objectCaching ? fixedTextClip(node) : undefined,
  }
}

export function shouldUseFabricTextObjectCache(width: number, height: number) {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= config.maxCacheSideLimit &&
    height <= config.maxCacheSideLimit &&
    width * height <= config.perfLimitSizeTotal
  )
}

type CanvasTransformLike = Readonly<{
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}>

export function localCanvasViewportBounds(
  transform: CanvasTransformLike,
  canvasWidth: number,
  canvasHeight: number
) {
  const determinant = transform.a * transform.d - transform.b * transform.c
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) < Number.EPSILON ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return null
  }
  const toLocal = (x: number, y: number) => ({
    x:
      (transform.d * (x - transform.e) - transform.c * (y - transform.f)) /
      determinant,
    y:
      (-transform.b * (x - transform.e) + transform.a * (y - transform.f)) /
      determinant,
  })
  const corners = [
    toLocal(0, 0),
    toLocal(canvasWidth, 0),
    toLocal(0, canvasHeight),
    toLocal(canvasWidth, canvasHeight),
  ]
  return {
    left: Math.min(...corners.map((point) => point.x)),
    right: Math.max(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    bottom: Math.max(...corners.map((point) => point.y)),
  }
}

export function projectedSegmentIntersectsViewport(
  left: number,
  right: number,
  overdraw: number,
  viewport: Readonly<{ left: number; right: number }>
) {
  const margin = Math.max(0, overdraw)
  return right + margin >= viewport.left && left - margin <= viewport.right
}

/**
 * Convert an offset in the idle render projection back to the authored text.
 * Synthetic list markers and soft-wrap newlines do not exist in the canonical
 * string, so direct editing must collapse them onto the nearest source caret.
 */
export function projectedTextOffsetToSource(
  lines: readonly ProjectedTextLine[],
  offset: number
): number {
  const target = Math.max(0, offset)
  let displayOffset = 0
  let lastSourceOffset = 0

  for (const [lineIndex, line] of lines.entries()) {
    for (const segment of line.segments) {
      const segmentEnd = displayOffset + segment.text.length
      if (target <= segmentEnd) {
        if (segment.synthetic) return segment.sourceStart
        return Math.min(
          segment.sourceEnd,
          segment.sourceStart + Math.max(0, target - displayOffset)
        )
      }
      displayOffset = segmentEnd
      lastSourceOffset = segment.sourceEnd
    }

    if (lineIndex < lines.length - 1) {
      if (target <= displayOffset + 1) return line.sourceEnd
      displayOffset += 1
    }
  }

  return lastSourceOffset
}

type ClipboardData = Pick<DataTransfer, "getData" | "setData">

export function writeTextEditingClipboardData(
  clipboard: ClipboardData,
  node: TextNode,
  selection: TextSelection
) {
  const payload = createTextClipboardPayload(node, selection)
  if (!payload) return false
  clipboard.setData("text/plain", payload.text)
  clipboard.setData("text/html", serializeTextClipboardHtml(payload))
  try {
    clipboard.setData(
      STUDIO_RICH_TEXT_CLIPBOARD_MIME,
      serializeTextClipboardPayload(payload)
    )
  } catch {
    // Browsers may reject custom MIME types; text/plain remains usable.
  }
  return true
}

export function readTextEditingClipboardData(
  clipboard: ClipboardData,
  pasteAsPlain = false
) {
  const plainText = clipboard.getData("text/plain").replace(/\r\n?/g, "\n")
  if (!pasteAsPlain) {
    const payload =
      parseTextClipboardPayload(
        clipboard.getData(STUDIO_RICH_TEXT_CLIPBOARD_MIME)
      ) ?? parseTextClipboardHtml(clipboard.getData("text/html"))
    if (payload) return { kind: "rich" as const, payload }
  }
  return plainText ? { kind: "plain" as const, text: plainText } : null
}

function fabricStyleForSegment(segment: ProjectedTextSegment) {
  return {
    fill: segment.style.color,
    fontFamily: segment.style.fontFamily,
    fontSize: segment.style.fontSize,
    fontWeight: segment.style.fontWeight,
    fontStyle: segment.style.italic ? "italic" : "normal",
    underline: segment.style.decoration === "underline",
    linethrough: segment.style.decoration === "line_through",
  } satisfies TextStyle[number][number]
}

function fabricMetricStylesForLines(
  lines: readonly ProjectedTextLine[]
): TextStyle {
  const styles: TextStyle = {}
  for (const [lineIndex, line] of lines.entries()) {
    const maxMetricSegment = line.segments.reduce<ProjectedTextSegment | null>(
      (current, segment) =>
        !current || segment.style.fontSize > current.style.fontSize
          ? segment
          : current,
      null
    )
    if (maxMetricSegment) {
      // Canonical _textLines stores one whole-line token. Fabric's private
      // baseline calculation therefore reads only style index 0; retain the
      // line's maximum metric there while projected segments own actual paint.
      styles[lineIndex] = { 0: fabricStyleForSegment(maxMetricSegment) }
    }
  }
  return styles
}

function fabricStylesForLines(lines: readonly ProjectedTextLine[]): TextStyle {
  const styles: TextStyle = {}
  for (const [lineIndex, line] of lines.entries()) {
    let charIndex = 0
    for (const segment of line.segments) {
      const glyphs = Array.from(segment.text)
      if (segment.styled) {
        const style = fabricStyleForSegment(segment)
        styles[lineIndex] ??= {}
        for (let offset = 0; offset < glyphs.length; offset += 1) {
          styles[lineIndex]![charIndex + offset] = style
        }
      }
      charIndex += glyphs.length
    }
  }
  return styles
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

class EffectGroup extends Group {
  effectFilter = ""

  setEffectFilter(effects: readonly LayerEffect[] | undefined) {
    this.effectFilter = layerEffectFilter(effects)
    this.dirty = true
  }

  override _render(context: CanvasRenderingContext2D) {
    const previousFilter = context.filter
    context.filter = this.effectFilter || "none"
    super._render(context)
    context.filter = previousFilter
  }
}

const wrapFabricEffects = <T extends FabricObject>(
  object: T,
  node: SceneNode
): T | EffectGroup => {
  if (!node.effects?.some((effect) => effect.visible)) return object
  object.set({
    left: 0,
    top: 0,
    angle: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    globalCompositeOperation: "source-over",
    visible: true,
    selectable: false,
    evented: false,
  })
  const group = new EffectGroup([object], {
    ...sharedOptions(node),
    width: node.width,
    height: node.height,
    subTargetCheck: false,
  })
  group.setEffectFilter(node.effects)
  return group
}

export function createFabricSyncObject(
  node: Exclude<SceneNode, { type: "image" }>
): FabricObject {
  if (node.effects?.some((effect) => effect.visible)) {
    const inner: FabricObject = createFabricSyncObject({
      ...node,
      effects: undefined,
      x: 0,
      y: 0,
      rotation: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      blendMode: "normal",
      visible: true,
      locked: true,
    } as Exclude<SceneNode, { type: "image" }>)
    return wrapFabricEffects(inner, node)
  }
  if (usesPaintStack(node)) {
    const projection = projectNodeForRender(node)
    if (projection.type === "text" || projection.type === "image") {
      throw new Error(`Paint stacks require shape geometry`)
    }
    const legacyStrokeWidth = "strokeWidth" in node ? node.strokeWidth : 0
    const frame = new Rect({
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
    const children: FabricObject[] = [frame]
    const addPaint = (
      paint: {
        color: string
        opacity: number
        visible: boolean
        blendMode: BlendMode
        width?: number
        alignment?: "inside" | "center" | "outside"
        sides?: { top: boolean; right: boolean; bottom: boolean; left: boolean }
        dash?: number[]
        cap?: "butt" | "round" | "square"
        join?: "miter" | "round" | "bevel"
        miterLimit?: number
      },
      kind: "fill" | "stroke"
    ) => {
      const strokeWidth = paint.width ?? legacyStrokeWidth
      if (
        kind === "stroke" &&
        (node.type === "rect" || node.type === "frame") &&
        paint.sides &&
        !Object.values(paint.sides).every(Boolean)
      ) {
        const inset = strokeGeometryInset({
          width: strokeWidth,
          alignment: paint.alignment,
        })
        const x1 = inset
        const y1 = inset
        const x2 = node.width - inset
        const y2 = node.height - inset
        const options = {
          stroke: paint.color,
          strokeWidth,
          opacity: paint.opacity,
          visible: paint.visible,
          globalCompositeOperation: fabricBlendMode(paint.blendMode),
          strokeDashArray: paint.dash,
          strokeLineCap: paint.cap,
          strokeLineJoin: paint.join,
          strokeMiterLimit: paint.miterLimit,
          selectable: false,
          evented: false,
        }
        if (paint.sides.top) children.push(new Line([x1, y1, x2, y1], options))
        if (paint.sides.right)
          children.push(new Line([x2, y1, x2, y2], options))
        if (paint.sides.bottom)
          children.push(new Line([x2, y2, x1, y2], options))
        if (paint.sides.left) children.push(new Line([x1, y2, x1, y1], options))
        return
      }
      const geometryOffset =
        kind === "stroke" && node.type !== "line" && node.type !== "icon"
          ? strokeGeometryInset({
              width: strokeWidth,
              alignment: paint.alignment,
            }) -
            strokeWidth / 2
          : 0
      const synthetic = {
        ...node,
        x: geometryOffset,
        y: geometryOffset,
        width: node.width - geometryOffset * 2,
        height: node.height - geometryOffset * 2,
        rotation: 0,
        flipX: false,
        flipY: false,
        opacity: paint.opacity,
        blendMode: paint.blendMode,
        visible: paint.visible,
        fills: undefined,
        strokes: undefined,
        ...(node.type === "line"
          ? {
              stroke: paint.color,
              strokeWidth,
            }
          : kind === "fill"
            ? { fill: paint.color, stroke: undefined, strokeWidth: 0 }
            : {
                fill: "rgba(0,0,0,0)",
                stroke: paint.color,
                strokeWidth,
              }),
      } as Exclude<SceneNode, { type: "image" }>
      const child = createFabricSyncObject(synthetic)
      child.set({
        selectable: false,
        evented: false,
        ...(kind === "stroke"
          ? {
              strokeDashArray: paint.dash,
              strokeLineCap: paint.cap,
              strokeLineJoin: paint.join,
              strokeMiterLimit: paint.miterLimit,
            }
          : {}),
      })
      children.push(child)
    }
    if (projection.type !== "line") {
      projection.content.fills.forEach((paint) => addPaint(paint, "fill"))
    }
    projection.content.strokes.forEach((paint) => addPaint(paint, "stroke"))
    return new Group(children, {
      ...sharedOptions(node),
      width: node.width,
      height: node.height,
      subTargetCheck: false,
    })
  }
  if (node.type === "rect" || node.type === "frame") {
    const dimensions = borderedShapeDimensions(node)
    if (usesCornerPath(node)) {
      const radii = resolveCornerRadii(
        node.radius,
        node.independentCorners ? node.cornerRadii : undefined
      )
      return new Path(
        roundedRectanglePaintPath({
          width: node.width,
          height: node.height,
          cornerRadii: radii,
          cornerSmoothing: node.cornerSmoothing ?? 0,
          strokeWidth: dimensions.strokeWidth,
        }),
        {
          ...sharedOptions(node),
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: dimensions.strokeWidth,
        }
      )
    }
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
  const textOptions = fabricTextObjectOptions(node, projection)
  const text = new StudioTextbox(
    projection.displayText,
    {
      ...textOptions,
    },
    {
      mode: node.sizingMode,
      topOffset: projection.topOffset,
      lines: projection.layoutLines,
      editingListMarkers: projection.editingListMarkers,
      directClip: node.sizingMode === "fixed" && !textOptions.objectCaching,
    }
  )
  text.set({ width: node.width, height: node.height })
  text.set({ height: node.height })
  positionFixedTextboxFrame(text, node)
  applyFabricTextControlPolicy(text, node)
  return text
}

/**
 * The deliberately narrow Fabric-side vector consumer used by both the
 * retained oracle and canonical document synchronization. Callers provide
 * detached content objects; the resulting cache/composite is adapter-owned and
 * must never be serialized as canonical mask state.
 *
 * Fabric groups use a centre-local child coordinate space even when their own
 * origin is top-left. The helper moves each page-positioned child into that
 * space. The mask is the final child and paints with destination-in inside the
 * group's bounded cache, so its opacity remains meaningful and cannot affect
 * the rest of the canvas.
 */
export type FabricVectorMaskPaint =
  | Readonly<{
      kind: "fallthrough"
      objects: readonly FabricObject[]
    }>
  | Readonly<{
      kind: "composite"
      object: Group
      maskObject: FabricObject
      sourceObjects: ReadonlyMap<string, FabricObject>
    }>

export type FabricAlphaMaskPaint = FabricVectorMaskPaint
export type FabricLuminanceMaskPaint = FabricVectorMaskPaint

class FabricMaskGroup extends Group {
  override needsItsOwnCache() {
    return true
  }
}

function createFabricVectorMaskObject(
  source: Extract<SceneNode, { type: "rect" | "ellipse" | "icon" }>
) {
  const object = createFabricSyncObject(source)
  applyFabricVectorMaskSourcePaint(object, source)
  return object
}

function applyFabricVectorMaskSourcePaint(
  object: FabricObject,
  source: Extract<SceneNode, { type: "rect" | "ellipse" | "icon" }>
) {
  if (
    object instanceof Rect ||
    object instanceof Ellipse ||
    object instanceof Path
  ) {
    object.set({ fill: "#000000", stroke: undefined, strokeWidth: 0 })
  } else if (object instanceof Group) {
    for (const child of object.getObjects()) {
      if (child instanceof Path) {
        child.set({ fill: "#000000", stroke: undefined, strokeWidth: 0 })
      }
    }
  }
  object.set({
    opacity: source.opacity,
    globalCompositeOperation: "source-over",
    selectable: false,
    evented: false,
  })
  object.setCoords()
}

function createFabricMaskSourceUnion(
  sourceObjects: readonly FabricObject[],
  bounds: PagePaintBounds
) {
  if (sourceObjects.length === 1) {
    const source = sourceObjects[0]!
    applyFabricAlphaMaskPaint(source)
    return source
  }
  const pageTransforms = new Map(
    sourceObjects.map(
      (source) => [source, source.calcTransformMatrix()] as const
    )
  )
  const union = new FabricMaskGroup([...sourceObjects], {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    originX: "left",
    originY: "top",
    layoutManager: new LayoutManager(new FixedLayout()),
    objectCaching: true,
    selectable: false,
    evented: false,
  })
  preserveFabricChildPageTransforms(union, pageTransforms)
  applyFabricAlphaMaskPaint(union)
  return union
}

function applyFabricAlphaMaskPaint(object: FabricObject) {
  object.set({
    globalCompositeOperation: "destination-in",
    selectable: false,
    evented: false,
  })
  object.setCoords()
}

function applyFabricAlphaMaskSourcePaint(object: FabricObject) {
  object.set({
    globalCompositeOperation: "source-over",
    selectable: false,
    evented: false,
  })
  object.setCoords()
}

function pagePaintPlanIdentity(plan: PagePaintPlan) {
  const entryIdentity = (entry: PagePaintPlanEntry): unknown =>
    entry.kind === "node"
      ? ["node", entry.nodeId]
      : [
          "mask",
          entry.groupId,
          entry.maskType,
          entry.sourceNodeIds,
          entry.visibleSourceNodeIds,
          entry.content.map(entryIdentity),
          entry.bounds,
          entry.outputBounds,
          entry.maskEnabled,
          entry.compositeRequired,
        ]
  return JSON.stringify(plan.entries.map(entryIdentity))
}

type FabricMaskGroupEntry = Extract<PagePaintPlanEntry, { kind: "mask_group" }>

function visitFabricMaskEntries(
  entries: readonly PagePaintPlanEntry[],
  visit: (entry: FabricMaskGroupEntry) => void
) {
  for (const entry of entries) {
    if (entry.kind !== "mask_group") continue
    visitFabricMaskEntries(entry.content, visit)
    visit(entry)
  }
}

function disposeFabricObjectForest(objects: Iterable<FabricObject>) {
  const owned = new Set(objects)
  for (const object of owned) {
    // Fabric Group.dispose() recursively owns its children. Dispose only roots
    // in this candidate forest so every retained object receives one cleanup.
    if (object.group && owned.has(object.group)) continue
    if (typeof document === "undefined") {
      try {
        object.dispose()
      } catch {
        // Fabric image disposal reaches the browser document. Headless unit
        // fixtures have no DOM resource to release.
      }
    } else {
      object.dispose()
    }
  }
}

function preserveFabricChildPageTransforms(
  group: Group,
  pageTransforms: ReadonlyMap<
    FabricObject,
    ReturnType<FabricObject["calcTransformMatrix"]>
  >
) {
  const inverseGroupTransform = util.invertTransform(
    group.calcTransformMatrix()
  )
  for (const [child, pageTransform] of pageTransforms) {
    util.applyTransformToObject(
      child,
      util.multiplyTransformMatrices(inverseGroupTransform, pageTransform)
    )
    child.setCoords()
  }
  group.set({ dirty: true })
  group.setCoords()
}

function preserveFabricObjectPageTransformAfterSync(object: FabricObject) {
  if (!object.group) return
  util.applyTransformToObject(
    object,
    util.multiplyTransformMatrices(
      util.invertTransform(object.group.calcTransformMatrix()),
      object.calcOwnMatrix()
    )
  )
  object.setCoords()
}

function markFabricObjectAncestorsDirty(object: FabricObject) {
  let parent = object.group
  while (parent) {
    parent.set({ dirty: true })
    parent = parent.group
  }
}

function createFabricMaskComposite(
  entry: FabricMaskGroupEntry,
  contentObjects: readonly FabricObject[],
  maskObject: FabricObject
) {
  const children = [...contentObjects, maskObject]
  const pageTransforms = new Map(
    children.map((child) => [child, child.calcTransformMatrix()] as const)
  )
  const object = new FabricMaskGroup(children, {
    left: entry.bounds.x,
    top: entry.bounds.y,
    width: entry.bounds.width,
    height: entry.bounds.height,
    originX: "left",
    originY: "top",
    layoutManager: new LayoutManager(new FixedLayout()),
    objectCaching: true,
    selectable: false,
    evented: true,
    interactive: true,
    subTargetCheck: true,
    hasControls: false,
  })
  preserveFabricChildPageTransforms(object, pageTransforms)
  return object
}

export function createFabricVectorMaskPaint(
  entry: Extract<PagePaintPlanEntry, { kind: "mask_group" }>,
  nodesById: ReadonlyMap<string, SceneNode>,
  createContentObject: (node: SceneNode) => FabricObject
): FabricVectorMaskPaint {
  if (entry.maskType !== "vector") {
    throw new Error("Fabric only supports admitted vector mask paint entries")
  }

  const contentNodes = entry.content.map((content) => {
    if (content.kind !== "node") {
      throw new Error("Fabric vector masks do not support nested composites")
    }
    const node = nodesById.get(content.nodeId)
    if (!node) {
      throw new Error(`Fabric mask content ${content.nodeId} is missing`)
    }
    return node
  })
  return createFabricVectorMaskPaintFromObjects(
    entry,
    nodesById,
    contentNodes.map(createContentObject)
  )
}

function createFabricVectorMaskPaintFromObjects(
  entry: FabricMaskGroupEntry,
  nodesById: ReadonlyMap<string, SceneNode>,
  contentObjects: readonly FabricObject[]
): FabricVectorMaskPaint {
  if (entry.maskType !== "vector") {
    throw new Error("Fabric only supports admitted vector mask paint entries")
  }

  // A hidden source explicitly falls through to normal content paint. Do not
  // allocate a Group (and therefore no bounded offscreen cache) in this case.
  if (!entry.compositeRequired) {
    return { kind: "fallthrough", objects: contentObjects }
  }

  const sources = entry.sourceNodeIds.flatMap((sourceNodeId) => {
    if (!entry.visibleSourceNodeIds.includes(sourceNodeId)) return []
    const source = nodesById.get(sourceNodeId)
    return isAdmittedVectorMaskSource(source) ? [source] : []
  })
  if (sources.length !== entry.visibleSourceNodeIds.length) {
    throw new Error(
      "Fabric vector masks require visible rectangle, ellipse, or icon sources"
    )
  }
  assertFabricMaskBounds(entry.bounds)

  const sourceObjects = new Map<string, FabricObject>()
  for (const source of sources) {
    const object = createFabricVectorMaskObject(source)
    sourceObjects.set(source.id, object)
  }
  const maskObject = createFabricMaskSourceUnion(
    [...sourceObjects.values()],
    entry.bounds
  )
  // Detached objects are page-positioned. Convert them to the fixed
  // composite's centre-local coordinates without changing their own affine
  // properties or canonical node geometry.
  const object = createFabricMaskComposite(entry, contentObjects, maskObject)
  return { kind: "composite", object, maskObject, sourceObjects }
}

/**
 * Builds an alpha composite from the source's ordinary rendered pixels. Image
 * placement/frame clipping and text glyph layout therefore stay identical to
 * normal Fabric paint; only the final blend operation changes.
 */
export function createFabricAlphaMaskPaint(
  entry: Extract<PagePaintPlanEntry, { kind: "mask_group" }>,
  nodesById: ReadonlyMap<string, SceneNode>,
  createContentObject: (node: SceneNode) => FabricObject,
  createSourceObject: (node: SceneNode) => FabricObject
): FabricAlphaMaskPaint {
  if (entry.maskType !== "alpha") {
    throw new Error("Fabric alpha paint requires an alpha mask group entry")
  }
  const contentNodes = entry.content.map((content) => {
    if (content.kind !== "node") {
      throw new Error("Fabric alpha masks do not support nested composites")
    }
    const node = nodesById.get(content.nodeId)
    if (!node)
      throw new Error(`Fabric mask content ${content.nodeId} is missing`)
    return node
  })
  return createFabricAlphaMaskPaintFromObjects(
    entry,
    nodesById,
    contentNodes.map(createContentObject),
    createSourceObject
  )
}

function createFabricAlphaMaskPaintFromObjects(
  entry: FabricMaskGroupEntry,
  nodesById: ReadonlyMap<string, SceneNode>,
  contentObjects: readonly FabricObject[],
  createSourceObject: (node: SceneNode) => FabricObject
): FabricAlphaMaskPaint {
  if (entry.maskType !== "alpha") {
    throw new Error("Fabric alpha paint requires an alpha mask group entry")
  }
  if (!entry.compositeRequired) {
    return { kind: "fallthrough", objects: contentObjects }
  }

  const sources = entry.sourceNodeIds.flatMap((sourceNodeId) => {
    if (!entry.visibleSourceNodeIds.includes(sourceNodeId)) return []
    const source = nodesById.get(sourceNodeId)
    return isAdmittedAlphaMaskSource(source) ? [source] : []
  })
  if (sources.length !== entry.visibleSourceNodeIds.length) {
    throw new Error(
      "Fabric alpha masks require visible rectangle, ellipse, icon, image, or text sources"
    )
  }
  assertFabricMaskBounds(entry.bounds)
  const sourceObjects = new Map<string, FabricObject>()
  for (const source of sources) {
    const sourceObject = createSourceObject(source)
    if (isMissingImagePlaceholder(sourceObject)) {
      throw new Error(`Fabric alpha mask source ${source.id} is unavailable`)
    }
    sourceObjects.set(source.id, sourceObject)
  }
  const maskObject = createFabricMaskSourceUnion(
    [...sourceObjects.values()],
    entry.bounds
  )
  const object = createFabricMaskComposite(entry, contentObjects, maskObject)
  return { kind: "composite", object, maskObject, sourceObjects }
}

/**
 * Builds a luminance composite from a precomputed bounded sRGB raster union.
 * The expensive/readback-sensitive conversion is deliberately supplied by the
 * caller so the mounted adapter can complete it before replacing last-valid
 * canvas pixels.
 */
export function createFabricLuminanceMaskPaint(
  entry: Extract<PagePaintPlanEntry, { kind: "mask_group" }>,
  nodesById: ReadonlyMap<string, SceneNode>,
  createContentObject: (node: SceneNode) => FabricObject,
  preparedUnion?: FabricLuminanceMaskUnion
): FabricLuminanceMaskPaint {
  if (entry.maskType !== "luminance") {
    throw new Error(
      "Fabric luminance paint requires a luminance mask group entry"
    )
  }
  const contentNodes = entry.content.map((content) => {
    if (content.kind !== "node") {
      throw new Error("Fabric luminance masks do not support nested composites")
    }
    const node = nodesById.get(content.nodeId)
    if (!node) {
      throw new Error(`Fabric mask content ${content.nodeId} is missing`)
    }
    return node
  })
  return createFabricLuminanceMaskPaintFromObjects(
    entry,
    nodesById,
    contentNodes.map(createContentObject),
    preparedUnion
  )
}

function createFabricLuminanceMaskPaintFromObjects(
  entry: FabricMaskGroupEntry,
  nodesById: ReadonlyMap<string, SceneNode>,
  contentObjects: readonly FabricObject[],
  preparedUnion?: FabricLuminanceMaskUnion
): FabricLuminanceMaskPaint {
  if (entry.maskType !== "luminance") {
    throw new Error(
      "Fabric luminance paint requires a luminance mask group entry"
    )
  }
  if (!entry.compositeRequired) {
    return { kind: "fallthrough", objects: contentObjects }
  }

  const sources = entry.sourceNodeIds.flatMap((sourceNodeId) => {
    if (!entry.visibleSourceNodeIds.includes(sourceNodeId)) return []
    const source = nodesById.get(sourceNodeId)
    return isAdmittedAlphaMaskSource(source) ? [source] : []
  })
  if (sources.length !== entry.visibleSourceNodeIds.length) {
    throw new Error(
      "Fabric luminance masks require visible rectangle, ellipse, icon, image, or text sources"
    )
  }
  assertFabricMaskBounds(entry.bounds)
  if (!preparedUnion) {
    throw new Error(
      `Fabric luminance mask ${entry.groupId} has not completed conversion`
    )
  }

  const maskObject = preparedUnion.maskObject
  const object = createFabricMaskComposite(entry, contentObjects, maskObject)
  return {
    kind: "composite",
    object,
    maskObject,
    sourceObjects: preparedUnion.sourceObjects,
  }
}

function assertFabricMaskBounds(bounds: PagePaintBounds) {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error("Fabric mask composite bounds must be finite and positive")
  }
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
  const shorterEdge = Math.min(node.width, node.height)
  const normalizedRadii = node.frameMask.cornerRadii ?? {
    topLeft: node.frameMask.radius,
    topRight: node.frameMask.radius,
    bottomRight: node.frameMask.radius,
    bottomLeft: node.frameMask.radius,
  }
  const left = x < node.width / 2
  const top = y < node.height / 2
  const radius =
    (top
      ? left
        ? normalizedRadii.topLeft
        : normalizedRadii.topRight
      : left
        ? normalizedRadii.bottomLeft
        : normalizedRadii.bottomRight) * shorterEdge
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
  if (
    clip.shape === "rounded_rectangle" &&
    clip.cornerRadii &&
    ((clip.cornerSmoothing ?? 0) > 0 ||
      new Set(Object.values(clip.cornerRadii)).size > 1)
  ) {
    return new Path(
      roundedRectanglePath({
        width: clip.width,
        height: clip.height,
        cornerRadii: clip.cornerRadii,
        cornerSmoothing: clip.cornerSmoothing ?? 0,
      }),
      shared
    )
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
  return wrapFabricEffects(group, node)
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
  const textProjection =
    node.type === "text" ? projectFabricTextState(node) : null
  const options: Record<string, unknown> = {
    ...sharedOptions(node, textProjection?.frame),
    scaleX: 1,
    scaleY: 1,
  }

  if (
    (node.type === "rect" || node.type === "frame") &&
    object instanceof Path &&
    usesCornerPath(node)
  ) {
    const replacement = createFabricSyncObject(node)
    if (!(replacement instanceof Path)) return
    Object.assign(options, {
      path: replacement.path,
      pathOffset: replacement.pathOffset,
      width: replacement.width,
      height: replacement.height,
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.stroke ? node.strokeWidth : 0,
    })
  } else if (
    (node.type === "rect" || node.type === "frame") &&
    object instanceof Rect
  ) {
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
    const text = textProjection
    if (!text) return
    const objectCaching = shouldUseFabricTextObjectCache(
      text.width,
      text.height
    )
    if (object instanceof StudioTextbox) {
      object.setStudioDirectClip(node.sizingMode === "fixed" && !objectCaching)
    }
    if (!object.isEditing) {
      if (object instanceof StudioTextbox) {
        object.setStudioUsesCanonicalLines(true, false)
        object.setStudioTextLayout(
          node.sizingMode,
          text.topOffset,
          text.layoutLines,
          text.editingListMarkers,
          false
        )
      }
      options.text = text.displayText
      options.styles = {}
    }
    Object.assign(options, {
      fill: text.fill,
      fontFamily: text.fontFamily,
      fontSize: text.fontSize,
      fontWeight: text.fontWeight,
      fontStyle: text.fontStyle,
      underline: text.underline,
      linethrough: text.linethrough,
      textAlign: text.textAlign,
      lineHeight: text.lineHeight,
      charSpacing: text.charSpacing,
      editable: !node.locked,
      objectCaching,
      clipPath: objectCaching ? fixedTextClip(node) : undefined,
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
    if (object instanceof StudioTextbox && textProjection) {
      object.setStudioTextLayout(
        node.sizingMode,
        textProjection.topOffset,
        textProjection.layoutLines,
        textProjection.editingListMarkers,
        false
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

type MutationAdmissionSnapshot = Pick<
  FabricObject,
  "selectable" | "evented" | "hasControls"
> &
  Readonly<{ node: SceneNode | undefined }>

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

export function configureFabricSupportedPixelRatio() {
  const pixelRatio = supportedMaskPaintPixelRatio(config.devicePixelRatio)
  config.configure({ devicePixelRatio: pixelRatio })
  return pixelRatio
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
  private eventSuppressionDepth = 0
  private mutationAdmitted = true
  private readonly mutationAdmissionSnapshots = new Map<
    FabricObject,
    MutationAdmissionSnapshot
  >()
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
  private paintPlanMode = false
  private paintPlanIdentity: string | null = null
  private readonly maskEntryByContentNodeId = new Map<
    string,
    Extract<PagePaintPlanEntry, { kind: "mask_group" }>
  >()
  private readonly maskSourceNodeIds = new Set<string>()
  private readonly maskEntryBySourceNodeId = new Map<
    string,
    Extract<PagePaintPlanEntry, { kind: "mask_group" }>
  >()
  private readonly maskPaintObjectBySourceNodeId = new Map<
    string,
    FabricObject
  >()
  private readonly maskCompositeByGroupId = new Map<string, Group>()
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
    baselineNode: TextNode
    draftNode: TextNode
    typingOverride: TextRunStyle | undefined
    pasteAsPlainRequested: boolean
    cancelled: boolean
  } | null = null
  private pendingTextEditingStateSession: NonNullable<
    FabricCanvasAdapter["textEditSession"]
  > | null = null
  private textEditingStatePublishQueued = false

  constructor(private readonly events: CanvasAdapterEvents) {}

  mount(element: HTMLCanvasElement) {
    if (this.canvas) throw new Error("Fabric canvas is already mounted")
    // Fabric uses this global ratio for the canvas retina backing store and
    // object caches. Cap it before allocation so a 3x host still paints at the
    // admitted 2x ceiling rather than only validating as though it did.
    configureFabricSupportedPixelRatio()
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
    this.canvas.on("text:selection:changed", this.onTextSelectionChanged)
    this.canvas.on("text:changed", this.onTextChanged)
    this.canvas.on("before:transform", this.onBeforeTransform)
    this.canvas.on("object:modified", this.onObjectModified)
    this.canvas.on("object:moving", this.onObjectMoving)
    this.canvas.on("object:scaling", this.onObjectTransformPreview)
    this.canvas.on("object:resizing", this.onObjectTransformPreview)
    this.canvas.on("object:rotating", this.onObjectTransformPreview)
    this.canvas.on("text:editing:exited", this.onTextEditingExited)
    this.canvas.on("before:render", this.onBeforeRender)
    this.canvas.on("after:render", this.onAfterRender)
    this.installTransformPointerTermination(this.canvas.upperCanvasEl)
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
    this.setMutationAdmission(false)
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
    this.paintPlanMode = false
    this.paintPlanIdentity = null
    this.maskEntryByContentNodeId.clear()
    this.maskSourceNodeIds.clear()
    this.maskEntryBySourceNodeId.clear()
    this.maskPaintObjectBySourceNodeId.clear()
    this.maskCompositeByGroupId.clear()
    this.transformTextPreviewNodeIds.clear()
    this.mutationAdmissionSnapshots.clear()
    this.mutationAdmitted = false
    this.eventSuppressionDepth = 0
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
    canvas.off("text:selection:changed", this.onTextSelectionChanged)
    canvas.off("text:changed", this.onTextChanged)
    canvas.off("before:transform", this.onBeforeTransform)
    canvas.off("object:modified", this.onObjectModified)
    canvas.off("object:moving", this.onObjectMoving)
    canvas.off("object:scaling", this.onObjectTransformPreview)
    canvas.off("object:resizing", this.onObjectTransformPreview)
    canvas.off("object:rotating", this.onObjectTransformPreview)
    canvas.off("text:editing:exited", this.onTextEditingExited)
    canvas.off("before:render", this.onBeforeRender)
    canvas.off("after:render", this.onAfterRender)
    this.removeTransformPointerTermination(canvas.upperCanvasEl)
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

  requestRender() {
    this.canvas?.requestRenderAll()
  }

  private installTransformPointerTermination(element: HTMLCanvasElement) {
    element.addEventListener(
      "pointercancel",
      this.onTransformPointerTermination,
      true
    )
  }

  private removeTransformPointerTermination(element: HTMLCanvasElement) {
    element.removeEventListener(
      "pointercancel",
      this.onTransformPointerTermination,
      true
    )
  }

  setMutationAdmission(admitted: boolean) {
    const canvas = this.canvas
    if (!canvas) {
      this.mutationAdmitted = admitted
      return
    }
    if (!admitted) {
      if (this.mutationAdmitted) {
        this.cancelTextEditing()
        this.cancelTransform()
        this.setImageCropMode(null)
      }
      this.mutationAdmitted = false
      this.withEventSuppression(() => canvas.discardActiveObject())
      canvas.selection = false
      canvas.skipTargetFind = true
      this.applyMutationAdmissionPolicy()
      canvas.requestRenderAll()
      return
    }
    this.mutationAdmitted = true
    canvas.selection = true
    canvas.skipTargetFind = false
    for (const [object, snapshot] of this.mutationAdmissionSnapshots) {
      const nodeId = this.nodeIdByObject.get(object)
      if (!nodeId || this.objectByNodeId.get(nodeId) !== object) {
        continue
      }
      object.set({
        selectable: snapshot.selectable,
        evented: snapshot.evented,
        hasControls: snapshot.hasControls,
      })
      object.setCoords()
    }
    this.mutationAdmissionSnapshots.clear()
    canvas.requestRenderAll()
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
    const generation = ++this.generation
    const pageChanged = this.pageId !== pageId
    const previousSelection = pageChanged
      ? []
      : (this.getSelection()?.nodeIds ?? [])
    this.eventSuppressionDepth += 1
    this.activeGuides = []
    let abandonedRegularCandidates: Set<FabricObject> | null = null

    try {
      const applyPagePresentation = () => {
        if (this.pageWidth !== page.width || this.pageHeight !== page.height) {
          canvas.setDimensions({ width: page.width, height: page.height })
          this.pageWidth = page.width
          this.pageHeight = page.height
        }
        if (this.pageBackground !== page.background) {
          canvas.backgroundColor = page.background
          this.pageBackground = page.background
        }
      }

      const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
      const paintPlan = projectPagePaintPlan(document, pageId, {
        pixelRatio: supportedMaskPaintPixelRatio(config.devicePixelRatio),
      })
      const hasMaskPaint = paintPlan.entries.some(
        (entry) => entry.kind === "mask_group"
      )
      if (hasMaskPaint) {
        const nextPaintPlanIdentity = pagePaintPlanIdentity(paintPlan)
        if (
          !pageChanged &&
          this.paintPlanMode &&
          this.paintPlanIdentity === nextPaintPlanIdentity &&
          this.canIncrementallySyncPaintPlan(page, nodesById)
        ) {
          signal?.throwIfAborted()
          this.syncCanonicalPaintPlanNodes(document, page, nodesById)
          applyPagePresentation()
          this.documentId = document.id
          this.pageId = pageId
          canvas.requestRenderAll()
          return
        }
        await this.syncCanonicalPaintPlan(
          document,
          page,
          paintPlan,
          nodesById,
          previousSelection,
          generation,
          signal
        )
        if (generation !== this.generation || !this.canvas) return
        applyPagePresentation()
        this.documentId = document.id
        this.pageId = pageId
        canvas.requestRenderAll()
        return
      }
      const wanted = new Set(page.nodeIds)
      const orderChanged =
        this.pageNodeOrder.length !== page.nodeIds.length ||
        page.nodeIds.some(
          (nodeId, index) => this.pageNodeOrder[index] !== nodeId
        )
      const imagesToPrepare = page.nodeIds.flatMap((nodeId) => {
        const node = nodesById.get(nodeId)
        if (node?.type !== "image") return []
        if (pageChanged || this.paintPlanMode) return [node]
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

      type StagedRegularObject = Readonly<{
        object: FabricObject
        replaces: FabricObject | null
      }>
      const stagedObjectByNodeId = new Map<string, StagedRegularObject>()
      const stagedRegularCandidates = new Set<FabricObject>()
      abandonedRegularCandidates = stagedRegularCandidates
      for (const nodeId of page.nodeIds) {
        signal?.throwIfAborted()
        const node = nodesById.get(nodeId)
        if (!node) continue
        const previousNode =
          pageChanged || this.paintPlanMode
            ? undefined
            : this.nodeByNodeId.get(node.id)
        const object =
          pageChanged || this.paintPlanMode
            ? undefined
            : this.objectByNodeId.get(nodeId)
        if (!object) {
          const stagedObject = await createFabricObjectForSync(
            node,
            loadPreparedImage,
            signal
          )
          stagedRegularCandidates.add(stagedObject)
          stagedObjectByNodeId.set(node.id, {
            object: stagedObject,
            replaces: null,
          })
          continue
        }
        if (
          previousNode !== node &&
          (node.effects?.some((effect) => effect.visible) ||
            previousNode?.effects?.some((effect) => effect.visible))
        ) {
          const replacement = await createFabricObjectForSync(
            node,
            loadPreparedImage,
            signal
          )
          stagedRegularCandidates.add(replacement)
          stagedObjectByNodeId.set(node.id, {
            object: replacement,
            replaces: object,
          })
          continue
        }
        if (
          previousNode !== node &&
          (usesPaintStack(node) ||
            (previousNode ? usesPaintStack(previousNode) : false))
        ) {
          const replacement = createFabricSyncObject(
            node as Exclude<SceneNode, { type: "image" }>
          )
          stagedRegularCandidates.add(replacement)
          stagedObjectByNodeId.set(node.id, {
            object: replacement,
            replaces: object,
          })
          continue
        }
        if (
          (node.type === "rect" || node.type === "frame") &&
          previousNode !== node &&
          usesCornerPath(node) !== object instanceof Path
        ) {
          const replacement = createFabricSyncObject(node)
          stagedRegularCandidates.add(replacement)
          stagedObjectByNodeId.set(node.id, {
            object: replacement,
            replaces: object,
          })
          continue
        }
        if (node.type !== "image" || previousNode === node) continue
        const image =
          object instanceof Group
            ? object
                .getObjects()
                .find(
                  (child): child is FabricImage => child instanceof FabricImage
                )
            : undefined
        if (!image || !equivalentImageSources(image.getSrc(), node.src)) {
          const replacement = await createFabricObjectForSync(
            node,
            loadPreparedImage,
            signal
          )
          if (!isMissingImagePlaceholder(replacement)) {
            stagedRegularCandidates.add(replacement)
            stagedObjectByNodeId.set(node.id, {
              object: replacement,
              replaces: object,
            })
          } else {
            replacement.dispose()
          }
        }
      }

      // This is the regular-scene admission barrier. Nothing mounted is
      // changed until every asynchronous image decode has settled and the
      // request still owns the adapter generation.
      await Promise.allSettled(preparedImages.values())
      signal?.throwIfAborted()
      if (generation !== this.generation || this.canvas !== canvas) return

      if (pageChanged || this.paintPlanMode) {
        this.restoreCropInteractionPolicy()
        canvas.discardActiveObject()
        if (pageChanged) canvas.clear()
        else canvas.remove(...canvas.getObjects())
        this.objectByNodeId.clear()
        this.textByNodeId.clear()
        this.textSizingModeByNodeId.clear()
        this.nodeByNodeId.clear()
        this.maskEntryByContentNodeId.clear()
        this.maskSourceNodeIds.clear()
        this.maskEntryBySourceNodeId.clear()
        this.maskPaintObjectBySourceNodeId.clear()
        this.maskCompositeByGroupId.clear()
        this.paintPlanMode = false
        this.paintPlanIdentity = null
        this.transformTextPreviewNodeIds.clear()
        this.clearTextEditSession()
        this.pageNodeOrder = []
      }
      applyPagePresentation()
      for (const [nodeId, object] of this.objectByNodeId) {
        if (!wanted.has(nodeId)) {
          canvas.remove(object)
          this.objectByNodeId.delete(nodeId)
          this.textByNodeId.delete(nodeId)
          this.textSizingModeByNodeId.delete(nodeId)
          this.nodeByNodeId.delete(nodeId)
        }
      }

      for (const [index, nodeId] of page.nodeIds.entries()) {
        const node = nodesById.get(nodeId)
        if (!node) continue
        const previousNode = this.nodeByNodeId.get(node.id)
        let object = this.objectByNodeId.get(nodeId)
        let objectNeedsPlacement = false
        const staged = stagedObjectByNodeId.get(node.id)
        if (staged) {
          if (staged.replaces) canvas.remove(staged.replaces)
          object = staged.object
          this.objectByNodeId.set(node.id, object)
          this.nodeIdByObject.set(object, node.id)
          canvas.add(object)
          objectNeedsPlacement = true
        } else if (previousNode !== node) {
          if (!object) continue
          syncFabricObjectFromNode(object, node)
        }
        if (!object) continue
        syncFabricFrameClip(object, node, document)
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
      this.documentId = document.id
      this.pageId = pageId
      abandonedRegularCandidates = null
      canvas.requestRenderAll()
    } finally {
      if (abandonedRegularCandidates) {
        disposeFabricObjectForest(abandonedRegularCandidates)
      }
      this.applyMutationAdmissionPolicy()
      this.eventSuppressionDepth = Math.max(0, this.eventSuppressionDepth - 1)
    }
  }

  private canIncrementallySyncPaintPlan(
    page: Document["pages"][number],
    nodesById: ReadonlyMap<string, SceneNode>
  ) {
    return page.nodeIds.every((nodeId) => {
      const previous = this.nodeByNodeId.get(nodeId)
      const next = nodesById.get(nodeId)
      const object = this.objectByNodeId.get(nodeId)
      if (!previous || !next || !object) return false
      if (previous.type !== next.type) return false
      if (
        previous !== next &&
        this.maskEntryBySourceNodeId.get(nodeId)?.maskType === "luminance"
      ) {
        // Luminance sources are rasterized into one bounded mask. Rebuild that
        // raster atomically instead of mutating a detached source proxy and
        // displaying stale mask pixels.
        return false
      }
      return !(
        previous.type === "image" &&
        next.type === "image" &&
        previous.src !== next.src
      )
    })
  }

  private syncCanonicalPaintPlanNodes(
    document: Document,
    page: Document["pages"][number],
    nodesById: ReadonlyMap<string, SceneNode>
  ) {
    for (const nodeId of page.nodeIds) {
      const previous = this.nodeByNodeId.get(nodeId)
      const node = nodesById.get(nodeId)
      const object = this.objectByNodeId.get(nodeId)
      if (!node || !object) continue
      if (previous === node) {
        syncFabricFrameClip(object, node, document)
        continue
      }
      syncFabricObjectFromNode(object, node)
      syncFabricFrameClip(object, node, document)
      if (this.maskSourceNodeIds.has(nodeId)) {
        object.set({ opacity: 0, evented: false })
        const maskObject = this.maskPaintObjectBySourceNodeId.get(nodeId)
        const maskEntry = this.maskEntryBySourceNodeId.get(nodeId)
        if (
          maskObject &&
          maskEntry &&
          (maskEntry.maskType === "vector"
            ? isAdmittedVectorMaskSource(node)
            : isAdmittedAlphaMaskSource(node))
        ) {
          syncFabricObjectFromNode(maskObject, node)
          if (maskEntry.maskType === "vector") {
            if (!isAdmittedVectorMaskSource(node)) continue
            applyFabricVectorMaskSourcePaint(maskObject, node)
          } else {
            applyFabricAlphaMaskSourcePaint(maskObject)
          }
          if (maskEntry.visibleSourceNodeIds.length === 1) {
            applyFabricAlphaMaskPaint(maskObject)
          }
          preserveFabricObjectPageTransformAfterSync(maskObject)
        }
      } else {
        const maskEntry = this.maskEntryByContentNodeId.get(nodeId)
        if (maskEntry) preserveFabricObjectPageTransformAfterSync(object)
      }
      this.nodeByNodeId.set(nodeId, node)
      if (node.type === "text") {
        this.textByNodeId.set(nodeId, node.text)
        this.textSizingModeByNodeId.set(nodeId, node.sizingMode)
      }
    }
    for (const composite of this.maskCompositeByGroupId.values()) {
      composite.set({ dirty: true })
    }
    this.applyImageCropInteractionPolicy()
  }

  private async syncCanonicalPaintPlan(
    document: Document,
    page: Document["pages"][number],
    plan: PagePaintPlan,
    nodesById: ReadonlyMap<string, SceneNode>,
    previousSelection: readonly string[],
    generation: number,
    signal?: AbortSignal
  ) {
    const canvas = this.canvas
    if (!canvas) return
    const maskEntries: FabricMaskGroupEntry[] = []
    visitFabricMaskEntries(plan.entries, (entry) => maskEntries.push(entry))
    const inactiveMaskSourceIds = new Set(
      maskEntries.flatMap((entry) =>
        entry.sourceNodeIds.filter(
          (sourceId) => !entry.visibleSourceNodeIds.includes(sourceId)
        )
      )
    )
    const images = page.nodeIds.flatMap((nodeId) => {
      const node = nodesById.get(nodeId)
      return node?.type === "image" && !inactiveMaskSourceIds.has(node.id)
        ? [node]
        : []
    })
    const candidateObjects = new Set<FabricObject>()
    const preparedImages = prepareFabricImageObjects(images, signal)
    for (const [nodeId, prepared] of preparedImages) {
      preparedImages.set(
        nodeId,
        prepared.then((object) => {
          candidateObjects.add(object)
          return object
        })
      )
    }
    const createObject = async (node: SceneNode) => {
      const prepared =
        node.type === "image" ? preparedImages.get(node.id) : undefined
      const object = await createFabricObjectForSync(
        node,
        (imageNode) =>
          prepared ?? createImageObjectWithinDeadline(imageNode, signal),
        signal
      )
      candidateObjects.add(object)
      return object
    }

    const candidateObjectByNodeId = new Map<string, FabricObject>()
    const candidateMaskEntryByContentNodeId = new Map<
      string,
      FabricMaskGroupEntry
    >()
    const candidateMaskSourceNodeIds = new Set<string>()
    const candidateMaskEntryBySourceNodeId = new Map<
      string,
      FabricMaskGroupEntry
    >()
    const candidateMaskPaintObjectBySourceNodeId = new Map<
      string,
      FabricObject
    >()
    const candidateMaskCompositeByGroupId = new Map<string, Group>()
    const candidateSelectionProxies: FabricObject[] = []
    let installed = false

    const disposeCandidates = () => {
      disposeFabricObjectForest(candidateObjects)
      candidateObjects.clear()
    }
    const isStale = () =>
      generation !== this.generation || this.canvas !== canvas

    const preparedLuminanceByGroupId = new Map<
      string,
      FabricLuminanceMaskUnion
    >()
    const disposePreparedUnion = (union: FabricLuminanceMaskUnion) => {
      for (const sourceObject of union.sourceObjects.values()) {
        candidateObjects.delete(sourceObject)
      }
      candidateObjects.delete(union.maskObject)
      disposeFabricLuminanceMaskUnion(union)
    }
    const disposePreparedLuminance = () => {
      for (const union of preparedLuminanceByGroupId.values()) {
        disposePreparedUnion(union)
      }
      preparedLuminanceByGroupId.clear()
    }

    try {
      // Alpha/luminance source decode is an admission barrier, not a recovery
      // placeholder. Resolve the complete subtree before replacing the mounted
      // paint plan so one failed descendant leaves all last-valid pixels intact.
      const maskResourceNodeIds = new Set<string>()
      for (const entry of maskEntries) {
        for (const sourceId of entry.visibleSourceNodeIds) {
          maskResourceNodeIds.add(sourceId)
        }
        for (const contentEntry of entry.content) {
          if (contentEntry.kind === "node") {
            maskResourceNodeIds.add(contentEntry.nodeId)
          }
        }
      }
      for (const nodeId of maskResourceNodeIds) {
        const node = nodesById.get(nodeId)
        if (node?.type === "image") {
          await preparedImages.get(node.id)
          signal?.throwIfAborted()
          if (isStale()) return
        }
      }

      // Luminance conversion is another admission barrier. Prepare every
      // bounded raster bottom-up while the previous Fabric scene is mounted.
      for (const entry of maskEntries) {
        if (entry.maskType !== "luminance" || !entry.compositeRequired) {
          continue
        }
        const preparedSources: Array<readonly [string, FabricObject]> = []
        try {
          for (const sourceId of entry.visibleSourceNodeIds) {
            const source = nodesById.get(sourceId)
            if (!source || !isAdmittedAlphaMaskSource(source)) {
              throw new Error(`Mask source ${sourceId} is unsupported`)
            }
            const sourceObject = await createObject(source)
            preparedSources.push([source.id, sourceObject])
            signal?.throwIfAborted()
            if (isStale()) return
            if (isMissingImagePlaceholder(sourceObject)) {
              throw new Error(
                `Fabric luminance mask source ${source.id} is unavailable`
              )
            }
          }
          const union = createFabricLuminanceMaskUnion(
            entry.groupId,
            preparedSources,
            entry.bounds,
            config.devicePixelRatio
          )
          candidateObjects.add(union.maskObject)
          preparedLuminanceByGroupId.set(entry.groupId, union)
          // Ownership moved into the candidate union and its cleanup path.
          preparedSources.length = 0
          signal?.throwIfAborted()
          if (isStale()) return
        } catch (error) {
          for (const [, candidate] of preparedSources) {
            candidateObjects.delete(candidate)
            candidate.dispose()
          }
          throw error
        }
      }

      type BuiltFabricPaint = Readonly<{
        objects: readonly FabricObject[]
        unownedContentObjects: ReadonlyMap<string, FabricObject>
      }>
      const buildEntry = async (
        entry: PagePaintPlanEntry
      ): Promise<BuiltFabricPaint> => {
        signal?.throwIfAborted()
        if (entry.kind === "node") {
          const node = nodesById.get(entry.nodeId)
          if (!node) throw new Error(`Paint node ${entry.nodeId} is missing`)
          const object = await createObject(node)
          syncFabricFrameClip(object, node, document)
          candidateObjectByNodeId.set(node.id, object)
          return {
            objects: [object],
            unownedContentObjects: new Map([[node.id, object]]),
          }
        }

        const contentObjects: FabricObject[] = []
        const unownedContentObjects = new Map<string, FabricObject>()
        for (const contentEntry of entry.content) {
          const built = await buildEntry(contentEntry)
          contentObjects.push(...built.objects)
          for (const [nodeId, object] of built.unownedContentObjects) {
            unownedContentObjects.set(nodeId, object)
          }
        }
        signal?.throwIfAborted()
        if (isStale()) return { objects: [], unownedContentObjects: new Map() }
        const preparedSources = new Map<string, FabricObject>()
        if (entry.maskType === "alpha") {
          for (const sourceNodeId of entry.visibleSourceNodeIds) {
            const source = nodesById.get(sourceNodeId)
            if (!source)
              throw new Error(`Mask source ${sourceNodeId} is missing`)
            preparedSources.set(source.id, await createObject(source))
          }
        }
        signal?.throwIfAborted()
        if (isStale()) return { objects: [], unownedContentObjects: new Map() }
        const paint =
          entry.maskType === "vector"
            ? createFabricVectorMaskPaintFromObjects(
                entry,
                nodesById,
                contentObjects
              )
            : entry.maskType === "alpha"
              ? createFabricAlphaMaskPaintFromObjects(
                  entry,
                  nodesById,
                  contentObjects,
                  (node) => {
                    const preparedSource = preparedSources.get(node.id)
                    if (!preparedSource) {
                      throw new Error(`Mask source ${node.id} is not prepared`)
                    }
                    return preparedSource
                  }
                )
              : createFabricLuminanceMaskPaintFromObjects(
                  entry,
                  nodesById,
                  contentObjects,
                  preparedLuminanceByGroupId.get(entry.groupId)
                )
        if (paint.kind === "composite") {
          candidateObjects.add(paint.object)
          candidateObjects.add(paint.maskObject)
          for (const sourceObject of paint.sourceObjects.values()) {
            candidateObjects.add(sourceObject)
          }
          candidateMaskCompositeByGroupId.set(entry.groupId, paint.object)
          if (entry.maskType !== "luminance") {
            for (const [visibleSourceId, sourceObject] of paint.sourceObjects) {
              candidateMaskPaintObjectBySourceNodeId.set(
                visibleSourceId,
                sourceObject
              )
            }
          }
          if (entry.maskType === "luminance") {
            preparedLuminanceByGroupId.delete(entry.groupId)
            for (const sourceObject of paint.sourceObjects.values()) {
              candidateObjects.delete(sourceObject)
              sourceObject.dispose()
            }
          }
          for (const nodeId of unownedContentObjects.keys()) {
            candidateMaskEntryByContentNodeId.set(nodeId, entry)
          }
        }

        for (const sourceNodeId of entry.sourceNodeIds) {
          const source = nodesById.get(sourceNodeId)
          if (
            !source ||
            (entry.maskType === "vector"
              ? !isAdmittedVectorMaskSource(source)
              : !isAdmittedAlphaMaskSource(source))
          ) {
            throw new Error(`Mask source ${sourceNodeId} is unsupported`)
          }
          // The compositor owns its paint copy. This transparent, non-hit-testable
          // object keeps the canonical source explicitly addressable from Layers
          // and programmatic selection without painting it as an ordinary layer.
          const selectionProxy =
            source.type === "image"
              ? new Rect({
                  ...sharedOptions(source),
                  fill: "transparent",
                  stroke: undefined,
                  strokeWidth: 0,
                })
              : createFabricSyncObject(source)
          selectionProxy.set({ opacity: 0, evented: false })
          selectionProxy.setCoords()
          candidateObjects.add(selectionProxy)
          candidateObjectByNodeId.set(sourceNodeId, selectionProxy)
          candidateMaskSourceNodeIds.add(sourceNodeId)
          candidateMaskEntryBySourceNodeId.set(sourceNodeId, entry)
          candidateSelectionProxies.push(selectionProxy)
        }

        return paint.kind === "composite"
          ? { objects: [paint.object], unownedContentObjects: new Map() }
          : { objects: paint.objects, unownedContentObjects }
      }

      const candidateRoots: FabricObject[] = []
      for (const entry of plan.entries) {
        const built = await buildEntry(entry)
        candidateRoots.push(...built.objects)
      }
      await Promise.allSettled(preparedImages.values())
      signal?.throwIfAborted()
      if (isStale()) return

      const previousObjects = [...canvas.getObjects()]
      canvas.discardActiveObject()
      canvas.remove(...previousObjects)
      disposeFabricObjectForest(previousObjects)

      this.paintPlanMode = true
      this.paintPlanIdentity = null
      this.objectByNodeId.clear()
      this.textByNodeId.clear()
      this.textSizingModeByNodeId.clear()
      this.nodeByNodeId.clear()
      this.maskEntryByContentNodeId.clear()
      this.maskSourceNodeIds.clear()
      this.maskEntryBySourceNodeId.clear()
      this.maskPaintObjectBySourceNodeId.clear()
      this.maskCompositeByGroupId.clear()

      for (const nodeId of page.nodeIds) {
        const node = nodesById.get(nodeId)
        if (!node) continue
        this.nodeByNodeId.set(nodeId, node)
        if (node.type === "text") {
          this.textByNodeId.set(nodeId, node.text)
          this.textSizingModeByNodeId.set(nodeId, node.sizingMode)
        }
      }
      for (const [nodeId, object] of candidateObjectByNodeId) {
        this.objectByNodeId.set(nodeId, object)
        this.nodeIdByObject.set(object, nodeId)
      }
      for (const [nodeId, entry] of candidateMaskEntryByContentNodeId) {
        this.maskEntryByContentNodeId.set(nodeId, entry)
      }
      for (const sourceNodeId of candidateMaskSourceNodeIds) {
        this.maskSourceNodeIds.add(sourceNodeId)
      }
      for (const [nodeId, entry] of candidateMaskEntryBySourceNodeId) {
        this.maskEntryBySourceNodeId.set(nodeId, entry)
      }
      for (const [nodeId, object] of candidateMaskPaintObjectBySourceNodeId) {
        this.maskPaintObjectBySourceNodeId.set(nodeId, object)
      }
      for (const [groupId, object] of candidateMaskCompositeByGroupId) {
        this.maskCompositeByGroupId.set(groupId, object)
      }
      canvas.add(...candidateRoots, ...candidateSelectionProxies)
      this.pageNodeOrder = [...page.nodeIds]
      this.paintPlanIdentity = pagePaintPlanIdentity(plan)
      const selectionObjects = previousSelection
        .map((nodeId) => this.objectByNodeId.get(nodeId))
        .filter((object): object is FabricObject => Boolean(object))
      if (selectionObjects.length === 1 && selectionObjects[0]) {
        canvas.setActiveObject(selectionObjects[0])
      } else if (selectionObjects.length > 1) {
        canvas.setActiveObject(this.createActiveSelection(selectionObjects))
      }
      this.applyImageCropInteractionPolicy()
      installed = true
    } finally {
      if (!installed) await Promise.allSettled(preparedImages.values())
      disposePreparedLuminance()
      if (!installed) disposeCandidates()
    }
  }

  setViewportZoom(zoom: number) {
    this.viewportZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  }

  previewNodePatch(nodeId: string, patch: Partial<SceneNode>): boolean {
    if (!this.mutationAdmitted) return false
    const canvas = this.canvas
    const object = this.objectByNodeId.get(nodeId)
    const node = this.nodeByNodeId.get(nodeId)
    if (!canvas || !object || !node || node.locked) return false
    if (this.maskEntryBySourceNodeId.get(nodeId)?.maskType === "luminance") {
      return false
    }
    const previewNode = { ...node, ...patch } as SceneNode
    syncFabricObjectFromNode(object, previewNode)
    if (this.maskSourceNodeIds.has(nodeId)) {
      object.set({ opacity: 0, evented: false })
      const maskObject = this.maskPaintObjectBySourceNodeId.get(nodeId)
      const sourceEntry = this.maskEntryBySourceNodeId.get(nodeId)
      if (
        maskObject &&
        sourceEntry &&
        isAdmittedVectorMaskSource(previewNode)
      ) {
        syncFabricObjectFromNode(maskObject, previewNode)
        applyFabricVectorMaskSourcePaint(maskObject, previewNode)
        if (sourceEntry.visibleSourceNodeIds.length === 1) {
          applyFabricAlphaMaskPaint(maskObject)
        }
        preserveFabricObjectPageTransformAfterSync(maskObject)
        markFabricObjectAncestorsDirty(maskObject)
      }
    }
    const maskEntry = this.maskEntryByContentNodeId.get(nodeId)
    if (maskEntry) {
      preserveFabricObjectPageTransformAfterSync(object)
      markFabricObjectAncestorsDirty(object)
    }
    canvas.requestRenderAll()
    return true
  }

  restoreNodePreview(nodeId: string): boolean {
    const canvas = this.canvas
    const object = this.objectByNodeId.get(nodeId)
    const node = this.nodeByNodeId.get(nodeId)
    if (!canvas || !object || !node) return false
    if (this.maskEntryBySourceNodeId.get(nodeId)?.maskType === "luminance") {
      return false
    }
    syncFabricObjectFromNode(object, node)
    if (this.maskSourceNodeIds.has(nodeId)) {
      object.set({ opacity: 0, evented: false })
      const maskObject = this.maskPaintObjectBySourceNodeId.get(nodeId)
      const sourceEntry = this.maskEntryBySourceNodeId.get(nodeId)
      if (maskObject && sourceEntry && isAdmittedVectorMaskSource(node)) {
        syncFabricObjectFromNode(maskObject, node)
        applyFabricVectorMaskSourcePaint(maskObject, node)
        if (sourceEntry.visibleSourceNodeIds.length === 1) {
          applyFabricAlphaMaskPaint(maskObject)
        }
        preserveFabricObjectPageTransformAfterSync(maskObject)
        markFabricObjectAncestorsDirty(maskObject)
      }
    }
    const maskEntry = this.maskEntryByContentNodeId.get(nodeId)
    if (maskEntry) {
      preserveFabricObjectPageTransformAfterSync(object)
      markFabricObjectAncestorsDirty(object)
    }
    canvas.requestRenderAll()
    return true
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
    // Selection can be cleared by the React workspace outside Fabric's upper
    // canvas. In that path Fabric emits no selection:cleared or mouse:up event,
    // so transient snap/spacing guides must be released explicitly here.
    this.clearGuides()
    if (!this.mutationAdmitted) return
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
    this.withEventSuppression(() => {
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
    })
  }

  getSelection(): Selection | null {
    if (!this.canvas || !this.pageId) return null
    const nodeIds = this.canvas
      .getActiveObjects()
      .map((object) => this.nodeIdByObject.get(object))
      .filter((nodeId): nodeId is string => Boolean(nodeId))
    return nodeIds.length ? { pageId: this.pageId, nodeIds } : null
  }

  enterTextEditing(nodeId: string, selection?: TextSelection): boolean {
    if (!this.mutationAdmitted) return false
    const canvas = this.canvas
    const object = this.objectByNodeId.get(nodeId)
    if (!canvas || !(object instanceof Textbox)) return false
    const node = this.nodeByNodeId.get(nodeId)
    const rawText = this.textByNodeId.get(nodeId)
    if (object instanceof StudioTextbox) {
      object.setStudioUsesCanonicalLines(false, false)
    }
    if (rawText !== undefined && object.text !== rawText) {
      setFabricTextboxContent(
        object,
        rawText,
        "editing",
        node?.type === "text" ? projectFabricTextEditingStyles(node) : undefined
      )
      object.setCoords()
    }
    const entered = enterFabricTextEditing(canvas, object)
    if (entered && selection) restoreFabricTextSelection(object, selection)
    if (entered) canvas.requestRenderAll()
    return entered
  }

  commitTextEditing(): boolean {
    if (!this.mutationAdmitted) return false
    const session = this.textEditSession
    if (!session) return false
    session.target.exitEditing()
    return true
  }

  cancelTextEditing(): boolean {
    const session = this.textEditSession
    if (!session) return false
    session.cancelled = true
    this.textByNodeId.set(session.nodeId, session.baselineNode.text)
    cancelFabricTextEditing(session.target, session.baselineNode.text)
    if (session.baselineNode.type === "text") {
      const projection = projectFabricTextState(session.baselineNode)
      setFabricTextboxContent(
        session.target,
        projection.displayText,
        "canonical",
        {}
      )
      session.target.setCoords()
    }
    this.clearTextEditSession()
    this.canvas?.requestRenderAll()
    return true
  }

  applyTextEditingStyle(patch: TextRunStylePatch): boolean {
    if (!this.mutationAdmitted) return false
    const session = this.textEditSession
    if (!session || session.cancelled) return false
    const selection = fabricTextSelection(session.target)
    if (selection.anchor === selection.focus) {
      const active =
        session.typingOverride ??
        textRunOverrideAtCaret(
          session.draftNode.text,
          session.draftNode.runs,
          selection.focus
        )
      session.typingOverride = patchTextRunStyle(active, patch)
    } else {
      session.draftNode = {
        ...session.draftNode,
        runs: applyTextStyleToRange(
          session.draftNode.text,
          session.draftNode.runs,
          selection,
          patch
        ),
      }
      session.typingOverride = undefined
      this.projectTextEditDraft(session)
    }
    this.publishTextEditingState(session)
    return true
  }

  applyTextEditingParagraphStyle(patch: TextParagraphStylePatch): boolean {
    if (!this.mutationAdmitted) return false
    const session = this.textEditSession
    if (!session || session.cancelled) return false
    const selection = fabricTextSelection(session.target)
    session.draftNode = {
      ...session.draftNode,
      paragraphs: applyTextParagraphStyleToRange(
        session.draftNode.text,
        session.draftNode.paragraphs,
        selection,
        patch,
        session.draftNode.align
      ),
    }
    this.projectTextEditDraft(session)
    this.publishTextEditingState(session)
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
        this.withEventSuppression(() =>
          this.canvas?.setActiveObject(previousTarget)
        )
      }
      this.canvas?.requestRenderAll()
      return true
    }

    if (!this.mutationAdmitted) return false

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
    if (!this.mutationAdmitted) return false
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
    if (!this.mutationAdmitted) return false
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
    if (!this.mutationAdmitted) return null
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
    this.applyMutationAdmissionPolicy()
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

  private get eventsSuppressed() {
    return this.eventSuppressionDepth > 0
  }

  private withEventSuppression<T>(operation: () => T): T {
    this.eventSuppressionDepth += 1
    try {
      return operation()
    } finally {
      this.eventSuppressionDepth = Math.max(0, this.eventSuppressionDepth - 1)
    }
  }

  private applyMutationAdmissionPolicy() {
    if (this.mutationAdmitted) return
    for (const object of this.objectByNodeId.values()) {
      const nodeId = this.nodeIdByObject.get(object)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      const previous = this.mutationAdmissionSnapshots.get(object)
      if (!previous || previous.node !== node) {
        this.mutationAdmissionSnapshots.set(object, {
          selectable: object.selectable,
          evented: object.evented,
          hasControls: object.hasControls,
          node,
        })
      }
      object.set({ selectable: false, evented: false, hasControls: false })
      object.setCoords()
    }
  }

  private finalizeTextEditing(transition: TextEditTransition): boolean {
    return textEditFinalizationPolicy(transition) === "commit"
      ? this.commitTextEditing()
      : this.cancelTextEditing()
  }

  exportPng() {
    if (!this.mutationAdmitted) return null
    return (
      this.canvas?.toDataURL({
        format: "png",
        multiplier: 1,
        enableRetinaScaling: false,
      }) ?? null
    )
  }

  private onSelection = () => {
    if (!this.mutationAdmitted) return
    if (this.imageCropMode) return
    const activeObject = this.canvas?.getActiveObject()
    if (activeObject instanceof ActiveSelection) {
      this.applyActiveSelectionTransformPolicy(activeObject)
      activeObject.setCoords()
      this.canvas?.requestRenderAll()
    }
    if (!this.eventsSuppressed)
      this.events.onSelectionChange(this.getSelection())
  }

  private onSelectionCleared = () => {
    this.clearGuides()
    if (!this.mutationAdmitted) return
    if (this.imageCropMode) return
    if (!this.eventsSuppressed) this.events.onSelectionChange(null)
  }

  private onMouseDoubleClick = ({
    e,
    target,
  }: TPointerEventInfo<TPointerEvent>) => {
    if (!this.mutationAdmitted) return
    if (target instanceof Textbox) {
      const nodeId = this.nodeIdByObject.get(target)
      if (nodeId) this.events.onNodeDoubleClick?.(nodeId)
      if (nodeId) this.enterTextEditing(nodeId)
      return
    }
    if (target) {
      const nodeId = this.nodeIdByObject.get(target)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      if (nodeId) this.events.onNodeDoubleClick?.(nodeId)
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
    if (!this.mutationAdmitted) return
    if (!("button" in e) || e.button !== 2) return
    this.events.onContextMenu?.({
      clientX: e.clientX,
      clientY: e.clientY,
      nodeId: target ? (this.nodeIdByObject.get(target) ?? null) : null,
    })
  }

  private onImageCropTouchStart = (event: TouchEvent) => {
    if (!this.mutationAdmitted) return
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
    if (!this.mutationAdmitted) return
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
    if (!this.mutationAdmitted) return
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
    if (!this.mutationAdmitted) return
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
    if (!this.mutationAdmitted) return
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
    if (!this.mutationAdmitted) return
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

  private restoreCanonicalMutationTarget(target: FabricObject) {
    for (const object of this.transformObjects(target)) {
      const nodeId = this.nodeIdByObject.get(object)
      const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
      if (node) syncFabricObjectFromNode(object, node)
    }
    target.setCoords()
    this.canvas?.requestRenderAll()
  }

  private onBeforeTransform = ({ transform }: { transform: Transform }) => {
    const context = this.transformContext()
    const kind = fabricTransformKind(transform.action)
    if (
      !this.mutationAdmitted ||
      this.eventsSuppressed ||
      this.imageCropMode ||
      this.textEditSession ||
      !context ||
      !kind
    ) {
      return
    }
    // A previous transform can release canonical guide state before Fabric has
    // repainted its upper context. Starting another gesture must clear both.
    this.clearGuides()
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
        setFabricTextboxContent(
          transform.target,
          rawText,
          "editing",
          node?.type === "text"
            ? projectFabricTextEditingStyles(node)
            : undefined
        )
        transform.target.setCoords()
        this.transformTextPreviewNodeIds.add(nodeId)
      }
    }
  }

  private onTransformPointerUp = () => {
    if (!this.mutationAdmitted) return
    const session = this.transformSessions.active
    if (!session || session.phase === "cancelled") return
    // Fabric emits object:modified before mouse:up when a transform changed.
    // A click without movement emits no modified event, so mouse:up releases
    // that no-op session after Fabric has finalized it.
    this.restoreTransformTextPreviews()
    this.transformSessions.release()
    this.clearGuides()
  }

  private onTransformPointerTermination = () => {
    // Keep transient transform ownership on Fabric's upper canvas. Pointer
    // cancellation is terminal just like pointer-up, but a live canonical
    // transform must roll back rather than commit the last preview. Image-crop
    // touch cancellation remains owned by its dedicated touchcancel listener
    // and state machine below.
    if (this.transformSessions.active) this.cancelTransform()
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
    if (!target) return
    if (!this.mutationAdmitted) {
      this.restoreCanonicalMutationTarget(target)
      return
    }
    if (this.eventsSuppressed) return
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
    this.withEventSuppression(() => {
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
    })
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
    if (!canvas || !target) return
    if (!this.mutationAdmitted) {
      this.restoreCanonicalMutationTarget(target)
      return
    }
    if (this.eventsSuppressed) return
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

  private onBeforeRender = () => {
    const canvas = this.canvas
    if (!canvas) return
    // Snap and spacing guides are painted on Fabric's top context. Fabric does
    // not clear that context as part of every lower-canvas render, so without
    // this pass each transform frame leaves its pixels behind. This mirrors
    // Fabric's own aligning-guidelines extension: clear before every render,
    // then paint the current guide set in after:render.
    canvas.clearContext(canvas.contextTop)
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
    const hadActiveGuides = this.activeGuides.length > 0
    this.activeGuides = []
    const canvas = this.canvas
    if (!canvas) return
    // The in-memory guide list and the already-painted top-context frame can
    // diverge: page sync and transform cancellation may release the list before
    // an external blank-canvas click arrives. Always clear the pixels even when
    // activeGuides is already empty. Existing release callers own their normal
    // follow-up repaint; a live guide transition requests one here as well.
    // Canvas is complete in production; the guard also keeps staged/test
    // adapters that have not allocated an upper context from throwing while
    // they release transient state.
    if (canvas.contextTop && typeof canvas.clearContext === "function") {
      canvas.clearContext(canvas.contextTop)
    }
    if (hadActiveGuides) canvas.requestRenderAll()
  }

  private onObjectModified = ({ target }: ModifiedEvent) => {
    this.clearGuides()
    if (!target) return
    if (!this.mutationAdmitted) {
      this.restoreCanonicalMutationTarget(target)
      return
    }
    if (this.eventsSuppressed) return
    const context = this.transformContext()
    const transformSession = this.transformSessions.active
    // Fabric emits object:modified when a Textbox leaves editing after its
    // intrinsic dimensions have changed. Direct text editing is already owned
    // by onTextEditingExited, which emits one content patch (and lets the host
    // translate a field binding plus rich-text metadata into one transaction).
    // Only a real before:transform session may publish Textbox geometry here;
    // otherwise the exit would create a second history entry for one edit.
    if (target instanceof Textbox && !transformSession) return
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
    if (
      !this.mutationAdmitted ||
      this.eventsSuppressed ||
      !(target instanceof Textbox)
    )
      return
    const nodeId = this.nodeIdByObject.get(target)
    if (!nodeId) return
    const session =
      this.textEditSession?.nodeId === nodeId ? this.textEditSession : null
    if (session && !session.cancelled) this.updateTextEditDraft(session)
    const baseline = session?.baselineNode
    const draft = session?.draftNode
    const cancelled = session?.cancelled ?? false
    this.clearTextEditSession(!cancelled)
    if (cancelled || !baseline || !draft) {
      const node = baseline ?? this.nodeByNodeId.get(nodeId)
      const projection =
        node?.type === "text" ? projectFabricTextState(node) : null
      setFabricTextboxContent(
        target,
        projection?.displayText ?? baseline?.text ?? target.text,
        "canonical",
        {}
      )
      if (baseline) this.textByNodeId.set(nodeId, baseline.text)
      target.setCoords()
      this.canvas?.requestRenderAll()
      return
    }
    const patch = richTextEditPatch(baseline, draft)
    if (!patch) {
      const projection = projectFabricTextState(baseline)
      setFabricTextboxContent(target, projection.displayText, "canonical", {})
      target.setCoords()
      this.canvas?.requestRenderAll()
      return
    }
    this.textByNodeId.set(nodeId, draft.text)
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
        baseline.text,
        draft.text,
        accepted
      )
      const projection = projectFabricTextState(baseline)
      setFabricTextboxContent(
        target,
        projection.displayText ?? settled,
        "canonical",
        {}
      )
    } else {
      this.nodeByNodeId.set(nodeId, structuredClone(draft))
      const projection = projectFabricTextState(draft)
      setFabricTextboxContent(target, projection.displayText, "canonical", {})
    }
    target.setCoords()
    this.canvas?.requestRenderAll()
  }

  private onTextEditingEntered = ({ target }: { target: FabricObject }) => {
    if (!this.mutationAdmitted) {
      if (target instanceof Textbox) {
        const nodeId = this.nodeIdByObject.get(target)
        const node = nodeId ? this.nodeByNodeId.get(nodeId) : undefined
        cancelFabricTextEditing(
          target,
          node?.type === "text" ? node.text : target.text
        )
      }
      return
    }
    if (!(target instanceof Textbox)) return
    const nodeId = this.nodeIdByObject.get(target)
    if (!nodeId) return
    const node = this.nodeByNodeId.get(nodeId)
    if (node?.type !== "text") return
    const projection = projectFabricTextState(node)
    const usesProjectedText = target.text !== node.text
    const projectedSelection = fabricTextSelection(target)
    const selection = usesProjectedText
      ? {
          anchor: projectedTextOffsetToSource(
            projection.layoutLines,
            projectedSelection.anchor
          ),
          focus: projectedTextOffsetToSource(
            projection.layoutLines,
            projectedSelection.focus
          ),
        }
      : projectedSelection
    setFabricTextboxContent(
      target,
      node.text,
      "editing",
      projection.editingStyles
    )
    if (usesProjectedText) {
      if (target.hiddenTextarea) target.hiddenTextarea.value = node.text
    }
    target.initDimensions()
    restoreFabricTextSelection(target, selection)
    target.setCoords()
    this.canvas?.requestRenderAll()
    this.clearTextEditSession()
    this.textEditSession = {
      nodeId,
      target,
      baselineNode: structuredClone(node),
      draftNode: structuredClone(node),
      typingOverride: undefined,
      pasteAsPlainRequested: false,
      cancelled: false,
    }
    target.hiddenTextarea?.addEventListener(
      "keydown",
      this.onTextEditingKeyDown,
      true
    )
    target.hiddenTextarea?.addEventListener(
      "keyup",
      this.onTextEditingKeyUp,
      true
    )
    target.hiddenTextarea?.addEventListener("copy", this.onTextEditingCopy)
    target.hiddenTextarea?.addEventListener("cut", this.onTextEditingCut)
    target.hiddenTextarea?.addEventListener("paste", this.onTextEditingPaste)
    this.publishTextEditingState(this.textEditSession)
    this.canvas?.requestRenderAll()
  }

  private onTextChanged = ({ target }: { target: FabricObject }) => {
    if (!this.mutationAdmitted) return
    if (!(target instanceof Textbox)) return
    const session = this.textEditSession
    if (!session || session.target !== target || session.cancelled) return
    this.updateTextEditDraft(session)
    this.scheduleTextEditingState(session)
  }

  private onTextSelectionChanged = ({ target }: { target: FabricObject }) => {
    if (!this.mutationAdmitted) return
    if (!(target instanceof Textbox)) return
    const session = this.textEditSession
    if (!session || session.target !== target || session.cancelled) return
    this.scheduleTextEditingState(session)
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
    const primary = event.metaKey || event.ctrlKey
    const formattingKey = event.key.toLowerCase()
    if (primary && event.shiftKey && formattingKey === "v") {
      session.pasteAsPlainRequested = true
      return
    }
    if (
      primary &&
      !event.altKey &&
      !event.shiftKey &&
      ["b", "i", "u"].includes(formattingKey)
    ) {
      const selection = fabricTextSelection(session.target)
      const state = resolveTextSelectionStyle(
        session.draftNode.text,
        session.draftNode.runs,
        selection,
        textNodeBaseStyle(session.draftNode),
        session.typingOverride
      )
      const value = <Value>(shared: {
        kind: "value" | "mixed"
        value?: Value
      }) => (shared.kind === "value" ? shared.value : undefined)
      const patch: TextRunStylePatch =
        formattingKey === "b"
          ? {
              fontWeight: (value(state.fontWeight) ?? 0) >= 700 ? 400 : 700,
            }
          : formattingKey === "i"
            ? { italic: value(state.italic) !== true }
            : {
                decoration:
                  value(state.decoration) === "underline"
                    ? "none"
                    : "underline",
              }
      event.preventDefault()
      event.stopImmediatePropagation()
      this.applyTextEditingStyle(patch)
      return
    }
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    ) {
      session.typingOverride = undefined
    }

    const textarea = session.target.hiddenTextarea
    if (!textarea) return
    if (["Enter", "Backspace", "Tab"].includes(event.key)) {
      const paragraphs = editTextParagraphListByKey({
        key: event.key as "Enter" | "Backspace" | "Tab",
        shiftKey: event.shiftKey,
        text: session.draftNode.text,
        paragraphs: session.draftNode.paragraphs,
        selection: fabricTextSelection(session.target),
      })
      if (paragraphs) {
        event.preventDefault()
        event.stopImmediatePropagation()
        session.draftNode = { ...session.draftNode, paragraphs }
        this.projectTextEditDraft(session)
        this.publishTextEditingState(session)
        return
      }
    }
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

  private onTextEditingKeyUp = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "v" && this.textEditSession) {
      this.textEditSession.pasteAsPlainRequested = false
    }
  }

  private applyTextClipboardResult(
    session: NonNullable<FabricCanvasAdapter["textEditSession"]>,
    result: ReplaceRichTextRangeResult
  ) {
    session.draftNode = {
      ...session.draftNode,
      text: result.text,
      runs: [...result.content.runs],
      paragraphs: [...result.content.paragraphs],
      links: [...result.content.links],
    }
    session.typingOverride = undefined
    setFabricTextboxContent(
      session.target,
      result.text,
      "editing",
      projectFabricTextEditingStyles(session.draftNode)
    )
    if (session.target.hiddenTextarea) {
      session.target.hiddenTextarea.value = result.text
    }
    session.target.initDimensions()
    restoreFabricTextSelection(session.target, result.selection)
    session.target.setCoords()
    this.canvas?.requestRenderAll()
    this.scheduleTextEditingState(session)
  }

  private onTextEditingCopy = (event: ClipboardEvent) => {
    const session = this.textEditSession
    if (!session || !event.clipboardData) return
    if (
      writeTextEditingClipboardData(
        event.clipboardData,
        session.draftNode,
        fabricTextSelection(session.target)
      )
    ) {
      event.preventDefault()
    }
  }

  private onTextEditingCut = (event: ClipboardEvent) => {
    const session = this.textEditSession
    if (!session || !event.clipboardData) return
    const selection = fabricTextSelection(session.target)
    if (
      !writeTextEditingClipboardData(
        event.clipboardData,
        session.draftNode,
        selection
      )
    ) {
      return
    }
    event.preventDefault()
    this.applyTextClipboardResult(
      session,
      replaceRichTextRange(
        session.draftNode.text,
        {
          runs: session.draftNode.runs,
          paragraphs: session.draftNode.paragraphs,
          links: session.draftNode.links,
        },
        selection,
        ""
      )
    )
  }

  private onTextEditingPaste = (event: ClipboardEvent) => {
    const session = this.textEditSession
    if (!session || !event.clipboardData) return
    const clipboard = readTextEditingClipboardData(
      event.clipboardData,
      session.pasteAsPlainRequested
    )
    session.pasteAsPlainRequested = false
    if (!clipboard) return
    event.preventDefault()
    const selection = fabricTextSelection(session.target)
    const content = {
      runs: session.draftNode.runs,
      paragraphs: session.draftNode.paragraphs,
      links: session.draftNode.links,
    }
    this.applyTextClipboardResult(
      session,
      clipboard.kind === "rich"
        ? pasteParsedTextClipboardPayload(
            session.draftNode.text,
            content,
            selection,
            clipboard.payload
          )
        : replaceRichTextRange(
            session.draftNode.text,
            content,
            selection,
            clipboard.text,
            session.typingOverride
          )
    )
  }

  private updateTextEditDraft(
    session: NonNullable<FabricCanvasAdapter["textEditSession"]>
  ) {
    const nextText = session.target.text
    if (nextText === session.draftNode.text) return
    const replacement = deriveTextReplacement(session.draftNode.text, nextText)
    const result = replaceRichTextRange(
      session.draftNode.text,
      {
        runs: session.draftNode.runs,
        paragraphs: session.draftNode.paragraphs,
        links: session.draftNode.links,
      },
      replacement.selection,
      replacement.replacement,
      session.typingOverride
    )
    session.draftNode = {
      ...session.draftNode,
      text: result.text,
      runs: result.content.runs,
      paragraphs: result.content.paragraphs,
      links: result.content.links,
    }
    this.projectTextEditDraft(session)
  }

  private projectTextEditDraft(
    session: NonNullable<FabricCanvasAdapter["textEditSession"]>
  ) {
    const selection = fabricTextSelection(session.target)
    session.target.set({
      styles: projectFabricTextEditingStyles(session.draftNode),
    })
    session.target.initDimensions()
    restoreFabricTextSelection(session.target, selection)
    session.target.setCoords()
    this.canvas?.requestRenderAll()
  }

  private publishTextEditingState(
    session: NonNullable<FabricCanvasAdapter["textEditSession"]>
  ) {
    if (this.pendingTextEditingStateSession === session) {
      this.pendingTextEditingStateSession = null
    }
    const selection = fabricTextSelection(session.target)
    this.events.onTextEditingChange?.({
      nodeId: session.nodeId,
      text: session.draftNode.text,
      selection,
      style: resolveTextSelectionStyle(
        session.draftNode.text,
        session.draftNode.runs,
        selection,
        textNodeBaseStyle(session.draftNode),
        session.typingOverride
      ),
      typographyStyle: resolveTextSelectionStyleAttachment(
        session.draftNode.text,
        session.draftNode.runs,
        selection,
        "typography",
        session.draftNode.typographyStyleId,
        session.typingOverride
      ),
      paintStyle: resolveTextSelectionStyleAttachment(
        session.draftNode.text,
        session.draftNode.runs,
        selection,
        "paint",
        session.draftNode.paintStyleId,
        session.typingOverride
      ),
      link: resolveTextSelectionLink(
        session.draftNode.text,
        session.draftNode.links,
        selection
      ),
      paragraph: resolveTextSelectionParagraphState(
        session.draftNode.text,
        session.draftNode.paragraphs,
        selection,
        session.draftNode.align
      ),
    })
  }

  private scheduleTextEditingState(
    session: NonNullable<FabricCanvasAdapter["textEditSession"]>
  ) {
    this.pendingTextEditingStateSession = session
    if (this.textEditingStatePublishQueued) return
    this.textEditingStatePublishQueued = true
    queueMicrotask(() => {
      this.textEditingStatePublishQueued = false
      this.flushScheduledTextEditingState()
    })
  }

  private flushScheduledTextEditingState() {
    const session = this.pendingTextEditingStateSession
    this.pendingTextEditingStateSession = null
    if (!session || this.textEditSession !== session || session.cancelled) {
      return
    }
    this.publishTextEditingState(session)
  }

  private clearTextEditSession(flushScheduledState = false) {
    if (flushScheduledState) this.flushScheduledTextEditingState()
    else this.pendingTextEditingStateSession = null
    this.textEditSession?.target.hiddenTextarea?.removeEventListener(
      "keydown",
      this.onTextEditingKeyDown,
      true
    )
    this.textEditSession?.target.hiddenTextarea?.removeEventListener(
      "keyup",
      this.onTextEditingKeyUp,
      true
    )
    this.textEditSession?.target.hiddenTextarea?.removeEventListener(
      "copy",
      this.onTextEditingCopy
    )
    this.textEditSession?.target.hiddenTextarea?.removeEventListener(
      "cut",
      this.onTextEditingCut
    )
    this.textEditSession?.target.hiddenTextarea?.removeEventListener(
      "paste",
      this.onTextEditingPaste
    )
    this.textEditSession = null
    this.events.onTextEditingChange?.(null)
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

export function richTextEditPatch(
  baseline: TextNode,
  draft: TextNode
): Pick<TextNode, "text" | "runs" | "paragraphs" | "links"> | null {
  if (
    baseline.text === draft.text &&
    JSON.stringify(baseline.runs) === JSON.stringify(draft.runs) &&
    JSON.stringify(baseline.paragraphs) === JSON.stringify(draft.paragraphs) &&
    JSON.stringify(baseline.links) === JSON.stringify(draft.links)
  ) {
    return null
  }
  return {
    text: draft.text,
    runs: structuredClone(draft.runs),
    paragraphs: structuredClone(draft.paragraphs),
    links: structuredClone(draft.links),
  }
}

const fabricIndexToUtf16Offset = (object: Textbox, index: number) =>
  object.graphemeSplit(object.text).slice(0, index).join("").length

const utf16OffsetToFabricIndex = (object: Textbox, offset: number) =>
  object.graphemeSplit(object.text.slice(0, offset)).length

export function fabricTextSelection(object: Textbox): TextSelection {
  const textarea = object.hiddenTextarea
  if (textarea && textarea.value === object.text) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    return textarea.selectionDirection === "backward"
      ? { anchor: end, focus: start }
      : { anchor: start, focus: end }
  }
  return {
    anchor: fabricIndexToUtf16Offset(object, object.selectionStart),
    focus: fabricIndexToUtf16Offset(object, object.selectionEnd),
  }
}

export function restoreFabricTextSelection(
  object: Textbox,
  selection: TextSelection
) {
  const normalized = normalizeTextSelection(object.text, selection)
  object.setSelectionStart(utf16OffsetToFabricIndex(object, normalized.start))
  object.setSelectionEnd(utf16OffsetToFabricIndex(object, normalized.end))
  object.hiddenTextarea?.setSelectionRange(
    normalized.start,
    normalized.end,
    normalized.direction === "backward" ? "backward" : "forward"
  )
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

  const ownerDocument = object.canvas?.upperCanvasEl.ownerDocument
  const scrollingElement = ownerDocument?.scrollingElement
  const body = ownerDocument?.body
  const scrollLeft = scrollingElement?.scrollLeft ?? 0
  const scrollTop = scrollingElement?.scrollTop ?? 0
  const bodyScrollLeft = body?.scrollLeft ?? 0
  const bodyScrollTop = body?.scrollTop ?? 0
  canvas.setActiveObject(object)
  object.enterEditing()
  object.hiddenTextarea?.focus({ preventScroll: true })
  if (scrollingElement) {
    const restoreScroll = () => {
      if (
        scrollingElement.scrollLeft !== scrollLeft ||
        scrollingElement.scrollTop !== scrollTop
      ) {
        scrollingElement.scrollTo({ left: scrollLeft, top: scrollTop })
      }
      if (
        body &&
        (body.scrollLeft !== bodyScrollLeft || body.scrollTop !== bodyScrollTop)
      ) {
        body.scrollTo({ left: bodyScrollLeft, top: bodyScrollTop })
      }
    }
    restoreScroll()
    queueMicrotask(restoreScroll)
    const ownerWindow = ownerDocument?.defaultView
    ownerWindow?.requestAnimationFrame(() => {
      restoreScroll()
      ownerWindow.requestAnimationFrame(restoreScroll)
    })
    ownerWindow?.setTimeout(restoreScroll, 50)
    ownerWindow?.setTimeout(restoreScroll, 200)
  }
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
