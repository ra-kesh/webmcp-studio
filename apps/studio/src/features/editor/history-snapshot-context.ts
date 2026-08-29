import type { DocumentHistory } from "@webmcp/editor/history"

export function retainReachableHistorySnapshotContexts<T>(
  contexts: ReadonlyMap<string, T>,
  history: DocumentHistory
): Map<string, T> {
  const reachable = new Set<string>([history.snapshotId])
  for (const entry of [...history.past, ...history.future]) {
    reachable.add(entry.beforeSnapshotId)
    reachable.add(entry.afterSnapshotId)
  }
  return new Map(
    [...contexts].filter(([snapshotId]) => reachable.has(snapshotId))
  )
}
