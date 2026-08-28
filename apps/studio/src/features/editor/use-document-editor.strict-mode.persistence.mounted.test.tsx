// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import { act, StrictMode, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { CURRENT_DRAFT_STORAGE_KEY } from "./current-draft-repository"
import { DocumentDraftRepository } from "./document-draft-repository"
import { DocumentDraftSaveController } from "./document-draft-save-controller"
import { quotationStarter } from "./quotation-starter"
import {
  StudioPersistenceProvider,
  useStudioPersistence,
} from "../persistence/studio-persistence-provider"
import { StudioPersistenceRuntime } from "../persistence/studio-persistence-runtime"
import { useDocumentEditor } from "./use-document-editor"

type Editor = ReturnType<typeof useDocumentEditor>

const repositoryDatabaseName = "webmcp-studio-documents"
const realIndexedDB = globalThis.indexedDB

const deleteRepositoryDatabase = () =>
  new Promise<void>((resolve) => {
    const request = realIndexedDB.deleteDatabase(repositoryDatabaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function MountedEditor({ capture }: { capture: (editor: Editor) => void }) {
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({ persistence })
  useLayoutEffect(() => capture(editor), [capture, editor])
  return null
}

describe("useDocumentEditor StrictMode controller lease lifecycle", () => {
  let host: HTMLDivElement
  let root: Root
  let rootUnmounted: boolean

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(async () => {
    localStorage.clear()
    await deleteRepositoryDatabase()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    rootUnmounted = false
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    localStorage.clear()
    await deleteRepositoryDatabase()
  })

  it("keeps the repository leased until one controller flush unsubscribes and closes", async () => {
    const envelope = {
      schemaVersion: 1 as const,
      document: quotationStarter.document,
      sourceContext: {
        quotationSource: quotationStarter.source,
        quotationTemplateId: quotationStarter.templateId,
        designTemplate: null,
      },
    }
    localStorage.setItem(CURRENT_DRAFT_STORAGE_KEY, JSON.stringify(envelope))

    const controllerFlushGate = deferred()
    let deferControllerFlush = false
    let controllerFlushStarted = false
    const controllers = new Set<DocumentDraftSaveController>()
    const controllerUnsubscribe = vi.fn()
    const originalSubscribe = DocumentDraftSaveController.prototype.subscribe
    const controllerSubscribe = vi
      .spyOn(DocumentDraftSaveController.prototype, "subscribe")
      .mockImplementation(function (
        this: DocumentDraftSaveController,
        listener: Parameters<DocumentDraftSaveController["subscribe"]>[0]
      ) {
        controllers.add(this)
        const unsubscribe = originalSubscribe.call(this, listener)
        let active = true
        return () => {
          if (!active) return
          active = false
          controllerUnsubscribe()
          unsubscribe()
        }
      })
    const originalFlush = DocumentDraftSaveController.prototype.flush
    const controllerFlush = vi
      .spyOn(DocumentDraftSaveController.prototype, "flush")
      .mockImplementation(async function (this: DocumentDraftSaveController) {
        if (deferControllerFlush) {
          controllerFlushStarted = true
          await controllerFlushGate.promise
        }
        return originalFlush.call(this)
      })
    const controllerClose = vi.spyOn(
      DocumentDraftSaveController.prototype,
      "close"
    )

    const repositories: Array<{
      repository: DocumentDraftRepository
      close: ReturnType<typeof vi.spyOn>
    }> = []
    const createRepository = vi.fn(() => {
      const repository = new DocumentDraftRepository({
        indexedDB: realIndexedDB,
        sessionId: `strict-controller-repository-${repositories.length + 1}`,
      })
      repositories.push({
        repository,
        close: vi.spyOn(repository, "close"),
      })
      return repository
    })
    const runtimes: Array<{
      runtime: StudioPersistenceRuntime
      acquireLease: ReturnType<typeof vi.spyOn>
      releaseLease: ReturnType<typeof vi.fn>
    }> = []
    const createRuntime = vi.fn(() => {
      const runtime = new StudioPersistenceRuntime({ createRepository })
      const originalAcquireLease = runtime.acquireLease.bind(runtime)
      const releaseLease = vi.fn()
      const acquireLease = vi
        .spyOn(runtime, "acquireLease")
        .mockImplementation(() => {
          const release = originalAcquireLease()
          let active = true
          return () => {
            if (!active) return
            active = false
            releaseLease()
            release()
          }
        })
      runtimes.push({ runtime, acquireLease, releaseLease })
      return runtime
    })
    const captured: { current: Editor | null } = { current: null }

    await act(async () => {
      root.render(
        <StrictMode>
          <StudioPersistenceProvider createRuntime={createRuntime}>
            <MountedEditor
              capture={(editor) => {
                captured.current = editor
              }}
            />
          </StudioPersistenceProvider>
        </StrictMode>
      )
    })
    await vi.waitFor(() => {
      expect(captured.current?.startModel).toMatchObject({
        status: "ready",
        currentDraft: { documentId: envelope.document.id },
      })
    })
    await act(async () => {
      expect(await captured.current!.continueCurrentDraft()).toBe(true)
    })

    const retainedRuntime = runtimes.find(
      ({ acquireLease }) => acquireLease.mock.calls.length === 1
    )
    expect(retainedRuntime).toBeDefined()
    expect(createRuntime.mock.calls.length).toBeGreaterThan(1)
    expect(createRepository).toHaveBeenCalledTimes(1)
    expect(controllers.size).toBe(1)
    expect(controllerSubscribe).toHaveBeenCalledTimes(1)
    expect(retainedRuntime?.acquireLease).toHaveBeenCalledTimes(1)
    expect(controllerFlush).not.toHaveBeenCalled()
    expect(controllerClose).not.toHaveBeenCalled()
    expect(controllerUnsubscribe).not.toHaveBeenCalled()

    deferControllerFlush = true
    await act(async () => {
      root.unmount()
      rootUnmounted = true
      await Promise.resolve()
    })

    expect(controllerFlushStarted).toBe(true)
    expect(controllerFlush).toHaveBeenCalledTimes(1)
    expect(controllerUnsubscribe).toHaveBeenCalledTimes(1)
    expect(controllerClose).not.toHaveBeenCalled()
    expect(retainedRuntime?.releaseLease).not.toHaveBeenCalled()
    expect(repositories[0]?.close).not.toHaveBeenCalled()

    await act(async () => {
      controllerFlushGate.resolve()
      await controllerFlushGate.promise
    })
    await vi.waitFor(() => {
      expect(controllerClose).toHaveBeenCalledTimes(1)
      expect(retainedRuntime?.releaseLease).toHaveBeenCalledTimes(1)
      expect(repositories[0]?.close).toHaveBeenCalledTimes(1)
    })

    expect(controllerFlush).toHaveBeenCalledTimes(1)
    expect(controllerUnsubscribe).toHaveBeenCalledTimes(1)
    expect(controllerSubscribe).toHaveBeenCalledTimes(1)
    expect(controllers.size).toBe(1)
    expect(retainedRuntime?.acquireLease).toHaveBeenCalledTimes(1)
  })
})
