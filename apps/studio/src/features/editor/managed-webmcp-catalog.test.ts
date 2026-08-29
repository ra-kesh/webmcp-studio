import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StudioAsset } from "./asset-catalog"
import { createManagedWebMcpCatalog } from "./managed-webmcp-catalog"

const media = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
}))

vi.mock("./managed-media-repository", () => ({
  getManagedMedia: media.get,
  listManagedMedia: media.list,
}))

const builtIns: StudioAsset[] = [
  {
    id: "olive-botanical",
    name: "Olive botanical",
    description: "Soft botanical composition",
    tags: ["olive", "botanical"],
    width: 1_200,
    height: 1_500,
    src: "data:image/svg+xml,builtin",
    license: "Original Studio artwork",
  },
]

const readyManaged = {
  id: "asset-abcdefghij",
  name: "Reception portrait.jpg",
  mediaType: "image/jpeg" as const,
  bytes: 1_024,
  width: 1_600,
  height: 1_200,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  lastUsedAt: "2026-08-28T00:00:00.000Z",
  status: "ready" as const,
  selectable: true,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("managed WebMCP catalog", () => {
  it("does not preload workspace media and searches it on demand", async () => {
    media.list.mockResolvedValue({
      assets: [readyManaged],
      nextCursor: null,
      storage: { bytes: readyManaged.bytes, count: 1 },
    })
    const catalog = createManagedWebMcpCatalog(builtIns)
    expect(media.list).not.toHaveBeenCalled()
    expect(media.get).not.toHaveBeenCalled()

    await expect(
      catalog.search({
        query: "reception",
        tags: [],
        orientation: "landscape",
        limit: 8,
        cursor: null,
      })
    ).resolves.toEqual({
      assets: [
        expect.objectContaining({
          id: readyManaged.id,
          ownership: "workspace",
          selectable: true,
          src: `asset:managed/${readyManaged.id}`,
        }),
      ],
      nextCursor: null,
    })
    expect(media.list).toHaveBeenCalledWith({
      collection: "uploads",
      query: "reception",
      cursor: undefined,
      limit: 8,
    })
    catalog.dispose()
  })

  it("paginates built-ins before managed results without preloading a first page", async () => {
    media.list.mockResolvedValue({ assets: [readyManaged], nextCursor: null })
    const catalog = createManagedWebMcpCatalog(builtIns)
    const first = await catalog.search({
      query: "",
      tags: [],
      limit: 1,
      cursor: null,
    })
    expect(first.assets.map((asset) => asset.id)).toEqual(["olive-botanical"])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(media.list).not.toHaveBeenCalled()

    const second = await catalog.search({
      query: "",
      tags: [],
      limit: 1,
      cursor: first.nextCursor,
    })
    expect(second.assets.map((asset) => asset.id)).toEqual([readyManaged.id])
    expect(second.nextCursor).toBeNull()
    catalog.dispose()
  })

  it("resolves archived metadata for existing references but keeps it non-selectable", async () => {
    media.get.mockResolvedValue({
      ...readyManaged,
      status: "archived",
      selectable: false,
    })
    const catalog = createManagedWebMcpCatalog(builtIns)
    await expect(catalog.resolve(readyManaged.id)).resolves.toMatchObject({
      id: readyManaged.id,
      ownership: "workspace",
      selectable: false,
      src: `asset:managed/${readyManaged.id}`,
    })
    catalog.dispose()
  })

  it("rejects local and malformed identities without sending them to the workspace API", async () => {
    const catalog = createManagedWebMcpCatalog(builtIns)
    await expect(
      catalog.resolve("asset:local/private-device-id")
    ).resolves.toBeNull()
    await expect(
      catalog.resolve("https://example.test/private.png")
    ).resolves.toBeNull()
    expect(media.get).not.toHaveBeenCalled()
    catalog.dispose()
  })

  it("revalidates completed exact lookups so changes from another tab cannot stay stale", async () => {
    media.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(readyManaged)
      .mockResolvedValueOnce({
        ...readyManaged,
        status: "archived",
        selectable: false,
      })
    const catalog = createManagedWebMcpCatalog(builtIns)

    await expect(catalog.resolve(readyManaged.id)).resolves.toBeNull()
    await expect(catalog.resolve(readyManaged.id)).resolves.toMatchObject({
      selectable: true,
    })
    await expect(catalog.resolve(readyManaged.id)).resolves.toMatchObject({
      selectable: false,
    })
    expect(media.get).toHaveBeenCalledTimes(3)
    catalog.dispose()
  })

  it("keeps concurrent exact lookups under their own caller signals", async () => {
    const firstController = new AbortController()
    const secondController = new AbortController()
    let finishSecond: ((value: typeof readyManaged) => void) | undefined
    media.get
      .mockImplementationOnce(
        (_assetId: string, signal: AbortSignal) =>
          new Promise<typeof readyManaged>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            })
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<typeof readyManaged>((resolve) => {
            finishSecond = resolve
          })
      )
    const catalog = createManagedWebMcpCatalog(builtIns)

    const first = catalog.resolve(readyManaged.id, firstController.signal)
    const second = catalog.resolve(readyManaged.id, secondController.signal)
    expect(media.get).toHaveBeenCalledTimes(2)
    expect(media.get.mock.calls[0]?.[1]).toBe(firstController.signal)
    expect(media.get.mock.calls[1]?.[1]).toBe(secondController.signal)

    firstController.abort(new DOMException("First caller left.", "AbortError"))
    finishSecond?.(readyManaged)

    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    await expect(second).resolves.toMatchObject({ selectable: true })
    catalog.dispose()
  })

  it("does not claim workspace tags or licenses", async () => {
    const catalog = createManagedWebMcpCatalog(builtIns)
    await catalog.search({
      query: "",
      tags: ["wedding"],
      limit: 8,
      cursor: null,
    })
    expect(media.list).not.toHaveBeenCalled()
    catalog.dispose()
  })
})
