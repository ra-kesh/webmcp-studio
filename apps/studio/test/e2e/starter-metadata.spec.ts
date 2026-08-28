import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const DRAFT_STORAGE_KEY = "webmcp-studio:northstar-document:v2"

async function openNewDocumentDialog(page: Page) {
  await page.getByRole("button", { name: "Document file actions" }).click()
  await page.getByRole("menuitem", { name: "New document…" }).click()
  const dialog = page.getByRole("dialog", { name: "Start a document" })
  await expect(dialog).toBeVisible()
  return dialog
}

test("starter claims equal the aggregate restored by reset", async ({
  page,
}) => {
  await page.goto("/")

  let dialog = await openNewDocumentDialog(page)
  await dialog.getByRole("button", { name: "Portrait document" }).click()
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const value = localStorage.getItem(key)
        if (!value) return null
        return (JSON.parse(value) as { name?: string }).name ?? null
      }, DRAFT_STORAGE_KEY)
    )
    .toBe("Portrait document")

  dialog = await openNewDocumentDialog(page)
  const claims = await dialog.evaluate((element) => {
    const text = (testId: string) =>
      element.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
        ?.textContent ?? ""
    return {
      name: text("starter-document-name").trim(),
      pageCount: Number.parseInt(text("starter-page-count"), 10),
      outputCount: Number.parseInt(text("starter-output-count"), 10),
      outputs: Array.from(
        element.querySelectorAll<HTMLElement>("[data-output-id]")
      ).map((output) => ({
        id: output.dataset.outputId ?? "",
        name: output.dataset.outputName ?? "",
        pageCount: Number(output.dataset.outputPageCount),
        exportFormats: (output.dataset.outputFormats ?? "").split(","),
        visibleDescription: output.textContent.replace(/\s+/g, " ").trim(),
      })),
    }
  })

  await dialog.getByRole("button", { name: "Reset to starter" }).click()

  await expect
    .poll(() =>
      page.evaluate((key) => {
        const value = localStorage.getItem(key)
        if (!value) return null
        const document = JSON.parse(value) as {
          name: string
          pages: Array<{ id: string }>
          outputs: Array<{
            id: string
            name: string
            pageIds: string[]
            exportFormats: string[]
          }>
        }
        return document.name === "Portrait document" ? null : document
      }, DRAFT_STORAGE_KEY)
    )
    .not.toBeNull()

  const restored = await page.evaluate((key) => {
    const value = localStorage.getItem(key)
    if (!value) return null
    return JSON.parse(value) as {
      name: string
      pages: Array<{ id: string }>
      outputs: Array<{
        id: string
        name: string
        pageIds: string[]
        exportFormats: string[]
      }>
    }
  }, DRAFT_STORAGE_KEY)
  if (!restored) throw new Error("The starter document was not persisted")
  expect(claims.name).toBe(restored.name)
  expect(claims.pageCount).toBe(restored.pages.length)
  expect(claims.outputCount).toBe(restored.outputs.length)
  expect(claims.outputs).toHaveLength(restored.outputs.length)

  for (const output of claims.outputs) {
    const restoredOutput = restored.outputs.find(
      (candidate) => candidate.id === output.id
    )
    expect(restoredOutput).toBeDefined()
    expect(output.name).toBe(restoredOutput?.name)
    expect(output.pageCount).toBe(restoredOutput?.pageIds.length)
    expect(output.exportFormats).toEqual(restoredOutput?.exportFormats)
    expect(output.visibleDescription).toContain(output.name)
    expect(output.visibleDescription).toContain(`${output.pageCount} pages`)
    for (const format of output.exportFormats) {
      expect(output.visibleDescription).toContain(format.toUpperCase())
    }
  }
})
