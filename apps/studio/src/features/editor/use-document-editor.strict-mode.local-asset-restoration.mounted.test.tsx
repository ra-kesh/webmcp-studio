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
import type { Document } from "@webmcp/document"
import { DocumentDraftRepository } from "./document-draft-repository"
import type { DocumentDraftRecord } from "./document-draft-repository"
import { loadLocalAsset } from "./local-asset-store"
import { quotationStarter } from "./quotation-starter"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import { useDocumentEditor } from "./use-document-editor"

vi.mock("./local-asset-store", { spy: true })

type Editor = ReturnType<typeof useDocumentEditor>

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function localAssetDocument(...assetIds: string[]): Document {
  const document = structuredClone(quotationStarter.document)
  const firstPage = document.pages[0]
  for (const [index, assetId] of assetIds.entries()) {
    const nodeId = `strict-local-image-${index + 1}`
    document.nodes.push({
      id: nodeId,
      type: "image",
      name: `Strict local image ${index + 1}`,
      assetId,
      src: `asset:local/${assetId}`,
      alt: `Local image ${index + 1}`,
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      decorative: false,
      x: 20 + index * 40,
      y: 20 + index * 40,
      width: 200,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    })
    firstPage.nodeIds.push(nodeId)
  }
  return document
}

function localPreviewSource(editor: Editor, assetId: string) {
  const canonicalSource = `asset:local/${assetId}`
  const canonicalNode = editor.document.nodes.find(
    (node) => node.type === "image" && node.src === canonicalSource
  )
  if (!canonicalNode) throw new Error(`Missing canonical asset ${assetId}`)
  const previewNode = editor.previewDocument.nodes.find(
    (node) => node.id === canonicalNode.id
  )
  if (!previewNode || previewNode.type !== "image") {
    throw new Error(`Missing preview asset ${assetId}`)
  }
  return previewNode.src
}

function MountedEditor({
  capture,
  initialRecord,
}: {
  capture: (editor: Editor) => void
  initialRecord: DocumentDraftRecord
}) {
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({ initialRecord, persistence })
  useLayoutEffect(() => capture(editor), [capture, editor])
  return null
}

describe.sequential(
  "useDocumentEditor StrictMode local asset restoration",
  () => {
    let host: HTMLDivElement
    let root: Root
    let rootUnmounted: boolean
    let repositorySequence = 0

    beforeAll(() => {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto,
      })
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    })

    beforeEach(() => {
      host = document.createElement("div")
      document.body.appendChild(host)
      root = createRoot(host)
      rootUnmounted = false
      vi.mocked(loadLocalAsset).mockReset()
    })

    afterEach(async () => {
      if (!rootUnmounted) await act(async () => root.unmount())
      host.remove()
      vi.restoreAllMocks()
    })

    async function mountWithAssets(...assetIds: string[]) {
      repositorySequence += 1
      const repository = new DocumentDraftRepository({
        databaseName: `webmcp-studio-strict-assets-${repositorySequence}`,
        indexedDB: globalThis.indexedDB,
        sessionId: `strict-assets-${repositorySequence}`,
      })
      const created = await repository.create(
        {
          document: localAssetDocument(...assetIds),
          sourceContext: null,
        },
        { kind: "current-draft-migration" }
      )
      if (!created.ok) throw new Error("Expected a local asset draft fixture")
      const captured: { current: Editor | null } = { current: null }

      await act(async () => {
        root.render(
          <StrictMode>
            <StudioPersistenceTestWrapper createRepository={() => repository}>
              <MountedEditor
                capture={(editor) => {
                  captured.current = editor
                }}
                initialRecord={created.record}
              />
            </StudioPersistenceTestWrapper>
          </StrictMode>
        )
      })
      await vi.waitFor(() => {
        expect(captured.current?.routeSessionStatus).toBe("ready")
      })
      return captured
    }

    it("restores the pending local asset after the setup-cleanup-setup replay", async () => {
      const pending = deferred<Blob | null>()
      vi.mocked(loadLocalAsset).mockReturnValue(pending.promise)
      const createObjectURL = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:strict-restored")
      const revokeObjectURL = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => undefined)

      const captured = await mountWithAssets("strict-asset-a")
      expect(loadLocalAsset).toHaveBeenCalledTimes(1)

      await act(async () => {
        pending.resolve(new Blob(["asset-a"], { type: "image/png" }))
        await pending.promise
      })
      await vi.waitFor(() => {
        expect(localPreviewSource(captured.current!, "strict-asset-a")).toBe(
          "blob:strict-restored"
        )
      })

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:strict-restored")

      await act(async () => root.unmount())
      rootUnmounted = true
      expect(revokeObjectURL).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:strict-restored")
    })

    it("reports a missing local asset after the setup-cleanup-setup replay", async () => {
      const pending = deferred<Blob | null>()
      vi.mocked(loadLocalAsset).mockReturnValue(pending.promise)

      const captured = await mountWithAssets("strict-asset-missing")
      expect(loadLocalAsset).toHaveBeenCalledTimes(1)

      await act(async () => {
        pending.resolve(null)
        await pending.promise
      })
      await vi.waitFor(() => {
        expect(captured.current?.assetError).toBe(
          "A saved image is missing on this device."
        )
      })

      expect(loadLocalAsset).toHaveBeenCalledTimes(1)
    })

    it("reports a rejected local asset load after the setup-cleanup-setup replay", async () => {
      const pending = deferred<Blob | null>()
      vi.mocked(loadLocalAsset).mockReturnValue(pending.promise)

      const captured = await mountWithAssets("strict-asset-rejected")
      expect(loadLocalAsset).toHaveBeenCalledTimes(1)

      await act(async () => {
        pending.reject(new Error("IndexedDB read failed"))
        await expect(pending.promise).rejects.toThrow("IndexedDB read failed")
      })
      await vi.waitFor(() => {
        expect(captured.current?.assetError).toBe(
          "A saved image could not be restored on this device."
        )
      })

      expect(loadLocalAsset).toHaveBeenCalledTimes(1)
    })

    it("ignores a pending local asset after the final unmount", async () => {
      const pending = deferred<Blob | null>()
      vi.mocked(loadLocalAsset).mockReturnValue(pending.promise)
      const createObjectURL = vi.spyOn(URL, "createObjectURL")

      const captured = await mountWithAssets("strict-asset-unmounted")
      const editorBeforeUnmount = captured.current
      expect(loadLocalAsset).toHaveBeenCalledTimes(1)

      await act(async () => root.unmount())
      rootUnmounted = true
      await act(async () => {
        pending.resolve(new Blob(["late-asset"], { type: "image/png" }))
        await pending.promise
      })

      expect(captured.current).toBe(editorBeforeUnmount)
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(loadLocalAsset).toHaveBeenCalledTimes(1)
    })
  }
)
