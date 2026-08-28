import { describe, expect, it, vi } from "vitest"

import { stageUsableLocalImageSource } from "./local-image-source-stage"
import type { LocalImageSourceStageError } from "./local-image-source-stage"

describe("local image source staging", () => {
  it("returns a decoded exact source and releases it idempotently", async () => {
    const revokeObjectUrl = vi.fn()
    const decodeSource = vi.fn(async () => ({ width: 1200, height: 800 }))
    const staged = await stageUsableLocalImageSource(
      new Blob(["image"], { type: "image/png" }),
      { width: 1200, height: 800 },
      {
        createObjectUrl: () => "blob:staged-ready",
        revokeObjectUrl,
        decodeSource,
      }
    )

    expect(decodeSource).toHaveBeenCalledWith("blob:staged-ready")
    expect(staged).toMatchObject({
      src: "blob:staged-ready",
      dimensions: { width: 1200, height: 800 },
    })
    staged.release()
    staged.release()
    expect(revokeObjectUrl).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:staged-ready")
  })

  it("revokes a source that fails exact decoding", async () => {
    const revokeObjectUrl = vi.fn()
    await expect(
      stageUsableLocalImageSource(
        new Blob(["broken"], { type: "image/png" }),
        { width: 1200, height: 800 },
        {
          createObjectUrl: () => "blob:staged-broken",
          revokeObjectUrl,
          decodeSource: async () => {
            throw new Error("decode rejected")
          },
        }
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<LocalImageSourceStageError>>({
        name: "LocalImageSourceStageError",
        code: "decode_failed",
      })
    )
    expect(revokeObjectUrl).toHaveBeenCalledOnce()
  })

  it("revokes a source whose decoded dimensions changed", async () => {
    const revokeObjectUrl = vi.fn()
    await expect(
      stageUsableLocalImageSource(
        new Blob(["wrong-size"], { type: "image/png" }),
        { width: 1200, height: 800 },
        {
          createObjectUrl: () => "blob:staged-wrong-size",
          revokeObjectUrl,
          decodeSource: async () => ({ width: 600, height: 400 }),
        }
      )
    ).rejects.toMatchObject({ code: "dimension_mismatch" })
    expect(revokeObjectUrl).toHaveBeenCalledOnce()
  })
})
