import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import {
  beginExistingGuideDrag,
  beginRulerGuideDrag,
  buildRulerTicks,
  GUIDE_HIT_TOLERANCE_PX,
  hitTestPageGuides,
  pageGuideScreenPosition,
  pagePointToScreen,
  RULER_SIZE_PX,
  settlePageGuideDrag,
  updatePageGuideDrag,
} from "@webmcp/editor/page-guides"
import type {
  EditorWorkspacePreferences,
  GuideAxis,
  PageGuide,
  PageGuideDrag,
  PageSize,
} from "@webmcp/editor/page-guides"
import type { CanvasCamera, ViewportSize } from "@webmcp/editor/viewport"

export type CanvasSelectionBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

type GuideMutation = Readonly<{ axis: GuideAxis; position: number }>

export type CanvasRulerGuideOverlayProps = Readonly<{
  pageId: string
  camera: CanvasCamera
  viewport: ViewportSize
  pageSize: PageSize
  guides: readonly PageGuide[]
  preferences: EditorWorkspacePreferences
  selectionBounds?: CanvasSelectionBounds | null
  selectedGuideId: string | null
  interactive?: boolean
  onGuideSelectionChange: (guideId: string | null) => void
  onGuideHoverChange?: (guideId: string | null) => void
  onAddGuide: (guide: GuideMutation) => string | void
  onMoveGuide: (guideId: string, position: number) => void
  onDuplicateGuide: (guideId: string, position: number) => string | void
  onRemoveGuide: (guideId: string) => void
  onGuideDragActiveChange?: (active: boolean) => void
}>

export type CanvasRulerGuideOverlayHandle = Readonly<{
  cancelGuideDrag: () => boolean
  clearGuideHover: () => void
  updateCamera: (camera: CanvasCamera) => void
}>

type OverlayTheme = Readonly<{
  background: string
  foreground: string
  accent: string
}>

type DrawOverlayInput = Readonly<{
  width: number
  height: number
  dpr: number
  camera: CanvasCamera
  pageSize: PageSize
  guides: readonly PageGuide[]
  preferences: EditorWorkspacePreferences
  selectionBounds?: CanvasSelectionBounds | null
  selectedGuideId: string | null
  hoveredGuideId: string | null
  drag: PageGuideDrag | null
  theme: OverlayTheme
}>

const DEFAULT_THEME: OverlayTheme = {
  background: "rgb(250 250 250 / 0.96)",
  foreground: "rgb(24 24 27)",
  accent: "#0070f3",
}

const guideAxisCursor = (axis: GuideAxis) =>
  axis === "x" ? "col-resize" : "row-resize"

const formatGuideCoordinate = (position: number) => {
  const rounded = Number(position.toFixed(2))
  return Object.is(rounded, -0) ? "0" : String(rounded)
}

const sameCamera = (left: CanvasCamera, right: CanvasCamera) =>
  left.x === right.x && left.y === right.y && left.zoom === right.zoom

function projectGuideHitTarget(
  element: HTMLDivElement,
  guide: PageGuide,
  camera: CanvasCamera,
  viewport: ViewportSize,
  rulersVisible: boolean
) {
  const position = pageGuideScreenPosition(guide, camera)
  const viewportLength = guide.axis === "x" ? viewport.width : viewport.height
  element.hidden =
    position < -GUIDE_HIT_TOLERANCE_PX ||
    position > viewportLength + GUIDE_HIT_TOLERANCE_PX
  if (guide.axis === "x") {
    element.style.left = `${position - GUIDE_HIT_TOLERANCE_PX}px`
    element.style.top = `${rulersVisible ? RULER_SIZE_PX : 0}px`
  } else {
    element.style.left = `${rulersVisible ? RULER_SIZE_PX : 0}px`
    element.style.top = `${position - GUIDE_HIT_TOLERANCE_PX}px`
  }
}

function drawSelectionBands(
  context: CanvasRenderingContext2D,
  input: DrawOverlayInput
) {
  const bounds = input.selectionBounds
  if (!bounds) return
  const start = pagePointToScreen({ x: bounds.x, y: bounds.y }, input.camera)
  const end = pagePointToScreen(
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    input.camera
  )
  context.save()
  context.globalAlpha = 0.1
  context.fillStyle = input.theme.accent
  context.fillRect(
    Math.max(RULER_SIZE_PX, start.x),
    0,
    Math.max(
      0,
      Math.min(input.width, end.x) - Math.max(RULER_SIZE_PX, start.x)
    ),
    RULER_SIZE_PX
  )
  context.fillRect(
    0,
    Math.max(RULER_SIZE_PX, start.y),
    RULER_SIZE_PX,
    Math.max(
      0,
      Math.min(input.height, end.y) - Math.max(RULER_SIZE_PX, start.y)
    )
  )
  context.restore()
}

function drawRulerTicks(
  context: CanvasRenderingContext2D,
  input: DrawOverlayInput
) {
  const horizontal = buildRulerTicks({
    axis: "x",
    camera: input.camera,
    viewportLength: input.width,
  })
  const vertical = buildRulerTicks({
    axis: "y",
    camera: input.camera,
    viewportLength: input.height,
  })

  context.save()
  context.strokeStyle = input.theme.foreground
  context.fillStyle = input.theme.foreground
  context.globalAlpha = 0.52
  context.lineWidth = 1
  context.font = "9px Geist, ui-sans-serif, system-ui, sans-serif"
  context.textBaseline = "middle"

  for (const tick of horizontal) {
    const length = tick.major ? 7 : 4
    const x = Math.round(tick.screen) + 0.5
    context.beginPath()
    context.moveTo(x, RULER_SIZE_PX - length)
    context.lineTo(x, RULER_SIZE_PX)
    context.stroke()
    if (tick.label !== null) {
      context.fillText(tick.label, tick.screen + 3, 7)
    }
  }

  for (const tick of vertical) {
    const length = tick.major ? 7 : 4
    const y = Math.round(tick.screen) + 0.5
    context.beginPath()
    context.moveTo(RULER_SIZE_PX - length, y)
    context.lineTo(RULER_SIZE_PX, y)
    context.stroke()
    if (tick.label !== null) {
      context.save()
      context.translate(7, tick.screen - 3)
      context.rotate(-Math.PI / 2)
      context.fillText(tick.label, 0, 0)
      context.restore()
    }
  }
  context.restore()
}

function drawGuideLine(
  context: CanvasRenderingContext2D,
  input: DrawOverlayInput,
  guide: Pick<PageGuide, "axis" | "position">,
  state: "idle" | "hovered" | "selected" | "preview"
) {
  const screen = pageGuideScreenPosition(guide, input.camera)
  context.save()
  context.strokeStyle = input.theme.accent
  context.globalAlpha = state === "idle" ? 0.58 : state === "hovered" ? 0.82 : 1
  context.lineWidth = 1
  if (state === "preview") context.setLineDash([4, 3])
  context.beginPath()
  if (guide.axis === "x") {
    const x = Math.round(screen) + 0.5
    context.moveTo(x, input.preferences.rulersVisible ? RULER_SIZE_PX : 0)
    context.lineTo(x, input.height)
  } else {
    const y = Math.round(screen) + 0.5
    context.moveTo(input.preferences.rulersVisible ? RULER_SIZE_PX : 0, y)
    context.lineTo(input.width, y)
  }
  context.stroke()
  context.restore()
}

function drawCoordinateBadge(
  context: CanvasRenderingContext2D,
  input: DrawOverlayInput,
  guide: Pick<PageGuide, "axis" | "position">
) {
  const label = formatGuideCoordinate(guide.position)
  const screen = pageGuideScreenPosition(guide, input.camera)
  context.save()
  context.font = "500 9px Geist, ui-sans-serif, system-ui, sans-serif"
  context.textBaseline = "middle"
  context.fillStyle = input.theme.accent
  const padding = 4
  const height = 14
  const width = context.measureText(label).width + padding * 2
  if (guide.axis === "x") {
    const x = Math.min(
      input.width - width / 2,
      Math.max(RULER_SIZE_PX + width / 2, screen)
    )
    context.beginPath()
    context.roundRect(x - width / 2, 3, width, height, 3)
    context.fill()
    context.fillStyle = "white"
    context.textAlign = "center"
    context.fillText(label, x, 10)
  } else {
    const y = Math.min(
      input.height - width / 2,
      Math.max(RULER_SIZE_PX + width / 2, screen)
    )
    context.translate(10, y)
    context.rotate(-Math.PI / 2)
    context.beginPath()
    context.roundRect(-width / 2, -height / 2, width, height, 3)
    context.fill()
    context.fillStyle = "white"
    context.textAlign = "center"
    context.fillText(label, 0, 0)
  }
  context.restore()
}

export function drawCanvasRulerGuideOverlay(
  context: CanvasRenderingContext2D,
  input: DrawOverlayInput
) {
  context.setTransform(input.dpr, 0, 0, input.dpr, 0, 0)
  context.clearRect(0, 0, input.width, input.height)

  if (input.preferences.rulersVisible) {
    context.save()
    context.fillStyle = input.theme.background
    context.fillRect(0, 0, input.width, RULER_SIZE_PX)
    context.fillRect(
      0,
      RULER_SIZE_PX,
      RULER_SIZE_PX,
      input.height - RULER_SIZE_PX
    )
    context.strokeStyle = input.theme.foreground
    context.globalAlpha = 0.14
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(0, RULER_SIZE_PX - 0.5)
    context.lineTo(input.width, RULER_SIZE_PX - 0.5)
    context.moveTo(RULER_SIZE_PX - 0.5, 0)
    context.lineTo(RULER_SIZE_PX - 0.5, input.height)
    context.stroke()
    context.restore()
    drawSelectionBands(context, input)
    drawRulerTicks(context, input)
  }

  if (input.preferences.guidesVisible) {
    const movingGuideId =
      input.drag?.dragStarted &&
      input.drag.source.kind === "guide" &&
      !input.drag.source.duplicate
        ? input.drag.source.guideId
        : null
    for (const guide of input.guides) {
      if (guide.id === movingGuideId) continue
      const state =
        guide.id === input.selectedGuideId
          ? "selected"
          : guide.id === input.hoveredGuideId
            ? "hovered"
            : "idle"
      drawGuideLine(context, input, guide, state)
    }
    if (input.drag?.dragStarted) {
      drawGuideLine(context, input, input.drag, "preview")
    }
  }

  if (input.preferences.rulersVisible && input.preferences.guidesVisible) {
    const labelled = input.drag?.dragStarted
      ? input.drag
      : (input.guides.find((guide) => guide.id === input.selectedGuideId) ??
        input.guides.find((guide) => guide.id === input.hoveredGuideId))
    if (labelled) drawCoordinateBadge(context, input, labelled)
  }
}

export const CanvasRulerGuideOverlay = forwardRef<
  CanvasRulerGuideOverlayHandle,
  CanvasRulerGuideOverlayProps
>(function CanvasRulerGuideOverlay(
  {
    pageId,
    camera,
    viewport,
    pageSize,
    guides,
    preferences,
    selectionBounds = null,
    selectedGuideId,
    interactive = true,
    onGuideSelectionChange,
    onGuideHoverChange,
    onAddGuide,
    onMoveGuide,
    onDuplicateGuide,
    onRemoveGuide,
    onGuideDragActiveChange,
  },
  forwardedRef
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const dragRef = useRef<PageGuideDrag | null>(null)
  const hoverRef = useRef<string | null>(null)
  const captureRef = useRef<{ element: Element; pointerId: number } | null>(
    null
  )
  const guideHitElementsRef = useRef(new Map<string, HTMLDivElement>())
  const committedCameraRef = useRef(camera)
  const liveCameraRef = useRef(camera)
  const previousBoundaryRef = useRef({
    pageId,
    rulersVisible: preferences.rulersVisible,
    guidesVisible: preferences.guidesVisible,
    interactive,
  })
  const latestRef = useRef({
    camera,
    viewport,
    pageSize,
    guides,
    preferences,
    selectionBounds,
    selectedGuideId,
  })
  if (!sameCamera(committedCameraRef.current, camera)) {
    committedCameraRef.current = camera
    liveCameraRef.current = camera
  }
  latestRef.current = {
    camera: liveCameraRef.current,
    viewport,
    pageSize,
    guides,
    preferences,
    selectionBounds,
    selectedGuideId,
  }

  const draw = useCallback(() => {
    frameRef.current = null
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    const latest = latestRef.current
    const width = canvas.clientWidth || latest.viewport.width
    const height = canvas.clientHeight || latest.viewport.height
    if (width <= 0 || height <= 0) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const backingWidth = Math.round(width * dpr)
    const backingHeight = Math.round(height * dpr)
    if (canvas.width !== backingWidth) canvas.width = backingWidth
    if (canvas.height !== backingHeight) canvas.height = backingHeight
    const computed = window.getComputedStyle(canvas)
    drawCanvasRulerGuideOverlay(context, {
      width,
      height,
      dpr,
      camera: latest.camera,
      pageSize: latest.pageSize,
      guides: latest.guides,
      preferences: latest.preferences,
      selectionBounds: latest.selectionBounds,
      selectedGuideId: latest.selectedGuideId,
      hoveredGuideId: hoverRef.current,
      drag: dragRef.current,
      theme: {
        background:
          computed.getPropertyValue("--background").trim() ||
          DEFAULT_THEME.background,
        foreground:
          computed.getPropertyValue("color").trim() || DEFAULT_THEME.foreground,
        accent: DEFAULT_THEME.accent,
      },
    })
  }, [])

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(draw)
  }, [draw])

  const syncGuideHitTargets = useCallback(() => {
    const latest = latestRef.current
    for (const guide of latest.guides) {
      const element = guideHitElementsRef.current.get(guide.id)
      if (!element) continue
      projectGuideHitTarget(
        element,
        guide,
        latest.camera,
        latest.viewport,
        latest.preferences.rulersVisible
      )
    }
  }, [])

  const clearHover = useCallback(() => {
    if (hoverRef.current === null) return
    hoverRef.current = null
    onGuideHoverChange?.(null)
    requestDraw()
  }, [onGuideHoverChange, requestDraw])

  const cancelDrag = useCallback(() => {
    if (!dragRef.current) return false
    const capture = captureRef.current
    if (
      capture &&
      "hasPointerCapture" in capture.element &&
      capture.element.hasPointerCapture(capture.pointerId)
    ) {
      capture.element.releasePointerCapture(capture.pointerId)
    }
    dragRef.current = null
    captureRef.current = null
    onGuideDragActiveChange?.(false)
    requestDraw()
    return true
  }, [onGuideDragActiveChange, requestDraw])

  useImperativeHandle(
    forwardedRef,
    () => ({
      cancelGuideDrag: cancelDrag,
      clearGuideHover: clearHover,
      updateCamera: (nextCamera) => {
        liveCameraRef.current = nextCamera
        latestRef.current = { ...latestRef.current, camera: nextCamera }
        syncGuideHitTargets()
        requestDraw()
      },
    }),
    [cancelDrag, clearHover, requestDraw, syncGuideHitTargets]
  )

  useLayoutEffect(() => {
    syncGuideHitTargets()
  }, [camera, guides, preferences.rulersVisible, syncGuideHitTargets, viewport])

  useEffect(() => {
    requestDraw()
  }, [
    camera,
    guides,
    pageSize,
    preferences,
    requestDraw,
    selectedGuideId,
    selectionBounds,
    viewport,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(requestDraw)
    observer.observe(canvas)
    observerRef.current = observer
    requestDraw()
    return () => {
      observer.disconnect()
      observerRef.current = null
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [requestDraw])

  useEffect(() => {
    const previous = previousBoundaryRef.current
    const boundaryChanged =
      previous.pageId !== pageId ||
      previous.rulersVisible !== preferences.rulersVisible ||
      previous.guidesVisible !== preferences.guidesVisible ||
      previous.interactive !== interactive
    previousBoundaryRef.current = {
      pageId,
      rulersVisible: preferences.rulersVisible,
      guidesVisible: preferences.guidesVisible,
      interactive,
    }
    if (boundaryChanged) {
      cancelDrag()
      clearHover()
    }
  }, [
    cancelDrag,
    clearHover,
    interactive,
    pageId,
    preferences.guidesVisible,
    preferences.rulersVisible,
  ])

  useEffect(
    () => () => {
      if (dragRef.current) onGuideDragActiveChange?.(false)
    },
    [onGuideDragActiveChange]
  )

  if (!preferences.rulersVisible && !preferences.guidesVisible) return null

  const screenPoint = (event: ReactPointerEvent) => {
    const rect = rootRef.current?.getBoundingClientRect()
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    }
  }

  const capturePointer = (event: ReactPointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    captureRef.current = {
      element: event.currentTarget,
      pointerId: event.pointerId,
    }
    onGuideDragActiveChange?.(true)
  }

  const startRulerDrag = (axis: GuideAxis, event: ReactPointerEvent) => {
    if (!interactive || event.button !== 0) return
    const latest = latestRef.current
    capturePointer(event)
    dragRef.current = beginRulerGuideDrag(
      axis,
      screenPoint(event),
      latest.camera
    )
    onGuideSelectionChange(null)
    clearHover()
    requestDraw()
  }

  const startExistingDrag = (guide: PageGuide, event: ReactPointerEvent) => {
    if (!interactive || event.button !== 0) return
    const latest = latestRef.current
    const point = screenPoint(event)
    const targetGuide =
      hitTestPageGuides(latest.guides, point, latest.camera, latest.viewport)
        ?.guide ?? guide
    capturePointer(event)
    dragRef.current = beginExistingGuideDrag(
      targetGuide,
      point,
      latest.camera,
      { duplicate: event.altKey }
    )
    onGuideSelectionChange(targetGuide.id)
    clearHover()
    requestDraw()
  }

  const moveDrag = (event: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== captureRef.current?.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = updatePageGuideDrag(
      drag,
      screenPoint(event),
      latestRef.current.camera
    )
    requestDraw()
  }

  const finishDrag = (event: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== captureRef.current?.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const latest = latestRef.current
    const updated = updatePageGuideDrag(drag, screenPoint(event), latest.camera)
    const settlement = settlePageGuideDrag(updated, {
      pageSize: latest.pageSize,
    })
    dragRef.current = null
    captureRef.current = null
    onGuideDragActiveChange?.(false)
    switch (settlement.type) {
      case "add": {
        const guideId = onAddGuide({
          axis: settlement.axis,
          position: settlement.position,
        })
        if (guideId) onGuideSelectionChange(guideId)
        break
      }
      case "move":
        onMoveGuide(settlement.guideId, settlement.position)
        onGuideSelectionChange(settlement.guideId)
        break
      case "duplicate": {
        const guideId = onDuplicateGuide(
          settlement.guideId,
          settlement.position
        )
        if (guideId) onGuideSelectionChange(guideId)
        break
      }
      case "remove":
        onRemoveGuide(settlement.guideId)
        onGuideSelectionChange(null)
        break
      case "cancel":
      case "none":
        break
    }
    requestDraw()
  }

  const cancelPointerDrag = (event: ReactPointerEvent) => {
    if (event.pointerId !== captureRef.current?.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    cancelDrag()
  }

  const pointerHandlers = {
    onPointerMove: moveDrag,
    onPointerUp: finishDrag,
    onPointerCancel: cancelPointerDrag,
  }

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      data-canvas-ruler-guide-overlay="true"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 size-full text-foreground"
        data-ruler-guide-canvas="true"
      />

      {interactive && preferences.rulersVisible && preferences.guidesVisible ? (
        <>
          <div
            className="pointer-events-auto absolute top-0 right-0 h-5 cursor-row-resize touch-none [@media(pointer:coarse)]:pointer-events-none"
            data-ruler-hit-axis="y"
            style={{ left: RULER_SIZE_PX }}
            onPointerDown={(event) => startRulerDrag("y", event)}
            {...pointerHandlers}
          />
          <div
            className="pointer-events-auto absolute bottom-0 left-0 w-5 cursor-col-resize touch-none [@media(pointer:coarse)]:pointer-events-none"
            data-ruler-hit-axis="x"
            style={{ top: RULER_SIZE_PX }}
            onPointerDown={(event) => startRulerDrag("x", event)}
            {...pointerHandlers}
          />
        </>
      ) : null}

      {interactive && preferences.guidesVisible
        ? guides.map((guide) => {
            const style: CSSProperties =
              guide.axis === "x"
                ? {
                    bottom: 0,
                    left:
                      pageGuideScreenPosition(guide, liveCameraRef.current) -
                      GUIDE_HIT_TOLERANCE_PX,
                    top: preferences.rulersVisible ? RULER_SIZE_PX : 0,
                    width: GUIDE_HIT_TOLERANCE_PX * 2,
                  }
                : {
                    height: GUIDE_HIT_TOLERANCE_PX * 2,
                    left: preferences.rulersVisible ? RULER_SIZE_PX : 0,
                    right: 0,
                    top:
                      pageGuideScreenPosition(guide, liveCameraRef.current) -
                      GUIDE_HIT_TOLERANCE_PX,
                  }
            return (
              <div
                key={guide.id}
                ref={(element) => {
                  if (element) {
                    guideHitElementsRef.current.set(guide.id, element)
                    projectGuideHitTarget(
                      element,
                      guide,
                      liveCameraRef.current,
                      viewport,
                      preferences.rulersVisible
                    )
                  } else {
                    guideHitElementsRef.current.delete(guide.id)
                  }
                }}
                className="pointer-events-auto absolute touch-none [@media(pointer:coarse)]:pointer-events-none"
                data-guide-hit-axis={guide.axis}
                data-guide-hit-id={guide.id}
                style={{ ...style, cursor: guideAxisCursor(guide.axis) }}
                onPointerDown={(event) => startExistingDrag(guide, event)}
                onPointerEnter={() => {
                  hoverRef.current = guide.id
                  onGuideHoverChange?.(guide.id)
                  requestDraw()
                }}
                onPointerLeave={() => {
                  if (dragRef.current) return
                  clearHover()
                }}
                {...pointerHandlers}
              />
            )
          })
        : null}
    </div>
  )
})
