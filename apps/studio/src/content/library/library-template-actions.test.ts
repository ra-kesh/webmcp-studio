import { describe, expect, it, vi } from "vitest"
import type { LibraryTemplateDetail } from "@webmcp/document"
import {
  createLibraryTemplateActions,
  type TemplateActionSnapshot,
} from "./library-template-actions"
import { getStudioLibraryCatalogDetail } from "./catalog"

const detail = (overrides: Partial<LibraryTemplateDetail> = {}) => {
  const base = getStudioLibraryCatalogDetail(
    "template",
    "editorial-one-pager",
    1
  )
  if (!base) throw new Error("missing fixture")
  return { ...base, ...overrides } as LibraryTemplateDetail
}
const snapshot = (generation = 1): TemplateActionSnapshot => ({
  document: { id: "doc", revision: 1 } as never,
  documentGeneration: generation,
  sourceGeneration: 1,
  reviewGeneration: 1,
  hasQuotationSource: true,
})

const mutationFor = (current: TemplateActionSnapshot, label = "mutation") => ({
  document: current.document,
  sourceContext: null,
  impact: {} as never,
  label,
})

const intent = {
  itemKind: "template" as const,
  id: "editorial-one-pager",
  version: 1,
}

describe("library template mutation authority", () => {
  it("resolves exact detail before handing identity to lifecycle", async () => {
    let current = snapshot()
    const prepareCreate = vi.fn(() => ({
      document: current.document,
      sourceContext: null,
      impact: {} as never,
      label: "create",
    }))
    const actions = createLibraryTemplateActions({
      getDetail: async () => detail(),
      getCurrent: () => current,
      prepareCreate,
      prepareApply: prepareCreate,
    })
    const result = await actions.resolveCreate(intent)
    expect(prepareCreate).toHaveBeenCalledWith(
      { id: "editorial-one-pager", version: 1 },
      current
    )
    expect(result.detail.materialization.templateVersion).toBe(1)
  })
  it("rejects retired, forbidden, unavailable, unsupported, and mismatched exact details", async () => {
    for (const change of [
      { summary: { ...detail().summary, catalogStatus: "retired" } },
      {
        summary: {
          ...detail().summary,
          permissions: { ...detail().summary.permissions, canUse: false },
        },
      },
      {
        summary: {
          ...detail().summary,
          compatibility: {
            ...detail().summary.compatibility,
            availability: "unavailable",
            reason: "no",
          },
        },
      },
      {
        summary: {
          ...detail().summary,
          compatibility: {
            ...detail().summary.compatibility,
            supportedActions: ["apply"],
          },
        },
      },
      {
        summary: { ...detail().summary, id: "different-template" },
      },
    ]) {
      const actions = createLibraryTemplateActions({
        getDetail: async () => detail(change as Partial<LibraryTemplateDetail>),
        getCurrent: () => ({ ...snapshot(), hasQuotationSource: false }),
        prepareCreate: vi.fn(),
        prepareApply: vi.fn(),
      })
      await expect(actions.resolveCreate(intent)).rejects.toThrow()
    }
  })

  it("rejects a quotation-source requirement when the current source is absent", async () => {
    const quotation = getStudioLibraryCatalogDetail(
      "template",
      "quotation-midnight-film",
      3
    )
    expect(quotation).not.toBeNull()
    if (!quotation) return
    const actions = createLibraryTemplateActions({
      getDetail: async () => quotation,
      getCurrent: () => ({ ...snapshot(), hasQuotationSource: false }),
      prepareCreate: vi.fn(),
      prepareApply: vi.fn(),
    })

    await expect(
      actions.resolveCreate({
        itemKind: "template",
        id: quotation.summary.id,
        version: quotation.summary.version,
      })
    ).rejects.toThrow("linked quotation source")
  })

  it("uses the apply lifecycle only for an apply intent and rejects cross-action confirmation", async () => {
    const current = snapshot()
    const prepareCreate = vi.fn(() => mutationFor(current, "create"))
    const prepareApply = vi.fn(() => mutationFor(current, "apply"))
    const actions = createLibraryTemplateActions({
      getDetail: async () => detail(),
      getCurrent: () => current,
      prepareCreate,
      prepareApply,
    })

    const resolved = await actions.resolveApply(intent)
    expect(prepareApply).toHaveBeenCalledTimes(1)
    expect(prepareCreate).not.toHaveBeenCalled()
    await expect(actions.confirmCreate(resolved)).rejects.toThrow(
      "does not match"
    )
  })

  it("refetches authority at confirmation and rejects permission drift without preparing again", async () => {
    const current = snapshot()
    const forbidden = detail({
      summary: {
        ...detail().summary,
        permissions: { ...detail().summary.permissions, canUse: false },
      },
    })
    const getDetail = vi
      .fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(forbidden)
    const prepareCreate = vi.fn(() => mutationFor(current))
    const actions = createLibraryTemplateActions({
      getDetail,
      getCurrent: () => current,
      prepareCreate,
      prepareApply: vi.fn(),
    })
    const resolved = await actions.resolveCreate(intent)

    await expect(actions.confirmCreate(resolved)).rejects.toThrow("permission")
    expect(getDetail).toHaveBeenCalledTimes(2)
    expect(prepareCreate).toHaveBeenCalledTimes(1)
  })

  it("rejects a caller-resynthesized action identity at confirmation", async () => {
    const current = snapshot()
    const getDetail = vi.fn(async () => detail())
    const prepareCreate = vi.fn(() => mutationFor(current))
    const actions = createLibraryTemplateActions({
      getDetail,
      getCurrent: () => current,
      prepareCreate,
      prepareApply: vi.fn(),
    })
    const resolved = await actions.resolveCreate(intent)
    const callerOwnedCopy = {
      ...resolved,
      intent: {
        ...resolved.intent,
        id: "quotation-midnight-film",
        version: 3,
      },
    }

    await expect(actions.confirmCreate(callerOwnedCopy)).rejects.toThrow(
      "no longer authoritative"
    )
    expect(getDetail).toHaveBeenCalledTimes(1)
    expect(prepareCreate).toHaveBeenCalledTimes(1)
  })

  it("keeps a private snapshot fingerprint when caller-owned resolved state mutates", async () => {
    let current = snapshot(1)
    const prepareCreate = vi.fn(() => mutationFor(current))
    const actions = createLibraryTemplateActions({
      getDetail: async () => detail(),
      getCurrent: () => current,
      prepareCreate,
      prepareApply: vi.fn(),
    })
    const resolved = await actions.resolveCreate(intent)
    current = snapshot(2)
    ;(resolved.snapshot as { documentGeneration: number }).documentGeneration =
      2

    await expect(actions.confirmCreate(resolved)).rejects.toThrow(
      "active document changed"
    )
    expect(prepareCreate).toHaveBeenCalledTimes(1)
  })

  it("revalidates generation at confirmation and supersedes older lookups", async () => {
    let current = snapshot()
    let release!: (value: LibraryTemplateDetail) => void
    const actions = createLibraryTemplateActions({
      getDetail: () =>
        new Promise((r) => {
          release = r
        }),
      getCurrent: () => current,
      prepareCreate: vi.fn(() => ({
        document: current.document,
        sourceContext: null,
        impact: {} as never,
        label: "x",
      })),
      prepareApply: vi.fn(),
    })
    const pending = actions.resolveCreate(intent)
    actions.cancel()
    release(detail())
    await expect(pending).rejects.toThrow()
    const ready = createLibraryTemplateActions({
      getDetail: async () => detail(),
      getCurrent: () => current,
      prepareCreate: vi.fn(() => ({
        document: current.document,
        sourceContext: null,
        impact: {} as never,
        label: "x",
      })),
      prepareApply: vi.fn(),
    })
    const resolved = await ready.resolveCreate(intent)
    current = snapshot(2)
    await expect(ready.confirmCreate(resolved)).rejects.toThrow()
  })

  it("invalidates a resolved action when cancelled and aborts a pending confirmation", async () => {
    const current = snapshot()
    const detailRequests: Array<{
      signal: AbortSignal
      resolve: (value: LibraryTemplateDetail) => void
    }> = []
    const getDetail = vi.fn(
      (_kind, _id, _version, signal: AbortSignal) =>
        new Promise<LibraryTemplateDetail>((resolve) => {
          detailRequests.push({ signal, resolve })
        })
    )
    const prepareCreate = vi.fn(() => mutationFor(current))
    const actions = createLibraryTemplateActions({
      getDetail,
      getCurrent: () => current,
      prepareCreate,
      prepareApply: vi.fn(),
    })
    const resolving = actions.resolveCreate(intent)
    detailRequests[0]!.resolve(detail())
    const resolved = await resolving
    const confirming = actions.confirmCreate(resolved)
    expect(detailRequests[1]!.signal.aborted).toBe(false)
    actions.cancel()
    expect(detailRequests[1]!.signal.aborted).toBe(true)
    detailRequests[1]!.resolve(detail())

    await expect(confirming).rejects.toThrow("superseded")
    expect(prepareCreate).toHaveBeenCalledTimes(1)
    await expect(actions.confirmCreate(resolved)).rejects.toThrow(
      "no longer authoritative"
    )
  })
})
