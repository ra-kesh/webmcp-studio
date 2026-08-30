import { describe, expect, it } from "vitest"
import {
  isStudioDesktopPresentationWidth,
  resolveLibraryTemplateSurfaceVisibility,
} from "./library-template-surface-visibility"

describe("library template surface visibility", () => {
  it.each([
    [1032, false],
    [1279, false],
    [1280, true],
    [1600, true],
  ])("matches the CSS presentation breakpoint at %ipx", (width, desktop) => {
    expect(isStudioDesktopPresentationWidth(width)).toBe(desktop)
  })

  it("gives one visible Templates surface exclusive discovery ownership", () => {
    expect(
      resolveLibraryTemplateSurfaceVisibility({
        desktopPresentation: false,
        documentPanelTab: "templates",
        compactDocumentPanelOpen: true,
      })
    ).toEqual({ desktop: false, compact: true })

    expect(
      resolveLibraryTemplateSurfaceVisibility({
        desktopPresentation: true,
        documentPanelTab: "templates",
        compactDocumentPanelOpen: true,
      })
    ).toEqual({ desktop: true, compact: false })

    expect(
      resolveLibraryTemplateSurfaceVisibility({
        desktopPresentation: false,
        documentPanelTab: "layers",
        compactDocumentPanelOpen: true,
      })
    ).toEqual({ desktop: false, compact: false })
  })
})
