import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  type CSSProperties,
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
  projectImagePaint,
  projectNodeForRender,
  projectPageForRender,
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
          ? mask.radius * Math.min(frame.width, frame.height)
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
): CSSProperties => ({
  position: "absolute",
  boxSizing: "border-box",
  left: frame.x,
  top: frame.y,
  width: frame.width,
  height: frame.height,
  opacity: frame.opacity,
  transform: `rotate(${frame.rotation}deg)`,
  transformOrigin: "top left",
  display: frame.visible ? undefined : "none",
})

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
    transform: `rotate(${source.rotation} ${x} ${y})`,
    width: source.width,
    x,
    y,
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

type MaskPaintPlanEntry = Extract<PagePaintPlanEntry, { kind: "mask_group" }>
type VectorMaskPaintEntry = Omit<MaskPaintPlanEntry, "maskType"> &
  Readonly<{ maskType: "vector" }>
type AlphaMaskPaintEntry = Omit<MaskPaintPlanEntry, "maskType"> &
  Readonly<{ maskType: "alpha" }>

export type MaskGroupRenderModel = Readonly<{
  entry: VectorMaskPaintEntry
  source: Extract<SceneNode, { type: "rect" | "ellipse" | "icon" }>
  content: readonly SceneNode[]
}>

export type AlphaMaskGroupRenderModel = Readonly<{
  entry: AlphaMaskPaintEntry
  source: Extract<
    SceneNode,
    { type: "rect" | "ellipse" | "icon" | "image" | "text" }
  >
  content: readonly SceneNode[]
}>

export type AlphaImageMaskCommitState = Readonly<{
  requestedIdentity: string
  requestedModel: AlphaMaskGroupRenderModel
  committedIdentity: string | null
  committedModel: AlphaMaskGroupRenderModel | null
  status: "loading" | "ready" | "error"
}>

export type AlphaImageMaskCommitEvent =
  | Readonly<{
      type: "request"
      identity: string
      model: AlphaMaskGroupRenderModel
    }>
  | Readonly<{ type: "ready" | "failed"; identity: string }>

export function createAlphaImageMaskCommitState(
  identity: string,
  model: AlphaMaskGroupRenderModel
): AlphaImageMaskCommitState {
  return {
    requestedIdentity: identity,
    requestedModel: model,
    committedIdentity: null,
    committedModel: null,
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
      status: "loading",
    }
  }
  if (event.identity !== state.requestedIdentity) return state
  if (event.type === "failed") return { ...state, status: "error" }
  return {
    ...state,
    committedIdentity: state.requestedIdentity,
    committedModel: state.requestedModel,
    status: "ready",
  }
}

function maskGroupContent(
  entry: Extract<PagePaintPlanEntry, { kind: "mask_group" }>,
  nodesById: ReadonlyMap<string, SceneNode>
) {
  return entry.content.map((contentEntry) => {
    if (contentEntry.kind !== "node") {
      throw new Error("React mask rendering does not support nesting")
    }
    const node = nodesById.get(contentEntry.nodeId)
    if (!node)
      throw new Error(`Mask content node ${contentEntry.nodeId} is missing`)
    return node
  })
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
  if (entry.sourceNodeIds.length !== 1) {
    throw new Error("React vector mask rendering requires one source")
  }
  const sourceId = entry.sourceNodeIds[0]!
  const source = nodesById.get(sourceId)
  if (!isAdmittedVectorMaskSource(source)) {
    throw new Error(
      "React vector mask rendering requires a rectangle, ellipse, or icon source"
    )
  }
  const content = maskGroupContent(entry, nodesById)
  return { entry: entry as VectorMaskPaintEntry, source, content }
}

export function alphaMaskGroupRenderModel(
  entry: PagePaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>
): AlphaMaskGroupRenderModel {
  if (entry.kind !== "mask_group" || entry.maskType !== "alpha") {
    throw new Error("React alpha rendering requires an alpha mask group entry")
  }
  if (entry.sourceNodeIds.length !== 1) {
    throw new Error("React alpha mask rendering requires one source")
  }
  const source = nodesById.get(entry.sourceNodeIds[0]!)
  if (!isAdmittedAlphaMaskSource(source)) {
    throw new Error(
      "React alpha mask rendering requires a rectangle, ellipse, icon, image, or text source"
    )
  }
  return {
    entry: entry as AlphaMaskPaintEntry,
    source,
    content: maskGroupContent(entry, nodesById),
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
  const transform = `rotate(${source.rotation} ${x} ${y})`
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
  content,
  imageSemantics,
  imageResourceRevisions,
  imageResourceTokens,
  showImageRecoveryActions,
  onImageResourceStateChange,
}: {
  content: readonly SceneNode[]
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
      {content.map((node) => (
        <RenderNode
          key={node.id}
          imageSemantics={imageSemantics}
          node={node}
          imageResourceRevision={imageResourceRevisions?.[node.id]}
          imageResourceToken={imageResourceTokens?.[node.id]}
          showImageRecoveryActions={showImageRecoveryActions}
          onImageResourceStateChange={onImageResourceStateChange}
        />
      ))}
    </div>
  )
}

/**
 * Renders one schema-backed vector-mask entry from the canonical paint plan.
 */
type MaskGroupPaintEntryProps = Readonly<{
  entry: PagePaintPlanEntry
  nodesById: ReadonlyMap<string, SceneNode>
  imageSemantics?: "content" | "thumbnail"
  imageResourceRevisions?: Readonly<Record<string, string | number>>
  imageResourceTokens?: Readonly<Record<string, string>>
  showImageRecoveryActions?: boolean
  onImageResourceStateChange?: (state: ImageResourceStateChange) => void
}>

export function MaskGroupPaintEntry(props: MaskGroupPaintEntryProps) {
  const model = useMemo(
    () =>
      props.entry.kind === "mask_group" && props.entry.maskType === "alpha"
        ? alphaMaskGroupRenderModel(props.entry, props.nodesById)
        : maskGroupRenderModel(props.entry, props.nodesById),
    [props.entry, props.nodesById]
  )
  if (
    model.entry.maskType === "alpha" &&
    model.entry.compositeRequired &&
    model.source.type === "image"
  ) {
    return (
      <AtomicAlphaImageMaskPaintEntry
        {...props}
        model={model as AlphaMaskGroupRenderModel}
      />
    )
  }
  return <ResolvedMaskGroupPaintEntry {...props} model={model} />
}

function AtomicAlphaImageMaskPaintEntry({
  model,
  imageSemantics = "content",
  imageResourceRevisions,
  imageResourceTokens,
  showImageRecoveryActions = true,
  onImageResourceStateChange,
}: MaskGroupPaintEntryProps & { model: AlphaMaskGroupRenderModel }) {
  const source = model.source as Extract<SceneNode, { type: "image" }>
  const revision = imageResourceRevisions?.[source.id]
  const identity = imageResourceIdentity(source.id, source.src, revision)
  const [commit, dispatchCommit] = useReducer(
    reduceAlphaImageMaskCommitState,
    undefined,
    () => createAlphaImageMaskCommitState(identity, model)
  )
  useEffect(() => {
    dispatchCommit({ type: "request", identity, model })
  }, [identity, model])

  const resourceToken = imageResourceTokens?.[source.id]
  const probeToken = `alpha-mask:${identity}`
  const handleProbeStateChange = (state: ImageResourceStateChange) => {
    dispatchCommit({
      type: state.readiness === "ready" ? "ready" : "failed",
      identity,
    })
    if (resourceToken) {
      onImageResourceStateChange?.({ ...state, token: resourceToken })
    }
  }
  const needsProbe = commit.committedIdentity !== identity

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
          nodesById={
            new Map([
              [commit.committedModel.source.id, commit.committedModel.source],
              ...commit.committedModel.content.map(
                (node) => [node.id, node] as const
              ),
            ])
          }
        />
      ) : (
        <div
          data-mask-group-id={model.entry.groupId}
          data-mask-resource-state={commit.status}
          style={renderMaskGroupWrapperStyle(model.entry.bounds)}
        />
      )}
      {needsProbe ? (
        <div
          aria-hidden
          data-alpha-mask-resource-probe={source.id}
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
            imageResourceRevision={revision}
            imageResourceToken={probeToken}
            node={source}
            showImageRecoveryActions={false}
            suppressImageFailureFeedback
            onImageResourceStateChange={handleProbeStateChange}
          />
        </div>
      ) : null}
    </>
  )
}

function ResolvedMaskGroupPaintEntry({
  model,
  imageSemantics = "content",
  imageResourceRevisions,
  imageResourceTokens,
  showImageRecoveryActions = true,
  onImageResourceStateChange,
}: MaskGroupPaintEntryProps & {
  model: MaskGroupRenderModel | AlphaMaskGroupRenderModel
}) {
  const { content, entry: maskEntry, source } = model
  const maskId = `studio-mask-${useId().replaceAll(":", "")}`
  const wrapperStyle = renderMaskGroupWrapperStyle(maskEntry.bounds)
  const contentProps = {
    content,
    imageSemantics,
    imageResourceRevisions,
    imageResourceTokens,
    showImageRecoveryActions,
    onImageResourceStateChange,
  }

  if (!shouldCompositeMaskGroup(maskEntry)) {
    return (
      <div data-mask-group-id={maskEntry.groupId} style={wrapperStyle}>
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
      role="presentation"
      style={wrapperStyle}
      viewBox={`0 0 ${maskEntry.bounds.width} ${maskEntry.bounds.height}`}
    >
      <defs>
        <mask
          height={maskEntry.bounds.height}
          id={maskId}
          maskUnits="userSpaceOnUse"
          style={{ maskType: "alpha" }}
          width={maskEntry.bounds.width}
          x={0}
          y={0}
        >
          {maskEntry.maskType === "vector" ? (
            <RenderVectorMaskSource
              bounds={maskEntry.bounds}
              source={source as MaskGroupRenderModel["source"]}
            />
          ) : (
            <foreignObject
              data-mask-source-id={source.id}
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
                  width: maskEntry.bounds.width,
                  height: maskEntry.bounds.height,
                }}
              >
                <RenderNode
                  imageSemantics={imageSemantics}
                  node={source}
                  imageResourceRevision={imageResourceRevisions?.[source.id]}
                  imageResourceToken={imageResourceTokens?.[source.id]}
                  showImageRecoveryActions={showImageRecoveryActions}
                  suppressImageFailureFeedback
                  onImageResourceStateChange={onImageResourceStateChange}
                />
              </div>
            </foreignObject>
          )}
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
  plan,
  nodesById,
  width,
  height,
  background,
}: {
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
              entry={entry}
              nodesById={nodesById}
              showImageRecoveryActions={false}
            />
          )
        }
        const node = nodesById.get(entry.nodeId)
        return node ? (
          <RenderNode
            key={node.id}
            imageSemantics="content"
            node={node}
            showImageRecoveryActions={false}
          />
        ) : null
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
      whiteSpace: text.whiteSpace,
      overflowWrap: text.overflowWrap,
      overflow: text.sizingMode === "fixed" ? "hidden" : "visible",
    }
  }
  if (projection.type === "rect") {
    const rect = projection.content
    return {
      ...frame,
      background: rect.fill,
      border: rect.stroke
        ? `${rect.strokeWidth}px solid ${rect.stroke}`
        : undefined,
      borderRadius: rect.radius,
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

  if (projection.type === "rect") {
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
            <RenderNode
              key={node.id}
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
