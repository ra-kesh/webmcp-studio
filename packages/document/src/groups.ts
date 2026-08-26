import type { Document } from "./schema"

export function getGroupNodeIds(
  document: Pick<Document, "groups">,
  groupId: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(groupId)) return []
  visited.add(groupId)
  const group = document.groups.find((candidate) => candidate.id === groupId)
  if (!group) return []
  return [
    ...group.nodeIds,
    ...document.groups
      .filter((candidate) => candidate.parentGroupId === groupId)
      .flatMap((candidate) => getGroupNodeIds(document, candidate.id, visited)),
  ]
}

export function findSelectedGroupId(
  document: Pick<Document, "groups">,
  nodeIds: string[]
) {
  if (nodeIds.length < 2) return null
  const selected = new Set(nodeIds)
  return (
    document.groups.find((group) => {
      const memberIds = getGroupNodeIds(document, group.id)
      return (
        memberIds.length === selected.size &&
        memberIds.every((nodeId) => selected.has(nodeId))
      )
    })?.id ?? null
  )
}
