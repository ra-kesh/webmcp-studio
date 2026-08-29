import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { quotationStarter } from "../../src/features/editor/quotation-starter"

test.describe.configure({ timeout: 90_000 })

const currentDraftStorageKey = "webmcp-studio:current-draft:v1"

function optionalOffPageFieldDocument() {
  const document = structuredClone(quotationStarter.document)
  const page = document.pages[1]
  const node = document.nodes.find(
    (candidate) =>
      candidate.type === "text" &&
      page.nodeIds.includes(candidate.id) &&
      !document.bindings.some(
        (binding) =>
          binding.nodeId === candidate.id && binding.property === "text"
      )
  )
  if (!node || node.type !== "text") {
    throw new Error("The off-page field fixture is unavailable")
  }
  document.fields.push({
    id: "optional-note",
    key: "optional_note",
    label: "Optional note",
    type: "text",
    required: false,
    defaultValue: "Fallback note",
    agentDescription: "A reusable note",
    validation: {},
  })
  document.fieldValues["optional-note"] = ""
  document.bindings.push({
    id: "binding-optional-note",
    fieldId: "optional-note",
    nodeId: node.id,
    property: "text",
  })
  node.text = ""
  return { document, page, node }
}

async function installFieldFixture(page: Page) {
  const fixture = optionalOffPageFieldDocument()
  await page.addInitScript(
    ({ key, document }) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          document,
          sourceContext: null,
        })
      )
    },
    { key: currentDraftStorageKey, document: fixture.document }
  )
  await page.goto(`/documents/${encodeURIComponent(fixture.document.id)}`)
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("tab", { name: "Fields" }).click()
  return fixture
}

test("optional-to-required fallback is confirmed before changing a bound value", async ({
  page,
}) => {
  await installFieldFixture(page)
  await page.getByRole("button", { name: "Edit Optional note" }).click()
  const editDialog = page.getByRole("dialog", { name: "Edit field" })
  await editDialog.getByRole("radio", { name: "Required" }).click()
  await editDialog.getByRole("button", { name: "Save changes" }).click()

  const confirmation = page.getByRole("alertdialog", {
    name: "Review field contract changes",
  })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText(
    "current value is replaced with the new default"
  )
  await confirmation
    .getByRole("button", { name: "Keep current contract" })
    .click()
})

test("contract-change impact navigation closes both dialogs before focusing the off-page property", async ({
  page,
}) => {
  const { page: targetPage, node } = await installFieldFixture(page)
  await page.getByRole("button", { name: "Edit Optional note" }).click()
  const editDialog = page.getByRole("dialog", { name: "Edit field" })
  await editDialog.getByRole("combobox", { name: "Value type" }).click()
  await page.getByRole("option", { name: "Boolean" }).click()
  await editDialog.getByRole("button", { name: "Save changes" }).click()

  const confirmation = page.getByRole("alertdialog", {
    name: "Review field contract changes",
  })
  await confirmation
    .getByRole("button", { name: new RegExp(node.name) })
    .click()

  await expect(confirmation).toBeHidden()
  await expect(editDialog).toBeHidden()
  await expect(page.getByRole("tab", { name: "Design" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(
    page.getByRole("button", {
      name: new RegExp(`Open page 2: ${targetPage.name}`),
    })
  ).toHaveAttribute("aria-current", "page")
  await expect(
    page.locator('[data-inspector-property="text"]:visible')
  ).toBeFocused()
})

test("delete-impact navigation closes the modal before focusing an off-page binding", async ({
  page,
}) => {
  const { page: targetPage, node } = await installFieldFixture(page)
  await page.getByRole("button", { name: "Delete Optional note" }).click()
  const deletion = page.getByRole("alertdialog", {
    name: "Delete Optional note?",
  })
  await deletion.getByRole("button", { name: new RegExp(node.name) }).click()

  await expect(deletion).toBeHidden()
  await expect(page.getByRole("tab", { name: "Design" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(
    page.getByRole("button", {
      name: new RegExp(`Open page 2: ${targetPage.name}`),
    })
  ).toHaveAttribute("aria-current", "page")
  await expect(
    page.locator('[data-inspector-property="text"]:visible')
  ).toBeFocused()
})

test("invalid currency bounds stay visible and block field creation", async ({
  page,
}) => {
  await installFieldFixture(page)
  await page.getByRole("button", { name: "New", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Create field" })
  await dialog.getByRole("textbox", { name: "Label" }).fill("Budget")
  await dialog.getByRole("combobox", { name: "Value type" }).click()
  await page.getByRole("option", { name: "Currency" }).click()

  const minimum = dialog.getByRole("textbox", { name: "Minimum value" })
  const maximum = dialog.getByRole("textbox", { name: "Maximum value" })
  const save = dialog.getByRole("button", { name: "Create field" })
  await minimum.fill("USD 100")
  await expect(dialog).toContainText("Minimum must be a valid INR amount.")
  await expect(minimum).toHaveAttribute("aria-invalid", "true")
  await expect(save).toBeDisabled()

  await minimum.fill("")
  await maximum.fill("abc")
  await expect(dialog).toContainText("Maximum must be a valid INR amount.")
  await expect(maximum).toHaveAttribute("aria-invalid", "true")
  await expect(save).toBeDisabled()
})
