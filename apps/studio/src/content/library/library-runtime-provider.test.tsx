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
import type { LibraryPreferenceSnapshot } from "@webmcp/document"
import { studioLibraryCatalogIndex } from "./catalog"
import type { DeviceLocalMediaDiscoveryAdapter } from "./device-local-media-discovery-adapter"
import { LibraryDiscoveryController } from "./discovery-controller"
import {
  useLibraryDiscovery,
  useLibraryDiscoveryLease,
} from "./library-discovery-provider"
import type { LibraryDiscoveryControllerFactory } from "./library-discovery-provider"
import {
  useLibraryMediaDiscovery,
  useLibraryMediaDiscoveryLease,
} from "./library-media-discovery-provider"
import type { LibraryMediaDiscoveryControllerFactory } from "./library-media-discovery-provider"
import type { LibraryPreferenceClient } from "./library-preference-client"
import { LibraryPreferenceController } from "./library-preference-controller"
import type { LibraryPreferenceControllerFactory } from "./library-preference-provider"
import { LibraryRuntimeProvider } from "./library-runtime-provider"

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

const snapshotResponse = (workspaceRevision: number) => ({
  value: snapshot(workspaceRevision),
  requestId: `request-library-${workspaceRevision}`,
  etag: `"library-workspace-revision-${workspaceRevision}"`,
})

const deferred = <TValue,>() => {
  let resolve!: (value: TValue) => void
  const promise = new Promise<TValue>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const discoveryList = () =>
  vi.fn(async (query) => ({
    workspaceRevision: 1,
    page: studioLibraryCatalogIndex.list(query),
  }))

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

function DiscoveryLeaseProbe({ onMount }: { onMount: () => void }) {
  useLibraryDiscoveryLease(true)
  onMount()
  return null
}

function ProductionDiscoveryOwnersProbe() {
  const template = useLibraryDiscovery()
  const media = useLibraryMediaDiscovery()
  useLibraryDiscoveryLease(true)
  useLibraryMediaDiscoveryLease(true)
  return (
    <output
      data-media-kinds={media.state.filters.itemKinds.join(",")}
      data-template-kinds={template.state.filters.itemKinds.join(",")}
    />
  )
}

describe("LibraryRuntimeProvider", () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
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

  it("settles the first preference read before a StrictMode discovery lease can list", async () => {
    const first = deferred<ReturnType<typeof snapshotResponse>>()
    const readSnapshot = vi.fn(() => first.promise)
    const list = discoveryList()
    const preferenceFactory: LibraryPreferenceControllerFactory = (
      dependencies
    ) =>
      new LibraryPreferenceController({
        ...dependencies,
        client: preferenceClient(readSnapshot),
      })
    const discoveryFactory: LibraryDiscoveryControllerFactory = (
      dependencies
    ) => new LibraryDiscoveryController({ ...dependencies, list })
    const onMount = vi.fn()

    await act(async () =>
      root.render(
        <StrictMode>
          <LibraryRuntimeProvider
            preferences={{
              createController: preferenceFactory,
              sessionId: "session-runtime-bootstrap",
            }}
            discovery={{ createController: discoveryFactory }}
          >
            <DiscoveryLeaseProbe onMount={onMount} />
          </LibraryRuntimeProvider>
        </StrictMode>
      )
    )

    expect(readSnapshot).toHaveBeenCalledTimes(1)
    expect(list).not.toHaveBeenCalled()
    expect(onMount).not.toHaveBeenCalled()

    await act(async () => {
      first.resolve(snapshotResponse(1))
      await first.promise
    })

    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(onMount).toHaveBeenCalled()
  })

  it("releases discovery after an initial preference failure", async () => {
    const retry = deferred<ReturnType<typeof snapshotResponse>>()
    const readSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("preferences unavailable"))
      .mockImplementationOnce(() => retry.promise)
    const list = discoveryList()
    let preferenceController: LibraryPreferenceController | null = null
    const discoveryControllers: LibraryDiscoveryController[] = []
    const preferenceFactory: LibraryPreferenceControllerFactory = (
      dependencies
    ) => {
      preferenceController = new LibraryPreferenceController({
        ...dependencies,
        client: preferenceClient(readSnapshot),
      })
      return preferenceController
    }
    const discoveryFactory: LibraryDiscoveryControllerFactory = (
      dependencies
    ) => {
      const controller = new LibraryDiscoveryController({
        ...dependencies,
        list,
      })
      discoveryControllers.push(controller)
      return controller
    }

    await act(async () =>
      root.render(
        <LibraryRuntimeProvider
          preferences={{
            createController: preferenceFactory,
            sessionId: "session-runtime-failure",
          }}
          discovery={{ createController: discoveryFactory }}
        >
          <DiscoveryLeaseProbe onMount={() => undefined} />
        </LibraryRuntimeProvider>
      )
    )

    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(readSnapshot).toHaveBeenCalledTimes(1)
    expect(discoveryControllers).toHaveLength(1)

    await act(async () => {
      void preferenceController?.refresh()
    })
    expect(readSnapshot).toHaveBeenCalledTimes(2)
    expect(discoveryControllers).toHaveLength(1)

    await act(async () => {
      retry.resolve(snapshotResponse(1))
      await retry.promise
    })
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(discoveryControllers).toHaveLength(1)
  })

  it("shows a route fallback and unblocks discovery when the first preference fetch stalls", async () => {
    const request = { signal: null as AbortSignal | null }
    const fetchRequest = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        request.signal = init?.signal ?? null
        return new Promise<Response>(() => undefined)
      }
    )
    const list = discoveryList()
    const discoveryFactory: LibraryDiscoveryControllerFactory = (
      dependencies
    ) => new LibraryDiscoveryController({ ...dependencies, list })

    await act(async () =>
      root.render(
        <LibraryRuntimeProvider
          bootstrapTimeoutMs={10}
          preferences={{
            fetchRequest,
            sessionId: "session-runtime-timeout",
          }}
          discovery={{ createController: discoveryFactory }}
        >
          <DiscoveryLeaseProbe onMount={() => undefined} />
          <span>Templates ready</span>
        </LibraryRuntimeProvider>
      )
    )

    expect(host.textContent).toContain("Opening your Studio library…")
    expect(host.querySelector('[role="status"]')).not.toBeNull()
    expect(list).not.toHaveBeenCalled()
    expect(request.signal?.aborted).toBe(false)

    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(request.signal?.aborted).toBe(true)
    expect(host.textContent).toContain("Templates ready")
    expect(host.textContent).not.toContain("Opening your Studio library…")
  })

  it("skips a bootstrap refresh and bridges each newer preference revision once", async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshotResponse(1))
      .mockResolvedValueOnce(snapshotResponse(2))
      .mockResolvedValueOnce(snapshotResponse(2))
    let preferenceController: LibraryPreferenceController | null = null
    let discoveryRefresh: ReturnType<typeof vi.spyOn> | null = null
    const preferenceFactory: LibraryPreferenceControllerFactory = (
      dependencies
    ) => {
      preferenceController = new LibraryPreferenceController({
        ...dependencies,
        client: preferenceClient(readSnapshot),
      })
      return preferenceController
    }
    const discoveryFactory: LibraryDiscoveryControllerFactory = (
      dependencies
    ) => {
      const controller = new LibraryDiscoveryController(dependencies)
      discoveryRefresh = vi.spyOn(controller, "refresh")
      return controller
    }

    await act(async () =>
      root.render(
        <LibraryRuntimeProvider
          preferences={{
            createController: preferenceFactory,
            sessionId: "session-runtime-invalidation",
          }}
          discovery={{ createController: discoveryFactory }}
        >
          <div />
        </LibraryRuntimeProvider>
      )
    )
    await vi.waitFor(() => expect(discoveryRefresh).not.toBeNull())
    expect(discoveryRefresh).not.toHaveBeenCalled()

    await act(async () => {
      await preferenceController?.refresh()
    })
    expect(discoveryRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await preferenceController?.refresh()
    })
    expect(discoveryRefresh).toHaveBeenCalledTimes(1)
  })

  it("mounts isolated template and media owners without a transient mixed media query", async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshotResponse(1))
    const templateList = discoveryList()
    const mediaList = discoveryList()
    const capturedControllers: {
      template: LibraryDiscoveryController | null
      media: LibraryDiscoveryController | null
    } = { template: null, media: null }
    const requireCapturedControllers = () => {
      const { template, media } = capturedControllers
      if (!template || !media) {
        throw new Error("Both production discovery owners must be mounted.")
      }
      return { template, media }
    }
    const templateFactory: LibraryDiscoveryControllerFactory = (
      dependencies
    ) => {
      const controller = new LibraryDiscoveryController({
        ...dependencies,
        list: templateList,
      })
      controller.setFilters({ itemKinds: ["template"] })
      capturedControllers.template = controller
      return controller
    }
    const mediaFactory: LibraryMediaDiscoveryControllerFactory = (
      dependencies
    ) => {
      const controller = new LibraryDiscoveryController({
        ...dependencies,
        list: mediaList,
      })
      capturedControllers.media = controller
      return controller
    }

    await act(async () =>
      root.render(
        <LibraryRuntimeProvider
          preferences={{
            createController: (dependencies) =>
              new LibraryPreferenceController({
                ...dependencies,
                client: preferenceClient(readSnapshot),
              }),
            sessionId: "session-runtime-media",
          }}
          discovery={{ createController: templateFactory }}
          mediaDiscovery={{
            createController: mediaFactory,
            localAdapter,
          }}
        >
          <ProductionDiscoveryOwnersProbe />
        </LibraryRuntimeProvider>
      )
    )

    await vi.waitFor(() => {
      expect(templateList.mock.calls.length).toBeGreaterThan(0)
      expect(mediaList.mock.calls.length).toBeGreaterThan(0)
    })
    expect(host.querySelector("output")).toMatchObject({
      dataset: {
        mediaKinds: "media",
        templateKinds: "template",
      },
    })
    const { template, media } = requireCapturedControllers()
    expect(template).not.toBe(media)
    expect(
      mediaList.mock.calls.every(
        ([query]) =>
          query.itemKinds.length === 1 && query.itemKinds[0] === "media"
      )
    ).toBe(true)

    await act(async () => {
      template.setRawSearch("template-search")
      media.setRawSearch("media-search")
    })
    expect(template.getSnapshot().rawSearch).toBe("template-search")
    expect(media.getSnapshot().rawSearch).toBe("media-search")
    expect(template.getSnapshot().filters.itemKinds).toEqual(["template"])
    expect(media.getSnapshot().filters.itemKinds).toEqual(["media"])
  })
})
