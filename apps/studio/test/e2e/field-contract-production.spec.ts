import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { documentSchema } from "@webmcp/document"
import type { Document as StudioDocument, SceneNode } from "@webmcp/document"
import { studioAssets } from "../../src/features/editor/asset-catalog"
import { quotationStarter } from "../../src/features/editor/quotation-starter"

test.describe.configure({ timeout: 90_000 })

const currentDraftStorageKey = "webmcp-studio:current-draft:v1"
const documentDatabaseName = "webmcp-studio-documents"
const documentBodyStore = "draft-body"
const publishedStorageKey = "webmcp-studio:published-versions:v1"
const quotationSourceStorageKey = "webmcp-studio:quotation-source:v1"
const quotationTemplateStorageKey = "webmcp-studio:quotation-template:v1"
const designTemplateStorageKey = "webmcp-studio:design-template:v1"

const budgetFieldId = "field-e2e-budget"
const primaryNodeId = "field-e2e-budget-primary"
const secondaryNodeId = "field-e2e-budget-secondary"
const secondaryPageId = "field-e2e-secondary-page"
const heroAssetFieldId = "field-e2e-hero-asset"

type TestWebMcpResult = {
  structuredContent?: unknown
  isError?: boolean
}

type TestWebMcpTool = {
  name: string
  execute: (input: unknown) => TestWebMcpResult | Promise<TestWebMcpResult>
}

type FieldInspection = {
  document: {
    revision: number
    snapshotId: string
    operationVersion: number
  }
  activePage: { id: string; name: string }
  selection: { pageId: string; nodeIds: string[] } | null
  fields: Array<{
    id: string
    key: string
    required: boolean
    defaultValue: string | number | boolean
    value: string | number | boolean
    bindings: number
    bindingTargets: Array<{
      bindingId: string
      nodeId: string
      nodeName: string | null
      pageId: string | null
      pageName: string | null
      outputId: string | null
      outputName: string | null
      property: "text" | "src" | "visible" | "fill"
    }>
    affectedPages: Array<{ id: string; name: string }>
    affectedOutputs: Array<{ id: string; name: string }>
  }>
}

type StoredFieldState = {
  field: unknown
  value: unknown
  bindings: Array<{
    id: string
    fieldId: string
    nodeId: string
    property: string
  }>
}

declare global {
  interface Window {
    __studioTestTools?: Map<string, TestWebMcpTool>
  }
}

function fieldContractFixture(): StudioDocument {
  const base = structuredClone(quotationStarter.document)
  const sourceTextNode = base.nodes.find(
    (node): node is Extract<SceneNode, { type: "text" }> => node.type === "text"
  )
  if (!sourceTextNode) {
    throw new Error("The quotation fixture needs a text node")
  }

  const primaryNode: Extract<SceneNode, { type: "text" }> = {
    ...structuredClone(sourceTextNode),
    id: primaryNodeId,
    name: "Budget primary",
    x: 72,
    y: 72,
    text: "",
    locked: false,
    visible: true,
  }
  const secondaryNode: Extract<SceneNode, { type: "text" }> = {
    ...structuredClone(sourceTextNode),
    id: secondaryNodeId,
    name: "Budget secondary",
    x: 96,
    y: 96,
    text: "",
    locked: false,
    visible: true,
  }

  return documentSchema.parse({
    ...base,
    id: "field-e2e-document",
    name: "Field contract production fixture",
    revision: 0,
    updatedAt: "2026-08-28T08:00:00.000Z",
    outputs: [
      ...base.outputs,
      {
        id: "field-e2e-secondary-output",
        name: "Field secondary output",
        kind: "square",
        pageIds: [secondaryPageId],
        exportFormats: ["png"],
      },
    ],
    pages: [
      ...base.pages.map((page, index) =>
        index === 0
          ? { ...page, nodeIds: [...page.nodeIds, primaryNodeId] }
          : page
      ),
      {
        id: secondaryPageId,
        outputId: "field-e2e-secondary-output",
        name: "Field secondary page",
        width: 1080,
        height: 1080,
        background: "#FFFFFF",
        nodeIds: [secondaryNodeId],
      },
    ],
    nodes: [...base.nodes, primaryNode, secondaryNode],
    fields: [
      ...base.fields,
      {
        id: budgetFieldId,
        key: "budget",
        label: "Budget",
        type: "currency",
        required: false,
        defaultValue: "1000",
        agentDescription: "The approved project budget in Indian rupees.",
        validation: { minimum: "500", maximum: "5000" },
      },
      {
        id: heroAssetFieldId,
        key: "hero_asset",
        label: "Hero asset",
        type: "asset",
        required: true,
        defaultValue: studioAssets[0].src,
        agentDescription: "The approved public hero artwork.",
        validation: {},
      },
    ],
    fieldValues: {
      ...base.fieldValues,
      [budgetFieldId]: "",
      [heroAssetFieldId]: studioAssets[0].src,
    },
    bindings: [
      ...base.bindings,
      {
        id: "field-e2e-budget-primary-binding",
        fieldId: budgetFieldId,
        nodeId: primaryNodeId,
        property: "text",
      },
      {
        id: "field-e2e-budget-secondary-binding",
        fieldId: budgetFieldId,
        nodeId: secondaryNodeId,
        property: "text",
      },
    ],
  })
}

async function waitForEditor(page: Page) {
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
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
  return result?.structuredContent as FieldInspection
}

async function storedBudgetState(page: Page): Promise<StoredFieldState> {
  return page.evaluate(
    async ({ databaseName, storeName, documentId, fieldId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(request.error ?? new Error("Document database did not open"))
      })
      const stored = await new Promise<
        | {
            document?: {
              fields: Array<{ id: string }>
              fieldValues: Record<string, unknown>
              bindings: StoredFieldState["bindings"]
            }
          }
        | undefined
      >((resolve, reject) => {
        const request = database
          .transaction(storeName)
          .objectStore(storeName)
          .get(documentId)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(request.error ?? new Error("Document draft did not load"))
      }).finally(() => database.close())
      if (!stored?.document) {
        throw new Error("The editor document is not persisted")
      }
      return {
        field:
          stored.document.fields.find((field) => field.id === fieldId) ?? null,
        value: stored.document.fieldValues[fieldId] ?? null,
        bindings: stored.document.bindings.filter(
          (binding) => binding.fieldId === fieldId
        ),
      }
    },
    {
      databaseName: documentDatabaseName,
      storeName: documentBodyStore,
      documentId: "field-e2e-document",
      fieldId: budgetFieldId,
    }
  )
}

async function openFields(page: Page) {
  await page.getByRole("tab", { name: "Fields", exact: true }).click()
  return page.getByRole("tabpanel", { name: "Fields" })
}

async function expectBudgetFocusOnSecondaryPage(page: Page) {
  const textProperty = page.locator('[data-inspector-property="text"]:visible')
  await expect(textProperty).toBeFocused()
  await expect(textProperty).toHaveClass(/ring-2/)
  await expect
    .poll(async () => (await inspectDesign(page)).activePage.id)
    .toBe(secondaryPageId)
  await expect
    .poll(async () => (await inspectDesign(page)).selection?.nodeIds)
    .toEqual([secondaryNodeId])
  await expect(
    page.getByRole("tab", { name: "Design", exact: true })
  ).toHaveAttribute("data-state", "active")
}

test.beforeEach(async ({ page }) => {
  const serializedDocument = JSON.stringify(fieldContractFixture())
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
  await page.addInitScript(
    ({ envelopeValue, storageKey, keysToRemove }) => {
      localStorage.setItem(storageKey, envelopeValue)
      for (const key of keysToRemove) localStorage.removeItem(key)
      sessionStorage.clear()
    },
    {
      envelopeValue: JSON.stringify({
        schemaVersion: 1,
        document: JSON.parse(serializedDocument),
        sourceContext: null,
      }),
      storageKey: currentDraftStorageKey,
      keysToRemove: [
        publishedStorageKey,
        quotationSourceStorageKey,
        quotationTemplateStorageKey,
        designTemplateStorageKey,
      ],
    }
  )
  await page.goto("/documents/field-e2e-document")
  await waitForEditor(page)
})

test("currency bounds block invalid saves and required replacement is explicit", async ({
  page,
}) => {
  const fields = await openFields(page)
  await fields.getByRole("button", { name: "Edit Budget" }).click()
  const editDialog = page.getByRole("dialog", { name: "Edit field" })
  const minimum = editDialog.getByLabel("Minimum value")
  const maximum = editDialog.getByLabel("Maximum value")
  const save = editDialog.getByRole("button", { name: "Save changes" })

  await minimum.fill("USD 100")
  await expect(minimum).toHaveAttribute("aria-invalid", "true")
  await expect(
    editDialog.getByText("Minimum must be a valid INR amount.")
  ).toBeVisible()
  await expect(save).toBeDisabled()

  await minimum.fill("INR 500")
  await maximum.fill("abc")
  await expect(maximum).toHaveAttribute("aria-invalid", "true")
  await expect(
    editDialog.getByText("Maximum must be a valid INR amount.")
  ).toBeVisible()
  await expect(save).toBeDisabled()

  await maximum.fill("INR 5,000")
  await expect(save).toBeDisabled()
  await editDialog.getByRole("radio", { name: "Required" }).click()
  await expect(save).toBeEnabled()
  await save.click()

  const confirmation = page.getByRole("alertdialog", {
    name: "Review field contract changes",
  })
  await expect(confirmation).toContainText(
    "0 bindings will be removed across 0 outputs; current value is replaced with the new default"
  )
  await confirmation.getByRole("button", { name: "Apply changes" }).click()

  await expect
    .poll(async () => {
      const budget = (await inspectDesign(page)).fields.find(
        (field) => field.id === budgetFieldId
      )
      return {
        required: budget?.required,
        defaultValue: budget?.defaultValue,
        value: budget?.value,
        bindings: budget?.bindings,
      }
    })
    .toEqual({
      required: true,
      defaultValue: "1000",
      value: "1000",
      bindings: 2,
    })
})

test("deletion impact navigates across pages and one Undo restores the transaction", async ({
  page,
}) => {
  const initial = await inspectDesign(page)
  const initialBudget = initial.fields.find(
    (field) => field.id === budgetFieldId
  )
  expect(initialBudget).toMatchObject({
    bindings: 2,
    affectedPages: expect.arrayContaining([
      expect.objectContaining({ id: secondaryPageId }),
    ]),
    affectedOutputs: expect.arrayContaining([
      expect.objectContaining({ id: "field-e2e-secondary-output" }),
    ]),
  })

  let fields = await openFields(page)
  await fields.getByRole("button", { name: "Delete Budget" }).click()
  let deletion = page.getByRole("alertdialog", { name: "Delete Budget?" })
  await expect(deletion).toContainText(
    "This removes 2 bindings across 2 outputs and 2 pages. Existing layer content stays in place, and Undo restores the field, value, and every binding together."
  )
  await expect(
    deletion.getByRole("button", { name: /Budget primary.*Text content/ })
  ).toBeVisible()
  const offPageBinding = deletion.getByRole("button", {
    name: /Budget secondary.*Field secondary page.*Text content/,
  })
  await offPageBinding.click()
  await expect(deletion).toBeHidden()
  await expectBudgetFocusOnSecondaryPage(page)

  fields = await openFields(page)
  await fields.getByRole("button", { name: "Delete Budget" }).click()
  deletion = page.getByRole("alertdialog", { name: "Delete Budget?" })
  await deletion.getByRole("button", { name: "Delete field" }).click()

  await expect
    .poll(async () => {
      const inspection = await inspectDesign(page)
      return inspection.fields.some((field) => field.id === budgetFieldId)
    })
    .toBe(false)
  await expect
    .poll(async () => storedBudgetState(page))
    .toEqual({
      field: null,
      value: null,
      bindings: [],
    })

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect
    .poll(async () => {
      const budget = (await inspectDesign(page)).fields.find(
        (field) => field.id === budgetFieldId
      )
      return budget
        ? {
            value: budget.value,
            bindings: budget.bindings,
            targetIds: budget.bindingTargets
              .map((target) => target.nodeId)
              .sort(),
          }
        : null
    })
    .toEqual({
      value: "",
      bindings: 2,
      targetIds: [primaryNodeId, secondaryNodeId].sort(),
    })
  await expect
    .poll(async () => storedBudgetState(page))
    .toMatchObject({
      field: expect.objectContaining({ id: budgetFieldId, key: "budget" }),
      value: "",
      bindings: expect.arrayContaining([
        expect.objectContaining({ nodeId: primaryNodeId, property: "text" }),
        expect.objectContaining({ nodeId: secondaryNodeId, property: "text" }),
      ]),
    })
  expect((await inspectDesign(page)).document.snapshotId).toBe(
    initial.document.snapshotId
  )
})

test("compact Properties stays open while a binding navigates off-page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const propertiesTrigger = page.getByRole("button", {
    name: "Open properties",
  })
  await propertiesTrigger.click()
  const properties = page.getByRole("dialog", { name: "Properties" })
  await expect(properties).toBeVisible()
  await properties.getByRole("tab", { name: "Fields", exact: true }).click()
  await properties
    .getByLabel("Budget bindings")
    .getByRole("button", { name: /Budget secondary.*Field secondary page/ })
    .click()

  await expect(properties).toBeVisible()
  await expectBudgetFocusOnSecondaryPage(page)
})

test("compact API Playground exposes only the approved public asset ID", async ({
  page,
}) => {
  const reset = await page.request.post("/v1/studio/session/reset")
  expect(reset.ok()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })

  const openFileCommand = async (commandName: string) => {
    await page.getByRole("button", { name: /^More studio actions/ }).click()
    await page.getByRole("menuitem", { name: "File", exact: true }).click()
    await page.getByRole("menuitem", { name: commandName, exact: true }).click()
  }

  await openFileCommand("Publish")
  const publishDialog = page.getByRole("dialog", { name: "Publish version 1" })
  await expect(publishDialog).toContainText("Validation passed")
  await publishDialog
    .getByRole("button", { name: "Publish version 1", exact: true })
    .click()
  await expect(
    page.getByRole("dialog", { name: "Version 1 is published" })
  ).toContainText("Immutable")
  await page.getByRole("button", { name: "Done", exact: true }).click()

  await openFileCommand("Open API Playground")
  const apiDialog = page.getByRole("dialog", { name: "API playground" })
  await expect(
    apiDialog.getByRole("combobox", { name: "Hero asset" })
  ).toContainText(studioAssets[0].name)
  const requestBody = apiDialog.locator("pre")
  await expect(requestBody).toContainText('"hero_asset": "olive-botanical"')
  await expect(requestBody).not.toContainText("data:image")
})
