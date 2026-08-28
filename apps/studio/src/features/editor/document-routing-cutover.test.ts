import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const documentRouteSource = readFileSync(
  new URL("../../routes/_studio/documents/$documentId.tsx", import.meta.url),
  "utf8"
)
const libraryRouteSource = readFileSync(
  new URL("../../routes/_studio/index.tsx", import.meta.url),
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
const routeTreeSource = readFileSync(
  new URL("../../routeTree.gen.ts", import.meta.url),
  "utf8"
)

describe("canonical document route cutover", () => {
  it("admits before mounting a document-keyed Studio session", () => {
    expect(documentRouteSource).toContain(
      "const { documentId } = Route.useParams()"
    )
    expect(documentRouteSource).toContain(
      "<StudioDocumentRouteSession key={documentId} routeDocumentId={documentId} />"
    )
    expect(documentRouteSource).toContain(".admit(routeIdentity.documentId)")
    expect(documentRouteSource).toContain('if (state.status !== "opened")')
    expect(documentRouteSource).toContain(
      "initialDocumentRecord={state.admission.record}"
    )
    expect(documentRouteSource).toContain("key={documentId}")
    expect(documentRouteSource).not.toContain("openStoredDocument(")
  })

  it("keeps canonical identity in the router and admitted editor owner", () => {
    expect(routeTreeSource).toContain("'/_studio/documents/$documentId'")
    expect(routeTreeSource).toContain("'/documents/$documentId'")
    expect(editorSource).toContain("initialRecord?: DocumentDraftRecord | null")
    expect(editorSource).toContain(
      'transition = claimSessionTransition("route")'
    )
    expect(shellSource).toContain("initialRecord: initialDocumentRecord")
    expect(shellSource).toContain("editor.document.id !== routeDocumentId")
    expect(shellSource).toContain("return editor.flushActiveDraft()")
    expect(shellSource).toContain("useDocumentRouteNavigationGuard({")
  })

  it("routes library opens and preserves typed redirect notices", () => {
    expect(libraryRouteSource).toContain(
      "validateDocumentLibraryNoticeSearch(search)"
    )
    expect(libraryRouteSource).toContain('to: "/documents/$documentId"')
    expect(libraryRouteSource).toContain("routeNotice={notice}")
    expect(documentRouteSource).toContain("search: redirectSearchFor(result)")
    expect(documentRouteSource).toContain("replace: true")
  })
})
