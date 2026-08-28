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
  selection: null | { pageId: string; nodeIds: string[] }
  activePage: { id: string; width: number; height: number }
  activePageNodes: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    opacity: number
  }>
  fields: Array<{ key: string; value: string | number | boolean }>
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
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
})

test("nudge history is atomic, preserves selection, and rejects an abandoned branch", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text" }).click()

  const initial = await inspect(page)
  const selectedId = initial.selection?.nodeIds[0]
  const initialNode = initial.activePageNodes.find(
    (node) => node.id === selectedId
  )
  expect(selectedId).toBeTruthy()
  expect(initialNode).toBeDefined()

  await page.getByText("1240 × 1754", { exact: true }).click()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")

  await expect
    .poll(async () => {
      const current = await inspect(page)
      return current.activePageNodes.find((node) => node.id === selectedId)?.x
    })
    .toBe(initialNode!.x + 2)

  const firstBranch = await inspect(page)
  expect(firstBranch.document.revision).toBe(initial.document.revision + 2)
  expect(firstBranch.document.operationVersion).toBe(
    initial.document.operationVersion + 2
  )

  await page.getByRole("button", { name: "Undo" }).click()
  const undone = await inspect(page)
  expect(undone.activePageNodes.find((node) => node.id === selectedId)?.x).toBe(
    initialNode!.x
  )
  expect(undone.document.snapshotId).toBe(initial.document.snapshotId)
  expect(undone.document.operationVersion).toBe(
    firstBranch.document.operationVersion + 1
  )
  expect(undone.selection?.nodeIds).toEqual([selectedId])
  await expect(page.getByText("Selected layer", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Redo" }).click()
  const redone = await inspect(page)
  expect(redone.activePageNodes.find((node) => node.id === selectedId)?.x).toBe(
    initialNode!.x + 2
  )
  expect(redone.document.snapshotId).toBe(firstBranch.document.snapshotId)
  expect(redone.selection?.nodeIds).toEqual([selectedId])

  await page.getByRole("button", { name: "Undo" }).click()
  await page.getByText("1240 × 1754", { exact: true }).click()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  const secondBranch = await inspect(page)
  expect(secondBranch.document.revision).toBe(firstBranch.document.revision)
  expect(secondBranch.document.snapshotId).not.toBe(
    firstBranch.document.snapshotId
  )
  expect(secondBranch.selection?.nodeIds).toEqual([selectedId])

  const field = secondBranch.fields[0]
  expect(field).toBeDefined()
  const staleProposal = (await page.evaluate(
    async ({ documentId, revision, snapshotId, fieldKey, fieldValue }) =>
      window.__studioTestTools?.get("propose_field_updates")?.execute({
        documentId,
        baseRevision: revision,
        baseSnapshotId: snapshotId,
        values: { [fieldKey]: fieldValue },
        reason: "Abandoned branch regression",
      }),
    {
      documentId: firstBranch.document.id,
      revision: firstBranch.document.revision,
      snapshotId: firstBranch.document.snapshotId,
      fieldKey: field.key,
      fieldValue: field.value,
    }
  )) as TestWebMcpResult & { content?: Array<{ text?: string }> }

  expect(staleProposal.isError).toBe(true)
  expect(staleProposal.content?.[0]?.text).toContain(
    "document snapshot changed"
  )
  expect((await inspect(page)).document.snapshotId).toBe(
    secondBranch.document.snapshotId
  )
})

test("a Fabric drag and a continuous opacity gesture each commit once", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text" }).click()
  const beforeDrag = await inspect(page)
  const selectedId = beforeDrag.selection?.nodeIds[0]
  const nodeBeforeDrag = beforeDrag.activePageNodes.find(
    (node) => node.id === selectedId
  )
  expect(selectedId).toBeTruthy()
  expect(nodeBeforeDrag).toBeDefined()

  const canvas = page.locator("canvas.upper-canvas")
  const canvasBounds = await canvas.boundingBox()
  expect(canvasBounds).not.toBeNull()
  const start = {
    x:
      canvasBounds!.x +
      ((nodeBeforeDrag!.x + nodeBeforeDrag!.width / 2) /
        beforeDrag.activePage.width) *
        canvasBounds!.width,
    y:
      canvasBounds!.y +
      ((nodeBeforeDrag!.y + nodeBeforeDrag!.height / 2) /
        beforeDrag.activePage.height) *
        canvasBounds!.height,
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 36, start.y + 24, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(async () => {
      const current = await inspect(page)
      return current.activePageNodes.find((node) => node.id === selectedId)?.x
    })
    .not.toBe(nodeBeforeDrag!.x)
  const afterDrag = await inspect(page)
  expect(afterDrag.document.operationVersion).toBe(
    beforeDrag.document.operationVersion + 1
  )
  expect(afterDrag.document.revision).toBe(beforeDrag.document.revision + 1)

  await page.getByRole("button", { name: "Undo" }).click()
  const dragUndone = await inspect(page)
  expect(
    dragUndone.activePageNodes.find((node) => node.id === selectedId)?.x
  ).toBe(nodeBeforeDrag!.x)
  expect(dragUndone.selection?.nodeIds).toEqual([selectedId])

  const designPanel = page.getByRole("tabpanel", { name: "Design" })
  const opacity = designPanel.getByRole("slider", { name: "Opacity" })
  const opacityRoot = designPanel.locator('[data-slot="slider"]')
  const opacityBounds = await opacityRoot.boundingBox()
  const thumbBounds = await opacity.boundingBox()
  expect(opacityBounds).not.toBeNull()
  expect(thumbBounds).not.toBeNull()
  await page.mouse.move(
    thumbBounds!.x + thumbBounds!.width / 2,
    thumbBounds!.y + thumbBounds!.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    opacityBounds!.x + opacityBounds!.width * 0.55,
    opacityBounds!.y + opacityBounds!.height / 2,
    { steps: 8 }
  )
  await page.mouse.up()

  await expect
    .poll(async () => {
      const current = await inspect(page)
      return current.activePageNodes.find((node) => node.id === selectedId)
        ?.opacity
    })
    .toBeLessThan(0.8)
  const afterOpacity = await inspect(page)
  expect(afterOpacity.document.operationVersion).toBe(
    dragUndone.document.operationVersion + 1
  )
  expect(afterOpacity.document.revision).toBe(dragUndone.document.revision + 1)

  await page.getByRole("button", { name: "Undo" }).click()
  const opacityUndone = await inspect(page)
  expect(
    opacityUndone.activePageNodes.find((node) => node.id === selectedId)
      ?.opacity
  ).toBe(1)
  expect(opacityUndone.selection?.nodeIds).toEqual([selectedId])
})
