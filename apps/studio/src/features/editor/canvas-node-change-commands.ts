import type { Document } from "@webmcp/document"
import type { CanvasNodeChange, CommandDraft } from "@webmcp/editor"

export function canvasNodeChangeCommands(
  document: Document,
  changes: readonly CanvasNodeChange[]
): CommandDraft[] {
  const commands: CommandDraft[] = []

  for (const { nodeId, patch } of changes) {
    const text =
      "text" in patch && typeof patch.text === "string"
        ? patch.text
        : undefined
    const textBinding =
      text !== undefined
        ? document.bindings.find(
            (binding) =>
              binding.nodeId === nodeId && binding.property === "text"
          )
        : undefined
    const nodePatch = { ...patch } as CanvasNodeChange["patch"] & {
      text?: string
    }

    if (textBinding && text !== undefined) {
      commands.push({
        type: "set_field",
        fieldId: textBinding.fieldId,
        value: text,
      })
      delete nodePatch.text
    }

    if (Object.keys(nodePatch).length) {
      commands.push({ type: "update_node", nodeId, patch: nodePatch })
    }
  }

  return commands
}
