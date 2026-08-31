import { expect, test } from "@playwright/test"
import type { Page, TestInfo } from "@playwright/test"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"

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
    name: string
    revision: number
    snapshotId: string
    operationVersion: number
  }
  activePage: {
    id: string
    name: string
    nodeIds: string[]
  }
  activePageNodes: Array<{ id: string; name: string; type: string }>
  outputs: Array<{ id: string; name: string; pageIds: string[] }>
  fields: Array<{
    id: string
    key: string
    value: string | number | boolean
  }>
  pendingChangeSet: null | {
    id: string
    title: string
    status: string
    operations: Array<{ id: string; summary: string; status: string }>
  }
}

type RenderResponse = {
  id: string
  status:
    | "queued"
    | "rendering"
    | "retrying"
    | "completed"
    | "failed"
    | "cancelling"
    | "cancelled"
  artifacts: Array<{
    id: string
    outputId: string
    pageId: null
    format: "pdf"
    bytes: number
    downloadUrl: string
  }>
}

declare global {
  interface Window {
    __studioTestTools?: Map<string, TestWebMcpTool>
  }
}

const storageKeys = [
  "webmcp-studio:northstar-document:v2",
  "webmcp-studio:published-versions:v1",
  "webmcp-studio:quotation-template:v1",
  "webmcp-studio:quotation-source:v1",
]

async function executeTool<T>(page: Page, name: string, input: unknown) {
  const result = await page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = window.__studioTestTools?.get(toolName)
      if (!tool) throw new Error(`WebMCP tool ${toolName} is unavailable`)
      return tool.execute(toolInput)
    },
    { toolName: name, toolInput: input }
  )
  expect(result.isError).not.toBe(true)
  return result.structuredContent as T
}

async function inspectDesign(page: Page) {
  return executeTool<DesignInspection>(page, "inspect_design", {})
}

async function extractPdfText(pdf: Uint8Array) {
  const task = getDocument({ data: pdf })
  const document = await task.promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" ")
      )
    }
    return {
      pageCount: document.numPages,
      text: pages.join("\n").replace(/\s+/g, " ").trim(),
    }
  } finally {
    await task.destroy()
  }
}

async function attachJourneyScreenshot(page: Page, testInfo: TestInfo) {
  await testInfo.attach("clean-challenge-journey", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
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
  })

  await page.goto("/")
  const reset = await page.request.post("/v1/studio/session/reset")
  expect(reset.ok()).toBe(true)
  await page.evaluate((keys) => {
    for (const key of keys) localStorage.removeItem(key)
  }, storageKeys)
  await page.reload()

  await expect(
    page.getByRole("heading", { name: "Studio documents" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Open sample", exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)

  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
})

test("clean edit-to-artifact challenge journey produces an inspectable seven-page PDF", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)

  const initial = await inspectDesign(page)
  expect(initial.document.revision).toBeGreaterThanOrEqual(0)
  expect(initial.outputs).toHaveLength(1)
  expect(initial.outputs[0]?.pageIds).toHaveLength(6)

  await page.getByRole("button", { name: "Add text" }).click()
  await page.getByRole("menuitem", { name: /^Body/ }).click()
  const afterEdit = await inspectDesign(page)
  expect(afterEdit.document.revision).toBe(initial.document.revision + 1)
  expect(afterEdit.activePageNodes).toHaveLength(
    initial.activePageNodes.length + 1
  )
  expect(afterEdit.activePageNodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "text", name: "Body" }),
    ])
  )

  await page.getByRole("button", { name: "Insert shape" }).click()
  await page.getByRole("menuitem", { name: "Asset library…" }).click()
  const assetDialog = page.getByRole("dialog", { name: "Add image" })
  await assetDialog
    .getByRole("button", {
      name: "Insert “Olive botanical” from Studio library",
    })
    .click()
  await expect(assetDialog).toBeHidden()

  const afterImage = await inspectDesign(page)
  expect(afterImage.document.revision).toBe(afterEdit.document.revision + 1)
  expect(afterImage.activePageNodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "image", name: "Olive botanical" }),
    ])
  )

  await page.getByRole("tab", { name: "Pages" }).click()
  const pagesPanel = page.getByRole("tabpanel", { name: "Pages" })
  await pagesPanel
    .getByRole("button", { name: "Add page to Quotation" })
    .click()

  const afterPage = await inspectDesign(page)
  expect(afterPage.document.revision).toBe(afterImage.document.revision + 1)
  expect(afterPage.activePage.name).toBe("Page 7")
  expect(afterPage.activePageNodes).toHaveLength(0)
  expect(afterPage.outputs[0]?.pageIds).toHaveLength(7)
  await expect(
    page
      .getByRole("region", { name: "Quotation pages" })
      .getByRole("button", { name: /^Open page/ })
  ).toHaveCount(7)

  const titleField = afterPage.fields.find(
    (field) => field.key === "quotation_title"
  )
  expect(titleField).toBeDefined()
  const reviewedTitle = "Reviewed wedding story"
  await executeTool(page, "propose_field_updates", {
    documentId: afterPage.document.id,
    baseRevision: afterPage.document.revision,
    baseSnapshotId: afterPage.document.snapshotId,
    values: { quotation_title: reviewedTitle },
    reason: "Personalize the quotation title for the challenge journey",
  })

  await expect(page.getByRole("tab", { name: "Review" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  const preview = await inspectDesign(page)
  expect(preview.document.revision).toBe(afterPage.document.revision)
  expect(preview.pendingChangeSet?.operations).toHaveLength(1)
  expect(
    preview.fields.find((field) => field.key === "quotation_title")?.value
  ).toBe(titleField?.value)

  await page.getByRole("button", { name: "Accept all" }).click()
  await page.getByRole("button", { name: "Apply 1 change" }).click()
  const applied = await inspectDesign(page)
  expect(applied.pendingChangeSet).toBeNull()
  expect(applied.document.revision).toBe(afterPage.document.revision + 1)
  expect(
    applied.fields.find((field) => field.key === "quotation_title")?.value
  ).toBe(reviewedTitle)

  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const publishDialog = page.getByRole("dialog", { name: "Publish version 1" })
  await expect(publishDialog).toContainText("Validation passed")
  await expect(publishDialog).toHaveCSS("position", "fixed")
  await expect(publishDialog).toHaveCSS("display", "grid")
  const publishBounds = await publishDialog.boundingBox()
  const viewport = page.viewportSize()
  expect(publishBounds).not.toBeNull()
  expect(publishBounds!.width).toBeGreaterThanOrEqual(320)
  expect(publishBounds!.width).toBeLessThanOrEqual(
    viewport?.width ?? Number.POSITIVE_INFINITY
  )
  await expect(
    publishDialog.getByRole("button", { name: "Publish version 1" })
  ).toHaveCSS("display", "flex")
  await publishDialog.getByRole("button", { name: "Publish version 1" }).click()
  const publishedDialog = page.getByRole("dialog", {
    name: "Version 1 is published",
  })
  await expect(publishedDialog).toContainText("Immutable")
  await publishedDialog.getByRole("button", { name: "Done" }).click()

  const templatesResponse = await page.request.get("/v1/studio/templates/")
  expect(templatesResponse.ok()).toBe(true)
  const templates = (await templatesResponse.json()) as {
    data: Array<{
      latestVersion: number
      parameterCount: number
      outputs: Array<{ id: string; pages: unknown[] }>
    }>
  }
  expect(templates.data).toHaveLength(1)
  expect(templates.data[0]).toMatchObject({
    latestVersion: 1,
    parameterCount: 1,
  })
  expect(templates.data[0]?.outputs[0]?.pages).toHaveLength(7)

  await page.getByRole("button", { name: "API playground" }).click()
  const apiDialog = page.getByRole("dialog", { name: "API playground" })
  const renderedTitle = "E2E Rendered Wedding Story"
  await apiDialog
    .getByRole("textbox", { name: "Quotation title" })
    .fill(renderedTitle)

  const renderResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/studio/render"
  )
  await apiDialog.getByRole("button", { name: "Run 1 output" }).click()
  const renderResponse = await renderResponsePromise
  expect(renderResponse.status()).toBe(202)
  const acceptedRender = (await renderResponse.json()) as RenderResponse
  expect(acceptedRender.status).toBe("queued")

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/v1/renders/${acceptedRender.id}`
        )
        expect(response.ok()).toBe(true)
        return ((await response.json()) as RenderResponse).status
      },
      { timeout: 60_000 }
    )
    .toBe("completed")
  const completedRenderResponse = await page.request.get(
    `/v1/renders/${acceptedRender.id}`
  )
  expect(completedRenderResponse.ok()).toBe(true)
  const render = (await completedRenderResponse.json()) as RenderResponse
  expect(render.status).toBe("completed")
  expect(render.artifacts).toHaveLength(1)
  const artifact = render.artifacts[0]
  expect(artifact).toMatchObject({ format: "pdf", pageId: null })
  expect(artifact.bytes).toBeGreaterThan(0)

  await expect(apiDialog.getByText("completed", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const artifactLink = apiDialog.getByRole("link", {
    name: /quotation\.pdf/i,
  })
  await expect(artifactLink).toBeVisible()

  const artifactResponse = await page.request.get(artifact.downloadUrl)
  expect(artifactResponse.ok()).toBe(true)
  expect(artifactResponse.headers()["content-type"]).toContain(
    "application/pdf"
  )
  const pdfBuffer = await artifactResponse.body()
  expect(pdfBuffer.byteLength).toBe(artifact.bytes)
  expect(pdfBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-")

  const parsedPdf = await extractPdfText(new Uint8Array(pdfBuffer))
  expect(parsedPdf.pageCount).toBe(7)
  expect(parsedPdf.text).toContain(renderedTitle)
  expect(parsedPdf.text).toContain("NORTHSTAR STUDIO")

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    artifactLink.click(),
  ])
  expect(download.suggestedFilename()).toBe("quotation.pdf")
  const downloadedPath = testInfo.outputPath("quotation.pdf")
  await download.saveAs(downloadedPath)
  await testInfo.attach("quotation.pdf", {
    path: downloadedPath,
    contentType: "application/pdf",
  })

  await apiDialog.getByRole("button", { name: "Close" }).click()
  await page.getByRole("button", { name: "Undo" }).click()
  const undone = await inspectDesign(page)
  expect(undone.document.revision).toBe(afterPage.document.revision)
  expect(
    undone.fields.find((field) => field.key === "quotation_title")?.value
  ).toBe(titleField?.value)

  await attachJourneyScreenshot(page, testInfo)
})
