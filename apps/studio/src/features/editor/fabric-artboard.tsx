import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { Document } from "@webmcp/document"
import type {
  CanvasAdapter,
  CanvasImageCropMode,
  CanvasImageCropPreview,
  CanvasImageSourceReadiness,
  CanvasNodeChange,
  AlignmentSnapTarget,
  Selection,
} from "@webmcp/editor"
import type { ImageCropPreviewStore } from "@webmcp/editor/image-crop-preview-store"
import { getNodeBounds, getSelectionBounds } from "@webmcp/editor/geometry"
import { Button } from "@webmcp/ui/components/button"
import { ImageCropFrameOverlay } from "./image-crop-frame-overlay"
import type { ImageCropFramePreview } from "./image-crop-frame-overlay"

export type FabricArtboardHandle = {
  exportPng: () => string | null
  retryImageSources: () => void
  retryImageSource: (nodeId: string) => void
  enterTextEditing: (nodeId: string) => boolean
  commitTextEditing: () => boolean
  cancelTextEditing: () => boolean
  cancelTransform: () => boolean
  getImageNaturalSize: (
    nodeId: string
  ) => Readonly<{ width: number; height: number }> | null
  nudgeImageCrop: (
    screenDelta: { x: number; y: number },
    zoom: number
  ) => boolean
}

export const FabricArtboard = forwardRef<
  FabricArtboardHandle,
  {
    document: Document
    pageId: string
    selection: Selection | null
    hoveredNodeId?: string | null
    textEditingNodeId?: string | null
    imageCropMode?: CanvasImageCropMode | null
    imageCropPreviewStore?: ImageCropPreviewStore | null
    imageResourceTokens?: Readonly<Record<string, string>>
    zoom: number
    snapTargets?: readonly AlignmentSnapTarget[]
    interactive?: boolean
    onCanvasDoubleClick?: (point: { clientX: number; clientY: number }) => void
    onContextMenu?: (request: {
      clientX: number
      clientY: number
      nodeId: string | null
    }) => void
    onImageDoubleClick?: (nodeId: string) => void
    onImageCropPreview?: (preview: CanvasImageCropPreview) => void
    onImageCropFramePreview?: (preview: ImageCropFramePreview) => void
    onImageCropUnavailable?: (failure: ImageCropUnavailable) => void
    onImageSourceStateChange?: (state: ImageSourceStateChange) => void
    onRuntimeStateChange?: (state: "ready" | "error") => void
    onTextEditingStart?: (nodeId: string) => void
    onSelectionChange: (selection: Selection | null) => void
    onNodesChange: (changes: CanvasNodeChange[]) => boolean | void
  }
>(function FabricArtboard(
  {
    document,
    pageId,
    selection,
    hoveredNodeId = null,
    textEditingNodeId = null,
    imageCropMode = null,
    imageCropPreviewStore = null,
    imageResourceTokens,
    zoom,
    snapTargets = [],
    interactive = true,
    onCanvasDoubleClick,
    onContextMenu,
    onImageDoubleClick,
    onImageCropPreview,
    onImageCropFramePreview,
    onImageCropUnavailable,
    onImageSourceStateChange,
    onRuntimeStateChange,
    onTextEditingStart,
    onSelectionChange,
    onNodesChange,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const adapterRef = useRef<CanvasAdapter | null>(null)
  const callbacksRef = useRef({
    onCanvasDoubleClick,
    onContextMenu,
    onImageDoubleClick,
    onImageCropPreview,
    onImageCropFramePreview,
    onImageCropUnavailable,
    onImageSourceStateChange,
    onRuntimeStateChange,
    onTextEditingStart,
    onSelectionChange,
    onNodesChange,
    textEditingNodeId,
    imageCropMode,
    interactive,
  })
  const currentImageSourceByNodeIdRef = useRef(new Map<string, string>())
  const currentImageResourceTokenByNodeIdRef = useRef(
    new Map<string, string | undefined>()
  )
  const reportedImageSourceStateRef = useRef(
    new Map<string, ImageSourceStateChange>()
  )
  const [runtime, setRuntime] = useState<CanvasRuntimeState>(() =>
    createCanvasRuntimeState()
  )
  const ready = runtime.status === "ready"
  const canvasInstructionsId = `canvas-instructions-${useId().replaceAll(":", "")}`
  const reportedUnavailableCropRef = useRef<string | null>(null)
  callbacksRef.current = {
    onCanvasDoubleClick,
    onContextMenu,
    onImageDoubleClick,
    onImageCropPreview,
    onImageCropFramePreview,
    onImageCropUnavailable,
    onImageSourceStateChange,
    onRuntimeStateChange,
    onTextEditingStart,
    onSelectionChange,
    onNodesChange,
    textEditingNodeId,
    imageCropMode,
    interactive,
  }

  const page = document.pages.find((candidate) => candidate.id === pageId)
  const pageNodeIds = new Set(page?.nodeIds ?? [])
  const selectedNodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
    const node = document.nodes.find(
      (candidate) =>
        candidate.id === nodeId &&
        pageNodeIds.has(candidate.id) &&
        candidate.visible
    )
    return node ? [node] : []
  })
  const hoveredNode = document.nodes.find(
    (node) =>
      node.id === hoveredNodeId && pageNodeIds.has(node.id) && node.visible
  )
  const cropNodeCandidate = imageCropMode
    ? document.nodes.find(
        (node) =>
          node.id === imageCropMode.nodeId &&
          pageNodeIds.has(node.id) &&
          node.visible
      )
    : undefined
  const cropNode =
    cropNodeCandidate?.type === "image" ? cropNodeCandidate : undefined
  currentImageSourceByNodeIdRef.current = new Map(
    document.nodes.flatMap((node) =>
      node.type === "image" && pageNodeIds.has(node.id)
        ? [[node.id, node.src] as const]
        : []
    )
  )
  currentImageResourceTokenByNodeIdRef.current = new Map(
    document.nodes.flatMap((node) =>
      node.type === "image" && pageNodeIds.has(node.id)
        ? [[node.id, imageResourceTokens?.[node.id]] as const]
        : []
    )
  )

  const reportImageSourceState = useCallback(
    (state: ImageSourceStateChange) => {
      const result = acceptImageSourceStateChange(
        currentImageSourceByNodeIdRef.current,
        reportedImageSourceStateRef.current,
        state,
        currentImageResourceTokenByNodeIdRef.current
      )
      if (result === "stale") return false
      if (result === "duplicate") return true
      callbacksRef.current.onImageSourceStateChange?.(state)
      return true
    },
    []
  )

  const reportAllCurrentImageSources = useCallback(
    (readiness: ImageSourceStateChange["readiness"]) => {
      for (const [nodeId, src] of currentImageSourceByNodeIdRef.current) {
        reportImageSourceState({
          nodeId,
          src,
          resourceToken:
            currentImageResourceTokenByNodeIdRef.current.get(nodeId),
          readiness,
          naturalSize: null,
        })
      }
    },
    [reportImageSourceState]
  )

  const applyImageCropMode = useCallback(
    (
      adapter: Pick<CanvasAdapter, "setImageCropMode">,
      mode: CanvasImageCropMode | null
    ) => {
      const applied = applyImageCropModeOrReport(adapter, mode, (failure) => {
        if (reportedUnavailableCropRef.current === failure.nodeId) return
        reportedUnavailableCropRef.current = failure.nodeId
        callbacksRef.current.onImageCropUnavailable?.(failure)
      })
      if (applied || !mode) reportedUnavailableCropRef.current = null
      return applied
    },
    []
  )

  const applyImageCropPreview = useCallback(
    (session: ReturnType<ImageCropPreviewStore["getSnapshot"]>) =>
      adapterRef.current?.previewImageCropDraft({
        nodeId: session.target.nodeId,
        placement: session.draft,
        frame: session.draftFrame,
        frameMask: session.draftFrameMask,
      }) ?? false,
    []
  )

  const retryImageSources = useCallback(() => {
    reportedImageSourceStateRef.current.clear()
    reportAllCurrentImageSources("loading")
    setRuntime((current) =>
      reduceCanvasRuntimeState(current, { type: "retry" })
    )
  }, [reportAllCurrentImageSources])

  const retryImageSource = useCallback(
    (nodeId: string) => {
      const src = currentImageSourceByNodeIdRef.current.get(nodeId)
      const adapter = adapterRef.current
      if (!src || !adapter) return
      reportImageSourceState({ nodeId, src, readiness: "loading" })
      void adapter.retryImageSource(nodeId).then((readiness) => {
        if (!readiness) return
        reportImageSourceState({ nodeId, src, readiness })
      })
    },
    [reportImageSourceState]
  )

  useImperativeHandle(
    ref,
    () => ({
      exportPng: () => adapterRef.current?.exportPng() ?? null,
      retryImageSources,
      retryImageSource,
      enterTextEditing: (nodeId) =>
        adapterRef.current?.enterTextEditing(nodeId) ?? false,
      commitTextEditing: () => adapterRef.current?.commitTextEditing() ?? false,
      cancelTextEditing: () => adapterRef.current?.cancelTextEditing() ?? false,
      cancelTransform: () => adapterRef.current?.cancelTransform() ?? false,
      getImageNaturalSize: (nodeId) =>
        adapterRef.current?.getImageNaturalSize(nodeId) ?? null,
      nudgeImageCrop: (screenDelta, cameraZoom) =>
        adapterRef.current?.nudgeImageCrop(screenDelta, cameraZoom) ?? false,
    }),
    [retryImageSource, retryImageSources]
  )

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    let active = true
    let adapter: CanvasAdapter | null = null
    const attempt = runtime.attempt

    void import("@webmcp/editor/fabric")
      .then(({ FabricCanvasAdapter }) => {
        if (!active) return
        adapter = new FabricCanvasAdapter({
          onSelectionChange: (nextSelection) =>
            callbacksRef.current.onSelectionChange(nextSelection),
          onNodesChange: (changes) =>
            callbacksRef.current.onNodesChange(changes),
          onCanvasDoubleClick: (point) =>
            callbacksRef.current.onCanvasDoubleClick?.(point),
          onContextMenu: (request) =>
            callbacksRef.current.onContextMenu?.(request),
          onImageDoubleClick: (nodeId) =>
            callbacksRef.current.onImageDoubleClick?.(nodeId),
          onImageCropPreview: (preview) =>
            callbacksRef.current.onImageCropPreview?.(preview),
        })
        adapter.mount(element)
        describeInteractiveCanvas(element, canvasInstructionsId)
        adapterRef.current = adapter
        setRuntime((current) =>
          reduceCanvasRuntimeState(current, { type: "ready", attempt })
        )
      })
      .catch(() => {
        if (!active) return
        adapterRef.current = null
        if (adapter) void adapter.unmount().catch(() => undefined)
        adapter = null
        reportAllCurrentImageSources("unavailable")
        callbacksRef.current.onRuntimeStateChange?.("error")
        setRuntime((current) =>
          reduceCanvasRuntimeState(current, {
            type: "failed",
            attempt,
            stage: "startup",
          })
        )
      })

    return () => {
      active = false
      adapterRef.current = null
      if (adapter) void adapter.unmount()
    }
  }, [canvasInstructionsId, reportAllCurrentImageSources, runtime.attempt])

  useEffect(() => {
    if (!ready) return
    adapterRef.current?.setViewportZoom(zoom)
  }, [ready, zoom])

  useEffect(() => {
    if (!ready) return
    adapterRef.current?.setSnapTargets(pageId, snapTargets)
  }, [pageId, ready, snapTargets])

  useEffect(() => {
    if (!ready) return
    const adapter = adapterRef.current
    if (!adapter) return
    settleCanvasInteractivity(adapter, interactive)
    let active = true
    const isActive = () => active
    const attempt = runtime.attempt
    const imageSources = document.nodes.flatMap((node) =>
      node.type === "image" && page?.nodeIds.includes(node.id)
        ? [
            {
              nodeId: node.id,
              src: node.src,
              resourceToken: imageResourceTokens?.[node.id],
            },
          ]
        : []
    )
    for (const state of imageSources) {
      const previous = reportedImageSourceStateRef.current.get(state.nodeId)
      if (previous?.src !== state.src || previous.readiness === "loading") {
        reportImageSourceState({ ...state, readiness: "loading" })
      }
    }
    void waitForCanvasDocumentFonts(document, pageId)
      .then(async () => {
        if (!active) return
        return adapter.sync(document, pageId)
      })
      .then(async () => {
        if (!active) return
        for (const state of imageSources) {
          const readiness = adapter.getImageSourceReadiness(state.nodeId)
          reportImageSourceState({
            ...state,
            readiness: readiness ?? "unavailable",
            naturalSize:
              readiness === "ready"
                ? adapter.getImageNaturalSize(state.nodeId)
                : null,
          })
        }
        const requestedNodeId = callbacksRef.current.textEditingNodeId
        if (
          callbacksRef.current.interactive &&
          requestedNodeId &&
          adapter.enterTextEditing(requestedNodeId)
        ) {
          callbacksRef.current.onTextEditingStart?.(requestedNodeId)
        }
        applyImageCropMode(
          adapter,
          callbacksRef.current.interactive
            ? callbacksRef.current.imageCropMode
            : null
        )
        await waitForCanvasPaint()
        if (!isActive()) return
        callbacksRef.current.onRuntimeStateChange?.("ready")
      })
      .catch(() => {
        if (!active) return
        for (const state of imageSources) {
          reportImageSourceState({ ...state, readiness: "unavailable" })
        }
        callbacksRef.current.onRuntimeStateChange?.("error")
        setRuntime((current) =>
          reduceCanvasRuntimeState(current, {
            type: "failed",
            attempt,
            stage: "sync",
          })
        )
      })
    return () => {
      active = false
    }
  }, [
    applyImageCropMode,
    document,
    interactive,
    pageId,
    page,
    ready,
    reportImageSourceState,
    runtime.attempt,
    imageResourceTokens,
  ])

  useEffect(() => {
    if (!ready) return
    const adapter = adapterRef.current
    if (adapter) {
      applyImageCropMode(adapter, interactive ? imageCropMode : null)
    }
  }, [applyImageCropMode, imageCropMode, interactive, ready])

  useEffect(() => {
    if (!ready || !interactive || !textEditingNodeId) return
    if (adapterRef.current?.enterTextEditing(textEditingNodeId)) {
      callbacksRef.current.onTextEditingStart?.(textEditingNodeId)
    }
  }, [interactive, ready, textEditingNodeId])

  useEffect(() => {
    if (!ready) return
    adapterRef.current?.select(selection)
  }, [ready, selection])

  if (!page) return null

  return (
    <div
      className="relative shrink-0 shadow-[0_24px_70px_rgba(35,31,25,0.18)] ring-1 ring-black/10"
      style={{ width: page.width * zoom, height: page.height * zoom }}
    >
      <div
        className={`absolute top-0 left-0 origin-top-left bg-white ${interactive ? "" : "pointer-events-none"}`}
        style={{
          width: page.width,
          height: page.height,
          transform: `scale(${zoom})`,
        }}
      >
        <canvas ref={canvasRef} />
      </div>
      <p id={canvasInstructionsId} className="sr-only">
        Interactive design canvas. Press Tab to leave the canvas controls. Press
        Escape to cancel the active crop, text edit, or object transform before
        it clears selection. Hold Space and drag to pan the canvas. While
        cropping, drag with one finger to reposition the image or pinch with two
        fingers inside the frame to scale and reposition it.
      </p>
      {hoveredNode &&
      !selectedNodes.some((node) => node.id === hoveredNode.id) ? (
        <NodeOutline kind="hover" nodes={[hoveredNode]} zoom={zoom} />
      ) : null}
      {cropNode && imageCropPreviewStore ? (
        <LiveImageCropPreviewChrome
          node={cropNode}
          page={page}
          zoom={zoom}
          interactive={interactive}
          previewStore={imageCropPreviewStore}
          applyPreview={applyImageCropPreview}
          getNaturalSize={() =>
            adapterRef.current?.getImageNaturalSize(cropNode.id) ?? null
          }
          onFramePreview={(preview) =>
            callbacksRef.current.onImageCropFramePreview?.(preview)
          }
        />
      ) : cropNode ? (
        <>
          <CropPreviewDimmer node={cropNode} page={page} />
          <NodeOutline kind="crop" nodes={[cropNode]} zoom={zoom} />
          {interactive ? (
            <ImageCropFrameOverlay
              node={cropNode}
              zoom={zoom}
              getNaturalSize={() =>
                adapterRef.current?.getImageNaturalSize(cropNode.id) ?? null
              }
              onPreview={(preview) =>
                callbacksRef.current.onImageCropFramePreview?.(preview)
              }
            />
          ) : null}
        </>
      ) : selectedNodes.length ? (
        <NodeOutline kind="selection" nodes={selectedNodes} zoom={zoom} />
      ) : null}
      <CanvasRuntimeOverlay runtime={runtime} onRetry={retryImageSources} />
    </div>
  )
})

type CanvasFontFaceSet = Pick<FontFaceSet, "check" | "load" | "ready">

export function canvasDocumentFontRequests(document: Document, pageId: string) {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) return []
  const pageNodeIds = new Set(page.nodeIds)
  const requests = new Map<string, { descriptor: string; sample: string }>()
  for (const node of document.nodes) {
    if (node.type !== "text" || !pageNodeIds.has(node.id) || !node.visible) {
      continue
    }
    const descriptor = `${node.fontWeight} ${node.fontSize}px ${JSON.stringify(node.fontFamily)}`
    const key = `${descriptor}\u0000${node.text}`
    requests.set(key, { descriptor, sample: node.text || "M" })
  }
  return [...requests.values()]
}

export async function waitForCanvasDocumentFonts(
  document: Document,
  pageId: string,
  fontFaceSet: CanvasFontFaceSet | undefined = getBrowserFontFaceSet()
) {
  if (!fontFaceSet) return
  const requests = canvasDocumentFontRequests(document, pageId)
  const loadedFaces = await Promise.all(
    requests.map(({ descriptor, sample }) =>
      fontFaceSet.load(descriptor, sample)
    )
  )
  for (const [index, faces] of loadedFaces.entries()) {
    if (!faces.length) {
      throw new Error(
        `Canvas font unavailable: ${requests[index]?.descriptor ?? "unknown"}`
      )
    }
  }
  await fontFaceSet.ready
  for (const { descriptor, sample } of requests) {
    if (!fontFaceSet.check(descriptor, sample)) {
      throw new Error(`Canvas font unavailable: ${descriptor}`)
    }
  }
}

function getBrowserFontFaceSet(): CanvasFontFaceSet | undefined {
  return typeof window === "undefined" ? undefined : window.document.fonts
}

export async function waitForCanvasPaint() {
  if (typeof requestAnimationFrame === "undefined") return
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}

function LiveImageCropPreviewChrome({
  node,
  page,
  zoom,
  interactive,
  previewStore,
  applyPreview,
  getNaturalSize,
  onFramePreview,
}: {
  node: Extract<Document["nodes"][number], { type: "image" }>
  page: Document["pages"][number]
  zoom: number
  interactive: boolean
  previewStore: ImageCropPreviewStore
  applyPreview: (
    session: ReturnType<ImageCropPreviewStore["getSnapshot"]>
  ) => boolean
  getNaturalSize: () => Readonly<{ width: number; height: number }> | null
  onFramePreview: (preview: ImageCropFramePreview) => void
}) {
  const session = useSyncExternalStore(
    previewStore.subscribe,
    previewStore.getSnapshot,
    previewStore.getSnapshot
  )
  const previewNode =
    session.target.nodeId === node.id
      ? {
          ...node,
          ...session.draftFrame,
          placement: session.draft,
          frameMask: session.draftFrameMask,
        }
      : node

  useEffect(() => {
    applyPreview(session)
  }, [applyPreview, session])

  return (
    <>
      <CropPreviewDimmer node={previewNode} page={page} />
      <NodeOutline kind="crop" nodes={[previewNode]} zoom={zoom} />
      {interactive ? (
        <ImageCropFrameOverlay
          node={previewNode}
          zoom={zoom}
          getNaturalSize={getNaturalSize}
          onPreview={onFramePreview}
        />
      ) : null}
    </>
  )
}

export function describeInteractiveCanvas(
  canvasElement: HTMLCanvasElement,
  descriptionId: string
) {
  const upperCanvas =
    canvasElement.parentElement?.querySelector<HTMLElement>(".upper-canvas")
  if (!upperCanvas) return false
  upperCanvas.setAttribute("aria-describedby", descriptionId)
  return true
}

export function settleCanvasInteractivity(
  adapter: Pick<CanvasAdapter, "cancelTextEditing" | "cancelTransform">,
  interactive: boolean
) {
  if (interactive) return false
  const textCancelled = adapter.cancelTextEditing()
  const transformCancelled = adapter.cancelTransform()
  return textCancelled || transformCancelled
}

export type CanvasRuntimeFailureStage = "startup" | "sync"

export type ImageSourceStateChange = Readonly<{
  nodeId: string
  src: string
  resourceToken?: string
  readiness: "loading" | CanvasImageSourceReadiness
  naturalSize?: Readonly<{ width: number; height: number }> | null
}>

export function acceptImageSourceStateChange(
  currentSources: ReadonlyMap<string, string>,
  reportedStates: Map<string, ImageSourceStateChange>,
  state: ImageSourceStateChange,
  currentResourceTokens?: ReadonlyMap<string, string | undefined>
) {
  if (currentSources.get(state.nodeId) !== state.src) return "stale" as const
  if (
    currentResourceTokens &&
    currentResourceTokens.get(state.nodeId) !== state.resourceToken
  ) {
    return "stale" as const
  }
  const previous = reportedStates.get(state.nodeId)
  if (
    previous?.src === state.src &&
    previous.resourceToken === state.resourceToken &&
    previous.readiness === state.readiness
  ) {
    return "duplicate" as const
  }
  reportedStates.set(state.nodeId, state)
  return "accepted" as const
}

export type CanvasRuntimeState = Readonly<
  | {
      status: "preparing"
      attempt: number
      userRetried: boolean
      stage: null
    }
  | {
      status: "ready"
      attempt: number
      userRetried: boolean
      stage: null
    }
  | {
      status: "error"
      attempt: number
      userRetried: boolean
      stage: CanvasRuntimeFailureStage
    }
>

export type CanvasRuntimeEvent =
  | Readonly<{ type: "ready"; attempt: number }>
  | Readonly<{
      type: "failed"
      attempt: number
      stage: CanvasRuntimeFailureStage
    }>
  | Readonly<{ type: "retry" }>

export function createCanvasRuntimeState(): CanvasRuntimeState {
  return {
    status: "preparing",
    attempt: 0,
    userRetried: false,
    stage: null,
  }
}

export function reduceCanvasRuntimeState(
  state: CanvasRuntimeState,
  event: CanvasRuntimeEvent
): CanvasRuntimeState {
  if (event.type === "retry") {
    return {
      status: "preparing",
      attempt: state.attempt + 1,
      userRetried: true,
      stage: null,
    }
  }
  if (event.attempt !== state.attempt) return state
  if (event.type === "failed") {
    return {
      status: "error",
      attempt: state.attempt,
      userRetried: state.userRetried,
      stage: event.stage,
    }
  }
  return {
    status: "ready",
    attempt: state.attempt,
    userRetried: state.userRetried,
    stage: null,
  }
}

export function canvasRuntimeFailureMessage(stage: CanvasRuntimeFailureStage) {
  return stage === "startup"
    ? "The editor canvas could not start. Your document is unchanged."
    : "The editor canvas could not update. Your document is unchanged."
}

export function CanvasRuntimeOverlay({
  runtime,
  onRetry,
}: {
  runtime: CanvasRuntimeState
  onRetry: () => void
}) {
  if (runtime.status === "ready") return null
  if (runtime.status === "preparing") {
    return (
      <div
        role="status"
        className="absolute inset-0 z-30 flex items-center justify-center bg-white text-xs text-muted-foreground"
      >
        {runtime.userRetried ? "Retrying canvas…" : "Preparing canvas…"}
      </div>
    )
  }
  return (
    <div
      role="alert"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-white/95 p-6 text-center"
    >
      <div className="max-w-72 space-y-1">
        <p className="text-sm font-medium text-foreground">
          {runtime.userRetried
            ? "Canvas still unavailable"
            : "Canvas unavailable"}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {canvasRuntimeFailureMessage(runtime.stage)}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry canvas
      </Button>
    </div>
  )
}

type ImageNode = Extract<Document["nodes"][number], { type: "image" }>

export type ImageCropUnavailable = Readonly<{
  nodeId: string
  reason: "image_unavailable"
}>

export function applyImageCropModeOrReport(
  adapter: Pick<CanvasAdapter, "setImageCropMode">,
  mode: CanvasImageCropMode | null,
  onUnavailable: (failure: ImageCropUnavailable) => void
) {
  const applied = adapter.setImageCropMode(mode)
  if (mode && !applied) {
    onUnavailable({ nodeId: mode.nodeId, reason: "image_unavailable" })
  }
  return applied
}

export function projectCropPreviewMaskShape(node: ImageNode) {
  const transform = `rotate(${node.rotation} ${node.x} ${node.y})`
  if (node.frameMask.shape === "ellipse") {
    return {
      shape: "ellipse" as const,
      cx: node.x + node.width / 2,
      cy: node.y + node.height / 2,
      rx: node.width / 2,
      ry: node.height / 2,
      transform,
    }
  }
  const radius =
    node.frameMask.shape === "rounded_rectangle"
      ? node.frameMask.radius * Math.min(node.width, node.height)
      : 0
  return {
    shape: "rectangle" as const,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    radius,
    transform,
  }
}

export function CropPreviewDimmer({
  node,
  page,
}: {
  node: ImageNode
  page: Document["pages"][number]
}) {
  const maskId = `crop-preview-${useId().replaceAll(":", "")}`
  const shape = projectCropPreviewMaskShape(node)
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 size-full overflow-hidden"
      data-crop-preview-dimmer="true"
      preserveAspectRatio="none"
      viewBox={`0 0 ${page.width} ${page.height}`}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={page.width}
          height={page.height}
        >
          <rect width={page.width} height={page.height} fill="white" />
          {shape.shape === "ellipse" ? (
            <ellipse
              cx={shape.cx}
              cy={shape.cy}
              rx={shape.rx}
              ry={shape.ry}
              fill="black"
              transform={shape.transform}
            />
          ) : (
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx={shape.radius}
              ry={shape.radius}
              fill="black"
              transform={shape.transform}
            />
          )}
        </mask>
      </defs>
      <rect
        width={page.width}
        height={page.height}
        fill="rgba(15, 23, 42, 0.4)"
        mask={`url(#${maskId})`}
      />
    </svg>
  )
}

function NodeOutline({
  kind,
  nodes,
  zoom,
}: {
  kind: "hover" | "selection" | "crop"
  nodes: Document["nodes"]
  zoom: number
}) {
  const singleNode = nodes.length === 1 ? nodes[0] : undefined
  const bounds = singleNode
    ? getNodeBounds(singleNode)
    : getSelectionBounds(nodes)
  if (!bounds) return null

  const rotated = singleNode && Math.abs(singleNode.rotation % 360) > 0.01
  const left = (rotated ? singleNode.x : bounds.left) * zoom
  const top = (rotated ? singleNode.y : bounds.top) * zoom
  const width = Math.max(8, (rotated ? singleNode.width : bounds.width) * zoom)
  const height = Math.max(
    8,
    (rotated ? singleNode.height : bounds.height) * zoom
  )
  const selected = kind !== "hover"
  const cropping = kind === "crop"
  const locked = nodes.every((node) => node.locked)

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-20 border-2 ${
        selected
          ? locked
            ? "border-dashed border-[#0d99ff]"
            : cropping
              ? "border-[#0d99ff] outline-1 outline-offset-2 outline-white/90"
              : "border-[#0d99ff]"
          : "border-dashed border-[#0d99ff]/80 bg-[#0d99ff]/5"
      }`}
      style={{
        left,
        top,
        width,
        height,
        transform: rotated ? `rotate(${singleNode.rotation}deg)` : undefined,
        transformOrigin: "top left",
      }}
    >
      {selected ? (
        <span className="absolute -top-6 left-[-2px] max-w-56 truncate rounded-[3px] bg-[#0d99ff] px-1.5 py-0.5 font-sans text-[10px] leading-4 font-medium text-white shadow-sm">
          {cropping
            ? "Drag image to reposition"
            : (singleNode?.name ?? `${nodes.length} layers`)}
        </span>
      ) : null}
      {selected && !locked && !cropping
        ? [
            "-top-1 -left-1",
            "-top-1 -right-1",
            "-bottom-1 -left-1",
            "-right-1 -bottom-1",
          ].map((position) => (
            <span
              key={position}
              className={`absolute size-2 rounded-[2px] border border-[#0d99ff] bg-white ${position}`}
            />
          ))
        : null}
    </div>
  )
}
