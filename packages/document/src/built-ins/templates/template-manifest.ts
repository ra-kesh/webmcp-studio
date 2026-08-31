import { z } from "zod"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import type { Document } from "../../schema"

const manifestIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const publicHttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol
      return protocol === "http:" || protocol === "https:"
    } catch {
      return false
    }
  }, "Template provenance URLs must use HTTP or HTTPS")

export const builtInTemplateManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    formatFamily: manifestIdSchema,
    useCaseIds: z
      .array(manifestIdSchema)
      .min(1)
      .max(20)
      .refine(
        (values) => new Set(values).size === values.length,
        "Template use cases must be unique"
      ),
    job: z.string().trim().min(1).max(240),
    provenance: z
      .object({
        origin: z.enum(["studio_original", "third_party"]),
        sourceName: z.string().trim().min(1).max(200),
        sourceUrl: publicHttpUrlSchema.nullable(),
        license: z
          .object({
            id: manifestIdSchema,
            name: z.string().trim().min(1).max(200),
            url: publicHttpUrlSchema.nullable(),
          })
          .strict(),
        attribution: z
          .object({
            required: z.boolean(),
            text: z.string().trim().min(1).max(500).nullable(),
          })
          .strict(),
        contentSha256: sha256Schema,
      })
      .strict(),
    contentIdentity: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("document"),
          documentId: z.string().min(1),
          schemaVersion: z.literal(5),
        })
        .strict(),
      z
        .object({
          kind: z.literal("quotation_style"),
          quotationTemplateId: manifestIdSchema,
          composerVersion: z.number().int().positive(),
          preview: z.enum(["canonical", "unavailable"]),
        })
        .strict(),
    ]),
    documentProfile: z
      .object({
        pageCount: z.number().int().positive().max(100),
        dimensions: z
          .array(
            z
              .object({
                width: z.number().int().positive().max(100_000),
                height: z.number().int().positive().max(100_000),
              })
              .strict()
          )
          .min(1)
          .max(100),
        nodeCount: z.number().int().nonnegative().max(100_000),
        groupCount: z.number().int().nonnegative().max(100_000),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.documentProfile &&
      manifest.documentProfile.pageCount !==
        manifest.documentProfile.dimensions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["documentProfile", "pageCount"],
        message: "Manifest page count must match its dimension records",
      })
    }
    if (
      manifest.provenance.attribution.required &&
      !manifest.provenance.attribution.text
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "attribution", "text"],
        message: "Required template attribution needs display text",
      })
    }
    if (
      manifest.provenance.origin === "third_party" &&
      (!manifest.provenance.sourceUrl ||
        !manifest.provenance.license.url ||
        !manifest.provenance.attribution.required ||
        !manifest.provenance.attribution.text)
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "attribution", "required"],
        message:
          "Third-party templates require source, license, and attribution evidence",
      })
    }
    if (
      manifest.provenance.origin === "studio_original" &&
      (manifest.provenance.sourceUrl !== null ||
        manifest.provenance.license.url !== null ||
        manifest.provenance.attribution.required ||
        manifest.provenance.attribution.text !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance"],
        message:
          "Studio-original templates must not invent public source or license links",
      })
    }
    const previewUnavailable =
      manifest.contentIdentity.kind === "quotation_style" &&
      manifest.contentIdentity.preview === "unavailable"
    if (previewUnavailable !== (manifest.documentProfile === null)) {
      context.addIssue({
        code: "custom",
        path: ["documentProfile"],
        message:
          "Only quotation identities without a historical preview may omit the document profile",
      })
    }
    const expectedDimensions = formatDimensions[manifest.formatFamily]
    if (
      manifest.documentProfile &&
      expectedDimensions &&
      manifest.documentProfile.dimensions.some(
        ({ width, height }) =>
          width !== expectedDimensions.width ||
          height !== expectedDimensions.height
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["formatFamily"],
        message: `${manifest.formatFamily} does not match the canonical page dimensions`,
      })
    }
  })

export type BuiltInTemplateManifest = z.infer<
  typeof builtInTemplateManifestSchema
>

export const STUDIO_TEMPLATE_LICENSE = {
  id: "studio-original",
  name: "Studio original template",
  url: null,
} as const

const formatDimensions: Readonly<
  Record<string, Readonly<{ width: number; height: number }>>
> = {
  "a4-portrait": { width: 1240, height: 1754 },
  "invitation-portrait": { width: 1200, height: 1600 },
  "presentation-16x9": { width: 1600, height: 900 },
  "quotation-proposal": { width: 1240, height: 1754 },
  "social-carousel": { width: 1080, height: 1080 },
  "social-square": { width: 1080, height: 1080 },
  "social-story": { width: 1080, height: 1920 },
}

export function createStudioTemplateManifest(input: {
  id: string
  formatFamily: string
  useCaseIds: readonly string[]
  job: string
  document: Document
  contentSha256: string
}): BuiltInTemplateManifest {
  return builtInTemplateManifestSchema.parse({
    schemaVersion: 1,
    formatFamily: input.formatFamily,
    useCaseIds: [...input.useCaseIds],
    job: input.job,
    provenance: {
      origin: "studio_original",
      sourceName: "Studio originals",
      sourceUrl: null,
      license: STUDIO_TEMPLATE_LICENSE,
      attribution: { required: false, text: null },
      contentSha256: input.contentSha256,
    },
    contentIdentity: {
      kind: "document",
      documentId: input.document.id,
      schemaVersion: input.document.schemaVersion,
    },
    documentProfile: documentProfile(input.document),
  })
}

export function createStudioQuotationStyleManifest(input: {
  id: string
  quotationTemplateId: string
  composerVersion: number
  formatFamily: string
  useCaseIds: readonly string[]
  job: string
  previewDocument: Document | null
  contentSha256: string
}): BuiltInTemplateManifest {
  return builtInTemplateManifestSchema.parse({
    schemaVersion: 1,
    formatFamily: input.formatFamily,
    useCaseIds: [...input.useCaseIds],
    job: input.job,
    provenance: {
      origin: "studio_original",
      sourceName: "Studio originals",
      sourceUrl: null,
      license: STUDIO_TEMPLATE_LICENSE,
      attribution: { required: false, text: null },
      contentSha256: input.contentSha256,
    },
    contentIdentity: {
      kind: "quotation_style",
      quotationTemplateId: input.quotationTemplateId,
      composerVersion: input.composerVersion,
      preview: input.previewDocument ? "canonical" : "unavailable",
    },
    documentProfile: input.previewDocument
      ? documentProfile(input.previewDocument)
      : null,
  })
}

export function assertTemplateManifestMatchesDocument(
  manifest: BuiltInTemplateManifest,
  document: Document
): void {
  const actualProfile = documentProfile(document)
  if (!manifest.documentProfile) {
    throw new Error(
      "Template manifest is missing its canonical document profile"
    )
  }
  if (
    JSON.stringify(actualProfile) !== JSON.stringify(manifest.documentProfile)
  ) {
    throw new Error(
      "Template manifest document profile does not match its canonical document"
    )
  }
  assertTemplateManifestChecksum(manifest, templateDocumentContent(document))
  if (
    manifest.contentIdentity.kind !== "document" ||
    manifest.contentIdentity.documentId !== document.id ||
    manifest.contentIdentity.schemaVersion !== document.schemaVersion
  ) {
    throw new Error(
      "Template manifest content identity does not match its canonical document"
    )
  }
}

export function assertTemplateManifestMatchesQuotationStyle(
  manifest: BuiltInTemplateManifest,
  quotationTemplateId: string,
  composerVersion: number,
  previewDocument: Document
): void {
  assertQuotationContentIdentity(manifest, quotationTemplateId, composerVersion)
  if (
    manifest.contentIdentity.kind !== "quotation_style" ||
    manifest.contentIdentity.preview !== "canonical" ||
    !manifest.documentProfile
  ) {
    throw new Error(
      "Active quotation template manifest requires an exact canonical preview"
    )
  }
  const actualProfile = documentProfile(previewDocument)
  if (
    JSON.stringify(actualProfile) !== JSON.stringify(manifest.documentProfile)
  ) {
    throw new Error(
      "Template manifest document profile does not match its quotation preview"
    )
  }
  assertTemplateManifestChecksum(
    manifest,
    quotationStyleContent(quotationTemplateId, composerVersion, previewDocument)
  )
}

export function assertTemplateManifestMatchesQuotationIdentity(
  manifest: BuiltInTemplateManifest,
  quotationTemplateId: string,
  composerVersion: number
): void {
  assertQuotationContentIdentity(manifest, quotationTemplateId, composerVersion)
  if (
    manifest.contentIdentity.kind !== "quotation_style" ||
    manifest.contentIdentity.preview !== "unavailable" ||
    manifest.documentProfile !== null
  ) {
    throw new Error(
      "Historical quotation identity must not claim a fabricated preview"
    )
  }
  assertTemplateManifestChecksum(
    manifest,
    quotationStyleContent(quotationTemplateId, composerVersion, null)
  )
}

function assertQuotationContentIdentity(
  manifest: BuiltInTemplateManifest,
  quotationTemplateId: string,
  composerVersion: number
): void {
  if (
    manifest.contentIdentity.kind !== "quotation_style" ||
    manifest.contentIdentity.quotationTemplateId !== quotationTemplateId ||
    manifest.contentIdentity.composerVersion !== composerVersion
  ) {
    throw new Error(
      "Template manifest content identity does not match its quotation style"
    )
  }
}

export function templateDocumentContent(document: Document): string {
  return JSON.stringify(document)
}

export function quotationStyleContent(
  quotationTemplateId: string,
  composerVersion: number,
  previewDocument: Document | null
): string {
  return JSON.stringify(
    previewDocument
      ? { quotationTemplateId, composerVersion, previewDocument }
      : { quotationTemplateId, composerVersion }
  )
}

export function templateContentSha256(content: string): string {
  return bytesToHex(sha256(utf8ToBytes(content)))
}

export function assertTemplateManifestChecksum(
  manifest: BuiltInTemplateManifest,
  content: string
): void {
  const actual = templateContentSha256(content)
  if (actual !== manifest.provenance.contentSha256) {
    throw new Error(
      `Template manifest checksum does not match its content for ${JSON.stringify(manifest.contentIdentity)}: expected ${manifest.provenance.contentSha256}, received ${actual}`
    )
  }
}

export async function verifyTemplateManifestChecksum(
  manifest: BuiltInTemplateManifest,
  content: string
): Promise<void> {
  assertTemplateManifestChecksum(manifest, content)
}

function documentProfile(document: Document) {
  return {
    pageCount: document.pages.length,
    dimensions: document.pages.map(({ width, height }) => ({ width, height })),
    nodeCount: document.nodes.length,
    groupCount: document.groups.length,
  }
}
