import { expect, test } from "@playwright/test"

test("Control-wheel zoom stays inside the canvas viewport", async ({
  page,
}) => {
  await page.goto("/")
  const viewport = page.getByLabel("Canvas viewport")
  const zoomDisplay = page.getByRole("button", { name: /Reset zoom to 100%/ })
  await expect(viewport).toBeVisible()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await page.getByRole("button", { name: "Fit canvas" }).click()

  const bounds = await viewport.boundingBox()
  if (!bounds) throw new Error("Canvas viewport bounds are unavailable")
  const before = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    scale: window.visualViewport?.scale ?? 1,
    width: document.documentElement.getBoundingClientRect().width,
  }))
  const zoomBefore = await zoomDisplay.textContent()

  await page.mouse.move(
    bounds.x + bounds.width * 0.62,
    bounds.y + bounds.height * 0.44
  )
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -80)
  await page.keyboard.up("Control")

  await expect(zoomDisplay).not.toHaveText(zoomBefore ?? "")
  await expect
    .poll(() =>
      page.evaluate(() => ({
        devicePixelRatio: window.devicePixelRatio,
        scale: window.visualViewport?.scale ?? 1,
        width: document.documentElement.getBoundingClientRect().width,
      }))
    )
    .toEqual(before)
})

test("ordinary wheel input pans without changing canvas zoom", async ({
  page,
}) => {
  await page.goto("/")
  const viewport = page.getByLabel("Canvas viewport")
  const zoomDisplay = page.getByRole("button", { name: /Reset zoom to 100%/ })
  await expect(viewport).toBeVisible()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await page.getByRole("button", { name: "Fit canvas" }).click()

  const bounds = await viewport.boundingBox()
  if (!bounds) throw new Error("Canvas viewport bounds are unavailable")
  const zoomBefore = await zoomDisplay.textContent()
  const transformBefore = await viewport
    .locator(":scope > div")
    .evaluate((element) => getComputedStyle(element).transform)

  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  )
  await page.mouse.wheel(36, 72)

  await expect(zoomDisplay).toHaveText(zoomBefore ?? "")
  await expect
    .poll(() =>
      viewport
        .locator(":scope > div")
        .evaluate((element) => getComputedStyle(element).transform)
    )
    .not.toBe(transformBefore)
})

test("modifier-wheel cancellation is scoped to the canvas viewport", async ({
  page,
}) => {
  await page.goto("/")
  const viewport = page.getByLabel("Canvas viewport")
  const templatesTab = page.getByRole("tab", { name: "Templates" })
  const zoomDisplay = page.getByRole("button", { name: /Reset zoom to 100%/ })
  await expect(viewport).toBeVisible()
  await expect(templatesTab).toBeVisible()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()

  const canvasCancellation = await viewport.evaluate((element) =>
    [
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -1,
      }),
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        deltaY: -1,
      }),
    ].map((event) => {
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
  )
  expect(canvasCancellation).toEqual([true, true])

  const zoomAfterCanvasEvents = await zoomDisplay.textContent()
  const sidebarCancellation = await templatesTab.evaluate((element) =>
    [
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -1,
      }),
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        deltaY: -1,
      }),
    ].map((event) => {
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
  )
  expect(sidebarCancellation).toEqual([false, false])
  await expect(zoomDisplay).toHaveText(zoomAfterCanvasEvents ?? "")

  await page.getByRole("button", { name: "Document file actions" }).click()
  await page.getByRole("menuitem", { name: "New document…" }).click()
  const dialog = page.getByRole("dialog", { name: "Start a document" })
  await expect(dialog).toBeVisible()
  const dialogCancellation = await dialog.evaluate((element) =>
    [
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -1,
      }),
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        deltaY: -1,
      }),
    ].map((event) => {
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
  )
  expect(dialogCancellation).toEqual([false, false])
  await expect(
    page.locator('button[aria-label^="Reset zoom to 100%"]')
  ).toHaveText(zoomAfterCanvasEvents ?? "")
})
