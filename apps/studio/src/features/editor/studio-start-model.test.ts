import { describe, expect, it } from "vitest"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import { projectStudioStartModel } from "./studio-start-model"
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
  it("projects empty storage without inventing a hidden document owner", () => {
    expect(projectStudioStartModel({ status: "empty" })).toEqual({
      status: "ready",
      durable: true,
      storageWarning: null,
      recoverableEnvelope: null,
    })
  })

  it("leaves migrated durable identity to the Recent library", () => {
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
      recoverableEnvelope: null,
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
})
