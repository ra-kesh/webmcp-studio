import { expect, test } from "@playwright/test"
import type { Page as BrowserPage } from "@playwright/test"
import { documentSchema, northstarSeed } from "@webmcp/document"
import type { Document as StudioDocument, SceneNode } from "@webmcp/document"

const documentStorageKey = "webmcp-studio:northstar-document:v2"
const quotationSourceStorageKey = "webmcp-studio:quotation-source:v1"
const quotationTemplateStorageKey = "webmcp-studio:quotation-template:v1"
const designTemplateStorageKey = "webmcp-studio:design-template:v1"

const replacementNodeId = "media-e2e-replacement"
const missingLocalAssetId = "local-missing-photo"

type TestWebMcpResult = {
  structuredContent?: unknown
  isError?: boolean
}

type TestWebMcpTool = {
  name: string
  execute: (input: unknown) => TestWebMcpResult | Promise<TestWebMcpResult>
}

type ImageInspection = Extract<SceneNode, { type: "image" }>

type Inspection = {
  document: {
    id: string
    revision: number
    snapshotId: string
    operationVersion: number
  }
  activePage: { id: string }
  selection: { pageId: string; nodeIds: string[] } | null
  activePageNodes: SceneNode[]
  pendingChangeSet: { id: string } | null
}

type ManagedAsset = {
  id: string
  name: string
  mediaType: "image/png" | "image/jpeg" | "image/webp"
  bytes: number
  width: number
  height: number
  createdAt: string
  updatedAt: string
  lastUsedAt: string
  status: "ready"
}

type DeletionImpact = {
  assetId: string
  revision: number
  token: string
  canArchive: boolean
  currentReferences: number
  publishedReferences: number
  references: Array<{
    referenceKind: "current_document" | "published_version"
    sourceId: string
    documentId: string
    pageId: string | null
    nodeId: string | null
    fieldId: string | null
    property: string | null
  }>
}

type MediaApiState = {
  assets: ManagedAsset[]
  recentAssetIds: Set<string>
  unavailableAssetIds: Set<string>
  usedBarrier: Promise<void> | null
  paginationBarrier: Promise<void> | null
  failListRequests: number
  deletionImpact: (assetId: string, call: number) => DeletionImpact
  impactCalls: Map<string, number>
  deleteCalls: string[]
  usedCalls: string[]
}

declare global {
  interface Window {
    __studioTestTools?: Map<string, TestWebMcpTool>
    __mediaUploadHarness?: {
      progress: (name: string, loaded: number, total: number) => void
      succeed: (name: string, asset: unknown) => void
      fail: (name: string) => void
      requestCount: (name: string) => number
    }
    __mediaObjectUrlHarness?: {
      created: string[]
      revoked: string[]
    }
  }
}

const managedAlpha: ManagedAsset = {
  id: "asset-managed-alpha1",
  name: "Managed alpha.jpg",
  mediaType: "image/jpeg",
  bytes: 24_000,
  width: 1_200,
  height: 800,
  createdAt: "2026-08-27T08:00:00.000Z",
  updatedAt: "2026-08-27T08:00:00.000Z",
  lastUsedAt: "2026-08-28T08:00:00.000Z",
  status: "ready",
}

const managedRace: ManagedAsset = {
  id: "asset-managed-race01",
  name: "Managed race.webp",
  mediaType: "image/webp",
  bytes: 18_000,
  width: 900,
  height: 1_200,
  createdAt: "2026-08-28T07:00:00.000Z",
  updatedAt: "2026-08-28T07:00:00.000Z",
  lastUsedAt: "2026-08-28T07:00:00.000Z",
  status: "ready",
}

const managedDelete: ManagedAsset = {
  id: "asset-managed-delete1",
  name: "Managed archive.png",
  mediaType: "image/png",
  bytes: 14_000,
  width: 800,
  height: 600,
  createdAt: "2026-08-28T06:00:00.000Z",
  updatedAt: "2026-08-28T06:00:00.000Z",
  lastUsedAt: "2026-08-28T06:00:00.000Z",
  status: "ready",
}

function managedInventory(count: number): ManagedAsset[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(3, "0")
    const timestamp = new Date(
      Date.parse("2026-08-27T00:00:00.000Z") + index * 60_000
    ).toISOString()
    return {
      id: `asset-inventory-${suffix}`,
      name: `Inventory ${suffix}.png`,
      mediaType: "image/png",
      bytes: 1_024 + index,
      width: 800,
      height: 600,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
      status: "ready",
    }
  })
}

const validImpact = (assetId: string): DeletionImpact => ({
  assetId,
  revision: 4,
  token: "a".repeat(64),
  canArchive: true,
  currentReferences: 0,
  publishedReferences: 0,
  references: [],
})

function imageFixture({
  assetId = "library-original",
  src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='480'/%3E",
  boundToAssetField = false,
}: {
  assetId?: string
  src?: string
  boundToAssetField?: boolean
} = {}): StudioDocument {
  const base = structuredClone(northstarSeed)
  const image: ImageInspection = {
    id: replacementNodeId,
    type: "image",
    name: "Replace target",
    assetId,
    src,
    alt: "Original alternative text",
    decorative: false,
    placement: {
      mode: "manual",
      focalX: 0.23,
      focalY: 0.77,
      zoom: 1.35,
      rotation: -9,
      flipX: true,
      flipY: false,
    },
    frameMask: { shape: "rounded_rectangle", radius: 0.16 },
    x: 123,
    y: 234,
    width: 345,
    height: 456,
    rotation: 17,
    opacity: 0.72,
    visible: true,
    locked: false,
  }
  return documentSchema.parse({
    ...base,
    id: "media-e2e-document",
    name: "Media production fixture",
    revision: 0,
    updatedAt: "2026-08-28T08:00:00.000Z",
    pages: base.pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            nodeIds: [
              ...page.nodeIds.slice(0, 2),
              replacementNodeId,
              ...page.nodeIds.slice(2),
            ],
          }
        : page
    ),
    nodes: [...base.nodes, image],
    fields: boundToAssetField
      ? [
          ...base.fields,
          {
            id: "field-replacement-image",
            key: "replacement_image",
            label: "Shared portrait",
            type: "asset",
            required: true,
            defaultValue: src,
            agentDescription: "The portrait shared by proposal pages.",
            validation: {},
          },
        ]
      : base.fields,
    fieldValues: boundToAssetField
      ? { ...base.fieldValues, "field-replacement-image": src }
      : base.fieldValues,
    bindings: boundToAssetField
      ? [
          ...base.bindings,
          {
            id: "binding-replacement-image",
            fieldId: "field-replacement-image",
            nodeId: replacementNodeId,
            property: "src",
          },
        ]
      : base.bindings,
  })
}

async function installStudioContext(
  page: BrowserPage,
  fixture?: StudioDocument
) {
  await page.addInitScript(
    ({
      documentKey,
      sourceKey,
      quotationTemplateKey,
      designTemplateKey,
      documentValue,
    }) => {
      const initialized = sessionStorage.getItem("media-e2e-initialized")
      if (!initialized) {
        if (documentValue) {
          localStorage.setItem(documentKey, JSON.stringify(documentValue))
        } else {
          localStorage.removeItem(documentKey)
        }
        localStorage.removeItem(sourceKey)
        localStorage.removeItem(quotationTemplateKey)
        localStorage.removeItem(designTemplateKey)
        sessionStorage.clear()
        sessionStorage.setItem("media-e2e-initialized", "true")
      }

      const nativeCreateObjectUrl = URL.createObjectURL.bind(URL)
      const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL)
      const objectUrlHarness = {
        created: [] as string[],
        revoked: [] as string[],
      }
      window.__mediaObjectUrlHarness = objectUrlHarness
      URL.createObjectURL = (object) => {
        const url = nativeCreateObjectUrl(object)
        objectUrlHarness.created.push(url)
        return url
      }
      URL.revokeObjectURL = (url) => {
        objectUrlHarness.revoked.push(url)
        nativeRevokeObjectUrl(url)
      }

      const tools = new Map<string, TestWebMcpTool>()
      window.__studioTestTools = tools
      const documentWithModelContext = document as Document & {
        modelContext?: {
          registerTool: (tool: TestWebMcpTool) => Promise<undefined>
        }
      }
      documentWithModelContext.modelContext = {
        registerTool: async (tool) => {
          tools.set(tool.name, tool)
          return undefined
        },
      }

      type FakeRequest = {
        upload: { onprogress: ((event: ProgressEvent) => void) | null }
        responseType: XMLHttpRequestResponseType
        response: unknown
        status: number
        timeout: number
        onerror: (() => void) | null
        onabort: (() => void) | null
        ontimeout: (() => void) | null
        onload: (() => void) | null
        open: (method: string, url: string) => void
        setRequestHeader: (name: string, value: string) => void
        send: (body: Document | XMLHttpRequestBodyInit | null) => void
        abort: () => void
      }
      const requests = new Map<string, FakeRequest[]>()

      class FakeXMLHttpRequest implements FakeRequest {
        upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
        responseType: XMLHttpRequestResponseType = ""
        response: unknown = null
        status = 0
        timeout = 0
        onerror: (() => void) | null = null
        onabort: (() => void) | null = null
        ontimeout: (() => void) | null = null
        onload: (() => void) | null = null

        open() {}

        setRequestHeader() {}

        send(body: Document | XMLHttpRequestBodyInit | null) {
          const file = body instanceof FormData ? body.get("file") : null
          const name = file instanceof File ? file.name : "unknown"
          requests.set(name, [...(requests.get(name) ?? []), this])
        }

        abort() {
          this.onabort?.()
        }
      }

      const latest = (name: string) => {
        const request = requests.get(name)?.at(-1)
        if (!request) throw new Error(`No upload request for ${name}`)
        return request
      }
      window.__mediaUploadHarness = {
        progress: (name, loaded, total) => {
          latest(name).upload.onprogress?.(
            new ProgressEvent("progress", {
              lengthComputable: true,
              loaded,
              total,
            })
          )
        },
        succeed: (name, asset) => {
          const request = latest(name)
          request.status = 201
          request.response = { asset }
          request.onload?.()
        },
        fail: (name) => latest(name).onerror?.(),
        requestCount: (name) => requests.get(name)?.length ?? 0,
      }
      window.XMLHttpRequest =
        FakeXMLHttpRequest as unknown as typeof XMLHttpRequest
    },
    {
      documentKey: documentStorageKey,
      sourceKey: quotationSourceStorageKey,
      quotationTemplateKey: quotationTemplateStorageKey,
      designTemplateKey: designTemplateStorageKey,
      documentValue: fixture ?? null,
    }
  )
}

async function bootStudio(page: BrowserPage, fixture?: StudioDocument) {
  await installStudioContext(page, fixture)
  await page.goto("/")
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
}

async function inspectDesign(page: BrowserPage) {
  const result = await page.evaluate(async () =>
    window.__studioTestTools?.get("inspect_design")?.execute({})
  )
  expect(result?.isError).not.toBe(true)
  return result?.structuredContent as Inspection
}

function imageNode(inspection: Inspection, nodeId = replacementNodeId) {
  const node = inspection.activePageNodes.find(
    (candidate): candidate is ImageInspection =>
      candidate.id === nodeId && candidate.type === "image"
  )
  if (!node) throw new Error(`Missing inspected image ${nodeId}`)
  return node
}

async function readStoredDocument(page: BrowserPage) {
  return page.evaluate((key) => {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as StudioDocument) : null
  }, documentStorageKey)
}

async function installMediaApi(page: BrowserPage, state: MediaApiState) {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
  await page.route("**/v1/studio/assets**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const assetId = path.split("/")[4] ?? ""

    if (path === "/v1/studio/assets" && request.method() === "GET") {
      if (state.failListRequests > 0) {
        state.failListRequests -= 1
        await route.fulfill({
          status: 503,
          json: {
            error: {
              code: "media_unavailable",
              message: "The media repository is temporarily unavailable.",
            },
          },
        })
        return
      }
      const query = (url.searchParams.get("query") ?? "").toLowerCase()
      const collection = url.searchParams.get("collection") ?? "uploads"
      const cursor = Number(url.searchParams.get("cursor") ?? 0)
      const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50))
      if (cursor > 0) await state.paginationBarrier
      const matching = state.assets
        .filter(
          (asset) =>
            (collection !== "recent" || state.recentAssetIds.has(asset.id)) &&
            (asset.name.toLowerCase().includes(query) ||
              asset.id.toLowerCase() === query)
        )
        .sort(
          (left, right) =>
            (collection === "recent"
              ? right.lastUsedAt.localeCompare(left.lastUsedAt)
              : right.createdAt.localeCompare(left.createdAt)) ||
            right.id.localeCompare(left.id)
        )
      const assets = matching.slice(cursor, cursor + limit)
      await route.fulfill({
        json: {
          assets,
          nextCursor:
            cursor + assets.length < matching.length
              ? String(cursor + assets.length)
              : null,
          storage: {
            bytes: state.assets.reduce((sum, asset) => sum + asset.bytes, 0),
            count: state.assets.length,
          },
        },
      })
      return
    }

    if (
      /^\/v1\/studio\/assets\/[^/]+$/.test(path) &&
      request.method() === "GET"
    ) {
      const asset = state.assets.find((candidate) => candidate.id === assetId)
      if (!asset) {
        await route.fulfill({ status: 404, json: { error: "asset_not_found" } })
        return
      }
      const selectable = !state.unavailableAssetIds.has(asset.id)
      await route.fulfill({
        json: {
          asset: {
            ...asset,
            status: selectable ? "ready" : "archived",
            selectable,
          },
        },
      })
      return
    }

    if (path.endsWith("/content") && request.method() === "GET") {
      await route.fulfill({ contentType: "image/png", body: onePixelPng })
      return
    }

    if (path.endsWith("/used") && request.method() === "POST") {
      state.usedCalls.push(assetId)
      await state.usedBarrier
      const asset = state.assets.find((candidate) => candidate.id === assetId)
      if (!asset) {
        await route.fulfill({ status: 404, json: { error: "asset_not_found" } })
        return
      }
      asset.lastUsedAt = "2026-08-28T12:00:00.000Z"
      state.recentAssetIds.add(asset.id)
      await route.fulfill({ json: { asset } })
      return
    }

    if (path.endsWith("/deletion-impact") && request.method() === "GET") {
      const call = (state.impactCalls.get(assetId) ?? 0) + 1
      state.impactCalls.set(assetId, call)
      await route.fulfill({
        json: { impact: state.deletionImpact(assetId, call) },
      })
      return
    }

    if (
      path === `/v1/studio/assets/${assetId}` &&
      request.method() === "DELETE"
    ) {
      state.deleteCalls.push(assetId)
      state.assets = state.assets.filter((asset) => asset.id !== assetId)
      state.recentAssetIds.delete(assetId)
      await route.fulfill({
        json: { assetId, status: "archived", revision: 5 },
      })
      return
    }

    await route.fulfill({
      status: 404,
      json: { error: "unhandled_media_route" },
    })
  })
}

function mediaApiState(assets: ManagedAsset[] = []): MediaApiState {
  return {
    assets: structuredClone(assets),
    recentAssetIds: new Set(
      assets
        .filter((asset) => asset.lastUsedAt > asset.createdAt)
        .map((asset) => asset.id)
    ),
    unavailableAssetIds: new Set(),
    usedBarrier: null,
    paginationBarrier: null,
    failListRequests: 0,
    deletionImpact: validImpact,
    impactCalls: new Map(),
    deleteCalls: [],
    usedCalls: [],
  }
}

async function openMediaFromToolbar(
  page: BrowserPage,
  entry: "Upload image…" | "Asset library…"
) {
  const opener = page.getByRole("button", { name: "Insert shape" })
  await opener.click()
  await page.getByRole("menuitem", { name: entry }).click()
  const dialog = page.getByRole("dialog", { name: "Add image" })
  await expect(dialog).toBeVisible()
  return { dialog, opener }
}

async function seedLocalAsset(
  page: BrowserPage,
  {
    id,
    name,
    includeBlob,
    used = true,
  }: { id: string; name: string; includeBlob: boolean; used?: boolean }
) {
  await seedLocalAssets(page, [{ id, name, includeBlob, used }])
}

async function seedLocalAssets(
  page: BrowserPage,
  assets: Array<{
    id: string
    name: string
    includeBlob: boolean
    used?: boolean
  }>
) {
  await page.evaluate(async (localAssets) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webmcp-studio-assets", 4)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("asset-metadata")) {
          db.createObjectStore("asset-metadata", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("asset-blobs")) {
          db.createObjectStore("asset-blobs")
        }
        if (!db.objectStoreNames.contains("asset-quarantine")) {
          db.createObjectStore("asset-quarantine", { keyPath: "id" })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ["asset-metadata", "asset-blobs"],
        "readwrite"
      )
      const binary = atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      )
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0)
      )
      for (const [index, asset] of localAssets.entries()) {
        const timestamp = new Date(
          Date.parse("2026-08-28T06:00:00.000Z") + index * 1_000
        ).toISOString()
        transaction.objectStore("asset-metadata").put({
          schemaVersion: 4,
          id: asset.id,
          name: asset.name,
          mediaType: "image/png",
          size: 68,
          width: 1,
          height: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastUsedAt:
            asset.used === false ? timestamp : "2026-08-28T11:00:00.000Z",
          archivedAt: null,
          revision: 1,
        })
        if (asset.includeBlob) {
          transaction
            .objectStore("asset-blobs")
            .put(new Blob([bytes], { type: "image/png" }), asset.id)
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  }, assets)
}

async function selectReplacementTarget(page: BrowserPage) {
  await page.getByRole("tab", { name: "Layers", exact: true }).click()
  const target = page.getByRole("treeitem", {
    name: "Replace target",
    exact: true,
  })
  await target.click()
  await page.getByRole("tab", { name: "Design", exact: true }).click()
  return target
}

test("toolbar media entry exposes distinct collections and inserts a built-in asset atomically", async ({
  page,
}) => {
  const state = mediaApiState([managedAlpha])
  await installMediaApi(page, state)
  await bootStudio(page)
  await seedLocalAsset(page, {
    id: "local-reusable-photo",
    name: "Local reusable.png",
    includeBlob: true,
  })

  const before = await inspectDesign(page)
  const { dialog } = await openMediaFromToolbar(page, "Asset library…")
  await expect(dialog.getByRole("tab", { name: "Library" })).toHaveAttribute(
    "data-state",
    "active"
  )
  await expect(
    dialog.getByRole("button", { name: "Insert Olive botanical" })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: /More actions for Olive botanical/ })
  ).toHaveCount(0)

  await dialog.getByRole("tab", { name: "Recent" }).click()
  await expect(
    dialog.getByText("Managed alpha.jpg", { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByText("Local reusable.png", { exact: true })
  ).toBeVisible()
  await dialog.getByRole("tab", { name: "Uploads" }).click()
  await expect(
    dialog.getByText("Workspace upload", { exact: true })
  ).toBeVisible()
  await expect(dialog.locator("footer")).toContainText("This device:")

  await dialog.getByRole("tab", { name: "Library" }).click()
  await dialog.getByRole("button", { name: "Insert Olive botanical" }).click()
  await expect(dialog).toBeHidden()

  await expect
    .poll(async () => {
      const inspection = await inspectDesign(page)
      return inspection.activePageNodes.filter(
        (node) =>
          node.type === "image" && node.assetId === "library-olive-botanical"
      ).length
    })
    .toBe(1)
  const after = await inspectDesign(page)
  expect(after.document.operationVersion).toBe(
    before.document.operationVersion + 1
  )
  const inserted = after.activePageNodes.find(
    (node): node is ImageInspection =>
      node.type === "image" && node.assetId === "library-olive-botanical"
  )
  expect(inserted).toBeDefined()
  expect(after.selection?.nodeIds).toEqual([inserted!.id])

  await page.getByRole("button", { name: "Undo" }).click()
  await expect
    .poll(async () => {
      const inspection = await inspectDesign(page)
      return inspection.activePageNodes.some((node) => node.id === inserted!.id)
    })
    .toBe(false)
})

test("selection commit blocks close, upload, and duplicate mutations until it settles", async ({
  page,
}) => {
  const state = mediaApiState([managedAlpha])
  let releaseUsed: () => void = () => {}
  state.usedBarrier = new Promise<void>((resolve) => {
    releaseUsed = resolve
  })
  await installMediaApi(page, state)
  await bootStudio(page)
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")
  await dialog
    .getByRole("button", { name: `Insert ${managedAlpha.name}` })
    .click()
  await expect(
    dialog.getByRole("button", { name: "Close media library" })
  ).toBeDisabled()
  await expect(
    dialog.getByRole("button", { name: "Upload images" })
  ).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  releaseUsed()
  await expect(dialog).toBeHidden()
  expect(state.usedCalls).toEqual([managedAlpha.id])
})

test("inspector replacement uses the same library and preserves layer geometry, crop, name, and stack position", async ({
  page,
}) => {
  await installMediaApi(page, mediaApiState())
  await bootStudio(page, imageFixture())
  const target = await selectReplacementTarget(page)
  const before = await inspectDesign(page)
  const beforeNode = imageNode(before)
  const beforeDocument = await readStoredDocument(page)
  const beforeStackIndex =
    beforeDocument?.pages[0]?.nodeIds.indexOf(replacementNodeId)

  await page.getByRole("button", { name: "Replace image…" }).click()
  const dialog = page.getByRole("dialog", { name: "Replace image" })
  await expect(dialog).toContainText("Replace target")
  await dialog.getByRole("tab", { name: "Library" }).click()
  await dialog
    .getByRole("button", { name: /Replace .* with Sandstone arches/ })
    .click()
  await expect(dialog).toBeHidden()

  const after = await inspectDesign(page)
  const afterNode = imageNode(after)
  expect(afterNode).toMatchObject({
    id: beforeNode.id,
    name: beforeNode.name,
    x: beforeNode.x,
    y: beforeNode.y,
    width: beforeNode.width,
    height: beforeNode.height,
    rotation: beforeNode.rotation,
    opacity: beforeNode.opacity,
    visible: beforeNode.visible,
    locked: beforeNode.locked,
    placement: beforeNode.placement,
    frameMask: beforeNode.frameMask,
    decorative: beforeNode.decorative,
    assetId: "library-sandstone-arches",
  })
  expect(afterNode.alt).toBe(beforeNode.alt)
  expect(after.selection?.nodeIds).toEqual([replacementNodeId])
  expect(
    (await readStoredDocument(page))?.pages[0]?.nodeIds.indexOf(
      replacementNodeId
    )
  ).toBe(beforeStackIndex)
  await expect(target).toHaveAttribute("aria-selected", "true")

  await page.getByRole("button", { name: "Undo" }).click()
  await expect
    .poll(async () => imageNode(await inspectDesign(page)).assetId)
    .toBe(beforeNode.assetId)
  expect(imageNode(await inspectDesign(page))).toMatchObject(beforeNode)
})

test("managed replacement preserves image geometry and selects the existing layer", async ({
  page,
}) => {
  const state = mediaApiState([managedAlpha])
  await installMediaApi(page, state)
  await bootStudio(page, imageFixture())
  await selectReplacementTarget(page)
  const before = imageNode(await inspectDesign(page))

  await page.getByRole("button", { name: "Replace image…" }).click()
  const dialog = page.getByRole("dialog", { name: "Replace image" })
  await dialog
    .getByRole("button", {
      name: `Replace “Replace target” with ${managedAlpha.name}`,
    })
    .click()
  await expect(dialog).toBeHidden()

  const inspection = await inspectDesign(page)
  expect(imageNode(inspection)).toMatchObject({
    id: before.id,
    name: before.name,
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
    rotation: before.rotation,
    opacity: before.opacity,
    placement: before.placement,
    frameMask: before.frameMask,
    decorative: before.decorative,
    alt: before.alt,
    assetId: managedAlpha.id,
  })
  expect(inspection.selection?.nodeIds).toEqual([replacementNodeId])
  expect(state.usedCalls).toEqual([managedAlpha.id])
})

test("a source-bound image blocks layer-only replacement without detaching or reverting", async ({
  page,
}) => {
  await installMediaApi(page, mediaApiState())
  await bootStudio(page, imageFixture({ boundToAssetField: true }))
  await selectReplacementTarget(page)
  const before = await inspectDesign(page)
  const beforeNode = imageNode(before)
  const beforeStored = await readStoredDocument(page)

  await page.getByRole("button", { name: "Replace image…" }).click()
  const dialog = page.getByRole("dialog", { name: "Replace image" })
  await dialog.getByRole("tab", { name: "Library" }).click()
  await dialog
    .getByRole("button", { name: /Replace .* with Olive botanical/ })
    .click()

  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("status")).toContainText(
    "“Replace target” gets its image from the “Shared portrait” shared asset field (1 linked layer). Change the field value in Fields to update every linked layer, or unbind Source to replace only this layer."
  )
  const after = await inspectDesign(page)
  expect(after.document.revision).toBe(before.document.revision)
  expect(after.document.operationVersion).toBe(before.document.operationVersion)
  expect(imageNode(after)).toEqual(beforeNode)
  const stored = await readStoredDocument(page)
  expect(stored).toEqual(beforeStored)
  expect(stored?.bindings).toContainEqual({
    id: "binding-replacement-image",
    fieldId: "field-replacement-image",
    nodeId: replacementNodeId,
    property: "src",
  })
})

test("a managed item archived after listing is rechecked before document commit", async ({
  page,
}) => {
  const state = mediaApiState([managedAlpha])
  await installMediaApi(page, state)
  await bootStudio(page)
  const before = await inspectDesign(page)
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")
  await expect(
    dialog.getByRole("button", { name: `Insert ${managedAlpha.name}` })
  ).toBeVisible()
  state.unavailableAssetIds.add(managedAlpha.id)

  await dialog
    .getByRole("button", { name: `Insert ${managedAlpha.name}` })
    .click()

  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("status")).toContainText(
    "That image could not be added"
  )
  const after = await inspectDesign(page)
  expect(after.document.operationVersion).toBe(before.document.operationVersion)
  expect(
    after.activePageNodes.some(
      (node) => node.type === "image" && node.assetId === managedAlpha.id
    )
  ).toBe(false)
  expect(state.usedCalls).toEqual([])
})

test("a managed item archived after WebMCP proposal is rechecked before apply", async ({
  page,
}) => {
  const state = mediaApiState([managedAlpha])
  await installMediaApi(page, state)
  await bootStudio(page)
  const before = await inspectDesign(page)
  const proposal = await page.evaluate(
    async (input) =>
      window.__studioTestTools?.get("propose_asset_insertion")?.execute(input),
    {
      documentId: before.document.id,
      baseRevision: before.document.revision,
      baseSnapshotId: before.document.snapshotId,
      pageId: before.activePage.id,
      assetId: managedAlpha.id,
      x: 120,
      y: 160,
      width: 320,
      height: 240,
      fit: "cover",
    }
  )
  expect(proposal?.isError).not.toBe(true)
  state.unavailableAssetIds.add(managedAlpha.id)

  await page.getByRole("button", { name: "Accept all" }).click()
  await page.getByRole("button", { name: "Apply 1 change" }).click()

  await expect(page.getByRole("alert")).toContainText(
    "An image in this review is no longer available"
  )
  const after = await inspectDesign(page)
  expect(after.document.operationVersion).toBe(before.document.operationVersion)
  expect(after.pendingChangeSet).toBeTruthy()
  expect(
    after.activePageNodes.some(
      (node) => node.type === "image" && node.assetId === managedAlpha.id
    )
  ).toBe(false)
})

test("a local upload can be inserted, survives reload, and becomes reusable Recent media", async ({
  page,
}) => {
  const localId = "local-reload-reuse"
  await installMediaApi(page, mediaApiState())
  await bootStudio(page)
  await seedLocalAsset(page, {
    id: localId,
    name: "Reusable local.png",
    includeBlob: true,
    used: false,
  })

  let picker = await openMediaFromToolbar(page, "Upload image…")
  await picker.dialog
    .getByRole("button", { name: "Insert Reusable local.png" })
    .click()
  await expect(picker.dialog).toBeHidden()
  await expect
    .poll(
      async () =>
        (await inspectDesign(page)).activePageNodes.filter(
          (node) => node.type === "image" && node.assetId === localId
        ).length
    )
    .toBe(1)

  await page.reload()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
  picker = await openMediaFromToolbar(page, "Asset library…")
  await picker.dialog.getByRole("tab", { name: "Recent" }).click()
  await expect(
    picker.dialog.getByText("Reusable local.png", { exact: true })
  ).toBeVisible()
  await picker.dialog
    .getByRole("button", { name: "Insert Reusable local.png" })
    .click()
  await expect
    .poll(
      async () =>
        (await inspectDesign(page)).activePageNodes.filter(
          (node) => node.type === "image" && node.assetId === localId
        ).length
    )
    .toBe(2)
})

test("multi-file uploads expose real progress and independent success, error, cancel, and retry states", async ({
  page,
}) => {
  await installMediaApi(page, mediaApiState())
  await bootStudio(page)
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")
  const files = ["success.png", "failed.png", "cancel.png"].map((name) => ({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(`fixture:${name}`),
  }))
  await dialog.locator('input[type="file"]').setInputFiles(files)
  await expect(dialog.getByText("Upload queue", { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole("progressbar", { name: "Uploading success.png" })
  ).not.toHaveAttribute("value")

  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: "Uploads are still in progress" })
  ).toBeVisible()

  await page.evaluate(() =>
    window.__mediaUploadHarness?.progress("success.png", 40, 100)
  )
  await expect(
    dialog.getByRole("progressbar", { name: "Uploading success.png" })
  ).toHaveAttribute("value", "40")
  await expect(dialog.getByText("40%", { exact: true })).toBeVisible()

  const successAsset: ManagedAsset = {
    ...managedAlpha,
    id: "asset-upload-success1",
    name: "success.png",
    mediaType: "image/png",
  }
  await page.evaluate(
    ({ name, asset }) => window.__mediaUploadHarness?.succeed(name, asset),
    { name: "success.png", asset: successAsset }
  )
  await page.evaluate(() => window.__mediaUploadHarness?.fail("failed.png"))
  await dialog
    .getByRole("button", { name: "Cancel upload of cancel.png" })
    .click()
  await expect(dialog.getByText("Ready", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Upload failed", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Cancelled", { exact: true })).toBeVisible()
  await expect(dialog).toContainText(
    "The image could not reach Studio. Check your connection and retry."
  )

  const failedRow = dialog
    .getByText("failed.png", { exact: true })
    .locator("xpath=../../..")
  await failedRow.getByRole("button", { name: "Retry" }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mediaUploadHarness?.requestCount("failed.png")
      )
    )
    .toBe(2)
  const retryAsset: ManagedAsset = {
    ...managedAlpha,
    id: "asset-upload-retry001",
    name: "failed.png",
    mediaType: "image/png",
  }
  await page.evaluate(
    ({ name, asset }) => window.__mediaUploadHarness?.succeed(name, asset),
    { name: "failed.png", asset: retryAsset }
  )
  await expect(failedRow.getByText("Ready", { exact: true })).toBeVisible()

  await dialog.getByRole("tab", { name: "Recent" }).click()
  await expect(dialog.getByText("success.png", { exact: true })).toHaveCount(0)
  await dialog.getByRole("tab", { name: "Uploads" }).click()

  const successRow = dialog
    .getByText("success.png", { exact: true })
    .locator("xpath=../../..")
  await successRow.getByRole("button", { name: "Use image" }).click()
  await expect(dialog).toBeHidden()
  await expect
    .poll(async () => {
      const inspection = await inspectDesign(page)
      return inspection.activePageNodes.some(
        (node) => node.type === "image" && node.assetId === successAsset.id
      )
    })
    .toBe(true)
})

test("repository failure retries into an honest empty state and search remains collection-scoped", async ({
  page,
}) => {
  const state = mediaApiState()
  state.failListRequests = 2
  await installMediaApi(page, state)
  await bootStudio(page)
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")

  await expect(dialog.getByText("Cloud media is unavailable")).toBeVisible()
  await expect(dialog).toContainText(
    "The media repository is temporarily unavailable."
  )
  await dialog.getByRole("button", { name: "Retry" }).click()
  await expect(
    dialog.getByText("No uploads yet", { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Upload images" })
  ).toBeVisible()

  await dialog.getByRole("tab", { name: "Library" }).click()
  const search = dialog.getByRole("searchbox", { name: "Search media" })
  await search.fill("sandstone")
  await expect(
    dialog.getByRole("button", { name: "Insert Sandstone arches" })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Insert Olive botanical" })
  ).toHaveCount(0)
  await search.fill("no-such-media")
  await expect(
    dialog.getByText("No images match “no-such-media”", { exact: true })
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Clear search" }).click()
  await expect(
    dialog.getByRole("button", { name: "Insert Olive botanical" })
  ).toBeVisible()
})

test("a query change cancels an in-flight Load more page and ignores its stale assets", async ({
  page,
}) => {
  const state = mediaApiState(managedInventory(55))
  let releasePagination: () => void = () => {}
  state.paginationBarrier = new Promise<void>((resolve) => {
    releasePagination = resolve
  })
  await installMediaApi(page, state)
  await bootStudio(page)
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")
  await expect(dialog.getByRole("button", { name: "Load more" })).toBeVisible()

  await dialog.getByRole("button", { name: "Load more" }).click()
  const search = dialog.getByRole("searchbox", { name: "Search media" })
  await search.fill("Inventory 054")
  await expect(
    dialog.getByText("Inventory 054.png", { exact: true })
  ).toBeVisible()
  releasePagination()

  await expect(
    dialog.getByText("Inventory 004.png", { exact: true })
  ).toHaveCount(0)
  await expect(
    dialog.getByText("Inventory 054.png", { exact: true })
  ).toBeVisible()
})

test("a missing local blob is explicit and can be repaired through geometry-safe inspector replacement", async ({
  page,
}) => {
  await installMediaApi(page, mediaApiState())
  await bootStudio(
    page,
    imageFixture({
      assetId: missingLocalAssetId,
      src: `asset:local/${missingLocalAssetId}`,
    })
  )
  await seedLocalAsset(page, {
    id: missingLocalAssetId,
    name: "Missing portrait.png",
    includeBlob: false,
  })
  const before = imageNode(await inspectDesign(page))
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")

  await expect(
    dialog.getByRole("button", {
      name: `Locate replacement for ${missingLocalAssetId}`,
    })
  ).toBeVisible()
  await expect(
    dialog.getByText("File missing on this device", { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Insert Missing portrait.png" })
  ).toBeDisabled()
  await dialog
    .getByRole("button", {
      name: `Locate replacement for ${missingLocalAssetId}`,
    })
    .click()
  const repair = page.getByRole("dialog", { name: "Replace image" })
  await expect(repair).toContainText("Replace target")
  await repair.getByRole("tab", { name: "Library" }).click()
  await repair
    .getByRole("button", { name: /Replace .* with Olive botanical/ })
    .click()
  const repaired = imageNode(await inspectDesign(page))
  expect(repaired).toMatchObject({
    id: before.id,
    name: before.name,
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
    rotation: before.rotation,
    opacity: before.opacity,
    placement: before.placement,
    frameMask: before.frameMask,
    decorative: before.decorative,
    alt: before.alt,
    assetId: "library-olive-botanical",
  })
})

test("reference navigation cannot bypass the active-upload close guard", async ({
  page,
}) => {
  const state = mediaApiState([managedAlpha])
  await installMediaApi(page, state)
  await bootStudio(
    page,
    imageFixture({
      assetId: managedAlpha.id,
      src: `asset:managed/${managedAlpha.id}`,
    })
  )
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: Buffer.from("pending-upload"),
  })
  await dialog
    .getByRole("button", { name: `More actions for ${managedAlpha.name}` })
    .click()
  await page.getByRole("menuitem", { name: "Remove from uploads" }).click()
  const review = page.getByRole("alertdialog", {
    name: "This image is still in use",
  })
  await review
    .getByRole("button")
    .filter({ hasText: "Layer on" })
    .first()
    .click()

  await expect(review).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: "Uploads are still in progress" })
  ).toBeVisible()
  expect((await inspectDesign(page)).selection).toBeNull()
  await dialog
    .getByRole("button", { name: "Cancel upload of pending.png" })
    .click()
})

test("archive is blocked by current use and revalidates managed impact before destructive commit", async ({
  page,
}) => {
  const state = mediaApiState([managedAlpha, managedRace])
  state.deletionImpact = (assetId, call) => {
    if (assetId !== managedRace.id || call === 1) return validImpact(assetId)
    return {
      ...validImpact(assetId),
      canArchive: false,
      publishedReferences: 1,
      references: [
        {
          referenceKind: "published_version",
          sourceId: "template-v1",
          documentId: "published-document",
          pageId: null,
          nodeId: null,
          fieldId: null,
          property: null,
        },
      ],
    }
  }
  await installMediaApi(page, state)
  await bootStudio(page)
  let picker = await openMediaFromToolbar(page, "Upload image…")
  await picker.dialog
    .getByRole("button", { name: `Insert ${managedAlpha.name}` })
    .click()
  await expect(picker.dialog).toBeHidden()

  picker = await openMediaFromToolbar(page, "Upload image…")
  const usedMenu = picker.dialog.getByRole("button", {
    name: `More actions for ${managedAlpha.name}`,
  })
  await usedMenu.focus()
  await usedMenu.click()
  await page.getByRole("menuitem", { name: "Remove from uploads" }).click()
  let review = page.getByRole("alertdialog", {
    name: "This image is still in use",
  })
  await expect(review).toContainText("1 layer reference in this design")
  await expect(
    review.getByRole("button", { name: "Remove image" })
  ).toHaveCount(0)
  const referenceLink = review
    .getByRole("button")
    .filter({ hasText: "Layer on" })
    .first()
  await expect(referenceLink).toBeVisible()
  await referenceLink.click()
  await expect(review).toBeHidden()
  await expect(picker.dialog).toBeHidden()
  await expect
    .poll(async () => {
      const inspection = await inspectDesign(page)
      const selectedId = inspection.selection?.nodeIds[0]
      const selected = inspection.activePageNodes.find(
        (node): node is ImageInspection =>
          node.id === selectedId && node.type === "image"
      )
      return selected?.assetId
    })
    .toBe(managedAlpha.id)

  picker = await openMediaFromToolbar(page, "Upload image…")

  const raceMenu = picker.dialog.getByRole("button", {
    name: `More actions for ${managedRace.name}`,
  })
  await raceMenu.focus()
  await raceMenu.click()
  await page.getByRole("menuitem", { name: "Remove from uploads" }).click()
  review = page.getByRole("alertdialog", {
    name: `Remove “${managedRace.name}”?`,
  })
  await review.getByRole("button", { name: "Remove image" }).click()
  await expect(
    page.getByRole("alertdialog", { name: "This image is still in use" })
  ).toContainText("1 published reference")
  expect(state.impactCalls.get(managedRace.id)).toBe(2)
  expect(state.deleteCalls).toEqual([])
})

test("an unreferenced upload archives successfully and workspace storage refreshes", async ({
  page,
}) => {
  const state = mediaApiState([managedDelete])
  await installMediaApi(page, state)
  await bootStudio(page)
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")
  await expect(dialog.locator("footer")).toContainText("1 files")
  const menu = dialog.getByRole("button", {
    name: `More actions for ${managedDelete.name}`,
  })
  await menu.click()
  await page.getByRole("menuitem", { name: "Remove from uploads" }).click()
  const review = page.getByRole("alertdialog", {
    name: `Remove “${managedDelete.name}”?`,
  })
  await expect(review).toContainText("archives the workspace upload")
  await review.getByRole("button", { name: "Hide from uploads" }).click()
  await expect(review).toBeHidden()
  await expect(
    dialog.getByText(managedDelete.name, { exact: true })
  ).toHaveCount(0)
  await expect(dialog.locator("footer")).toContainText("0 files")
  expect(state.deleteCalls).toEqual([managedDelete.id])
})

test("a large local inventory revokes preview URLs outside the observer margin and on close", async ({
  page,
}) => {
  await installMediaApi(page, mediaApiState())
  await bootStudio(page)
  await seedLocalAssets(
    page,
    Array.from({ length: 60 }, (_, index) => ({
      id: `local-inventory-${String(index).padStart(3, "0")}`,
      name: `Local inventory ${String(index).padStart(3, "0")}.png`,
      includeBlob: true,
      used: false,
    }))
  )
  const { dialog } = await openMediaFromToolbar(page, "Upload image…")

  await expect
    .poll(() =>
      page.evaluate(() => window.__mediaObjectUrlHarness?.created.length ?? 0)
    )
    .toBeGreaterThan(0)
  await dialog
    .locator('[data-local-asset-id="local-inventory-000"]')
    .scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      page.evaluate(() => window.__mediaObjectUrlHarness?.revoked.length ?? 0)
    )
    .toBeGreaterThan(0)

  await dialog.getByRole("button", { name: "Close media library" }).click()
  await expect(dialog).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const harness = window.__mediaObjectUrlHarness
        return harness
          ? harness.revoked.length >= harness.created.length
          : false
      })
    )
    .toBe(true)
})

for (const width of [320, 390]) {
  test(`compact ${width}px media surface contains controls, traps focus, closes with Escape, and restores its opener`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 })
    await installMediaApi(page, mediaApiState())
    await bootStudio(page)
    const { dialog, opener } = await openMediaFromToolbar(
      page,
      "Asset library…"
    )

    const dialogBounds = await dialog.boundingBox()
    expect(dialogBounds).not.toBeNull()
    expect(Math.round(dialogBounds!.x)).toBe(0)
    expect(Math.round(dialogBounds!.width)).toBe(width)
    expect(Math.round(dialogBounds!.height)).toBe(760)
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)

    for (const control of [
      dialog.getByRole("button", { name: "Close media library" }),
      dialog.getByRole("button", { name: "Upload images" }),
      dialog.getByRole("tab", { name: "Recent" }),
      dialog.getByRole("searchbox", { name: "Search media" }),
    ]) {
      const bounds = await control.boundingBox()
      expect(bounds).not.toBeNull()
      expect(Math.round(bounds!.height)).toBeGreaterThanOrEqual(44)
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    await expect(
      dialog.getByRole("searchbox", { name: "Search media" })
    ).not.toBeFocused()
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement)
      )
    ).toBe(true)
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press("Tab")
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement)
        )
      ).toBe(true)
    }

    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
}
