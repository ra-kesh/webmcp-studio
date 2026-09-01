import type { SceneNode } from "@webmcp/document"
import { normalizeRotation } from "@webmcp/editor"

export type PositionTransformAction =
  "flip-horizontal" | "flip-vertical" | "rotate-90"

export function positionTransformPatch(
  node: SceneNode,
  action: PositionTransformAction
): Partial<SceneNode> {
  switch (action) {
    case "flip-horizontal":
      return { flipX: !(node.flipX ?? false) }
    case "flip-vertical":
      return { flipY: !(node.flipY ?? false) }
    case "rotate-90":
      return { rotation: normalizeRotation(node.rotation + 90) }
  }
}

export function positionTransformLabel(action: PositionTransformAction) {
  switch (action) {
    case "flip-horizontal":
      return "Flip selection horizontally"
    case "flip-vertical":
      return "Flip selection vertically"
    case "rotate-90":
      return "Rotate selection 90°"
  }
}
