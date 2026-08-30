import { expect, test } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

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

type DesignInspection = {
  document: {
    id: string
    revision: number
    snapshotId: string
    operationVersion: number
  }
  selection: null | { pageId: string; nodeIds: string[] }
  activePage: {
    id: string
    nodeIds: string[]
  }
  activePageNodes: Array<{
    id: string
    name: string
    visible: boolean
    locked: boolean
  }>
  fields: Array<{
    key: string
    value: string | number | boolean
  }>
}

type LayerFixtureIds = {
  documentId: string
  pageId: string
  outerGroupId: string
  innerGroupId: string
  alphaId: string
  betaId: string
  gammaId: string
  outsideId: string
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

async function inspectDesign(page: Page) {
  const result = await page.evaluate(async () =>
    window.__studioTestTools?.get("inspect_design")?.execute({})
  )
  expect(result?.isError).not.toBe(true)
  return result?.structuredContent as DesignInspection
}

async function readPersistedDocument(page: Page) {
  return page.evaluate(async () => {
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
            revision: number
            nodes: Array<{ id: string }>
            groups: Array<{ id: string; nodeIds: string[] }>
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
    if (!stored?.document) throw new Error("Document draft is unavailable")
    return stored.document
  })
}

async function waitForSaved(page: Page) {
  const expectedRevision = (await inspectDesign(page)).document.revision
  await expect
    .poll(async () => (await readPersistedDocument(page)).revision)
    .toBe(expectedRevision)
}

async function seedLayerFixture(page: Page, bulkCount = 0) {
  const fixture = await page.evaluate(
    async ({ bulkLayerCount }) => {
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
              pages: Array<{ id: string; nodeIds: string[] }>
              nodes: Array<Record<string, unknown> & { id: string }>
              groups: Array<{
                id: string
                pageId: string
                name: string
                nodeIds: string[]
                parentGroupId?: string
              }>
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
        pages: Array<{ id: string; nodeIds: string[] }>
        nodes: Array<Record<string, unknown>>
        groups: Array<{
          id: string
          pageId: string
          name: string
          nodeIds: string[]
          parentGroupId?: string
        }>
      }
      const firstPage = document.pages.at(0)
      if (!firstPage) throw new Error("The fixture document has no page")

      const ids = {
        documentId,
        pageId: firstPage.id,
        outerGroupId: "e2e-group-outer",
        innerGroupId: "e2e-group-inner",
        alphaId: "e2e-layer-alpha",
        betaId: "e2e-layer-beta",
        gammaId: "e2e-layer-gamma",
        outsideId: "e2e-layer-outside",
      }
      const rect = (
        id: string,
        name: string,
        index: number,
        visible = true,
        locked = false
      ) => ({
        id,
        name,
        type: "rect",
        x: 48 + (index % 20) * 8,
        y: 48 + Math.floor(index / 20) * 8,
        width: 24,
        height: 24,
        rotation: 0,
        opacity: 1,
        visible,
        locked,
        fill: "#d7e4d8",
        radius: 0,
        strokeWidth: 0,
      })

      const seedNodes = [
        rect(ids.alphaId, "Alpha card", 0),
        rect(ids.betaId, "Beta label", 1, false, true),
        rect(ids.gammaId, "Gamma mark", 2),
        rect(ids.outsideId, "Outside art", 3),
      ]
      const bulkNodes = Array.from({ length: bulkLayerCount }, (_, index) =>
        rect(
          `e2e-bulk-${String(index + 1).padStart(4, "0")}`,
          `Bulk layer ${String(index + 1).padStart(4, "0")}`,
          index + seedNodes.length,
          false
        )
      )

      document.name = "Layer tree production fixture"
      document.updatedAt = "2026-08-27T12:00:00.000Z"
      document.nodes.push(...seedNodes, ...bulkNodes)
      firstPage.nodeIds.push(
        ...seedNodes.map((node) => node.id),
        ...bulkNodes.map((node) => node.id)
      )
      document.groups.push(
        {
          id: ids.outerGroupId,
          pageId: firstPage.id,
          name: "Outer group",
          nodeIds: [ids.alphaId, ids.betaId],
        },
        {
          id: ids.innerGroupId,
          pageId: firstPage.id,
          name: "Inner group",
          nodeIds: [ids.gammaId],
          parentGroupId: ids.outerGroupId,
        }
      )
      if (bulkNodes.length) {
        document.groups.push({
          id: "e2e-bulk-group",
          pageId: firstPage.id,
          name: "Bulk layers",
          nodeIds: bulkNodes.map((node) => node.id),
        })
      }

      return { ids, serialized: JSON.stringify(document) }
    },
    { bulkLayerCount: bulkCount }
  )

  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .first()
    .setInputFiles({
      name: "layer-tree-production-fixture.studio.json",
      mimeType: "application/json",
      buffer: Buffer.from(fixture.serialized),
    })
  await expect
    .poll(async () => (await inspectDesign(page)).document.id)
    .toBe(fixture.ids.documentId)
  await expect
    .poll(async () =>
      (await inspectDesign(page)).activePage.nodeIds.includes(
        fixture.ids.outsideId
      )
    )
    .toBe(true)
  return fixture.ids
}

async function openDesktopLayerTree(page: Page) {
  await page.getByRole("tab", { name: "Layers" }).click()
  const tree = page.getByRole("tree", { name: "Document layers" })
  await expect(tree).toBeVisible()
  return tree
}

async function expandGroup(tree: Locator, name: string) {
  const row = tree.getByRole("treeitem", { name, exact: true })
  if ((await row.getAttribute("aria-expanded")) === "false") {
    await row.getByRole("button", { name: `Expand ${name}` }).click()
  }
  await expect(row).toHaveAttribute("aria-expanded", "true")
  return row
}

async function expectVisibleTreeRowsNotToOverlap(tree: Locator) {
  const rows = await tree.getByRole("treeitem").evaluateAll((items) =>
    items.map((item) => {
      const bounds = item.getBoundingClientRect()
      return {
        name: item.getAttribute("aria-label"),
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
      }
    })
  )

  expect(rows.length).toBeGreaterThan(1)
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    const current = rows[index]
    expect(
      current!.top,
      `Expected ${current!.name} to start below ${previous!.name}: ${JSON.stringify(rows)}`
    ).toBeGreaterThanOrEqual(previous!.bottom - 0.5)
  }
}

function fixtureNodes(inspection: DesignInspection, ids: LayerFixtureIds) {
  const wanted = new Set([ids.alphaId, ids.betaId, ids.gammaId])
  return inspection.activePageNodes
    .filter((node) => wanted.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id))
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
  await page.evaluate(
    ({ documentKey, sourceKey, templateKey }) => {
      localStorage.removeItem(documentKey)
      localStorage.removeItem(sourceKey)
      localStorage.removeItem(templateKey)
      sessionStorage.clear()
    },
    {
      documentKey: documentStorageKey,
      sourceKey: quotationSourceStorageKey,
      templateKey: quotationTemplateStorageKey,
    }
  )
  await page.reload()
  const openSample = page.getByRole("button", {
    name: "Open sample",
    exact: true,
  })
  await expect(openSample).toBeVisible()
  await openSample.click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
  await waitForEditor(page)
})

test("the hierarchy exposes ARIA state, keeps tree focus isolated, and searches with ancestor context", async ({
  page,
}) => {
  await seedLayerFixture(page)
  const tree = await openDesktopLayerTree(page)
  const outer = tree.getByRole("treeitem", { name: "Outer group", exact: true })

  await expect(tree).toHaveAttribute("aria-multiselectable", "true")
  await expect(outer).toHaveAttribute("aria-level", "1")
  await expect(outer).toHaveAttribute("aria-expanded", "false")
  await outer.click()
  await expect(tree).toBeFocused()
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    "layer-tree-item-group-e2e-group-outer"
  )
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(0)

  await page.keyboard.press("ArrowRight")
  await expect(outer).toHaveAttribute("aria-expanded", "true")
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    "layer-tree-item-group-e2e-group-outer"
  )
  await page.keyboard.press("ArrowRight")
  const inner = tree.getByRole("treeitem", { name: "Inner group", exact: true })
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    "layer-tree-item-group-e2e-group-inner"
  )
  await expect(inner).toHaveAttribute("aria-level", "2")
  await expect(inner).toHaveAttribute("aria-posinset", "1")

  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  const gamma = tree.getByRole("treeitem", { name: "Gamma mark", exact: true })
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    "layer-tree-item-node-e2e-layer-gamma"
  )
  await expect(gamma).toHaveAttribute("aria-level", "3")
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(0)
  await expectVisibleTreeRowsNotToOverlap(tree)
  await expect(
    gamma.getByRole("button", { name: "Lock Gamma mark" })
  ).toHaveAttribute("tabindex", "-1")

  await page.keyboard.press("Home")
  await expect(tree).toBeFocused()
  await page.keyboard.press("End")
  await expect(tree).toBeFocused()
  expect(
    await tree.evaluate((node) => node.contains(document.activeElement))
  ).toBe(true)

  const beforeSearch = await inspectDesign(page)
  const search = page.getByRole("searchbox", { name: "Search layers" })
  await search.fill("gamma")
  await expect(page.getByText("1 result", { exact: true })).toBeVisible()
  await expect(tree.getByRole("treeitem")).toHaveCount(3)
  await expect(outer).toBeVisible()
  await expect(inner).toBeVisible()
  await expect(gamma).toBeVisible()
  await expect(outer).toHaveAttribute("aria-expanded", "true")
  await expect(inner).toHaveAttribute("aria-expanded", "true")

  await search.fill("h")
  await page.keyboard.press("l")
  const afterTypingInSearch = await inspectDesign(page)
  expect(afterTypingInSearch.document.snapshotId).toBe(
    beforeSearch.document.snapshotId
  )
  await page.getByRole("button", { name: "Clear layer search" }).click()
  await expect(
    page.getByRole("status").filter({ hasText: /^\d+ layers$/ })
  ).toBeVisible()
})

test("rename cancel is inert, rename commit is one history step, and one undo restores it", async ({
  page,
}) => {
  await seedLayerFixture(page)
  const tree = await openDesktopLayerTree(page)
  await expandGroup(tree, "Outer group")
  const alpha = tree.getByRole("treeitem", { name: "Alpha card", exact: true })
  await alpha.click()
  const before = await inspectDesign(page)

  await page.keyboard.press("F2")
  const renameInput = page.getByTestId("layer-rename-input")
  await expect(renameInput).toBeFocused()
  await renameInput.fill("Cancelled layer name")
  await page.keyboard.press("Escape")
  await expect(renameInput).toBeHidden()
  await expect(alpha).toBeVisible()
  const afterCancel = await inspectDesign(page)
  expect(afterCancel.document.snapshotId).toBe(before.document.snapshotId)
  expect(afterCancel.document.operationVersion).toBe(
    before.document.operationVersion
  )

  await alpha.click()
  await page.keyboard.press("F2")
  await renameInput.fill("Renamed alpha card")
  await page.keyboard.press("Enter")
  const renamed = tree.getByRole("treeitem", {
    name: "Renamed alpha card",
    exact: true,
  })
  await expect(renamed).toBeVisible()
  const afterCommit = await inspectDesign(page)
  expect(afterCommit.document.revision).toBe(before.document.revision + 1)
  expect(afterCommit.document.operationVersion).toBe(
    before.document.operationVersion + 1
  )

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(alpha).toBeVisible()
  const afterUndo = await inspectDesign(page)
  expect(afterUndo.document.snapshotId).toBe(before.document.snapshotId)
  expect(
    afterUndo.activePageNodes.find((node) => node.id === "e2e-layer-alpha")
      ?.name
  ).toBe("Alpha card")
})

test("semantic group edge ordering is one atomic command on desktop and compact", async ({
  page,
}) => {
  const ids = await seedLayerFixture(page)
  const tree = await openDesktopLayerTree(page)
  const outer = await expandGroup(tree, "Outer group")
  await tree
    .getByRole("treeitem", { name: "Beta label", exact: true })
    .getByRole("button", { name: "Unlock Beta label" })
    .click()
  await outer.click()

  const before = await inspectDesign(page)
  const selected = new Set([ids.alphaId, ids.betaId, ids.gammaId])
  const orderedGroup = before.activePage.nodeIds.filter((nodeId) =>
    selected.has(nodeId)
  )
  const remaining = before.activePage.nodeIds.filter(
    (nodeId) => !selected.has(nodeId)
  )
  expect(before.selection?.nodeIds.sort()).toEqual([...selected].sort())

  await page.getByRole("tab", { name: "Design" }).click()
  await page.getByRole("button", { name: "To front" }).click()
  const atFront = await inspectDesign(page)
  expect(atFront.activePage.nodeIds).toEqual([...remaining, ...orderedGroup])
  expect(atFront.document.operationVersion).toBe(
    before.document.operationVersion + 1
  )

  await page.getByRole("button", { name: "Undo" }).click()
  expect((await inspectDesign(page)).activePage.nodeIds).toEqual(
    before.activePage.nodeIds
  )
  await page.getByRole("button", { name: "Redo" }).click()
  expect((await inspectDesign(page)).activePage.nodeIds).toEqual([
    ...remaining,
    ...orderedGroup,
  ])
  await page.getByRole("button", { name: "Undo" }).click()

  await page.getByRole("button", { name: "To back" }).click()
  const atBack = await inspectDesign(page)
  expect(atBack.activePage.nodeIds).toEqual([...orderedGroup, ...remaining])
  expect(atBack.document.operationVersion).toBe(
    before.document.operationVersion + 5
  )
  await page.getByRole("button", { name: "Undo" }).click()

  await page.setViewportSize({ width: 390, height: 820 })
  await page.getByRole("button", { name: "Open properties" }).click()
  const properties = page.getByRole("dialog", { name: "Properties" })
  await properties.getByRole("button", { name: "To front" }).click()
  await expect(properties).toBeVisible()
  const compactFront = await inspectDesign(page)
  expect(compactFront.activePage.nodeIds).toEqual([
    ...remaining,
    ...orderedGroup,
  ])
  expect(compactFront.document.operationVersion).toBe(
    before.document.operationVersion + 7
  )
})

test("Space toggles selection and keyboard actions operate on the selected set", async ({
  page,
}) => {
  const ids = await seedLayerFixture(page)
  const tree = await openDesktopLayerTree(page)
  await expandGroup(tree, "Outer group")
  const alpha = tree.getByRole("treeitem", { name: "Alpha card", exact: true })
  const beta = tree.getByRole("treeitem", { name: "Beta label", exact: true })

  await alpha.click()
  await beta.click({ modifiers: ["ControlOrMeta"] })
  expect((await inspectDesign(page)).selection?.nodeIds.sort()).toEqual(
    [ids.alphaId, ids.betaId].sort()
  )

  const beforeHide = await inspectDesign(page)
  await page.keyboard.press("h")
  const afterHide = await inspectDesign(page)
  expect(
    afterHide.activePageNodes
      .filter((node) => [ids.alphaId, ids.betaId].includes(node.id))
      .every((node) => node.visible)
  ).toBe(true)
  expect(afterHide.document.operationVersion).toBe(
    beforeHide.document.operationVersion + 1
  )
  await page.getByRole("button", { name: "Undo" }).click()
  await tree.focus()

  await page.keyboard.press("Space")
  expect((await inspectDesign(page)).selection?.nodeIds).toEqual([ids.alphaId])
  await page.keyboard.press("Space")
  expect((await inspectDesign(page)).selection?.nodeIds.sort()).toEqual(
    [ids.alphaId, ids.betaId].sort()
  )

  const beforeDelete = await inspectDesign(page)
  await page.keyboard.press("Delete")
  const afterDelete = await inspectDesign(page)
  expect(
    afterDelete.activePageNodes.some((node) => node.id === ids.alphaId)
  ).toBe(false)
  expect(
    afterDelete.activePageNodes.some((node) => node.id === ids.betaId)
  ).toBe(true)
  expect(afterDelete.document.operationVersion).toBe(
    beforeDelete.document.operationVersion + 1
  )
  await expect(tree).toBeFocused()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(
    tree.getByRole("treeitem", { name: "Alpha card", exact: true })
  ).toBeVisible()
})

test("group aggregate lock and visibility are atomic and undo restores mixed descendants", async ({
  page,
}) => {
  const ids = await seedLayerFixture(page)
  const tree = await openDesktopLayerTree(page)
  const outer = tree.getByRole("treeitem", { name: "Outer group", exact: true })
  const initial = await inspectDesign(page)
  const initialNodes = fixtureNodes(initial, ids)
  expect(initialNodes.map((node) => node.locked)).toEqual([false, true, false])
  expect(initialNodes.map((node) => node.visible)).toEqual([true, false, true])
  await expect(outer).toHaveAttribute("data-hidden", "true")
  await expect(outer).not.toHaveAttribute("data-locked")

  await outer.getByRole("button", { name: "Lock Outer group" }).click()
  const afterLock = await inspectDesign(page)
  expect(fixtureNodes(afterLock, ids).every((node) => node.locked)).toBe(true)
  expect(afterLock.document.revision).toBe(
    initial.document.revision + initialNodes.length
  )
  expect(afterLock.document.operationVersion).toBe(
    initial.document.operationVersion + 1
  )
  await expect(outer).toHaveAttribute("data-locked", "true")

  await page.getByRole("button", { name: "Undo" }).click()
  const lockUndone = await inspectDesign(page)
  expect(fixtureNodes(lockUndone, ids).map((node) => node.locked)).toEqual([
    false,
    true,
    false,
  ])

  await outer.getByRole("button", { name: "Show Outer group" }).click()
  const afterShow = await inspectDesign(page)
  expect(fixtureNodes(afterShow, ids).every((node) => node.visible)).toBe(true)
  expect(afterShow.document.revision).toBe(
    initial.document.revision + initialNodes.length
  )
  expect(afterShow.document.operationVersion).toBe(
    lockUndone.document.operationVersion + 1
  )
  await expect(outer).not.toHaveAttribute("data-hidden")

  await page.getByRole("button", { name: "Undo" }).click()
  const showUndone = await inspectDesign(page)
  expect(fixtureNodes(showUndone, ids).map((node) => node.visible)).toEqual([
    true,
    false,
    true,
  ])
})

test("pending review leaves layer discovery available but blocks every tree mutation path", async ({
  page,
}) => {
  await seedLayerFixture(page)
  const tree = await openDesktopLayerTree(page)
  await expandGroup(tree, "Outer group")

  const proposal = await page.evaluate(async () => {
    const tools = window.__studioTestTools
    const inspection = await tools?.get("inspect_design")?.execute({})
    const snapshot = inspection?.structuredContent as DesignInspection
    const field = snapshot.fields.at(0)
    if (!field) throw new Error("No editable field is available")
    return tools?.get("propose_field_updates")?.execute({
      documentId: snapshot.document.id,
      baseRevision: snapshot.document.revision,
      baseSnapshotId: snapshot.document.snapshotId,
      values: { [field.key]: `${field.value} review` },
      reason: "Layer-tree review blocking coverage",
    })
  })
  expect(proposal?.isError).not.toBe(true)
  await expect(page.getByRole("tab", { name: "Review" })).toHaveAttribute(
    "aria-selected",
    "true"
  )

  await page.getByRole("tab", { name: "Layers" }).click()
  const alpha = tree.getByRole("treeitem", { name: "Alpha card", exact: true })
  await alpha.click()
  await expect(
    alpha.getByRole("button", { name: "Lock Alpha card" })
  ).toBeDisabled()
  await expect(
    alpha.getByRole("button", { name: "Hide Alpha card" })
  ).toBeDisabled()
  await expect(
    alpha.getByRole("button", { name: "Drag Alpha card" })
  ).toBeDisabled()
  const before = await inspectDesign(page)

  for (const key of ["F2", "h", "l", "Delete", "Alt+ArrowDown"]) {
    await page.keyboard.press(key)
  }
  await expect(page.getByTestId("layer-rename-input")).toHaveCount(0)
  const after = await inspectDesign(page)
  expect(after.document.snapshotId).toBe(before.document.snapshotId)
  expect(after.document.revision).toBe(before.document.revision)

  const search = page.getByRole("searchbox", { name: "Search layers" })
  await search.fill("alpha")
  await expect(alpha).toBeVisible()
})

test("pointer drag reparents a root layer into a group and remains undoable", async ({
  page,
}) => {
  const ids = await seedLayerFixture(page)
  const tree = await openDesktopLayerTree(page)
  const outer = tree.getByRole("treeitem", { name: "Outer group", exact: true })
  const outside = tree.getByRole("treeitem", {
    name: "Outside art",
    exact: true,
  })
  const handle = outside.getByRole("button", { name: "Drag Outside art" })
  await outside.hover()
  const sourceBounds = await handle.boundingBox()
  const targetBounds = await outer.boundingBox()
  expect(sourceBounds).not.toBeNull()
  expect(targetBounds).not.toBeNull()

  await page.mouse.move(
    sourceBounds!.x + sourceBounds!.width / 2,
    sourceBounds!.y + sourceBounds!.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    sourceBounds!.x + sourceBounds!.width / 2 + 8,
    sourceBounds!.y + sourceBounds!.height / 2,
    { steps: 5 }
  )
  await page.mouse.move(targetBounds!.x + 96, targetBounds!.y + 15, {
    steps: 20,
  })
  await page.mouse.up()

  await expect(outer).toHaveAttribute("aria-expanded", "true")
  await expect(outside).toHaveAttribute("aria-level", "2")
  await expect
    .poll(async () =>
      Boolean(
        (await readPersistedDocument(page)).groups
          .find((group) => group.id === ids.outerGroupId)
          ?.nodeIds.includes(ids.outsideId)
      )
    )
    .toBe(true)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(outside).toHaveAttribute("aria-level", "1")
})

test("compact Layers keeps the same tree semantics with 44px controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 })
  await seedLayerFixture(page)
  const opener = page.getByRole("button", { name: "Open document panel" })
  await opener.click()
  const dialog = page.getByRole("dialog", { name: "Document" })
  await dialog.getByRole("tab", { name: "Layers" }).click()
  const tree = dialog.getByRole("tree", { name: "Document layers" })
  const outer = tree.getByRole("treeitem", { name: "Outer group", exact: true })
  await expect(tree).toHaveAttribute("aria-multiselectable", "true")

  const searchBounds = await dialog
    .getByRole("searchbox", { name: "Search layers" })
    .boundingBox()
  const rowBounds = await outer.boundingBox()
  const lockBounds = await outer
    .getByRole("button", { name: "Lock Outer group" })
    .boundingBox()
  expect(Math.round(searchBounds?.height ?? 0)).toBeGreaterThanOrEqual(44)
  expect(Math.round(rowBounds?.height ?? 0)).toBeGreaterThanOrEqual(44)
  expect(Math.round(lockBounds?.width ?? 0)).toBeGreaterThanOrEqual(44)
  expect(Math.round(lockBounds?.height ?? 0)).toBeGreaterThanOrEqual(44)

  await outer.click()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    "layer-tree-item-group-e2e-group-inner"
  )
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement))
  ).toBe(true)
})

test("a valid 1,000-layer restored document stays virtualized, searchable, and scrolls to selection", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const ids = await seedLayerFixture(page, 1_000)
  const inspection = await inspectDesign(page)
  expect(inspection.document.id).toBe(ids.documentId)
  expect(inspection.activePage.nodeIds).toContain("e2e-bulk-1000")

  const tree = await openDesktopLayerTree(page)
  const scroll = page.getByTestId("layer-tree-scroll")
  await expect(tree.getByRole("treeitem").first()).toBeVisible()
  const initialDomRowCount = await tree.getByRole("treeitem").count()

  const search = page.getByRole("searchbox", { name: "Search layers" })
  const searchStartedAt = Date.now()
  await search.fill("Bulk layer 0001")
  const lastLayer = tree.getByRole("treeitem", {
    name: "Bulk layer 0001",
    exact: true,
  })
  await expect(lastLayer).toBeVisible()
  expect(Date.now() - searchStartedAt).toBeLessThan(2_500)
  await expect(page.getByText("1 result", { exact: true })).toBeVisible()
  expect(await tree.getByRole("treeitem").count()).toBe(2)

  await lastLayer.click()
  await page.getByRole("button", { name: "Clear layer search" }).click()
  await expect(lastLayer).toBeVisible()
  await expect(lastLayer).toHaveAttribute("aria-selected", "true")
  const scrollTop = await scroll.evaluate((element) => element.scrollTop)
  const hierarchyOwnership = await tree.evaluate((element) => {
    const dangling = [...element.querySelectorAll<HTMLElement>("[aria-owns]")]
      .flatMap((owner) => (owner.getAttribute("aria-owns") ?? "").split(" "))
      .filter((id) => id && !document.getElementById(id))
    const bulkGroup = document.getElementById(
      "layer-tree-group-group-e2e-bulk-group"
    )
    return {
      dangling,
      ownsActive: bulkGroup
        ?.getAttribute("aria-owns")
        ?.includes("layer-tree-item-node-e2e-bulk-0001"),
    }
  })
  expect(hierarchyOwnership).toEqual({ dangling: [], ownsActive: true })

  await waitForSaved(page)
  const persistedNodeCount = (await readPersistedDocument(page)).nodes.filter(
    (node) => node.id.startsWith("e2e-bulk-")
  ).length
  expect(persistedNodeCount).toBe(1_000)

  const virtualization = await scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(scrollTop, JSON.stringify(virtualization)).toBeGreaterThan(0)
  expect(
    initialDomRowCount,
    JSON.stringify({ ...virtualization, initialDomRowCount })
  ).toBeLessThan(80)
})
