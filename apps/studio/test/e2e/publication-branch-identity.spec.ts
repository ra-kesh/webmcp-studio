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
  }
  selection: null | { nodeIds: string[] }
  activePageNodes: Array<{ id: string; x: number; y: number }>
}

type PublishedVersion = {
  id: string
  versionId: string
  templateId: string
  version: number
  sourceRevision: number
  sourceSnapshotId: string
  publishedAt: string
  document: {
    id: string
    revision: number
    nodes: Array<{ id: string; x: number; y: number }>
  }
  manifest: unknown
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

async function publish(page: Page, version: number) {
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const dialog = page.getByRole("dialog", {
    name: `Publish version ${version}`,
  })
  const publishButton = dialog.getByRole("button", {
    name: `Publish version ${version}`,
  })
  await expect(publishButton).toBeEnabled()
  await publishButton.click()
  const published = page.getByRole("dialog", {
    name: `Version ${version} is published`,
  })
  await expect(published).toContainText("Immutable")
  await published.getByRole("button", { name: "Done" }).click()
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

test("publishes divergent same-revision branches and keeps both audit snapshots addressable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add text" }).click()
  const afterAdd = await inspect(page)
  const selectedId = afterAdd.selection?.nodeIds[0]
  expect(selectedId).toBeTruthy()
  const origin = afterAdd.activePageNodes.find((node) => node.id === selectedId)
  expect(origin).toBeDefined()

  await page.getByText("1240 × 1754", { exact: true }).click()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  const branchA = await inspect(page)
  const branchANode = branchA.activePageNodes.find(
    (node) => node.id === selectedId
  )
  expect(branchANode?.x).toBe(origin!.x + 2)
  await publish(page, 1)

  await page.getByRole("button", { name: "Undo" }).click()
  await page.getByText("1240 × 1754", { exact: true }).click()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  const branchB = await inspect(page)
  const branchBNode = branchB.activePageNodes.find(
    (node) => node.id === selectedId
  )
  expect(branchB.document.revision).toBe(branchA.document.revision)
  expect(branchB.document.snapshotId).not.toBe(branchA.document.snapshotId)
  expect(branchBNode?.x).toBe(origin!.x)
  expect(branchBNode?.y).toBe(origin!.y + 2)
  await publish(page, 2)

  const [versionAResponse, versionBResponse] = await Promise.all([
    page.request.get("/v1/studio/templates/editorial-olive?version=1"),
    page.request.get("/v1/studio/templates/editorial-olive?version=2"),
  ])
  expect(versionAResponse.ok()).toBe(true)
  expect(versionBResponse.ok()).toBe(true)
  const versionA = (await versionAResponse.json()) as PublishedVersion
  const versionB = (await versionBResponse.json()) as PublishedVersion
  expect(versionA.sourceRevision).toBe(versionB.sourceRevision)
  expect(versionA.sourceSnapshotId).not.toBe(versionB.sourceSnapshotId)
  expect(
    versionA.document.nodes.find((node) => node.id === selectedId)
  ).toMatchObject({ x: origin!.x + 2, y: origin!.y })
  expect(
    versionB.document.nodes.find((node) => node.id === selectedId)
  ).toMatchObject({ x: origin!.x, y: origin!.y + 2 })

  const idempotent = await page.request.post("/v1/studio/templates/", {
    data: {
      id: `template-version-${crypto.randomUUID()}`,
      templateId: versionB.templateId,
      version: 3,
      publishedAt: new Date().toISOString(),
      document: versionB.document,
    },
  })
  expect(idempotent.status()).toBe(200)
  expect(await idempotent.json()).toMatchObject({
    id: versionB.versionId,
    version: 2,
    sourceSnapshotId: versionB.sourceSnapshotId,
  })

  const [auditAResponse, auditBResponse] = await Promise.all([
    page.request.get(
      `/v1/studio/documents/${versionA.document.id}/revisions/${versionA.sourceSnapshotId}`
    ),
    page.request.get(
      `/v1/studio/documents/${versionB.document.id}/revisions/${versionB.sourceSnapshotId}`
    ),
  ])
  expect(auditAResponse.ok()).toBe(true)
  expect(auditBResponse.ok()).toBe(true)
  const auditA = (await auditAResponse.json()) as {
    snapshotId: string
    revision: number
    document: PublishedVersion["document"]
  }
  const auditB = (await auditBResponse.json()) as typeof auditA
  expect(auditA.snapshotId).toBe(versionA.sourceSnapshotId)
  expect(auditB.snapshotId).toBe(versionB.sourceSnapshotId)
  expect(auditA.revision).toBe(auditB.revision)
  expect(auditA.document).toEqual(versionA.document)
  expect(auditB.document).toEqual(versionB.document)
})
