export const studioDesktopPresentationBreakpoint = 1280
export const studioDesktopPresentationQuery = `(min-width: ${studioDesktopPresentationBreakpoint}px)`

export const isStudioDesktopPresentationWidth = (width: number) =>
  width >= studioDesktopPresentationBreakpoint

export const resolveLibraryTemplateSurfaceVisibility = ({
  desktopPresentation,
  documentPanelTab,
  compactDocumentPanelOpen,
}: Readonly<{
  desktopPresentation: boolean
  documentPanelTab: string
  compactDocumentPanelOpen: boolean
}>) => ({
  desktop: desktopPresentation && documentPanelTab === "templates",
  compact:
    !desktopPresentation &&
    compactDocumentPanelOpen &&
    documentPanelTab === "templates",
})
