import { describe, expect, it, vi } from "vitest"
import type { LibraryCatalogItemSummary } from "@webmcp/document"
import { studioLibraryCatalogIndex } from "./catalog"
import {
  StudioLibraryDetailNotFoundError,
  createStudioLibraryDiscoveryAdapter,
  studioLibraryDiscoveryAdapter,
} from "./library-discovery-adapter"

const allCatalogItems = () => {
  const items: LibraryCatalogItemSummary[] = []
  let cursor: string | null = null
  do {
    const page = studioLibraryCatalogIndex.list({
      generation: "adapter-test-complete-catalog",
      limit: 50,
      cursor,
    })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

const sortedUnique = (values: readonly string[]) =>
  [...new Set(values)].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1
  )

const eventually = async (assertion: () => void) => {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await Promise.resolve()
    }
  }
  throw lastError
}

describe("Studio library discovery adapter", () => {
  it("projects validated taxonomy from the complete active catalog", () => {
    const items = allCatalogItems()
    const taxonomy = studioLibraryDiscoveryAdapter.getTaxonomy()

    expect(items).toHaveLength(58)
    expect(taxonomy.categories.map(({ id }) => id)).toEqual(
      sortedUnique(items.map((item) => item.categoryId))
    )
    expect(taxonomy.useCases.map(({ id }) => id)).toEqual(
      sortedUnique(items.flatMap((item) => item.useCaseIds))
    )
    expect(taxonomy.formatFamilies.map(({ id }) => id)).toEqual(
      sortedUnique(items.map((item) => item.formatFamily))
    )
    expect(taxonomy.orientations).toEqual([
      { id: "portrait", label: "Portrait" },
      { id: "landscape", label: "Landscape" },
      { id: "square", label: "Square" },
      { id: "mixed", label: "Mixed" },
    ])
    expect(taxonomy.owners).toEqual([
      { id: "studio", label: "Studio" },
      { id: "workspace", label: "Your workspace" },
    ])
    expect(Object.isFrozen(taxonomy)).toBe(true)
    expect(Object.isFrozen(taxonomy.categories)).toBe(true)
    expect(Object.isFrozen(taxonomy.categories[0])).toBe(true)
    expect(studioLibraryDiscoveryAdapter.getTaxonomy()).toBe(taxonomy)
  })

  it("lists every compact summary asynchronously without document bodies or private bytes", async () => {
    const signal = new AbortController().signal
    const first = await studioLibraryDiscoveryAdapter.list(
      { generation: "adapter-list", limit: 50 },
      signal
    )
    const second = await studioLibraryDiscoveryAdapter.list(
      {
        generation: "adapter-list",
        limit: 50,
        cursor: first.nextCursor,
      },
      signal
    )

    expect(first.total).toBe(58)
    expect([...first.items, ...second.items]).toHaveLength(58)
    for (const summary of [...first.items, ...second.items]) {
      expect(summary).not.toHaveProperty("document")
      expect(summary).not.toHaveProperty("previewDocument")
      expect(summary).not.toHaveProperty("src")
      expect(summary).not.toHaveProperty("sourceEvidence")
      expect(summary).not.toHaveProperty("r2Key")
      expect(summary).not.toHaveProperty("objectKey")

      const encoded = JSON.stringify(summary)
      expect(encoded).not.toContain("data:image")
      expect(encoded).not.toContain(";base64,")
      expect(encoded).not.toContain("blob:")
      expect(encoded).not.toContain("asset:local/")
      expect(encoded).not.toContain("asset:managed/")
      expect(encoded).not.toContain('"nodes"')
      expect(encoded).not.toContain('"pages"')
    }
  })

  it("resolves only the requested exact detail identity", async () => {
    const signal = new AbortController().signal
    const page = await studioLibraryDiscoveryAdapter.list(
      {
        generation: "adapter-detail",
        itemKinds: ["template"],
        limit: 1,
      },
      signal
    )
    const summary = page.items[0]
    if (summary.itemKind !== "template") {
      throw new Error("Expected an exact template summary")
    }

    const detail = await studioLibraryDiscoveryAdapter.getDetail(
      "template",
      summary.id,
      summary.version,
      signal
    )
    expect(detail.summary).toEqual(summary)
    expect(detail).toMatchObject({
      materialization: {
        repository: "design_template",
        templateId: summary.id,
        templateVersion: summary.version,
      },
    })
    expect(Object.isFrozen(detail)).toBe(true)

    await expect(
      studioLibraryDiscoveryAdapter.getDetail(
        "template",
        summary.id,
        summary.version + 100,
        signal
      )
    ).rejects.toBeInstanceOf(StudioLibraryDetailNotFoundError)
  })

  it("crosses a stable async boundary before and after each local lookup", async () => {
    const releases: Array<() => void> = []
    const scheduleAsyncBoundary = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve)
        })
    )
    const adapter = createStudioLibraryDiscoveryAdapter({
      scheduleAsyncBoundary,
    })
    let settled = false
    const request = adapter
      .list(
        { generation: "adapter-stable-boundary", limit: 1 },
        new AbortController().signal
      )
      .then((page) => {
        settled = true
        return page
      })

    expect(scheduleAsyncBoundary).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    releases.shift()?.()
    await eventually(() =>
      expect(scheduleAsyncBoundary).toHaveBeenCalledTimes(2)
    )
    expect(settled).toBe(false)
    releases.shift()?.()

    await expect(request).resolves.toMatchObject({ total: 58 })
    expect(settled).toBe(true)
  })

  it("rejects an abort before work and after the local lookup", async () => {
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(
      studioLibraryDiscoveryAdapter.list(
        { generation: "adapter-pre-abort", limit: 1 },
        alreadyAborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" })

    const releases: Array<() => void> = []
    const adapter = createStudioLibraryDiscoveryAdapter({
      scheduleAsyncBoundary: () =>
        new Promise<void>((resolve) => {
          releases.push(resolve)
        }),
    })
    const afterLookupAbort = new AbortController()
    const request = adapter.list(
      { generation: "adapter-post-abort", limit: 1 },
      afterLookupAbort.signal
    )
    releases.shift()?.()
    await eventually(() => expect(releases).toHaveLength(1))
    afterLookupAbort.abort()
    releases.shift()?.()

    await expect(request).rejects.toMatchObject({ name: "AbortError" })
  })
})
