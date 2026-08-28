import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"
const quotationSourceStorageKey = "webmcp-studio:quotation-source:v1"
const quotationTemplateStorageKey = "webmcp-studio:quotation-template:v1"

type TestWebMcpResult = {
  structuredContent?: unknown
  isError?: boolean
}

type TestWebMcpTool = {
  name: string
  execute: (input: unknown) => TestWebMcpResult | Promise<TestWebMcpResult>
}

type Inspection = {
  document: { revision: number; operationVersion: number }
  activePageNodes: Array<{
    id: string
    name: string
    x: number
    width: number
    opacity: number
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

async function seedInspectorFixture(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => Boolean(localStorage.getItem(storageKey)),
        documentStorageKey
      )
    )
    .toBe(true)

  const serialized = await page.evaluate(
    ({ storageKey, sourceStorageKey, templateStorageKey }) => {
      const stored = localStorage.getItem(storageKey)
      if (!stored) throw new Error("The editor document was not persisted")
      const document = JSON.parse(stored) as {
        id: string
        name: string
        revision: number
        updatedAt: string
        pages: Array<{ nodeIds: string[] }>
        nodes: Array<Record<string, unknown>>
      }
      const firstPage = document.pages[0]
      const rect = (
        id: string,
        name: string,
        x: number,
        width: number,
        opacity: number,
        locked: boolean
      ) => ({
        id,
        name,
        type: "rect",
        x,
        y: 96,
        width,
        height: 80,
        rotation: 0,
        opacity,
        visible: true,
        locked,
        fill: "#D7E4D8",
        radius: 8,
        stroke: "#1E2622",
        strokeWidth: 1,
      })
      const nodes = [
        rect("inspector-alpha", "Inspector alpha", 80, 120, 1, false),
        rect("inspector-beta", "Inspector beta", 240, 160, 0.5, true),
      ]
      document.id = "inspector-e2e-document"
      document.name = "Inspector production fixture"
      document.revision = 0
      document.updatedAt = "2026-08-27T18:00:00.000Z"
      document.nodes.push(...nodes)
      firstPage.nodeIds.push(...nodes.map((node) => node.id))
      const next = JSON.stringify(document)
      localStorage.setItem(storageKey, next)
      localStorage.removeItem(sourceStorageKey)
      localStorage.removeItem(templateStorageKey)
      sessionStorage.clear()
      return next
    },
    {
      storageKey: documentStorageKey,
      sourceStorageKey: quotationSourceStorageKey,
      templateStorageKey: quotationTemplateStorageKey,
    }
  )

  await page.addInitScript(
    ({ storageKey, sourceStorageKey, templateStorageKey, documentValue }) => {
      localStorage.setItem(storageKey, documentValue)
      localStorage.removeItem(sourceStorageKey)
      localStorage.removeItem(templateStorageKey)
      sessionStorage.clear()
    },
    {
      storageKey: documentStorageKey,
      sourceStorageKey: quotationSourceStorageKey,
      templateStorageKey: quotationTemplateStorageKey,
      documentValue: serialized,
    }
  )
  await page.reload()
  await waitForEditor(page)
}

async function openLayers(page: Page) {
  await page.getByRole("tab", { name: "Layers", exact: true }).click()
  return page.getByRole("tree", { name: "Document layers" })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
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
  await waitForEditor(page)
  await seedInspectorFixture(page)
})

test("invalid drafts, Escape recovery, and locked controls stay truthful", async ({
  page,
}) => {
  const tree = await openLayers(page)
  await tree
    .getByRole("treeitem", { name: "Inspector alpha", exact: true })
    .click()
  const design = page.getByRole("tabpanel", { name: "Design" })
  const width = design.getByLabel("Width", { exact: true })
  const initial = await inspect(page)
  const initialNode = initial.activePageNodes.find(
    (node) => node.id === "inspector-alpha"
  )!

  await width.fill("-1")
  await width.press("Enter")
  await expect(width).toHaveAttribute("aria-invalid", "true")
  await expect(design.getByText("Width must be at least 1.")).toBeVisible()
  expect(
    (await inspect(page)).activePageNodes.find(
      (node) => node.id === "inspector-alpha"
    )?.width
  ).toBe(initialNode.width)

  await width.press("Escape")
  await expect(width).toHaveValue(String(initialNode.width))
  await expect(width).not.toHaveAttribute("aria-invalid")

  await width.fill("+20")
  await width.press("Enter")
  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.id === "inspector-alpha"
      )?.width
    })
    .toBe(initialNode.width + 20)

  await design.getByRole("button", { name: "Lock layer" }).click()
  await expect(
    design.getByText("This layer is locked.", { exact: false })
  ).toBeVisible()
  await expect(width).toBeDisabled()
  await expect(design.getByLabel("Fill", { exact: true })).toBeDisabled()
  await expect(design.getByRole("slider", { name: "Opacity" })).toBeDisabled()

  await design.getByRole("button", { name: "Unlock layer" }).click()
  await expect(width).toBeEnabled()
})

test("mixed selection is explicit and updates only editable layers atomically", async ({
  page,
}) => {
  const tree = await openLayers(page)
  const alpha = tree.getByRole("treeitem", {
    name: "Inspector alpha",
    exact: true,
  })
  const beta = tree.getByRole("treeitem", {
    name: "Inspector beta",
    exact: true,
  })
  await alpha.click()
  await beta.click({ modifiers: ["ControlOrMeta"] })

  const design = page.getByRole("tabpanel", { name: "Design" })
  await expect(design.getByText("2 layers", { exact: true })).toBeVisible()
  await expect(
    design.getByText("1 locked layer will be skipped", { exact: false })
  ).toBeVisible()
  const x = design.getByLabel("X", { exact: true })
  const opacity = design.getByLabel("Opacity", { exact: true })
  await expect(x).toHaveAttribute("placeholder", "Mixed")
  await expect(opacity).toHaveAttribute("placeholder", "Mixed")

  const before = await inspect(page)
  const betaBefore = before.activePageNodes.find(
    (node) => node.id === "inspector-beta"
  )!
  await x.fill("360")
  await x.press("Enter")

  await expect
    .poll(async () => {
      return (await inspect(page)).activePageNodes.find(
        (node) => node.id === "inspector-alpha"
      )?.x
    })
    .toBe(360)
  const after = await inspect(page)
  expect(
    after.activePageNodes.find((node) => node.id === "inspector-beta")?.x
  ).toBe(betaBefore.x)
  expect(after.document.operationVersion).toBe(
    before.document.operationVersion + 1
  )

  await page.getByRole("button", { name: "Undo" }).click()
  const undone = await inspect(page)
  expect(
    undone.activePageNodes.find((node) => node.id === "inspector-alpha")?.x
  ).toBe(
    before.activePageNodes.find((node) => node.id === "inspector-alpha")?.x
  )
})

test("compact properties uses the same validation and locked-state contract", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 })
  await page.getByRole("button", { name: "Open document panel" }).click()
  const documentDialog = page.getByRole("dialog", { name: "Document" })
  await documentDialog.getByRole("tab", { name: "Layers" }).click()
  await documentDialog
    .getByRole("treeitem", { name: "Inspector beta", exact: true })
    .click()
  await documentDialog.getByRole("button", { name: "Close" }).click()

  await page.getByRole("button", { name: "Open properties" }).click()
  const properties = page.getByRole("dialog", { name: "Properties" })
  await expect(
    properties.getByText("This layer is locked.", { exact: false })
  ).toBeVisible()
  await expect(properties.getByLabel("Width", { exact: true })).toBeDisabled()
  await properties.getByRole("button", { name: "Unlock layer" }).click()
  const width = properties.getByLabel("Width", { exact: true })
  await width.fill("0")
  await width.press("Enter")
  await expect(width).toHaveAttribute("aria-invalid", "true")
  await expect(properties.getByText("Width must be at least 1.")).toBeVisible()
})
