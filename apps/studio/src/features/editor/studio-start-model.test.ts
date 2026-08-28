import { describe, expect, it } from "vitest"
import {
  builtInDesignTemplateRepository,
  composeQuotationDocument,
  northstarQuotationPayload,
} from "@webmcp/document"
import {
  deriveCurrentDraftSummary,
  projectStudioStartModel,
  startIntentReplacesCurrentDraft,
} from "./studio-start-model"
import type { CurrentDraftEnvelope } from "./current-draft-repository"

const generalEnvelope = (): CurrentDraftEnvelope => ({
  schemaVersion: 1,
  document: builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  ),
  sourceContext: {
    quotationSource: null,
    quotationTemplateId: "editorial-olive",
    designTemplate: { id: "editorial-one-pager", version: 1 },
  },
})

describe("Studio start model", () => {
  it("derives one truthful current-draft summary from canonical order", () => {
    const envelope = generalEnvelope()
    const firstOutput = envelope.document.outputs[0]
    const firstPage = envelope.document.pages.find(
      (page) => page.id === firstOutput.pageIds[0]
    )
    expect(deriveCurrentDraftSummary(envelope)).toEqual({
      documentId: envelope.document.id,
      name: envelope.document.name,
      updatedAt: envelope.document.updatedAt,
      pageCount: envelope.document.pages.length,
      outputCount: envelope.document.outputs.length,
      firstPage: {
        name: firstPage?.name,
        width: firstPage?.width,
        height: firstPage?.height,
      },
      exportFormats: ["png", "pdf"],
      sourceKind: "template",
    })
  })

  it("distinguishes quotation-backed work without exposing private source data", () => {
    const envelope: CurrentDraftEnvelope = {
      schemaVersion: 1,
      document: composeQuotationDocument(
        northstarQuotationPayload,
        "editorial-olive"
      ),
      sourceContext: {
        quotationSource: northstarQuotationPayload,
        quotationTemplateId: "editorial-olive",
        designTemplate: { id: "quotation-editorial-olive", version: 1 },
      },
    }
    expect(deriveCurrentDraftSummary(envelope).sourceKind).toBe("quotation")
  })

  it("projects empty storage without inventing a current draft", () => {
    expect(projectStudioStartModel({ status: "empty" })).toEqual({
      status: "ready",
      durable: true,
      storageWarning: null,
      currentDraft: null,
      recoverableEnvelope: null,
    })
  })

  it("projects one current draft and preserves cleanup warnings", () => {
    const envelope = generalEnvelope()
    const model = projectStudioStartModel({
      status: "current",
      envelope,
      source: "legacy",
      migrated: true,
      warnings: [
        {
          operation: "cleanup_legacy",
          message: "The old browser key could not be removed.",
        },
      ],
    })
    expect(model).toMatchObject({
      status: "ready",
      durable: true,
      storageWarning: "The old browser key could not be removed.",
      currentDraft: { documentId: envelope.document.id },
      recoverableEnvelope: envelope,
    })
  })

  it("makes storage failure and recoverable memory state explicit", () => {
    const envelope = generalEnvelope()
    expect(
      projectStudioStartModel({
        status: "storage_unavailable",
        failure: {
          operation: "write_current",
          message: "Browser storage is full.",
        },
        recoverableDraft: envelope,
      })
    ).toMatchObject({
      status: "ready",
      durable: false,
      storageWarning: "Browser storage is full.",
      currentDraft: { documentId: envelope.document.id },
      recoverableEnvelope: envelope,
    })
  })

  it("keeps recovery ahead of ordinary start choices", () => {
    const recovery = {
      schemaVersion: 1 as const,
      sourceStorageKey: "draft",
      capturedAt: "2026-08-28T12:00:00.000Z",
      failure: {
        kind: "malformed_json" as const,
        message: "Broken draft.",
      },
      raw: "broken",
    }
    expect(
      projectStudioStartModel({
        status: "recovery_required",
        recovery,
        recoveryStored: true,
      })
    ).toEqual({ status: "recovery_required", recovery })
  })

  it("requires replacement for every new intent when one current draft exists", () => {
    const current = deriveCurrentDraftSummary(generalEnvelope())
    expect(startIntentReplacesCurrentDraft(current, { kind: "continue" })).toBe(
      false
    )
    expect(startIntentReplacesCurrentDraft(current, { kind: "blank" })).toBe(
      true
    )
    expect(startIntentReplacesCurrentDraft(null, { kind: "sample" })).toBe(
      false
    )
  })
})
