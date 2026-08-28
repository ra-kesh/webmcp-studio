import { analyzeFieldTypeChange, parseCurrencyValue } from "@webmcp/document"
import type {
  Document,
  FieldDefinition,
  FieldTypeChangeImpact,
} from "@webmcp/document"

export type FieldDefinitionChangeImpact = {
  fieldContractChanged: boolean
  apiKeyChanged: boolean
  typeImpact: FieldTypeChangeImpact | null
  requiresConfirmation: boolean
}

export type FieldBoundDraftErrors = {
  minimum: string | null
  maximum: string | null
}

export function fieldDefinitionsEqual(
  field: FieldDefinition,
  next: Omit<FieldDefinition, "id">
): boolean {
  return (
    field.key === next.key &&
    field.label === next.label &&
    field.type === next.type &&
    field.required === next.required &&
    field.defaultValue === next.defaultValue &&
    field.agentDescription === next.agentDescription &&
    JSON.stringify(field.validation) === JSON.stringify(next.validation)
  )
}

export function validateFieldBoundDrafts(
  type: FieldDefinition["type"],
  minimum: string,
  maximum: string
): FieldBoundDraftErrors {
  if (type !== "currency") return { minimum: null, maximum: null }
  return {
    minimum:
      minimum !== "" && !parseCurrencyValue(minimum)
        ? "Minimum must be a valid INR amount."
        : null,
    maximum:
      maximum !== "" && !parseCurrencyValue(maximum)
        ? "Maximum must be a valid INR amount."
        : null,
  }
}

export function analyzeFieldDefinitionChange(
  document: Document,
  field: FieldDefinition,
  next: Omit<FieldDefinition, "id">
): FieldDefinitionChangeImpact {
  const fieldContractChanged =
    field.type !== next.type ||
    field.required !== next.required ||
    field.defaultValue !== next.defaultValue ||
    JSON.stringify(field.validation) !== JSON.stringify(next.validation)
  const typeImpact = fieldContractChanged
    ? analyzeFieldTypeChange(document, field.id, next.type, {
        defaultValue: next.defaultValue,
        validation: next.validation,
        required: next.required,
      })
    : null
  const apiKeyChanged = field.key !== next.key

  return {
    fieldContractChanged,
    apiKeyChanged,
    typeImpact,
    requiresConfirmation: Boolean(typeImpact || apiKeyChanged),
  }
}
