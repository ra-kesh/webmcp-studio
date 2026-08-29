import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

type TestWebMcpResult = {
  structuredContent?: unknown
  isError?: boolean
}

type TestWebMcpTool = {
  name: string
  execute: (input: unknown) => TestWebMcpResult | Promise<TestWebMcpResult>
}

type ImageNode = {
  id: string
  name: string
  type: "image"
  assetId: string
  x: number
  y: number
  width: number
  height: number
  placement: {
    mode: "fill" | "fit" | "manual"
    focalX: number
    focalY: number
    zoom: number
    rotation: number
    flipX: boolean
    flipY: boolean
  }
}

type Inspection = {
  document: {
    id: string
    revision: number
    snapshotId: string
    operationVersion: number
  }
  activePage: {
    id: string
    width: number
    height: number
  }
  activePageNodes: Array<ImageNode | { id: string; type: string }>
}

declare global {
  interface Window {
    __studioTestTools?: Map<string, TestWebMcpTool>
  }
}

async function inspect(page: Page) {
  const result = await page.evaluate(async () =>
    window.__studioTestTools?.get("inspect_design")?.execute({})
  )
  expect(result?.isError).not.toBe(true)
  return result?.structuredContent as Inspection
}

async function waitForEditor(page: Page) {
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
}

async function insertLibraryImage(page: Page) {
  await page.getByRole("button", { name: "Add image", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Add image" })
  await dialog.getByRole("tab", { name: "Library", exact: true }).click()
  await dialog
    .getByRole("button", { name: "Insert Sandstone arches", exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByText("All changes saved", { exact: true })
  ).toBeVisible()
  await expect
    .poll(async () =>
      (await inspect(page)).activePageNodes.some(
        (node) =>
          node.type === "image" &&
          "assetId" in node &&
          node.assetId === "library-sandstone-arches"
      )
    )
    .toBe(true)
  const node = (await inspect(page)).activePageNodes.find(
    (candidate): candidate is ImageNode =>
      candidate.type === "image" &&
      "assetId" in candidate &&
      candidate.assetId === "library-sandstone-arches"
  )
  if (!node) throw new Error("Inserted image was not found")
  return node
}

async function canvasPointForNode(page: Page, node: ImageNode) {
  const current = await inspect(page)
  const bounds = await page.locator("canvas.upper-canvas").boundingBox()
  if (!bounds) throw new Error("Canvas bounds are unavailable")
  return {
    x:
      bounds.x +
      ((node.x + node.width / 2) / current.activePage.width) * bounds.width,
    y:
      bounds.y +
      ((node.y + node.height / 2) / current.activePage.height) * bounds.height,
  }
}

async function enterCropFromInspector(page: Page) {
  const design = page.getByRole("tabpanel", { name: "Design" })
  const opener = design.getByRole("button", { name: "Crop image", exact: true })
  await opener.click()
  const toolbar = page.getByRole("toolbar", {
    name: "Crop image: Sandstone arches",
  })
  await expect(toolbar).toBeVisible()
  await expect(page.getByRole("button", { name: "Zoom out" })).not.toBeVisible()
  return { design, opener, toolbar }
}

async function previewZoomAndPan(
  page: Page,
  toolbar: ReturnType<Page["getByRole"]>,
  point: { x: number; y: number }
) {
  const zoom = toolbar.getByRole("textbox", {
    name: "Image zoom percentage",
  })
  await zoom.fill("150")
  await zoom.press("Enter")
  await expect(zoom).toHaveValue("150")
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 42, point.y + 26, { steps: 5 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    const tools = new Map<string, TestWebMcpTool>()
    window.__studioTestTools = tools
    const documentWithModelContext = document as Document & {
      modelContext?: {
        registerTool: (tool: TestWebMcpTool) => Promise<undefined>
      }
    }
    documentWithModelContext.modelContext = {
      registerTool: async (tool) => {
        tools.set(tool.name, tool)
        return undefined
      },
    }
  })
  await page.goto("/")
  await page
    .getByRole("button", { name: "Create blank document", exact: true })
    .click()
  const startDialog = page.getByRole("dialog", { name: "Start a document" })
  await startDialog
    .getByRole("button", { name: "Create document", exact: true })
    .click()
  await expect(startDialog).not.toBeVisible()
  await waitForEditor(page)
})

test("crop preview cancels cleanly and applies as one undoable transaction", async ({
  page,
}) => {
  const image = await insertLibraryImage(page)
  const baseline = await inspect(page)
  const handTool = page.getByRole("button", { name: "Hand tool", exact: true })
  await handTool.click()
  const canvas = page.locator("canvas.upper-canvas")

  const firstCrop = await enterCropFromInspector(page)
  await expect(handTool).toBeDisabled()
  const cameraBeforeCropDrag = await canvas.boundingBox()
  if (!cameraBeforeCropDrag) throw new Error("Canvas bounds are unavailable")
  const firstCropPoint = await canvasPointForNode(page, image)
  await expect(firstCrop.toolbar.getByRole("status")).toContainText(
    "Drag to reposition"
  )
  await previewZoomAndPan(page, firstCrop.toolbar, firstCropPoint)
  const cameraAfterCropDrag = await canvas.boundingBox()
  expect(cameraAfterCropDrag).toEqual(cameraBeforeCropDrag)

  expect((await inspect(page)).document).toEqual(baseline.document)
  await firstCrop.toolbar.getByRole("button", { name: "Cancel" }).click()
  await expect(firstCrop.toolbar).not.toBeVisible()
  await expect(firstCrop.opener).toBeFocused()
  await expect(handTool).toBeEnabled()
  expect((await inspect(page)).document).toEqual(baseline.document)

  const secondCrop = await enterCropFromInspector(page)
  const secondCropPoint = await canvasPointForNode(page, image)
  await previewZoomAndPan(page, secondCrop.toolbar, secondCropPoint)
  await secondCrop.toolbar.getByRole("button", { name: "Done" }).click()
  await expect(secondCrop.toolbar).not.toBeVisible()
  await expect(
    page.getByText("All changes saved", { exact: true })
  ).toBeVisible()

  const applied = await inspect(page)
  const appliedImage = applied.activePageNodes.find(
    (candidate): candidate is ImageNode => candidate.id === image.id
  )
  expect(applied.document.operationVersion).toBe(
    baseline.document.operationVersion + 1
  )
  expect(applied.document.revision).toBe(baseline.document.revision + 1)
  expect(appliedImage).toMatchObject({
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    placement: { mode: "manual" },
  })
  expect(appliedImage?.placement.zoom).toBeCloseTo(1.5, 10)
  expect(appliedImage?.placement.focalX).not.toBe(image.placement.focalX)
  expect(appliedImage?.placement.focalY).not.toBe(image.placement.focalY)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  const undone = await inspect(page)
  expect(undone.document.snapshotId).toBe(baseline.document.snapshotId)
  expect(undone.activePageNodes.find((node) => node.id === image.id)).toEqual(
    image
  )

  await page.getByRole("button", { name: "Redo", exact: true }).click()
  const redone = await inspect(page)
  expect(redone.document.snapshotId).toBe(applied.document.snapshotId)
  expect(redone.activePageNodes.find((node) => node.id === image.id)).toEqual(
    appliedImage
  )
})

test("image double-click owns crop while modifier-wheel remains camera-owned", async ({
  page,
}) => {
  const image = await insertLibraryImage(page)
  const point = await canvasPointForNode(page, image)
  const canvas = page.locator("canvas.upper-canvas")
  const artboard = canvas.locator("xpath=../../..").first()
  const artboardBefore = await artboard.boundingBox()
  if (!artboardBefore) throw new Error("Artboard bounds are unavailable")

  await page.mouse.dblclick(point.x, point.y)
  const toolbar = page.getByRole("toolbar", {
    name: "Crop image: Sandstone arches",
  })
  await expect(toolbar).toBeVisible()
  const imageZoom = toolbar.getByRole("textbox", {
    name: "Image zoom percentage",
  })
  await expect(imageZoom).toHaveValue("100")

  const preventedBrowserZoom = await canvas.evaluate((element) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: element.getBoundingClientRect().left + 100,
      clientY: element.getBoundingClientRect().top + 100,
      ctrlKey: true,
      deltaY: -80,
    })
    element.dispatchEvent(event)
    return event.defaultPrevented
  })

  expect(preventedBrowserZoom).toBe(true)
  await expect(imageZoom).toHaveValue("100")
  await expect
    .poll(async () => (await artboard.boundingBox())?.width ?? 0)
    .not.toBeCloseTo(artboardBefore.width, 5)

  await page.keyboard.press("Escape")
  await expect(toolbar).not.toBeVisible()
})
