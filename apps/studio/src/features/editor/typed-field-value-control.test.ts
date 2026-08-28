import { describe, expect, it } from "vitest"
import type { FieldDefinition, FieldType, FieldValue } from "@webmcp/document"
import {
  fieldDraftValue,
  parseTypedFieldDraft,
} from "./typed-field-value-control"

const field = (
  type: FieldType,
  overrides: Partial<FieldDefinition> = {}
): FieldDefinition => ({
  id: `${type}_field`,
  key: `${type}_field`,
  label: `${type} field`,
  type,
  required: false,
  defaultValue: type === "number" ? 0 : type === "boolean" ? false : "",
  agentDescription: "",
  validation: {},
  ...overrides,
})

describe("typed field control contract", () => {
  it.each<[FieldDefinition, string, FieldValue]>([
    [field("text"), "Wedding Story", "Wedding Story"],
    [field("number"), "125.5", 125.5],
    [field("currency"), "₹3,85,000.50", "385000.50"],
    [field("date"), "2028-02-29", "2028-02-29"],
    [field("boolean"), "false", false],
    [field("color"), "#1f2937", "#1f2937"],
    [
      field("choice", {
        validation: {
          options: [
            { value: "editorial", label: "Editorial", agentDescription: "" },
          ],
        },
      }),
      "editorial",
      "editorial",
    ],
  ])(
    "parses %s drafts into canonical stored values",
    (definition, draft, value) => {
      expect(parseTypedFieldDraft(definition, draft)).toEqual({
        ok: true,
        value,
      })
    }
  )

  it("enforces required whitespace and configured text limits", () => {
    const definition = field("text", {
      required: true,
      validation: { minLength: 4, maxLength: 8 },
    })
    expect(parseTypedFieldDraft(definition, "   ")).toMatchObject({ ok: false })
    expect(parseTypedFieldDraft(definition, "abc")).toMatchObject({ ok: false })
    expect(parseTypedFieldDraft(definition, "ninechars")).toMatchObject({
      ok: false,
    })
    expect(parseTypedFieldDraft(definition, "proposal")).toEqual({
      ok: true,
      value: "proposal",
    })
  })

  it("enforces numeric and currency bounds after parsing", () => {
    const quantity = field("number", {
      validation: { minimum: 2, maximum: 5 },
    })
    const price = field("currency", {
      validation: { minimum: "1000", maximum: "5000" },
    })
    expect(parseTypedFieldDraft(quantity, "1")).toMatchObject({ ok: false })
    expect(parseTypedFieldDraft(quantity, "5")).toEqual({ ok: true, value: 5 })
    expect(parseTypedFieldDraft(price, "₹999")).toMatchObject({ ok: false })
    expect(parseTypedFieldDraft(price, "₹3,500")).toEqual({
      ok: true,
      value: "3500",
    })
  })

  it("rejects invalid dates, unsafe colors, foreign currencies, and unknown choices", () => {
    const choice = field("choice", {
      validation: {
        options: [{ value: "olive", label: "Olive", agentDescription: "" }],
      },
    })
    expect(parseTypedFieldDraft(field("date"), "2027-02-29")).toMatchObject({
      ok: false,
    })
    expect(
      parseTypedFieldDraft(field("color"), "url(javascript:alert(1))")
    ).toMatchObject({ ok: false })
    expect(
      parseTypedFieldDraft(field("currency"), "USD 1,250.75")
    ).toMatchObject({ ok: false })
    expect(parseTypedFieldDraft(choice, "midnight")).toMatchObject({
      ok: false,
    })
  })

  it("keeps asset validation and currency draft normalization intact", () => {
    expect(
      parseTypedFieldDraft(field("asset"), "http://example.test/image.png")
    ).toMatchObject({ ok: false })
    expect(fieldDraftValue("currency", "₹3,85,000")).toBe("385000")
    expect(fieldDraftValue("currency", "INR 1,250.75")).toBe("1250.75")
  })
})
