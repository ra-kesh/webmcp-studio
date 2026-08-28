import { describe, expect, it } from "vitest"
import { applyCommand } from "@webmcp/document"
import { quotationStarter } from "./quotation-starter"
import {
  analyzeFieldDefinitionChange,
  fieldDefinitionsEqual,
  validateFieldBoundDrafts,
} from "./field-definition-change-model"

function optionalBoundFieldDocument() {
  const created = applyCommand(quotationStarter.document, {
    id: "add-optional-note",
    type: "add_field",
    actor: "human",
    at: "2026-08-28T14:00:00.000Z",
    field: {
      id: "optional-note",
      key: "optional_note",
      label: "Optional note",
      type: "text",
      required: false,
      defaultValue: "Fallback note",
      agentDescription: "A note reused in the document",
      validation: {},
    },
  })
  const emptied = applyCommand(created, {
    id: "empty-optional-note",
    type: "set_field",
    actor: "human",
    at: "2026-08-28T14:01:00.000Z",
    fieldId: "optional-note",
    value: "",
  })
  const secondPage = emptied.pages[1]
  const target = emptied.nodes.find(
    (node) =>
      node.type === "text" &&
      secondPage.nodeIds.includes(node.id) &&
      !emptied.bindings.some(
        (binding) => binding.nodeId === node.id && binding.property === "text"
      )
  )
  if (!target) throw new Error("The off-page text fixture is unavailable")
  return applyCommand(emptied, {
    id: "bind-optional-note",
    type: "bind_field",
    actor: "human",
    at: "2026-08-28T14:02:00.000Z",
    binding: {
      id: "binding-optional-note",
      fieldId: "optional-note",
      nodeId: target.id,
      property: "text",
    },
  })
}

describe("field definition change model", () => {
  it("recognizes an unchanged definition so Save can remain a no-op", () => {
    const document = optionalBoundFieldDocument()
    const field = document.fields.find(
      (candidate) => candidate.id === "optional-note"
    )
    if (!field) throw new Error("The optional field fixture is unavailable")

    expect(fieldDefinitionsEqual(field, { ...field })).toBe(true)
    expect(
      fieldDefinitionsEqual(field, { ...field, agentDescription: "Changed" })
    ).toBe(false)
  })

  it("requires confirmation when optional becomes required and replaces an empty bound value", () => {
    const document = optionalBoundFieldDocument()
    const field = document.fields.find(
      (candidate) => candidate.id === "optional-note"
    )
    if (!field) throw new Error("The optional field fixture is unavailable")

    const impact = analyzeFieldDefinitionChange(document, field, {
      ...field,
      required: true,
    })

    expect(impact).toMatchObject({
      fieldContractChanged: true,
      apiKeyChanged: false,
      requiresConfirmation: true,
      typeImpact: {
        currentValue: "",
        nextValue: "Fallback note",
        currentValueDisposition: "replaced_with_default",
        requiresConfirmation: true,
      },
    })
    expect(impact.typeImpact?.bindings).toHaveLength(1)
    expect(impact.typeImpact?.summary).toContain(
      "current value is replaced with the new default"
    )
  })

  it("rejects invalid currency minimum and maximum drafts independently", () => {
    expect(validateFieldBoundDrafts("currency", "USD 100", "")).toEqual({
      minimum: "Minimum must be a valid INR amount.",
      maximum: null,
    })
    expect(validateFieldBoundDrafts("currency", "", "abc")).toEqual({
      minimum: null,
      maximum: "Maximum must be a valid INR amount.",
    })
    expect(validateFieldBoundDrafts("currency", "₹1,000", "INR 2,000")).toEqual(
      { minimum: null, maximum: null }
    )
  })
})
