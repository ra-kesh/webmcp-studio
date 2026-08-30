import type {
  TextRunStylePatch,
  TextSelectionSharedValue,
} from "@webmcp/document"
import type { CanvasTextEditingState } from "@webmcp/editor"

export const textColorChoices = [
  "#111827",
  "#ffffff",
  "#2563eb",
  "#dc2626",
] as const

export const sharedTextSelectionValue = <Value>(
  state: TextSelectionSharedValue<Value>
) => (state.kind === "value" ? state.value : null)

export const textFormattingTogglePatch = (
  state: CanvasTextEditingState,
  control: "bold" | "italic" | "underline" | "strikethrough"
): TextRunStylePatch => {
  if (control === "bold") {
    const weight = sharedTextSelectionValue(state.style.fontWeight)
    return { fontWeight: weight !== null && weight >= 700 ? 400 : 700 }
  }
  if (control === "italic") {
    return { italic: sharedTextSelectionValue(state.style.italic) !== true }
  }
  const current = sharedTextSelectionValue(state.style.decoration)
  const decoration = control === "underline" ? "underline" : "line_through"
  return { decoration: current === decoration ? "none" : decoration }
}
