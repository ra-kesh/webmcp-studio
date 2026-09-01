import type { Document } from "@webmcp/document"

export function buildMultiArtboardPageSyncIdentities(document: Document) {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const groupsByPageId = new Map<string, Document["groups"]>()
  for (const group of document.groups) {
    const groups = groupsByPageId.get(group.pageId) ?? []
    groups.push(group)
    groupsByPageId.set(group.pageId, groups)
  }
  return new Map(
    document.pages.map((page) => [
      page.id,
      JSON.stringify({
        documentId: document.id,
        page,
        nodes: page.nodeIds.map((nodeId) => nodesById.get(nodeId) ?? null),
        groups: groupsByPageId.get(page.id) ?? [],
      }),
    ])
  )
}
