import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const startSurfaceSource = readFileSync(
  new URL("./studio-start-surface.tsx", import.meta.url),
  "utf8"
)
const editorSource = readFileSync(
  new URL("./use-document-editor.ts", import.meta.url),
  "utf8"
)
const shellSource = readFileSync(
  new URL("../studio-shell.tsx", import.meta.url),
  "utf8"
)

describe("Recent documents Start cutover", () => {
  it("uses one retained library owner and exact-ID document opening", () => {
    expect(shellSource).toContain(
      'useRecentDocumentsVisibility(editor.sessionMode === "start")'
    )
    expect(shellSource).toContain("onOpenDocument={editor.openStoredDocument}")
    expect(startSurfaceSource).toContain("<RecentDocuments")
    expect(startSurfaceSource).not.toContain("CurrentDraftCard")
    expect(startSurfaceSource).not.toContain("Current browser draft")

    expect(editorSource).not.toContain("refreshReadyList")
    expect(editorSource).not.toContain("deriveRepositoryDraftSummary")
    expect(editorSource).not.toContain("startDocumentIdRef")
    expect(editorSource).not.toContain(".list({ limit: 50 })")
  })
})
