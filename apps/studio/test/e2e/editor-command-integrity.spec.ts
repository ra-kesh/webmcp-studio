import { expect, test } from "@playwright/test"

type TestWebMcpResult = {
  structuredContent?: unknown
  isError?: boolean
}

type TestWebMcpTool = {
  name: string
  execute: (input: unknown) => TestWebMcpResult | Promise<TestWebMcpResult>
}

declare global {
  interface Window {
    __studioTestTools?: Map<string, TestWebMcpTool>
  }
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
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
})

test("V selects the pointer tool without clearing the active layer", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Layers" }).click()
  await page.getByRole("button", { name: "Expand Cover layout" }).click()
  await page.getByRole("button", { name: "Expand Cover identity" }).click()
  await page
    .getByRole("treeitem", { name: "Quotation title", exact: true })
    .click()
  await expect(page.getByText("Selected layer", { exact: true })).toBeVisible()

  await page.keyboard.press("v")

  await expect(page.getByText("Selected layer", { exact: true })).toBeVisible()
})

test("pending review disables mutations without creating ghost state", async ({
  page,
}) => {
  const proposalResult = await page.evaluate(async () => {
    const tools = window.__studioTestTools
    const inspect = await tools?.get("inspect_design")?.execute({})
    const snapshot = inspect?.structuredContent as
      | {
          document: {
            id: string
            revision: number
            snapshotId: string
            operationVersion: number
          }
          fields: Array<{ key: string; value: string | number | boolean }>
        }
      | undefined
    const field = snapshot?.fields[0]
    if (!snapshot || !field) throw new Error("Inspectable field is unavailable")
    return tools?.get("propose_field_updates")?.execute({
      documentId: snapshot.document.id,
      baseRevision: snapshot.document.revision,
      baseSnapshotId: snapshot.document.snapshotId,
      values: { [field.key]: `${field.value} — Preview` },
      reason: "Review-mode command regression",
    })
  })
  expect(proposalResult?.isError).not.toBe(true)

  await expect(page.getByRole("button", { name: "Add text" })).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Insert shape" })
  ).toBeDisabled()
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()
  await expect(page.getByRole("tab", { name: "Review" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByRole("tab", { name: "Design" })).toBeDisabled()
  await expect(page.getByRole("tab", { name: "Fields" })).toBeDisabled()
  await expect(
    page.getByRole("button", { name: /Editorial Olive/ })
  ).toBeDisabled()

  await page.getByRole("tab", { name: "Pages" }).click()
  const pagesPanel = page.getByRole("tabpanel", { name: "Pages" })
  await expect(
    pagesPanel.getByRole("button", { name: "Add output", exact: true }).first()
  ).toBeDisabled()
  await expect(
    pagesPanel.getByRole("button", { name: "Add page to Quotation" })
  ).toBeDisabled()
  await pagesPanel
    .getByRole("button", { name: "More actions for Cover" })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Duplicate page" })
  ).toBeDisabled()
  await expect(
    page.getByRole("menuitem", { name: "Page settings" })
  ).toBeDisabled()
  await page.keyboard.press("Escape")

  const before = await page.evaluate(async () => {
    const result = await window.__studioTestTools
      ?.get("inspect_design")
      ?.execute({})
    return result?.structuredContent
  })
  await page.keyboard.press("t")
  const after = await page.evaluate(async () => {
    const result = await window.__studioTestTools
      ?.get("inspect_design")
      ?.execute({})
    return result?.structuredContent
  })

  expect(after).toEqual(before)
})
