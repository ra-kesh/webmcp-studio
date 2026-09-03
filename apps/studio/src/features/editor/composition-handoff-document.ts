import {
  builtInDesignTemplateRepository,
  quotationTemplates,
} from "@webmcp/document"
import type {
  QuotationCompositionRequestV1,
  QuotationTemplateId,
} from "@webmcp/document"
import type { CompositionHandoffV1 } from "../../server/composition-handoff"
import type { CurrentDraftSnapshot } from "./current-draft-repository"
import { createKnownQuotationComposition } from "./quotation-composition-context"

const quotationTemplateId = (value: string): QuotationTemplateId => {
  const template = quotationTemplates.find(
    (candidate) => candidate.id === value
  )
  if (!template)
    throw new Error(`Studio does not support quotation theme ${value}.`)
  return template.id
}

async function createQuotationCompositionDocument(
  request: QuotationCompositionRequestV1
): Promise<CurrentDraftSnapshot> {
  const templateId = quotationTemplateId(request.templateId)
  const template = builtInDesignTemplateRepository
    .list({ kind: "quotation_style" })
    .find(
      (candidate) =>
        candidate.kind === "quotation_style" &&
        candidate.quotationTemplateId === templateId
    )
  if (!template) {
    throw new Error(`Studio has no active design template for ${templateId}.`)
  }
  const designTemplate = { id: template.id, version: template.version }
  const document = builtInDesignTemplateRepository.materialize(
    designTemplate.id,
    designTemplate.version,
    {
      quotation: request.payload,
      name: request.payload.document.title,
    }
  )
  const composition = await createKnownQuotationComposition(
    request.payload,
    designTemplate
  )
  return {
    document,
    sourceContext: {
      quotationSource: request.payload,
      quotationTemplateId: templateId,
      designTemplate,
      composition,
    },
  }
}

export function createCompositionHandoffDocument(
  handoff: CompositionHandoffV1
): Promise<CurrentDraftSnapshot> {
  switch (handoff.kind) {
    case "quotation-composition":
      return createQuotationCompositionDocument(handoff.payload)
  }
}
