import { expect, test } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"
const quotationSourceStorageKey = "webmcp-studio:quotation-source:v1"
const designTemplateStorageKey = "webmcp-studio:design-template:v1"

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(
    ({ documentKey, templateKey }) => {
      localStorage.removeItem(documentKey)
      localStorage.removeItem(templateKey)
    },
    {
      documentKey: documentStorageKey,
      templateKey: designTemplateStorageKey,
    }
  )
  await page.reload()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Design templates" })
  ).toBeVisible()
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

  const beforeRaw = await page.evaluate(
    (key) => localStorage.getItem(key),
    documentStorageKey
  )
  if (!beforeRaw) throw new Error("The starter document was not persisted")
  const before = JSON.parse(beforeRaw) as { id: string; pages: unknown[] }

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

  await expect(page.getByRole("status")).toContainText(
    /All changes saved|Saved/
  )
  const applied = await page.evaluate(
    ({ documentKey, sourceKey, templateKey }) => ({
      document: JSON.parse(localStorage.getItem(documentKey) ?? "null") as {
        id: string
        pages: unknown[]
      } | null,
      quotationSource: localStorage.getItem(sourceKey),
      template: JSON.parse(localStorage.getItem(templateKey) ?? "null") as {
        id: string
        version: number
      } | null,
    }),
    {
      documentKey: documentStorageKey,
      sourceKey: quotationSourceStorageKey,
      templateKey: designTemplateStorageKey,
    }
  )
  expect(applied.document?.id).toBe(before.id)
  expect(applied.document?.pages).toHaveLength(1)
  expect(applied.quotationSource).toBeNull()
  expect(applied.template).toEqual({
    id: "bold-square-announcement",
    version: 1,
  })

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByRole("status")).toContainText(
    /All changes saved|Saved/
  )
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      quotationSourceStorageKey
    )
  ).not.toBeNull()
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      designTemplateStorageKey
    )
  ).toEqual({ id: "quotation-editorial-olive", version: 1 })

  await page.getByRole("button", { name: /Editorial one-pager/ }).click()
  await page.getByRole("button", { name: "Create new" }).click()
  await expect(page.getByRole("status")).toContainText(
    /All changes saved|Saved/
  )
  const created = await page.evaluate(
    ({ documentKey, sourceKey }) => ({
      document: JSON.parse(localStorage.getItem(documentKey) ?? "null") as {
        id: string
        pages: Array<{ id: string }>
      } | null,
      source: localStorage.getItem(sourceKey),
    }),
    {
      documentKey: documentStorageKey,
      sourceKey: quotationSourceStorageKey,
    }
  )
  expect(created.document?.id).not.toBe(before.id)
  expect(created.document?.pages[0]?.id).not.toBe("editorial-one-pager-page")
  expect(created.source).toBeNull()
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()
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
