#!/usr/bin/env bun

import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createPageThumbnailRevision,
  inspectRasterBytes,
} from "@webmcp/document"
import {
  pageThumbnailRasterRetryDelay,
  produceStudioPageThumbnailRaster,
  studioPageThumbnailRendererRevision,
} from "../src/features/editor/page-thumbnail-raster-producer"
import {
  STUDIO_TEMPLATE_PREVIEW_CONCURRENCY,
  assertStudioTemplatePreviewManifestCoverage,
  listStudioTemplatePreviewSpecifications,
  parseStudioTemplatePreviewManifest,
  type StudioTemplatePreviewManifest,
} from "../src/content/library/templates/preview-manifest"

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
)
const publicRoot = join(repositoryRoot, "apps/studio/public")
const previewRoot = join(publicRoot, "library/previews/templates")
const generationsRoot = join(previewRoot, "generations")
const manifestPath = join(previewRoot, "manifest.json")
const generationLockPath = join(previewRoot, ".generation-lock")
const baseUrl = (
  process.env.LIBRARY_PREVIEW_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "")
const endpoint = `${baseUrl}/v1/studio/page-thumbnail`
const command = process.argv[2] ?? "generate"

if (command === "generate") await withGenerationLock(generate)
else if (command === "verify") await verifyPublishedManifest()
else {
  throw new Error(`Unknown command ${command}. Use "generate" or "verify".`)
}

type RenderedPreview = Readonly<{
  key: string
  itemId: string
  itemVersion: number
  pageId: string
  width: number
  height: number
  bytes: Uint8Array
  contentSha256: string
}>

async function generate() {
  const specifications = listStudioTemplatePreviewSpecifications()
  assert(specifications.length > 0, "No active templates require previews")
  const fetcher = await authenticatedFetcher()
  const rendered = await mapWithConcurrency(
    specifications,
    STUDIO_TEMPLATE_PREVIEW_CONCURRENCY,
    async (specification) => {
      const document = specification.template.previewDocument
      const pageRevision = createPageThumbnailRevision(
        document,
        specification.pageId
      )
      const blob = await renderWithRetry(() =>
        produceStudioPageThumbnailRaster({
          key: {
            documentId: document.id,
            documentRevision: document.revision,
            documentSnapshotId: specification.key,
            pageId: specification.pageId,
            pageRevision,
            rendererRevision: studioPageThumbnailRendererRevision,
            pixelWidth: specification.width,
            pixelHeight: specification.height,
          },
          snapshot: { document, snapshotId: specification.key },
          signal: AbortSignal.timeout(60_000),
          fetcher,
          endpoint,
        })
      )
      const bytes = new Uint8Array(await blob.arrayBuffer())
      assertPng(bytes, specification.width, specification.height)
      const contentSha256 = sha256(bytes)
      process.stdout.write(`rendered ${specification.key}\n`)
      return {
        key: specification.key,
        itemId: specification.template.id,
        itemVersion: specification.template.version,
        pageId: specification.pageId,
        width: specification.width,
        height: specification.height,
        bytes,
        contentSha256,
      }
    }
  )

  const generation = sha256(
    new TextEncoder().encode(
      JSON.stringify(rendered.map(({ bytes: _bytes, ...identity }) => identity))
    )
  )
  const manifest = parseStudioTemplatePreviewManifest({
    schemaVersion: 1,
    generation,
    rendererRevision: studioPageThumbnailRendererRevision,
    entries: rendered.map((preview) => ({
      key: preview.key,
      preview: {
        kind: "raster",
        itemId: preview.itemId,
        itemVersion: preview.itemVersion,
        pageId: preview.pageId,
        width: preview.width,
        height: preview.height,
        resourcePath: resourcePathFor(generation, preview),
        mediaType: "image/png",
        contentSha256: preview.contentSha256,
        rendererRevision: studioPageThumbnailRendererRevision,
      },
    })),
  })
  assertStudioTemplatePreviewManifestCoverage(manifest, specifications)

  await mkdir(previewRoot, { recursive: true })
  await mkdir(generationsRoot, { recursive: true })
  const stagingRoot = await mkdtemp(join(previewRoot, ".generate-"))
  const stagingGenerationRoot = join(stagingRoot, generation)
  const temporaryManifestPath = join(
    previewRoot,
    `.manifest-${randomUUID()}.json`
  )
  let publishedGeneration = false
  let publishedManifest = false
  try {
    for (const preview of rendered) {
      const target = join(
        stagingGenerationRoot,
        preview.itemId,
        `v${preview.itemVersion}`,
        fileNameFor(preview)
      )
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, preview.bytes)
    }
    await verifyManifestFiles(manifest, (resourcePath) =>
      join(
        stagingGenerationRoot,
        relative(
          `/library/previews/templates/generations/${generation}`,
          resourcePath
        )
      )
    )

    const finalGenerationRoot = join(generationsRoot, generation)
    if (await pathExists(finalGenerationRoot)) {
      await verifyManifestFiles(manifest, publicPathFor)
    } else {
      await rename(stagingGenerationRoot, finalGenerationRoot)
      publishedGeneration = true
    }

    await writeFile(
      temporaryManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    )
    await rename(temporaryManifestPath, manifestPath)
    publishedManifest = true
    await verifyPublishedManifest()
    process.stdout.write(
      `published ${manifest.entries.length} previews in generation ${generation}\n`
    )
  } catch (error) {
    if (publishedGeneration && !publishedManifest) {
      await rm(join(generationsRoot, generation), {
        recursive: true,
        force: true,
      })
    }
    throw error
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
    await rm(temporaryManifestPath, { force: true })
  }
}

async function withGenerationLock(run: () => Promise<void>) {
  await mkdir(previewRoot, { recursive: true })
  try {
    await mkdir(generationLockPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Another template preview generation is already running.")
    }
    throw error
  }
  try {
    await run()
  } finally {
    await rm(generationLockPath, { recursive: true, force: true })
  }
}

async function verifyPublishedManifest() {
  const manifest = parseStudioTemplatePreviewManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown
  )
  assertStudioTemplatePreviewManifestCoverage(manifest)
  await verifyManifestFiles(manifest, publicPathFor)
  const expected = new Set(
    manifest.entries.map(({ preview }) => preview.resourcePath!)
  )
  const currentGenerationRoot = join(generationsRoot, manifest.generation)
  const actual = new Set(
    (await listFiles(currentGenerationRoot))
      .filter((path) => path.endsWith(".png"))
      .map((path) => `/${relative(publicRoot, path)}`)
  )
  const missing = [...expected].filter((path) => !actual.has(path))
  const extra = [...actual].filter((path) => !expected.has(path))
  if (missing.length || extra.length) {
    throw new Error(
      `Template preview files do not match the manifest. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`
    )
  }
  process.stdout.write(
    `verified ${manifest.entries.length} template previews for ${manifest.generation}\n`
  )
}

async function verifyManifestFiles(
  manifest: StudioTemplatePreviewManifest,
  resolvePath: (resourcePath: string) => string
) {
  for (const { key, preview } of manifest.entries) {
    assert(preview.resourcePath, `${key} has no resource path`)
    assert(preview.contentSha256, `${key} has no content hash`)
    assert.equal(preview.mediaType, "image/png", `${key} has wrong MIME type`)
    assert.equal(
      preview.rendererRevision,
      studioPageThumbnailRendererRevision,
      `${key} has a stale renderer revision`
    )
    const file = await readFile(resolvePath(preview.resourcePath))
    assert.equal(
      sha256(file),
      preview.contentSha256,
      `${key} PNG checksum does not match its manifest`
    )
    assertPng(file, preview.width, preview.height)
  }
}

async function authenticatedFetcher(): Promise<typeof fetch> {
  let cookie = process.env.LIBRARY_PREVIEW_COOKIE?.trim() ?? ""
  if (
    !cookie &&
    ["localhost", "127.0.0.1", "::1"].includes(new URL(baseUrl).hostname)
  ) {
    const bootstrap = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
    await bootstrap.body?.cancel().catch(() => undefined)
  }
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (cookie) headers.set("Cookie", cookie)
    return fetch(input, { ...init, headers })
  }) as typeof fetch
}

async function renderWithRetry(render: () => Promise<Blob>) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await render()
    } catch (error) {
      const delay = pageThumbnailRasterRetryDelay(error, attempt)
      if (delay === null) throw error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay))
    }
  }
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  map: (value: Input) => Promise<Output>
): Promise<Output[]> {
  assert(concurrency >= 1, "Concurrency must be positive")
  const results = new Array<Output>(values.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await map(values[index]!)
      }
    }
  )
  await Promise.all(workers)
  return results
}

function resourcePathFor(generation: string, preview: RenderedPreview) {
  return `/library/previews/templates/generations/${generation}/${preview.itemId}/v${preview.itemVersion}/${fileNameFor(preview)}`
}

function fileNameFor(preview: RenderedPreview) {
  return `${preview.pageId}.${preview.contentSha256.slice(0, 16)}.png`
}

function publicPathFor(resourcePath: string) {
  return join(publicRoot, resourcePath.slice(1))
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function assertPng(bytes: Uint8Array, width: number, height: number) {
  const dimensions = inspectRasterBytes("image/png", bytes)
  assert.equal(dimensions.width, width, "PNG width does not match manifest")
  assert.equal(dimensions.height, height, "PNG height does not match manifest")
}

async function listFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return []
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}
