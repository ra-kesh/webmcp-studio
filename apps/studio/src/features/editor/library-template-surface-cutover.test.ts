import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const startSurfaceSource = readFileSync(
  new URL("./studio-start-surface.tsx", import.meta.url),
  "utf8"
)
const sidebarSource = readFileSync(
  new URL("./quotation-sidebar.tsx", import.meta.url),
  "utf8"
)
const shellSource = readFileSync(
  new URL("../studio-shell.tsx", import.meta.url),
  "utf8"
)

describe("shared library template surface cutover", () => {
  it("keeps Start and editor on one browser without legacy catalog ownership", () => {
    expect(startSurfaceSource).toContain("<LibraryTemplateBrowser")
    expect(startSurfaceSource).not.toContain("function TemplateBrowser")
    expect(startSurfaceSource).not.toContain("DesignTemplateCatalogItem")
    expect(sidebarSource).toContain("<LibraryTemplateBrowser")
    expect(sidebarSource).not.toContain("TemplateCatalogPanel")

    expect(shellSource).not.toContain("editor.designTemplateCatalog")
    expect(shellSource).not.toContain("editor.applyDesignTemplate")
    expect(shellSource).toContain("resolveCreateFromLibraryTemplate")
    expect(shellSource).toContain("confirmCreateFromLibraryTemplate")
    expect(shellSource).toContain("resolveApplyLibraryTemplate")
    expect(shellSource).toContain("confirmApplyLibraryTemplate")
    expect(shellSource).not.toMatch(
      /editor\.documentError\s*\?\?\s*editor\.templateActionError/
    )
  })

  it("uses one breakpoint-aligned visibility decision for both editor surfaces", () => {
    expect(shellSource).toContain("resolveLibraryTemplateSurfaceVisibility")
    expect(shellSource).toContain("templateBrowserVisibility.desktop")
    expect(shellSource).toContain("templateBrowserVisibility.compact")
    expect(shellSource).toContain("if (desktopPresentation)")
    expect(shellSource).not.toContain(
      "resolvedShellLayout.canUseDesktopLayout &&\n                    documentPanelTab"
    )
  })

  it("routes Start, desktop, and compact template creation through one post-create command", () => {
    expect(shellSource).toContain(
      "const createFromLibraryTemplate = useCallback"
    )
    expect(shellSource).toContain("createLibraryTemplateDocument(template")
    expect(
      shellSource.match(/\(\) => createFromLibraryTemplate\(template\)/g)
    ).toHaveLength(3)
    expect(shellSource).not.toContain(
      "const resolved =\n                  await editor.resolveCreateFromLibraryTemplate(template)"
    )
  })
})
