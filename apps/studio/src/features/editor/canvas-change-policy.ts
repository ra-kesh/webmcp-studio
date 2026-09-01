import type { SceneNode } from "@webmcp/document"
import type { CanvasNodeChange } from "@webmcp/editor"
import type { HistoryCommitOptions } from "@webmcp/editor/history"

const geometryProperties = new Set(["x", "y", "width", "height", "rotation"])
const directTextEditProperties = new Set([
  "text",
  "runs",
  "paragraphs",
  "links",
])

export function canvasChangeHistoryOptions(
  changes: CanvasNodeChange[],
  currentNodes: readonly SceneNode[] = []
): HistoryCommitOptions | undefined {
  if (!changes.length) return undefined
  if (changes.length === 1) {
    const patch = changes[0].patch
    const isDirectTextEdit =
      "text" in patch &&
      typeof patch.text === "string" &&
      Object.keys(patch).every((property) =>
        directTextEditProperties.has(property)
      )
    if (isDirectTextEdit) return { label: "Edit text" }
  }

  const nodeById = new Map(currentNodes.map((node) => [node.id, node]))
  const changedGeometry = new Set<string>()
  for (const change of changes) {
    const current = nodeById.get(change.nodeId)
    const properties = Object.keys(change.patch)
    if (!current || properties.some((key) => !geometryProperties.has(key))) {
      return undefined
    }
    for (const property of properties) {
      const key = property as "x" | "y" | "width" | "height" | "rotation"
      if (
        change.patch[key] !== undefined &&
        change.patch[key] !== current[key]
      ) {
        changedGeometry.add(key)
      }
    }
  }

  if (!changedGeometry.size) return undefined
  const resized = changedGeometry.has("width") || changedGeometry.has("height")
  const rotated = changedGeometry.has("rotation")
  const moved = changedGeometry.has("x") || changedGeometry.has("y")

  if (moved && !resized && !rotated) return { label: "Move selection" }
  if (resized && !rotated) return { label: "Resize selection" }
  if (rotated && !resized) return { label: "Rotate selection" }

  return { label: "Transform selection" }
}
