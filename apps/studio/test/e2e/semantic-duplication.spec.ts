import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"

type StoredDocument = {
  revision: number
  pages: Array<{ id: string; nodeIds: string[] }>
  nodes: Array<{ id: string; name: string; x: number; y: number }>
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

async function waitForSaved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /All changes saved|Saved/ })
  ).toBeVisible()
}

async function storedDocument(page: Page): Promise<StoredDocument> {
  await waitForSaved(page)
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => Boolean(localStorage.getItem(storageKey)),
        documentStorageKey
      )
    )
    .toBe(true)
  return page.evaluate((storageKey) => {
    const value = localStorage.getItem(storageKey)
    if (!value) throw new Error("The canonical draft was not persisted")
    return JSON.parse(value) as StoredDocument
  }, documentStorageKey)
}

function semanticCloneImpact(
  before: StoredDocument,
  after: StoredDocument,
  pageId: string
) {
  const beforeNodeIds = new Set(before.nodes.map((node) => node.id))
  const beforeGroupIds = new Set(before.groups.map((group) => group.id))
  const beforeBindingIds = new Set(before.bindings.map((binding) => binding.id))
  const clonedNodes = after.nodes.filter((node) => !beforeNodeIds.has(node.id))
  const clonedNodeIds = new Set(clonedNodes.map((node) => node.id))
  const clonedGroups = after.groups.filter(
    (group) => !beforeGroupIds.has(group.id)
  )
  const clonedGroupIds = new Set(clonedGroups.map((group) => group.id))
  const clonedBindings = after.bindings.filter(
    (binding) => !beforeBindingIds.has(binding.id)
  )
  return {
    revisionDelta: after.revision - before.revision,
    clonedNodes,
    clonedGroups,
    clonedBindings,
    pageHasEveryClone: after.pages
      .find((page) => page.id === pageId)
      ?.nodeIds.filter((nodeId) => clonedNodeIds.has(nodeId)).length,
    groupNodesAreClones: clonedGroups.every(
      (group) =>
        group.pageId === pageId &&
        group.nodeIds.every((nodeId) => clonedNodeIds.has(nodeId))
    ),
    parentageIsInternal: clonedGroups.every(
      (group) => !group.parentGroupId || clonedGroupIds.has(group.parentGroupId)
    ),
    bindingTargetsAreClones: clonedBindings.every((binding) =>
      clonedNodeIds.has(binding.nodeId)
    ),
  }
}

async function selectCoverGroup(page: Page) {
  await page.getByRole("tab", { name: "Layers" }).click()
  const group = page.getByRole("treeitem", {
    name: "Cover layout",
    exact: true,
  })
  await group.click()
  await expect(group).toHaveAttribute("aria-selected", "true")
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

test("group duplicate and copy/paste preserve hierarchy and field semantics as one undo", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text" }).click()
  await page.getByRole("button", { name: "Undo" }).click()
  const baseline = await storedDocument(page)
  const coverPage = baseline.pages.at(0)
  if (!coverPage) throw new Error("The cover page is unavailable")
  const coverGroupIds = new Set(
    baseline.groups
      .filter((group) => group.pageId === coverPage.id)
      .map((group) => group.id)
  )
  const coverBindingCount = baseline.bindings.filter((binding) =>
    coverPage.nodeIds.includes(binding.nodeId)
  ).length

  await selectCoverGroup(page)
  await page.getByLabel("Duplicate", { exact: true }).click()
  const duplicated = await storedDocument(page)
  const duplicateImpact = semanticCloneImpact(
    baseline,
    duplicated,
    coverPage.id
  )

  expect(duplicateImpact.revisionDelta).toBe(1)
  expect(duplicateImpact.clonedNodes).toHaveLength(coverPage.nodeIds.length)
  expect(duplicateImpact.pageHasEveryClone).toBe(coverPage.nodeIds.length)
  expect(duplicateImpact.clonedGroups).toHaveLength(coverGroupIds.size)
  expect(duplicateImpact.groupNodesAreClones).toBe(true)
  expect(duplicateImpact.parentageIsInternal).toBe(true)
  expect(duplicateImpact.clonedBindings).toHaveLength(coverBindingCount)
  expect(duplicateImpact.bindingTargetsAreClones).toBe(true)
  expect(duplicateImpact.clonedBindings[0]).toMatchObject({
    fieldId: baseline.bindings.find((binding) =>
      coverPage.nodeIds.includes(binding.nodeId)
    )?.fieldId,
    property: "text",
  })

  await page.getByRole("button", { name: "Undo" }).click()
  expect(await storedDocument(page)).toEqual(baseline)

  await selectCoverGroup(page)
  await page.getByRole("button", { name: "Copy", exact: true }).click()
  await page.getByRole("button", { name: "Paste", exact: true }).click()
  const pasted = await storedDocument(page)
  const pasteImpact = semanticCloneImpact(baseline, pasted, coverPage.id)

  expect(pasteImpact.revisionDelta).toBe(1)
  expect(pasteImpact.clonedNodes).toHaveLength(coverPage.nodeIds.length)
  expect(pasteImpact.clonedGroups).toHaveLength(coverGroupIds.size)
  expect(pasteImpact.clonedBindings).toHaveLength(coverBindingCount)
  expect(pasteImpact.groupNodesAreClones).toBe(true)
  expect(pasteImpact.parentageIsInternal).toBe(true)
  expect(pasteImpact.bindingTargetsAreClones).toBe(true)
  expect(
    pasteImpact.clonedNodes.every((node) => node.name.endsWith(" copy"))
  ).toBe(true)

  await page.getByRole("button", { name: "Undo" }).click()
  expect(await storedDocument(page)).toEqual(baseline)
})
