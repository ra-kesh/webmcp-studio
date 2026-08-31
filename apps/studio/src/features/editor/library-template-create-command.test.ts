import { describe, expect, it, vi } from "vitest"
import type { ResolvedTemplateAction } from "../../content/library/library-template-actions"
import { createLibraryTemplateDocument } from "./library-template-create-command"

const intent = {
  itemKind: "template",
  id: "editorial-one-pager",
  version: 1,
} as const

const resolved = {
  intent,
  detail: { summary: { name: "Editorial one-pager" } },
} as ResolvedTemplateAction

describe("library template create command", () => {
  it("does not record Recent on click/resolution failure or failed installation", async () => {
    const recordUsed = vi.fn(async () => true)
    const resolveMissing = vi.fn(async () => null)
    const confirm = vi.fn(async () => ({
      succeeded: false as const,
      completionId: null,
    }))

    await expect(
      createLibraryTemplateDocument(intent, {
        resolve: resolveMissing,
        confirm,
        recordUsed,
      })
    ).resolves.toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(recordUsed).not.toHaveBeenCalled()

    await expect(
      createLibraryTemplateDocument(intent, {
        resolve: vi.fn(async () => resolved),
        confirm,
        recordUsed,
      })
    ).resolves.toBe(false)
    expect(recordUsed).not.toHaveBeenCalled()
  })

  it("keeps a successful session-only install out of Recent", async () => {
    const recordUsed = vi.fn(async () => true)
    await expect(
      createLibraryTemplateDocument(intent, {
        resolve: vi.fn(async () => resolved),
        confirm: vi.fn(async () => ({
          succeeded: true,
          completionId: null,
        })),
        recordUsed,
      })
    ).resolves.toBe(true)
    expect(recordUsed).not.toHaveBeenCalled()
  })

  it("records one exact create completion after durable installation without awaiting or rolling it back", async () => {
    let settleRecent!: (value: boolean) => void
    const recent = new Promise<boolean>((resolve) => {
      settleRecent = resolve
    })
    const recordUsed = vi.fn(() => recent)
    let completed = false

    const command = createLibraryTemplateDocument(intent, {
      resolve: vi.fn(async () => resolved),
      confirm: vi.fn(async () => ({
        succeeded: true as const,
        completionId: "document-created-1",
      })),
      recordUsed,
    }).then((value) => {
      completed = value
      return value
    })

    await vi.waitFor(() => expect(recordUsed).toHaveBeenCalledOnce())
    await expect(command).resolves.toBe(true)
    expect(completed).toBe(true)
    expect(recordUsed).toHaveBeenCalledWith(
      intent,
      "Editorial one-pager",
      "create",
      "document-created-1"
    )
    settleRecent(false)
    await recent
    expect(recordUsed).toHaveBeenCalledOnce()
  })

  it("does not reject a completed document when the Recent transport rejects", async () => {
    const recordUsed = vi.fn(async () => {
      throw new Error("transport status unknown")
    })
    await expect(
      createLibraryTemplateDocument(intent, {
        resolve: vi.fn(async () => resolved),
        confirm: vi.fn(async () => ({
          succeeded: true as const,
          completionId: "document-created-2",
        })),
        recordUsed,
      })
    ).resolves.toBe(true)
    expect(recordUsed).toHaveBeenCalledOnce()
  })

  it("does not reject a completed document when recording Recent throws synchronously", async () => {
    const recordUsed = vi.fn(() => {
      throw new Error("preference runtime is unavailable")
    })

    await expect(
      createLibraryTemplateDocument(intent, {
        resolve: vi.fn(async () => resolved),
        confirm: vi.fn(async () => ({
          succeeded: true as const,
          completionId: "document-created-3",
        })),
        recordUsed,
      })
    ).resolves.toBe(true)
    await vi.waitFor(() => expect(recordUsed).toHaveBeenCalledOnce())
  })
})
