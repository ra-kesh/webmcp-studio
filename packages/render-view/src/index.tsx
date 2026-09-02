import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react"
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
import {
  projectFrameClipStack,
  projectImagePaint,
  projectNodeForRender,
  projectPageForRender,
  cornerRadiiCss,
  roundedRectanglePath,
  roundedRectanglePaintPath,
  hasExplicitPaintStack,
  strokeGeometryInset,
  layerEffectFilter,
  type Document,
  type ImageFrameMask,
  type RenderFrameProjection,
  type RenderImagePaintProjection,
  type RenderNodeProjection,
  type ProjectedTextLine,
  type ProjectedTextSegment,
  type SceneNode,
} from "@webmcp/document"

export function renderImageFrameMaskStyle(
  frame: Pick<RenderFrameProjection, "width" | "height">,
  mask: ImageFrameMask
): CSSProperties {
  return {
    overflow: "hidden",
    borderRadius:
      mask.shape === "ellipse"
        ? "50%"
        : mask.shape === "rounded_rectangle"
          ? mask.cornerRadii
            ? cornerRadiiCss({
                topLeft:
                  mask.cornerRadii.topLeft *
                  Math.min(frame.width, frame.height),
                topRight:
                  mask.cornerRadii.topRight *
                  Math.min(frame.width, frame.height),
                bottomRight:
                  mask.cornerRadii.bottomRight *
                  Math.min(frame.width, frame.height),
                bottomLeft:
                  mask.cornerRadii.bottomLeft *
                  Math.min(frame.width, frame.height),
              })
            : mask.radius * Math.min(frame.width, frame.height)
          : undefined,
    clipPath:
      mask.shape === "rounded_rectangle" && (mask.cornerSmoothing ?? 0) > 0
        ? `path('${roundedRectanglePath({
            width: frame.width,
            height: frame.height,
            cornerRadii: mask.cornerRadii
              ? {
                  topLeft:
                    mask.cornerRadii.topLeft *
                    Math.min(frame.width, frame.height),
                  topRight:
                    mask.cornerRadii.topRight *
                    Math.min(frame.width, frame.height),
                  bottomRight:
                    mask.cornerRadii.bottomRight *
                    Math.min(frame.width, frame.height),
                  bottomLeft:
                    mask.cornerRadii.bottomLeft *
                    Math.min(frame.width, frame.height),
                }
              : undefined,
            radius: mask.radius * Math.min(frame.width, frame.height),
            cornerSmoothing: mask.cornerSmoothing,
          })}')`
        : undefined,
  }
}

export function renderImagePaintStyle(
  paint: RenderImagePaintProjection,
  naturalSize: Readonly<{ width: number; height: number }>
): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: naturalSize.width,
    height: naturalSize.height,
    maxWidth: "none",
    maxHeight: "none",
    transform: `matrix(${paint.sourceToFrame.a}, ${paint.sourceToFrame.b}, ${paint.sourceToFrame.c}, ${paint.sourceToFrame.d}, ${paint.sourceToFrame.e}, ${paint.sourceToFrame.f})`,
    transformOrigin: "0 0",
  }
}

export const renderFrameStyle = (
  frame: RenderFrameProjection
): CSSProperties => {
  const filter = layerEffectFilter(frame.effects)
  return {
    position: "absolute",
    boxSizing: "border-box",
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    opacity: frame.opacity,
    mixBlendMode: frame.blendMode,
    filter: filter || undefined,
    transform:
      frame.flipX || frame.flipY
        ? `rotate(${frame.rotation}deg) translate(${frame.width / 2}px, ${frame.height / 2}px) scale(${frame.flipX ? -1 : 1}, ${frame.flipY ? -1 : 1}) translate(${-frame.width / 2}px, ${-frame.height / 2}px)`
        : `rotate(${frame.rotation}deg)`,
    transformOrigin: "top left",
    display: frame.visible ? undefined : "none",
  }
}

function renderSvgFrameTransform(
  frame: Pick<
    RenderFrameProjection,
    "width" | "height" | "rotation" | "flipX" | "flipY"
  >,
  x: number,
  y: number
) {
  const rotation = `rotate(${frame.rotation} ${x} ${y})`
  if (!frame.flipX && !frame.flipY) return rotation
  const centerX = x + frame.width / 2
  const centerY = y + frame.height / 2
  return `${rotation} translate(${centerX} ${centerY}) scale(${frame.flipX ? -1 : 1} ${frame.flipY ? -1 : 1}) translate(${-centerX} ${-centerY})`
}

function renderLocalSvgFrameTransform(frame: RenderFrameProjection) {
  const transform = `translate(${frame.x} ${frame.y}) rotate(${frame.rotation} 0 0)`
  if (!frame.flipX && !frame.flipY) return transform
  return `${transform} translate(${frame.width / 2} ${frame.height / 2}) scale(${frame.flipX ? -1 : 1} ${frame.flipY ? -1 : 1}) translate(${-frame.width / 2} ${-frame.height / 2})`
}

export function renderMaskGroupWrapperStyle(
  bounds: PagePaintBounds
): CSSProperties {
  return {
    position: "absolute",
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    overflow: "hidden",
  }
}

export function renderVectorMaskSourceAttributes(
  source: Extract<SceneNode, { type: "rect" | "ellipse" }>,
  bounds: PagePaintBounds
) {
  const x = source.x - bounds.x
  const y = source.y - bounds.y
  return {
    fill: "white",
    height: source.height,
    opacity: source.opacity,
    rx: source.type === "rect" ? source.radius : source.width / 2,
    ry: source.type === "rect" ? source.radius : source.height / 2,
    transform: renderSvgFrameTransform(
      projectNodeForRender(source).frame,
      x,
      y
    ),
    width: source.width,
    x,
    y,
  }
}

type MaskPaintPlanEntry = Extract<PagePaintPlanEntry, { kind: "mask_group" }>
type VectorMaskPaintEntry = Omit<MaskPaintPlanEntry, "maskType"> &
  Readonly<{ maskType: "vector" }>
type AlphaMaskPaintEntry = Omit<MaskPaintPlanEntry, "maskType"> &
  Readonly<{ maskType: "alpha" }>
type LuminanceMaskPaintEntry = Omit<MaskPaintPlanEntry, "maskType"> &
  Readonly<{ maskType: "luminance" }>
type CoverageMaskPaintEntry = AlphaMaskPaintEntry | LuminanceMaskPaintEntry

const maskImageNaturalSizeCache = new Map<
  string,
  Readonly<{ width: number; height: number }>
>()

function retainMaskImageNaturalSize(
  identity: string,
  naturalSize: Readonly<{ width: number; height: number }>
) {
  maskImageNaturalSizeCache.delete(identity)
  maskImageNaturalSizeCache.set(identity, naturalSize)
  if (maskImageNaturalSizeCache.size > 256) {
    const oldest = maskImageNaturalSizeCache.keys().next().value
    if (oldest) maskImageNaturalSizeCache.delete(oldest)
  }
}

export function shouldCompositeMaskGroup(entry: PagePaintPlanEntry) {
  return (
    entry.kind === "mask_group" && entry.maskEnabled && entry.compositeRequired
  )
}

export function renderViewDevicePixelRatio() {
  const ratio = globalThis.devicePixelRatio
  return supportedMaskPaintPixelRatio(ratio)
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))

/** Numeric oracle for the frozen M4B gamma-encoded sRGB contract. */
export function srgbLuminanceMaskAlpha(
  red: number,
  green: number,
  blue: number,
  alpha: number
) {
  const luminance =
    0.2126 * clampUnit(red) +
    0.7152 * clampUnit(green) +
    0.0722 * clampUnit(blue)
  return clampUnit(luminance * clampUnit(alpha))
}

/** Source-over coverage oracle used after independent luminance conversion. */
export function unionMaskAlphas(alphas: readonly number[]) {
  return clampUnit(
    1 -
      alphas.reduce((remaining, alpha) => remaining * (1 - clampUnit(alpha)), 1)
  )
}

export type MaskGroupRenderModel = Readonly<{
  entry: VectorMaskPaintEntry
  source: Extract<SceneNode, { type: "rect" | "ellipse" | "icon" }>
  sources: readonly Extract<SceneNode, { type: "rect" | "ellipse" | "icon" }>[]
  content: readonly PagePaintPlanEntry[]
  nodesById: ReadonlyMap<string, SceneNode>
}>

export type AlphaMaskGroupRenderModel = Readonly<{
  entry: CoverageMaskPaintEntry
  source: Extract<
    SceneNode,
    { type: "rect" | "ellipse" | "icon" | "image" | "text" }
  >
  sources: readonly Extract<
    SceneNode,
    { type: "rect" | "ellipse" | "icon" | "image" | "text" }
  >[]
  content: readonly PagePaintPlanEntry[]
  nodesById: ReadonlyMap<string, SceneNode>
}>

export type AlphaImageMaskCommitState = Readonly<{
  requestedIdentity: string
  requestedModel: MaskGroupRenderModel | AlphaMaskGroupRenderModel
  committedIdentity: string | null
  committedModel: MaskGroupRenderModel | AlphaMaskGroupRenderModel | null
  requiredResourceIdentities: readonly string[]
  readyResourceIdentities: readonly string[]
  status: "loading" | "ready" | "error"
  errorCode?: MaskSubtreeResourceErrorCode
  errorNodeId?: string
}>

export type AlphaImageMaskCommitEvent =
  | Readonly<{
      type: "request"
      identity: string
      model: MaskGroupRenderModel | AlphaMaskGroupRenderModel
      resourceIdentities?: readonly string[]
    }>
  | Readonly<{
      type: "ready" | "failed"
      identity: string
      resourceIdentity?: string
      errorCode?: MaskSubtreeResourceErrorCode
      errorNodeId?: string
    }>

export function createAlphaImageMaskCommitState(
  identity: string,
  model: MaskGroupRenderModel | AlphaMaskGroupRenderModel,
  resourceIdentities: readonly string[] = [identity]
): AlphaImageMaskCommitState {
  return {
    requestedIdentity: identity,
    requestedModel: model,
    committedIdentity: null,
    committedModel: null,
    requiredResourceIdentities: resourceIdentities,
    readyResourceIdentities: [],
    status: "loading",
  }
}

/**
 * Keeps the last decoded alpha composite mounted until the exact replacement
 * resource is ready. Late or failed candidates cannot replace valid pixels.
 */
export function reduceAlphaImageMaskCommitState(
  state: AlphaImageMaskCommitState,
  event: AlphaImageMaskCommitEvent
): AlphaImageMaskCommitState {
  if (event.type === "request") {
    if (event.identity === state.requestedIdentity) {
      return {
        ...state,
        requestedModel: event.model,
        requiredResourceIdentities:
          event.resourceIdentities ?? state.requiredResourceIdentities,
        committedModel:
          state.committedIdentity === event.identity
            ? event.model
            : state.committedModel,
      }
    }
    return {
      ...state,
      requestedIdentity: event.identity,
      requestedModel: event.model,
      requiredResourceIdentities: event.resourceIdentities ?? [event.identity],
      readyResourceIdentities: [],
      status: "loading",
    }
  }
  if (event.identity !== state.requestedIdentity) return state
  if (event.type === "failed") {
    return {
      ...state,
      status: "error",
      errorCode: event.errorCode,
      errorNodeId: event.errorNodeId,
    }
  }
  const resourceIdentity = event.resourceIdentity ?? event.identity
  if (!state.requiredResourceIdentities.includes(resourceIdentity)) return state
  const readyResourceIdentities = state.readyResourceIdentities.includes(
    resourceIdentity
  )
    ? state.readyResourceIdentities
    : [...state.readyResourceIdentities, resourceIdentity]
  if (
    !state.requiredResourceIdentities.every((required) =>
      readyResourceIdentities.includes(required)
    )
  ) {
    return {
      ...state,
      readyResourceIdentities,
      status: state.status === "error" ? "error" : "loading",
    }
  }
  return {
    ...state,
    committedIdentity: state.requestedIdentity,
    committedModel: state.requestedModel,
    readyResourceIdentities,
    status: "ready",
    errorCode: undefined,
    errorNodeId: undefined,
  }
}

const LUMINANCE_PROBE_EXPECTED_ALPHA = [
  0, 255, 128, 54, 182, 18, 0, 22, 68,
] as const

export function luminanceConversionProbePixelsPass(
  pixels: Uint8ClampedArray,
  tolerance = 3
) {
  return LUMINANCE_PROBE_EXPECTED_ALPHA.every(
    (expected, index) =>
      Math.abs((pixels[index * 4 + 3] ?? Number.NaN) - expected) <= tolerance
  )
}

export async function verifyBrowserLuminanceConversion(): Promise<boolean> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return false
  }
  const colors = [
    ["black", 1],
    ["white", 1],
    ["rgb(128,128,128)", 1],
    ["red", 1],
    ["lime", 1],
    ["blue", 1],
    ["red", 0],
    ["red", 0.4],
  ] as const
  const filter = (id: string) =>
    `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="y"/><feComposite in="y" in2="SourceGraphic" operator="in"/></filter>`
  const filters = colors.map((_, index) => filter(`f${index}`)).join("")
  const outputs = colors
    .map(
      ([color, opacity], index) =>
        `<rect x="${index}" width="1" height="1" fill="${color}" opacity="${opacity}" filter="url(#f${index})"/>`
    )
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="1"><defs>${filters}${filter("overlap-red")}${filter("overlap-green")}</defs>${outputs}<rect x="8" width="1" height="1" fill="red" opacity=".5" filter="url(#overlap-red)"/><rect x="8" width="1" height="1" fill="lime" opacity=".25" filter="url(#overlap-green)"/></svg>`
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  try {
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = 9
    canvas.height = 1
    const context = canvas.getContext("2d", {
      colorSpace: "srgb",
      willReadFrequently: true,
    })
    if (!context) return false
    context.clearRect(0, 0, 9, 1)
    context.drawImage(image, 0, 0)
    return luminanceConversionProbePixelsPass(
      context.getImageData(0, 0, 9, 1, { colorSpace: "srgb" }).data
    )
  } catch {
    return false
  }
}

function maskGroupContent(
  entry: MaskPaintPlanEntry | LuminanceMaskPaintEntry,
  nodesById: ReadonlyMap<string, SceneNode>
) {
  const assertContent = (contentEntry: PagePaintPlanEntry) => {
    if (contentEntry.kind === "mask_group") {
      contentEntry.content.forEach(assertContent)
      return
    }
    const node = nodesById.get(contentEntry.nodeId)
    if (!node)
      throw new Error(`Mask content node ${contentEntry.nodeId} is missing`)
  }
  entry.content.forEach(assertContent)
  return entry.content
}

/**
 * Resolves the admitted vector-mask contract before React creates DOM.
 * The shared page paint plan determines both source suppression and content
 * order, so this renderer cannot accidentally use page order independently.
 */
export function maskGroupRenderModel(
  entry: PagePaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>
): MaskGroupRenderModel {
  if (entry.kind !== "mask_group" || entry.maskType !== "vector") {
    throw new Error("React mask rendering requires a vector mask group entry")
  }
  const canonicalSources = entry.sourceNodeIds.map((sourceId) => {
    const source = nodesById.get(sourceId)
    if (!isAdmittedVectorMaskSource(source)) {
      throw new Error(
        "React vector mask rendering requires rectangle, ellipse, or icon sources"
      )
    }
    return source
  })
  const source = canonicalSources[0]
  if (!source) {
    throw new Error("React vector mask rendering requires a source")
  }
  const content = maskGroupContent(entry, nodesById)
  return {
    entry: entry as VectorMaskPaintEntry,
    source,
    sources: canonicalSources.filter((candidate) =>
      entry.visibleSourceNodeIds.includes(candidate.id)
    ),
    content,
    nodesById,
  }
}

export function alphaMaskGroupRenderModel(
  entry: PagePaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>
): AlphaMaskGroupRenderModel {
  if (entry.kind !== "mask_group" || entry.maskType !== "alpha") {
    throw new Error("React alpha rendering requires an alpha mask group entry")
  }
  const canonicalSources = entry.sourceNodeIds.map((sourceId) => {
    const source = nodesById.get(sourceId)
    if (!isAdmittedAlphaMaskSource(source)) {
      throw new Error(
        "React alpha mask rendering requires rectangle, ellipse, icon, image, or text sources"
      )
    }
    return source
  })
  const source = canonicalSources[0]
  if (!source) {
    throw new Error("React alpha mask rendering requires a source")
  }
  return {
    entry: entry as AlphaMaskPaintEntry,
    source,
    sources: canonicalSources.filter((candidate) =>
      entry.visibleSourceNodeIds.includes(candidate.id)
    ),
    content: maskGroupContent(entry, nodesById),
    nodesById,
  }
}

export function luminanceMaskGroupRenderModel(
  entry: PagePaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>
): AlphaMaskGroupRenderModel {
  if (entry.kind !== "mask_group" || entry.maskType !== "luminance") {
    throw new Error(
      "React luminance rendering requires a luminance mask group entry"
    )
  }
  const canonicalSources = entry.sourceNodeIds.map((sourceId) => {
    const source = nodesById.get(sourceId)
    if (!isAdmittedAlphaMaskSource(source)) {
      throw new Error(
        "React luminance mask rendering requires rectangle, ellipse, icon, image, or text sources"
      )
    }
    return source
  })
  const source = canonicalSources[0]
  if (!source) {
    throw new Error("React luminance mask rendering requires a source")
  }
  return {
    entry: entry as LuminanceMaskPaintEntry,
    source,
    sources: canonicalSources.filter((candidate) =>
      entry.visibleSourceNodeIds.includes(candidate.id)
    ),
    content: maskGroupContent(entry, nodesById),
    nodesById,
  }
}

function RenderVectorMaskSource({
  source,
  bounds,
}: {
  source: Extract<SceneNode, { type: "rect" | "ellipse" | "icon" }>
  bounds: PagePaintBounds
}) {
  const x = source.x - bounds.x
  const y = source.y - bounds.y
  const transform = renderSvgFrameTransform(
    projectNodeForRender(source).frame,
    x,
    y
  )
  if (source.type === "icon") {
    return (
      <svg
        data-mask-source-id={source.id}
        height={source.height}
        opacity={source.opacity}
        overflow="visible"
        preserveAspectRatio="xMidYMid meet"
        transform={transform}
        viewBox={source.viewBox}
        width={source.width}
        x={x}
        y={y}
      >
        <path
          d={source.path}
          fill="white"
          stroke={source.stroke ? "white" : undefined}
          strokeWidth={source.strokeWidth}
        />
      </svg>
    )
  }
  if (
    source.type === "rect" &&
    (((source.independentCorners ?? false) &&
      source.cornerRadii !== undefined) ||
      (source.cornerSmoothing ?? 0) > 0)
  ) {
    const projection = projectNodeForRender(source)
    if (projection.type !== "rect") {
      throw new Error(`Mask source ${source.id} did not project as a rectangle`)
    }
    return (
      <path
        d={roundedRectanglePaintPath({
          width: projection.frame.width,
          height: projection.frame.height,
          cornerRadii: projection.content.corners.radii,
          cornerSmoothing: projection.content.corners.smoothing,
          strokeWidth: projection.content.stroke
            ? projection.content.strokeWidth
            : 0,
        })}
        data-mask-source-id={source.id}
        fill="white"
        opacity={source.opacity}
        stroke={source.stroke ? "white" : undefined}
        strokeWidth={source.strokeWidth}
        transform={renderLocalSvgFrameTransform({
          ...projection.frame,
          x,
          y,
        })}
      />
    )
  }
  const attributes = renderVectorMaskSourceAttributes(source, bounds)
  const shared = {
    ...attributes,
    "data-mask-source-id": source.id,
    stroke: source.stroke ? "white" : undefined,
    strokeOpacity: source.stroke ? source.opacity : undefined,
    strokeWidth: source.strokeWidth,
  }
  return source.type === "ellipse" ? (
    <ellipse
      {...shared}
      cx={x + source.width / 2}
      cy={y + source.height / 2}
      rx={source.width / 2}
      ry={source.height / 2}
    />
  ) : (
    <rect {...shared} />
  )
}

function RenderMaskGroupContent({
  document,
  content,
  nodesById,
  imageSemantics,
  imageResourceRevisions,
  imageResourceTokens,
  showImageRecoveryActions,
  onImageResourceStateChange,
}: {
  document?: Document
  content: readonly PagePaintPlanEntry[]
  nodesById: ReadonlyMap<string, SceneNode>
  imageSemantics: "content" | "thumbnail"
  imageResourceRevisions?: Readonly<Record<string, string | number>>
  imageResourceTokens?: Readonly<Record<string, string>>
  showImageRecoveryActions: boolean
  onImageResourceStateChange?: (state: ImageResourceStateChange) => void
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      {content.map((contentEntry) => {
        if (contentEntry.kind === "mask_group") {
          return (
            <MaskGroupPaintEntry
              key={contentEntry.groupId}
              document={document}
              atomicBoundary={false}
              entry={contentEntry}
              nodesById={nodesById}
              imageSemantics={imageSemantics}
              imageResourceRevisions={imageResourceRevisions}
              imageResourceTokens={imageResourceTokens}
              showImageRecoveryActions={showImageRecoveryActions}
              onImageResourceStateChange={onImageResourceStateChange}
            />
          )
        }
        const node = nodesById.get(contentEntry.nodeId)
        if (!node) return null
        const renderProps = {
          imageSemantics,
          imageResourceRevision: imageResourceRevisions?.[node.id],
          imageResourceToken: imageResourceTokens?.[node.id],
          showImageRecoveryActions,
          onImageResourceStateChange,
        }
        return document ? (
          <FrameClippedRenderNode
            {...renderProps}
            key={node.id}
            document={document}
            node={node}
          />
        ) : (
          <RenderNode {...renderProps} key={node.id} node={node} />
        )
      })}
    </div>
  )
}

/**
 * Renders one schema-backed vector-mask entry from the canonical paint plan.
 */
type MaskGroupPaintEntryProps = Readonly<{
  document?: Document
  entry: PagePaintPlanEntry
  nodesById: ReadonlyMap<string, SceneNode>
  imageSemantics?: "content" | "thumbnail"
  imageResourceRevisions?: Readonly<Record<string, string | number>>
  imageResourceTokens?: Readonly<Record<string, string>>
  showImageRecoveryActions?: boolean
  onImageResourceStateChange?: (state: ImageResourceStateChange) => void
  atomicBoundary?: boolean
}>

type MaskSubtreeResourceErrorCode =
  "image_load_failed" | "font_load_failed" | "luminance_conversion_failed"

type MaskSubtreeResource =
  | Readonly<{
      kind: "image"
      identity: string
      node: Extract<SceneNode, { type: "image" }>
    }>
  | Readonly<{
      kind: "font"
      identity: string
      nodeId: string
      requests: readonly Readonly<{ descriptor: string; sample: string }>[]
    }>
  | Readonly<{
      kind: "luminance"
      identity: string
      nodeId: string
    }>

function maskTextFontRequests(node: Extract<SceneNode, { type: "text" }>) {
  const requests = new Map<string, Set<string>>()
  const add = (
    family: string,
    size: number,
    weight: number,
    italic: boolean,
    sample: string
  ) => {
    const descriptor = `${italic ? "italic " : ""}${weight} ${size}px ${JSON.stringify(family)}`
    const codePoints = requests.get(descriptor) ?? new Set<string>()
    for (const codePoint of sample || "M") codePoints.add(codePoint)
    requests.set(descriptor, codePoints)
  }
  add(node.fontFamily, node.fontSize, node.fontWeight, node.italic, node.text)
  for (const run of node.runs) {
    add(
      run.style.fontFamily ?? node.fontFamily,
      run.style.fontSize ?? node.fontSize,
      run.style.fontWeight ?? node.fontWeight,
      run.style.italic ?? node.italic,
      node.text.slice(run.start, run.end)
    )
  }
  return [...requests].map(([descriptor, codePoints]) => ({
    descriptor,
    sample: [...codePoints].join(""),
  }))
}

function maskSubtreeResources(
  entry: MaskPaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>,
  imageResourceRevisions?: Readonly<Record<string, string | number>>
) {
  const resources = new Map<string, MaskSubtreeResource>()
  const addNode = (nodeId: string) => {
    const node = nodesById.get(nodeId)
    if (!node?.visible) return
    if (node.type === "image") {
      const identity = `image:${imageResourceIdentity(
        node.id,
        node.src,
        imageResourceRevisions?.[node.id]
      )}`
      resources.set(identity, { kind: "image", identity, node })
    } else if (node.type === "text") {
      const requests = maskTextFontRequests(node)
      const identity = `font:${node.id}:${JSON.stringify(requests)}`
      resources.set(identity, {
        kind: "font",
        identity,
        nodeId: node.id,
        requests,
      })
    }
  }
  const visit = (candidate: PagePaintPlanEntry) => {
    if (candidate.kind === "node") {
      addNode(candidate.nodeId)
      return
    }
    for (const sourceNodeId of candidate.visibleSourceNodeIds) {
      addNode(sourceNodeId)
    }
    for (const contentEntry of candidate.content) visit(contentEntry)
    if (candidate.maskType === "luminance" && candidate.compositeRequired) {
      const nodeId = candidate.visibleSourceNodeIds[0]!
      const identity = `luminance:${candidate.groupId}:${nodeId}`
      resources.set(identity, { kind: "luminance", identity, nodeId })
    }
  }
  visit(entry)
  return [...resources.values()]
}

function maskSubtreeNodes(
  entry: MaskPaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>
) {
  const nodeIds: string[] = []
  const visit = (candidate: PagePaintPlanEntry) => {
    if (candidate.kind === "node") {
      nodeIds.push(candidate.nodeId)
      return
    }
    nodeIds.push(...candidate.sourceNodeIds)
    candidate.content.forEach(visit)
  }
  visit(entry)
  return nodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId)
    return node ? [node] : []
  })
}

export function MaskGroupPaintEntry(props: MaskGroupPaintEntryProps) {
  const model = useMemo(
    () =>
      props.entry.kind === "mask_group" && props.entry.maskType !== "vector"
        ? props.entry.maskType === "luminance"
          ? luminanceMaskGroupRenderModel(props.entry, props.nodesById)
          : alphaMaskGroupRenderModel(props.entry, props.nodesById)
        : maskGroupRenderModel(props.entry, props.nodesById),
    [props.entry, props.nodesById]
  )
  const resources =
    props.atomicBoundary === false
      ? []
      : maskSubtreeResources(
          model.entry,
          props.nodesById,
          props.imageResourceRevisions
        )
  if (resources.length > 0) {
    return (
      <AtomicMaskSubtreePaintEntry
        {...props}
        model={model}
        resources={resources}
      />
    )
  }
  return <ResolvedMaskGroupPaintEntry {...props} model={model} />
}

function AtomicMaskSubtreePaintEntry({
  model,
  resources,
  imageSemantics = "content",
  imageResourceRevisions,
  imageResourceTokens,
  showImageRecoveryActions = true,
  onImageResourceStateChange,
}: MaskGroupPaintEntryProps & {
  model: MaskGroupRenderModel | AlphaMaskGroupRenderModel
  resources: readonly MaskSubtreeResource[]
}) {
  const imageResources = resources.filter(
    (resource): resource is Extract<MaskSubtreeResource, { kind: "image" }> =>
      resource.kind === "image"
  )
  const fontResources = resources.filter(
    (resource): resource is Extract<MaskSubtreeResource, { kind: "font" }> =>
      resource.kind === "font"
  )
  const luminanceResources = resources.filter(
    (
      resource
    ): resource is Extract<MaskSubtreeResource, { kind: "luminance" }> =>
      resource.kind === "luminance"
  )
  const identity = JSON.stringify({
    entry: model.entry,
    nodes: maskSubtreeNodes(model.entry, model.nodesById),
    imageResourceRevisions,
  })
  const requiredResourceIdentities = resources.map(
    (resource) => resource.identity
  )
  const [commit, dispatchCommit] = useReducer(
    reduceAlphaImageMaskCommitState,
    undefined,
    () =>
      createAlphaImageMaskCommitState(
        identity,
        model,
        requiredResourceIdentities
      )
  )
  useEffect(() => {
    dispatchCommit({
      type: "request",
      identity,
      model,
      resourceIdentities: requiredResourceIdentities,
    })
  }, [identity, model])

  const handleProbeStateChange = (
    resource: Extract<MaskSubtreeResource, { kind: "image" }>,
    state: ImageResourceStateChange
  ) => {
    if (state.readiness === "ready" && state.naturalSize) {
      retainMaskImageNaturalSize(resource.identity, state.naturalSize)
    }
    dispatchCommit({
      type: state.readiness === "ready" ? "ready" : "failed",
      identity,
      resourceIdentity: resource.identity,
      errorCode: state.readiness === "ready" ? undefined : "image_load_failed",
      errorNodeId: state.readiness === "ready" ? undefined : resource.node.id,
    })
    const resourceToken = imageResourceTokens?.[resource.node.id]
    if (resourceToken) {
      onImageResourceStateChange?.({ ...state, token: resourceToken })
    }
  }
  const needsProbe = commit.committedIdentity !== identity
  const handleResourceResult = useCallback(
    (
      ready: boolean,
      resource: Extract<MaskSubtreeResource, { kind: "font" | "luminance" }>
    ) =>
      dispatchCommit({
        type: ready ? "ready" : "failed",
        identity,
        resourceIdentity: resource.identity,
        errorCode: ready
          ? undefined
          : resource.kind === "font"
            ? "font_load_failed"
            : "luminance_conversion_failed",
        errorNodeId: ready ? undefined : resource.nodeId,
      }),
    [identity]
  )

  return (
    <>
      {commit.committedModel ? (
        <ResolvedMaskGroupPaintEntry
          imageSemantics={imageSemantics}
          imageResourceRevisions={imageResourceRevisions}
          imageResourceTokens={imageResourceTokens}
          showImageRecoveryActions={showImageRecoveryActions}
          onImageResourceStateChange={onImageResourceStateChange}
          entry={commit.committedModel.entry}
          model={commit.committedModel}
          nodesById={commit.committedModel.nodesById}
          resourceErrorCode={commit.errorCode}
          resourceErrorNodeId={commit.errorNodeId}
          resourceState={commit.status}
        />
      ) : (
        <div
          data-mask-group-id={model.entry.groupId}
          data-mask-resource-error={commit.errorCode}
          data-mask-resource-error-node={commit.errorNodeId}
          data-mask-resource-state={commit.status}
          style={renderMaskGroupWrapperStyle(model.entry.bounds)}
        />
      )}
      {needsProbe
        ? imageResources.map((resource) => {
            if (commit.readyResourceIdentities.includes(resource.identity)) {
              return null
            }
            return (
              <div
                aria-hidden
                key={resource.identity}
                data-alpha-mask-resource-probe={resource.node.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  pointerEvents: "none",
                  visibility: "hidden",
                }}
              >
                <RenderNode
                  imageSemantics={imageSemantics}
                  imageResourceRevision={
                    imageResourceRevisions?.[resource.node.id]
                  }
                  imageResourceToken={`mask-subtree:${resource.identity}`}
                  node={resource.node}
                  showImageRecoveryActions={false}
                  suppressImageFailureFeedback
                  onImageResourceStateChange={(state) =>
                    handleProbeStateChange(resource, state)
                  }
                />
              </div>
            )
          })
        : null}
      {needsProbe
        ? fontResources.map((resource) =>
            commit.readyResourceIdentities.includes(
              resource.identity
            ) ? null : (
              <FontReadinessProbe
                key={resource.identity}
                identity={identity}
                resource={resource}
                onResult={handleResourceResult}
              />
            )
          )
        : null}
      {needsProbe
        ? luminanceResources.map((resource) =>
            commit.readyResourceIdentities.includes(
              resource.identity
            ) ? null : (
              <LuminanceConversionProbe
                key={resource.identity}
                identity={identity}
                sourceNodeId={resource.nodeId}
                onResult={(ready) => handleResourceResult(ready, resource)}
              />
            )
          )
        : null}
    </>
  )
}

function FontReadinessProbe({
  identity,
  resource,
  onResult,
}: {
  identity: string
  resource: Extract<MaskSubtreeResource, { kind: "font" }>
  onResult: (
    ready: boolean,
    resource: Extract<MaskSubtreeResource, { kind: "font" }>
  ) => void
}) {
  useEffect(() => {
    let current = true
    const fonts = globalThis.document?.fonts
    if (!fonts) {
      onResult(true, resource)
      return () => {
        current = false
      }
    }
    void Promise.all(
      resource.requests.map(({ descriptor, sample }) =>
        fonts.load(descriptor, sample)
      )
    ).then(
      () => {
        if (!current) return
        onResult(
          resource.requests.every(({ descriptor, sample }) =>
            fonts.check(descriptor, sample)
          ),
          resource
        )
      },
      () => {
        if (current) onResult(false, resource)
      }
    )
    return () => {
      current = false
    }
  }, [identity, onResult, resource])
  return (
    <span
      aria-hidden
      data-mask-font-resource-probe={resource.nodeId}
      style={{ display: "none" }}
    />
  )
}

function LuminanceConversionProbe({
  identity,
  sourceNodeId,
  onResult,
}: {
  identity: string
  sourceNodeId: string
  onResult: (ready: boolean, sourceNodeId: string) => void
}) {
  useEffect(() => {
    let current = true
    void verifyBrowserLuminanceConversion().then((ready) => {
      if (current) onResult(ready, sourceNodeId)
    })
    return () => {
      current = false
    }
  }, [identity, onResult, sourceNodeId])
  return (
    <span
      aria-hidden
      data-luminance-conversion-probe={sourceNodeId}
      style={{ display: "none" }}
    />
  )
}

function RenderCoverageMaskSource({
  source,
  bounds,
  imageResourceRevisions,
  maskType,
}: {
  source: AlphaMaskGroupRenderModel["source"]
  bounds: PagePaintBounds
  imageResourceRevisions?: Readonly<Record<string, string | number>>
  maskType: "alpha" | "luminance"
}) {
  const localId = useId().replaceAll(":", "")
  if (isAdmittedVectorMaskSource(source)) {
    if (maskType === "alpha") {
      return <RenderVectorMaskSource bounds={bounds} source={source} />
    }
    const projection = projectNodeForRender(source)
    const frameX = projection.frame.x - bounds.x
    const frameY = projection.frame.y - bounds.y
    const transform = renderSvgFrameTransform(projection.frame, frameX, frameY)
    if (projection.type === "rect") {
      if (
        projection.content.corners.independent ||
        projection.content.corners.smoothing > 0
      ) {
        return (
          <path
            d={roundedRectanglePaintPath({
              width: projection.frame.width,
              height: projection.frame.height,
              cornerRadii: projection.content.corners.radii,
              cornerSmoothing: projection.content.corners.smoothing,
              strokeWidth: projection.content.stroke
                ? projection.content.strokeWidth
                : 0,
            })}
            data-mask-source-id={source.id}
            fill={projection.content.fill}
            fillOpacity={projection.frame.opacity}
            stroke={projection.content.stroke ?? undefined}
            strokeOpacity={
              projection.content.stroke ? projection.frame.opacity : undefined
            }
            strokeWidth={projection.content.strokeWidth}
            transform={renderLocalSvgFrameTransform({
              ...projection.frame,
              x: frameX,
              y: frameY,
            })}
          />
        )
      }
      return (
        <rect
          data-mask-source-id={source.id}
          fill={projection.content.fill}
          fillOpacity={projection.frame.opacity}
          height={projection.frame.height}
          rx={projection.content.radius}
          ry={projection.content.radius}
          stroke={projection.content.stroke ?? undefined}
          strokeOpacity={
            projection.content.stroke ? projection.frame.opacity : undefined
          }
          strokeWidth={projection.content.strokeWidth}
          transform={transform}
          width={projection.frame.width}
          x={frameX}
          y={frameY}
        />
      )
    }
    if (projection.type === "ellipse") {
      return (
        <ellipse
          cx={frameX + projection.frame.width / 2}
          cy={frameY + projection.frame.height / 2}
          data-mask-source-id={source.id}
          fill={projection.content.fill}
          fillOpacity={projection.frame.opacity}
          rx={projection.frame.width / 2}
          ry={projection.frame.height / 2}
          stroke={projection.content.stroke ?? undefined}
          strokeOpacity={
            projection.content.stroke ? projection.frame.opacity : undefined
          }
          strokeWidth={projection.content.strokeWidth}
          transform={transform}
        />
      )
    }
    if (projection.type === "icon") {
      return (
        <svg
          data-mask-source-id={source.id}
          height={projection.frame.height}
          opacity={projection.frame.opacity}
          overflow="visible"
          preserveAspectRatio="xMidYMid meet"
          transform={transform}
          viewBox={projection.content.viewBox}
          width={projection.frame.width}
          x={frameX}
          y={frameY}
        >
          <path
            d={projection.content.path}
            fill={projection.content.fill}
            stroke={projection.content.stroke ?? undefined}
            strokeWidth={projection.content.strokeWidth}
          />
        </svg>
      )
    }
  }

  if (source.type === "image") {
    const identity = `image:${imageResourceIdentity(
      source.id,
      source.src,
      imageResourceRevisions?.[source.id]
    )}`
    const naturalSize = maskImageNaturalSizeCache.get(identity)
    if (!naturalSize) return <g data-mask-source-id={source.id} />
    const paint = projectImagePaint({
      frame: source,
      naturalSize,
      placement: source.placement,
      frameMask: source.frameMask,
    })
    const clipId = `studio-mask-image-${localId}`
    const frameX = source.x - bounds.x
    const frameY = source.y - bounds.y
    return (
      <g
        clipPath={`url(#${clipId})`}
        data-mask-source-id={source.id}
        opacity={source.opacity}
        transform={renderLocalSvgFrameTransform({
          ...projectNodeForRender(source).frame,
          x: frameX,
          y: frameY,
        })}
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            {paint.clip.shape === "ellipse" ? (
              <ellipse
                cx={paint.clip.centerX}
                cy={paint.clip.centerY}
                rx={paint.clip.radiusX}
                ry={paint.clip.radiusY}
              />
            ) : paint.clip.shape === "rounded_rectangle" &&
              paint.clip.cornerRadii &&
              ((paint.clip.cornerSmoothing ?? 0) > 0 ||
                new Set(Object.values(paint.clip.cornerRadii)).size > 1) ? (
              <path
                d={roundedRectanglePath({
                  width: paint.clip.width,
                  height: paint.clip.height,
                  cornerRadii: paint.clip.cornerRadii,
                  cornerSmoothing: paint.clip.cornerSmoothing ?? 0,
                })}
              />
            ) : (
              <rect
                height={source.height}
                rx={
                  paint.clip.shape === "rounded_rectangle"
                    ? paint.clip.radius
                    : 0
                }
                ry={
                  paint.clip.shape === "rounded_rectangle"
                    ? paint.clip.radius
                    : 0
                }
                width={source.width}
                x={0}
                y={0}
              />
            )}
          </clipPath>
        </defs>
        <image
          height={naturalSize.height}
          href={source.src}
          preserveAspectRatio="none"
          transform={`matrix(${paint.sourceToFrame.a} ${paint.sourceToFrame.b} ${paint.sourceToFrame.c} ${paint.sourceToFrame.d} ${paint.sourceToFrame.e} ${paint.sourceToFrame.f})`}
          width={naturalSize.width}
          x={0}
          y={0}
        />
      </g>
    )
  }

  if (source.type === "text") {
    const projection = projectNodeForRender(source)
    if (projection.type !== "text") return null
    const clipId = `studio-mask-text-${localId}`
    const frameX = source.x - bounds.x
    const frameY = source.y - bounds.y
    let lineTop = 0
    return (
      <g
        clipPath={
          projection.content.sizingMode === "fixed"
            ? `url(#${clipId})`
            : undefined
        }
        data-mask-source-id={source.id}
        opacity={source.opacity}
        transform={renderLocalSvgFrameTransform({
          ...projection.frame,
          x: frameX,
          y: frameY,
        })}
      >
        <defs>
          <clipPath id={clipId}>
            <rect height={source.height} width={source.width} x={0} y={0} />
          </clipPath>
        </defs>
        {projection.content.layout.lines.map((line, lineIndex) => {
          const y = lineTop
          lineTop += line.height
          const x =
            line.align === "center"
              ? source.width / 2
              : line.align === "right"
                ? source.width
                : 0
          const textAnchor =
            line.align === "center"
              ? "middle"
              : line.align === "right"
                ? "end"
                : "start"
          return (
            <text
              dominantBaseline="text-before-edge"
              key={`${line.sourceStart}:${line.sourceEnd}:${lineIndex}`}
              textAnchor={textAnchor}
              wordSpacing={line.justifySpacing || undefined}
              x={x}
              y={y}
            >
              {line.segments.map((segment, segmentIndex) => (
                <tspan
                  fill={segment.style.color}
                  fontFamily={`${segment.style.fontFamily}, sans-serif`}
                  fontSize={segment.style.fontSize}
                  fontStyle={segment.style.italic ? "italic" : "normal"}
                  fontWeight={segment.style.fontWeight}
                  key={`${segment.sourceStart}:${segment.sourceEnd}:${segmentIndex}`}
                  letterSpacing={segment.style.letterSpacing}
                  textDecoration={
                    segment.style.decoration === "line_through"
                      ? "line-through"
                      : segment.style.decoration
                  }
                >
                  {segment.text}
                </tspan>
              ))}
            </text>
          )
        })}
      </g>
    )
  }

  return null
}

function ResolvedMaskGroupPaintEntry({
  document,
  model,
  imageSemantics = "content",
  imageResourceRevisions,
  imageResourceTokens,
  showImageRecoveryActions = true,
  onImageResourceStateChange,
  resourceErrorCode,
  resourceErrorNodeId,
  resourceState,
}: MaskGroupPaintEntryProps & {
  model: MaskGroupRenderModel | AlphaMaskGroupRenderModel
  resourceErrorCode?: MaskSubtreeResourceErrorCode
  resourceErrorNodeId?: string
  resourceState?: "loading" | "ready" | "error"
}) {
  const { content, entry: maskEntry, sources } = model
  const maskId = `studio-mask-${useId().replaceAll(":", "")}`
  const luminanceFilterIds =
    maskEntry.maskType === "luminance"
      ? sources.map(
          (source, index) =>
            `${maskId}-luminance-${index}-${source.id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`
        )
      : []
  const wrapperStyle = renderMaskGroupWrapperStyle(maskEntry.bounds)
  const contentProps = {
    document,
    content,
    nodesById: model.nodesById,
    imageSemantics,
    imageResourceRevisions,
    imageResourceTokens,
    showImageRecoveryActions,
    onImageResourceStateChange,
  }

  if (!shouldCompositeMaskGroup(maskEntry)) {
    return (
      <div
        data-mask-group-id={maskEntry.groupId}
        data-mask-resource-error={resourceErrorCode}
        data-mask-resource-error-node={resourceErrorNodeId}
        data-mask-resource-state={resourceState}
        style={wrapperStyle}
      >
        <div
          style={{
            position: "absolute",
            left: -maskEntry.bounds.x,
            top: -maskEntry.bounds.y,
            width: "100%",
            height: "100%",
          }}
        >
          <RenderMaskGroupContent {...contentProps} />
        </div>
      </div>
    )
  }

  return (
    <svg
      data-mask-group-id={maskEntry.groupId}
      data-mask-resource-error={resourceErrorCode}
      data-mask-resource-error-node={resourceErrorNodeId}
      data-mask-resource-state={resourceState}
      role="presentation"
      style={wrapperStyle}
      viewBox={`0 0 ${maskEntry.bounds.width} ${maskEntry.bounds.height}`}
    >
      <defs>
        {luminanceFilterIds.map((filterId, index) => (
          <filter
            key={filterId}
            id={filterId}
            x={0}
            y={0}
            width={maskEntry.bounds.width}
            height={maskEntry.bounds.height}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
            data-luminance-source-id={sources[index]!.id}
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.2126 0.7152 0.0722 0 0"
              result={`${filterId}-luminance`}
            />
            <feComposite
              in={`${filterId}-luminance`}
              in2="SourceGraphic"
              operator="in"
              result={`${filterId}-luminance-alpha`}
            />
          </filter>
        ))}
        <mask
          height={maskEntry.bounds.height}
          id={maskId}
          maskUnits="userSpaceOnUse"
          style={{ maskType: "alpha" }}
          width={maskEntry.bounds.width}
          x={0}
          y={0}
        >
          {maskEntry.maskType === "vector"
            ? sources.map((source) => (
                <RenderVectorMaskSource
                  key={source.id}
                  bounds={maskEntry.bounds}
                  source={source as MaskGroupRenderModel["source"]}
                />
              ))
            : sources.map((source, index) => {
                const rendered = (
                  <RenderCoverageMaskSource
                    bounds={maskEntry.bounds}
                    imageResourceRevisions={imageResourceRevisions}
                    maskType={maskEntry.maskType}
                    source={source}
                  />
                )
                return maskEntry.maskType === "luminance" ? (
                  <g
                    key={source.id}
                    data-luminance-source-isolation={source.id}
                    filter={`url(#${luminanceFilterIds[index]})`}
                  >
                    {rendered}
                  </g>
                ) : (
                  <g key={source.id}>{rendered}</g>
                )
              })}
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <foreignObject
          height={maskEntry.bounds.height}
          width={maskEntry.bounds.width}
          x={0}
          y={0}
        >
          <div
            style={{
              position: "absolute",
              left: -maskEntry.bounds.x,
              top: -maskEntry.bounds.y,
              width: "100%",
              height: "100%",
            }}
          >
            <RenderMaskGroupContent {...contentProps} />
          </div>
        </foreignObject>
      </g>
    </svg>
  )
}

/** Shared page consumer used by production Artboards and conformance views. */
export function PagePaintPlanView({
  document,
  plan,
  nodesById,
  width,
  height,
  background,
}: {
  document?: Document
  plan: PagePaintPlan
  nodesById: ReadonlyMap<string, SceneNode>
  width: number
  height: number
  background: string
}) {
  return (
    <div
      data-page-paint-plan={plan.pageId}
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background,
      }}
    >
      {plan.entries.map((entry) => {
        if (entry.kind === "mask_group") {
          return (
            <MaskGroupPaintEntry
              key={entry.groupId}
              document={document}
              entry={entry}
              nodesById={nodesById}
              showImageRecoveryActions={false}
            />
          )
        }
        const node = nodesById.get(entry.nodeId)
        if (!node) return null
        const props = {
          key: node.id,
          imageSemantics: "content" as const,
          node,
          showImageRecoveryActions: false,
        }
        return document ? (
          <FrameClippedRenderNode {...props} document={document} />
        ) : (
          <RenderNode {...props} />
        )
      })}
    </div>
  )
}

export function renderTextLineStyle(line: ProjectedTextLine): CSSProperties {
  return {
    display: "block",
    height: line.height,
    lineHeight: `${line.height}px`,
    textAlign: line.align === "justify" ? "left" : line.align,
    wordSpacing: line.justifySpacing || undefined,
    whiteSpace: "pre",
  }
}

export function renderTextSegmentStyle(
  segment: ProjectedTextSegment,
  line: ProjectedTextLine
): CSSProperties {
  return {
    color: segment.style.color,
    fontFamily: `${segment.style.fontFamily}, sans-serif`,
    fontSize: segment.style.fontSize,
    fontWeight: segment.style.fontWeight,
    fontStyle: segment.style.italic ? "italic" : "normal",
    textDecorationLine:
      segment.style.decoration === "line_through"
        ? "line-through"
        : segment.style.decoration,
    letterSpacing: segment.style.letterSpacing,
    lineHeight: `${line.height}px`,
  }
}

function RenderTextContent({
  projection,
}: {
  projection: Extract<RenderNodeProjection, { type: "text" }>
}) {
  return projection.content.layout.lines.map((line, lineIndex) => (
    <span
      data-text-line={lineIndex}
      key={`${line.sourceStart}:${line.sourceEnd}:${lineIndex}`}
      style={renderTextLineStyle(line)}
    >
      {line.segments.map((segment, segmentIndex) => {
        const content = (
          <span
            data-text-source-end={segment.sourceEnd}
            data-text-source-start={segment.sourceStart}
            data-text-synthetic={segment.synthetic ? "true" : undefined}
            key={`${segment.sourceStart}:${segment.sourceEnd}:${segmentIndex}`}
            style={renderTextSegmentStyle(segment, line)}
          >
            {segment.text}
          </span>
        )
        return segment.link ? (
          <a
            href={segment.link.target}
            key={`link:${segment.sourceStart}:${segment.sourceEnd}:${segmentIndex}`}
            rel={segment.link.newTab ? "noopener noreferrer" : undefined}
            style={{
              color: "inherit",
              pointerEvents: "none",
              textDecoration: "inherit",
            }}
            tabIndex={-1}
            target={segment.link.newTab ? "_blank" : undefined}
          >
            {content}
          </a>
        ) : (
          content
        )
      })}
    </span>
  ))
}

export const renderNodeDataAttributes = (projection: RenderNodeProjection) => {
  const shared = {
    "data-node-id": projection.frame.id,
    "data-node-locked": projection.frame.locked ? "true" : "false",
  }
  return projection.type === "text"
    ? {
        ...shared,
        "data-text-sizing-mode": projection.content.sizingMode,
        "data-text-measurement": projection.content.layout.measurement,
        "data-text-line-count": projection.content.layout.lineCount,
        "data-text-source-line-count":
          projection.content.layout.sourceLineCount,
        "data-text-direction": projection.content.direction,
        "data-text-vertical-align": projection.content.verticalAlign,
        "data-text-case": projection.content.textCase,
        "data-text-truncated": projection.content.layout.truncated
          ? "true"
          : "false",
        "data-text-overflow": projection.content.layout.overflow
          ? "true"
          : "false",
        "data-text-overflow-x": projection.content.layout.overflowX
          ? "true"
          : "false",
        "data-text-overflow-y": projection.content.layout.overflowY
          ? "true"
          : "false",
      }
    : shared
}

export function renderNodeStyle(
  projection: RenderNodeProjection
): CSSProperties {
  const frame = renderFrameStyle(projection.frame)
  if (projection.type === "text") {
    const text = projection.content
    return {
      ...frame,
      color: text.color,
      fontFamily: `${text.fontFamily}, sans-serif`,
      fontSize: text.fontSize,
      fontWeight: text.fontWeight,
      lineHeight: text.lineHeight,
      letterSpacing: text.letterSpacing,
      textRendering: "geometricPrecision",
      WebkitFontSmoothing: "antialiased",
      textAlign: text.align,
      direction: text.direction,
      display: projection.frame.visible ? "flex" : "none",
      flexDirection: "column",
      justifyContent:
        text.verticalAlign === "middle"
          ? "center"
          : text.verticalAlign === "bottom"
            ? "flex-end"
            : "flex-start",
      whiteSpace: text.whiteSpace,
      overflowWrap: text.overflowWrap,
      overflow: text.sizingMode === "fixed" ? "hidden" : "visible",
    }
  }
  if (projection.type === "rect" || projection.type === "frame") {
    const rect = projection.content
    return {
      ...frame,
      background: rect.fill,
      border: rect.stroke
        ? `${rect.strokeWidth}px solid ${rect.stroke}`
        : undefined,
      borderRadius: rect.radius,
      ...(rect.corners.independent
        ? { borderRadius: cornerRadiiCss(rect.corners.radii) }
        : {}),
      clipPath:
        rect.corners.smoothing > 0 ? `path('${rect.corners.path}')` : undefined,
    }
  }
  if (projection.type === "ellipse") {
    const ellipse = projection.content
    return {
      ...frame,
      background: ellipse.fill,
      border: ellipse.stroke
        ? `${ellipse.strokeWidth}px solid ${ellipse.stroke}`
        : undefined,
      borderRadius: "50%",
    }
  }
  if (projection.type === "image") {
    return {
      ...frame,
      ...renderImageFrameMaskStyle(
        projection.frame,
        projection.content.frameMask
      ),
    }
  }
  return frame
}

type ShapePaintProjection = Extract<
  RenderNodeProjection,
  { type: "rect" | "frame" | "ellipse" | "line" | "icon" }
>

function RenderShapePaintStack({
  projection,
  dataAttributes,
}: {
  projection: ShapePaintProjection
  dataAttributes: ReturnType<typeof renderNodeDataAttributes>
}) {
  const paintStyle = (paint: {
    opacity: number
    visible: boolean
    blendMode: string
  }): CSSProperties => ({
    opacity: paint.opacity,
    display: paint.visible ? undefined : "none",
    mixBlendMode: paint.blendMode as CSSProperties["mixBlendMode"],
  })
  const frameStyle = {
    ...renderFrameStyle(projection.frame),
    overflow: "visible",
  }
  const strokeAttributes = (paint: {
    dash: number[]
    cap: "butt" | "round" | "square"
    join: "miter" | "round" | "bevel"
    miterLimit: number
  }) => ({
    strokeDasharray: paint.dash.length ? paint.dash.join(" ") : undefined,
    strokeLinecap: paint.cap,
    strokeLinejoin: paint.join,
    strokeMiterlimit: paint.miterLimit,
  })
  if (projection.type === "line") {
    return (
      <svg
        {...dataAttributes}
        style={frameStyle}
        viewBox={`0 0 ${projection.frame.width} ${projection.frame.height}`}
        preserveAspectRatio="none"
      >
        {projection.content.strokes.map((paint) => (
          <line
            key={paint.id}
            x1="0"
            y1="0"
            x2={projection.frame.width}
            y2={projection.frame.height}
            stroke={paint.color}
            strokeWidth={paint.width}
            {...strokeAttributes(paint)}
            style={paintStyle(paint)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    )
  }
  if (projection.type === "icon") {
    return (
      <svg
        {...dataAttributes}
        style={frameStyle}
        viewBox={projection.content.viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        {projection.content.fills.map((paint) => (
          <path
            key={`fill:${paint.id}`}
            d={projection.content.path}
            fill={paint.color}
            style={paintStyle(paint)}
          />
        ))}
        {projection.content.strokes.map((paint) => (
          <path
            key={`stroke:${paint.id}`}
            d={projection.content.path}
            fill="none"
            stroke={paint.color}
            strokeWidth={paint.width}
            {...strokeAttributes(paint)}
            style={paintStyle(paint)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    )
  }
  const shape = (
    paint: {
      id: string
      color: string
      opacity: number
      visible: boolean
      blendMode: string
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
    const attributes = {
      key: `${kind}:${paint.id}`,
      fill: kind === "fill" ? paint.color : "none",
      stroke: kind === "stroke" ? paint.color : undefined,
      strokeWidth: kind === "stroke" ? paint.width : undefined,
      style: paintStyle(paint),
      vectorEffect: "non-scaling-stroke" as const,
      ...(kind === "stroke"
        ? strokeAttributes({
            dash: paint.dash ?? [],
            cap: paint.cap ?? "butt",
            join: paint.join ?? "miter",
            miterLimit: paint.miterLimit ?? 4,
          })
        : {}),
    }
    const inset =
      kind === "stroke"
        ? strokeGeometryInset({
            width: paint.width ?? 0,
            alignment: paint.alignment,
          })
        : 0
    if (projection.type === "ellipse") {
      return (
        <ellipse
          {...attributes}
          cx={projection.frame.width / 2}
          cy={projection.frame.height / 2}
          rx={Math.max(0, projection.frame.width / 2 - inset)}
          ry={Math.max(0, projection.frame.height / 2 - inset)}
        />
      )
    }
    const advancedCorners =
      projection.content.corners.independent ||
      projection.content.corners.smoothing > 0
    if (
      kind === "stroke" &&
      paint.sides &&
      !Object.values(paint.sides).every(Boolean)
    ) {
      const x1 = inset
      const y1 = inset
      const x2 = projection.frame.width - inset
      const y2 = projection.frame.height - inset
      return (
        <g key={`${kind}:${paint.id}`} style={paintStyle(paint)}>
          {paint.sides.top ? (
            <line {...attributes} x1={x1} y1={y1} x2={x2} y2={y1} />
          ) : null}
          {paint.sides.right ? (
            <line {...attributes} x1={x2} y1={y1} x2={x2} y2={y2} />
          ) : null}
          {paint.sides.bottom ? (
            <line {...attributes} x1={x2} y1={y2} x2={x1} y2={y2} />
          ) : null}
          {paint.sides.left ? (
            <line {...attributes} x1={x1} y1={y2} x2={x1} y2={y1} />
          ) : null}
        </g>
      )
    }
    return advancedCorners ? (
      <path
        {...attributes}
        d={roundedRectanglePaintPath({
          width: Math.max(0, projection.frame.width - inset * 2),
          height: Math.max(0, projection.frame.height - inset * 2),
          cornerRadii: projection.content.corners.radii,
          cornerSmoothing: projection.content.corners.smoothing,
          strokeWidth: kind === "stroke" ? (paint.width ?? 0) : 0,
        })}
        transform={inset ? `translate(${inset} ${inset})` : undefined}
      />
    ) : (
      <rect
        {...attributes}
        x={inset}
        y={inset}
        width={Math.max(0, projection.frame.width - inset * 2)}
        height={Math.max(0, projection.frame.height - inset * 2)}
        rx={projection.content.radius}
        ry={projection.content.radius}
      />
    )
  }
  return (
    <svg
      {...dataAttributes}
      style={frameStyle}
      viewBox={`0 0 ${projection.frame.width} ${projection.frame.height}`}
      preserveAspectRatio="none"
    >
      {projection.content.fills.map((paint) => shape(paint, "fill"))}
      {projection.content.strokes.map((paint) => shape(paint, "stroke"))}
    </svg>
  )
}

function RenderNode({
  node,
  imageSemantics,
  imageResourceRevision,
  imageResourceToken,
  showImageRecoveryActions,
  suppressImageFailureFeedback = false,
  onImageResourceStateChange,
}: {
  node: SceneNode
  imageSemantics: "content" | "thumbnail"
  imageResourceRevision?: string | number
  imageResourceToken?: string
  showImageRecoveryActions: boolean
  suppressImageFailureFeedback?: boolean
  onImageResourceStateChange?: (state: ImageResourceStateChange) => void
}) {
  const projection = projectNodeForRender(node)
  const style = renderNodeStyle(projection)
  const dataAttributes = renderNodeDataAttributes(projection)

  if (projection.type === "text") {
    return (
      <div {...dataAttributes} style={style}>
        <RenderTextContent projection={projection} />
      </div>
    )
  }

  if (
    projection.type !== "image" &&
    hasExplicitPaintStack(
      node as Extract<
        SceneNode,
        { type: "rect" | "frame" | "ellipse" | "line" | "icon" }
      >
    )
  ) {
    return (
      <RenderShapePaintStack
        dataAttributes={dataAttributes}
        projection={projection}
      />
    )
  }

  if (projection.type === "rect" || projection.type === "frame") {
    if (
      projection.content.corners.independent ||
      projection.content.corners.smoothing > 0
    ) {
      return (
        <svg
          {...dataAttributes}
          style={{ ...renderFrameStyle(projection.frame), overflow: "visible" }}
          viewBox={`0 0 ${projection.frame.width} ${projection.frame.height}`}
          preserveAspectRatio="none"
        >
          <path
            d={roundedRectanglePaintPath({
              width: projection.frame.width,
              height: projection.frame.height,
              cornerRadii: projection.content.corners.radii,
              cornerSmoothing: projection.content.corners.smoothing,
              strokeWidth: projection.content.stroke
                ? projection.content.strokeWidth
                : 0,
            })}
            fill={projection.content.fill}
            stroke={projection.content.stroke}
            strokeWidth={projection.content.strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )
    }
    return <div {...dataAttributes} style={style} />
  }

  if (projection.type === "ellipse") {
    return <div {...dataAttributes} style={style} />
  }

  if (projection.type === "line") {
    return (
      <svg
        {...dataAttributes}
        style={{ ...style, overflow: "visible" }}
        viewBox={`0 0 ${projection.frame.width} ${projection.frame.height}`}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1="0"
          x2={projection.frame.width}
          y2={projection.frame.height}
          stroke={projection.content.stroke}
          strokeWidth={projection.content.strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }

  if (projection.type === "icon") {
    return (
      <svg
        {...dataAttributes}
        style={style}
        viewBox={projection.content.viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={projection.content.path}
          fill={projection.content.fill}
          stroke={projection.content.stroke}
          strokeWidth={projection.content.strokeWidth}
        />
      </svg>
    )
  }

  return (
    <RenderImageNode
      dataAttributes={dataAttributes}
      imageSemantics={imageSemantics}
      resourceRevision={imageResourceRevision}
      resourceToken={imageResourceToken}
      showRecoveryActions={showImageRecoveryActions}
      suppressFailureFeedback={suppressImageFailureFeedback}
      onResourceStateChange={onImageResourceStateChange}
      projection={projection}
      style={style}
    />
  )
}

function FrameClippedRenderNode({
  document,
  node,
  ...props
}: Omit<ComponentProps<typeof RenderNode>, "node"> & {
  document: Document
  node: SceneNode
}) {
  const clips = projectFrameClipStack(document, node.id)
  return clips.reduce<ReactNode>(
    (content, clip, index) => (
      <div
        key={`${node.id}:frame-clip:${index}`}
        data-frame-clip-node-id={node.id}
        data-frame-clip-depth={index}
        style={{
          position: "absolute",
          left: clip.x,
          top: clip.y,
          width: clip.width,
          height: clip.height,
          overflow: "hidden",
          borderRadius: clip.cornerRadii
            ? cornerRadiiCss(clip.cornerRadii)
            : clip.radius,
          clipPath:
            (clip.cornerSmoothing ?? 0) > 0 && clip.path
              ? `path('${clip.path}')`
              : undefined,
        }}
      >
        <div style={{ position: "absolute", left: -clip.x, top: -clip.y }}>
          {content}
        </div>
      </div>
    ),
    <RenderNode {...props} node={node} />
  )
}

export type DecodedImageNaturalSize = Readonly<{
  source: string
  width: number
  height: number
}>

export type ImageResourceStateChange = Readonly<{
  token: string
  nodeId: string
  src: string
  readiness: "ready" | "unavailable"
  naturalSize: Readonly<{ width: number; height: number }> | null
}>

export function imageResourceStateChangeForLoad(
  token: string,
  nodeId: string,
  src: string,
  naturalSize: Readonly<{ width: number; height: number }>
): ImageResourceStateChange {
  const ready = naturalSize.width > 0 && naturalSize.height > 0
  return {
    token,
    nodeId,
    src,
    readiness: ready ? "ready" : "unavailable",
    naturalSize: ready ? naturalSize : null,
  }
}

export function imageResourceStateChangeForFailure(
  token: string,
  nodeId: string,
  src: string
): ImageResourceStateChange {
  return { token, nodeId, src, readiness: "unavailable", naturalSize: null }
}

/**
 * A decoded image is valid only for the exact resource that produced it.
 * Node identity is deliberately included because two image layers may share a
 * source while owning independent load lifecycles.
 */
export function imageResourceIdentity(
  nodeId: string,
  source: string,
  revision: string | number = 0
) {
  const revisionIdentity = String(revision)
  return `${nodeId.length}:${nodeId}:${source.length}:${source}:${revisionIdentity.length}:${revisionIdentity}`
}

export function decodedImageNaturalSizeForSource(
  decoded: DecodedImageNaturalSize | null,
  source: string
) {
  return decoded?.source === source
    ? { width: decoded.width, height: decoded.height }
    : null
}

export type ImageResourceLoadState = Readonly<{
  requestedIdentity: string
  requestedSource: string
  attempt: number
  status: "loading" | "ready" | "error"
  displayed: Readonly<{
    identity: string
    source: string
    attempt: number
    naturalSize: Readonly<{ width: number; height: number }>
  }> | null
  userRetried: boolean
}>

export type ImageResourceLoadEvent =
  | Readonly<{
      type: "request"
      identity: string
      source: string
    }>
  | Readonly<{
      type: "loaded"
      identity: string
      attempt: number
      width: number
      height: number
    }>
  | Readonly<{
      type: "failed"
      identity: string
      attempt: number
    }>
  | Readonly<{ type: "retry" }>

export function createImageResourceLoadState(
  identity: string,
  source = ""
): ImageResourceLoadState {
  return {
    requestedIdentity: identity,
    requestedSource: source,
    attempt: 0,
    status: "loading",
    displayed: null,
    userRetried: false,
  }
}

/**
 * Browser image events can arrive after a source revision has been replaced.
 * Only the exact resource identity and rendered attempt are allowed to change
 * the visible state.
 */
export function reduceImageResourceLoadState(
  state: ImageResourceLoadState,
  event: ImageResourceLoadEvent
): ImageResourceLoadState {
  if (event.type === "request") {
    if (
      event.identity === state.requestedIdentity &&
      event.source === state.requestedSource
    ) {
      return state
    }
    return {
      ...state,
      requestedIdentity: event.identity,
      requestedSource: event.source,
      attempt: 0,
      status:
        state.displayed?.identity === event.identity ? "ready" : "loading",
      userRetried: false,
    }
  }
  if (event.type === "retry") {
    return {
      ...state,
      attempt: state.attempt + 1,
      status: "loading",
      userRetried: true,
    }
  }
  if (
    event.identity !== state.requestedIdentity ||
    event.attempt !== state.attempt
  ) {
    return state
  }
  if (event.type === "failed") {
    return { ...state, status: "error" }
  }
  if (event.width <= 0 || event.height <= 0) {
    return { ...state, status: "error" }
  }
  return {
    ...state,
    status: "ready",
    displayed: {
      identity: state.requestedIdentity,
      source: state.requestedSource,
      attempt: state.attempt,
      naturalSize: { width: event.width, height: event.height },
    },
  }
}

function RenderImageNode({
  dataAttributes,
  imageSemantics,
  onResourceStateChange,
  projection,
  resourceRevision,
  resourceToken,
  showRecoveryActions,
  suppressFailureFeedback,
  style,
}: {
  dataAttributes: ReturnType<typeof renderNodeDataAttributes>
  imageSemantics: "content" | "thumbnail"
  onResourceStateChange?: (state: ImageResourceStateChange) => void
  projection: Extract<RenderNodeProjection, { type: "image" }>
  resourceRevision?: string | number
  resourceToken?: string
  showRecoveryActions: boolean
  suppressFailureFeedback: boolean
  style: CSSProperties
}) {
  const thumbnail = imageSemantics === "thumbnail"
  const source = projection.content.src
  const resourceIdentity = imageResourceIdentity(
    projection.frame.id,
    source,
    resourceRevision
  )
  const [resource, dispatchResource] = useReducer(
    reduceImageResourceLoadState,
    undefined,
    () => createImageResourceLoadState(resourceIdentity, source)
  )
  useEffect(() => {
    dispatchResource({
      type: "request",
      identity: resourceIdentity,
      source,
    })
  }, [resourceIdentity, source])

  const requestIsCurrent =
    resource.requestedIdentity === resourceIdentity &&
    resource.requestedSource === source
  const displayed = resource.displayed
  const requestedIsDisplayed = displayed?.identity === resourceIdentity
  const needsCandidate = !requestedIsDisplayed
  const visibleStatus = requestIsCurrent ? resource.status : "loading"
  const fallbackMode =
    projection.content.placement.mode === "fit" ? "contain" : "cover"
  const imageStyleFor = (
    naturalSize: Readonly<{ width: number; height: number }> | null
  ): CSSProperties => {
    const paint = naturalSize
      ? projectImagePaint({
          frame: projection.frame,
          naturalSize,
          placement: projection.content.placement,
          frameMask: projection.content.frameMask,
        })
      : null
    return paint && naturalSize
      ? renderImagePaintStyle(paint, naturalSize)
      : {
          width: "100%",
          height: "100%",
          objectFit: fallbackMode,
          objectPosition: `${projection.content.placement.focalX * 100}% ${projection.content.placement.focalY * 100}%`,
        }
  }

  const captureNaturalSize = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const naturalSize = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    }
    dispatchResource({
      type: "loaded",
      identity: resourceIdentity,
      attempt: resource.attempt,
      ...naturalSize,
    })
    if (resourceToken) {
      onResourceStateChange?.(
        imageResourceStateChangeForLoad(
          resourceToken,
          projection.frame.id,
          source,
          naturalSize
        )
      )
    }
  }

  const captureLoadFailure = () => {
    dispatchResource({
      type: "failed",
      identity: resourceIdentity,
      attempt: resource.attempt,
    })
    if (resourceToken) {
      onResourceStateChange?.(
        imageResourceStateChangeForFailure(
          resourceToken,
          projection.frame.id,
          source
        )
      )
    }
  }

  return (
    <div
      {...dataAttributes}
      aria-busy={!thumbnail && visibleStatus === "loading" ? true : undefined}
      data-image-resource-state={visibleStatus}
      style={style}
    >
      {displayed ? (
        <img
          key={`resource:${displayed.identity}:${displayed.attempt}`}
          alt={
            thumbnail || projection.content.decorative
              ? ""
              : projection.content.alt
          }
          aria-hidden={thumbnail || projection.content.decorative || undefined}
          data-image-resource-identity={displayed.identity}
          data-image-resource-node-id={projection.frame.id}
          data-image-resource-role="displayed"
          data-image-resource-state="ready"
          src={displayed.source}
          style={imageStyleFor(displayed.naturalSize)}
        />
      ) : null}
      {needsCandidate && requestIsCurrent ? (
        <img
          key={`resource:${resourceIdentity}:${resource.attempt}`}
          alt={
            thumbnail || displayed || projection.content.decorative
              ? ""
              : projection.content.alt
          }
          aria-hidden={
            thumbnail || Boolean(displayed) || projection.content.decorative
          }
          data-image-resource-attempt={resource.attempt}
          data-image-resource-identity={resourceIdentity}
          data-image-resource-node-id={projection.frame.id}
          data-image-resource-role="candidate"
          data-image-resource-state={resource.status}
          src={source}
          style={{
            ...imageStyleFor(null),
            visibility: displayed ? "hidden" : undefined,
          }}
          onError={captureLoadFailure}
          onLoad={captureNaturalSize}
        />
      ) : null}
      {visibleStatus === "error" && !suppressFailureFeedback ? (
        <div
          aria-hidden={thumbnail || undefined}
          data-image-resource-feedback="error"
          role={thumbnail ? undefined : "alert"}
          style={{
            position: "absolute",
            inset: displayed ? "auto 8px 8px" : 0,
            display: "flex",
            flexDirection: displayed ? "row" : "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 12,
            boxSizing: "border-box",
            background: displayed ? "rgba(23, 23, 23, 0.88)" : "#f5f5f5",
            color: displayed ? "#ffffff" : "#525252",
            textAlign: "center",
            fontFamily: "Geist Variable, sans-serif",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <span>
            {resource.userRetried
              ? displayed
                ? "Replacement still unavailable."
                : "Image still unavailable."
              : displayed
                ? "Replacement unavailable."
                : "Image unavailable."}
          </span>
          {showRecoveryActions && !thumbnail ? (
            <button
              type="button"
              aria-label={`Retry loading ${projection.content.alt || "image"}`}
              style={{
                minWidth: 44,
                minHeight: 44,
                border: "1px solid #d4d4d4",
                borderRadius: 6,
                background: "#ffffff",
                color: "#171717",
                font: "inherit",
                cursor: "pointer",
              }}
              onClick={() => dispatchResource({ type: "retry" })}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : requestIsCurrent &&
        visibleStatus === "loading" &&
        resource.userRetried ? (
        <div
          aria-hidden={thumbnail || undefined}
          data-image-resource-feedback="retrying"
          role={thumbnail ? undefined : "status"}
          style={{
            position: "absolute",
            inset: displayed ? "auto 8px 8px" : 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: displayed ? "8px 12px" : undefined,
            borderRadius: displayed ? 6 : undefined,
            background: displayed
              ? "rgba(23, 23, 23, 0.8)"
              : "rgba(245, 245, 245, 0.88)",
            color: displayed ? "#ffffff" : "#525252",
            fontFamily: "Geist Variable, sans-serif",
            fontSize: 12,
          }}
        >
          {displayed ? "Retrying replacement…" : "Retrying image…"}
        </div>
      ) : null}
    </div>
  )
}

export function Artboard({
  document,
  pageId,
  scale = 1,
  className,
  imageSemantics = "content",
  imageResourceRevisions,
  imageResourceTokens,
  showImageRecoveryActions = true,
  onImageResourceStateChange,
}: {
  document: Document
  pageId: string
  scale?: number
  className?: string
  imageSemantics?: "content" | "thumbnail"
  imageResourceRevisions?: Readonly<Record<string, string | number>>
  imageResourceTokens?: Readonly<Record<string, string>>
  showImageRecoveryActions?: boolean
  onImageResourceStateChange?: (state: ImageResourceStateChange) => void
}) {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const projectedPage = projectPageForRender(page)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const paintPlan = projectPagePaintPlan(document, projectedPage.id, {
    pixelRatio: renderViewDevicePixelRatio(),
  })

  return (
    <div
      className={className}
      style={{
        width: projectedPage.width * scale,
        height: projectedPage.height * scale,
      }}
    >
      <div
        data-page-id={projectedPage.id}
        style={{
          position: "relative",
          width: projectedPage.width,
          height: projectedPage.height,
          background: projectedPage.background,
          overflow: "hidden",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {paintPlan.entries.map((entry) => {
          if (entry.kind === "mask_group") {
            return (
              <MaskGroupPaintEntry
                key={entry.groupId}
                document={document}
                entry={entry}
                nodesById={nodesById}
                imageSemantics={imageSemantics}
                imageResourceRevisions={imageResourceRevisions}
                imageResourceTokens={imageResourceTokens}
                showImageRecoveryActions={showImageRecoveryActions}
                onImageResourceStateChange={onImageResourceStateChange}
              />
            )
          }
          const node = nodesById.get(entry.nodeId)
          return node ? (
            <FrameClippedRenderNode
              key={node.id}
              document={document}
              imageSemantics={imageSemantics}
              node={node}
              imageResourceRevision={imageResourceRevisions?.[node.id]}
              imageResourceToken={imageResourceTokens?.[node.id]}
              showImageRecoveryActions={showImageRecoveryActions}
              onImageResourceStateChange={onImageResourceStateChange}
            />
          ) : null
        })}
      </div>
    </div>
  )
}
