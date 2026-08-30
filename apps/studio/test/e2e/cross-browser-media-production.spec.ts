import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import type { BrowserContext, Page } from "@playwright/test"
import {
  assertValidDocument,
  assetReferenceKeysForSource,
  northstarSeed,
} from "@webmcp/document"
import type { Document as StudioDocument, SceneNode } from "@webmcp/document"

test.describe.configure({ timeout: 240_000 })

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001"
const currentDraftStorageKey = "webmcp-studio:current-draft:v1"
const documentDatabaseName = "webmcp-studio-documents"
const documentBodyStore = "draft-body"
const documentMetadataStore = "draft-meta"
const localAssetDatabaseName = "webmcp-studio-assets"
const localAssetDatabaseVersion = 6
const localAssetMetadataStore = "asset-metadata"
const localAssetBlobStore = "asset-blobs"
const localAssetQuarantineStore = "asset-quarantine"
const localAssetPromotionJournalStore = "asset-promotion-journal"
const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

type TestWebMcpResult = {
  structuredContent?: unknown
  isError?: boolean
}

type TestWebMcpTool = {
  name: string
  execute: (
    input: unknown,
    execution?: { signal: AbortSignal }
  ) => TestWebMcpResult | Promise<TestWebMcpResult>
}

type DraftState = {
  document: StudioDocument | null
  recordVersion: number | null
  contentSnapshotId: string | null
}

type RequestCounts = {
  promotionUploads: number
  promotionLookups: number
  promotionResolutions: number
  managedUseWrites: number
}

type SafeNetworkRecord = {
  method: string
  path: string
  status: number
  requestId: string | null
}

declare global {
  interface Window {
    __crossBrowserMediaTools?: Map<string, TestWebMcpTool>
  }
}

const imageNode = (
  id: string,
  name: string,
  source: string,
  y: number
): Extract<SceneNode, { type: "image" }> => ({
  id,
  type: "image",
  name,
  assetId: source.replace(/^asset:(?:local|managed)\//, ""),
  src: source,
  alt: `${name} proof image`,
  altProvenance: "authored",
  placement: {
    mode: "fit",
    focalX: 0.5,
    focalY: 0.5,
    zoom: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  frameMask: { shape: "rounded_rectangle", radius: 0.08 },
  decorative: false,
  x: 820,
  y,
  width: 220,
  height: 160,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
})

function crossBrowserFixture(documentId: string, localAssetId: string) {
  const localSource = `asset:local/${localAssetId}`
  const base = structuredClone(northstarSeed)
  const cover = base.pages.find((page) => page.id === "cover")
  if (!cover) throw new Error("Northstar fixture is missing its cover page")
  const directNode = imageNode(
    "cross-browser-direct-image",
    "Direct device image",
    localSource,
    980
  )
  const defaultBoundNode = imageNode(
    "cross-browser-default-bound-image",
    "Default-bound device image",
    localSource,
    1160
  )
  const currentBoundNode = imageNode(
    "cross-browser-current-bound-image",
    "Current-bound device image",
    localSource,
    1340
  )

  return assertValidDocument({
    ...base,
    id: documentId,
    name: "Cross-browser media proof",
    revision: 0,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    pages: base.pages.map((page) =>
      page.id === cover.id
        ? {
            ...page,
            nodeIds: [
              ...page.nodeIds,
              directNode.id,
              defaultBoundNode.id,
              currentBoundNode.id,
            ],
          }
        : page
    ),
    nodes: [...base.nodes, directNode, defaultBoundNode, currentBoundNode],
    fields: [
      ...base.fields,
      {
        id: "cross-browser-default-field",
        key: "cross_browser_default_image",
        label: "Default proof image",
        type: "asset",
        required: true,
        defaultValue: localSource,
        agentDescription: "A device image retained as a field default.",
        validation: {},
      },
      {
        id: "cross-browser-current-field",
        key: "cross_browser_current_image",
        label: "Current proof image",
        type: "asset",
        required: false,
        defaultValue: "",
        agentDescription: "A device image retained as a current field value.",
        validation: {},
      },
    ],
    fieldValues: {
      ...base.fieldValues,
      "cross-browser-default-field": localSource,
      "cross-browser-current-field": localSource,
    },
    bindings: [
      ...base.bindings,
      {
        id: "cross-browser-default-binding",
        fieldId: "cross-browser-default-field",
        nodeId: defaultBoundNode.id,
        property: "src",
      },
      {
        id: "cross-browser-current-binding",
        fieldId: "cross-browser-current-field",
        nodeId: currentBoundNode.id,
        property: "src",
      },
    ],
  })
}

async function installDocumentBootstrap(
  context: BrowserContext,
  documentValue: StudioDocument
) {
  await context.addInitScript(
    ({ draftKey, fixture }) => {
      if (!sessionStorage.getItem("cross-browser-media-e2e-initialized")) {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            schemaVersion: 1,
            document: fixture,
            sourceContext: null,
          })
        )
        sessionStorage.clear()
        sessionStorage.setItem("cross-browser-media-e2e-initialized", "true")
      }

      const tools = new Map<string, TestWebMcpTool>()
      window.__crossBrowserMediaTools = tools
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
    },
    { draftKey: currentDraftStorageKey, fixture: documentValue }
  )
}

async function openOriginPage(page: Page) {
  const response = await page.goto(`${baseURL}/v1/studio/assets`)
  expect(response?.ok()).toBe(true)
}

async function shareLocalWorkspaceSession(
  source: BrowserContext,
  target: BrowserContext
) {
  const sessionCookies = (await source.cookies(baseURL)).filter(
    (cookie) => cookie.name === "webmcp_demo_session"
  )
  expect(sessionCookies).toHaveLength(1)
  await target.addCookies(sessionCookies)
}

async function seedNativeLocalAsset(
  page: Page,
  localAssetId: string,
  fileName: string
) {
  return page.evaluate(
    async ({ assetId, name, bytesBase64, databaseVersion }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("webmcp-studio-assets", databaseVersion)
        request.onupgradeneeded = () => {
          const upgradeDatabase = request.result
          const metadata = upgradeDatabase.objectStoreNames.contains(
            "asset-metadata"
          )
            ? request.transaction!.objectStore("asset-metadata")
            : upgradeDatabase.createObjectStore("asset-metadata", {
                keyPath: "id",
              })
          if (!metadata.indexNames.contains("createdAt")) {
            metadata.createIndex("createdAt", "createdAt")
          }
          if (!metadata.indexNames.contains("lastUsedAt")) {
            metadata.createIndex("lastUsedAt", "lastUsedAt")
          }
          if (!upgradeDatabase.objectStoreNames.contains("asset-blobs")) {
            upgradeDatabase.createObjectStore("asset-blobs")
          }
          if (!upgradeDatabase.objectStoreNames.contains("asset-quarantine")) {
            upgradeDatabase.createObjectStore("asset-quarantine", {
              keyPath: "id",
            })
          }
          if (
            !upgradeDatabase.objectStoreNames.contains(
              "asset-promotion-journal"
            )
          ) {
            upgradeDatabase.createObjectStore("asset-promotion-journal", {
              keyPath: "localAssetId",
            })
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(
            request.error ?? new Error("Local asset database did not open")
          )
      })
      const binary = atob(bytesBase64)
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0)
      )
      const now = "2026-08-30T00:00:00.000Z"
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          ["asset-metadata", "asset-blobs"],
          "readwrite"
        )
        transaction.objectStore("asset-metadata").put({
          schemaVersion: 4,
          id: assetId,
          name,
          mediaType: "image/png",
          size: bytes.byteLength,
          width: 1,
          height: 1,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: now,
          archivedAt: null,
          revision: 1,
          integrity: "ready",
        })
        transaction
          .objectStore("asset-blobs")
          .put(new Blob([bytes], { type: "image/png" }), assetId)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Local asset seed failed"))
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Local asset seed aborted"))
      })
      const counts = await Promise.all(
        [
          "asset-metadata",
          "asset-blobs",
          "asset-quarantine",
          "asset-promotion-journal",
        ].map(
          (storeName) =>
            new Promise<number>((resolve, reject) => {
              const request = database
                .transaction(storeName)
                .objectStore(storeName)
                .count()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            })
        )
      )
      database.close()
      return counts
    },
    {
      assetId: localAssetId,
      name: fileName,
      bytesBase64: onePixelPng,
      databaseVersion: localAssetDatabaseVersion,
    }
  )
}

async function inspectLocalAssetRepository(page: Page) {
  return page.evaluate(
    async ({ databaseName, stores }) => {
      const databases = await indexedDB.databases()
      if (!databases.some((database) => database.name === databaseName)) {
        return [0, 0, 0, 0]
      }
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const counts = await Promise.all(
        stores.map(
          (storeName) =>
            new Promise<number>((resolve, reject) => {
              if (!database.objectStoreNames.contains(storeName)) {
                resolve(0)
                return
              }
              const request = database
                .transaction(storeName)
                .objectStore(storeName)
                .count()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            })
        )
      )
      database.close()
      return counts
    },
    {
      databaseName: localAssetDatabaseName,
      stores: [
        localAssetMetadataStore,
        localAssetBlobStore,
        localAssetQuarantineStore,
        localAssetPromotionJournalStore,
      ],
    }
  )
}

async function readDraftState(page: Page, documentId: string) {
  return page.evaluate(
    async ({ databaseName, bodyStore, metadataStore, id }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const transaction = database.transaction([bodyStore, metadataStore])
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      const [body, metadata] = await Promise.all([
        read<{ document?: StudioDocument } | undefined>(
          transaction.objectStore(bodyStore).get(id)
        ),
        read<
          | {
              recordVersion?: number
              contentSnapshotId?: string
            }
          | undefined
        >(transaction.objectStore(metadataStore).get(id)),
      ])
      database.close()
      return {
        document: body?.document ?? null,
        recordVersion: metadata?.recordVersion ?? null,
        contentSnapshotId: metadata?.contentSnapshotId ?? null,
      } satisfies DraftState
    },
    {
      databaseName: documentDatabaseName,
      bodyStore: documentBodyStore,
      metadataStore: documentMetadataStore,
      id: documentId,
    }
  )
}

async function bootDocument(page: Page, documentId: string) {
  await page.goto(`${baseURL}/documents/${encodeURIComponent(documentId)}`)
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 30_000,
  })
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(window.__crossBrowserMediaTools?.has("inspect_design"))
      )
    )
    .toBe(true)
}

async function executeToolRaw(page: Page, name: string, input: unknown) {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = window.__crossBrowserMediaTools?.get(toolName)
      if (!tool) throw new Error(`Missing WebMCP tool ${toolName}`)
      return tool.execute(toolInput, { signal: new AbortController().signal })
    },
    { toolName: name, toolInput: input }
  )
}

async function executeTool(page: Page, name: string, input: unknown) {
  const result = await executeToolRaw(page, name, input)
  expect(result.isError, JSON.stringify(result)).not.toBe(true)
  return result
}

function observeMediaRequests(page: Page, safeNetwork: SafeNetworkRecord[]) {
  const counts: RequestCounts = {
    promotionUploads: 0,
    promotionLookups: 0,
    promotionResolutions: 0,
    managedUseWrites: 0,
  }
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (
      request.method() === "POST" &&
      path === "/v1/studio/assets/local-promotions"
    ) {
      counts.promotionUploads += 1
    } else if (
      request.method() === "POST" &&
      path === "/v1/studio/assets/local-promotions/resolve"
    ) {
      counts.promotionResolutions += 1
    } else if (
      request.method() === "GET" &&
      path.startsWith("/v1/studio/assets/local-promotions/")
    ) {
      counts.promotionLookups += 1
    } else if (
      request.method() === "POST" &&
      /^\/v1\/studio\/assets\/[^/]+\/used$/.test(path)
    ) {
      counts.managedUseWrites += 1
    }
  })
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (
      !url.pathname.startsWith("/v1/studio/") &&
      !url.pathname.startsWith("/v1/renders/")
    ) {
      return
    }
    safeNetwork.push({
      method: response.request().method(),
      path: url.pathname
        .replace(
          /^(\/v1\/studio\/assets\/local-promotions\/)(?!resolve$)[^/]+$/,
          "$1:localAssetAlias"
        )
        .replace(
          /^(\/v1\/studio\/assets\/)[^/]+(\/content|\/used)?$/,
          "$1:managedAssetId$2"
        )
        .replace(
          /^(\/v1\/renders\/)[^/]+(\/outputs\/)[^/]+$/,
          "$1:renderId$2:artifactId"
        )
        .replace(/^(\/v1\/renders\/)[^/]+$/, "$1:renderId"),
      status: response.status(),
      requestId: response.headers()["x-request-id"] ?? null,
    })
  })
  return counts
}

const evidenceRoot = fileURLToPath(
  new URL(
    "../../../../docs/audits/2026-08-27-editor-production-readiness/artifacts/cross-browser-media/local/",
    import.meta.url
  )
)

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

function assertSafeEvidence(value: unknown) {
  const serialized = JSON.stringify(value)
  const forbidden: Array<[string, RegExp]> = [
    ["local asset alias", /asset:local\//i],
    ["authorization value", /authorization|cf-access-jwt-assertion/i],
    ["cookie value", /cookie|webmcp_demo_session/i],
    ["data URI", /data:image\//i],
    ["object URL", /blob:/i],
    ["signed URL", /(?:x-amz-|x-goog-|signature=|token=)/i],
    ["private R2 key", /media\/workspaces\//i],
  ]
  for (const [label, pattern] of forbidden) {
    if (pattern.test(serialized)) {
      throw new Error(`Cross-browser evidence contains a ${label}`)
    }
  }
}

async function writeLocalEvidence(input: {
  runId: string
  browserVersion: string
  viewport: { width: number; height: number }
  screenshots: { contextA: Buffer; contextB: Buffer }
  exports: { png: Buffer; pdf: Buffer }
  safeNetwork: SafeNetworkRecord[]
}) {
  if (
    input.safeNetwork.some((record) =>
      /^\/v1\/studio\/assets\/local-promotions\/(?!resolve$|:localAssetAlias$)[^/]+$/.test(
        record.path
      )
    )
  ) {
    throw new Error(
      "Cross-browser evidence contains a raw local-promotion path identity"
    )
  }
  const runDirectory = `${new Date().toISOString()}-${input.runId}`
  const outputDirectory = `${evidenceRoot}${runDirectory}`
  const files = [
    ["context-a.png", input.screenshots.contextA],
    ["context-b.png", input.screenshots.contextB],
    ["foreground-page.png", input.exports.png],
    ["foreground-document.pdf", input.exports.pdf],
  ] as const
  const report = {
    schemaVersion: 1,
    runId: runDirectory,
    environment: "local",
    browser: { name: "chromium", version: input.browserVersion },
    viewport: input.viewport,
    assertions: [
      "separate native IndexedDB contexts",
      "single visible promotion and managed-use receipt",
      "atomic six-reference relink with undo and redo",
      "mapping admission without local bytes",
      "durable reload without repeated migration",
      "foreground PNG and five-page PDF",
      "immutable publication",
      "idempotent durable render and WebMCP history recovery",
    ],
    network: input.safeNetwork,
  }
  assertSafeEvidence(report)
  await mkdir(outputDirectory, { recursive: true })
  const artifacts = []
  for (const [name, bytes] of files) {
    await writeFile(`${outputDirectory}/${name}`, bytes)
    artifacts.push({
      path: name,
      bytes: bytes.byteLength,
      sha256: digest(bytes),
    })
  }
  const assertionBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
  await writeFile(`${outputDirectory}/assertions.json`, assertionBytes)
  artifacts.push({
    path: "assertions.json",
    bytes: assertionBytes.byteLength,
    sha256: digest(assertionBytes),
  })
  const manifest = {
    schemaVersion: 1,
    runId: runDirectory,
    browser: report.browser,
    viewport: report.viewport,
    requestIds: [
      ...new Set(input.safeNetwork.flatMap((item) => item.requestId ?? [])),
    ],
    artifacts,
  }
  assertSafeEvidence({
    ...manifest,
    artifacts: artifacts.map(({ path, bytes }) => ({ path, bytes })),
  })
  await writeFile(
    `${outputDirectory}/manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`
  )
}

async function openUploads(page: Page) {
  await page.getByRole("button", { name: "Insert shape" }).click()
  await page.getByRole("menuitem", { name: "Upload image…" }).click()
  const dialog = page.getByRole("dialog", { name: "Add image" })
  await expect(dialog).toBeVisible()
  return dialog
}

function sourceOccurrences(document: StudioDocument, source: string) {
  return assetReferenceKeysForSource(document, source).length
}

test("a second isolated browser admits one promoted device image without its local bytes", async ({
  browser,
}, testInfo) => {
  const runId = crypto.randomUUID()
  const localAssetId = `cross-browser-${runId}`
  const documentId = `document-cross-browser-${runId}`
  const fileName = "Cross-browser proof.png"
  const localSource = `asset:local/${localAssetId}`
  const fixture = crossBrowserFixture(documentId, localAssetId)
  expect(sourceOccurrences(fixture, localSource)).toBe(6)

  const contextA = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  })
  const contextB = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  })
  try {
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()
    const safeNetworkA: SafeNetworkRecord[] = []
    const safeNetworkB: SafeNetworkRecord[] = []
    const requestsA = observeMediaRequests(pageA, safeNetworkA)
    const requestsB = observeMediaRequests(pageB, safeNetworkB)

    await openOriginPage(pageA)
    await shareLocalWorkspaceSession(contextA, contextB)
    expect(await seedNativeLocalAsset(pageA, localAssetId, fileName)).toEqual([
      1, 1, 0, 0,
    ])
    await installDocumentBootstrap(contextA, fixture)
    await bootDocument(pageA, documentId)

    const beforePromotion = await readDraftState(pageA, documentId)
    expect(sourceOccurrences(beforePromotion.document!, localSource)).toBe(6)
    const mediaDialog = await openUploads(pageA)
    const localCard = mediaDialog.locator("[data-local-asset-id]", {
      hasText: fileName,
    })
    await expect(localCard).toBeVisible()
    await localCard.scrollIntoViewIfNeeded()
    const promotionButton = localCard.getByRole("button", {
      name: "Make available everywhere",
    })
    await expect(promotionButton).toBeVisible({ timeout: 10_000 })
    await expect(promotionButton).toBeEnabled()
    await promotionButton.click({ timeout: 10_000 })
    await expect(localCard.getByRole("status")).toContainText(
      "Available everywhere",
      { timeout: 45_000 }
    )
    await mediaDialog
      .getByRole("button", { name: "Close media library" })
      .click()

    await expect
      .poll(async () => readDraftState(pageA, documentId))
      .toMatchObject({
        document: expect.objectContaining({ id: documentId }),
        recordVersion: expect.any(Number),
        contentSnapshotId: expect.any(String),
      })
    const promotedDraft = await readDraftState(pageA, documentId)
    expect(JSON.stringify(promotedDraft.document)).not.toContain(localSource)
    expect(requestsA.promotionUploads).toBe(1)
    expect(requestsA.managedUseWrites).toBe(1)

    const mapping = await pageA.evaluate(async (assetId) => {
      const response = await fetch(
        `/v1/studio/assets/local-promotions/${encodeURIComponent(assetId)}`,
        { cache: "no-store" }
      )
      const body: {
        promotion?: { asset?: { id?: string } } | null
      } = await response.json()
      return {
        ok: response.ok,
        requestId: response.headers.get("x-request-id"),
        body,
      }
    }, localAssetId)
    expect(mapping.ok).toBe(true)
    expect(mapping.requestId).toBeTruthy()
    const managedAssetId = mapping.body.promotion?.asset?.id
    expect(managedAssetId).toBeTruthy()
    const managedSource = `asset:managed/${managedAssetId}`
    expect(sourceOccurrences(promotedDraft.document!, managedSource)).toBe(6)

    await pageA.getByRole("button", { name: "Undo" }).click()
    await expect
      .poll(async () =>
        sourceOccurrences(
          (await readDraftState(pageA, documentId)).document!,
          localSource
        )
      )
      .toBe(6)
    await pageA.getByRole("button", { name: "Redo" }).click()
    await expect
      .poll(async () =>
        sourceOccurrences(
          (await readDraftState(pageA, documentId)).document!,
          managedSource
        )
      )
      .toBe(6)
    expect(requestsA.promotionUploads).toBe(1)
    expect(requestsA.managedUseWrites).toBe(1)

    await openOriginPage(pageB)
    expect(await inspectLocalAssetRepository(pageB)).toEqual([0, 0, 0, 0])
    await installDocumentBootstrap(contextB, fixture)
    await bootDocument(pageB, documentId)

    await expect
      .poll(async () => {
        const state = await readDraftState(pageB, documentId)
        return state.document
          ? sourceOccurrences(state.document, managedSource)
          : 0
      })
      .toBe(6)
    await expect(pageB.getByText(/Recovered 1 Studio image/)).toBeVisible()
    await pageB.getByRole("button", { name: "Keep recovered images" }).click()
    await expect(
      pageB.getByRole("button", { name: "Keep recovered images" })
    ).toHaveCount(0)
    const admittedDraft = await readDraftState(pageB, documentId)
    expect(JSON.stringify(admittedDraft.document)).not.toContain(localSource)
    expect(await inspectLocalAssetRepository(pageB)).toEqual([0, 0, 0, 0])
    expect(requestsB.promotionUploads).toBe(0)
    expect(requestsB.promotionResolutions).toBe(1)
    expect(requestsB.managedUseWrites).toBe(1)

    const beforeReloadCounts = { ...requestsB }
    const beforeReloadSnapshot = admittedDraft.contentSnapshotId
    await pageB.reload()
    await expect(pageB.locator("canvas.upper-canvas")).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(() =>
        pageB.evaluate(() =>
          Boolean(window.__crossBrowserMediaTools?.has("inspect_design"))
        )
      )
      .toBe(true)
    const reloadedDraft = await readDraftState(pageB, documentId)
    expect(reloadedDraft.contentSnapshotId).toBe(beforeReloadSnapshot)
    expect(sourceOccurrences(reloadedDraft.document!, managedSource)).toBe(6)
    expect(requestsB).toEqual(beforeReloadCounts)

    const [pngDownload] = await Promise.all([
      pageB.waitForEvent("download"),
      (async () => {
        await pageB.getByRole("button", { name: "Export output" }).click()
        await pageB
          .getByRole("menuitem", { name: "Export current page as PNG" })
          .click()
      })(),
    ])
    const pngPath = testInfo.outputPath("cross-browser-page.png")
    await pngDownload.saveAs(pngPath)
    expect((await readFile(pngPath)).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )

    const [pdfDownload] = await Promise.all([
      pageB.waitForEvent("download"),
      (async () => {
        await pageB.getByRole("button", { name: "Export output" }).click()
        await pageB.getByRole("menuitem", { name: /5-page PDF/ }).click()
      })(),
    ])
    const pdfPath = testInfo.outputPath("cross-browser-output.pdf")
    await pdfDownload.saveAs(pdfPath)
    expect((await readFile(pdfPath)).subarray(0, 5).toString("ascii")).toBe(
      "%PDF-"
    )

    const inspection = await executeTool(pageB, "inspect_design", {})
    const inspected = inspection.structuredContent as {
      document: { id: string; revision: number; snapshotId: string }
    }
    const publishResponsePromise = pageB.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/studio/templates/"
    )
    const [published, publishResponse] = await Promise.all([
      executeToolRaw(pageB, "publish_template", {
        documentId: inspected.document.id,
        expectedRevision: inspected.document.revision,
        expectedSnapshotId: inspected.document.snapshotId,
      }),
      publishResponsePromise,
    ])
    const publishPayload = await publishResponse.json()
    expect(
      published.isError,
      JSON.stringify({ tool: published, response: publishPayload })
    ).not.toBe(true)
    const version = published.structuredContent as {
      templateId: string
      version: number
      manifest: { outputs: Array<{ id: string; formats: string[] }> }
    }
    expect(version.templateId).toBeTruthy()
    expect(version.version).toBe(1)

    const renderInput = {
      templateId: version.templateId,
      version: version.version,
      modifications: {},
      outputs: [
        { outputId: "proposal", format: "pdf" },
        { outputId: "whatsapp", format: "png" },
      ],
      idempotencyKey: `cross-browser-render-${runId}`,
    }
    let rendered = await executeToolRaw(pageB, "render_template", renderInput)
    if (rendered.isError) {
      expect(rendered.structuredContent).toMatchObject({
        status: "status_unknown",
      })
      await expect
        .poll(
          () =>
            pageB.evaluate(async (templateId) => {
              const response = await fetch("/v1/studio/renders/?limit=30")
              if (!response.ok) return []
              const payload: {
                data?: Array<{
                  templateId: string
                  status: string
                  artifacts: unknown[]
                }>
              } = await response.json()
              return (payload.data ?? [])
                .filter((record) => record.templateId === templateId)
                .map((record) => ({
                  status: record.status,
                  artifactCount: record.artifacts.length,
                }))
            }, version.templateId),
          { timeout: 30_000 }
        )
        .toEqual([{ status: "completed", artifactCount: 2 }])
      await bootDocument(pageB, documentId)
      const replay = await executeToolRaw(pageB, "render_template", renderInput)
      if (replay.isError) {
        expect(replay.structuredContent).toMatchObject({
          status: "status_unknown",
        })
      } else {
        expect(JSON.stringify(replay.structuredContent)).toContain("completed")
      }
      await expect
        .poll(() =>
          pageB.evaluate(async (templateId) => {
            const response = await fetch("/v1/studio/renders/?limit=30")
            const payload: {
              data?: Array<{ templateId: string; status: string }>
            } = await response.json()
            return (payload.data ?? []).filter(
              (record) => record.templateId === templateId
            )
          }, version.templateId)
        )
        .toHaveLength(1)
      await bootDocument(pageB, documentId)
      await expect
        .poll(async () => {
          const history = await executeToolRaw(
            pageB,
            "inspect_render_history",
            {
              templateId: version.templateId,
              status: "completed",
              limit: 30,
            }
          )
          return JSON.stringify(history.structuredContent)
        })
        .toContain('"status":"completed"')
      rendered = await executeTool(pageB, "inspect_render_history", {
        templateId: version.templateId,
        status: "completed",
        limit: 30,
      })
    }
    expect(JSON.stringify(rendered.structuredContent)).toContain("completed")

    const contextAScreenshot = await pageA.screenshot({ fullPage: true })
    const contextBScreenshot = await pageB.screenshot({ fullPage: true })
    await testInfo.attach("cross-browser-context-a", {
      body: contextAScreenshot,
      contentType: "image/png",
    })
    await testInfo.attach("cross-browser-context-b", {
      body: contextBScreenshot,
      contentType: "image/png",
    })
    if (process.env.CROSS_BROWSER_MEDIA_EVIDENCE === "1") {
      await writeLocalEvidence({
        runId,
        browserVersion: browser.version(),
        viewport: { width: 1440, height: 900 },
        screenshots: {
          contextA: contextAScreenshot,
          contextB: contextBScreenshot,
        },
        exports: {
          png: await readFile(pngPath),
          pdf: await readFile(pdfPath),
        },
        safeNetwork: [...safeNetworkA, ...safeNetworkB],
      })
    }
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})
