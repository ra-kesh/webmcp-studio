import type { DocumentCommand } from "@webmcp/document"
import { managedMediaIdFromSource } from "./managed-media-repository"

export const managedAssetIdsInCommands = (
  commands: readonly DocumentCommand[]
) => {
  const assetIds = new Set<string>()
  const addSource = (value: unknown) => {
    if (typeof value !== "string") return
    const assetId = managedMediaIdFromSource(value)
    if (assetId) assetIds.add(assetId)
  }
  for (const command of commands) {
    if (command.type === "set_field") {
      addSource(command.value)
    } else if (command.type === "update_node") {
      addSource("src" in command.patch ? command.patch.src : undefined)
    } else if (command.type === "replace_image_source") {
      addSource(command.src)
    } else if (command.type === "add_node" && command.node.type === "image") {
      addSource(command.node.src)
    } else if (command.type === "add_output_variant") {
      for (const node of command.nodes) {
        if (node.type === "image") addSource(node.src)
      }
    }
  }
  return [...assetIds]
}
