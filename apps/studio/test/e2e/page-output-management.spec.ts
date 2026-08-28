import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"

async function openPagesPanel(page: Page) {
  await page.getByRole("tab", { name: "Pages" }).click()
  return page.getByRole("tabpanel", { name: "Pages" })
}

async function waitForSaved(page: Page) {
  await expect(page.getByRole("status")).toContainText(
    /All changes saved|Saved/
  )
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

test("pages stay canonical across the sidebar, filmstrip, history, and persisted document", async ({
  page,
}) => {
  const panel = await openPagesPanel(page)
  const sidebarPages = panel.getByRole("button", { name: /^Open page/ })
  const filmstrip = page.getByRole("region", { name: "Quotation pages" })
  const filmstripPages = filmstrip.getByRole("button", { name: /^Open page/ })

  await expect(sidebarPages).toHaveCount(6)
  await expect(filmstripPages).toHaveCount(6)

  await panel.getByRole("button", { name: "Add page to Quotation" }).click()
  await expect(sidebarPages).toHaveCount(7)
  await expect(filmstripPages).toHaveCount(7)
  await expect(page.getByText("Page 7", { exact: true }).first()).toBeVisible()

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(sidebarPages).toHaveCount(6)
  await expect(filmstripPages).toHaveCount(6)

  await panel.getByRole("button", { name: "More actions for Cover" }).click()
  await page.getByRole("menuitem", { name: "Duplicate page" }).click()
  await expect(sidebarPages).toHaveCount(7)
  await expect(filmstripPages).toHaveCount(7)
  await expect(
    page.getByText("Cover copy", { exact: true }).first()
  ).toBeVisible()
  await waitForSaved(page)

  const duplicateSemantics = await page.evaluate((storageKey) => {
    const stored = localStorage.getItem(storageKey)
    if (!stored) throw new Error("The canonical draft was not persisted")
    const document = JSON.parse(stored) as {
      pages: Array<{ id: string; name: string; nodeIds: string[] }>
      groups: Array<{
        id: string
        pageId: string
        name: string
        nodeIds: string[]
        parentGroupId?: string
      }>
      bindings: Array<{
        id: string
        fieldId: string
        nodeId: string
        property: string
      }>
    }
    const source = document.pages.find(
      (candidate) => candidate.name === "Cover"
    )
    const copy = document.pages.find(
      (candidate) => candidate.name === "Cover copy"
    )
    if (!source || !copy) throw new Error("Cover page pair is unavailable")
    const sourceNodeIds = new Set(source.nodeIds)
    const copyNodeIds = new Set(copy.nodeIds)
    const sourceBindings = document.bindings.filter((binding) =>
      sourceNodeIds.has(binding.nodeId)
    )
    const copyBindings = document.bindings.filter((binding) =>
      copyNodeIds.has(binding.nodeId)
    )
    const copyGroups = document.groups.filter(
      (group) => group.pageId === copy.id
    )
    return {
      sourceNodeCount: source.nodeIds.length,
      copyNodeCount: copy.nodeIds.length,
      idsOverlap: copy.nodeIds.some((nodeId) => sourceNodeIds.has(nodeId)),
      sourceBindings,
      copyBindings,
      copyGroupCount: copyGroups.length,
      allGroupNodesBelongToCopy: copyGroups.every((group) =>
        group.nodeIds.every((nodeId) => copyNodeIds.has(nodeId))
      ),
      allParentsBelongToCopy: copyGroups.every(
        (group) =>
          !group.parentGroupId ||
          copyGroups.some((candidate) => candidate.id === group.parentGroupId)
      ),
    }
  }, documentStorageKey)
  expect(duplicateSemantics.copyNodeCount).toBe(
    duplicateSemantics.sourceNodeCount
  )
  expect(duplicateSemantics.idsOverlap).toBe(false)
  expect(duplicateSemantics.copyBindings).toHaveLength(
    duplicateSemantics.sourceBindings.length
  )
  expect(duplicateSemantics.copyBindings[0]).toMatchObject({
    fieldId: duplicateSemantics.sourceBindings[0]?.fieldId,
    property: duplicateSemantics.sourceBindings[0]?.property,
  })
  expect(duplicateSemantics.copyBindings[0]?.id).not.toBe(
    duplicateSemantics.sourceBindings[0]?.id
  )
  expect(duplicateSemantics.copyGroupCount).toBeGreaterThan(0)
  expect(duplicateSemantics.allGroupNodesBelongToCopy).toBe(true)
  expect(duplicateSemantics.allParentsBelongToCopy).toBe(true)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(sidebarPages).toHaveCount(6)

  await panel.getByRole("button", { name: "More actions for Overview" }).click()
  await page.getByRole("menuitem", { name: "Move up" }).click()
  await expect(sidebarPages.nth(0)).toHaveAccessibleName(
    "Open page 1: Overview"
  )
  await expect(filmstripPages.nth(0)).toHaveAccessibleName(
    "Open page 1: Overview"
  )

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(sidebarPages.nth(0)).toHaveAccessibleName("Open page 1: Cover")

  await panel.getByRole("button", { name: "More actions for Cover" }).click()
  await page.getByRole("menuitem", { name: "Page settings" }).click()
  const settings = page.getByRole("dialog", { name: "Page settings" })
  await settings.getByRole("textbox", { name: "Name" }).fill("Opening cover")
  await settings.getByRole("spinbutton", { name: "Width" }).fill("1080")

  await expect(page.getByText("Cover", { exact: true }).first()).toBeVisible()
  await settings.getByRole("button", { name: "Save page" }).click()
  await expect(
    page.getByText("Opening cover", { exact: true }).first()
  ).toBeVisible()
  await expect(
    page.getByText("1080 × 1754", { exact: true }).first()
  ).toBeVisible()
  await expect(filmstripPages.nth(0)).toHaveAccessibleName(
    "Open page 1: Opening cover"
  )

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(sidebarPages.nth(0)).toHaveAccessibleName("Open page 1: Cover")
  await expect(
    page.getByText("1240 × 1754", { exact: true }).first()
  ).toBeVisible()

  await panel.getByRole("button", { name: "More actions for Overview" }).click()
  await page.getByRole("menuitem", { name: "Delete page" }).click()
  const deletePageDialog = page.getByRole("alertdialog", {
    name: "Delete page?",
  })
  await expect(deletePageDialog).toContainText("undo")
  await deletePageDialog.getByRole("button", { name: "Delete" }).click()
  await expect(sidebarPages).toHaveCount(5)
  await expect(filmstripPages).toHaveCount(5)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(sidebarPages).toHaveCount(6)
  await waitForSaved(page)

  const persisted = await page.evaluate((storageKey) => {
    const value = localStorage.getItem(storageKey)
    if (!value) return null
    const document = JSON.parse(value) as {
      outputs: Array<{ id: string; pageIds: string[] }>
      pages: Array<{ id: string; outputId: string }>
    }
    return {
      outputPageIds: document.outputs.flatMap((output) => output.pageIds),
      pageIds: document.pages.map((candidate) => candidate.id),
      everyPageBelongsToOutput: document.pages.every((candidate) =>
        document.outputs.some(
          (output) =>
            output.id === candidate.outputId &&
            output.pageIds.includes(candidate.id)
        )
      ),
    }
  }, documentStorageKey)
  expect(persisted).not.toBeNull()
  expect(persisted?.everyPageBelongsToOutput).toBe(true)
  expect(new Set(persisted?.outputPageIds)).toEqual(new Set(persisted?.pageIds))
})

test("outputs are created and removed with one canonical first page", async ({
  page,
}) => {
  const panel = await openPagesPanel(page)
  await panel
    .getByRole("button", { name: "Add output", exact: true })
    .first()
    .click()
  const dialog = page.getByRole("dialog", { name: "New output" })
  await dialog
    .getByRole("textbox", { name: "Output name" })
    .fill("Instagram story")
  await dialog.getByRole("spinbutton", { name: "Width" }).fill("1080")
  await dialog.getByRole("spinbutton", { name: "Height" }).fill("1920")
  await dialog.getByRole("button", { name: "Create output" }).click()

  const newOutput = panel.getByRole("region", { name: "Instagram story" })
  await expect(newOutput).toBeVisible()
  await expect(
    newOutput.getByRole("button", { name: "Open page 1: Page 1" })
  ).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Instagram story pages" })
  ).toBeVisible()
  await expect(
    page.getByText("1080 × 1920", { exact: true }).first()
  ).toBeVisible()

  await newOutput
    .getByRole("button", { name: "More actions for Instagram story" })
    .click()
  await page.getByRole("menuitem", { name: "Delete output" }).click()
  const deleteOutputDialog = page.getByRole("alertdialog", {
    name: "Delete output?",
  })
  await expect(deleteOutputDialog).toContainText("1 page")
  await deleteOutputDialog.getByRole("button", { name: "Delete" }).click()
  await expect(newOutput).toBeHidden()
  await expect(
    page.getByRole("region", { name: "Quotation pages" })
  ).toBeVisible()
})

test("the first page and final output rules are explicit", async ({ page }) => {
  const panel = await openPagesPanel(page)
  const firstPageMenu = panel.getByRole("button", {
    name: "More actions for Cover",
  })
  await firstPageMenu.click()
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled()
  await page.keyboard.press("Escape")

  await panel
    .getByRole("button", { name: "More actions for Quotation", exact: true })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Delete output" })
  ).toBeDisabled()
})
