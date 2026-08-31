// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { documentSchema, projectPublicMediaDetail } from "@webmcp/document"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as LibraryMediaBrowserModule from "../../content/library/library-media-browser"
import type * as LocalAssetStoreModule from "./local-asset-store"
import type * as ManagedMediaRepositoryModule from "./managed-media-repository"
import type * as LocalAssetPromotionJournalModule from "./local-asset-promotion-journal"
import { AssetLibraryDialog } from "./asset-library-dialog"
import type { ManagedMediaAsset } from "./managed-media-repository"

const mocks = vi.hoisted(() => ({
  browserProps: null as Record<string, unknown> | null,
  listManagedMedia: vi.fn(),
  uploadManagedMedia: vi.fn(),
}))

vi.mock(
  "../../content/library/library-media-browser",
  async (importOriginal) => {
    const actual = await importOriginal<typeof LibraryMediaBrowserModule>()
    return {
      ...actual,
      LibraryMediaBrowser: (props: Record<string, unknown>) => {
        mocks.browserProps = props
        return (
          <section
            data-library-media-browser="mounted-in-dialog"
            data-testid="shared-media-browser"
          />
        )
      },
    }
  }
)

vi.mock("./local-asset-store", async (importOriginal) => {
  const actual = await importOriginal<typeof LocalAssetStoreModule>()
  return {
    ...actual,
    inspectRequestedLocalAssets: vi.fn(async () => []),
    listLocalAssetInventory: vi.fn(async () => ({
      assets: [],
      migration: { status: "not_needed" },
    })),
    localAssetStorageSummary: vi.fn(async () => ({
      activeAssetCount: 0,
      activeAssetBytes: 0,
      archivedAssetCount: 0,
      archivedAssetBytes: 0,
      retainedAssetBytes: 0,
      browserUsageBytes: 0,
      browserQuotaBytes: 1_000_000,
    })),
  }
})

vi.mock("./managed-media-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof ManagedMediaRepositoryModule>()
  return {
    ...actual,
    listManagedMedia: mocks.listManagedMedia,
    subscribeManagedMediaMutations: vi.fn(() => () => undefined),
    uploadManagedMedia: mocks.uploadManagedMedia,
  }
})

vi.mock("./local-asset-promotion-journal", async (importOriginal) => {
  const actual = await importOriginal<typeof LocalAssetPromotionJournalModule>()
  return {
    ...actual,
    subscribeToLocalAssetPromotionJournal: vi.fn(() => () => undefined),
  }
})

const now = "2026-08-31T00:00:00.000Z"
const managedAsset: ManagedMediaAsset = {
  id: "asset-dialog-managed-1",
  name: "Managed portrait.png",
  mediaType: "image/png",
  bytes: 4,
  width: 1_200,
  height: 800,
  createdAt: now,
  updatedAt: now,
  lastUsedAt: now,
  status: "ready",
}

const managedDetail = projectPublicMediaDetail(managedAsset, {
  catalogVersion: 3,
  description: "Workspace upload",
  categoryId: "workspace-upload",
  useCaseIds: [],
  formatFamily: "image",
  tags: [],
  provenance: {
    sourceName: "Workspace upload",
    sourceUrl: null,
    license: {
      id: "customer-provided",
      name: "Customer-provided; rights not verified",
      url: null,
    },
    attribution: { required: false, text: null },
    contentSha256: null,
  },
})

const document = documentSchema.parse({
  schemaVersion: 4,
  id: "document-dialog-media",
  name: "Media dialog",
  revision: 1,
  createdAt: now,
  updatedAt: now,
  outputs: [
    {
      id: "output-dialog",
      name: "Output",
      kind: "custom",
      pageIds: ["page-dialog"],
      exportFormats: ["png"],
    },
  ],
  pages: [
    {
      id: "page-dialog",
      outputId: "output-dialog",
      name: "Page",
      width: 400,
      height: 400,
      background: "#fff",
      nodeIds: [],
    },
  ],
  nodes: [],
  groups: [],
  components: [],
  componentInstances: [],
  typographyStyles: [],
  paintStyles: [],
  variables: [],
  variableBindings: [],
  fields: [],
  fieldValues: {},
  bindings: [],
})

const defaultManagedList = () => ({
  assets: [] as ManagedMediaAsset[],
  nextCursor: null,
  storage: { bytes: 0, count: 0 },
})

describe("AssetLibraryDialog shared browser cutover", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.browserProps = null
    mocks.listManagedMedia.mockResolvedValue(defaultManagedList())
    mocks.uploadManagedMedia.mockReset()
    host = window.document.createElement("div")
    window.document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  const renderDialog = async (
    overrides: Partial<React.ComponentProps<typeof AssetLibraryDialog>> = {}
  ) => {
    const onOpenChange = vi.fn()
    const onMediaSelect = vi.fn()
    const onRecoveryManagedSelect = vi.fn(async () => true)
    await act(async () => {
      root.render(
        <AssetLibraryDialog
          actionsEnabled
          document={document}
          mediaScope={{ kind: "recent" }}
          mode="insert"
          open
          resolveUploadedMediaDetail={vi.fn(async () => null)}
          onMediaScopeChange={vi.fn()}
          onMediaSelect={onMediaSelect}
          onOpenChange={onOpenChange}
          onRecoveryManagedSelect={onRecoveryManagedSelect}
          {...overrides}
        />
      )
    })
    return { onMediaSelect, onOpenChange, onRecoveryManagedSelect }
  }

  it("mounts one shared ordinary browser and keeps management in a separate sheet", async () => {
    const onScopeChange = vi.fn()
    await renderDialog({ onMediaScopeChange: onScopeChange })

    expect(
      window.document.querySelectorAll("[data-library-media-browser]")
    ).toHaveLength(1)
    expect(
      window.document.querySelector('[aria-label="Search media"]')
    ).toBeNull()
    expect(mocks.browserProps).toMatchObject({
      action: "insert",
      density: "compact",
      scope: { kind: "recent" },
      onScopeChange,
    })

    const manage = Array.from(window.document.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage"
    )
    expect(manage).toBeTruthy()
    await act(async () => manage!.click())
    expect(window.document.body.textContent).toContain("Manage media")
    expect(window.document.body.textContent).toContain("Upload images")
    expect(
      window.document.querySelectorAll("[data-library-media-browser]")
    ).toHaveLength(1)
  })

  it("retains upload cancellation and blocks outer close while an upload is active", async () => {
    let cancelUpload = vi.fn()
    mocks.uploadManagedMedia.mockImplementation(() => ({
      cancel: (cancelUpload = vi.fn()),
      promise: new Promise<ManagedMediaAsset>(() => undefined),
    }))
    const { onOpenChange } = await renderDialog()
    const manage = Array.from(window.document.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage"
    )!
    await act(async () => manage.click())
    const input = window.document.querySelector<HTMLInputElement>(
      'input[type="file"][name="media-upload-files"]'
    )!
    const file = new File([new Uint8Array(4)], "portrait.png", {
      type: "image/png",
    })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true }))
    )
    await vi.waitFor(() => {
      expect(mocks.uploadManagedMedia).toHaveBeenCalledOnce()
    })

    const close = window.document.querySelector<HTMLButtonElement>(
      '[aria-label="Close media library"]'
    )!
    expect(close.disabled).toBe(true)
    close.click()
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      const cancel = window.document.querySelector<HTMLButtonElement>(
        '[aria-label="Cancel upload of portrait.png"]'
      )
      cancel?.click()
    })
    expect(cancelUpload).toHaveBeenCalledOnce()
  })

  it("cancels exact upload reconciliation and retries with the same idempotency key", async () => {
    const idempotencyKeys: string[] = []
    mocks.uploadManagedMedia.mockImplementation(
      (_file: File, options: { idempotencyKey: string }) => {
        idempotencyKeys.push(options.idempotencyKey)
        return {
          cancel: vi.fn(),
          promise: Promise.resolve(managedAsset),
        }
      }
    )
    const reconciliationSignals: AbortSignal[] = []
    const resolveUploadedMediaDetail = vi.fn(
      (_asset: ManagedMediaAsset, signal: AbortSignal) => {
        reconciliationSignals.push(signal)
        if (reconciliationSignals.length > 1) return Promise.resolve(null)
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        })
      }
    )
    await renderDialog({ resolveUploadedMediaDetail })
    const manage = Array.from(window.document.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage"
    )!
    await act(async () => manage.click())
    const input = window.document.querySelector<HTMLInputElement>(
      'input[type="file"][name="media-upload-files"]'
    )!
    const file = new File([new Uint8Array(4)], "portrait.png", {
      type: "image/png",
    })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true }))
    )
    await vi.waitFor(() => {
      expect(resolveUploadedMediaDetail).toHaveBeenCalledOnce()
      expect(
        window.document.querySelector(
          '[aria-label="Cancel upload of portrait.png"]'
        )
      ).toBeTruthy()
    })

    await act(async () => {
      window.document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Cancel upload of portrait.png"]'
        )!
        .click()
    })
    await vi.waitFor(() => {
      expect(reconciliationSignals[0]?.aborted).toBe(true)
      expect(window.document.body.textContent).toContain(
        "Stopped on this device"
      )
    })

    const retry = Array.from(window.document.querySelectorAll("button")).find(
      (button) => button.textContent.includes("Retry")
    )!
    await act(async () => retry.click())
    await vi.waitFor(() => {
      expect(mocks.uploadManagedMedia).toHaveBeenCalledTimes(2)
      expect(resolveUploadedMediaDetail).toHaveBeenCalledTimes(2)
    })
    expect(idempotencyKeys).toHaveLength(2)
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0])
  })

  it("keeps recovery managed-only and independent from the shared browser", async () => {
    mocks.listManagedMedia.mockResolvedValue({
      ...defaultManagedList(),
      assets: [managedAsset],
      storage: { bytes: managedAsset.bytes, count: 1 },
    })
    const { onRecoveryManagedSelect } = await renderDialog({
      mode: "recover-local",
    })
    await vi.waitFor(() => {
      expect(window.document.body.textContent).toContain(managedAsset.name)
    })

    expect(
      window.document.querySelector("[data-library-media-browser]")
    ).toBeNull()
    expect(window.document.body.textContent).not.toContain(
      "Device media management"
    )
    const choose = window.document.querySelector<HTMLButtonElement>(
      `[aria-label="Recover every use with ${managedAsset.name}"]`
    )
    expect(choose).toBeTruthy()
    await act(async () => choose!.click())
    expect(onRecoveryManagedSelect).toHaveBeenCalledWith(managedAsset)
  })

  it("closes management across action, recovery, external close, and reopen transitions", async () => {
    await renderDialog()
    const manage = Array.from(window.document.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage"
    )!
    await act(async () => manage.click())
    expect(window.document.body.textContent).toContain("Manage media")
    expect(
      window.document.querySelectorAll(
        'input[type="file"][name="media-upload-files"]'
      )
    ).toHaveLength(1)

    await renderDialog({ mode: "recover-local" })
    expect(window.document.body.textContent).not.toContain("Manage media")
    expect(
      window.document.querySelectorAll(
        'input[type="file"][name="media-upload-files"]'
      )
    ).toHaveLength(1)

    await renderDialog({ open: false })
    await renderDialog({ open: true, mode: "insert" })
    expect(window.document.body.textContent).not.toContain("Manage media")
    expect(
      window.document.querySelectorAll(
        'input[type="file"][name="media-upload-files"]'
      )
    ).toHaveLength(0)
  })

  it("uploads from management without changing the preserved browser scope", async () => {
    mocks.uploadManagedMedia.mockImplementation(() => ({
      cancel: vi.fn(),
      promise: new Promise<ManagedMediaAsset>(() => undefined),
    }))
    const onMediaScopeChange = vi.fn()
    await renderDialog({
      mediaScope: {
        kind: "collection",
        collectionId: "collection-brand",
        label: "Brand kit",
      },
      onMediaScopeChange,
    })
    const manage = Array.from(window.document.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage"
    )!
    await act(async () => manage.click())
    const input = window.document.querySelector<HTMLInputElement>(
      'input[type="file"][name="media-upload-files"]'
    )!
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File([new Uint8Array(4)], "brand.png", { type: "image/png" }),
      ],
    })
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true }))
    )

    expect(onMediaScopeChange).not.toHaveBeenCalled()
    expect(mocks.browserProps).toMatchObject({
      scope: {
        kind: "collection",
        collectionId: "collection-brand",
        label: "Brand kit",
      },
    })
  })

  it("closes management for upload Use and exposes pending or rejected action state", async () => {
    mocks.uploadManagedMedia.mockImplementation(() => ({
      cancel: vi.fn(),
      promise: Promise.resolve(managedAsset),
    }))
    const onMediaSelect = vi.fn()
    const resolveUploadedMediaDetail = vi.fn(async () => managedDetail)
    await renderDialog({ onMediaSelect, resolveUploadedMediaDetail })
    const manage = Array.from(window.document.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage"
    )!
    await act(async () => manage.click())
    const input = window.document.querySelector<HTMLInputElement>(
      'input[type="file"][name="media-upload-files"]'
    )!
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File([new Uint8Array(4)], managedAsset.name, {
          type: managedAsset.mediaType,
        }),
      ],
    })
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true }))
    )
    const use = await vi.waitFor(() => {
      const button = Array.from(
        window.document.querySelectorAll("button")
      ).find((candidate) => candidate.textContent === "Use image")
      expect(button).toBeTruthy()
      return button!
    })

    await act(async () => use.click())
    expect(onMediaSelect).toHaveBeenCalledOnce()
    expect(window.document.body.textContent).not.toContain("Manage media")

    const pendingIdentity = `media:managed:${managedAsset.id}@${managedDetail.summary.version}`
    await renderDialog({
      actionsEnabled: false,
      pendingIdentity,
      onMediaSelect,
      resolveUploadedMediaDetail,
    })
    expect(mocks.browserProps).toMatchObject({
      actionsEnabled: false,
      pendingIdentity,
    })
    const disabledManage = Array.from(
      window.document.querySelectorAll("button")
    ).find((button) => button.textContent === "Manage")
    expect(disabledManage?.disabled).toBe(true)

    await renderDialog({
      actionError: "The exact image action was rejected.",
      actionsEnabled: true,
      pendingIdentity: null,
      onMediaSelect,
      resolveUploadedMediaDetail,
    })
    expect(mocks.browserProps).toMatchObject({
      actionError: "The exact image action was rejected.",
      actionsEnabled: true,
    })
  })
})
