import { describe, expect, it } from "vitest"
import {
  documentStructureCommandIds,
  isDocumentStructureCommandEnabled,
} from "../src/structure-commands"

const context = {
  reviewPending: false,
  outputCount: 2,
  outputPageCount: 3,
  pageIndex: 1,
}

describe("document structure commands", () => {
  it("keeps the complete public command vocabulary stable", () => {
    expect(documentStructureCommandIds).toEqual([
      "page.add",
      "page.duplicate",
      "page.update",
      "page.remove",
      "page.move-up",
      "page.move-down",
      "output.add",
      "output.update",
      "output.remove",
    ])
  })

  it("enforces the page and output invariants at the capability boundary", () => {
    expect(
      isDocumentStructureCommandEnabled("page.remove", {
        ...context,
        outputPageCount: 1,
      })
    ).toBe(false)
    expect(
      isDocumentStructureCommandEnabled("output.remove", {
        ...context,
        outputCount: 1,
      })
    ).toBe(false)
    expect(
      isDocumentStructureCommandEnabled("page.move-up", {
        ...context,
        pageIndex: 0,
      })
    ).toBe(false)
    expect(
      isDocumentStructureCommandEnabled("page.move-down", {
        ...context,
        pageIndex: 2,
      })
    ).toBe(false)
  })

  it("blocks every structural mutation while review is pending", () => {
    for (const commandId of documentStructureCommandIds) {
      expect(
        isDocumentStructureCommandEnabled(commandId, {
          ...context,
          reviewPending: true,
        })
      ).toBe(false)
    }
  })
})
