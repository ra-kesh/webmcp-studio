// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import { useDocumentEditor } from "./use-document-editor"
import type { DocumentHistoryCommit } from "./use-document-editor"

type Editor = ReturnType<typeof useDocumentEditor>

function MountedEditor({
  capture,
  onHistoryCommit,
}: {
  capture: (editor: Editor) => void
  onHistoryCommit: (entry: DocumentHistoryCommit) => void
}) {
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({ onHistoryCommit, persistence })
  useLayoutEffect(() => capture(editor))
  return null
}

describe("useDocumentEditor history commit observation", () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("reports a document commit synchronously at the mutation boundary", async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    const captured: { current: Editor | null } = { current: null }
    const commits: DocumentHistoryCommit[] = []

    await act(async () => {
      root.render(
        <StudioPersistenceTestWrapper>
          <MountedEditor
            capture={(editor) => {
              captured.current = editor
            }}
            onHistoryCommit={(entry) => commits.push(entry)}
          />
        </StudioPersistenceTestWrapper>
      )
    })

    expect(captured.current).not.toBeNull()
    await act(async () => {
      captured.current!.addRectangle()
      expect(commits).toHaveLength(1)
      expect(commits[0]).toMatchObject({ label: "Add layer" })
    })
    expect(captured.current!.documentUndoEntry?.id).toBe(commits[0]?.id)
  })

  it("does not report undo, redo, or redo-branch maintenance as new commits", async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    const captured: { current: Editor | null } = { current: null }
    const commits: DocumentHistoryCommit[] = []

    await act(async () => {
      root.render(
        <StudioPersistenceTestWrapper>
          <MountedEditor
            capture={(editor) => {
              captured.current = editor
            }}
            onHistoryCommit={(entry) => commits.push(entry)}
          />
        </StudioPersistenceTestWrapper>
      )
    })
    await act(async () => captured.current!.addRectangle())
    await act(async () => captured.current!.undo())
    await act(async () => captured.current!.redo())
    await act(async () => captured.current!.breakHistoryCoalescing())
    await act(async () => captured.current!.clearRedo())

    expect(commits).toHaveLength(1)
  })
})
