import { describe, expect, it } from "vitest"
import {
  createSessionHistory,
  recordSessionHistoryAction,
  resetSessionHistoryForDocument,
  takeSessionRedo,
  takeSessionUndo,
} from "./studio-session-history"

describe("studio session history", () => {
  it("preserves document and guide chronology within one synchronous turn", () => {
    const guideThenDocument = recordSessionHistoryAction(
      recordSessionHistoryAction(createSessionHistory(), {
        kind: "guide",
        id: "guide-1",
      }),
      { kind: "document", id: "document-1" }
    )
    expect(takeSessionUndo(guideThenDocument).action).toEqual({
      kind: "document",
      id: "document-1",
    })

    const documentThenGuide = recordSessionHistoryAction(
      recordSessionHistoryAction(createSessionHistory(), {
        kind: "document",
        id: "document-1",
      }),
      { kind: "guide", id: "guide-1" }
    )
    expect(takeSessionUndo(documentThenGuide).action).toEqual({
      kind: "guide",
      id: "guide-1",
    })
  })

  it("moves the exact action between past and future", () => {
    const ledger = recordSessionHistoryAction(createSessionHistory(), {
      kind: "guide",
      id: "guide-1",
    })
    const undone = takeSessionUndo(ledger)
    expect(undone.ledger.past).toEqual([])
    expect(undone.ledger.future).toEqual([{ kind: "guide", id: "guide-1" }])
    expect(takeSessionRedo(undone.ledger)).toEqual({
      action: { kind: "guide", id: "guide-1" },
      ledger,
    })
  })

  it("clears the future branch for a new action and deduplicates coalescing", () => {
    const first = recordSessionHistoryAction(createSessionHistory(), {
      kind: "document",
      id: "document-1",
    })
    const undone = takeSessionUndo(first).ledger
    const branched = recordSessionHistoryAction(undone, {
      kind: "guide",
      id: "guide-1",
    })
    expect(branched.future).toEqual([])
    expect(recordSessionHistoryAction(branched, branched.past[0])).toBe(
      branched
    )
  })

  it("keeps only the current document entry when identity changes", () => {
    expect(resetSessionHistoryForDocument(null)).toEqual(createSessionHistory())
    expect(resetSessionHistoryForDocument("import-1")).toEqual({
      past: [{ kind: "document", id: "import-1" }],
      future: [],
    })
  })
})
