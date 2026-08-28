"use client"

import {
  Check,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Scan,
  Undo2,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { ComponentProps, KeyboardEvent, ReactNode } from "react"

import {
  defaultImagePlacement,
  IMAGE_PLACEMENT_MAX_ZOOM,
} from "@webmcp/document"
import type { ImagePlacement } from "@webmcp/document"
import type { EditorImageCommandId } from "@webmcp/editor/commands"
import type { ImageCropPreviewStore } from "@webmcp/editor/image-crop-preview-store"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { Input } from "@webmcp/ui/components/input"
import { Separator } from "@webmcp/ui/components/separator"
import { Slider } from "@webmcp/ui/components/slider"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@webmcp/ui/components/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { cn } from "@webmcp/ui/lib/utils"
import { focusImageCropToolbarEntry } from "./image-crop-focus"

const IMAGE_CROP_ZOOM_MIN = 0.05
const IMAGE_CROP_ZOOM_SLIDER_MAX = 100

const INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='switch']",
  "[role='textbox']",
  "[data-crop-keyboard-ignore]",
].join(",")

type KeyboardTargetLike = {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

export type ImageCropToolbarKeyAction = "cancel" | "done"

export type ImageCropToolbarKeyboardInput = {
  key: string
  target: EventTarget | null
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export function isImageCropToolbarInteractiveTarget(
  target: EventTarget | null
) {
  if (!target) return false

  const candidate = target as KeyboardTargetLike
  const tagName = candidate.tagName?.toLowerCase()
  if (
    tagName === "a" ||
    tagName === "button" ||
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea"
  ) {
    return true
  }
  if (candidate.isContentEditable) return true

  try {
    return Boolean(candidate.closest?.(INTERACTIVE_TARGET_SELECTOR))
  } catch {
    return false
  }
}

export function resolveImageCropToolbarKeyAction(
  event: ImageCropToolbarKeyboardInput
): ImageCropToolbarKeyAction | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isImageCropToolbarInteractiveTarget(event.target)
  ) {
    return null
  }

  if (event.key === "Escape") return "cancel"
  if (event.key === "Enter") return "done"
  return null
}

export type ImageCropToolbarExitGate = {
  request: (action: ImageCropToolbarKeyAction) => boolean
  reset: () => void
}

export function createImageCropToolbarExitGate(callbacks: {
  onCancel: () => void
  onDone: () => void
}): ImageCropToolbarExitGate {
  let claimed = false

  return {
    request(action) {
      if (claimed) return false
      claimed = true
      if (action === "cancel") callbacks.onCancel()
      else callbacks.onDone()
      return true
    },
    reset() {
      claimed = false
    },
  }
}

export function normalizeImageCropRotation(rotation: number) {
  const normalized = ((((rotation + 180) % 360) + 360) % 360) - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

export function imageCropZoomToSliderValue(zoom: number) {
  const clamped = Math.min(
    IMAGE_PLACEMENT_MAX_ZOOM,
    Math.max(IMAGE_CROP_ZOOM_MIN, zoom)
  )
  const range = Math.log(IMAGE_PLACEMENT_MAX_ZOOM / IMAGE_CROP_ZOOM_MIN)
  return (Math.log(clamped / IMAGE_CROP_ZOOM_MIN) / range) * 100
}

export function imageCropSliderValueToZoom(value: number) {
  const clamped = Math.min(IMAGE_CROP_ZOOM_SLIDER_MAX, Math.max(0, value))
  const range = Math.log(IMAGE_PLACEMENT_MAX_ZOOM / IMAGE_CROP_ZOOM_MIN)
  return IMAGE_CROP_ZOOM_MIN * Math.exp((clamped / 100) * range)
}

export function imageCropZoomPreview(
  sliderValue: number,
  currentMode: ImagePlacement["mode"] = "manual"
): Partial<ImagePlacement> {
  return {
    // Fit has a different projection base. Keeping that base until the image
    // is dragged avoids the first slider movement jumping to cover scale.
    mode: currentMode === "fit" ? "fit" : "manual",
    zoom: imageCropSliderValueToZoom(sliderValue),
  }
}

export function isDefaultImageCropPlacement(
  placement: Readonly<ImagePlacement>
) {
  const initial = defaultImagePlacement()
  return (
    placement.mode === initial.mode &&
    placement.focalX === initial.focalX &&
    placement.focalY === initial.focalY &&
    placement.zoom === initial.zoom &&
    placement.rotation === initial.rotation &&
    placement.flipX === initial.flipX &&
    placement.flipY === initial.flipY
  )
}

export type ImageCropToolbarProps = {
  previewStore: ImageCropPreviewStore
  imageName: string
  onPreview: (patch: Partial<ImagePlacement>) => void
  onRunCommand: (commandId: EditorImageCommandId) => void
  isCommandEnabled: (commandId: EditorImageCommandId) => boolean
  onCancel: () => void
  onDone: () => void
  focusOnMount?: boolean
  className?: string
}

type IconButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  label: string
  children: ReactNode
}

function IconButton({ label, children, className, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn("size-11 rounded-lg min-[1280px]:size-8", className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function validateImageCropNumber(
  value: string,
  options: { label: string; min: number; max: number }
) {
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    return {
      ok: false as const,
      message: `${options.label} must be between ${options.min} and ${options.max}.`,
    }
  }
  return { ok: true as const, value: parsed }
}

function CropNumberField({
  label,
  value,
  min,
  max,
  suffix,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onCommit: (value: number) => void
}) {
  const id = useId()
  const canonical = String(value)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelBlurRef = useRef(false)
  const displayedValue = draft ?? canonical

  const commit = () => {
    const result = validateImageCropNumber(displayedValue, { label, min, max })
    if (!result.ok) {
      setError(result.message)
      return false
    }
    setError(null)
    setDraft(null)
    if (result.value !== value) onCommit(result.value)
    return true
  }

  return (
    <div className="relative shrink-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative w-[4.5rem]">
        <Input
          id={id}
          aria-label={label}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          inputMode="decimal"
          value={displayedValue}
          className="h-11 pr-6 text-right font-mono text-xs tabular-nums min-[1280px]:h-8"
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) setError(null)
          }}
          onBlur={() => {
            if (cancelBlurRef.current) {
              cancelBlurRef.current = false
              return
            }
            commit()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              if (commit()) {
                cancelBlurRef.current = true
                event.currentTarget.blur()
              }
              return
            }
            if (event.key === "Escape") {
              event.stopPropagation()
              cancelBlurRef.current = true
              setDraft(null)
              setError(null)
              event.currentTarget.blur()
            }
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-xs text-muted-foreground"
        >
          {suffix}
        </span>
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="absolute right-0 bottom-[calc(100%+0.5rem)] z-50 w-max max-w-60 rounded-md border border-destructive/30 bg-background px-2 py-1 text-[11px] text-destructive shadow-md"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function ImageCropToolbar({
  previewStore,
  imageName,
  onPreview,
  onRunCommand,
  isCommandEnabled,
  onCancel,
  onDone,
  focusOnMount = false,
  className,
}: ImageCropToolbarProps) {
  const session = useSyncExternalStore(
    previewStore.subscribe,
    previewStore.getSnapshot,
    previewStore.getSnapshot
  )
  const announcementId = useId()
  const doneButtonRef = useRef<HTMLButtonElement>(null)
  const callbacksRef = useRef({ onCancel, onDone })
  callbacksRef.current = { onCancel, onDone }

  const exitGateRef = useRef(
    createImageCropToolbarExitGate({
      onCancel: () => callbacksRef.current.onCancel(),
      onDone: () => callbacksRef.current.onDone(),
    })
  )

  useEffect(() => {
    exitGateRef.current.reset()
  }, [session.target, session.baseline])

  useEffect(() => {
    if (!focusOnMount) return
    const frame = window.requestAnimationFrame(() => {
      focusImageCropToolbarEntry(true, doneButtonRef.current)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusOnMount, session.target.nodeId])

  const requestExit = useCallback((action: ImageCropToolbarKeyAction) => {
    exitGateRef.current.request(action)
  }, [])

  const placement = session.draft
  const zoomPercent = Math.round(placement.zoom * 10_000) / 100
  const flipValues = [
    ...(placement.flipX ? ["horizontal"] : []),
    ...(placement.flipY ? ["vertical"] : []),
  ]

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const action = resolveImageCropToolbarKeyAction({
      key: event.key,
      target: event.target,
      repeat: event.repeat,
      isComposing: event.nativeEvent.isComposing,
      defaultPrevented: event.defaultPrevented,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (!action) return

    event.preventDefault()
    event.stopPropagation()
    requestExit(action)
  }

  return (
    <TooltipProvider>
      <section
        role="toolbar"
        aria-label={`Crop image: ${imageName}`}
        aria-describedby={announcementId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "fixed bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] left-1/2 z-40 grid w-[calc(100vw-1rem)] max-w-5xl -translate-x-1/2 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur-sm min-[1280px]:bottom-4 min-[1280px]:w-auto min-[1280px]:max-w-[calc(100vw-2rem)] min-[1280px]:grid-cols-[auto_minmax(0,1fr)_auto]",
          className
        )}
      >
        <div className="col-start-1 row-start-1 flex min-h-11 min-w-0 items-center gap-2 px-3 min-[1280px]:min-h-0 min-[1280px]:border-r">
          <Crop aria-hidden="true" className="size-4 shrink-0" />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-medium">Crop image</p>
            <p className="truncate text-xs text-muted-foreground">
              {imageName}
            </p>
          </div>
          <Badge variant="secondary" className="ml-1 capitalize">
            {placement.mode}
          </Badge>
          <p
            id={announcementId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            Crop image. Drag to reposition. Press Enter to apply or Escape to
            cancel.
          </p>
        </div>

        <div className="col-span-2 col-start-1 row-start-2 flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto overscroll-x-contain border-t p-1.5 min-[1280px]:col-span-1 min-[1280px]:col-start-2 min-[1280px]:row-start-1 min-[1280px]:border-t-0 [&::-webkit-scrollbar]:hidden">
          <div role="group" aria-label="Image fitting" className="shrink-0">
            <ToggleGroup
              type="single"
              value={placement.mode === "manual" ? "" : placement.mode}
              variant="outline"
              spacing={0}
              aria-label="Image fitting"
              onValueChange={(mode) => {
                if (mode === "fit") onRunCommand("image.fit")
                if (mode === "fill") onRunCommand("image.fill")
              }}
            >
              <ToggleGroupItem
                value="fit"
                aria-label="Fit image"
                className="h-11 px-3 text-sm min-[1280px]:h-8"
                disabled={!isCommandEnabled("image.fit")}
              >
                Fit
              </ToggleGroupItem>
              <ToggleGroupItem
                value="fill"
                aria-label="Fill frame"
                className="h-11 px-3 text-sm min-[1280px]:h-8"
                disabled={!isCommandEnabled("image.fill")}
              >
                Fill
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <div
            role="group"
            aria-label="Image zoom"
            className="flex shrink-0 items-center gap-2 px-1"
          >
            <Slider
              aria-label="Image zoom"
              aria-valuetext={`${zoomPercent}%`}
              value={[imageCropZoomToSliderValue(placement.zoom)]}
              min={0}
              max={IMAGE_CROP_ZOOM_SLIDER_MAX}
              step={0.25}
              className="w-28 min-[1280px]:w-24 [&_[data-slot=slider-thumb]]:after:-inset-4"
              onValueChange={([value]) => {
                onPreview(imageCropZoomPreview(value, placement.mode))
              }}
            />
            <CropNumberField
              label="Image zoom percentage"
              value={zoomPercent}
              min={IMAGE_CROP_ZOOM_MIN * 100}
              max={IMAGE_PLACEMENT_MAX_ZOOM * 100}
              suffix="%"
              onCommit={(value) =>
                onPreview(
                  imageCropZoomPreview(
                    imageCropZoomToSliderValue(value / 100),
                    placement.mode
                  )
                )
              }
            />
          </div>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <div
            role="group"
            aria-label="Image rotation"
            className="flex shrink-0 items-center"
          >
            <IconButton
              label="Rotate image left"
              disabled={!isCommandEnabled("image.rotate-left")}
              onClick={() => onRunCommand("image.rotate-left")}
            >
              <RotateCcw aria-hidden="true" />
            </IconButton>
            <CropNumberField
              label="Image rotation degrees"
              value={placement.rotation}
              min={-180}
              max={180}
              suffix="°"
              onCommit={(rotation) =>
                onPreview({ rotation: normalizeImageCropRotation(rotation) })
              }
            />
            <IconButton
              label="Rotate image right"
              disabled={!isCommandEnabled("image.rotate-right")}
              onClick={() => onRunCommand("image.rotate-right")}
            >
              <RotateCw aria-hidden="true" />
            </IconButton>
          </div>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <ToggleGroup
            type="multiple"
            value={flipValues}
            variant="outline"
            spacing={0}
            aria-label="Flip image"
            className="shrink-0"
            onValueChange={(values) => {
              if (values.includes("horizontal") !== placement.flipX) {
                onRunCommand("image.flip-horizontal")
              }
              if (values.includes("vertical") !== placement.flipY) {
                onRunCommand("image.flip-vertical")
              }
            }}
          >
            <ToggleGroupItem
              value="horizontal"
              aria-label="Flip image horizontally"
              className="size-11 p-0 min-[1280px]:size-8"
              disabled={!isCommandEnabled("image.flip-horizontal")}
            >
              <FlipHorizontal2 aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="vertical"
              aria-label="Flip image vertically"
              className="size-11 p-0 min-[1280px]:size-8"
              disabled={!isCommandEnabled("image.flip-vertical")}
            >
              <FlipVertical2 aria-hidden="true" />
            </ToggleGroupItem>
          </ToggleGroup>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <IconButton
            label="Resize frame to image"
            disabled={!isCommandEnabled("image.resize-frame-to-image")}
            onClick={() => onRunCommand("image.resize-frame-to-image")}
          >
            <Scan aria-hidden="true" />
          </IconButton>

          <IconButton
            label="Reset image crop"
            disabled={!isCommandEnabled("image.reset-placement")}
            onClick={() => onRunCommand("image.reset-placement")}
          >
            <Undo2 aria-hidden="true" />
          </IconButton>
        </div>

        <div className="col-start-2 row-start-1 flex items-center gap-1 border-l p-1.5 min-[1280px]:col-start-3">
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-3 min-[1280px]:h-8"
            onClick={() => requestExit("cancel")}
          >
            <X data-icon="inline-start" aria-hidden="true" />
            Cancel
          </Button>
          <Button
            ref={doneButtonRef}
            type="button"
            data-crop-primary-action="true"
            className="h-11 px-3 min-[1280px]:h-8"
            onClick={() => requestExit("done")}
          >
            <Check data-icon="inline-start" aria-hidden="true" />
            Done
          </Button>
        </div>
      </section>
    </TooltipProvider>
  )
}
