import {
  componentSourceSubtree,
  type ComponentTransform,
  type Document,
  type SceneNode,
} from "@webmcp/document"
import type { CanvasNodeChange, Selection } from "@webmcp/editor"

const EPSILON = 0.02

function normalizedRotation(value: number) {
  const rotation = ((value % 360) + 360) % 360
  return rotation > 180 ? rotation - 360 : rotation
}

function rotatePoint(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

function componentRootNodeIds(document: Document, nodeId: string) {
  for (const instance of document.componentInstances) {
    if (
      instance.nodeMappings.some((mapping) => mapping.instanceNodeId === nodeId)
    ) {
      return instance.nodeMappings.map((mapping) => mapping.instanceNodeId)
    }
  }
  for (const component of document.components) {
    const source = componentSourceSubtree(document, component.sourceGroupId)
    if (source?.nodeIds.includes(nodeId)) return source.nodeIds
  }
  return null
}

/** Canvas clicks select the reusable root; explicit double-click handles drill-in. */
export function projectCanvasComponentSelection(
  document: Document,
  incoming: Selection | null
): Selection | null {
  if (!incoming || incoming.nodeIds.length !== 1) return incoming
  const rootNodeIds = componentRootNodeIds(document, incoming.nodeIds[0]!)
  if (!rootNodeIds) return incoming
  return { pageId: incoming.pageId, nodeIds: rootNodeIds }
}

function mergedGeometry(node: SceneNode, change: CanvasNodeChange) {
  return {
    x: change.patch.x ?? node.x,
    y: change.patch.y ?? node.y,
    width: change.patch.width ?? node.width,
    height: change.patch.height ?? node.height,
    rotation: change.patch.rotation ?? node.rotation,
  }
}

function close(left: number, right: number) {
  return Math.abs(left - right) <= EPSILON
}

export function projectComponentInstanceCanvasTransform(
  document: Document,
  changes: readonly CanvasNodeChange[]
): { instanceId: string; transform: ComponentTransform } | null {
  if (!changes.length) return null
  const geometryProperties = ["x", "y", "width", "height", "rotation"]
  if (
    !changes.some((change) =>
      geometryProperties.some((property) =>
        Object.prototype.hasOwnProperty.call(change.patch, property)
      )
    )
  ) {
    return null
  }
  const changedIds = new Set(changes.map((change) => change.nodeId))
  const instance = document.componentInstances.find(
    (candidate) =>
      candidate.nodeMappings.length === changedIds.size &&
      candidate.nodeMappings.every((mapping) =>
        changedIds.has(mapping.instanceNodeId)
      )
  )
  if (!instance) return null
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const changeById = new Map(changes.map((change) => [change.nodeId, change]))
  const firstMapping = instance.nodeMappings[0]
  const firstNode = firstMapping
    ? nodeById.get(firstMapping.instanceNodeId)
    : undefined
  const firstChange = firstMapping
    ? changeById.get(firstMapping.instanceNodeId)
    : undefined
  if (!firstNode || !firstChange) return null
  const firstNext = mergedGeometry(firstNode, firstChange)
  const scaleRatio = firstNext.width / firstNode.width
  if (!Number.isFinite(scaleRatio) || scaleRatio <= 0) return null
  const rotationDelta = normalizedRotation(
    firstNext.rotation - firstNode.rotation
  )
  const nextScale = instance.transform.scale * scaleRatio
  const nextRotation = normalizedRotation(
    instance.transform.rotation + rotationDelta
  )
  const oldCenter = {
    x: firstNode.x + firstNode.width / 2,
    y: firstNode.y + firstNode.height / 2,
  }
  const nextCenter = {
    x: firstNext.x + firstNext.width / 2,
    y: firstNext.y + firstNext.height / 2,
  }
  const relative = rotatePoint(
    oldCenter.x - instance.transform.x,
    oldCenter.y - instance.transform.y,
    -instance.transform.rotation
  )
  const local = {
    x: relative.x / instance.transform.scale,
    y: relative.y / instance.transform.scale,
  }
  const transformedLocal = rotatePoint(
    local.x * nextScale,
    local.y * nextScale,
    nextRotation
  )
  const transform: ComponentTransform = {
    x: nextCenter.x - transformedLocal.x,
    y: nextCenter.y - transformedLocal.y,
    scale: nextScale,
    rotation: nextRotation,
  }
  if (
    close(transform.x, instance.transform.x) &&
    close(transform.y, instance.transform.y) &&
    close(transform.scale, instance.transform.scale) &&
    close(transform.rotation, instance.transform.rotation)
  ) {
    return null
  }

  for (const mapping of instance.nodeMappings) {
    const node = nodeById.get(mapping.instanceNodeId)
    const change = changeById.get(mapping.instanceNodeId)
    if (!node || !change) return null
    const next = mergedGeometry(node, change)
    const currentCenter = {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    }
    const currentRelative = rotatePoint(
      currentCenter.x - instance.transform.x,
      currentCenter.y - instance.transform.y,
      -instance.transform.rotation
    )
    const currentLocal = {
      x: currentRelative.x / instance.transform.scale,
      y: currentRelative.y / instance.transform.scale,
    }
    const projected = rotatePoint(
      currentLocal.x * transform.scale,
      currentLocal.y * transform.scale,
      transform.rotation
    )
    const projectedCenter = {
      x: transform.x + projected.x,
      y: transform.y + projected.y,
    }
    if (
      !close(next.x + next.width / 2, projectedCenter.x) ||
      !close(next.y + next.height / 2, projectedCenter.y) ||
      !close(next.width, node.width * scaleRatio) ||
      !close(next.height, node.height * scaleRatio) ||
      !close(
        normalizedRotation(next.rotation),
        normalizedRotation(node.rotation + rotationDelta)
      )
    ) {
      return null
    }
  }
  return { instanceId: instance.id, transform }
}
