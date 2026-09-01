import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const editorSource = readFileSync(
  new URL("./use-document-editor.ts", import.meta.url),
  "utf8"
)
const shellSource = readFileSync(
  new URL("../studio-shell.tsx", import.meta.url),
  "utf8"
)

describe("Studio shell multi-document session cutover", () => {
  it("does not treat the durable library head as a replaceable current draft", () => {
    expect(shellSource).toContain(
      'hasCurrentDraft: editor.sessionMode === "workspace"'
    )
    expect(shellSource).not.toContain("editor.startModel.currentDraft")
    expect(editorSource).not.toContain("continueCurrentDraft")
    expect(editorSource).not.toContain("rememberStartRecord")
    expect(editorSource).not.toContain(
      'created.reason === "exists" && origin.kind === "quotation"'
    )
    expect(editorSource).toContain(
      "cloneTemplateDocument(quotationStarter.document)"
    )
  })

  it("hands an approved generated document to the route owner", () => {
    expect(shellSource).toContain(
      "const createGeneratedDocumentAndOpen = useCallback(async () =>"
    )
    expect(shellSource).toContain(
      "const created = await editor.createGeneratedDocument()"
    )
    expect(shellSource).toContain(
      "const generatedDocumentId = editor.pendingGeneratedDocument?.candidate.id"
    )
    expect(shellSource).toContain(
      "generatedDocumentRouteHandoffRef.current = generatedDocumentId"
    )
    expect(shellSource).toContain(
      "void finishOpenedSession(generatedDocumentId)"
    )
    expect(shellSource).toContain(
      "onCreateGeneratedDocument={createGeneratedDocumentAndOpen}"
    )
    expect(shellSource).not.toContain(
      "onCreateGeneratedDocument={editor.createGeneratedDocument}"
    )
  })
})
