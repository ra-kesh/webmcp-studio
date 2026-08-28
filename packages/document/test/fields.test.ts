import { describe, expect, it } from "vitest"
import {
  applyCommand,
  applyFieldValues,
  analyzeFieldDeletion,
  analyzeFieldTypeChange,
  defaultFieldValue,
  fieldCanBindToProperty,
  fieldDefinitionValidationMessage,
  fieldDefinitionSchema,
  fieldValueMatchesType,
  fieldValueSatisfiesDefinition,
  formatFieldValueForText,
  northstarSeed,
  normalizeFieldValueForStorage,
  parseAssetReference,
  parseCurrencyValue,
} from "../src"

const definition = (
  type:
    | "text"
    | "number"
    | "currency"
    | "date"
    | "asset"
    | "color"
    | "choice"
    | "boolean",
  defaultValue: string | number | boolean,
  required = false
) => ({
  id: `${type}-field`,
  key: `${type}_field`,
  label: `${type} field`,
  type,
  required,
  defaultValue,
  agentDescription: "",
  validation: {},
})

describe("typed field values", () => {
  it("provides type-correct empty defaults without changing stored JSON shapes", () => {
    expect(defaultFieldValue("text")).toBe("")
    expect(defaultFieldValue("number")).toBe(0)
    expect(defaultFieldValue("currency")).toBe("0")
    expect(defaultFieldValue("date")).toBe("")
    expect(defaultFieldValue("asset")).toBe("")
    expect(defaultFieldValue("color")).toBe("")
    expect(defaultFieldValue("choice")).toBe("")
    expect(defaultFieldValue("boolean")).toBe(false)
    expect(
      fieldDefinitionSchema.parse(definition("currency", "₹3,85,000"))
    ).toMatchObject({ type: "currency", defaultValue: "₹3,85,000" })
  })

  it("models agent metadata, color values, and configured choices", () => {
    const color = fieldDefinitionSchema.parse({
      ...definition("color", "#223329", true),
      agentDescription: "Use the studio accent color",
    })
    expect(color.agentDescription).toBe("Use the studio accent color")
    expect(fieldValueSatisfiesDefinition(color, "hsl(150 20% 20%)")).toBe(true)
    expect(fieldValueSatisfiesDefinition(color, "url(https://bad.test)")).toBe(
      false
    )

    const choice = fieldDefinitionSchema.parse({
      ...definition("choice", "editorial", true),
      validation: {
        options: [
          {
            value: "editorial",
            label: "Editorial",
            agentDescription: "Quiet and premium",
          },
          { value: "bold", label: "Bold" },
        ],
      },
    })
    expect(fieldValueSatisfiesDefinition(choice, "editorial")).toBe(true)
    expect(fieldValueSatisfiesDefinition(choice, "unknown")).toBe(false)
    expect(formatFieldValueForText(choice, "editorial")).toBe("Editorial")
    expect(
      fieldDefinitionSchema.safeParse(definition("choice", "missing"))
    ).toMatchObject({ success: false })

    const fillNode = northstarSeed.nodes.find(
      (node) => node.id === "cover-panel"
    )!
    const text = northstarSeed.fields.find(
      (field) => field.id === "couple_names"
    )!
    expect(fieldCanBindToProperty(color, fillNode, "fill")).toBe(true)
    expect(fieldCanBindToProperty(text, fillNode, "fill")).toBe(false)
  })

  it("enforces required whitespace and value constraints without exponent crashes", () => {
    const constrainedText = fieldDefinitionSchema.parse({
      ...definition("text", "Proposal", true),
      validation: { minLength: 3, maxLength: 12 },
    })
    expect(fieldValueSatisfiesDefinition(constrainedText, "  ")).toBe(false)
    expect(fieldValueSatisfiesDefinition(constrainedText, "No")).toBe(false)
    expect(fieldValueSatisfiesDefinition(constrainedText, "Proposal")).toBe(
      true
    )

    const hugeNumber = fieldDefinitionSchema.parse({
      ...definition("number", 1e21, true),
      validation: { minimum: 1e20, maximum: 1e22 },
    })
    expect(() => fieldValueSatisfiesDefinition(hugeNumber, 1e21)).not.toThrow()
    expect(fieldValueSatisfiesDefinition(hugeNumber, 1e21)).toBe(true)
    expect(fieldValueSatisfiesDefinition(hugeNumber, 1e19)).toBe(false)

    const tinyCurrency = fieldDefinitionSchema.parse({
      ...definition("currency", 1e-7, false),
      validation: { minimum: 0, maximum: 1 },
    })
    expect(() =>
      fieldValueSatisfiesDefinition(tinyCurrency, 1e-7)
    ).not.toThrow()
    expect(fieldValueSatisfiesDefinition(tinyCurrency, 1e-7)).toBe(true)
    expect(parseCurrencyValue(1e21)?.decimal).toBe("1000000000000000000000")
    expect(parseCurrencyValue(1e-7)?.decimal).toBe("0.0000001")
    expect(() => normalizeFieldValueForStorage(tinyCurrency, 1e-7)).toThrow(
      "cannot exceed two decimal places"
    )
    expect(fieldDefinitionValidationMessage(tinyCurrency)).toBeNull()
  })

  it("validates finite numbers, ISO calendar dates, and required defaults", () => {
    expect(
      fieldDefinitionSchema.safeParse(definition("number", 12)).success
    ).toBe(true)
    expect(
      fieldDefinitionSchema.safeParse(definition("number", "12" as never))
        .success
    ).toBe(false)
    expect(
      fieldDefinitionSchema.safeParse(definition("number", Infinity)).success
    ).toBe(false)

    expect(
      fieldDefinitionSchema.safeParse(definition("date", "2028-02-29")).success
    ).toBe(true)
    expect(
      fieldDefinitionSchema.safeParse(definition("date", "2027-02-29")).success
    ).toBe(false)
    expect(
      fieldDefinitionSchema.safeParse(definition("date", "29/02/2028")).success
    ).toBe(false)
    expect(
      fieldDefinitionSchema.safeParse(definition("date", "", true)).success
    ).toBe(false)
    expect(
      fieldDefinitionSchema.safeParse(definition("date", "", false)).success
    ).toBe(true)
  })

  it("accepts canonical INR currency and deliberate INR legacy forms", () => {
    expect(fieldValueMatchesType({ type: "currency" }, "385000.50")).toBe(true)
    expect(fieldValueMatchesType({ type: "currency" }, "₹3,85,000")).toBe(true)
    expect(fieldValueMatchesType({ type: "currency" }, "INR 1,250.75")).toBe(
      true
    )
    expect(fieldValueMatchesType({ type: "currency" }, "USD 1,250.75")).toBe(
      false
    )
    expect(fieldValueMatchesType({ type: "currency" }, "$1,250.75")).toBe(false)
    expect(fieldValueMatchesType({ type: "currency" }, "-₹1,250.75")).toBe(true)
    expect(fieldValueMatchesType({ type: "currency" }, 1250.75)).toBe(true)
    expect(fieldValueMatchesType({ type: "currency" }, "12.345")).toBe(false)
    expect(fieldValueMatchesType({ type: "currency" }, "1,00")).toBe(false)
    expect(fieldValueMatchesType({ type: "currency" }, "lots of money")).toBe(
      false
    )

    expect(parseCurrencyValue("00385000.50")).toBeNull()
    expect(parseCurrencyValue("385000.50")).toEqual({
      decimal: "385000.50",
      source: "canonical_decimal",
      precise: true,
    })
    expect(parseCurrencyValue("₹3,85,000")).toEqual({
      decimal: "385000",
      source: "legacy_formatted",
      precise: true,
    })
    expect(parseCurrencyValue(-1250.5)).toEqual({
      decimal: "-1250.5",
      source: "legacy_number",
      precise: false,
    })
    expect(parseCurrencyValue("-0.50")).toMatchObject({ decimal: "-0.50" })
    expect(parseCurrencyValue("-₹0.50")).toMatchObject({ decimal: "-0.50" })
    expect(parseCurrencyValue("-INR 0.50")).toMatchObject({
      decimal: "-0.50",
    })
  })

  it("classifies compatible asset references without pretending they are publish-ready", () => {
    expect(parseAssetReference("asset:local/portrait-01")).toEqual({
      reference: "asset:local/portrait-01",
      source: "managed_local",
      publishRequiresResolution: true,
    })
    expect(
      parseAssetReference(
        "asset:managed/asset-0123456789abcdef0123456789abcdef"
      )
    ).toEqual({
      reference: "asset:managed/asset-0123456789abcdef0123456789abcdef",
      source: "managed_workspace",
      publishRequiresResolution: true,
    })
    expect(
      parseAssetReference("https://assets.example.test/portrait.png")
    ).toEqual({
      reference: "https://assets.example.test/portrait.png",
      source: "legacy_https",
      publishRequiresResolution: true,
    })
    const inlineSvg =
      "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M0%200h1v1z%22%2F%3E%3C%2Fsvg%3E"
    expect(parseAssetReference(inlineSvg)).toEqual({
      reference: inlineSvg,
      source: "inline_render_safe",
      publishRequiresResolution: false,
    })
    expect(
      parseAssetReference("http://assets.example.test/portrait.png")
    ).toBeNull()
    expect(parseAssetReference("javascript:alert(1)")).toBeNull()
    expect(
      parseAssetReference(
        "data:image/svg+xml,%3Csvg%3E%3Cscript%2F%3E%3C%2Fsvg%3E"
      )
    ).toBeNull()
  })

  it("serializes binding text without locale-dependent mutation", () => {
    expect(formatFieldValueForText({ type: "date" }, "2028-02-29")).toBe(
      "29 February 2028"
    )
    expect(formatFieldValueForText({ type: "currency" }, "₹3,85,000")).toBe(
      "₹3,85,000"
    )
    expect(formatFieldValueForText({ type: "boolean" }, false)).toBe("false")
    expect(() =>
      formatFieldValueForText({ type: "date" }, "29/02/2028")
    ).toThrow("Invalid value")
  })

  it("keeps an optional empty currency value empty through storage and rendering", () => {
    const field = {
      id: "discount",
      key: "discount",
      label: "Discount",
      type: "currency" as const,
      required: false,
      defaultValue: "",
    }
    expect(normalizeFieldValueForStorage(field, "")).toBe("")
    expect(formatFieldValueForText(field, "")).toBe("")
  })

  it("keeps serialized dates canonical and renders deterministic human text", () => {
    const document = {
      ...northstarSeed,
      fields: northstarSeed.fields.map((field) =>
        field.id === "event_date"
          ? { ...field, type: "date" as const, defaultValue: "2027-01-18" }
          : field
      ),
      fieldValues: {
        ...northstarSeed.fieldValues,
        event_date: "2027-01-18",
      },
    }
    const applied = applyFieldValues(document)
    expect(applied.fieldValues.event_date).toBe("2027-01-18")
    expect(
      applied.nodes.find((node) => node.id === "cover-date")
    ).toMatchObject({ text: "18 January 2027" })
  })

  it("canonicalizes new currency writes and preserves legacy display strings", () => {
    const updated = applyCommand(northstarSeed, {
      id: "set-canonical-price",
      type: "set_field",
      actor: "api",
      at: "2026-08-28T12:00:00.000Z",
      fieldId: "package_price",
      value: "INR 385,000.50",
    })
    expect(updated.fieldValues.package_price).toBe("385000.50")
    expect(
      updated.nodes.find((node) => node.id === "package-price")
    ).toMatchObject({ text: "₹3,85,000.50" })
    expect(updated.nodes.find((node) => node.id === "wa-price")).toMatchObject({
      text: "₹3,85,000.50",
    })

    const legacy = applyFieldValues(northstarSeed)
    expect(
      legacy.nodes.find((node) => node.id === "package-price")
    ).toMatchObject({ text: "₹3,85,000" })

    const numeric = applyCommand(northstarSeed, {
      id: "set-numeric-price",
      type: "set_field",
      actor: "api",
      at: "2026-08-28T12:01:00.000Z",
      fieldId: "package_price",
      value: 12.5,
    })
    expect(numeric.fieldValues.package_price).toBe("12.5")
  })

  it("rejects invalid required writes and an empty bound asset", () => {
    expect(() =>
      applyCommand(northstarSeed, {
        id: "blank-required-title",
        type: "set_field",
        actor: "human",
        at: "2026-08-28T12:00:00.000Z",
        fieldId: "couple_names",
        value: "   ",
      })
    ).toThrow("Invalid value")
    expect(() =>
      applyCommand(northstarSeed, {
        id: "invalid-required-default",
        type: "add_field",
        actor: "human",
        at: "2026-08-28T12:00:30.000Z",
        field: {
          id: "required-note",
          key: "required_note",
          label: "Required note",
          type: "text",
          required: true,
          defaultValue: "   ",
          agentDescription: "Required API note",
          validation: {},
        },
      })
    ).toThrow("Required fields need a non-empty default value")

    const withCount = applyCommand(northstarSeed, {
      id: "add-guest-count",
      type: "add_field",
      actor: "human",
      at: "2026-08-28T12:00:40.000Z",
      field: {
        id: "guest-count",
        key: "guest_count",
        label: "Guest count",
        type: "number",
        required: true,
        defaultValue: 100,
        agentDescription: "Expected guest count",
        validation: { minimum: 1, maximum: 500 },
      },
    })
    expect(() =>
      applyCommand(withCount, {
        id: "set-invalid-guest-count",
        type: "set_field",
        actor: "api",
        at: "2026-08-28T12:00:50.000Z",
        fieldId: "guest-count",
        value: 501,
      })
    ).toThrow("Invalid value")

    const withAsset = applyCommand(northstarSeed, {
      id: "add-empty-asset",
      type: "add_field",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      field: {
        id: "portrait-field",
        key: "portrait_field",
        label: "Portrait",
        type: "asset",
        required: false,
        defaultValue: "",
        agentDescription: "Portrait selected from uploads",
        validation: {},
      },
    })
    const withImage = applyCommand(withAsset, {
      id: "add-portrait-node",
      type: "add_node",
      actor: "human",
      at: "2026-08-28T12:02:00.000Z",
      pageId: "cover",
      node: {
        id: "portrait-node",
        type: "image",
        name: "Portrait",
        x: 20,
        y: 20,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId: "portrait-asset",
        src: "https://assets.example.test/portrait.png",
        placement: {
          mode: "fill",
          focalX: 0.5,
          focalY: 0.5,
          zoom: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        frameMask: { shape: "rectangle" },
        alt: "Portrait",
        decorative: false,
      },
    })
    expect(() =>
      applyCommand(withImage, {
        id: "bind-empty-portrait",
        type: "bind_field",
        actor: "human",
        at: "2026-08-28T12:03:00.000Z",
        binding: {
          id: "bind-portrait",
          fieldId: "portrait-field",
          nodeId: "portrait-node",
          property: "src",
        },
      })
    ).toThrow("needs a valid value before binding")

    const filled = applyCommand(withImage, {
      id: "set-portrait-value",
      type: "set_field",
      actor: "human",
      at: "2026-08-28T12:04:00.000Z",
      fieldId: "portrait-field",
      value: "https://assets.example.test/portrait.png",
    })
    const bound = applyCommand(filled, {
      id: "bind-filled-portrait",
      type: "bind_field",
      actor: "human",
      at: "2026-08-28T12:05:00.000Z",
      binding: {
        id: "bind-filled-portrait",
        fieldId: "portrait-field",
        nodeId: "portrait-node",
        property: "src",
      },
    })
    expect(() =>
      applyCommand(bound, {
        id: "clear-bound-portrait",
        type: "set_field",
        actor: "human",
        at: "2026-08-28T12:06:00.000Z",
        fieldId: "portrait-field",
        value: "",
      })
    ).toThrow("cannot be cleared while it is bound to an image layer")
  })

  it("binds fill only through a typed color field", () => {
    const withColor = applyCommand(northstarSeed, {
      id: "add-accent-color",
      type: "add_field",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      field: {
        id: "accent-color",
        key: "accent_color",
        label: "Accent color",
        type: "color",
        required: true,
        defaultValue: "#123456",
        agentDescription: "Primary panel accent",
        validation: {},
      },
    })
    const bound = applyCommand(withColor, {
      id: "bind-accent-color",
      type: "bind_field",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      binding: {
        id: "bind-accent-color",
        fieldId: "accent-color",
        nodeId: "cover-panel",
        property: "fill",
      },
    })
    expect(bound.nodes.find((node) => node.id === "cover-panel")).toMatchObject(
      { fill: "#123456" }
    )
    expect(() =>
      applyCommand(northstarSeed, {
        id: "bind-text-fill",
        type: "bind_field",
        actor: "human",
        at: "2026-08-28T12:01:00.000Z",
        binding: {
          id: "bind-text-fill",
          fieldId: "couple_names",
          nodeId: "cover-panel",
          property: "fill",
        },
      })
    ).toThrow("cannot bind")
  })
})

describe("field mutation impact analysis", () => {
  it("reports every bound node, page, and output before deletion", () => {
    const impact = analyzeFieldDeletion(northstarSeed, "package_price")

    expect(impact).toMatchObject({
      kind: "delete",
      bindingCount: 2,
      pageCount: 2,
      outputCount: 2,
      requiresConfirmation: true,
      summary: "2 bindings across 2 outputs",
      outputs: [
        { id: "proposal", name: "Five-page proposal" },
        { id: "whatsapp", name: "WhatsApp package card" },
      ],
    })
    expect(impact.bindings).toEqual([
      expect.objectContaining({
        bindingId: "bind-package-price",
        property: "text",
        nodeId: "package-price",
        nodeName: "Package price",
        pageId: "package",
        pageName: "Package",
        outputId: "proposal",
      }),
      expect.objectContaining({
        bindingId: "bind-wa-price",
        property: "text",
        nodeId: "wa-price",
        nodeName: "WhatsApp price",
        pageId: "whatsapp-card",
        pageName: "Package card",
        outputId: "whatsapp",
      }),
    ])
  })

  it("does not request impact confirmation for an unused field", () => {
    const document = {
      ...northstarSeed,
      fields: [...northstarSeed.fields, definition("boolean", false)],
      fieldValues: {
        ...northstarSeed.fieldValues,
        "boolean-field": false,
      },
    }
    expect(analyzeFieldDeletion(document, "boolean-field")).toMatchObject({
      bindingCount: 0,
      pageCount: 0,
      outputCount: 0,
      requiresConfirmation: false,
      summary: "0 bindings across 0 outputs",
    })
  })

  it("previews binding removal and value fallback for a type change", () => {
    const impact = analyzeFieldTypeChange(
      northstarSeed,
      "package_price",
      "boolean"
    )

    expect(impact).toMatchObject({
      fromType: "currency",
      toType: "boolean",
      currentValue: "385000",
      nextValue: false,
      nextDefaultValue: false,
      currentValueDisposition: "replaced_with_default",
      requiresConfirmation: true,
      summary:
        "2 bindings will be removed across 2 outputs; current value is replaced with the new default",
    })
    expect(
      impact.incompatibleBindings.map((binding) => binding.nodeId)
    ).toEqual(["package-price", "wa-price"])
    expect(impact.incompatibleOutputs.map((output) => output.id)).toEqual([
      "proposal",
      "whatsapp",
    ])
  })

  it("preserves compatible values and bindings and validates proposed defaults", () => {
    const compatible = analyzeFieldTypeChange(
      northstarSeed,
      "package_price",
      "text"
    )
    expect(compatible.currentValueDisposition).toBe("preserved")
    expect(compatible.nextValue).toBe("385000")
    expect(compatible.incompatibleBindings).toEqual([])
    expect(compatible.requiresConfirmation).toBe(false)

    expect(() =>
      analyzeFieldTypeChange(northstarSeed, "package_price", "number", {
        defaultValue: "not a number",
      })
    ).toThrow("Invalid default value for number field")
  })

  it("resets incompatible constraints and normalizes preserved currency", () => {
    const withText = applyCommand(northstarSeed, {
      id: "add-budget-text",
      type: "add_field",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      field: {
        id: "budget-text",
        key: "budget_text",
        label: "Budget",
        type: "text",
        required: true,
        defaultValue: "INR 1,250",
        agentDescription: "Client budget",
        validation: { maxLength: 20 },
      },
    })
    const impact = analyzeFieldTypeChange(withText, "budget-text", "currency", {
      defaultValue: "1000",
    })
    expect(impact.nextDefaultValue).toBe("1000")
    expect(impact.nextValue).toBe("1250")
    expect(impact.currentValueDisposition).toBe("preserved")

    const changed = applyCommand(withText, {
      id: "change-budget-type",
      type: "update_field",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      fieldId: "budget-text",
      patch: { type: "currency", defaultValue: "1000", validation: {} },
    })
    expect(changed.fieldValues["budget-text"]).toBe("1250")
    expect(
      changed.fields.find((field) => field.id === "budget-text")?.validation
    ).toEqual({})
  })

  it("previews an optional-to-required fallback against the proposed requirement", () => {
    const created = applyCommand(northstarSeed, {
      id: "add-optional-note",
      type: "add_field",
      actor: "human",
      at: "2026-08-28T12:10:00.000Z",
      field: {
        id: "optional-note",
        key: "optional_note",
        label: "Optional note",
        type: "text",
        required: false,
        defaultValue: "Fallback note",
        agentDescription: "Optional reusable note",
        validation: {},
      },
    })
    const emptied = applyCommand(created, {
      id: "empty-optional-note",
      type: "set_field",
      actor: "human",
      at: "2026-08-28T12:11:00.000Z",
      fieldId: "optional-note",
      value: "",
    })

    const impact = analyzeFieldTypeChange(emptied, "optional-note", "text", {
      defaultValue: "Fallback note",
      validation: {},
      required: true,
    })

    expect(impact).toMatchObject({
      currentValue: "",
      nextValue: "Fallback note",
      currentValueDisposition: "replaced_with_default",
      requiresConfirmation: true,
    })
  })

  it("rejects impact requests for unknown fields", () => {
    expect(() => analyzeFieldDeletion(northstarSeed, "missing")).toThrow(
      "Unknown field: missing"
    )
    expect(() =>
      analyzeFieldTypeChange(northstarSeed, "missing", "text")
    ).toThrow("Unknown field: missing")
  })
})
