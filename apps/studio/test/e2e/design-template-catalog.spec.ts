import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  LibraryCatalogIndex,
  libraryCatalogQueryIdentity,
  libraryCatalogQuerySchema,
} from "@webmcp/document"
import type { LibraryCatalogItemSummary } from "@webmcp/document"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

test.describe.configure({ timeout: 90_000 })

const documentDatabaseName = "webmcp-studio-documents"
const documentBodyStore = "draft-body"
const gate8ArtifactDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/audits/2026-08-27-editor-production-readiness/artifacts/library-02-gate8"
)

type StoredDraft = {
  recordVersion: number
  document: {
    id: string
    pages: Array<{ id: string }>
  }
  sourceContext: {
    quotationSource: unknown | null
    quotationTemplateId: string
    designTemplate: { id: string; version: number } | null
  } | null
}

function routedDocumentId(page: Page) {
  const match = new URL(page.url()).pathname.match(/^\/documents\/([^/]+)$/)
  if (!match?.[1])
    throw new Error(`Expected a document route, received ${page.url()}`)
  return decodeURIComponent(match[1])
}

async function readStoredDraft(page: Page, documentId: string) {
  return page.evaluate(
    async ({ databaseName, storeName, id }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(request.error ?? new Error("Document database did not open"))
      })
      return new Promise<StoredDraft | undefined>((resolve, reject) => {
        const request = database
          .transaction(storeName)
          .objectStore(storeName)
          .get(id)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(request.error ?? new Error("Document draft did not load"))
      }).finally(() => database.close())
    },
    {
      databaseName: documentDatabaseName,
      storeName: documentBodyStore,
      id: documentId,
    }
  )
}

async function openSampleEditor(page: Page) {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Studio documents" })
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("tab", { name: "Templates", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Templates", exact: true })
  ).toBeVisible({ timeout: 30_000 })
}

function median(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)]!
}

function measureLocalCatalog500ItemMedian(
  seed: Extract<LibraryCatalogItemSummary, { itemKind: "template" }>
) {
  const items: LibraryCatalogItemSummary[] = Array.from(
    { length: 500 },
    (_, index) => {
      const ordinal = String(index + 1).padStart(3, "0")
      const id = `gate8-scale-template-${ordinal}`
      return {
        ...seed,
        id,
        name: `Gate 8 scale template ${ordinal}`,
        categoryId: index % 2 ? "documents" : "proposals",
        useCaseIds: index % 3 ? ["brief"] : ["proposal"],
        curatedRank: index,
        preview: {
          ...seed.preview,
          kind: "live_fallback",
          itemId: id,
          pageId: `${id}-page`,
          resourcePath: null,
          mediaType: null,
          contentSha256: null,
          rendererRevision: null,
        },
      }
    }
  )
  const catalog = new LibraryCatalogIndex("catalog-gate8-scale-r1", items)
  catalog.list({ generation: "warmup", search: "gate 8 scale", limit: 50 })

  const durations = Array.from({ length: 7 }, (_, iteration) => {
    const startedAt = performance.now()
    const result = catalog.list({
      generation: `measure-${iteration}`,
      search: "gate 8 scale template",
      categoryIds: ["documents"],
      order: "newest",
      limit: 50,
    })
    expect(result.total).toBe(250)
    return performance.now() - startedAt
  })
  return { durations, medianMs: median(durations) }
}

async function measureWarmWorker50ItemMedian(page: Page) {
  const endpoint = (generation: string) => {
    const url = new URL("/v1/studio/library/items", page.url())
    url.searchParams.set("generation", generation)
    url.searchParams.set("limit", "50")
    return url.href
  }
  const warmup = await page.request.get(endpoint("gate8-worker-warmup"))
  expect(warmup.status()).toBe(200)
  const warmupBody = (await warmup.json()) as {
    page: { items: LibraryCatalogItemSummary[] }
  }
  const templateSeed = warmupBody.page.items.find(
    (item) => item.itemKind === "template"
  )
  if (!templateSeed)
    throw new Error("The Worker catalog has no template fixture")

  const durations: number[] = []
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const startedAt = performance.now()
    const response = await page.request.get(
      endpoint(`gate8-worker-measure-${iteration}`)
    )
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { page: { items: unknown[] } }
    expect(body.page.items).toHaveLength(50)
    durations.push(performance.now() - startedAt)
  }
  return { durations, medianMs: median(durations), templateSeed }
}

async function seedGate8LocalScaleMetadata(page: Page, count: number) {
  await page.evaluate(async (itemCount) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webmcp-studio-assets", 6)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("asset-metadata")) {
          const metadata = db.createObjectStore("asset-metadata", {
            keyPath: "id",
          })
          metadata.createIndex("createdAt", "createdAt")
          metadata.createIndex("lastUsedAt", "lastUsedAt")
        }
        if (!db.objectStoreNames.contains("asset-blobs")) {
          db.createObjectStore("asset-blobs")
        }
        if (!db.objectStoreNames.contains("asset-quarantine")) {
          db.createObjectStore("asset-quarantine", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("asset-promotion-journal")) {
          db.createObjectStore("asset-promotion-journal", {
            keyPath: "localAssetId",
          })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error("Asset database did not open"))
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("asset-metadata", "readwrite")
      const metadata = transaction.objectStore("asset-metadata")
      for (let index = 0; index < itemCount; index += 1) {
        const ordinal = String(index + 1).padStart(4, "0")
        const timestamp = new Date(
          Date.parse("2026-09-01T00:00:00.000Z") + index * 1_000
        ).toISOString()
        metadata.put({
          schemaVersion: 4,
          id: `gate8-local-scale-${ordinal}`,
          name: `Gate 8 local scale ${ordinal}.png`,
          mediaType: "image/png",
          size: 68,
          width: 1,
          height: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastUsedAt: timestamp,
          archivedAt: null,
          integrity: "ready",
          revision: 1,
        })
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Asset metadata write failed"))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Asset metadata write aborted"))
    })
    database.close()
  }, count)
}

async function waitForDecodedImage(page: Page, accessibleName: string) {
  const image = page.getByRole("img", { name: accessibleName })
  await expect(image).toBeVisible()
  await expect
    .poll(() =>
      image.evaluate(
        (node) =>
          node instanceof HTMLImageElement &&
          node.complete &&
          node.naturalWidth > 0
      )
    )
    .toBe(true)
}

test.beforeEach(async ({ page }) => {
  await openSampleEditor(page)
})

test("catalog renders real previews and separates confirmed apply from fresh create", async ({
  page,
}) => {
  await expect(
    page.locator('[data-preview-state="ready"] img').first()
  ).toBeVisible()

  const search = page.getByRole("searchbox", {
    name: "Search design templates",
  })
  await search.fill("cinematic")
  await expect(
    page.getByRole("button", { name: "Select Midnight Film", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: "Select Editorial one-pager",
      exact: true,
    })
  ).toHaveCount(0)
  await search.fill("")

  const originalDocumentId = routedDocumentId(page)
  const before = await readStoredDraft(page, originalDocumentId)
  if (!before) throw new Error("The sample document was not persisted")
  expect(before.document.pages).toHaveLength(6)
  expect(before.sourceContext?.quotationSource).not.toBeNull()

  await page
    .getByRole("button", {
      name: "Select Bold square announcement",
      exact: true,
    })
    .click()
  await page.getByRole("button", { name: "Apply to this document" }).click()

  const confirmation = page.getByRole("alertdialog", {
    name: "Apply Bold square announcement to this design?",
  })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText("Pages")
  await expect(confirmation).toContainText("6 → 1")
  await expect(confirmation).toContainText(
    "The current source quotation will be disconnected"
  )
  await confirmation.getByRole("button", { name: "Apply template" }).click()

  await expect
    .poll(
      async () =>
        (await readStoredDraft(page, originalDocumentId))?.document.pages.length
    )
    .toBe(1)
  const applied = await readStoredDraft(page, originalDocumentId)
  expect(applied?.document.id).toBe(originalDocumentId)
  expect(applied?.sourceContext?.quotationSource).toBeNull()
  expect(applied?.sourceContext?.designTemplate).toEqual({
    id: "bold-square-announcement",
    version: 1,
  })

  await page.getByRole("button", { name: "Undo" }).click()
  await expect
    .poll(
      async () =>
        (await readStoredDraft(page, originalDocumentId))?.document.pages.length
    )
    .toBe(6)
  const restored = await readStoredDraft(page, originalDocumentId)
  expect(restored?.sourceContext?.quotationSource).not.toBeNull()
  expect(restored?.sourceContext?.designTemplate).toEqual({
    id: "quotation-editorial-olive",
    version: 3,
  })

  await page
    .getByRole("button", {
      name: "Select Editorial one-pager",
      exact: true,
    })
    .click()
  await page.getByRole("button", { name: "Create from template" }).click()
  await expect(
    page.getByRole("alertdialog", { name: "Replace current browser draft?" })
  ).toHaveCount(0)
  await expect.poll(() => routedDocumentId(page)).not.toBe(originalDocumentId)

  const createdDocumentId = routedDocumentId(page)
  await expect
    .poll(
      async () =>
        (await readStoredDraft(page, createdDocumentId))?.document.pages.length
    )
    .toBe(1)
  const created = await readStoredDraft(page, createdDocumentId)
  expect(created?.document.id).toBe(createdDocumentId)
  expect(created?.document.pages[0]?.id).not.toBe("editorial-one-pager-page")
  expect(created?.sourceContext?.quotationSource).toBeNull()
  expect(created?.sourceContext?.designTemplate).toEqual({
    id: "editorial-one-pager",
    version: 1,
  })
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()

  const retainedOriginal = await readStoredDraft(page, originalDocumentId)
  expect(retainedOriginal).toEqual(restored)
})

test("finds proposal, portrait, and story templates and creates distinct durable documents", async ({
  page,
}) => {
  const createdDocumentIds = new Set<string>()
  const createdPageIds = new Set<string>()
  const journeys = [
    {
      filter: "Filter templates by use case",
      option: "proposal",
      templateName: "Editorial project proposal",
      templateId: "editorial-proposal",
      canonicalPageId: "editorial-proposal-page-1-cover",
    },
    {
      filter: "Filter templates by format",
      option: "a4-portrait",
      templateName: "Program overview one-pager",
      templateId: "program-overview-one-pager",
      canonicalPageId: "program-overview-one-pager-page-1-overview",
    },
    {
      filter: "Filter templates by orientation",
      option: "portrait",
      templateName: "Event countdown story",
      templateId: "event-countdown-story",
      canonicalPageId: "event-countdown-story-page-1-countdown",
    },
  ] as const

  for (const journey of journeys) {
    await page.getByRole("button", { name: "Filter templates" }).click()
    const filterSheet = page.getByRole("dialog", { name: "Template filters" })
    for (const filterName of [
      "Filter templates by use case",
      "Filter templates by format",
      "Filter templates by orientation",
    ]) {
      await filterSheet
        .getByRole("combobox", { name: filterName })
        .selectOption("all")
    }
    await filterSheet
      .getByRole("combobox", { name: journey.filter })
      .selectOption(journey.option)
    await filterSheet
      .getByRole("button", { name: "Close template filters" })
      .click()

    const card = page.getByRole("button", {
      name: `Select ${journey.templateName}`,
      exact: true,
    })
    await expect(card).toBeVisible()
    await card.click()
    const previousDocumentId = routedDocumentId(page)
    await page.getByRole("button", { name: "Create from template" }).click()

    await expect.poll(() => routedDocumentId(page)).not.toBe(previousDocumentId)
    const documentId = routedDocumentId(page)
    expect(createdDocumentIds.has(documentId)).toBe(false)
    createdDocumentIds.add(documentId)

    await expect
      .poll(async () => (await readStoredDraft(page, documentId))?.document.id)
      .toBe(documentId)
    const stored = await readStoredDraft(page, documentId)
    const firstPageId = stored?.document.pages[0]?.id
    expect(firstPageId).toBeTruthy()
    expect(firstPageId).not.toBe(journey.canonicalPageId)
    expect(createdPageIds.has(firstPageId!)).toBe(false)
    createdPageIds.add(firstPageId!)
    expect(stored?.sourceContext?.designTemplate).toEqual({
      id: journey.templateId,
      version: 1,
    })

    await page.getByRole("tab", { name: "Templates", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Templates", exact: true })
    ).toBeVisible()
  }

  expect(createdDocumentIds.size).toBe(3)
  expect(createdPageIds.size).toBe(3)
})

test("keeps search-to-visible below the Gate 8 browser p95 budget with 1,000 summaries", async ({
  page,
}, testInfo) => {
  type CatalogResponse = {
    schemaVersion: 1
    workspaceRevision: number
    page: {
      schemaVersion: 1
      catalogRevision: string
      generation: string
      queryIdentity: string
      items: Array<Record<string, unknown>>
      nextCursor: string | null
      total: number
    }
  }
  let seed: Record<string, unknown> | undefined
  let cachedBody: CatalogResponse | undefined
  let cachedHeaders: Record<string, string> | undefined
  const requestStartedAt = new Map<string, number>()
  const worker = await measureWarmWorker50ItemMedian(page)
  expect(worker.medianMs).toBeLessThan(200)
  const localCatalog = measureLocalCatalog500ItemMedian(worker.templateSeed)
  expect(localCatalog.medianMs).toBeLessThan(50)

  await page.route("**/v1/studio/library/items?*", async (route) => {
    const routedUrl = new URL(route.request().url())
    const routedSearch = routedUrl.searchParams.get("search") ?? ""
    if (routedSearch) requestStartedAt.set(routedSearch, performance.now())
    const upstream = cachedBody ? null : await route.fetch()
    const body = cachedBody ?? ((await upstream!.json()) as CatalogResponse)
    if (!cachedBody) {
      cachedBody = body
      cachedHeaders = upstream!.headers()
      delete cachedHeaders["content-length"]
      delete cachedHeaders["content-encoding"]
    }
    seed ??= body.page.items.find((item) => item.itemKind === "template")
    if (!seed) {
      await route.fulfill({ response: upstream! })
      return
    }

    const url = new URL(route.request().url())
    const search = (url.searchParams.get("search") ?? "").toLowerCase()
    const summaries = Array.from({ length: 1_000 }, (_, index) => {
      const ordinal = String(index + 1).padStart(4, "0")
      const id = `scale-template-${ordinal}`
      const preview = seed!.preview as Record<string, unknown>
      return {
        ...seed,
        id,
        name: `Scale template needle ${ordinal}`,
        description: `Browser scale fixture ${ordinal}`,
        preview: {
          ...preview,
          kind: "live_fallback",
          itemId: id,
          pageId: `${id}-page`,
          resourcePath: null,
          mediaType: null,
          contentSha256: null,
          rendererRevision: null,
        },
      }
    }).filter((item) =>
      search
        ? `${item.name} ${item.description}`.toLowerCase().includes(search)
        : true
    )
    const limit = Number(url.searchParams.get("limit") ?? 24)
    const query = libraryCatalogQuerySchema.parse({
      generation: url.searchParams.get("generation"),
      search: url.searchParams.get("search") ?? "",
      itemKinds: url.searchParams.getAll("itemKind"),
      categoryIds: url.searchParams.getAll("categoryId"),
      useCaseIds: url.searchParams.getAll("useCaseId"),
      formatFamilies: url.searchParams.getAll("formatFamily"),
      orientations: url.searchParams.getAll("orientation"),
      ownerKinds: url.searchParams.getAll("ownerKind"),
      favoritesOnly: url.searchParams.get("favoritesOnly") === "true",
      recentOnly: url.searchParams.get("recentOnly") === "true",
      collectionId: url.searchParams.get("collectionId"),
      order: url.searchParams.get("order") ?? "curated",
      limit,
      cursor: null,
    })

    await route.fulfill({
      status: 200,
      headers: cachedHeaders,
      json: {
        ...body,
        page: {
          ...body.page,
          generation: query.generation,
          queryIdentity: libraryCatalogQueryIdentity(query),
          items: summaries.slice(0, limit),
          nextCursor: null,
          total: summaries.length,
        },
      },
    })
  })

  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Templates", exact: true })
  ).toBeVisible({ timeout: 30_000 })
  const search = page.getByRole("searchbox", {
    name: "Search design templates",
  })
  const durations: number[] = []

  for (const ordinal of [137, 248, 359, 461, 572, 683, 794]) {
    const query = `needle ${String(ordinal).padStart(4, "0")}`
    const expectedLabel = `Select Scale template ${query}`
    await search.fill(query)
    await expect
      .poll(() => requestStartedAt.has(query), { intervals: [5, 10, 20] })
      .toBe(true)
    await page.waitForFunction(
      (label) =>
        Array.from(document.querySelectorAll("button[aria-label]")).some(
          (button) => button.getAttribute("aria-label") === label
        ),
      expectedLabel,
      { polling: "raf", timeout: 5_000 }
    )
    durations.push(performance.now() - requestStartedAt.get(query)!)
  }

  durations.sort((left, right) => left - right)
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!
  expect(p95).toBeLessThan(250)

  await page.unroute("**/v1/studio/library/items?*")
  await seedGate8LocalScaleMetadata(page, 1_000)
  await page.getByRole("tab", { name: "Assets", exact: true }).click()
  const assetsWorkspace = page.getByRole("region", { name: "Assets workspace" })
  await assetsWorkspace
    .getByRole("tab", { name: "Uploads", exact: true })
    .click()
  await expect(
    assetsWorkspace.locator('[data-media-card^="media:local:"]').first()
  ).toBeVisible()
  await expect(
    assetsWorkspace.locator('[aria-setsize="1000"]').first()
  ).toBeVisible()
  const mountedMediaCards = await assetsWorkspace
    .locator("[data-media-card]")
    .count()
  expect(mountedMediaCards).toBeGreaterThan(0)
  expect(mountedMediaCards).toBeLessThanOrEqual(32)

  const evidence = {
    version: 1,
    capturedAt: new Date().toISOString(),
    runtime: {
      browser: testInfo.project.name || "chromium",
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: page.viewportSize(),
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
    },
    fixtures: {
      catalogSummaries: 1_000,
      samples: durations.length,
      debounceMs: 180,
      measurement: "catalog request observed to matching card visible",
    },
    measurements: {
      searchToVisibleMs: durations,
      searchToVisibleP95Ms: p95,
      mountedMediaCardsFor1000Items: mountedMediaCards,
      localCatalog500ItemDurationsMs: localCatalog.durations,
      localCatalog500ItemMedianMs: localCatalog.medianMs,
      warmWorker50ItemDurationsMs: worker.durations,
      warmWorker50ItemMedianMs: worker.medianMs,
    },
    budgets: {
      searchToVisibleP95Ms: 250,
      mountedMediaCardsFor1000Items: 32,
      localCatalog500ItemMedianMs: 50,
      warmWorker50ItemMedianMs: 200,
    },
  }
  await mkdir(gate8ArtifactDirectory, { recursive: true })
  const evidencePath = resolve(gate8ArtifactDirectory, "scale-profile.json")
  const stagingPath = `${evidencePath}.staging`
  await writeFile(stagingPath, `${JSON.stringify(evidence, null, 2)}\n`)
  await rename(stagingPath, evidencePath)
})

test("captures accepted desktop and compact template and asset workspaces", async ({
  page,
}) => {
  await mkdir(gate8ArtifactDirectory, { recursive: true })
  await page.screenshot({
    path: resolve(gate8ArtifactDirectory, "desktop-templates.png"),
    animations: "disabled",
  })

  await page.getByRole("tab", { name: "Assets", exact: true }).click()
  const assetsWorkspace = page.getByRole("region", { name: "Assets workspace" })
  await expect(assetsWorkspace).toBeVisible()
  await expect(
    assetsWorkspace.getByRole("tab", { name: "Media", exact: true })
  ).toBeVisible()
  await expect(
    assetsWorkspace.getByRole("tab", { name: "Components", exact: true })
  ).toBeVisible()
  await assetsWorkspace
    .getByRole("tab", { name: "Library", exact: true })
    .click()
  await expect(
    assetsWorkspace.getByRole("button", { name: /^Insert / }).first()
  ).toBeVisible()
  await waitForDecodedImage(page, "Olive botanical")
  await waitForDecodedImage(page, "Sandstone arches")
  await page.screenshot({
    path: resolve(gate8ArtifactDirectory, "desktop-assets.png"),
    animations: "disabled",
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Open document panel" }).click()
  const documentPanel = page.getByRole("dialog", { name: "Document" })
  await expect(documentPanel).toBeVisible()
  await page.screenshot({
    path: resolve(gate8ArtifactDirectory, "compact-assets.png"),
    animations: "disabled",
  })

  await documentPanel
    .getByRole("tab", { name: "Templates", exact: true })
    .click()
  await expect(
    documentPanel.getByRole("heading", { name: "Templates", exact: true })
  ).toBeVisible()
  await page.screenshot({
    path: resolve(gate8ArtifactDirectory, "compact-templates.png"),
    animations: "disabled",
  })
})

test("compact document panel exposes the same catalog and source compatibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.getByRole("button", { name: "Open document panel" }).click()
  const panel = page.getByRole("dialog", { name: "Document" })
  await expect(
    panel.getByRole("heading", { name: "Templates", exact: true })
  ).toBeVisible()
  await panel
    .getByRole("button", { name: "Select Midnight Film", exact: true })
    .click()
  await expect(
    panel.getByRole("button", { name: "Apply to this document" })
  ).toBeEnabled()
})
