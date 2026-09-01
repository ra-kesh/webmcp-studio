import {
  builtInDesignTemplateRepository,
  fitPageThumbnailSize,
  libraryPreviewDescriptorSchema,
} from "@webmcp/document"
import type {
  DesignTemplateCatalogItem,
  LibraryPreviewDescriptor,
} from "@webmcp/document"
import { z } from "zod"
import { studioPageThumbnailRendererRevision } from "../../../features/editor/page-thumbnail-raster-producer"
import publishedManifestJson from "./published-preview-manifest.json"

export const STUDIO_TEMPLATE_PREVIEW_MAX_WIDTH = 320
export const STUDIO_TEMPLATE_PREVIEW_MAX_HEIGHT = 240
export const STUDIO_TEMPLATE_PREVIEW_CONCURRENCY = 3

const sha256Pattern = /^[a-f0-9]{64}$/
const templatePreviewKeyPattern =
  /^template:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}@[1-9][0-9]*$/
const templatePreviewResourcePattern =
  /^\/library\/previews\/templates\/generations\/[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}\/v[1-9][0-9]*\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}\.[a-f0-9]{16}\.png$/

const studioTemplatePreviewEntrySchema = z
  .object({
    key: z.string().regex(templatePreviewKeyPattern),
    preview: libraryPreviewDescriptorSchema,
  })
  .strict()
  .superRefine(({ key, preview }, context) => {
    if (preview.kind !== "raster") {
      context.addIssue({
        code: "custom",
        path: ["preview", "kind"],
        message: "Published template previews must be immutable rasters",
      })
      return
    }
    if (key !== templatePreviewKey(preview.itemId, preview.itemVersion)) {
      context.addIssue({
        code: "custom",
        path: ["key"],
        message: "Preview key must match its exact item identity",
      })
    }
    if (
      !preview.resourcePath ||
      !templatePreviewResourcePattern.test(preview.resourcePath)
    ) {
      context.addIssue({
        code: "custom",
        path: ["preview", "resourcePath"],
        message: "Template preview path must contain its generation and hash",
      })
    }
  })

export const studioTemplatePreviewManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.string().regex(sha256Pattern),
    rendererRevision: z.string().min(1).max(200),
    entries: z.array(studioTemplatePreviewEntrySchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const keys = manifest.entries.map(({ key }) => key)
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "Template preview keys must be unique",
      })
    }
    const resourcePaths = manifest.entries.map(
      ({ preview }) => preview.resourcePath
    )
    if (new Set(resourcePaths).size !== resourcePaths.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "Template preview resources must be unique",
      })
    }
    for (const [index, { preview }] of manifest.entries.entries()) {
      if (preview.rendererRevision !== manifest.rendererRevision) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "preview", "rendererRevision"],
          message: "Entry renderer revision must match its manifest",
        })
      }
      if (
        preview.resourcePath &&
        !preview.resourcePath.includes(`/generations/${manifest.generation}/`)
      ) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "preview", "resourcePath"],
          message: "Entry resource must belong to the manifest generation",
        })
      }
    }
  })

export type StudioTemplatePreviewManifest = z.infer<
  typeof studioTemplatePreviewManifestSchema
>

export type StudioTemplatePreviewSpecification = Readonly<{
  key: string
  template: DesignTemplateCatalogItem
  pageId: string
  width: number
  height: number
}>

export function templatePreviewKey(id: string, version: number) {
  return `template:${id}@${version}`
}

export function listStudioTemplatePreviewSpecifications(): readonly StudioTemplatePreviewSpecification[] {
  return builtInDesignTemplateRepository
    .list()
    .map((template) => {
      const page = template.previewDocument.pages.find(
        (candidate) => candidate.id === template.previewPageId
      )
      if (!page) {
        throw new Error(
          `Template ${template.id}@${template.version} has no exact preview page ${template.previewPageId}`
        )
      }
      const size = fitPageThumbnailSize(page, {
        maxWidth: STUDIO_TEMPLATE_PREVIEW_MAX_WIDTH,
        maxHeight: STUDIO_TEMPLATE_PREVIEW_MAX_HEIGHT,
      })
      return Object.freeze({
        key: templatePreviewKey(template.id, template.version),
        template,
        pageId: page.id,
        width: size.width,
        height: size.height,
      })
    })
    .sort((left, right) => left.key.localeCompare(right.key))
}

export function parseStudioTemplatePreviewManifest(
  input: unknown
): StudioTemplatePreviewManifest {
  const manifest = studioTemplatePreviewManifestSchema.parse(input)
  return deepFreeze(manifest)
}

export const studioTemplatePreviewManifest = parseStudioTemplatePreviewManifest(
  publishedManifestJson
)

const previewByIdentity = new Map(
  studioTemplatePreviewManifest.entries.map(({ key, preview }) => [
    key,
    preview,
  ])
)

let publishedCoverageVerified = false

function ensurePublishedPreviewCoverage() {
  if (publishedCoverageVerified) return
  assertStudioTemplatePreviewManifestCoverage(studioTemplatePreviewManifest)
  publishedCoverageVerified = true
}

export function getStudioTemplatePreviewDescriptor(
  id: string,
  version: number
): LibraryPreviewDescriptor {
  ensurePublishedPreviewCoverage()
  const preview = previewByIdentity.get(templatePreviewKey(id, version))
  if (!preview) {
    throw new Error(`Missing published template preview for ${id}@${version}`)
  }
  return preview
}

export function assertStudioTemplatePreviewManifestCoverage(
  manifest: StudioTemplatePreviewManifest,
  specifications = listStudioTemplatePreviewSpecifications()
): void {
  if (manifest.rendererRevision !== studioPageThumbnailRendererRevision) {
    throw new Error(
      `Template preview renderer revision is stale: expected ${studioPageThumbnailRendererRevision}, received ${manifest.rendererRevision}`
    )
  }

  const expected = new Map(
    specifications.map((specification) => [specification.key, specification])
  )
  const received = new Map(
    manifest.entries.map((entry) => [entry.key, entry] as const)
  )
  const missing = [...expected.keys()].filter((key) => !received.has(key))
  const extra = [...received.keys()].filter((key) => !expected.has(key))
  if (missing.length || extra.length) {
    throw new Error(
      `Template preview coverage mismatch. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`
    )
  }

  for (const [key, specification] of expected) {
    const preview = received.get(key)!.preview
    assertExactPreview(preview, specification)
  }
}

function assertExactPreview(
  preview: LibraryPreviewDescriptor,
  specification: StudioTemplatePreviewSpecification
) {
  const expected = {
    kind: "raster",
    itemId: specification.template.id,
    itemVersion: specification.template.version,
    pageId: specification.pageId,
    width: specification.width,
    height: specification.height,
    mediaType: "image/png",
    rendererRevision: studioPageThumbnailRendererRevision,
  } as const
  for (const [field, value] of Object.entries(expected)) {
    if (preview[field as keyof LibraryPreviewDescriptor] !== value) {
      throw new Error(
        `Template preview ${specification.key} has wrong ${field}: expected ${String(value)}, received ${String(preview[field as keyof LibraryPreviewDescriptor])}`
      )
    }
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
