export type EditorEscapeResult =
  | "guide_drag_cancelled"
  | "guide_selection_cleared"
  | "crop_cancelled"
  | "text_cancelled"
  | "transform_cancelled"
  | "selection_cleared"

/**
 * Resolves Escape from the most specific transient interaction outward. Each
 * successful cancellation owns the key, so a live edit never also clears the
 * user's selection.
 */
export function handleEditorEscape(actions: {
  cancelGuideDrag?: () => boolean
  clearGuideSelection?: () => boolean
  cancelCrop: () => boolean
  cancelText: () => boolean
  cancelTransform: () => boolean
  clearSelection: () => void
}): EditorEscapeResult {
  if (actions.cancelGuideDrag?.()) return "guide_drag_cancelled"
  if (actions.clearGuideSelection?.()) return "guide_selection_cleared"
  if (actions.cancelCrop()) return "crop_cancelled"
  if (actions.cancelText()) return "text_cancelled"
  if (actions.cancelTransform()) return "transform_cancelled"
  actions.clearSelection()
  return "selection_cleared"
}
