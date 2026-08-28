import {
  composeQuotationDocument,
  northstarQuotationPayload,
} from "@webmcp/document"
import type {
  Document,
  OutputVariant,
  QuotationRenderPayloadV1,
  QuotationTemplateId,
} from "@webmcp/document"

export const DEFAULT_QUOTATION_TEMPLATE_ID =
  "editorial-olive" satisfies QuotationTemplateId

export type StarterOutputMetadata = Readonly<{
  id: string
  name: string
  kind: OutputVariant["kind"]
  pageCount: number
  exportFormats: readonly OutputVariant["exportFormats"][number][]
}>

export type StarterDocumentMetadata = Readonly<{
  id: string
  name: string
  pageCount: number
  outputCount: number
  outputs: readonly StarterOutputMetadata[]
  fieldCount: number
  bindingCount: number
}>

export type QuotationStarter = Readonly<{
  document: Document
  metadata: StarterDocumentMetadata
  source: QuotationRenderPayloadV1
  templateId: QuotationTemplateId
}>

export function deriveStarterDocumentMetadata(
  document: Document
): StarterDocumentMetadata {
  return {
    id: document.id,
    name: document.name,
    pageCount: document.pages.length,
    outputCount: document.outputs.length,
    outputs: document.outputs.map((output) => ({
      id: output.id,
      name: output.name,
      kind: output.kind,
      pageCount: output.pageIds.length,
      exportFormats: [...output.exportFormats],
    })),
    fieldCount: document.fields.length,
    bindingCount: document.bindings.length,
  }
}

export function createQuotationStarter(
  source: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId = DEFAULT_QUOTATION_TEMPLATE_ID
): QuotationStarter {
  const document = composeQuotationDocument(source, templateId)
  return {
    document,
    metadata: deriveStarterDocumentMetadata(document),
    source,
    templateId,
  }
}

export const quotationStarter = createQuotationStarter(
  northstarQuotationPayload,
  DEFAULT_QUOTATION_TEMPLATE_ID
)
