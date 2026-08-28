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
  activePageNodes: Array<{ id: string; type: string }>
  fields: Array<{ key: string; value: string | number | boolean }>
}

declare global {
  interface Window {
    __assetDecodeStarted?: boolean
    __assetObjectUrlCalls?: number
    __resumeAssetDecode?: () => void
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

async function localAssetIds(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    if (
      !databases.some((database) => database.name === "webmcp-studio-assets")
    ) {
      return []
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webmcp-studio-assets")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (
      !database.objectStoreNames.contains("asset-metadata") ||
      !database.objectStoreNames.contains("asset-blobs")
    ) {
      database.close()
      return []
    }
    return new Promise<string[]>((resolve, reject) => {
      const transaction = database.transaction(
        ["asset-metadata", "asset-blobs"],
        "readonly"
      )
      const metadataRequest = transaction
        .objectStore("asset-metadata")
        .getAllKeys()
      const blobRequest = transaction.objectStore("asset-blobs").getAllKeys()
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => {
        database.close()
        resolve([
          ...metadataRequest.result.map((key) => `metadata:${String(key)}`),
          ...blobRequest.result.map((key) => `blob:${String(key)}`),
        ])
      }
    })
  })
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

    const originalCreateObjectUrl = URL.createObjectURL.bind(URL)
    window.__assetObjectUrlCalls = 0
    URL.createObjectURL = (object) => {
      window.__assetObjectUrlCalls = (window.__assetObjectUrlCalls ?? 0) + 1
      return originalCreateObjectUrl(object)
    }

    let resumeDecode: (() => void) | null = null
    window.createImageBitmap = async () => {
      window.__assetDecodeStarted = true
      await new Promise<void>((resolve) => {
        resumeDecode = resolve
        window.__resumeAssetDecode = () => resumeDecode?.()
      })
      return {
        width: 320,
        height: 180,
        close: () => undefined,
      }
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

test("review started during image decode leaves document and IndexedDB unchanged", async ({
  page,
}) => {
  const before = await inspect(page)
  expect(await localAssetIds(page)).toEqual([])

  await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name: "paused-upload.png",
    mimeType: "image/png",
    buffer: Buffer.from("paused image fixture"),
  })
  await expect
    .poll(() => page.evaluate(() => window.__assetDecodeStarted))
    .toBe(true)

  const field = before.fields[0]
  expect(field).toBeDefined()
  const proposal = await page.evaluate(
    async ({ documentId, revision, snapshotId, fieldKey, fieldValue }) =>
      window.__studioTestTools?.get("propose_field_updates")?.execute({
        documentId,
        baseRevision: revision,
        baseSnapshotId: snapshotId,
        values: { [fieldKey]: `${fieldValue} pending review` },
        reason: "Pause image decode for transaction regression",
      }),
    {
      documentId: before.document.id,
      revision: before.document.revision,
      snapshotId: before.document.snapshotId,
      fieldKey: field.key,
      fieldValue: field.value,
    }
  )
  expect(proposal?.isError).not.toBe(true)

  await page.evaluate(() => window.__resumeAssetDecode?.())
  await expect(
    page.getByRole("button", {
      name: "More studio actions, attention required",
    })
  ).toBeVisible()

  const after = await inspect(page)
  expect(after.document).toEqual(before.document)
  expect(after.activePageNodes.map((node) => node.id)).toEqual(
    before.activePageNodes.map((node) => node.id)
  )
  expect(await localAssetIds(page)).toEqual([])
  expect(await page.evaluate(() => window.__assetObjectUrlCalls)).toBe(0)

  await page
    .getByRole("button", { name: "More studio actions, attention required" })
    .click()
  await expect(
    page.getByText(
      "Image upload stopped because a change review started. Resolve or discard the review, then retry."
    )
  ).toBeVisible()
})
