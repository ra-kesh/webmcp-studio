import { describe, expect, it } from "vitest"
import { documentMediaAdmissionActionModel } from "../studio-shell"

describe("document media admission banner actions", () => {
  it("shows Restore only for the exact recovered head", () => {
    expect(documentMediaAdmissionActionModel(null, false)).toEqual({
      showRestore: true,
      showPreservation: false,
      keepLabel: "Keep recovered images",
    })
  })

  it("switches an advanced head to preservation actions", () => {
    expect(documentMediaAdmissionActionModel(null, true)).toEqual({
      showRestore: false,
      showPreservation: true,
      keepLabel: "Keep recovered images",
    })
  })

  it("shows only Keep restored version after a successful Restore", () => {
    expect(
      documentMediaAdmissionActionModel("2026-08-30T10:00:00.000Z", true)
    ).toEqual({
      showRestore: false,
      showPreservation: false,
      keepLabel: "Keep restored version",
    })
  })
})
