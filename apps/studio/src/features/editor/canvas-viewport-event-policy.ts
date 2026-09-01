const canvasInteractionIslandSelector = [
  ".upper-canvas",
  "[data-editor-overlay-control='true']",
  "button",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='button']",
  "[role='toolbar']",
  "[role='menu']",
  "[role='dialog']",
  "[role='separator']",
].join(",")

export function isCanvasInteractionIsland(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(canvasInteractionIslandSelector) !== null
  )
}

export function shouldZoomFromViewportDoubleClick(target: EventTarget | null) {
  return target instanceof Element && !isCanvasInteractionIsland(target)
}
