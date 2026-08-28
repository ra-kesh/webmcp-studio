import { expect, test } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"

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

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(
    (storageKey) => localStorage.removeItem(storageKey),
    documentStorageKey
  )
  await page.reload()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
})

test("quotation themes preserve user content and structure in one undo step", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text" }).click()
  await expect(page.getByText("Selected layer", { exact: true })).toBeVisible()
  const textEditor = page.locator("textarea").last()
  await textEditor.fill("Client-approved manual note")
  await textEditor.blur()

  await page.getByRole("tab", { name: "Pages" }).click()
  await page
    .getByRole("tabpanel", { name: "Pages" })
    .getByRole("button", { name: "Add page to Quotation" })
    .click()
  await expect(page.getByText("Page 7", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("status")).toContainText(
    /All changes saved|Saved/
  )

  const beforeRaw = await page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    documentStorageKey
  )
  if (!beforeRaw) throw new Error("The edited quotation was not persisted")
  const before = JSON.parse(beforeRaw) as {
    revision: number
    updatedAt: string
    pages: Array<{ background: string }>
    nodes: Array<{ type: string; text?: string }>
  }

  await page.getByRole("tab", { name: "Templates" }).click()
  const midnightCard = page.getByRole("button", { name: /Midnight Film/ })
  await midnightCard.click()
  await page.getByRole("button", { name: "Apply to this design" }).click()
  await expect(midnightCard.getByLabel("Currently applied")).toBeVisible()
  await expect(page.getByRole("status")).toContainText(
    /All changes saved|Saved/
  )

  const afterRaw = await page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    documentStorageKey
  )
  if (!afterRaw) throw new Error("The themed quotation was not persisted")
  const after = JSON.parse(afterRaw) as typeof before

  expect(omitVisuals(after)).toEqual(omitVisuals(before))
  expect(after.revision).toBe(before.revision + 1)
  expect(after.pages[0]?.background).not.toBe(before.pages[0]?.background)
  expect(
    after.nodes.some(
      (node) =>
        node.type === "text" && node.text === "Client-approved manual note"
    )
  ).toBe(true)
  await expect(page.getByText("Selected layer", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(
    page
      .getByRole("button", { name: /Editorial Olive/ })
      .getByLabel("Currently applied")
  ).toBeVisible()
  await expect(page.getByRole("status")).toContainText(
    /All changes saved|Saved/
  )
  const undoneRaw = await page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    documentStorageKey
  )
  expect(undoneRaw).toBe(beforeRaw)
})
