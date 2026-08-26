import { northstarSeed } from "@webmcp/document"
import { describe, expect, it } from "vitest"
import {
  commitCommands,
  createDocumentHistory,
  redoDocument,
  undoDocument,
} from "../src/history"

describe("document history", () => {
  it("groups a batch of renderer changes into one undo step", () => {
    const initial = createDocumentHistory(northstarSeed)
    const changed = commitCommands(initial, [
      {
        id: "move-one",
        type: "update_node",
        actor: "human",
        at: "2026-08-26T09:30:00.000Z",
        nodeId: "cover-title",
        patch: { x: 100 },
      },
      {
        id: "move-two",
        type: "update_node",
        actor: "human",
        at: "2026-08-26T09:30:00.001Z",
        nodeId: "cover-date",
        patch: { x: 100 },
      },
    ])

    expect(changed.past).toHaveLength(1)
    const undone = undoDocument(changed)
    expect(undone.document).toEqual(northstarSeed)
    expect(redoDocument(undone).document).toEqual(changed.document)
  })
})
