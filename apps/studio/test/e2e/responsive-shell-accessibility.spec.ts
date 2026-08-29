import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

test.describe.configure({ timeout: 90_000 })

const viewportWidths = [320, 360, 390, 430, 768, 1119, 1120, 1280, 1440, 1920]

const requiredOverflowActions = [
  /^Publish$|^Published v\d+$/,
  /^Open API Playground$/,
  /^New document…$/,
  /^Export document JSON$/,
  /^Import document JSON…$/,
  /^Import quotation source…$/,
  /^Export current page as PNG$/,
  /^\d+-page PDF$/,
]

async function openSampleEditor(page: Page) {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Studio documents" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
  await expect(page.getByLabel("Canvas viewport")).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
}

async function expectAutoFitArtboardCentered(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const viewport = document
          .querySelector('[aria-label="Canvas viewport"]')
          ?.getBoundingClientRect()
        const artboard = document
          .querySelector('[aria-label="Canvas viewport"] .upper-canvas')
          ?.getBoundingClientRect()
        if (!viewport || !artboard) return Number.POSITIVE_INFINITY
        const deltaX = Math.abs(
          artboard.left +
            artboard.width / 2 -
            (viewport.left + viewport.width / 2)
        )
        const deltaY = Math.abs(
          artboard.top +
            artboard.height / 2 -
            (viewport.top + viewport.height / 2)
        )
        return Math.max(deltaX, deltaY)
      })
    })
    .toBeLessThanOrEqual(1)
}

test("the editor shell keeps every business action reachable across the viewport matrix", async ({
  page,
}) => {
  await page.setViewportSize({ width: viewportWidths[0], height: 820 })
  await openSampleEditor(page)
  for (const width of viewportWidths) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 820 })
      await expect(page.getByLabel("Canvas viewport")).toBeVisible()
      await expect(page.locator("canvas.upper-canvas")).toBeVisible()
      await expectAutoFitArtboardCentered(page)

      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(
        layout.scrollWidth,
        `horizontal overflow at ${width}px`
      ).toBeLessThanOrEqual(layout.clientWidth)

      const moreActions = page.getByRole("button", {
        name: /More studio actions/,
      })
      await expect(moreActions).toBeVisible()
      const moreBounds = await moreActions.boundingBox()
      expect(moreBounds).not.toBeNull()
      expect(moreBounds!.x).toBeGreaterThanOrEqual(0)
      expect(moreBounds!.x + moreBounds!.width).toBeLessThanOrEqual(width)
      if (width < 1280) {
        expect(moreBounds!.width).toBeGreaterThanOrEqual(44)
        expect(moreBounds!.height).toBeGreaterThanOrEqual(44)
      }

      await moreActions.click()
      const menu = page.getByRole("menu", { name: /More studio actions/ })
      await expect(menu).toBeVisible()
      const menuBounds = await menu.boundingBox()
      expect(menuBounds).not.toBeNull()
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0)
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width)
      await menu.getByRole("menuitem", { name: "File", exact: true }).hover()
      for (const actionName of requiredOverflowActions) {
        await expect(
          page.getByRole("menuitem", { name: actionName })
        ).toBeVisible()
      }
      await page.keyboard.press("Escape")

      const documentPanelButton = page.getByRole("button", {
        name: "Open document panel",
      })
      const inspectorPanelButton = page.getByRole("button", {
        name: "Open properties",
      })
      if (width < 1280) {
        for (const button of [documentPanelButton, inspectorPanelButton]) {
          await expect(button).toBeVisible()
          const bounds = await button.boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds!.width).toBeGreaterThanOrEqual(44)
          expect(bounds!.height).toBeGreaterThanOrEqual(44)
        }
        await expect(page.getByRole("tab", { name: "Templates" })).toBeHidden()
      } else {
        await expect(documentPanelButton).toBeHidden()
        await expect(inspectorPanelButton).toBeHidden()
        await expect(page.getByRole("tab", { name: "Templates" })).toBeVisible()
        await expect(
          page.getByRole("separator", { name: "Resize document panel" })
        ).toHaveAttribute("aria-valuenow", "264")
        await expect(
          page.getByRole("separator", { name: "Resize properties panel" })
        ).toHaveAttribute("aria-valuenow", "336")
      }
    })
  }
})

test("compact panels trap focus, isolate the editor, close with Escape, and restore the real opener", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 })
  await openSampleEditor(page)

  const documentPanelButton = page.getByRole("button", {
    name: "Open document panel",
  })
  await documentPanelButton.click()

  const documentPanel = page.getByRole("dialog", {
    name: "Document",
  })
  await expect(documentPanel).toBeVisible()
  await expect(documentPanel).toHaveAccessibleDescription(
    "Choose a template, manage pages and outputs, or select a document layer."
  )
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "true")
  await expect(page.locator("main")).toHaveAttribute("inert", "")
  await expect
    .poll(() =>
      documentPanel.evaluate((panel) => panel.contains(document.activeElement))
    )
    .toBe(true)

  const closeButton = documentPanel.getByRole("button", { name: "Close" })
  await expect(closeButton).toHaveCount(1)
  const closeBounds = await closeButton.boundingBox()
  expect(closeBounds).not.toBeNull()
  expect(Math.round(closeBounds!.width)).toBeGreaterThanOrEqual(44)
  expect(Math.round(closeBounds!.height)).toBeGreaterThanOrEqual(44)

  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab")
    expect(
      await documentPanel.evaluate((panel) =>
        panel.contains(document.activeElement)
      ),
      `focus escaped after ${press + 1} Tab presses`
    ).toBe(true)
  }

  const backgroundFocusSucceeded = await page.evaluate(() => {
    const backgroundButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="More studio actions"]'
    )
    backgroundButton?.focus()
    return document.activeElement === backgroundButton
  })
  expect(backgroundFocusSucceeded).toBe(false)

  await page.keyboard.press("Escape")
  await expect(documentPanel).toBeHidden()
  await expect(documentPanelButton).toBeFocused()
  await expect(page.locator("main")).not.toHaveAttribute("inert", "")

  const inspectorPanelButton = page.getByRole("button", {
    name: "Open properties",
  })
  await inspectorPanelButton.click()
  const inspectorPanel = page.getByRole("dialog", { name: "Properties" })
  await expect(inspectorPanel).toBeVisible()
  await inspectorPanel.getByRole("button", { name: "Close" }).click()
  await expect(inspectorPanel).toBeHidden()
  await expect(inspectorPanelButton).toBeFocused()
})

test("compact field controls have unique IDs and labels focus the visible control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 })
  await openSampleEditor(page)

  await page.getByRole("button", { name: "Open properties" }).click()
  const inspectorPanel = page.getByRole("dialog", { name: "Properties" })
  await inspectorPanel.getByRole("tab", { name: "Fields" }).click()

  const fieldControlIds = await page
    .locator('[id*="field-"]')
    .evaluateAll((elements) => elements.map((element) => element.id))
  expect(new Set(fieldControlIds).size).toBe(fieldControlIds.length)

  await inspectorPanel.getByRole("button", { name: "New" }).click()
  const createDialog = page.getByRole("dialog", { name: "Create field" })
  const label = createDialog.getByText("Label", { exact: true })
  const labelInput = createDialog.getByRole("textbox", { name: "Label" })
  await label.click()
  await expect(labelInput).toBeFocused()
})

test("desktop workspace panels resize, collapse, restore, and persist without starving the canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSampleEditor(page)
  await page.evaluate(() =>
    localStorage.removeItem("webmcp-studio:shell-layout:v1")
  )
  await page.reload()

  const canvas = page.getByLabel("Canvas viewport")
  const documentSplitter = page.getByRole("separator", {
    name: "Resize document panel",
  })
  const propertiesSplitter = page.getByRole("separator", {
    name: "Resize properties panel",
  })
  await expect(documentSplitter).toHaveAttribute("aria-valuenow", "264")
  await expect(propertiesSplitter).toHaveAttribute("aria-valuenow", "336")
  expect((await canvas.boundingBox())?.width).toBeGreaterThanOrEqual(520)

  await documentSplitter.focus()
  await page.keyboard.press("ArrowRight")
  await expect(documentSplitter).toHaveAttribute("aria-valuenow", "272")
  await expect(documentSplitter).toBeFocused()

  await page.keyboard.press("Enter")
  await expect(documentSplitter).toBeHidden()
  const expandDocumentPanel = page.getByRole("button", {
    name: "Expand document panel",
  })
  await expect(expandDocumentPanel).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(documentSplitter).toHaveAttribute("aria-valuenow", "272")

  const filmstrip = page.locator('[data-page-filmstrip="gallery"]')
  await expect(filmstrip).toHaveAttribute("data-density", "compact")
  await page
    .getByRole("button", { name: "Comfortable page strip density" })
    .click()
  await expect(filmstrip).toHaveAttribute("data-density", "comfortable")

  await page.reload()
  await expect(
    page.getByRole("separator", { name: "Resize document panel" })
  ).toHaveAttribute("aria-valuenow", "272")
  await expect(page.locator('[data-page-filmstrip="gallery"]')).toHaveAttribute(
    "data-density",
    "comfortable"
  )
  expect(
    (await page.getByLabel("Canvas viewport").boundingBox())?.width
  ).toBeGreaterThanOrEqual(520)

  await page.setViewportSize({ width: 390, height: 820 })
  await expect(
    page.getByRole("separator", { name: "Resize document panel" })
  ).toBeHidden()
  await expect(
    page.getByRole("button", { name: "Open document panel" })
  ).toBeVisible()
})

test("saved maximum panel widths are correct on the first mounted frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSampleEditor(page)
  await page.evaluate(() => {
    localStorage.setItem(
      "webmcp-studio:shell-layout:v1",
      JSON.stringify({
        version: 1,
        leftPanel: { width: 360, collapsed: false },
        rightPanel: { width: 440, collapsed: false },
        filmstripDensity: "compact",
      })
    )
  })
  await page.addInitScript(() => {
    const geometryWindow = window as typeof window & {
      __studioFirstPanelGeometry?: { left: number; right: number }
    }
    const observer = new MutationObserver(() => {
      const left = document.getElementById("studio-document-panel")
      const right = document.getElementById("studio-properties-panel")
      if (!left || !right) return
      geometryWindow.__studioFirstPanelGeometry = {
        left: left.getBoundingClientRect().width,
        right: right.getBoundingClientRect().width,
      }
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  })

  await page.reload()
  await expect(
    page.getByRole("separator", { name: "Resize document panel" })
  ).toHaveAttribute("aria-valuenow", "360")
  await expect(
    page.getByRole("separator", { name: "Resize properties panel" })
  ).toHaveAttribute("aria-valuenow", "440")
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __studioFirstPanelGeometry?: { left: number; right: number }
            }
          ).__studioFirstPanelGeometry
      )
    )
    .toEqual({ left: 360, right: 440 })
})
