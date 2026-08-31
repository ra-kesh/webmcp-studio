// @vitest-environment jsdom

import { StrictMode, act } from "react"
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
import { libraryCatalogPageSchema } from "@webmcp/document"
import type {
  LibraryCatalogQuery,
  LibraryPreferenceSnapshot,
} from "@webmcp/document"
import type { DeviceLocalMediaDiscoveryAdapter } from "./device-local-media-discovery-adapter"
import { LibraryDiscoveryController } from "./discovery-controller"
import {
  LibraryDiscoveryProvider,
  useLibraryDiscoveryCommands,
  useLibraryDiscoveryLease,
} from "./library-discovery-provider"
import {
  LibraryMediaDiscoveryProvider,
  useLibraryMediaDiscoveryLease,
} from "./library-media-discovery-provider"
import type { LibraryPreferenceClient } from "./library-preference-client"
import { LibraryPreferenceController } from "./library-preference-controller"
import {
  LibraryPreferenceProvider,
  useLibraryDiscoveryInvalidation,
} from "./library-preference-provider"

const snapshot = (workspaceRevision: number): LibraryPreferenceSnapshot => ({
  workspaceRevision,
  preferences: [],
  collections: [],
})

const preferenceClient = (
  readSnapshot: LibraryPreferenceClient["readSnapshot"]
): LibraryPreferenceClient => ({
  readSnapshot,
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  setFavorite: vi.fn(),
  recordUsed: vi.fn(),
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addCollectionMember: vi.fn(),
  removeCollectionMember: vi.fn(),
  reorderCollectionMembers: vi.fn(),
})

const response = (workspaceRevision: number) => ({
  value: snapshot(workspaceRevision),
  requestId: `request-media-provider-${workspaceRevision}`,
  etag: `"library-workspace-revision-${workspaceRevision}"`,
})

const listResult = (query: LibraryCatalogQuery) => ({
  workspaceRevision: 1,
  page: libraryCatalogPageSchema.parse({
    schemaVersion: 1,
    catalogRevision: "media-provider-test-v1",
    generation: query.generation,
    queryIdentity: `libq_${"c".repeat(16)}`,
    items: [],
    nextCursor: null,
    total: 0,
  }),
})

const localAdapter: DeviceLocalMediaDiscoveryAdapter = {
  list: vi.fn(async () => ({
    items: [],
    status: {
      schemaVersion: 1 as const,
      databaseVersion: 6,
      migrationState: "current" as const,
      legacyRecordCount: 0,
      legacyMetadataRecordCount: 0,
      metadataRecordCount: 0,
      examinedMetadataCount: 0,
      unindexedMetadataCount: 0,
      projectedItemCount: 0,
      archivedRecordCount: 0,
      unavailableRecordCount: 0,
      truncated: false,
      issues: [],
    },
  })),
  getDetail: vi.fn(),
  recheckSelection: vi.fn(),
}

function TemplateLeaseAndInvalidation() {
  useLibraryDiscoveryLease(true)
  const { refresh } = useLibraryDiscoveryCommands()
  useLibraryDiscoveryInvalidation(() => {
    void refresh()
  })
  return null
}

function MediaLease() {
  useLibraryMediaDiscoveryLease(true)
  return null
}

function ConditionalMediaLease({ visible }: { visible: boolean }) {
  useLibraryMediaDiscoveryLease(visible)
  return null
}

class ManualFinalizationScheduler {
  readonly callbacks: Array<() => void> = []

  schedule = (callback: () => void) => {
    this.callbacks.push(callback)
  }

  flush() {
    while (this.callbacks.length > 0) this.callbacks.shift()?.()
  }
}

describe("LibraryMediaDiscoveryProvider", () => {
  let host: HTMLDivElement
  let root: Root
  let rootUnmounted: boolean

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    rootUnmounted = false
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it("shares preference invalidation while keeping template and media controllers independent", async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(response(1))
      .mockResolvedValueOnce(response(2))
    let preferenceController: LibraryPreferenceController | null = null
    const templateList = vi.fn(async (query) =>
      listResult(query as LibraryCatalogQuery)
    )
    const mediaList = vi.fn(async (query) =>
      listResult(query as LibraryCatalogQuery)
    )

    await act(async () =>
      root.render(
        <LibraryPreferenceProvider
          createController={(dependencies) => {
            preferenceController = new LibraryPreferenceController({
              ...dependencies,
              client: preferenceClient(readSnapshot),
            })
            return preferenceController
          }}
          sessionId="session-media-provider"
        >
          <LibraryDiscoveryProvider
            createController={(dependencies) => {
              const controller = new LibraryDiscoveryController({
                ...dependencies,
                list: templateList,
              })
              controller.setFilters({ itemKinds: ["template"] })
              return controller
            }}
          >
            <TemplateLeaseAndInvalidation />
          </LibraryDiscoveryProvider>
          <LibraryMediaDiscoveryProvider
            createController={(dependencies) => {
              const controller = new LibraryDiscoveryController({
                ...dependencies,
                list: mediaList,
              })
              return controller
            }}
            localAdapter={localAdapter}
          >
            <MediaLease />
          </LibraryMediaDiscoveryProvider>
        </LibraryPreferenceProvider>
      )
    )

    await vi.waitFor(() => {
      expect(templateList.mock.calls.length).toBeGreaterThan(0)
      expect(mediaList.mock.calls.length).toBeGreaterThan(0)
    })
    expect(
      templateList.mock.calls.every(
        ([query]) =>
          query.itemKinds.length === 1 && query.itemKinds[0] === "template"
      )
    ).toBe(true)
    expect(
      mediaList.mock.calls.every(
        ([query]) =>
          query.itemKinds.length === 1 && query.itemKinds[0] === "media"
      )
    ).toBe(true)
    const templateBaseline = templateList.mock.calls.length
    const mediaBaseline = mediaList.mock.calls.length

    await act(async () => {
      await preferenceController?.refresh()
    })
    await vi.waitFor(() => {
      expect(templateList).toHaveBeenCalledTimes(templateBaseline + 1)
      expect(mediaList).toHaveBeenCalledTimes(mediaBaseline + 1)
    })
  })

  it("retains one media owner through StrictMode and finalizes release and disposal once", async () => {
    const readSnapshot = vi.fn().mockResolvedValue(response(1))
    const finalization = new ManualFinalizationScheduler()
    const controllers: Array<{
      controller: LibraryDiscoveryController
      activate: ReturnType<typeof vi.spyOn>
      deactivate: ReturnType<typeof vi.spyOn>
      dispose: ReturnType<typeof vi.spyOn>
    }> = []
    const render = (visible: boolean) =>
      root.render(
        <StrictMode>
          <LibraryPreferenceProvider
            createController={(dependencies) =>
              new LibraryPreferenceController({
                ...dependencies,
                client: preferenceClient(readSnapshot),
              })
            }
            sessionId="session-media-strict"
          >
            <LibraryMediaDiscoveryProvider
              createController={(dependencies) => {
                const controller = new LibraryDiscoveryController({
                  ...dependencies,
                  list: vi.fn(async (query) =>
                    listResult(query as LibraryCatalogQuery)
                  ),
                })
                controllers.push({
                  controller,
                  activate: vi.spyOn(controller, "activate"),
                  deactivate: vi.spyOn(controller, "deactivate"),
                  dispose: vi.spyOn(controller, "dispose"),
                })
                return controller
              }}
              localAdapter={localAdapter}
              scheduleFinalization={finalization.schedule}
            >
              <ConditionalMediaLease visible={visible} />
            </LibraryMediaDiscoveryProvider>
          </LibraryPreferenceProvider>
        </StrictMode>
      )

    await act(async () => render(true))
    await act(async () => finalization.flush())
    const active = controllers.filter(
      ({ activate }) => activate.mock.calls.length > 0
    )
    expect(active).toHaveLength(1)
    expect(active[0]?.controller.getSnapshot().filters.itemKinds).toEqual([
      "media",
    ])
    expect(active[0]?.activate).toHaveBeenCalledTimes(1)
    expect(active[0]?.deactivate).not.toHaveBeenCalled()

    await act(async () => render(false))
    expect(active[0]?.deactivate).not.toHaveBeenCalled()
    await act(async () => finalization.flush())
    expect(active[0]?.deactivate).toHaveBeenCalledTimes(1)

    await act(async () => render(true))
    expect(active[0]?.activate).toHaveBeenCalledTimes(2)

    await act(async () => {
      root.unmount()
      rootUnmounted = true
    })
    expect(active[0]?.dispose).not.toHaveBeenCalled()
    await act(async () => finalization.flush())
    expect(active[0]?.dispose).toHaveBeenCalledTimes(1)
  })
})
