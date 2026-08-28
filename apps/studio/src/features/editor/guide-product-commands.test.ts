import { describe, expect, it, vi } from "vitest"
import {
  executeGuideProductCommand,
  isGuideProductCommandId,
  projectGuideProductCommandState,
} from "./guide-product-commands"

describe("guide product commands", () => {
  it("projects checked state for the shared menu, context, and palette model", () => {
    expect(
      projectGuideProductCommandState({
        rulersVisible: true,
        guidesVisible: false,
      })
    ).toEqual({
      "canvas.rulers.toggle": { checked: true },
      "canvas.guides.toggle": { checked: false },
      "canvas.guides.manage": {},
    })
  })

  it("toggles each preference without changing the other preference", () => {
    const setPreferences = vi.fn()
    const actions = {
      preferences: { rulersVisible: true, guidesVisible: false },
      setPreferences,
      openManager: vi.fn(),
    }
    executeGuideProductCommand("canvas.rulers.toggle", actions)
    expect(setPreferences).toHaveBeenLastCalledWith({
      rulersVisible: false,
      guidesVisible: false,
    })
    executeGuideProductCommand("canvas.guides.toggle", actions)
    expect(setPreferences).toHaveBeenLastCalledWith({
      rulersVisible: true,
      guidesVisible: true,
    })
  })

  it("opens the accessible manager even when both visual layers are hidden", () => {
    const openManager = vi.fn()
    executeGuideProductCommand("canvas.guides.manage", {
      preferences: { rulersVisible: false, guidesVisible: false },
      setPreferences: vi.fn(),
      openManager,
    })
    expect(openManager).toHaveBeenCalledOnce()
  })

  it("recognizes only the three guide commands", () => {
    expect(isGuideProductCommandId("canvas.guides.manage")).toBe(true)
    expect(isGuideProductCommandId("document.new")).toBe(false)
  })
})
