export type ImageCropEntrySource = "canvas" | "control"

export type ImageCropFocusTarget = {
  readonly isConnected?: boolean
  focus: (options?: FocusOptions) => void
}

export type ImageCropFocusSession = Readonly<{
  focusToolbarOnMount: boolean
  opener: ImageCropFocusTarget | null
}>

type ElementLike = {
  closest?: (selector: string) => unknown
  focus?: (options?: FocusOptions) => void
  isConnected?: boolean
}

const CANVAS_FOCUS_SELECTOR =
  ".upper-canvas, [role='application'][aria-label='Interactive design canvas']"

function isFocusTarget(value: unknown): value is ImageCropFocusTarget {
  return Boolean(value && typeof (value as ElementLike).focus === "function")
}

export function isImageCropCanvasFocus(value: unknown) {
  if (!value) return false
  try {
    return Boolean((value as ElementLike).closest?.(CANVAS_FOCUS_SELECTOR))
  } catch {
    return false
  }
}

export function captureImageCropFocusSession(
  source: ImageCropEntrySource,
  activeElement: unknown
): ImageCropFocusSession {
  return Object.freeze({
    focusToolbarOnMount: source === "control",
    opener:
      source === "control" && isFocusTarget(activeElement)
        ? activeElement
        : null,
  })
}

export function focusImageCropToolbarEntry(
  shouldFocus: boolean,
  target: ImageCropFocusTarget | null
) {
  if (!shouldFocus || !target || target.isConnected === false) return false
  target.focus({ preventScroll: true })
  return true
}

export function restoreImageCropFocus(
  session: ImageCropFocusSession | null,
  fallback: ImageCropFocusTarget | null
): "opener" | "fallback" | null {
  if (session?.opener && session.opener.isConnected !== false) {
    session.opener.focus({ preventScroll: true })
    return "opener"
  }
  if (fallback && fallback.isConnected !== false) {
    fallback.focus({ preventScroll: true })
    return "fallback"
  }
  return null
}
