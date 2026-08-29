import { renderConformanceDocument } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import { waitForRenderViewDocumentFonts } from "./render-conformance-readiness"

describe("render conformance readiness", () => {
  it("rejects a React capture when the exact document font is unavailable", async () => {
    await expect(
      waitForRenderViewDocumentFonts(renderConformanceDocument, "square-page", {
        check: vi.fn(() => false),
        load: vi.fn(() => Promise.resolve([])),
        ready: Promise.resolve({}) as Promise<FontFaceSet>,
      })
    ).rejects.toThrow('Canvas font unavailable: 650 30px "Geist Variable"')
  })
})
