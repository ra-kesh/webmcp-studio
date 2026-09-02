import { sceneNodeImageReferences } from "@webmcp/document"
import type { DocumentCommand, FillPaint } from "@webmcp/document"
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
  const addFillSources = (fills: readonly FillPaint[] | undefined) => {
    for (const paint of fills ?? []) {
      if (paint.type === "image") addSource(paint.src)
    }
  }
  const addNodeSources = (
    node: Extract<DocumentCommand, { type: "add_node" }>["node"]
  ) => {
    for (const reference of sceneNodeImageReferences(node)) {
      addSource(reference.src)
    }
  }
  for (const command of commands) {
    if (command.type === "set_field") {
      addSource(command.value)
    } else if (command.type === "update_node") {
      addSource("src" in command.patch ? command.patch.src : undefined)
      addFillSources("fills" in command.patch ? command.patch.fills : undefined)
    } else if (command.type === "replace_image_source") {
      addSource(command.src)
    } else if (command.type === "add_node") {
      addNodeSources(command.node)
    } else if (command.type === "add_output_variant") {
      for (const node of command.nodes) {
        addNodeSources(node)
      }
    }
  }
  return [...assetIds]
}
