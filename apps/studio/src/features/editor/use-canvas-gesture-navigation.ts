import { useEffect } from "react"
import type { RefObject } from "react"
import { zoomCameraAtPoint } from "@webmcp/editor/viewport"
import type { CanvasCamera } from "@webmcp/editor/viewport"

type SafariGestureEvent = Event & {
  clientX: number
  clientY: number
  scale: number
}

type WheelNavigationInput = Pick<
  WheelEvent,
  "ctrlKey" | "deltaMode" | "deltaX" | "deltaY" | "metaKey" | "shiftKey"
>

type WheelAccumulator = {
  deltaX: number
  deltaY: number
  hasZoom: boolean
  zoomCenterX: number
  zoomCenterY: number
  zoomScale: number
}

type TouchCameraGesture = {
  startDistance: number
  startZoom: number
  anchor: { x: number; y: number }
  lastMidpoint: { x: number; y: number }
}

const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2
const WHEEL_ZOOM_SPEED = 1.25

const normalizedWheelDelta = (
  event: Pick<WheelNavigationInput, "deltaMode" | "deltaX" | "deltaY">
) => {
  let { deltaX, deltaY } = event
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    deltaX *= 40
    deltaY *= 40
  } else if (event.deltaMode === WHEEL_DELTA_PAGE) {
    deltaX *= 800
    deltaY *= 800
  }
  return { deltaX, deltaY }
}

export const wheelPanDelta = (
  event: Pick<
    WheelNavigationInput,
    "deltaMode" | "deltaX" | "deltaY" | "shiftKey"
  >
) => {
  const delta = normalizedWheelDelta(event)
  if (!event.shiftKey || Math.abs(delta.deltaX) >= Math.abs(delta.deltaY)) {
    return delta
  }
  return { deltaX: delta.deltaY, deltaY: 0 }
}

export const wheelZoomScale = (
  event: Pick<WheelNavigationInput, "ctrlKey" | "deltaMode" | "deltaY">,
  isMacOs: boolean
) => {
  const modeScale =
    event.deltaMode === WHEEL_DELTA_LINE
      ? 0.05
      : event.deltaMode === WHEEL_DELTA_PAGE
        ? 1
        : 0.002
  const platformFactor = event.ctrlKey && isMacOs ? 10 : 1
  return 2 ** (-event.deltaY * modeScale * platformFactor * WHEEL_ZOOM_SPEED)
}

export function twoTouchNavigationMetrics(
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

const isMacOs = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

export function useCanvasGestureNavigation({
  workspaceRef,
  cameraRef,
  applyCamera,
  onManualNavigation,
}: {
  workspaceRef: RefObject<HTMLElement | null>
  cameraRef: RefObject<CanvasCamera>
  applyCamera: (camera: CanvasCamera) => void
  onManualNavigation: () => void
}) {
  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return

    // React delegates wheel events through a passive listener. A native,
    // non-passive listener is required so a trackpad pinch cannot become
    // browser-page zoom before the canvas camera receives it.
    const nonPassive = { passive: false } as const
    let safariGestureStartZoom = cameraRef.current.zoom
    let touchCameraGesture: TouchCameraGesture | null = null
    let frameRequest: number | null = null
    const wheel: WheelAccumulator = {
      deltaX: 0,
      deltaY: 0,
      hasZoom: false,
      zoomCenterX: 0,
      zoomCenterY: 0,
      zoomScale: 1,
    }

    const viewportPoint = (clientX: number, clientY: number) => {
      const rect = workspace.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const zoomAtClientPoint = (
      requestedZoom: number,
      clientX: number,
      clientY: number
    ) => {
      applyCamera(
        zoomCameraAtPoint(
          cameraRef.current,
          requestedZoom,
          viewportPoint(clientX, clientY)
        )
      )
    }

    const resetWheel = () => {
      wheel.deltaX = 0
      wheel.deltaY = 0
      wheel.hasZoom = false
      wheel.zoomScale = 1
    }

    const flushWheel = () => {
      frameRequest = null
      if (wheel.hasZoom) {
        applyCamera(
          zoomCameraAtPoint(
            cameraRef.current,
            cameraRef.current.zoom * wheel.zoomScale,
            { x: wheel.zoomCenterX, y: wheel.zoomCenterY }
          )
        )
      } else if (wheel.deltaX || wheel.deltaY) {
        applyCamera({
          ...cameraRef.current,
          x: cameraRef.current.x + wheel.deltaX,
          y: cameraRef.current.y + wheel.deltaY,
        })
      }
      resetWheel()
    }

    const scheduleWheel = () => {
      if (frameRequest === null) {
        frameRequest = window.requestAnimationFrame(flushWheel)
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onManualNavigation()

      if (event.ctrlKey || event.metaKey) {
        const point = viewportPoint(event.clientX, event.clientY)
        wheel.zoomCenterX = point.x
        wheel.zoomCenterY = point.y
        wheel.zoomScale *= wheelZoomScale(event, isMacOs())
        wheel.hasZoom = true
      } else {
        const delta = wheelPanDelta(event)
        wheel.deltaX -= delta.deltaX
        wheel.deltaY -= delta.deltaY
      }
      scheduleWheel()
    }

    const onGestureStart = (rawEvent: Event) => {
      const event = rawEvent as SafariGestureEvent
      event.preventDefault()
      event.stopPropagation()
      safariGestureStartZoom = cameraRef.current.zoom
      onManualNavigation()
    }

    const onGestureChange = (rawEvent: Event) => {
      const event = rawEvent as SafariGestureEvent
      event.preventDefault()
      event.stopPropagation()
      zoomAtClientPoint(
        safariGestureStartZoom * event.scale,
        event.clientX,
        event.clientY
      )
    }

    const onGestureEnd = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.defaultPrevented) return
      const metrics = twoTouchNavigationMetrics(event.touches)
      if (!metrics || metrics.distance <= 0) return
      const anchor = viewportPoint(metrics.midpoint.x, metrics.midpoint.y)
      touchCameraGesture = {
        startDistance: metrics.distance,
        startZoom: cameraRef.current.zoom,
        anchor,
        lastMidpoint: metrics.midpoint,
      }
      event.preventDefault()
      event.stopPropagation()
      onManualNavigation()
    }

    const onTouchMove = (event: TouchEvent) => {
      if (event.defaultPrevented) {
        touchCameraGesture = null
        return
      }
      const gesture = touchCameraGesture
      const metrics = twoTouchNavigationMetrics(event.touches)
      if (!gesture || !metrics) return
      const translatedX = metrics.midpoint.x - gesture.lastMidpoint.x
      const translatedY = metrics.midpoint.y - gesture.lastMidpoint.y
      const zoomed = zoomCameraAtPoint(
        cameraRef.current,
        gesture.startZoom * (metrics.distance / gesture.startDistance),
        gesture.anchor
      )
      applyCamera({
        ...zoomed,
        x: zoomed.x + translatedX,
        y: zoomed.y + translatedY,
      })
      gesture.lastMidpoint = metrics.midpoint
      event.preventDefault()
      event.stopPropagation()
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!touchCameraGesture) return
      if (event.touches.length < 2) touchCameraGesture = null
      event.preventDefault()
      event.stopPropagation()
    }

    workspace.addEventListener("wheel", onWheel, nonPassive)
    workspace.addEventListener("gesturestart", onGestureStart, nonPassive)
    workspace.addEventListener("gesturechange", onGestureChange, nonPassive)
    workspace.addEventListener("gestureend", onGestureEnd, nonPassive)
    workspace.addEventListener("touchstart", onTouchStart, nonPassive)
    workspace.addEventListener("touchmove", onTouchMove, nonPassive)
    workspace.addEventListener("touchend", onTouchEnd, nonPassive)
    workspace.addEventListener("touchcancel", onTouchEnd, nonPassive)

    return () => {
      if (frameRequest !== null) window.cancelAnimationFrame(frameRequest)
      workspace.removeEventListener("wheel", onWheel)
      workspace.removeEventListener("gesturestart", onGestureStart)
      workspace.removeEventListener("gesturechange", onGestureChange)
      workspace.removeEventListener("gestureend", onGestureEnd)
      workspace.removeEventListener("touchstart", onTouchStart)
      workspace.removeEventListener("touchmove", onTouchMove)
      workspace.removeEventListener("touchend", onTouchEnd)
      workspace.removeEventListener("touchcancel", onTouchEnd)
    }
  }, [applyCamera, cameraRef, onManualNavigation, workspaceRef])
}
