import { northstarSeed } from "@webmcp/document"
import {
  commitCommands,
  createDocumentHistory,
  redoDocument,
  undoDocument,
} from "@webmcp/editor/history"
import { describe, expect, it } from "vitest"
import { retainReachableHistorySnapshotContexts } from "./history-snapshot-context"

const moveTitle = (id: string, x: number) => ({
  id,
  type: "update_node" as const,
  actor: "human" as const,
  at: "2026-08-29T10:00:00.000Z",
  nodeId: "cover-title",
  patch: { x },
})

describe("history snapshot contexts", () => {
  it("removes evicted snapshots while retaining current undo and redo contexts", () => {
    const first = commitCommands(
      createDocumentHistory(northstarSeed, "snapshot-initial"),
      [moveTitle("first", 100)]
    )
    const second = commitCommands(first, [moveTitle("second", 120)])
    const undone = undoDocument(second)
    const contexts = new Map([
      ["snapshot-evicted", "evicted"],
      ["snapshot-initial", "initial"],
      ["snapshot-first", "first"],
      ["snapshot-second", "second"],
    ])

    const retained = retainReachableHistorySnapshotContexts(contexts, undone)

    expect([...retained.keys()].sort()).toEqual([
      "snapshot-first",
      "snapshot-initial",
      "snapshot-second",
    ])
    expect(retained.get(undoDocument(undone).snapshotId)).toBe("initial")
    expect(retained.get(redoDocument(undone).snapshotId)).toBe("second")
  })
})
