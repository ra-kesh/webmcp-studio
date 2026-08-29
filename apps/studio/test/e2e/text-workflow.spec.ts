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

type Inspection = {
  document: {
    id: string
    revision: number
    snapshotId: string
    operationVersion: number
  }
  activePage?: {
    id: string
    width: number
    height: number
  }
  fields: Array<{ key: string; value: string | number | boolean }>
  activePageNodes: Array<{
    id: string
    name: string
    type: string
    text?: string
    sizingMode?: "auto_width" | "auto_height" | "fixed"
    x: number
    y: number
    width: number
    height: number
    rotation: number
    visible: boolean
    locked: boolean
  }>
}

declare global {
  interface Window {
    __studioTestTools?: Map<string, TestWebMcpTool>
  }
}

async function waitForEditor(page: Page) {
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
}

async function inspect(page: Page) {
  const result = await page.evaluate(async () =>
    window.__studioTestTools?.get("inspect_design")?.execute({})
  )
  expect(result?.isError).not.toBe(true)
  return result?.structuredContent as Inspection
}

async function insertTextPreset(
  page: Page,
  preset: "Heading" | "Subheading" | "Body" | "Caption"
) {
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: new RegExp(`^${preset}`) }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  return hiddenTextarea
}

async function expectTextEditingInactive(page: Page) {
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect
    .poll(async () => {
      if ((await hiddenTextarea.count()) === 0) return true
      return hiddenTextarea.evaluate(
        (element) => element !== document.activeElement
      )
    })
    .toBe(true)
}

async function canvasPointForNode(page: Page, nodeId: string) {
  const current = await inspect(page)
  const activePage = current.activePage
  const node = current.activePageNodes.find(
    (candidate) => candidate.id === nodeId
  )
  const canvas = page.locator("canvas.upper-canvas")
  const bounds = await canvas.boundingBox()
  if (!activePage || !node || !bounds) {
    throw new Error(`Canvas coordinates are unavailable for ${nodeId}`)
  }
  return {
    x: bounds.x + ((node.x + node.width / 2) / activePage.width) * bounds.width,
    y:
      bounds.y +
      ((node.y + node.height / 2) / activePage.height) * bounds.height,
  }
}

async function blankCanvasPoint(page: Page) {
  const current = await inspect(page)
  const activePage = current.activePage
  const canvas = page.locator("canvas.upper-canvas")
  const bounds = await canvas.boundingBox()
  if (!activePage || !bounds) throw new Error("Canvas bounds are unavailable")

  const candidates = [
    [0.04, 0.5],
    [0.96, 0.5],
    [0.5, 0.04],
    [0.5, 0.96],
    [0.04, 0.04],
    [0.96, 0.96],
  ] as const
  const pagePoint = candidates.find(([xRatio, yRatio]) => {
    const x = activePage.width * xRatio
    const y = activePage.height * yRatio
    return current.activePageNodes.every(
      (node) =>
        !node.visible ||
        x < node.x ||
        x > node.x + node.width ||
        y < node.y ||
        y > node.y + node.height
    )
  })
  if (!pagePoint) {
    throw new Error("No uncovered point is available on the active canvas")
  }
  return {
    x: bounds.x + pagePoint[0] * bounds.width,
    y: bounds.y + pagePoint[1] * bounds.height,
  }
}

async function expectMinimumTargetSize(
  locator: ReturnType<Page["locator"]>,
  minimum = 44
) {
  const box = await locator.boundingBox()
  expect(box, "interactive control must have a measurable box").not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(minimum)
  expect(box!.height).toBeGreaterThanOrEqual(minimum)
}

async function beginPendingReview(page: Page) {
  const current = await inspect(page)
  const field = current.fields[0]
  const result = await page.evaluate(
    async ({ document, key, value }) =>
      window.__studioTestTools?.get("propose_field_updates")?.execute({
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: document.snapshotId,
        values: { [key]: `${value} — Review` },
        reason: "Text edit session boundary",
      }),
    { document: current.document, key: field.key, value: field.value }
  )
  expect(result?.isError).not.toBe(true)
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
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await waitForEditor(page)
})

test("T inserts the documented Body preset and enters direct editing", async ({
  page,
}) => {
  const before = await inspect(page)
  const existingIds = new Set(before.activePageNodes.map((node) => node.id))

  await page.keyboard.press("t")

  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  await expect(hiddenTextarea).toHaveValue("Add body text")
  const after = await inspect(page)
  const inserted = after.activePageNodes.find(
    (node) => !existingIds.has(node.id)
  )
  expect(inserted).toMatchObject({
    name: "Body",
    type: "text",
    text: "Add body text",
    sizingMode: "auto_height",
  })
  expect(after.document.operationVersion).toBe(
    before.document.operationVersion + 1
  )
})

test("existing text double-click edits while blank-canvas double-click zooms", async ({
  page,
}) => {
  const beforeInsert = await inspect(page)
  const existingIds = new Set(
    beforeInsert.activePageNodes.map((node) => node.id)
  )
  const hiddenTextarea = await insertTextPreset(page, "Body")
  await hiddenTextarea.press("Escape")
  const inserted = (await inspect(page)).activePageNodes.find(
    (node) => !existingIds.has(node.id)
  )
  if (!inserted) throw new Error("Inserted Body layer was not found")

  const zoomDisplay = page.getByRole("button", {
    name: /Reset zoom to 100%/,
  })
  const zoomBeforeText = await zoomDisplay.textContent()
  const textPoint = await canvasPointForNode(page, inserted.id)
  await page.mouse.dblclick(textPoint.x, textPoint.y)
  await expect(hiddenTextarea).toBeFocused()
  await expect(hiddenTextarea).toHaveValue("Add body text")
  await expect(zoomDisplay).toHaveText(zoomBeforeText ?? "")

  await hiddenTextarea.press("Escape")
  const blankPoint = await blankCanvasPoint(page)
  const zoomBeforeBlank = await zoomDisplay.textContent()
  await page.mouse.dblclick(blankPoint.x, blankPoint.y)
  await expectTextEditingInactive(page)
  await expect(zoomDisplay).not.toHaveText(zoomBeforeBlank ?? "")
})

test("all text sizing modes own the documented geometry axes", async ({
  page,
}) => {
  const hiddenTextarea = await insertTextPreset(page, "Caption")
  await hiddenTextarea.press("Escape")
  const design = page.getByRole("tabpanel", { name: "Design" })
  const width = design.getByLabel("Width", { exact: true })
  const height = design.getByLabel("Height", { exact: true })
  const autoWidth = design.getByRole("radio", { name: "Auto width" })
  const autoHeight = design.getByRole("radio", { name: "Auto height" })
  const fixed = design.getByRole("radio", { name: "Fixed text box" })
  const initial = await inspect(page)

  await expect(autoWidth).toBeChecked()
  await expect(width).toBeDisabled()
  await expect(height).toBeDisabled()

  await autoHeight.click()
  await expect(autoHeight).toBeChecked()
  await expect(width).toBeEnabled()
  await expect(height).toBeDisabled()
  expect((await inspect(page)).document.operationVersion).toBe(
    initial.document.operationVersion + 1
  )

  await fixed.click()
  await expect(fixed).toBeChecked()
  await expect(width).toBeEnabled()
  await expect(height).toBeEnabled()
  expect((await inspect(page)).document.operationVersion).toBe(
    initial.document.operationVersion + 2
  )

  await autoWidth.click()
  await expect(autoWidth).toBeChecked()
  await expect(width).toBeDisabled()
  await expect(height).toBeDisabled()
  const final = await inspect(page)
  expect(final.document.operationVersion).toBe(
    initial.document.operationVersion + 3
  )
  expect(
    final.activePageNodes.find((node) => node.name === "Caption")
  ).toMatchObject({ sizingMode: "auto_width" })
})

test("locked and mixed auto-sizing selections keep managed axes unavailable", async ({
  page,
}) => {
  const captionEditor = await insertTextPreset(page, "Caption")
  await captionEditor.press("Escape")
  const design = page.getByRole("tabpanel", { name: "Design" })
  const layerName = design.getByLabel("Layer name", { exact: true })
  await layerName.fill("Auto-width caption")
  await layerName.press("Enter")
  await design.getByRole("button", { name: "Lock layer" }).click()
  await expect(design.getByRole("radio", { name: "Auto width" })).toBeDisabled()
  await expect(design.getByLabel("Width", { exact: true })).toBeDisabled()
  await expect(design.getByLabel("Height", { exact: true })).toBeDisabled()
  await design.getByRole("button", { name: "Unlock layer" }).click()

  const bodyEditor = await insertTextPreset(page, "Body")
  await bodyEditor.press("Escape")
  await design.getByLabel("Layer name", { exact: true }).fill("Flexible body")
  await design.getByLabel("Layer name", { exact: true }).press("Enter")

  await page.getByRole("tab", { name: "Layers", exact: true }).click()
  const tree = page.getByRole("tree", { name: "Document layers" })
  await tree
    .getByRole("treeitem", { name: "Flexible body", exact: true })
    .click()
  await tree
    .getByRole("treeitem", {
      name: "Auto-width caption",
      exact: true,
    })
    .click({ modifiers: ["ControlOrMeta"] })

  await expect(design.getByText("2 layers", { exact: true })).toBeVisible()
  await expect(
    design.getByText("Auto-sizing text manages its width and height", {
      exact: false,
    })
  ).toBeVisible()
  await expect(design.getByLabel("Width", { exact: true })).toBeDisabled()
  await expect(design.getByLabel("Height", { exact: true })).toBeDisabled()
})

test("fixed text reports horizontal and vertical clipping independently", async ({
  page,
}) => {
  const hiddenTextarea = await insertTextPreset(page, "Body")
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("Supercalifragilisticexpialidocious")
  await hiddenTextarea.press("Tab")
  const design = page.getByRole("tabpanel", { name: "Design" })
  await design.getByRole("radio", { name: "Fixed text box" }).click()
  const width = design.getByLabel("Width", { exact: true })
  const height = design.getByLabel("Height", { exact: true })
  const overflow = design.locator('[role="status"][data-overflow-x]')

  await height.fill("5000")
  await height.press("Enter")
  await width.fill("1")
  await width.press("Enter")
  await expect(overflow).toHaveAttribute("data-overflow-x", "true")
  await expect(overflow).toHaveAttribute("data-overflow-y", "false")
  await expect(
    overflow.getByText("Text is clipped horizontally", { exact: true })
  ).toBeVisible()
  const beforeHorizontalRepair = await inspect(page)
  await overflow
    .getByRole("button", { name: "Resize box to fit", exact: true })
    .click()
  await expect(design.getByRole("radio", { name: "Auto width" })).toBeChecked()
  await expect(overflow).toHaveCount(0)
  expect((await inspect(page)).document.operationVersion).toBe(
    beforeHorizontalRepair.document.operationVersion + 1
  )

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(
    design.getByRole("radio", { name: "Fixed text box" })
  ).toBeChecked()
  await expect(overflow).toHaveAttribute("data-overflow-x", "true")
  await expect(overflow).toHaveAttribute("data-overflow-y", "false")

  await width.fill("1000")
  await width.press("Enter")
  await height.fill("1")
  await height.press("Enter")
  await expect(overflow).toHaveAttribute("data-overflow-x", "false")
  await expect(overflow).toHaveAttribute("data-overflow-y", "true")
  await expect(
    overflow.getByText("Text is clipped vertically", { exact: true })
  ).toBeVisible()
  await expect(
    overflow.getByRole("button", {
      name: "Resize height to fit",
      exact: true,
    })
  ).toBeVisible()
})

test("direct editing derives geometry in one transaction and Undo restores both", async ({
  page,
}) => {
  const beforeInsert = await inspect(page)
  const existingIds = new Set(
    beforeInsert.activePageNodes.map((node) => node.id)
  )
  const hiddenTextarea = await insertTextPreset(page, "Body")
  await hiddenTextarea.press("Escape")
  const beforeEdit = await inspect(page)
  const bodyBefore = beforeEdit.activePageNodes.find(
    (node) => !existingIds.has(node.id)
  )
  if (!bodyBefore) throw new Error("Inserted Body layer was not found")

  const point = await canvasPointForNode(page, bodyBefore.id)
  await page.mouse.dblclick(point.x, point.y)
  await expect(hiddenTextarea).toBeFocused()
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill(
    "First paragraph that wraps across the available width.\nSecond paragraph adds another explicit line.\nThird paragraph makes the derived height unambiguous."
  )
  await hiddenTextarea.press("Tab")

  const afterEdit = await inspect(page)
  const bodyAfter = afterEdit.activePageNodes.find(
    (node) => node.id === bodyBefore.id
  )
  expect(bodyAfter?.text).toContain("Third paragraph")
  expect(bodyAfter?.height).toBeGreaterThan(bodyBefore.height)
  expect(afterEdit.document.operationVersion).toBe(
    beforeEdit.document.operationVersion + 1
  )

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect
    .poll(async () => {
      const node = (await inspect(page)).activePageNodes.find(
        (candidate) => candidate.id === bodyBefore.id
      )
      return node
        ? { text: node.text, width: node.width, height: node.height }
        : null
    })
    .toEqual({
      text: bodyBefore.text,
      width: bodyBefore.width,
      height: bodyBefore.height,
    })
})

test("compact text presets and text controls meet the touch-target contract", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 })
  await page.getByRole("button", { name: "More studio actions" }).click()
  for (const preset of ["Heading", "Subheading", "Body", "Caption"]) {
    const item = page.getByRole("menuitem", { name: new RegExp(`^${preset}`) })
    await expect(item).toBeVisible()
    await expectMinimumTargetSize(item)
  }
  await page.getByRole("menuitem", { name: /^Body/ }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  await hiddenTextarea.press("Escape")

  await page.getByRole("button", { name: "Open properties" }).click()
  const properties = page.getByRole("dialog", { name: "Properties" })
  for (const name of ["Auto width", "Auto height", "Fixed text box"]) {
    const control = properties.getByRole("radio", { name })
    await control.scrollIntoViewIfNeeded()
    await expectMinimumTargetSize(control)
  }
  const fontFamily = properties.getByRole("combobox")
  await fontFamily.scrollIntoViewIfNeeded()
  await expectMinimumTargetSize(fontFamily)
  for (const name of [
    "Align text left",
    "Align text center",
    "Align text right",
  ]) {
    const control = properties.getByRole("button", { name })
    await control.scrollIntoViewIfNeeded()
    await expectMinimumTargetSize(control)
  }
  for (const name of ["Bulleted list", "Numbered list"]) {
    const control = properties.getByRole("radio", { name })
    await control.scrollIntoViewIfNeeded()
    await expectMinimumTargetSize(control)
  }

  await properties.getByRole("radio", { name: "Fixed text box" }).click()
  const height = properties.getByLabel("Height", { exact: true })
  await height.fill("1")
  await height.press("Enter")
  const repair = properties.getByRole("button", {
    name: "Resize height to fit",
    exact: true,
  })
  await repair.scrollIntoViewIfNeeded()
  await expectMinimumTargetSize(repair)
})

test("preset insertion starts direct editing and commits one content update", async ({
  page,
}) => {
  const before = await inspect(page)
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Heading/ }).click()

  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  await expect(hiddenTextarea).toHaveValue("Add a heading")
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("A proposal worth remembering")
  await hiddenTextarea.press("Tab")

  await expect
    .poll(async () => {
      const node = (await inspect(page)).activePageNodes.find(
        (candidate) => candidate.name === "Heading"
      )
      return node?.text
    })
    .toBe("A proposal worth remembering")

  const after = await inspect(page)
  const heading = after.activePageNodes.find((node) => node.name === "Heading")
  expect(heading).toMatchObject({
    type: "text",
    sizingMode: "auto_height",
  })
  expect(heading?.height).toBeGreaterThan(0)
  expect(after.document.operationVersion).toBe(
    before.document.operationVersion + 2
  )

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (candidate) => candidate.name === "Heading"
      )?.text
    })
    .toBe("Add a heading")
})

test("fixed text exposes overflow and repairs it as one undoable command", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Body/ }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill(
    "A deliberately long paragraph that needs more than one line in a fixed text box."
  )
  await hiddenTextarea.press("Tab")

  const design = page.getByRole("tabpanel", { name: "Design" })
  await design.getByRole("radio", { name: "Fixed text box" }).click()
  const height = design.getByLabel("Height", { exact: true })
  await expect(height).toBeEnabled()
  await height.fill("1")
  await height.press("Enter")
  await expect(design.getByText(/^Text is clipped/)).toBeVisible()

  const beforeRepair = await inspect(page)
  await design
    .getByRole("button", { name: "Resize height to fit", exact: true })
    .click()
  await expect(design.getByRole("radio", { name: "Auto height" })).toBeChecked()
  await expect(height).toBeDisabled()
  await expect(design.getByText(/^Text is clipped/)).toHaveCount(0)

  const afterRepair = await inspect(page)
  expect(afterRepair.document.operationVersion).toBe(
    beforeRepair.document.operationVersion + 1
  )
  const body = afterRepair.activePageNodes.find((node) => node.name === "Body")
  expect(body?.sizingMode).toBe("auto_height")
  expect(body?.height).toBeGreaterThan(1)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(
    design.getByRole("radio", { name: "Fixed text box" })
  ).toBeChecked()
  await expect(design.getByText(/^Text is clipped/)).toBeVisible()
})

test("Escape cancels direct editing without a document or geometry mutation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Caption/ }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  const beforeEdit = await inspect(page)
  const captionBefore = beforeEdit.activePageNodes.find(
    (node) => node.name === "Caption"
  )!

  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("This edit must be cancelled")
  await hiddenTextarea.press("Escape")

  await expectTextEditingInactive(page)
  const afterCancel = await inspect(page)
  const captionAfter = afterCancel.activePageNodes.find(
    (node) => node.id === captionBefore.id
  )
  expect(captionAfter).toMatchObject({
    text: captionBefore.text,
    width: captionBefore.width,
    height: captionBefore.height,
  })
  expect(afterCancel.document.operationVersion).toBe(
    beforeEdit.document.operationVersion
  )
})

test("starting review cancels an active edit before the canvas becomes read-only", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Body/ }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  const beforeReview = await inspect(page)
  const bodyBefore = beforeReview.activePageNodes.find(
    (node) => node.name === "Body"
  )!
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("Uncommitted text must not leak into review")

  await beginPendingReview(page)
  await expect(page.getByRole("tab", { name: "Review" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expectTextEditingInactive(page)

  const underReview = await inspect(page)
  expect(
    underReview.activePageNodes.find((node) => node.id === bodyBefore.id)?.text
  ).toBe(bodyBefore.text)
  expect(underReview.document.operationVersion).toBe(
    beforeReview.document.operationVersion
  )
})

test("selecting another layer commits the active edit as one transaction", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Caption/ }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  const beforeSwitch = await inspect(page)
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("Committed by changing selection")

  await page.getByRole("tab", { name: "Layers", exact: true }).click()
  await page.getByRole("button", { name: "Expand Cover layout" }).click()
  await page.getByRole("button", { name: "Expand Cover identity" }).click()
  await page
    .getByRole("treeitem", { name: "Quotation title", exact: true })
    .click()

  await expectTextEditingInactive(page)
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.name === "Caption"
      )?.text
    })
    .toBe("Committed by changing selection")
  expect((await inspect(page)).document.operationVersion).toBe(
    beforeSwitch.document.operationVersion + 1
  )
})

test("changing pages commits the active edit before replacing the canvas", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Caption/ }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  const beforeSwitch = await inspect(page)
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("Committed before page navigation")

  await page.getByRole("button", { name: "Open page 2: Overview" }).click()
  await expectTextEditingInactive(page)
  await page.getByRole("button", { name: "Open page 1: Cover" }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.name === "Caption"
      )?.text
    })
    .toBe("Committed before page navigation")
  expect((await inspect(page)).document.operationVersion).toBe(
    beforeSwitch.document.operationVersion + 1
  )
})

test("bulleted multi-paragraph editing continues, indents, terminates, and removes markers in one transaction", async ({
  page,
}) => {
  const beforeInsert = await inspect(page)
  const existingIds = new Set(
    beforeInsert.activePageNodes.map((node) => node.id)
  )
  const hiddenTextarea = await insertTextPreset(page, "Body")
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("Alpha\n\n  Beta")
  await hiddenTextarea.press("Tab")
  const inserted = (await inspect(page)).activePageNodes.find(
    (node) => !existingIds.has(node.id)
  )
  if (!inserted) throw new Error("Inserted Body layer was not found")

  const design = page.getByRole("tabpanel", { name: "Design" })
  await design.getByRole("radio", { name: "Bulleted list" }).click()
  const listed = await inspect(page)
  const listBaseline = listed.activePageNodes.find(
    (node) => node.id === inserted.id
  )
  expect(listBaseline?.text).toBe("• Alpha\n\n  • Beta")

  const point = await canvasPointForNode(page, inserted.id)
  await page.mouse.dblclick(point.x, point.y)
  await expect(hiddenTextarea).toBeFocused()
  await hiddenTextarea.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
  })

  await hiddenTextarea.press("Enter")
  await expect(hiddenTextarea).toHaveValue("• Alpha\n\n  • Beta\n  • ")
  await hiddenTextarea.pressSequentially("Gamma")
  await hiddenTextarea.press("Tab")
  await expect(hiddenTextarea).toHaveValue("• Alpha\n\n  • Beta\n    • Gamma")
  await hiddenTextarea.press("Shift+Tab")
  await expect(hiddenTextarea).toHaveValue("• Alpha\n\n  • Beta\n  • Gamma")

  await hiddenTextarea.press("Enter")
  await hiddenTextarea.press("Enter")
  await hiddenTextarea.pressSequentially("Plain note")
  await expect(hiddenTextarea).toHaveValue(
    "• Alpha\n\n  • Beta\n  • Gamma\nPlain note"
  )

  const betaContentStart = "• Alpha\n\n  • ".length
  await hiddenTextarea.evaluate((element, offset) => {
    const textarea = element as HTMLTextAreaElement
    textarea.selectionStart = offset
    textarea.selectionEnd = offset
  }, betaContentStart)
  await hiddenTextarea.press("Backspace")
  const editedText = "• Alpha\n\n  Beta\n  • Gamma\nPlain note"
  await expect(hiddenTextarea).toHaveValue(editedText)
  expect((await inspect(page)).document.operationVersion).toBe(
    listed.document.operationVersion
  )

  await page.getByRole("button", { name: "Open page 2: Overview" }).click()
  await expectTextEditingInactive(page)
  expect((await inspect(page)).document.operationVersion).toBe(
    listed.document.operationVersion + 1
  )
  await page.getByRole("button", { name: "Open page 1: Cover" }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.id === inserted.id
      )?.text
    })
    .toBe(editedText)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.id === inserted.id
      )?.text
    })
    .toBe(listBaseline?.text)
})

test("numbered multi-paragraph editing inserts and renumbers siblings before one commit", async ({
  page,
}) => {
  const beforeInsert = await inspect(page)
  const existingIds = new Set(
    beforeInsert.activePageNodes.map((node) => node.id)
  )
  const hiddenTextarea = await insertTextPreset(page, "Body")
  await hiddenTextarea.press("ControlOrMeta+A")
  await hiddenTextarea.fill("Alpha\nBeta")
  await hiddenTextarea.press("Tab")
  const inserted = (await inspect(page)).activePageNodes.find(
    (node) => !existingIds.has(node.id)
  )
  if (!inserted) throw new Error("Inserted Body layer was not found")

  const design = page.getByRole("tabpanel", { name: "Design" })
  await design.getByRole("radio", { name: "Numbered list" }).click()
  const listed = await inspect(page)
  expect(
    listed.activePageNodes.find((node) => node.id === inserted.id)?.text
  ).toBe("1. Alpha\n2. Beta")

  const point = await canvasPointForNode(page, inserted.id)
  await page.mouse.dblclick(point.x, point.y)
  await expect(hiddenTextarea).toBeFocused()
  await hiddenTextarea.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement
    const firstLineEnd = textarea.value.indexOf("\n")
    textarea.selectionStart = firstLineEnd
    textarea.selectionEnd = firstLineEnd
  })
  await hiddenTextarea.press("Enter")
  await expect(hiddenTextarea).toHaveValue("1. Alpha\n2. \n3. Beta")
  await hiddenTextarea.pressSequentially("Inserted")
  const editedText = "1. Alpha\n2. Inserted\n3. Beta"
  await expect(hiddenTextarea).toHaveValue(editedText)
  expect((await inspect(page)).document.operationVersion).toBe(
    listed.document.operationVersion
  )

  await page.getByRole("button", { name: "Open page 2: Overview" }).click()
  await expectTextEditingInactive(page)
  expect((await inspect(page)).document.operationVersion).toBe(
    listed.document.operationVersion + 1
  )
  await page.getByRole("button", { name: "Open page 1: Cover" }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.id === inserted.id
      )?.text
    })
    .toBe(editedText)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.id === inserted.id
      )?.text
    })
    .toBe("1. Alpha\n2. Beta")
})

test("paragraph list controls switch markers without stacking and undo cleanly", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text", exact: true }).click()
  await page.getByRole("menuitem", { name: /^Subheading/ }).click()
  const hiddenTextarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(hiddenTextarea).toBeFocused()
  await hiddenTextarea.press("Escape")

  const design = page.getByRole("tabpanel", { name: "Design" })
  const before = await inspect(page)
  await design.getByRole("radio", { name: "Bulleted list" }).click()
  await expect(
    design.getByRole("radio", { name: "Bulleted list" })
  ).toBeChecked()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.name === "Subheading"
      )?.text
    })
    .toBe("• Add a subheading")
  expect((await inspect(page)).document.operationVersion).toBe(
    before.document.operationVersion + 1
  )

  await design.getByRole("radio", { name: "Numbered list" }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.name === "Subheading"
      )?.text
    })
    .toBe("1. Add a subheading")

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.name === "Subheading"
      )?.text
    })
    .toBe("• Add a subheading")
})
