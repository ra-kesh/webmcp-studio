import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

test.describe.configure({ timeout: 90_000 })

async function openSampleEditor(page: Page) {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Studio documents" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
}

test.beforeEach(async ({ page }) => {
  await openSampleEditor(page)
})

test("blank canvas and command search share a working page-scoped Select all", async ({
  page,
}) => {
  const viewport = page.getByLabel("Canvas viewport")

  await viewport.click({ button: "right", position: { x: 20, y: 20 } })
  const selectAllMenuItem = page.getByRole("menuitem", {
    name: /^Select all/,
  })
  await expect(selectAllMenuItem).toBeEnabled()
  await expect(selectAllMenuItem).not.toContainText("needs a target")
  await selectAllMenuItem.click()
  await expect(page.getByRole("heading", { name: "9 layers" })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(
    page.getByText("Nothing selected", { exact: true })
  ).toBeVisible()
  await page.keyboard.press("Meta+k")
  const commandSearch = page.getByRole("dialog", { name: "Command search" })
  await commandSearch
    .getByRole("combobox", { name: "Search commands" })
    .fill("select all")
  const selectAllOption = commandSearch.getByRole("option", {
    name: /^Select all/,
  })
  await expect(selectAllOption).toBeEnabled()
  await expect(selectAllOption).not.toContainText("needs a target")
  await selectAllOption.click()
  await expect(page.getByRole("heading", { name: "9 layers" })).toBeVisible()
})

test("desktop menubar and compact More menu expose the same command search", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const applicationMenu = page.getByRole("menubar", {
    name: "Application menu",
  })
  await expect(applicationMenu).toBeVisible()
  await applicationMenu.getByRole("menuitem", { name: "Help" }).click()
  await expect(
    page.getByRole("menuitem", { name: /^Search commands/ })
  ).toBeVisible()
  await page.keyboard.press("Escape")

  await page.setViewportSize({ width: 390, height: 844 })
  const more = page.getByRole("button", { name: "More studio actions" })
  await more.click()
  const compactMenu = page.getByRole("menu", { name: "More studio actions" })
  await compactMenu.getByRole("menuitem", { name: "Help" }).click()
  await page.getByRole("menuitem", { name: /^Search commands/ }).click()
  const dialog = page.getByRole("dialog", { name: "Command search" })
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
})
