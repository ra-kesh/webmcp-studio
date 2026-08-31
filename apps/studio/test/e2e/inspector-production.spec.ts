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
  document: { revision: number; operationVersion: number }
  activePageNodes: Array<{
    id: string
    name: string
    x: number
    width: number
    opacity: number
    locked: boolean
    fill?: string
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
  const serialized = await page.evaluate(async () => {
    const match = location.pathname.match(/^\/documents\/([^/]+)$/)
    const documentId = match?.[1] ? decodeURIComponent(match[1]) : null
    if (!documentId) throw new Error("The editor is not on a document route")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webmcp-studio-documents")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error("Document database did not open"))
    })
    const stored = await new Promise<
      | {
          document?: {
            id: string
            name: string
            revision: number
            updatedAt: string
            pages: Array<{ nodeIds: string[] }>
            nodes: Array<Record<string, unknown>>
          }
        }
      | undefined
    >((resolve, reject) => {
      const request = database
        .transaction("draft-body")
        .objectStore("draft-body")
        .get(documentId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error("Document draft did not load"))
    }).finally(() => database.close())
    if (!stored?.document) {
      throw new Error("The canonical editor document was not persisted")
    }
    const document = structuredClone(stored.document) as {
      id: string
      name: string
      revision: number
      updatedAt: string
      pages: Array<{ nodeIds: string[] }>
      nodes: Array<Record<string, unknown>>
    }
    const firstPage = document.pages[0]
    if (!firstPage) throw new Error("The fixture document has no page")
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
    document.name = "Inspector production fixture"
    document.updatedAt = "2026-08-27T18:00:00.000Z"
    document.nodes.push(...nodes)
    firstPage.nodeIds.push(...nodes.map((node) => node.id))
    return JSON.stringify(document)
  })

  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .first()
    .setInputFiles({
      name: "inspector-production-fixture.studio.json",
      mimeType: "application/json",
      buffer: Buffer.from(serialized),
    })
  await expect
    .poll(async () =>
      (await inspect(page)).activePageNodes.some(
        (node) => node.id === "inspector-alpha"
      )
    )
    .toBe(true)
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
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
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

test("continuous fill picking previews promptly and commits one undoable change", async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const tree = await openLayers(page)
  await tree
    .getByRole("treeitem", { name: "Inspector alpha", exact: true })
    .click()
  const picker = page.getByLabel("Fill color picker", { exact: true })
  await expect(picker).toBeVisible()

  const before = await inspect(page)
  const beforeNode = before.activePageNodes.find(
    (node) => node.id === "inspector-alpha"
  )!
  const finalColor = "#7C3AED"
  const dispatchDuration = await picker.evaluate(
    (input, colors) => {
      const colorInput = input as HTMLInputElement
      const startedAt = performance.now()
      for (const color of colors) {
        colorInput.value = color
        colorInput.dispatchEvent(new Event("input", { bubbles: true }))
      }
      return performance.now() - startedAt
    },
    ["#2563EB", "#0891B2", "#059669", "#65A30D", "#D97706", finalColor]
  )

  expect(dispatchDuration).toBeLessThan(1_000)
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  expect((await inspect(page)).document.revision).toBe(before.document.revision)

  await picker.evaluate((input) =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  )
  await expect
    .poll(async () => (await inspect(page)).document.revision)
    .toBe(before.document.revision + 1)
  await expect
    .poll(
      async () =>
        (await inspect(page)).activePageNodes.find(
          (node) => node.id === "inspector-alpha"
        )?.fill
    )
    .toBe(finalColor)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect
    .poll(
      async () =>
        (await inspect(page)).activePageNodes.find(
          (node) => node.id === "inspector-alpha"
        )?.fill
    )
    .toBe(beforeNode.fill)
  expect(pageErrors).toEqual([])
})
