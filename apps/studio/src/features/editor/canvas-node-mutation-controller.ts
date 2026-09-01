import type { Document, SceneNode } from "@webmcp/document"
import type { CanvasNodeChange, CommandDraft } from "@webmcp/editor"
import type { HistoryCommitOptions } from "@webmcp/editor/history"
import { canvasChangeHistoryOptions } from "./canvas-change-policy"
import { canvasNodeChangeCommands } from "./canvas-node-change-commands"
import { projectComponentInstanceCanvasTransform } from "./component-canvas-interaction"

type CanvasNodeMutationCommit = (
  drafts: CommandDraft[],
  options?: HistoryCommitOptions
) => boolean

export class CanvasNodeMutationController {
  constructor(
    private readonly getDocument: () => Document,
    private readonly commit: CanvasNodeMutationCommit
  ) {}

  updateNodes(changes: CanvasNodeChange[]) {
    const document = this.getDocument()
    const options = canvasChangeHistoryOptions(changes, document.nodes)
    const instanceTransform = projectComponentInstanceCanvasTransform(
      document,
      changes
    )
    if (instanceTransform) {
      return this.commit(
        [
          {
            type: "update_component_instance_metadata",
            instanceId: instanceTransform.instanceId,
            patch: { transform: instanceTransform.transform },
          },
        ],
        options
      )
    }
    return this.commit(canvasNodeChangeCommands(document, changes), options)
  }

  updateNode(nodeId: string, patch: Partial<SceneNode>) {
    return this.updateNodes([{ nodeId, patch }])
  }
}
