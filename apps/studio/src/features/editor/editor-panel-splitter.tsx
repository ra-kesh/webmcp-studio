import { useCallback, useEffect, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"
import { cn } from "@webmcp/ui/lib/utils"

export type EditorPanelResizeDirection = "left" | "right"

export interface EditorPanelSplitterProps {
  label: string
  value: number
  minValue: number
  maxValue: number
  resizeDirection: EditorPanelResizeDirection
  onResize: (value: number) => void
  onResizeEnd: (value: number) => void
  onToggleCollapse?: () => void
  controlsId?: string
  disabled?: boolean
  className?: string
}

interface ActivePointerDrag {
  pointerId: number
  startClientX: number
  startValue: number
}

const KEYBOARD_RESIZE_STEP = 8
const KEYBOARD_RESIZE_LARGE_STEP = 32

function clampSplitterValue(value: number, minValue: number, maxValue: number) {
  return Math.min(Math.max(value, minValue), maxValue)
}

export function EditorPanelSplitter({
  label,
  value,
  minValue,
  maxValue,
  resizeDirection,
  onResize,
  onResizeEnd,
  onToggleCollapse,
  controlsId,
  disabled = false,
  className,
}: EditorPanelSplitterProps) {
  const handleRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<ActivePointerDrag | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingValueRef = useRef<number | null>(null)
  const lastResizeValueRef = useRef<number | null>(null)
  const onResizeRef = useRef(onResize)
  const onResizeEndRef = useRef(onResizeEnd)
  const [resizing, setResizing] = useState(false)

  onResizeRef.current = onResize
  onResizeEndRef.current = onResizeEnd

  const min = Math.min(minValue, maxValue)
  const max = Math.max(minValue, maxValue)
  const currentValue = clampSplitterValue(value, min, max)
  const direction = resizeDirection === "right" ? 1 : -1

  const cancelScheduledResize = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const emitResize = useCallback((nextValue: number) => {
    if (lastResizeValueRef.current === nextValue) return
    lastResizeValueRef.current = nextValue
    onResizeRef.current(nextValue)
  }, [])

  const scheduleResize = useCallback(
    (nextValue: number) => {
      pendingValueRef.current = nextValue
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        const pendingValue = pendingValueRef.current
        pendingValueRef.current = null
        if (pendingValue !== null) emitResize(pendingValue)
      })
    },
    [emitResize]
  )

  const settleResize = useCallback(
    (nextValue: number) => {
      cancelScheduledResize()
      pendingValueRef.current = null
      emitResize(nextValue)
      onResizeEndRef.current(nextValue)
    },
    [cancelScheduledResize, emitResize]
  )

  const valueFromPointer = useCallback(
    (clientX: number) => {
      const drag = dragRef.current
      if (!drag) return currentValue
      const delta = (clientX - drag.startClientX) * direction
      return clampSplitterValue(drag.startValue + delta, min, max)
    },
    [currentValue, direction, max, min]
  )

  const finishPointerDrag = useCallback(
    (pointerId: number, nextValue: number) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== pointerId) return
      dragRef.current = null
      setResizing(false)
      settleResize(nextValue)
    },
    [settleResize]
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0 || dragRef.current) return
      event.preventDefault()
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startValue: currentValue,
      }
      pendingValueRef.current = null
      lastResizeValueRef.current = currentValue
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus()
      setResizing(true)
    },
    [currentValue, disabled]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      scheduleResize(valueFromPointer(event.clientX))
    },
    [scheduleResize, valueFromPointer]
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      const nextValue = valueFromPointer(event.clientX)
      finishPointerDrag(event.pointerId, nextValue)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    [finishPointerDrag, valueFromPointer]
  )

  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      const nextValue =
        pendingValueRef.current ?? lastResizeValueRef.current ?? currentValue
      finishPointerDrag(event.pointerId, nextValue)
    },
    [currentValue, finishPointerDrag]
  )

  const handleLostPointerCapture = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      const nextValue =
        pendingValueRef.current ?? lastResizeValueRef.current ?? currentValue
      finishPointerDrag(event.pointerId, nextValue)
    },
    [currentValue, finishPointerDrag]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === "Enter" && onToggleCollapse) {
        event.preventDefault()
        onToggleCollapse()
        return
      }

      const step = event.shiftKey
        ? KEYBOARD_RESIZE_LARGE_STEP
        : KEYBOARD_RESIZE_STEP
      let nextValue: number | null = null
      if (event.key === "ArrowLeft") {
        nextValue = currentValue - step * direction
      } else if (event.key === "ArrowRight") {
        nextValue = currentValue + step * direction
      } else if (event.key === "Home") {
        nextValue = min
      } else if (event.key === "End") {
        nextValue = max
      }
      if (nextValue === null) return

      event.preventDefault()
      const clampedValue = clampSplitterValue(nextValue, min, max)
      if (clampedValue === currentValue) return
      lastResizeValueRef.current = currentValue
      emitResize(clampedValue)
      onResizeEndRef.current(clampedValue)
    },
    [currentValue, direction, disabled, emitResize, max, min, onToggleCollapse]
  )

  useEffect(
    () => () => {
      cancelScheduledResize()
      dragRef.current = null
    },
    [cancelScheduledResize]
  )

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(currentValue)}
      aria-controls={controlsId}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-resizing={resizing || undefined}
      className={cn(
        "group relative z-20 w-3 shrink-0 cursor-col-resize touch-none self-stretch outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "aria-disabled:cursor-default",
        className
      )}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors",
          "group-hover:bg-foreground/25 group-focus-visible:bg-ring group-data-[resizing=true]:bg-ring"
        )}
      />
    </div>
  )
}
