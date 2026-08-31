import { describe, expect, it, vi } from "vitest"
import { projectCuratedMediaDetail } from "@webmcp/document"
import type { Document, SceneNode } from "@webmcp/document"
import { studioMediaManifest } from "../../content/library/media/manifest"
import { quotationStarter } from "./quotation-starter"
import {
  captureLibraryMediaActionAnchor,
  commandForPreparedLibraryMediaAction,
  libraryMediaActionAnchorError,
  libraryMediaCommandIsNoOp,
  libraryMediaFinalAdmissionError,
  runLibraryMediaPostCommitUsage,
} from "./library-media-action-executor"
import type { PreparedCuratedLibraryMedia } from "./library-media-action-preparation"
import type { AssetMutationState } from "./asset-mutation-transaction"

const item = studioMediaManifest[0]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const detail = () =>
  projectCuratedMediaDetail(item, {
    curatedRank: 0,
    preferences: { favorite: false, lastUsedAt: null, collectionIds: [] },
  })

const prepared = (
  target: PreparedCuratedLibraryMedia["target"]
): PreparedCuratedLibraryMedia => {
  const exact = detail()
  return {
    source: "curated",
    correlationId: "media-action-executor-1",
    target,
    requestedDetail: exact,
    exactDetail: exact,
    asset: {
      assetId: item.id,
      name: item.name,
      description: item.description,
      src: item.resourcePath,
      width: item.width,
      height: item.height,
    },
    mimeType: item.mimeType,
    bytes: item.bytes,
    provenance: exact.summary.provenance,
    catalogVersion: item.version,
    contentHash: item.contentSha256,
    rendererPreviewSource: "data:image/jpeg;base64,preview",
  }
}

const fixture = () => {
  const document: Document = structuredClone(quotationStarter.document)
  const page = document.pages[0]
  const image: Extract<SceneNode, { type: "image" }> = {
    id: "media-action-image",
    type: "image",
    name: "Original image",
    assetId: "original-image",
    src: "https://assets.example.test/original.jpg",
    alt: "Authored description",
    altProvenance: "authored",
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    decorative: false,
    x: 20,
    y: 30,
    width: 400,
    height: 240,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  }
  document.nodes.push(image)
  page.nodeIds.push(image.id)
  document.fields.push({
    id: "field-hero-image",
    key: "hero_image",
    label: "Hero image",
    type: "asset",
    required: false,
    defaultValue: "",
    agentDescription: "",
    validation: {},
  })
  document.fieldValues["field-hero-image"] = ""
  const state: AssetMutationState = {
    snapshotId: "snapshot-media-action",
    document,
    activePageId: page.id,
    reviewPending: false,
    recoveryPending: false,
  }
  return { document, page, image, state }
}

describe("library media action executor contracts", () => {
  it("builds one canonical add_node command for the captured page", () => {
    const { page, state } = fixture()
    const action = prepared({ type: "insert", pageId: page.id })
    const anchor = captureLibraryMediaActionAnchor(action, state)

    const result = commandForPreparedLibraryMediaAction(
      action,
      anchor,
      state,
      () => "image-exact-insert"
    )

    expect(result.command).toMatchObject({
      type: "add_node",
      pageId: page.id,
      node: {
        id: "image-exact-insert",
        type: "image",
        assetId: item.id,
        src: item.resourcePath,
      },
    })
    expect(result.insertedNodeId).toBe("image-exact-insert")
  })

  it("builds one replacement command without changing image geometry", () => {
    const { page, image, state } = fixture()
    const action = prepared({
      type: "replace",
      pageId: page.id,
      nodeId: image.id,
    })
    const anchor = captureLibraryMediaActionAnchor(action, state)

    const result = commandForPreparedLibraryMediaAction(
      action,
      anchor,
      state,
      () => "unused"
    )

    expect(result.command).toEqual({
      type: "replace_image_source",
      nodeId: image.id,
      assetId: item.id,
      src: item.resourcePath,
    })
  })

  it("builds one set_field command for an asset field", () => {
    const { state } = fixture()
    const action = prepared({
      type: "assign_field",
      fieldId: "field-hero-image",
    })
    const anchor = captureLibraryMediaActionAnchor(action, state)

    const result = commandForPreparedLibraryMediaAction(
      action,
      anchor,
      state,
      () => "unused"
    )

    expect(result.command).toEqual({
      type: "set_field",
      fieldId: "field-hero-image",
      value: item.resourcePath,
    })
  })

  it("detects same-source replace and field assignment before history", () => {
    const replacementFixture = fixture()
    replacementFixture.image.assetId = item.id
    replacementFixture.image.src = item.resourcePath
    const replacement = prepared({
      type: "replace",
      pageId: replacementFixture.page.id,
      nodeId: replacementFixture.image.id,
    })
    const replacementAnchor = captureLibraryMediaActionAnchor(
      replacement,
      replacementFixture.state
    )
    const replacementCommand = commandForPreparedLibraryMediaAction(
      replacement,
      replacementAnchor,
      replacementFixture.state,
      () => "unused"
    ).command
    expect(
      libraryMediaCommandIsNoOp(
        replacementCommand,
        replacementFixture.state
      )
    ).toBe(true)

    const fieldFixture = fixture()
    fieldFixture.document.fieldValues["field-hero-image"] = item.resourcePath
    const assignment = prepared({
      type: "assign_field",
      fieldId: "field-hero-image",
    })
    const assignmentAnchor = captureLibraryMediaActionAnchor(
      assignment,
      fieldFixture.state
    )
    const assignmentCommand = commandForPreparedLibraryMediaAction(
      assignment,
      assignmentAnchor,
      fieldFixture.state,
      () => "unused"
    ).command
    expect(
      libraryMediaCommandIsNoOp(assignmentCommand, fieldFixture.state)
    ).toBe(true)
  })

  it("rejects direct replacement when a field owns the image source", () => {
    const { document, page, image, state } = fixture()
    document.bindings.push({
      id: "binding-hero-image",
      fieldId: "field-hero-image",
      nodeId: image.id,
      property: "src",
    })

    expect(() =>
      captureLibraryMediaActionAnchor(
        prepared({
          type: "replace",
          pageId: page.id,
          nodeId: image.id,
        }),
        state
      )
    ).toThrow(/shared asset field/)
  })

  it("fails closed when the document snapshot changes before command emission", () => {
    const { page, state } = fixture()
    const action = prepared({ type: "insert", pageId: page.id })
    const anchor = captureLibraryMediaActionAnchor(action, state)

    expect(
      libraryMediaActionAnchorError(anchor, {
        ...state,
        snapshotId: "snapshot-newer",
      })
    ).toContain("document target changed")
  })

  it("emits exact shared usage only after the caller invokes post-commit work", async () => {
    const action = prepared({ type: "insert", pageId: fixture().page.id })
    const recordUsed = vi.fn(
      async (
        _identity: Parameters<
          NonNullable<
            Parameters<typeof runLibraryMediaPostCommitUsage>[2]["recordUsed"]
          >
        >[0],
        _name: string,
        _action: "create" | "insert" | "replace" | "assign_field",
        _completionId: string
      ) => true
    )

    expect(recordUsed).not.toHaveBeenCalled()
    await expect(
      runLibraryMediaPostCommitUsage(action, "completion-exact-1", {
        recordUsed,
      })
    ).resolves.toBe(true)
    expect(recordUsed).toHaveBeenCalledWith(
      {
        itemKind: "media",
        mediaSource: "curated",
        id: item.id,
        version: item.version,
      },
      item.name,
      "insert",
      "completion-exact-1"
    )
  })

  it("keeps managed usage owners independent and exposes same-ID retries", async () => {
    const action = {
      ...prepared({
        type: "replace",
        pageId: fixture().page.id,
        nodeId: "media-action-image",
      }),
      source: "managed" as const,
      catalogVersion: 7,
    }
    const recordUsed = vi.fn(
      async (
        _identity: Parameters<
          NonNullable<
            Parameters<typeof runLibraryMediaPostCommitUsage>[2]["recordUsed"]
          >
        >[0],
        _name: string,
        _action: "create" | "insert" | "replace" | "assign_field",
        _completionId: string
      ) => false
    )
    const markManagedUsed = vi.fn(async () => undefined)
    const warnings: Array<{ retry: () => Promise<boolean> }> = []

    await expect(
      runLibraryMediaPostCommitUsage(action, "completion-managed-1", {
        recordUsed,
        markManagedUsed,
        onWarning: (warning) => warnings.push(warning),
      })
    ).resolves.toBe(false)

    expect(recordUsed).toHaveBeenCalledOnce()
    expect(markManagedUsed).toHaveBeenCalledWith(
      item.id,
      "completion-managed-1"
    )
    expect(warnings).toHaveLength(1)
    recordUsed.mockResolvedValue(true)
    await expect(warnings[0].retry()).resolves.toBe(true)
    expect(recordUsed.mock.calls[1]?.[3]).toBe("completion-managed-1")
    expect(markManagedUsed).toHaveBeenCalledOnce()
  })

  it("starts managed receipt owners independently when one remains pending", async () => {
    const action = {
      ...prepared({
        type: "replace",
        pageId: fixture().page.id,
        nodeId: "media-action-image",
      }),
      source: "managed" as const,
      catalogVersion: 7,
    }
    const preferenceGate = deferred<boolean>()
    const recordUsed = vi.fn(async () => preferenceGate.promise)
    const markManagedUsed = vi.fn(async () => true)

    const usage = runLibraryMediaPostCommitUsage(
      action,
      "completion-managed-concurrent",
      { recordUsed, markManagedUsed }
    )

    await vi.waitFor(() => expect(markManagedUsed).toHaveBeenCalledOnce())
    expect(recordUsed).toHaveBeenCalledOnce()
    preferenceGate.resolve(true)
    await expect(usage).resolves.toBe(true)
  })

  it("warns and retries when local mark-used returns no record", async () => {
    const action = {
      ...prepared({ type: "insert", pageId: fixture().page.id }),
      source: "local" as const,
      revision: 3,
      previewBlob: new Blob(["preview"], { type: "image/png" }),
    }
    const markLocalUsed = vi.fn<() => Promise<unknown>>(async () => null)
    const warnings: Array<{ retry: () => Promise<boolean> }> = []

    await expect(
      runLibraryMediaPostCommitUsage(action, "completion-local-missing", {
        markLocalUsed,
        onWarning: (warning) => warnings.push(warning),
      })
    ).resolves.toBe(false)
    expect(warnings).toHaveLength(1)
    markLocalUsed.mockResolvedValue({ id: item.id })
    await expect(warnings[0].retry()).resolves.toBe(true)
  })

  it("rejects changed mutable content at final admission", () => {
    const original = {
      ...prepared({
        type: "replace",
        pageId: fixture().page.id,
        nodeId: "media-action-image",
      }),
      source: "managed" as const,
      catalogVersion: 7,
    }
    const changed = {
      ...original,
      contentHash: "f".repeat(64),
    }

    expect(libraryMediaFinalAdmissionError(original, changed)).toContain(
      "workspace image changed"
    )
    expect(libraryMediaFinalAdmissionError(original, original)).toBeNull()
  })
})
