import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

test.describe.configure({ timeout: 90_000 })

const documentDatabaseName = "webmcp-studio-documents"
const documentBodyStore = "draft-body"

type StoredDraft = {
  recordVersion: number
  document: {
    id: string
    revision: number
    updatedAt: string
    pages: Array<{ background: string }>
    nodes: Array<{ type: string; text?: string }>
  }
  sourceContext: unknown
}

const VISUAL_KEYS = new Set([
  "revision",
  "updatedAt",
  "background",
  "color",
  "fill",
  "stroke",
])

const omitVisuals = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(omitVisuals)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VISUAL_KEYS.has(key))
        .map(([key, child]) => [key, omitVisuals(child)])
    )
  }
  return value
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

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
})

test("quotation themes preserve user content and structure in one undo step", async ({
  page,
}) => {
  const documentId = routedDocumentId(page)
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Body/ }).click()
  const textEditor = page.locator('textarea[data-fabric="textarea"]')
  await expect(textEditor).toBeFocused()
  await textEditor.press("ControlOrMeta+A")
  await textEditor.fill("Client-approved manual note")
  await textEditor.press("Tab")

  await page.getByRole("tab", { name: "Pages" }).click()
  await page
    .getByRole("tabpanel", { name: "Pages" })
    .getByRole("button", { name: "Add page to Quotation" })
    .click()
  await expect(page.getByText("Page 7", { exact: true }).first()).toBeVisible()

  await expect
    .poll(
      async () =>
        (await readStoredDraft(page, documentId))?.document.pages.length
    )
    .toBe(7)
  const beforeDraft = await readStoredDraft(page, documentId)
  if (!beforeDraft) throw new Error("The edited quotation was not persisted")
  const before = beforeDraft.document

  await page.getByRole("tab", { name: "Templates" }).click()
  const midnightCard = page.getByRole("button", {
    name: "Select Midnight Film",
    exact: true,
  })
  await midnightCard.click()
  await page.getByRole("button", { name: "Apply to this document" }).click()
  const confirmation = page.getByRole("alertdialog", {
    name: "Apply Midnight Film to this design?",
  })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole("button", { name: "Apply template" }).click()

  await expect
    .poll(
      async () => (await readStoredDraft(page, documentId))?.document.revision
    )
    .toBe(before.revision + 1)
  const afterDraft = await readStoredDraft(page, documentId)
  if (!afterDraft) throw new Error("The themed quotation was not persisted")
  const after = afterDraft.document

  expect(afterDraft.sourceContext).toMatchObject({
    designTemplate: { id: "quotation-midnight-film", version: 3 },
  })
  expect(omitVisuals(after)).toEqual(omitVisuals(before))
  expect(after.revision).toBe(before.revision + 1)
  expect(after.pages[0]?.background).not.toBe(before.pages[0]?.background)
  expect(
    after.nodes.some(
      (node) =>
        node.type === "text" && node.text === "Client-approved manual note"
    )
  ).toBe(true)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect
    .poll(
      async () => (await readStoredDraft(page, documentId))?.document.revision
    )
    .toBe(before.revision)
  const undone = await readStoredDraft(page, documentId)
  expect(undone?.document).toEqual(before)
  expect(undone?.sourceContext).toEqual(beforeDraft.sourceContext)
})
