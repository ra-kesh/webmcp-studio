import type { Document } from "@webmcp/document"

export type ImageReplacementBindingImpact = {
  bindingId: string
  fieldId: string
  fieldLabel: string
  nodeId: string
  nodeName: string
  affectedNodeIds: string[]
  message: string
}

export function imageReplacementBindingImpact(
  document: Document,
  nodeId: string
): ImageReplacementBindingImpact | null {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.type !== "image") return null

  const binding = document.bindings.find(
    (candidate) => candidate.nodeId === nodeId && candidate.property === "src"
  )
  if (!binding) return null

  const field = document.fields.find(
    (candidate) => candidate.id === binding.fieldId
  )
  const fieldLabel = field?.label ?? binding.fieldId
  const affectedNodeIds = document.bindings
    .filter(
      (candidate) =>
        candidate.fieldId === binding.fieldId && candidate.property === "src"
    )
    .map((candidate) => candidate.nodeId)
  const linkedLayerCopy = `${affectedNodeIds.length} linked layer${affectedNodeIds.length === 1 ? "" : "s"}`

  return {
    bindingId: binding.id,
    fieldId: binding.fieldId,
    fieldLabel,
    nodeId,
    nodeName: node.name,
    affectedNodeIds,
    message: `“${node.name}” gets its image from the “${fieldLabel}” shared asset field (${linkedLayerCopy}). Change the field value in Fields to update every linked layer, or unbind Source to replace only this layer.`,
  }
}

export function imageReplacementConstraintsByNodeId(
  document: Document,
  nodeIds: readonly string[]
) {
  return Object.fromEntries(
    nodeIds.flatMap((nodeId) => {
      const impact = imageReplacementBindingImpact(document, nodeId)
      return impact ? [[nodeId, { reason: impact.message }] as const] : []
    })
  )
}
