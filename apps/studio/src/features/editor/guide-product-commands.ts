import type { EditorWorkspacePreferences } from "@webmcp/editor/page-guides"
import type {
  ProductCommandId,
  ProductCommandStateInput,
} from "@webmcp/editor/product-commands"

export type GuideProductCommandId =
  "canvas.rulers.toggle" | "canvas.guides.toggle" | "canvas.guides.manage"

export const isGuideProductCommandId = (
  commandId: ProductCommandId
): commandId is GuideProductCommandId =>
  commandId === "canvas.rulers.toggle" ||
  commandId === "canvas.guides.toggle" ||
  commandId === "canvas.guides.manage"

export function projectGuideProductCommandState(
  preferences: EditorWorkspacePreferences
): Readonly<Record<GuideProductCommandId, ProductCommandStateInput>> {
  return {
    "canvas.rulers.toggle": { checked: preferences.rulersVisible },
    "canvas.guides.toggle": { checked: preferences.guidesVisible },
    "canvas.guides.manage": {},
  }
}

export function executeGuideProductCommand(
  commandId: GuideProductCommandId,
  actions: Readonly<{
    preferences: EditorWorkspacePreferences
    setPreferences: (preferences: EditorWorkspacePreferences) => void
    openManager: () => void
  }>
): true {
  switch (commandId) {
    case "canvas.rulers.toggle":
      actions.setPreferences({
        ...actions.preferences,
        rulersVisible: !actions.preferences.rulersVisible,
      })
      return true
    case "canvas.guides.toggle":
      actions.setPreferences({
        ...actions.preferences,
        guidesVisible: !actions.preferences.guidesVisible,
      })
      return true
    case "canvas.guides.manage":
      actions.openManager()
      return true
  }
}
