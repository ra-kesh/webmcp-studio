import { describe, expect, it } from "vitest"
import {
  IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON,
  IMAGE_REPLACEMENT_OUTPUT_STALE_REASON,
  assertImageReplacementOutputAdmission,
  captureImageReplacementOutputAdmission,
  imageReplacementOutputAdmission,
  imageReplacementOutputCommandStates,
} from "./image-replacement-output-admission"

describe("image replacement output admission", () => {
  it("blocks pending previews with one exact reason and recovers after settlement", () => {
    const ready = imageReplacementOutputAdmission(false, 0)
    const lease = captureImageReplacementOutputAdmission(ready)
    const pending = imageReplacementOutputAdmission(true, 1)

    expect(pending).toEqual({
      admitted: false,
      disabledReason: IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON,
      generation: 1,
    })
    expect(() => captureImageReplacementOutputAdmission(pending)).toThrow(
      IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON
    )

    const committed = imageReplacementOutputAdmission(false, 2)
    const rolledBack = imageReplacementOutputAdmission(false, 4)
    expect(committed.admitted).toBe(true)
    expect(rolledBack.admitted).toBe(true)
    expect(() =>
      captureImageReplacementOutputAdmission(committed)
    ).not.toThrow()
    expect(() =>
      captureImageReplacementOutputAdmission(rolledBack)
    ).not.toThrow()

    expect(() =>
      assertImageReplacementOutputAdmission(committed, lease)
    ).toThrow(IMAGE_REPLACEMENT_OUTPUT_STALE_REASON)
    expect(() =>
      assertImageReplacementOutputAdmission(rolledBack, lease)
    ).toThrow(IMAGE_REPLACEMENT_OUTPUT_STALE_REASON)
  })

  it("projects same-tick command denial and recovery from live admission", () => {
    let admission = imageReplacementOutputAdmission(false, 0)
    const readStates = () =>
      imageReplacementOutputCommandStates(admission, {
        outputBusy: false,
        publishDisabledReason: null,
        pdfLabel: "2-page PDF",
      })

    expect(readStates()["document.publish"].enabled).toBe(true)

    admission = imageReplacementOutputAdmission(true, 1)
    for (const commandId of [
      "document.publish",
      "output.export-png",
      "output.export-pdf",
    ] as const) {
      expect(readStates()[commandId]).toMatchObject({
        enabled: false,
        disabledReason: IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON,
      })
    }

    admission = imageReplacementOutputAdmission(false, 2)
    expect(readStates()["document.publish"].enabled).toBe(true)
    expect(readStates()["output.export-png"].enabled).toBe(true)
    expect(readStates()["output.export-pdf"].enabled).toBe(true)
  })
})
