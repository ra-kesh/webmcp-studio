// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import { act, useLayoutEffect } from "react"
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
import {
  projectCuratedMediaDetail,
  projectLocalMediaDetail,
} from "@webmcp/document"
import type { LocalLibraryMediaMetadata } from "@webmcp/document"
import { studioMediaManifest } from "../../content/library/media/manifest"
import type { ExactDeviceLocalMediaSelection } from "../../content/library/device-local-media-discovery-adapter"
import type { VerifiedCuratedMediaContent } from "../../content/library/media/curated-media-content"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import type { StudioPersistenceApi } from "../persistence/studio-persistence-provider"
import type {
  ExactServerLibraryMediaIdentity,
  LibraryMediaActionPreparationPorts,
} from "./library-media-action-preparation"
import type { LocalAssetRecord } from "./local-asset-store"
import { useDocumentEditor } from "./use-document-editor"

type Editor = ReturnType<typeof useDocumentEditor>

const item = studioMediaManifest[0]
const localMetadata: LocalLibraryMediaMetadata = {
  description: "Device-local mounted test image",
  categoryId: "workspace-upload",
  useCaseIds: ["proposal"],
  formatFamily: "raster",
  tags: ["proposal"],
  permissions: {
    canView: true,
    canUse: true,
    canFavorite: false,
    canAddToCollection: false,
  },
  provenance: {
    sourceName: "Device-local upload",
    sourceUrl: null,
    license: {
      id: "customer-provided",
      name: "Customer-provided; rights not verified",
      url: null,
    },
    attribution: { required: false, text: null },
    contentSha256: null,
  },
}

const detail = () =>
  projectCuratedMediaDetail(item, {
    curatedRank: 0,
    preferences: { favorite: false, lastUsedAt: null, collectionIds: [] },
  })

const content = (): VerifiedCuratedMediaContent => ({
  identity: {
    assetId: item.id,
    version: item.version,
    contentSha256: item.contentSha256,
  },
  item,
  canonicalSource: item.resourcePath,
  bytes: new Uint8Array(item.bytes),
  src: `data:${item.mimeType};base64,verified-preview`,
})

const localSelection = (): ExactDeviceLocalMediaSelection => {
  const now = "2026-08-31T00:00:00.000Z"
  const record: LocalAssetRecord = {
    schemaVersion: 4,
    id: "local-mounted-image",
    name: "Local mounted.png",
    mediaType: "image/png",
    size: 4,
    width: 1_200,
    height: 800,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    archivedAt: null,
    revision: 1,
    integrity: "ready",
    blob: new Blob([new Uint8Array(4)], { type: "image/png" }),
  }
  return {
    detail: projectLocalMediaDetail(record, localMetadata),
    record,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function mutablePreparationPorts() {
  let current: LibraryMediaActionPreparationPorts | null = null
  const required = () => {
    if (!current) throw new Error("Install exact media preparation ports.")
    return current
  }
  return {
    ports: {
      getExactDetail: (...args) => required().getExactDetail(...args),
      resolveCurated: (...args) => required().resolveCurated(...args),
      getManagedRecord: (...args) => required().getManagedRecord(...args),
      verifyManagedResource: (...args) =>
        required().verifyManagedResource(...args),
      recheckLocal: (...args) => required().recheckLocal(...args),
    } satisfies LibraryMediaActionPreparationPorts,
    install: (next: LibraryMediaActionPreparationPorts) => {
      current = next
    },
  }
}

function MountedEditor({
  capture,
  events,
  preparationPorts,
}: {
  capture: (editor: Editor, persistence: StudioPersistenceApi) => void
  events: string[]
  preparationPorts: LibraryMediaActionPreparationPorts
}) {
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({
    persistence,
    onHistoryCommit: () => events.push("commit"),
    libraryMediaPreparationPorts: preparationPorts,
  })
  useLayoutEffect(
    () => capture(editor, persistence),
    [capture, editor, persistence]
  )
  return null
}

describe("useDocumentEditor exact library media action", () => {
  let host: HTMLDivElement
  let root: Root

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
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  async function mount(events: string[] = []) {
    const preparation = mutablePreparationPorts()
    const captured: {
      editor: Editor | null
      persistence: StudioPersistenceApi | null
      setPreparationPorts: (next: LibraryMediaActionPreparationPorts) => void
    } = {
      editor: null,
      persistence: null,
      setPreparationPorts: preparation.install,
    }
    await act(async () => {
      root.render(
        <StudioPersistenceTestWrapper
          migrate={async () => ({
            status: "repository_unavailable",
            failure: {
              kind: "storage_unavailable",
              message: "Storage is unavailable in this mounted test.",
            },
          })}
        >
          <MountedEditor
            events={events}
            preparationPorts={preparation.ports}
            capture={(editor, persistence) => {
              captured.editor = editor
              captured.persistence = persistence
            }}
          />
        </StudioPersistenceTestWrapper>
      )
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(captured.persistence?.state.status).toBe("unavailable")
      )
      await captured.editor?.createBlankDocument({
        name: "Media action test",
        width: 1_200,
        height: 800,
      })
    })
    events.length = 0
    return captured
  }

  it("owns preparation with one mutex and aborts without mutation or usage", async () => {
    const captured = await mount()
    const exactDetail = detail()
    const detailGate = deferred<typeof exactDetail>()
    const getExactDetail = vi.fn(
      async (
        _identity: ExactServerLibraryMediaIdentity,
        signal: AbortSignal
      ) => {
        return new Promise<typeof exactDetail>((resolve, reject) => {
          const abort = () =>
            reject(new DOMException("The operation was aborted", "AbortError"))
          signal.addEventListener("abort", abort, { once: true })
          void detailGate.promise.then((value) => {
            signal.removeEventListener("abort", abort)
            resolve(value)
          })
        })
      }
    )
    const ports: LibraryMediaActionPreparationPorts = {
      getExactDetail,
      resolveCurated: vi.fn(async () => content()),
      getManagedRecord: vi.fn(async () => null),
      verifyManagedResource: vi.fn(async () => {
        throw new Error("Managed media is outside this test")
      }),
      recheckLocal: vi.fn(async () => {
        throw new Error("Local media is outside this test")
      }),
    }
    captured.setPreparationPorts(ports)
    const pageId = captured.editor!.activePageId
    const beforeNodeIds = captured.editor!.document.pages[0].nodeIds
    const recordUsed = vi.fn(async () => true)
    const controller = new AbortController()
    let first!: Promise<"committed" | "no_op" | "rejected">

    await act(async () => {
      first = captured.editor!.performLibraryMediaAction(
        {
          correlationId: "media-action-mounted-1",
          detail: exactDetail,
          target: { type: "insert", pageId },
        },
        { signal: controller.signal, recordUsed }
      )
      await vi.waitFor(() => expect(getExactDetail).toHaveBeenCalledOnce())
    })

    await expect(
      captured.editor!.performLibraryMediaAction(
        {
          correlationId: "media-action-mounted-2",
          detail: exactDetail,
          target: { type: "insert", pageId },
        },
        { recordUsed }
      )
    ).resolves.toBe("rejected")
    expect(getExactDetail).toHaveBeenCalledOnce()
    expect(captured.editor!.document.pages[0].nodeIds).toEqual(beforeNodeIds)
    expect(recordUsed).not.toHaveBeenCalled()

    await act(async () => {
      controller.abort()
      await expect(first).resolves.toBe("rejected")
    })

    expect(captured.editor!.document.pages[0].nodeIds).toEqual(beforeNodeIds)
    expect(recordUsed).not.toHaveBeenCalled()
    expect(captured.editor!.isImportingAsset).toBe(false)
  })

  it("rejects a prepared insert when its target changes before anchor capture", async () => {
    const captured = await mount()
    const exactDetail = detail()
    const detailGate = deferred<typeof exactDetail>()
    const getExactDetail = vi.fn(async () => detailGate.promise)
    const ports: LibraryMediaActionPreparationPorts = {
      getExactDetail,
      resolveCurated: vi.fn(async () => content()),
      getManagedRecord: vi.fn(async () => null),
      verifyManagedResource: vi.fn(async () => {
        throw new Error("Managed media is outside this test")
      }),
      recheckLocal: vi.fn(async () => {
        throw new Error("Local media is outside this test")
      }),
    }
    captured.setPreparationPorts(ports)
    const targetPageId = captured.editor!.activePageId
    const initialNodeCount = captured.editor!.document.nodes.length
    const recordUsed = vi.fn(async () => true)
    let action!: Promise<"committed" | "no_op" | "rejected">

    await act(async () => {
      action = captured.editor!.performLibraryMediaAction(
        {
          correlationId: "media-action-target-change-1",
          detail: exactDetail,
          target: { type: "insert", pageId: targetPageId },
        },
        { recordUsed }
      )
      await vi.waitFor(() => expect(getExactDetail).toHaveBeenCalledOnce())
      captured.editor!.addPage(captured.editor!.document.outputs[0].id)
    })
    expect(captured.editor!.activePageId).not.toBe(targetPageId)

    await act(async () => {
      detailGate.resolve(exactDetail)
      await expect(action).resolves.toBe("rejected")
    })

    expect(captured.editor!.document.nodes).toHaveLength(initialNodeCount)
    expect(recordUsed).not.toHaveBeenCalled()
    expect(captured.editor!.isImportingAsset).toBe(false)
  })

  it("emits usage only after the single document command commits", async () => {
    const events: string[] = []
    const captured = await mount(events)
    const exactDetail = detail()
    const ports: LibraryMediaActionPreparationPorts = {
      getExactDetail: vi.fn(async () => exactDetail),
      resolveCurated: vi.fn(async () => content()),
      getManagedRecord: vi.fn(async () => null),
      verifyManagedResource: vi.fn(async () => {
        throw new Error("Managed media is outside this test")
      }),
      recheckLocal: vi.fn(async () => {
        throw new Error("Local media is outside this test")
      }),
    }
    captured.setPreparationPorts(ports)
    const recordUsed = vi.fn(async () => {
      events.push("usage")
      return true
    })
    const pageId = captured.editor!.activePageId

    await act(async () => {
      await expect(
        captured.editor!.performLibraryMediaAction(
          {
            correlationId: "media-action-success-1",
            detail: exactDetail,
            target: { type: "insert", pageId },
          },
          { recordUsed }
        )
      ).resolves.toBe("committed")
    })

    expect(events).toEqual(["commit", "usage"])
    expect(
      captured.editor!.document.nodes.some(
        (node) => node.type === "image" && node.assetId === item.id
      )
    ).toBe(true)
    expect(captured.editor!.documentUndoEntry?.label).toBe("Add image")
  })

  it("aborts old-document preparation and releases its mutex for the new document", async () => {
    const captured = await mount()
    const exactDetail = detail()
    const getExactDetail = vi.fn(
      async (_identity: ExactServerLibraryMediaIdentity, signal: AbortSignal) =>
        new Promise<typeof exactDetail>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted", "AbortError")
              ),
            { once: true }
          )
        })
    )
    const pendingPorts: LibraryMediaActionPreparationPorts = {
      getExactDetail,
      resolveCurated: vi.fn(async () => content()),
      getManagedRecord: vi.fn(async () => null),
      verifyManagedResource: vi.fn(async () => {
        throw new Error("Managed media is outside this test")
      }),
      recheckLocal: vi.fn(async () => {
        throw new Error("Local media is outside this test")
      }),
    }
    captured.setPreparationPorts(pendingPorts)
    const oldPageId = captured.editor!.activePageId
    let oldAction!: Promise<"committed" | "no_op" | "rejected">

    await act(async () => {
      oldAction = captured.editor!.performLibraryMediaAction({
        correlationId: "old-document-preparation",
        detail: exactDetail,
        target: { type: "insert", pageId: oldPageId },
      })
      await vi.waitFor(() => expect(getExactDetail).toHaveBeenCalledOnce())
      await captured.editor!.createBlankDocument({
        name: "Replacement document",
        width: 900,
        height: 600,
      })
      await expect(oldAction).resolves.toBe("rejected")
    })

    const nextPorts: LibraryMediaActionPreparationPorts = {
      ...pendingPorts,
      getExactDetail: vi.fn(async () => exactDetail),
    }
    captured.setPreparationPorts(nextPorts)
    await act(async () => {
      await expect(
        captured.editor!.performLibraryMediaAction(
          {
            correlationId: "new-document-action",
            detail: exactDetail,
            target: {
              type: "insert",
              pageId: captured.editor!.activePageId,
            },
          },
          { recordUsed: vi.fn(async () => true) }
        )
      ).resolves.toBe("committed")
    })
    expect(captured.editor!.document.name).toBe("Replacement document")
    expect(captured.editor!.isImportingAsset).toBe(false)
  })

  it("releases the edit mutex before post-commit receipts settle", async () => {
    const events: string[] = []
    const captured = await mount(events)
    const exactDetail = detail()
    const ports: LibraryMediaActionPreparationPorts = {
      getExactDetail: vi.fn(async () => exactDetail),
      resolveCurated: vi.fn(async () => content()),
      getManagedRecord: vi.fn(async () => null),
      verifyManagedResource: vi.fn(async () => {
        throw new Error("Managed media is outside this test")
      }),
      recheckLocal: vi.fn(async () => {
        throw new Error("Local media is outside this test")
      }),
    }
    captured.setPreparationPorts(ports)
    const firstReceipt = deferred<boolean>()
    const recordUsed = vi
      .fn()
      .mockImplementationOnce(async () => firstReceipt.promise)
      .mockResolvedValue(true)
    let firstAction!: Promise<"committed" | "no_op" | "rejected">

    await act(async () => {
      firstAction = captured.editor!.performLibraryMediaAction(
        {
          correlationId: "receipt-pending-first",
          detail: exactDetail,
          target: {
            type: "insert",
            pageId: captured.editor!.activePageId,
          },
        },
        { recordUsed }
      )
      await vi.waitFor(() => expect(recordUsed).toHaveBeenCalledOnce())
    })

    await act(async () => {
      await expect(
        captured.editor!.performLibraryMediaAction(
          {
            correlationId: "receipt-pending-second",
            detail: exactDetail,
            target: {
              type: "insert",
              pageId: captured.editor!.activePageId,
            },
          },
          { recordUsed }
        )
      ).resolves.toBe("committed")
    })
    expect(recordUsed).toHaveBeenCalledTimes(2)
    firstReceipt.resolve(true)
    await expect(firstAction).resolves.toBe("committed")
    expect(events.filter((event) => event === "commit")).toHaveLength(2)
  })

  it("returns a no-op without history or usage for the same asset field value", async () => {
    const events: string[] = []
    const captured = await mount(events)
    await act(async () => {
      captured.editor!.createField({
        key: "hero_image",
        label: "Hero image",
        type: "asset",
        required: false,
        defaultValue: "",
        agentDescription: "",
        validation: {},
      })
    })
    const fieldId = captured.editor!.document.fields.at(-1)!.id
    const exactDetail = detail()
    const ports: LibraryMediaActionPreparationPorts = {
      getExactDetail: vi.fn(async () => exactDetail),
      resolveCurated: vi.fn(async () => content()),
      getManagedRecord: vi.fn(async () => null),
      verifyManagedResource: vi.fn(async () => {
        throw new Error("Managed media is outside this test")
      }),
      recheckLocal: vi.fn(async () => {
        throw new Error("Local media is outside this test")
      }),
    }
    captured.setPreparationPorts(ports)
    const recordUsed = vi.fn(async () => true)
    const request = {
      correlationId: "field-assignment-first",
      detail: exactDetail,
      target: { type: "assign_field" as const, fieldId },
    }
    await act(async () => {
      await expect(
        captured.editor!.performLibraryMediaAction(request, {
          recordUsed,
        })
      ).resolves.toBe("committed")
    })
    events.length = 0
    recordUsed.mockClear()

    await act(async () => {
      await expect(
        captured.editor!.performLibraryMediaAction(
          { ...request, correlationId: "field-assignment-no-op" },
          { recordUsed }
        )
      ).resolves.toBe("no_op")
    })
    expect(events).toEqual([])
    expect(recordUsed).not.toHaveBeenCalled()
  })

  it("keeps a committed local edit successful when preview installation fails", async () => {
    const events: string[] = []
    const captured = await mount(events)
    const selection = localSelection()
    const ports: LibraryMediaActionPreparationPorts = {
      getExactDetail: vi.fn(async () => selection.detail),
      resolveCurated: vi.fn(async () => content()),
      getManagedRecord: vi.fn(async () => null),
      verifyManagedResource: vi.fn(async () => {
        throw new Error("Managed media is outside this test")
      }),
      recheckLocal: vi.fn(async () => localSelection()),
    }
    captured.setPreparationPorts(ports)
    const previewFailure = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => {
        throw new Error("Object URL unavailable")
      })
    const warnings: Array<{
      key: string
      retry: () => Promise<boolean>
    }> = []

    await act(async () => {
      await expect(
        captured.editor!.performLibraryMediaAction(
          {
            correlationId: "local-preview-failure",
            detail: selection.detail,
            target: {
              type: "insert",
              pageId: captured.editor!.activePageId,
            },
          },
          { onUsageWarning: (warning) => warnings.push(warning) }
        )
      ).resolves.toBe("committed")
    })

    expect(events.filter((event) => event === "commit")).toHaveLength(1)
    expect(
      captured.editor!.document.nodes.some(
        (node) => node.type === "image" && node.assetId === selection.record.id
      )
    ).toBe(true)
    expect(warnings.map((warning) => warning.key)).toEqual(
      expect.arrayContaining(["local_preview", "local_mark_used"])
    )

    previewFailure.mockRestore()
    const previewWarning = warnings.find(
      (warning) => warning.key === "local_preview"
    )!
    await expect(previewWarning.retry()).resolves.toBe(true)
    expect(events.filter((event) => event === "commit")).toHaveLength(1)
  })
})
