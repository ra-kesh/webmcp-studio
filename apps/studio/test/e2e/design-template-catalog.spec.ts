import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

test.describe.configure({ timeout: 90_000 })

const documentDatabaseName = "webmcp-studio-documents"
const documentBodyStore = "draft-body"

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
  ).toBeVisible()
  await expect(page.getByRole("img", { name: /Preview of/ })).toHaveCount(5)
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("tab", { name: "Templates", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Design templates" })
  ).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await openSampleEditor(page)
})

test("catalog renders real previews and separates confirmed apply from fresh create", async ({
  page,
}) => {
  await expect(page.getByRole("img", { name: /Preview of/ })).toHaveCount(5)

  const search = page.getByRole("searchbox", {
    name: "Search design templates",
  })
  await search.fill("cinematic")
  await expect(
    page.getByRole("button", { name: /Midnight Film/ })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Editorial one-pager/ })
  ).toHaveCount(0)
  await search.fill("")

  const originalDocumentId = routedDocumentId(page)
  const before = await readStoredDraft(page, originalDocumentId)
  if (!before) throw new Error("The sample document was not persisted")
  expect(before.document.pages).toHaveLength(6)
  expect(before.sourceContext?.quotationSource).not.toBeNull()

  await page.getByRole("button", { name: /Bold square announcement/ }).click()
  await page.getByRole("button", { name: "Apply to this design" }).click()

  const confirmation = page.getByRole("alertdialog", {
    name: /Replace this design with Bold square announcement/,
  })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText("Pages")
  await expect(confirmation).toContainText("6 → 1")
  await expect(confirmation).toContainText(
    "The current Stuwiz quotation will be disconnected"
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
    version: 1,
  })

  await page.getByRole("button", { name: /Editorial one-pager/ }).click()
  await page.getByRole("button", { name: "Create new" }).click()
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

test("compact document panel exposes the same catalog and source compatibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.getByRole("button", { name: "Open document panel" }).click()
  const panel = page.getByRole("dialog", { name: "Document" })
  await expect(
    panel.getByRole("heading", { name: "Design templates" })
  ).toBeVisible()
  await panel.getByRole("button", { name: /Midnight Film/ }).click()
  await expect(
    panel.getByText(
      "Applying this style changes the visual system without replacing pages, fields, linked content, or manual layout."
    )
  ).toBeVisible()
  await expect(
    panel.getByRole("button", { name: "Apply to this design" })
  ).toBeEnabled()
})
