import {
  applyQuotationTemplate,
  assertValidDocument,
  templateApplicationImpact,
} from "@webmcp/document"
import type {
  DesignTemplateCatalogItem,
  DesignTemplateRepository,
  Document,
  QuotationRenderPayloadV1,
  QuotationTemplateId,
  TemplateApplicationImpact,
} from "@webmcp/document"

export type TemplateSourceContext = {
  quotationSource: QuotationRenderPayloadV1 | null
  quotationTemplateId: QuotationTemplateId
  designTemplate: { id: string; version: number } | null
}

export type PreparedTemplateMutation = {
  template: DesignTemplateCatalogItem
  document: Document
  sourceContext: TemplateSourceContext
  impact: TemplateApplicationImpact
  label: string
}

type PrepareTemplateOptions = {
  repository: DesignTemplateRepository
  templateId: string
  version: number
  currentDocument: Document
  sourceContext: TemplateSourceContext
  now?: string
  createId?: (kind: string, sourceId: string) => string
}

const findCatalogItem = (
  repository: DesignTemplateRepository,
  templateId: string,
  version: number
) => {
  const item = repository
    .list()
    .find(
      (candidate) =>
        candidate.id === templateId && candidate.version === version
    )
  if (!item)
    throw new Error(`Unknown design template: ${templateId}@${version}`)
  return item
}

const sourceRequired = (templateName: string) =>
  new Error(
    `${templateName} needs a linked quotation source. Import quotation data before using this style.`
  )

export function prepareCreateFromTemplate(
  options: PrepareTemplateOptions
): PreparedTemplateMutation {
  const template = findCatalogItem(
    options.repository,
    options.templateId,
    options.version
  )
  const definition = options.repository.get(options.templateId, options.version)
  if (
    definition.kind === "quotation_style" &&
    !options.sourceContext.quotationSource
  ) {
    throw sourceRequired(template.name)
  }
  const document = options.repository.materialize(
    options.templateId,
    options.version,
    {
      quotation: options.sourceContext.quotationSource ?? undefined,
      identity: "fresh",
      now: options.now,
      createId: options.createId,
    }
  )
  const sourceContext: TemplateSourceContext =
    definition.kind === "quotation_style"
      ? {
          quotationSource: options.sourceContext.quotationSource,
          quotationTemplateId: definition.quotationTemplateId,
          designTemplate: {
            id: template.id,
            version: template.version,
          },
        }
      : {
          quotationSource: null,
          quotationTemplateId: options.sourceContext.quotationTemplateId,
          designTemplate: {
            id: template.id,
            version: template.version,
          },
        }

  return {
    template,
    document,
    sourceContext,
    impact: templateApplicationImpact(options.currentDocument, document, {
      currentHasQuotationSource: Boolean(options.sourceContext.quotationSource),
      nextHasQuotationSource: Boolean(sourceContext.quotationSource),
    }),
    label: `Create from ${template.name}`,
  }
}

export function prepareApplyTemplate(
  options: PrepareTemplateOptions
): PreparedTemplateMutation {
  const template = findCatalogItem(
    options.repository,
    options.templateId,
    options.version
  )
  const definition = options.repository.get(options.templateId, options.version)
  const now = options.now ?? new Date().toISOString()

  if (definition.kind === "quotation_style") {
    const quotationSource = options.sourceContext.quotationSource
    if (!quotationSource) throw sourceRequired(template.name)
    const document = applyQuotationTemplate(
      options.currentDocument,
      options.sourceContext.quotationTemplateId,
      definition.quotationTemplateId,
      { now }
    )
    return {
      template,
      document,
      sourceContext: {
        quotationSource,
        quotationTemplateId: definition.quotationTemplateId,
        designTemplate: {
          id: template.id,
          version: template.version,
        },
      },
      impact: templateApplicationImpact(options.currentDocument, document, {
        currentHasQuotationSource: true,
        nextHasQuotationSource: true,
        rebuildsFromQuotationSource: false,
      }),
      label: `Apply ${template.name} style`,
    }
  }

  const starter = options.repository.materialize(
    options.templateId,
    options.version,
    {
      identity: "fresh",
      now,
      createId: options.createId,
    }
  )
  const document = assertValidDocument({
    ...starter,
    id: options.currentDocument.id,
    name: options.currentDocument.name,
    revision: options.currentDocument.revision + 1,
    createdAt: options.currentDocument.createdAt,
    updatedAt: now,
  })
  const sourceContext: TemplateSourceContext = {
    quotationSource: null,
    quotationTemplateId: options.sourceContext.quotationTemplateId,
    designTemplate: {
      id: template.id,
      version: template.version,
    },
  }
  return {
    template,
    document,
    sourceContext,
    impact: templateApplicationImpact(options.currentDocument, document, {
      currentHasQuotationSource: Boolean(options.sourceContext.quotationSource),
      nextHasQuotationSource: false,
    }),
    label: `Apply ${template.name}`,
  }
}
