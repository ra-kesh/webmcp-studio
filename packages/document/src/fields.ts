import {
  fieldDefinitionSchema,
  fieldValueSchemas,
  isSafeFieldAssetReference,
  isSupportedCurrencyString,
  type Document,
  type FieldBinding,
  type FieldDefinition,
  type FieldType,
  type FieldValue,
  type SceneNode,
} from "./schema"
import { curatedAssetIdentityFromSource } from "./media"

export type BindableProperty = FieldBinding["property"]

export const bindingPropertiesForNode = (
  node: SceneNode
): BindableProperty[] => {
  if (node.type === "text") return ["text", "visible"]
  if (node.type === "image") return ["src", "visible"]
  if (
    node.type === "rect" ||
    node.type === "ellipse" ||
    node.type === "icon" ||
    node.type === "section" ||
    node.type === "polygon" ||
    node.type === "star" ||
    node.type === "vector" ||
    node.type === "boolean_result"
  ) {
    return ["fill", "visible"]
  }
  return ["visible"]
}

export function defaultFieldValue(type: FieldType): FieldValue {
  switch (type) {
    case "number":
      return 0
    case "currency":
      return "0"
    case "boolean":
      return false
    case "text":
    case "date":
    case "asset":
    case "color":
    case "choice":
      return ""
  }
}

export function fieldValueMatchesType(
  field: Pick<FieldDefinition, "type">,
  value: FieldValue
): boolean {
  return fieldValueSchemas[field.type].safeParse(value).success
}

function compareDecimals(left: string, right: string): number {
  const parts = (value: string) => {
    const negative = value.startsWith("-")
    const unsigned = negative ? value.slice(1) : value
    const [integer = "0", fraction = ""] = unsigned.split(".")
    return { negative, integer, fraction }
  }
  const leftParts = parts(left)
  const rightParts = parts(right)
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length)
  const scaled = (value: ReturnType<typeof parts>) => {
    const digits = `${value.integer}${value.fraction.padEnd(scale, "0")}`
    const magnitude = BigInt(digits || "0")
    return value.negative ? -magnitude : magnitude
  }
  const leftValue = scaled(leftParts)
  const rightValue = scaled(rightParts)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

export function fieldValueValidationMessage(
  field: FieldDefinition,
  value: FieldValue
): string | null {
  if (!fieldValueMatchesType(field, value)) {
    return `${field.label} has the wrong value type`
  }
  if (field.required && typeof value === "string" && value.trim() === "") {
    return `${field.label} is required`
  }
  const validation = field.validation

  if (field.type === "choice" && value !== "") {
    const allowed = new Set(
      (validation.options ?? []).map((option) => option.value)
    )
    if (!allowed.has(String(value))) {
      return `${field.label} must match one configured choice`
    }
  }
  if (field.type === "text" && typeof value === "string") {
    if (
      validation.minLength !== undefined &&
      value.length < validation.minLength
    ) {
      return `${field.label} must contain at least ${validation.minLength} characters`
    }
    if (
      validation.maxLength !== undefined &&
      value.length > validation.maxLength
    ) {
      return `${field.label} must contain at most ${validation.maxLength} characters`
    }
  }
  if ((field.type === "number" || field.type === "currency") && value !== "") {
    if (field.type === "number") {
      if (
        typeof validation.minimum === "number" &&
        (value as number) < validation.minimum
      ) {
        return `${field.label} is below its minimum`
      }
      if (
        typeof validation.maximum === "number" &&
        (value as number) > validation.maximum
      ) {
        return `${field.label} is above its maximum`
      }
    } else {
      const decimal = parseCurrencyValue(value as string | number)?.decimal
      const minimum =
        validation.minimum === undefined
          ? undefined
          : parseCurrencyValue(validation.minimum as string | number)?.decimal
      const maximum =
        validation.maximum === undefined
          ? undefined
          : parseCurrencyValue(validation.maximum as string | number)?.decimal
      if (decimal && minimum && compareDecimals(decimal, minimum) < 0) {
        return `${field.label} is below its minimum`
      }
      if (decimal && maximum && compareDecimals(decimal, maximum) > 0) {
        return `${field.label} is above its maximum`
      }
    }
  }
  if (field.type === "date" && typeof value === "string" && value !== "") {
    if (typeof validation.minimum === "string" && value < validation.minimum) {
      return `${field.label} is before its minimum date`
    }
    if (typeof validation.maximum === "string" && value > validation.maximum) {
      return `${field.label} is after its maximum date`
    }
  }
  return null
}

export function fieldValueSatisfiesDefinition(
  field: FieldDefinition,
  value: FieldValue
): boolean {
  return fieldValueValidationMessage(field, value) === null
}

export function fieldDefinitionValidationMessage(
  field: FieldDefinition
): string | null {
  const defaultIssue = fieldValueValidationMessage(field, field.defaultValue)
  if (defaultIssue) return `Invalid default value: ${defaultIssue}`
  if (field.validation.minimum !== undefined) {
    const boundsIssue = fieldValueValidationMessage(
      field,
      field.validation.minimum
    )
    if (boundsIssue) return `Invalid field bounds: ${boundsIssue}`
  }
  return null
}

export type ParsedCurrencyValue = {
  decimal: string
  source: "canonical_decimal" | "legacy_formatted" | "legacy_number"
  precise: boolean
}

export type ParsedAssetReference = {
  reference: string
  source:
    | "managed_local"
    | "managed_workspace"
    | "curated_studio"
    | "inline_render_safe"
    | "legacy_https"
  publishRequiresResolution: boolean
}

export function parseAssetReference(
  value: string
): ParsedAssetReference | null {
  if (!value || !isSafeFieldAssetReference(value)) return null
  if (value.startsWith("asset:local/")) {
    return {
      reference: value,
      source: "managed_local",
      publishRequiresResolution: true,
    }
  }
  if (value.startsWith("asset:managed/")) {
    return {
      reference: value,
      source: "managed_workspace",
      publishRequiresResolution: true,
    }
  }
  if (curatedAssetIdentityFromSource(value)) {
    return {
      reference: value,
      source: "curated_studio",
      publishRequiresResolution: true,
    }
  }
  if (value.startsWith("data:image/")) {
    return {
      reference: value,
      source: "inline_render_safe",
      publishRequiresResolution: false,
    }
  }
  return {
    reference: value,
    source: "legacy_https",
    publishRequiresResolution: true,
  }
}

function normalizeDecimal(value: string): string {
  const negative = value.startsWith("-")
  const unsigned = negative ? value.slice(1) : value
  const [integer = "0", fraction] = unsigned.split(".")
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0"
  const hasNonZeroMagnitude =
    normalizedInteger !== "0" || Boolean(fraction && /[1-9]/.test(fraction))
  return `${negative && hasNonZeroMagnitude ? "-" : ""}${normalizedInteger}${fraction === undefined ? "" : `.${fraction}`}`
}

export function parseCurrencyValue(
  value: string | number
): ParsedCurrencyValue | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    return {
      decimal: expandExponentialNumber(value),
      source: "legacy_number",
      precise: false,
    }
  }
  if (!isSupportedCurrencyString(value) || value === "") return null
  const trimmed = value.trim()
  if (/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) {
    return {
      decimal: normalizeDecimal(trimmed),
      source: "canonical_decimal",
      precise: true,
    }
  }

  const negative = trimmed.startsWith("-")
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const amount = unsigned
    .replace(/^(?:INR|₹)\s*/, "")
    .replace(/\s*(?:INR|₹)$/, "")
    .replaceAll(",", "")
  return {
    decimal: normalizeDecimal(`${negative ? "-" : ""}${amount}`),
    source: "legacy_formatted",
    precise: true,
  }
}

function expandExponentialNumber(value: number): string {
  const serialized = String(value)
  if (!/[eE]/.test(serialized)) return serialized
  const [mantissa = "0", exponentText = "0"] = serialized
    .toLowerCase()
    .split("e")
  const negative = mantissa.startsWith("-")
  const unsigned = negative ? mantissa.slice(1) : mantissa
  const [integer = "0", fraction = ""] = unsigned.split(".")
  const digits = `${integer}${fraction}`
  const decimalIndex = integer.length + Number(exponentText)
  const expanded =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
  return normalizeDecimal(`${negative ? "-" : ""}${expanded}`)
}

export function formatFieldValueForText(
  field: Pick<FieldDefinition, "type"> &
    Partial<Pick<FieldDefinition, "validation">>,
  value: FieldValue
): string {
  if (!fieldValueMatchesType(field, value)) {
    throw new Error(`Invalid value for ${field.type} field`)
  }
  if (field.type === "boolean") return value ? "true" : "false"
  if (field.type === "choice" && typeof value === "string") {
    return (
      field.validation?.options?.find((option) => option.value === value)
        ?.label ?? value
    )
  }
  if (field.type === "date" && typeof value === "string" && value) {
    const [year, month, day] = value.split("-")
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ]
    return `${Number(day)} ${months[Number(month) - 1]} ${year}`
  }
  if (field.type === "currency") {
    if (value === "") return ""
    const parsed = parseCurrencyValue(value as string | number)
    if (!parsed) throw new Error("Invalid value for currency field")
    if (parsed.source === "legacy_formatted") return String(value)
    const negative = parsed.decimal.startsWith("-")
    const unsigned = negative ? parsed.decimal.slice(1) : parsed.decimal
    const [integer = "0", fraction] = unsigned.split(".")
    const tail = integer.slice(-3)
    const head = integer.slice(0, -3)
    const groupedHead = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")
    const grouped = head ? `${groupedHead},${tail}` : tail
    return `${negative ? "-" : ""}₹${grouped}${fraction === undefined ? "" : `.${fraction}`}`
  }
  return String(value)
}

export function normalizeFieldValueForStorage(
  field: Pick<FieldDefinition, "type">,
  value: FieldValue
): FieldValue {
  if (!fieldValueMatchesType(field, value)) {
    throw new Error(`Invalid value for ${field.type} field`)
  }
  if (field.type !== "currency") return value
  if (value === "") return ""
  const parsed = parseCurrencyValue(value as string | number)
  if (!parsed) throw new Error("Invalid value for currency field")
  if (!isSupportedCurrencyString(parsed.decimal)) {
    throw new Error("Currency values cannot exceed two decimal places")
  }
  return parsed.decimal
}

export function fieldCanBindToProperty(
  field: FieldDefinition,
  node: SceneNode,
  property: BindableProperty
): boolean {
  if (!bindingPropertiesForNode(node).includes(property)) return false
  if (property === "visible") return field.type === "boolean"
  if (property === "src") return field.type === "asset"
  if (property === "fill") return field.type === "color"
  return field.type !== "asset" && field.type !== "boolean"
}

export type FieldBindingImpact = {
  bindingId: string
  property: BindableProperty
  nodeId: string
  nodeName: string | null
  nodeType: SceneNode["type"] | null
  pageId: string | null
  pageName: string | null
  outputId: string | null
  outputName: string | null
}

export type FieldImpactPage = {
  id: string
  name: string
  outputId: string
}

export type FieldImpactOutput = {
  id: string
  name: string
}

export type FieldDeletionImpact = {
  kind: "delete"
  field: FieldDefinition
  currentValue: FieldValue | undefined
  bindings: FieldBindingImpact[]
  pages: FieldImpactPage[]
  outputs: FieldImpactOutput[]
  bindingCount: number
  pageCount: number
  outputCount: number
  requiresConfirmation: boolean
  summary: string
}

export type FieldTypeChangeImpact = {
  kind: "change_type"
  field: FieldDefinition
  fromType: FieldType
  toType: FieldType
  currentValue: FieldValue | undefined
  nextValue: FieldValue
  nextDefaultValue: FieldValue
  currentValueDisposition: "preserved" | "replaced_with_default"
  bindings: FieldBindingImpact[]
  incompatibleBindings: FieldBindingImpact[]
  pages: FieldImpactPage[]
  outputs: FieldImpactOutput[]
  incompatiblePages: FieldImpactPage[]
  incompatibleOutputs: FieldImpactOutput[]
  requiresConfirmation: boolean
  summary: string
}

export type FieldTypeChangeOptions = {
  defaultValue?: FieldValue
  validation?: FieldDefinition["validation"]
  required?: boolean
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

function collectBindingImpacts(
  document: Document,
  fieldId: string
): FieldBindingImpact[] {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const outputs = new Map(document.outputs.map((output) => [output.id, output]))
  const pagesByNode = new Map<string, Document["pages"][number]>()
  for (const page of document.pages) {
    for (const nodeId of page.nodeIds) {
      if (!pagesByNode.has(nodeId)) pagesByNode.set(nodeId, page)
    }
  }

  return document.bindings
    .filter((binding) => binding.fieldId === fieldId)
    .map((binding) => {
      const node = nodes.get(binding.nodeId)
      const page = pagesByNode.get(binding.nodeId)
      const output = page ? outputs.get(page.outputId) : undefined
      return {
        bindingId: binding.id,
        property: binding.property,
        nodeId: binding.nodeId,
        nodeName: node?.name ?? null,
        nodeType: node?.type ?? null,
        pageId: page?.id ?? null,
        pageName: page?.name ?? null,
        outputId: output?.id ?? page?.outputId ?? null,
        outputName: output?.name ?? null,
      }
    })
}

function collectPages(
  document: Document,
  bindings: readonly FieldBindingImpact[]
): FieldImpactPage[] {
  const pageIds = new Set(
    bindings.flatMap((binding) => (binding.pageId ? [binding.pageId] : []))
  )
  return document.pages
    .filter((page) => pageIds.has(page.id))
    .map((page) => ({ id: page.id, name: page.name, outputId: page.outputId }))
}

function collectOutputs(
  document: Document,
  bindings: readonly FieldBindingImpact[]
): FieldImpactOutput[] {
  const outputIds = new Set(
    bindings.flatMap((binding) => (binding.outputId ? [binding.outputId] : []))
  )
  return document.outputs
    .filter((output) => outputIds.has(output.id))
    .map((output) => ({ id: output.id, name: output.name }))
}

function requireField(document: Document, fieldId: string): FieldDefinition {
  const field = document.fields.find((candidate) => candidate.id === fieldId)
  if (!field) throw new Error(`Unknown field: ${fieldId}`)
  return field
}

export function analyzeFieldDeletion(
  document: Document,
  fieldId: string
): FieldDeletionImpact {
  const field = requireField(document, fieldId)
  const bindings = collectBindingImpacts(document, fieldId)
  const pages = collectPages(document, bindings)
  const outputs = collectOutputs(document, bindings)
  return {
    kind: "delete",
    field,
    currentValue: document.fieldValues[fieldId],
    bindings,
    pages,
    outputs,
    bindingCount: bindings.length,
    pageCount: pages.length,
    outputCount: outputs.length,
    requiresConfirmation: bindings.length > 0,
    summary: `${pluralize(bindings.length, "binding")} across ${pluralize(outputs.length, "output")}`,
  }
}

export function analyzeFieldTypeChange(
  document: Document,
  fieldId: string,
  toType: FieldType,
  options: FieldTypeChangeOptions = {}
): FieldTypeChangeImpact {
  const field = requireField(document, fieldId)
  const proposedDefaultValue =
    options.defaultValue ??
    (fieldValueMatchesType({ type: toType }, field.defaultValue)
      ? field.defaultValue
      : defaultFieldValue(toType))
  const proposedField = fieldDefinitionSchema.parse({
    ...field,
    type: toType,
    required: options.required ?? field.required,
    defaultValue: proposedDefaultValue,
    validation:
      options.validation ?? (toType === field.type ? field.validation : {}),
  })
  if (fieldDefinitionValidationMessage(proposedField)) {
    throw new Error(`Invalid default value for ${toType} field`)
  }
  proposedField.defaultValue = normalizeFieldValueForStorage(
    proposedField,
    proposedField.defaultValue
  )

  const bindings = collectBindingImpacts(document, fieldId)
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const incompatibleBindings = bindings.filter((binding) => {
    const node = nodes.get(binding.nodeId)
    return (
      !node || !fieldCanBindToProperty(proposedField, node, binding.property)
    )
  })
  const currentValue = document.fieldValues[fieldId]
  const preservesCurrentValue =
    currentValue !== undefined &&
    fieldValueSatisfiesDefinition(proposedField, currentValue)
  const nextValue = preservesCurrentValue
    ? normalizeFieldValueForStorage(proposedField, currentValue)
    : proposedField.defaultValue
  const pages = collectPages(document, bindings)
  const outputs = collectOutputs(document, bindings)
  const incompatiblePages = collectPages(document, incompatibleBindings)
  const incompatibleOutputs = collectOutputs(document, incompatibleBindings)
  const replacementSummary = preservesCurrentValue
    ? "current value is preserved"
    : "current value is replaced with the new default"

  return {
    kind: "change_type",
    field,
    fromType: field.type,
    toType,
    currentValue,
    nextValue,
    nextDefaultValue: proposedField.defaultValue,
    currentValueDisposition: preservesCurrentValue
      ? "preserved"
      : "replaced_with_default",
    bindings,
    incompatibleBindings,
    pages,
    outputs,
    incompatiblePages,
    incompatibleOutputs,
    requiresConfirmation:
      incompatibleBindings.length > 0 || !preservesCurrentValue,
    summary: `${pluralize(incompatibleBindings.length, "binding")} will be removed across ${pluralize(incompatibleOutputs.length, "output")}; ${replacementSummary}`,
  }
}
