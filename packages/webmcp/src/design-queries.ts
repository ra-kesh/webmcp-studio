import {
  managedAssetIdFromSource,
  type Document,
  type SceneNode,
} from "@webmcp/document"
import {
  buildLayerTreeModel,
  type LayerTreeItem,
} from "@webmcp/editor/layer-tree"

export const DESIGN_QUERY_MAX_LIMIT = 100
export const DESIGN_QUERY_MAX_DEPTH = 8

export type DesignQueryIdentity = Readonly<{
  documentId: string
  revision: number
  snapshotId: string
  operationVersion: number
}>

export type DesignTreeQuery = Readonly<{
  pageId?: string
  depth: number
  limit: number
  cursor: string | null
}>

export type DesignNodeSearchQuery = Readonly<{
  query: string
  pageId?: string
  types?: readonly SceneNode["type"][]
  limit: number
  cursor: string | null
}>

export class DesignQueryError extends Error {
  constructor(
    readonly code:
      | "invalid_query"
      | "invalid_cursor"
      | "page_not_found"
      | "output_not_found"
      | "node_not_found"
      | "capabilities_unavailable"
      | "stale_context"
      | "capability_not_found"
      | "mode_not_supported"
      | "command_disabled"
      | "transient_state_not_supported"
      | "idempotency_key_reused"
      | "request_in_progress"
      | "invalid_target"
      | "no_changes"
      | "operation_limit_exceeded"
      | "unsupported_command"
      | "execution_declined"
      | "review_unavailable"
      | "execution_cancelled"
      | "execution_status_unknown"
      | "internal_error",
    message: string,
    readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message)
    this.name = "DesignQueryError"
  }
}

const queryFingerprint = (value: unknown) => {
  const input = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const encodeCursor = (fingerprint: string, offset: number) =>
  `dq1.${fingerprint}.${offset.toString(36)}`

const cursorOffset = (cursor: string | null, fingerprint: string) => {
  if (!cursor) return 0
  const match = cursor.match(/^dq1\.([a-z0-9]+)\.([a-z0-9]+)$/)
  if (!match || match[1] !== fingerprint) {
    throw new DesignQueryError(
      "invalid_cursor",
      "The query cursor does not belong to this document query."
    )
  }
  const offset = Number.parseInt(match[2]!, 36)
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new DesignQueryError("invalid_cursor", "The query cursor is invalid.")
  }
  return offset
}

const pageForNode = (document: Document, nodeId: string) =>
  document.pages.find((page) => page.nodeIds.includes(nodeId)) ?? null

const directGroupForNode = (document: Document, nodeId: string) =>
  document.groups.find((group) => group.nodeIds.includes(nodeId)) ?? null

const groupAncestry = (document: Document, groupId: string | null) => {
  const groupById = new Map(document.groups.map((group) => [group.id, group]))
  const ancestry: Array<{ id: string; name: string }> = []
  const visited = new Set<string>()
  let currentId = groupId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const group = groupById.get(currentId)
    if (!group) break
    ancestry.unshift({ id: group.id, name: group.name })
    currentId = group.parentGroupId ?? null
  }
  return ancestry
}

export const publicDesignNode = (node: SceneNode) => {
  if (node.type !== "image") return node
  const { src: _privateSource, ...publicNode } = node
  const managedAssetId = managedAssetIdFromSource(node.src)
  return {
    ...publicNode,
    assetId: node.src.startsWith("asset:local/")
      ? "unavailable-local-asset"
      : (managedAssetId ?? node.assetId),
  }
}

const flattenLayerTree = (
  items: readonly LayerTreeItem[],
  page: Document["pages"][number],
  maximumDepth: number,
  parentId: string,
  depth = 1
): Record<string, unknown>[] =>
  items.flatMap((item) => {
    const compact = {
      id: item.id,
      kind: item.kind,
      name: item.name,
      type: item.nodeType,
      pageId: page.id,
      outputId: page.outputId,
      parentId,
      depth,
      visible: item.visible,
      locked: item.locked,
      childCount: item.children.length,
      ...(item.visibilityMixed ? { visibilityMixed: true } : {}),
      ...(item.lockMixed ? { lockMixed: true } : {}),
    }
    return depth < maximumDepth
      ? [
          compact,
          ...flattenLayerTree(
            item.children,
            page,
            maximumDepth,
            item.id,
            depth + 1
          ),
        ]
      : [compact]
  })

export function readDesignTree(
  document: Document,
  identity: DesignQueryIdentity,
  query: DesignTreeQuery
) {
  const pages = query.pageId
    ? document.pages.filter((page) => page.id === query.pageId)
    : document.pages
  if (query.pageId && pages.length === 0) {
    throw new DesignQueryError(
      "page_not_found",
      `Page ${query.pageId} does not exist in this document.`
    )
  }
  const fingerprint = queryFingerprint({
    documentId: identity.documentId,
    snapshotId: identity.snapshotId,
    pageId: query.pageId ?? null,
    depth: query.depth,
  })
  const items = pages.flatMap((page) => [
    {
      id: page.id,
      kind: "page" as const,
      name: page.name,
      pageId: page.id,
      outputId: page.outputId,
      parentId: null,
      depth: 0,
      width: page.width,
      height: page.height,
      layerCount: page.nodeIds.length,
    },
    ...flattenLayerTree(
      buildLayerTreeModel(document, page.id).items,
      page,
      query.depth,
      page.id
    ),
  ])
  const offset = cursorOffset(query.cursor, fingerprint)
  if (offset > items.length) {
    throw new DesignQueryError(
      "invalid_cursor",
      "The query cursor is out of range."
    )
  }
  const selected = items.slice(offset, offset + query.limit)
  const nextOffset = offset + selected.length
  return {
    identity,
    order: "front_to_back" as const,
    items: selected,
    nextCursor:
      nextOffset < items.length ? encodeCursor(fingerprint, nextOffset) : null,
  }
}

export function readDesignNode(
  document: Document,
  identity: DesignQueryIdentity,
  nodeId: string
) {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new DesignQueryError(
      "node_not_found",
      `Layer ${nodeId} does not exist in this document.`
    )
  }
  const page = pageForNode(document, node.id)
  if (!page) {
    throw new DesignQueryError(
      "node_not_found",
      `Layer ${nodeId} is not attached to a document page.`
    )
  }
  const output = document.outputs.find(
    (candidate) => candidate.id === page.outputId
  )
  const group = directGroupForNode(document, node.id)
  const bindings = document.bindings
    .filter((binding) => binding.nodeId === node.id)
    .map((binding) => {
      const field = document.fields.find(
        (candidate) => candidate.id === binding.fieldId
      )
      return {
        id: binding.id,
        property: binding.property,
        field: field
          ? {
              id: field.id,
              key: field.key,
              label: field.label,
              type: field.type,
            }
          : { id: binding.fieldId, missing: true as const },
      }
    })
  return {
    identity,
    page: { id: page.id, name: page.name },
    output: output
      ? { id: output.id, name: output.name, kind: output.kind }
      : null,
    groupAncestry: groupAncestry(document, group?.id ?? null),
    node: publicDesignNode(node),
    bindings,
  }
}

export function searchDesignNodes(
  document: Document,
  identity: DesignQueryIdentity,
  query: DesignNodeSearchQuery
) {
  if (
    query.pageId &&
    !document.pages.some((page) => page.id === query.pageId)
  ) {
    throw new DesignQueryError(
      "page_not_found",
      `Page ${query.pageId} does not exist in this document.`
    )
  }
  const normalized = query.query.trim().toLocaleLowerCase()
  const allowedTypes = query.types ? new Set(query.types) : null
  const pageIdsByNode = new Map<string, string>()
  for (const page of document.pages) {
    for (const nodeId of page.nodeIds) pageIdsByNode.set(nodeId, page.id)
  }
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const matches = document.pages.flatMap((page) => {
    if (query.pageId && page.id !== query.pageId) return []
    return page.nodeIds.flatMap((nodeId) => {
      const node = nodeById.get(nodeId)
      if (!node || (allowedTypes && !allowedTypes.has(node.type))) return []
      const text = node.type === "text" ? node.text : ""
      if (!`${node.name}\n${text}`.toLocaleLowerCase().includes(normalized)) {
        return []
      }
      const group = directGroupForNode(document, node.id)
      return [
        {
          id: node.id,
          name: node.name,
          type: node.type,
          pageId: pageIdsByNode.get(node.id)!,
          groupId: group?.id ?? null,
          ...(node.type === "text" ? { text: node.text.slice(0, 500) } : {}),
        },
      ]
    })
  })
  const fingerprint = queryFingerprint({
    documentId: identity.documentId,
    snapshotId: identity.snapshotId,
    query: normalized,
    pageId: query.pageId ?? null,
    types: query.types ? [...query.types].sort() : null,
  })
  const offset = cursorOffset(query.cursor, fingerprint)
  if (offset > matches.length) {
    throw new DesignQueryError(
      "invalid_cursor",
      "The query cursor is out of range."
    )
  }
  const selected = matches.slice(offset, offset + query.limit)
  const nextOffset = offset + selected.length
  return {
    identity,
    matches: selected,
    nextCursor:
      nextOffset < matches.length
        ? encodeCursor(fingerprint, nextOffset)
        : null,
  }
}
