import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type {
  Document,
  TextRunStylePatch,
  TextSelection,
} from "@webmcp/document"
import type {
  CanvasAdapter,
  CanvasAdapterEvents,
  CanvasImageCropMode,
  CanvasImageCropPreview,
  CanvasImageSourceReadiness,
  CanvasNodeChange,
  CanvasTextEditingState,
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
  previewViewportZoom: (zoom: number, committedZoom: number) => void
  retryImageSources: () => void
  retryImageSource: (nodeId: string) => void
  enterTextEditing: (nodeId: string, selection?: TextSelection) => boolean
  commitTextEditing: () => boolean
  cancelTextEditing: () => boolean
  applyTextEditingStyle: (patch: TextRunStylePatch) => boolean
  cancelTransform: () => boolean
  getImageNaturalSize: (
    nodeId: string
  ) => Readonly<{ width: number; height: number }> | null
  nudgeImageCrop: (
    screenDelta: { x: number; y: number },
    zoom: number
  ) => boolean
}

export type CanvasRuntimeReport = Readonly<{
  status: "preparing" | "ready" | "error"
  attempt: number
  documentId: string
  documentRevision: number
  pageId: string
  stage: CanvasRuntimeFailureStage | null
}>

type FabricAdapterModule = Readonly<{
  FabricCanvasAdapter: new (events: CanvasAdapterEvents) => CanvasAdapter
}>

export type FabricArtboardRuntimeOptions = Readonly<{
  startupTimeoutMs?: number
  syncTimeoutMs?: number
  loadAdapter?: () => Promise<FabricAdapterModule>
}>

const DEFAULT_CANVAS_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_CANVAS_SYNC_TIMEOUT_MS = 20_000
const DEFAULT_IMAGE_RETRY_TIMEOUT_MS = 8_000
const loadDefaultFabricAdapter = () => import("@webmcp/editor/fabric")

class CanvasCleanupError extends Error {
  constructor(cause: unknown) {
    super("The previous canvas could not be disposed safely", { cause })
    this.name = "CanvasCleanupError"
  }
}

export const waitForCanvasOperation = <T,>(
  operation: Promise<T>,
  signal: AbortSignal
) => {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanUp()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    void operation.then(
      (value) => {
        cleanUp()
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        if (!signal.aborted) reject(error)
      }
    )
  })
}

const canvasTimeoutReason = (stage: CanvasRuntimeFailureStage) =>
  new DOMException(
    stage === "startup"
      ? "Canvas startup timed out"
      : "Canvas update timed out",
    "TimeoutError"
  )

export const FabricArtboard = forwardRef<
  FabricArtboardHandle,
  {
    document: Document
    pageId: string
    selection: Selection | null
    hoveredNodeId?: string | null
    textEditingNodeId?: string | null
    textEditingSelection?: TextSelection | null
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
    onRuntimeStateChange?: (state: CanvasRuntimeReport) => void
    runtimeOptions?: FabricArtboardRuntimeOptions
    onTextEditingStart?: (nodeId: string) => void
    onTextEditingChange?: (state: CanvasTextEditingState | null) => void
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
    textEditingSelection = null,
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
    runtimeOptions,
    onTextEditingStart,
    onTextEditingChange,
    onSelectionChange,
    onNodesChange,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const artboardChromeRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<CanvasAdapter | null>(null)
  const adapterLifecycleTailRef = useRef<Promise<void>>(Promise.resolve())
  const syncTailRef = useRef<Promise<void>>(Promise.resolve())
  const imageRetryControllersRef = useRef(new Map<string, AbortController>())
  const retryOwnedFocusRef = useRef(false)
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
    onTextEditingChange,
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
  const [mountedAttempt, setMountedAttempt] = useState<number | null>(null)
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
    onTextEditingChange,
    onSelectionChange,
    onNodesChange,
    textEditingNodeId,
    imageCropMode,
    interactive,
  }
  const runtimeIdentityRef = useRef({
    documentId: document.id,
    documentRevision: document.revision,
    pageId,
  })
  runtimeIdentityRef.current = {
    documentId: document.id,
    documentRevision: document.revision,
    pageId,
  }
  const loadAdapter = runtimeOptions?.loadAdapter ?? loadDefaultFabricAdapter
  const startupTimeoutMs =
    runtimeOptions?.startupTimeoutMs ?? DEFAULT_CANVAS_STARTUP_TIMEOUT_MS
  const syncTimeoutMs =
    runtimeOptions?.syncTimeoutMs ?? DEFAULT_CANVAS_SYNC_TIMEOUT_MS

  const page = useMemo(
    () => document.pages.find((candidate) => candidate.id === pageId),
    [document.pages, pageId]
  )
  const pageNodeIds = useMemo(
    () => new Set(page?.nodeIds ?? []),
    [page?.nodeIds]
  )
  const nodeById = useMemo(
    () => new Map(document.nodes.map((node) => [node.id, node])),
    [document.nodes]
  )
  const selectedNodes = useMemo(
    () =>
      (selection?.nodeIds ?? []).flatMap((nodeId) => {
        const node = nodeById.get(nodeId)
        return node && pageNodeIds.has(node.id) && node.visible ? [node] : []
      }),
    [nodeById, pageNodeIds, selection?.nodeIds]
  )
  const hoveredNode = useMemo(() => {
    if (!hoveredNodeId) return undefined
    const node = nodeById.get(hoveredNodeId)
    return node && pageNodeIds.has(node.id) && node.visible ? node : undefined
  }, [hoveredNodeId, nodeById, pageNodeIds])
  const cropNodeCandidate = imageCropMode
    ? nodeById.get(imageCropMode.nodeId)
    : undefined
  const cropNode =
    cropNodeCandidate?.type === "image" &&
    pageNodeIds.has(cropNodeCandidate.id) &&
    cropNodeCandidate.visible
      ? cropNodeCandidate
      : undefined
  currentImageSourceByNodeIdRef.current = useMemo(
    () =>
      new Map(
        document.nodes.flatMap((node) =>
          node.type === "image" && pageNodeIds.has(node.id)
            ? [[node.id, node.src] as const]
            : []
        )
      ),
    [document.nodes, pageNodeIds]
  )
  currentImageResourceTokenByNodeIdRef.current = useMemo(
    () =>
      new Map(
        document.nodes.flatMap((node) =>
          node.type === "image" && pageNodeIds.has(node.id)
            ? [[node.id, imageResourceTokens?.[node.id]] as const]
            : []
        )
      ),
    [document.nodes, imageResourceTokens, pageNodeIds]
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
      const resourceToken =
        currentImageResourceTokenByNodeIdRef.current.get(nodeId)
      const adapter = adapterRef.current
      if (!src || !adapter) return
      imageRetryControllersRef.current
        .get(nodeId)
        ?.abort(new DOMException("Image retry replaced", "AbortError"))
      const controller = new AbortController()
      imageRetryControllersRef.current.set(nodeId, controller)
      const timeout = globalThis.setTimeout(
        () =>
          controller.abort(
            new DOMException("Image retry timed out", "TimeoutError")
          ),
        DEFAULT_IMAGE_RETRY_TIMEOUT_MS
      )
      reportImageSourceState({
        nodeId,
        src,
        resourceToken,
        readiness: "loading",
      })
      void waitForCanvasOperation(
        adapter.retryImageSource(nodeId, controller.signal),
        controller.signal
      )
        .then((readiness) => {
          if (!readiness || controller.signal.aborted) return
          reportImageSourceState({ nodeId, src, resourceToken, readiness })
        })
        .catch(() => {
          if (controller.signal.reason?.name === "AbortError") return
          reportImageSourceState({
            nodeId,
            src,
            resourceToken,
            readiness: "unavailable",
          })
        })
        .finally(() => {
          globalThis.clearTimeout(timeout)
          if (imageRetryControllersRef.current.get(nodeId) === controller) {
            imageRetryControllersRef.current.delete(nodeId)
          }
        })
    },
    [reportImageSourceState]
  )

  useEffect(
    () => () => {
      for (const controller of imageRetryControllersRef.current.values()) {
        controller.abort(new DOMException("Canvas unmounted", "AbortError"))
      }
      imageRetryControllersRef.current.clear()
    },
    []
  )

  useImperativeHandle(
    ref,
    () => ({
      exportPng: () => adapterRef.current?.exportPng() ?? null,
      previewViewportZoom: (nextZoom, committedZoom) => {
        const chrome = artboardChromeRef.current
        if (!chrome || committedZoom <= 0) return
        chrome.style.transformOrigin = "top left"
        chrome.style.transform = `scale(${nextZoom / committedZoom})`
      },
      retryImageSources,
      retryImageSource,
      enterTextEditing: (nodeId, selection) =>
        adapterRef.current?.enterTextEditing(nodeId, selection) ?? false,
      commitTextEditing: () => adapterRef.current?.commitTextEditing() ?? false,
      cancelTextEditing: () => adapterRef.current?.cancelTextEditing() ?? false,
      applyTextEditingStyle: (patch) =>
        adapterRef.current?.applyTextEditingStyle(patch) ?? false,
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
    const isActive = () => active
    let adapter: CanvasAdapter | null = null
    const attempt = runtime.attempt
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(
      () => controller.abort(canvasTimeoutReason("startup")),
      startupTimeoutMs
    )
    const predecessor = Promise.all([
      adapterLifecycleTailRef.current,
      syncTailRef.current,
    ])
    const startup = predecessor
      .then(async () => {
        if (!isActive()) return
        const { FabricCanvasAdapter } = await waitForCanvasOperation(
          loadAdapter(),
          controller.signal
        )
        if (!isActive()) return
        const nextAdapter = new FabricCanvasAdapter({
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
          onTextEditingChange: (state) =>
            callbacksRef.current.onTextEditingChange?.(state),
        })
        adapter = nextAdapter
        nextAdapter.mount(element)
        describeInteractiveCanvas(element, canvasInstructionsId)
        if (!isActive()) {
          await nextAdapter.unmount()
          adapter = null
          return
        }
        adapterRef.current = nextAdapter
        setMountedAttempt(attempt)
      })
      .catch(async (error: unknown) => {
        let stage: CanvasRuntimeFailureStage =
          error instanceof CanvasCleanupError ? "cleanup" : "startup"
        if (adapter) {
          if (adapterRef.current === adapter) adapterRef.current = null
          try {
            await adapter.unmount()
          } catch {
            stage = "cleanup"
          }
          adapter = null
        }
        if (!isActive()) return
        setMountedAttempt((current) => (current === attempt ? null : current))
        callbacksRef.current.onRuntimeStateChange?.({
          status: "error",
          attempt,
          ...runtimeIdentityRef.current,
          stage,
        })
        setRuntime((current) =>
          reduceCanvasRuntimeState(current, {
            type: "failed",
            attempt,
            stage,
          })
        )
      })
      .finally(() => globalThis.clearTimeout(timeout))
    adapterLifecycleTailRef.current = startup.then(
      () => undefined,
      () => undefined
    )

    return () => {
      active = false
      controller.abort(new DOMException("Canvas attempt ended", "AbortError"))
      globalThis.clearTimeout(timeout)
      if (adapterRef.current === adapter) adapterRef.current = null
      const teardown = Promise.all([
        adapterLifecycleTailRef.current,
        syncTailRef.current,
      ]).then(async () => {
        if (!adapter) return
        try {
          await adapter.unmount()
          adapter = null
        } catch (error) {
          throw new CanvasCleanupError(error)
        }
      })
      void teardown.catch(() => undefined)
      adapterLifecycleTailRef.current = teardown
    }
  }, [
    canvasInstructionsId,
    loadAdapter,
    reportAllCurrentImageSources,
    runtime.attempt,
    startupTimeoutMs,
  ])

  useEffect(() => {
    if (!ready) return
    adapterRef.current?.setViewportZoom(zoom)
  }, [ready, zoom])

  useEffect(() => {
    if (!ready || !retryOwnedFocusRef.current) return
    retryOwnedFocusRef.current = false
    canvasRef.current?.parentElement
      ?.querySelector<HTMLElement>(".upper-canvas")
      ?.focus()
  }, [ready])

  useLayoutEffect(() => {
    const chrome = artboardChromeRef.current
    if (chrome) chrome.style.transform = "none"
  }, [zoom])

  useEffect(() => {
    if (!ready) return
    adapterRef.current?.setSnapTargets(pageId, snapTargets)
  }, [pageId, ready, snapTargets])

  useEffect(() => {
    if (mountedAttempt !== runtime.attempt) return
    const adapter = adapterRef.current
    if (!adapter) return
    settleCanvasInteractivity(adapter, interactive)
    let active = true
    const isActive = () => active
    const attempt = runtime.attempt
    const identity = {
      documentId: document.id,
      documentRevision: document.revision,
      pageId,
    }
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(
      () => controller.abort(canvasTimeoutReason("sync")),
      syncTimeoutMs
    )
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
    callbacksRef.current.onRuntimeStateChange?.({
      status: "preparing",
      attempt,
      ...identity,
      stage: null,
    })
    setRuntime((current) =>
      reduceCanvasRuntimeState(current, { type: "preparing", attempt })
    )
    const predecessor = syncTailRef.current
    const syncing = predecessor
      .then(async () => {
        if (!isActive()) return
        await waitForCanvasDocumentFonts(
          document,
          pageId,
          undefined,
          controller.signal
        )
        if (!isActive()) return
        await adapter.sync(document, pageId, controller.signal)
      })
      .then(async () => {
        if (!isActive() || adapterRef.current !== adapter) return
        controller.signal.throwIfAborted()
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
        applyImageCropMode(
          adapter,
          callbacksRef.current.interactive
            ? callbacksRef.current.imageCropMode
            : null
        )
        callbacksRef.current.onRuntimeStateChange?.({
          status: "ready",
          attempt,
          ...identity,
          stage: null,
        })
        setRuntime((current) =>
          reduceCanvasRuntimeState(current, { type: "ready", attempt })
        )
      })
      .catch(() => {
        if (!isActive()) return
        callbacksRef.current.onRuntimeStateChange?.({
          status: "error",
          attempt,
          ...identity,
          stage: "sync",
        })
        setRuntime((current) =>
          reduceCanvasRuntimeState(current, {
            type: "failed",
            attempt,
            stage: "sync",
          })
        )
      })
      .finally(() => globalThis.clearTimeout(timeout))
    syncTailRef.current = syncing.then(
      () => undefined,
      () => undefined
    )
    return () => {
      active = false
      controller.abort(new DOMException("Canvas update ended", "AbortError"))
      globalThis.clearTimeout(timeout)
    }
  }, [
    applyImageCropMode,
    document,
    interactive,
    pageId,
    page,
    mountedAttempt,
    reportImageSourceState,
    runtime.attempt,
    imageResourceTokens,
    syncTimeoutMs,
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
    const adapter = adapterRef.current
    if (!adapter) return
    let active = true
    const requestedNodeId = textEditingNodeId
    const requestedSelection = textEditingSelection ?? undefined
    void syncTailRef.current.then(() => {
      if (
        !active ||
        adapterRef.current !== adapter ||
        !callbacksRef.current.interactive ||
        callbacksRef.current.textEditingNodeId !== requestedNodeId
      ) {
        return
      }
      if (adapter.enterTextEditing(requestedNodeId, requestedSelection)) {
        callbacksRef.current.onTextEditingStart?.(requestedNodeId)
      }
    })
    return () => {
      active = false
    }
  }, [interactive, ready, textEditingNodeId, textEditingSelection])

  useEffect(() => {
    if (!ready) return
    adapterRef.current?.select(selection)
  }, [ready, selection])

  if (!page) return null

  return (
    <div
      ref={artboardChromeRef}
      className="relative shrink-0 shadow-[0_24px_70px_rgba(35,31,25,0.18)] ring-1 ring-black/10"
      style={{ width: page.width * zoom, height: page.height * zoom }}
    >
      <div
        aria-hidden={!ready}
        inert={!ready}
        className={`absolute top-0 left-0 origin-top-left bg-white ${interactive && ready ? "" : "pointer-events-none"}`}
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
      {ready &&
      hoveredNode &&
      !selectedNodes.some((node) => node.id === hoveredNode.id) ? (
        <NodeOutline kind="hover" nodes={[hoveredNode]} zoom={zoom} />
      ) : null}
      {ready && cropNode && imageCropPreviewStore ? (
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
      ) : ready && cropNode ? (
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
      ) : ready && selectedNodes.length ? (
        <NodeOutline kind="selection" nodes={selectedNodes} zoom={zoom} />
      ) : null}
      <CanvasRuntimeOverlay
        runtime={runtime}
        onRetry={() => {
          retryOwnedFocusRef.current = true
          retryImageSources()
        }}
      />
    </div>
  )
})

export type CanvasFontFaceSet = Pick<FontFaceSet, "check" | "load" | "ready">

export function canvasDocumentFontRequests(document: Document, pageId: string) {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) return []
  const pageNodeIds = new Set(page.nodeIds)
  const requests = new Map<string, { descriptor: string; sample: string }>()
  for (const node of document.nodes) {
    if (node.type !== "text" || !pageNodeIds.has(node.id) || !node.visible) {
      continue
    }
    const addRequest = (
      family: string,
      size: number,
      weight: number,
      italic: boolean,
      sample: string
    ) => {
      const descriptor = `${italic ? "italic " : ""}${weight} ${size}px ${JSON.stringify(family)}`
      const resolvedSample = sample || "M"
      const key = `${descriptor}\u0000${resolvedSample}`
      requests.set(key, { descriptor, sample: resolvedSample })
    }
    addRequest(
      node.fontFamily,
      node.fontSize,
      node.fontWeight,
      false,
      node.text
    )
    for (const run of node.runs) {
      addRequest(
        run.style.fontFamily ?? node.fontFamily,
        run.style.fontSize ?? node.fontSize,
        run.style.fontWeight ?? node.fontWeight,
        run.style.italic ?? false,
        node.text.slice(run.start, run.end)
      )
    }
  }
  return [...requests.values()]
}

export async function waitForCanvasDocumentFonts(
  document: Document,
  pageId: string,
  fontFaceSet: CanvasFontFaceSet | undefined = getBrowserFontFaceSet(),
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  if (!fontFaceSet) return
  const requests = canvasDocumentFontRequests(document, pageId)
  const loading = Promise.all(
    requests.map(({ descriptor, sample }) =>
      fontFaceSet.load(descriptor, sample)
    )
  )
  const loadedFaces = signal
    ? await waitForCanvasOperation(loading, signal)
    : await loading
  signal?.throwIfAborted()
  for (const [index, faces] of loadedFaces.entries()) {
    if (!faces.length) {
      throw new Error(
        `Canvas font unavailable: ${requests[index]?.descriptor ?? "unknown"}`
      )
    }
  }
  for (const { descriptor, sample } of requests) {
    if (!fontFaceSet.check(descriptor, sample)) {
      throw new Error(`Canvas font unavailable: ${descriptor}`)
    }
  }
}

function getBrowserFontFaceSet(): CanvasFontFaceSet | undefined {
  return typeof window === "undefined" ? undefined : window.document.fonts
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

export type CanvasRuntimeFailureStage = "startup" | "sync" | "cleanup"

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
  | Readonly<{ type: "preparing"; attempt: number }>
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
  if (event.type === "preparing") {
    return {
      status: "preparing",
      attempt: state.attempt,
      userRetried: state.userRetried,
      stage: null,
    }
  }
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
  if (stage === "startup") {
    return "The editor canvas could not start. Your document is unchanged."
  }
  if (stage === "cleanup") {
    return "The previous canvas could not close safely. Reload the editor before continuing."
  }
  return "The editor canvas could not update. Your document is unchanged."
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
      {runtime.stage === "cleanup" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => globalThis.location.reload()}
        >
          Reload editor
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onRetry} autoFocus>
          Retry canvas
        </Button>
      )}
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
