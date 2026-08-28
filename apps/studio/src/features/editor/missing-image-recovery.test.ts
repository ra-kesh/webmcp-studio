import { describe, expect, it } from "vitest"

import { projectMissingImageRecoveryActions } from "./missing-image-recovery"

describe("missing image recovery actions", () => {
  it("offers retry, locate, and remove for an editable missing image", () => {
    expect(
      projectMissingImageRecoveryActions({
        readiness: "unavailable",
        documentEditable: true,
        imageLocked: false,
        canReplaceImage: true,
      })
    ).toEqual([
      { id: "retry", enabled: true, disabledReason: null },
      { id: "locate", enabled: true, disabledReason: null },
      { id: "remove", enabled: true, disabledReason: null },
    ])
  })

  it("keeps retry available while explaining why a bound image cannot be located directly", () => {
    expect(
      projectMissingImageRecoveryActions({
        readiness: "unavailable",
        documentEditable: true,
        imageLocked: false,
        canReplaceImage: false,
        replacementDisabledReason:
          "Change the shared asset field or unbind Source first.",
      })
    ).toEqual([
      { id: "retry", enabled: true, disabledReason: null },
      {
        id: "locate",
        enabled: false,
        disabledReason: "Change the shared asset field or unbind Source first.",
      },
      { id: "remove", enabled: true, disabledReason: null },
    ])
  })

  it("does not expose destructive recovery for a locked or reviewed document", () => {
    const actions = projectMissingImageRecoveryActions({
      readiness: "unavailable",
      documentEditable: false,
      imageLocked: true,
      canReplaceImage: false,
    })

    expect(actions[0]).toEqual({
      id: "retry",
      enabled: true,
      disabledReason: null,
    })
    expect(actions[1]?.enabled).toBe(false)
    expect(actions[2]).toEqual({
      id: "remove",
      enabled: false,
      disabledReason:
        "Finish or discard the pending review before editing this layer.",
    })
  })

  it("keeps recovery hidden from healthy and still-loading images", () => {
    for (const readiness of ["unknown", "loading", "ready"] as const) {
      expect(
        projectMissingImageRecoveryActions({
          readiness,
          documentEditable: true,
          imageLocked: false,
          canReplaceImage: true,
        }).every((action) => !action.enabled)
      ).toBe(true)
    }
  })
})
