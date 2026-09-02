import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { z } from "zod"
import { applyCommand } from "./commands"
import {
  compileStudioDesignPlan,
  studioDesignPlanSchema,
  type ApprovedGenerationAsset,
} from "./design-plan"
import { builtInDesignTemplateRepository } from "./built-in-design-templates"
import { studioGenerationLimits } from "./generation-contract"
import {
  defaultImageFrameMask,
  defaultImagePlacement,
  documentSchema,
  fieldValueSchema,
  imageFrameMaskSchema,
  imagePlacementSchema,
  type Document,
} from "./schema"
import { deriveDocumentSnapshotId } from "./publishing"
import { sceneNodeImageReferences } from "./media"
import { validateDocument, type ValidationIssue } from "./validation"

const requestIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/)
const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(studioGenerationLimits.maxIdempotencyKeyCharacters)
  .regex(/^[A-Za-z0-9._:-]+$/)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const publicHttpUrlSchema = z
  .string()
  .url()
  .max(studioGenerationLimits.maxCanonicalUrlCharacters)
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  }, "Canonical URLs must use HTTP or HTTPS")

const sourceMetadataShape = {
  title: z.string().trim().min(1).max(200),
  canonicalUrl: publicHttpUrlSchema.optional(),
  contentHash: sha256Schema.optional(),
}

export const generationSkillReferenceSchema = z
  .object({
    ...sourceMetadataShape,
    kind: z.enum(["url", "repository", "inline"]),
  })
  .strict()

export const designGuideReferenceSchema = z
  .object({
    ...sourceMetadataShape,
    kind: z.enum(["inline", "url", "repository"]),
    decisions: z
      .object({
        colors: z
          .record(z.string().trim().min(1).max(120), z.string().max(128))
          .optional(),
        typography: z
          .record(z.string().trim().min(1).max(120), z.string().max(200))
          .optional(),
        spacingBase: z.number().finite().positive().max(1_000).optional(),
        radii: z
          .record(
            z.string().trim().min(1).max(120),
            z.number().finite().nonnegative().max(10_000)
          )
          .optional(),
        principles: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(studioGenerationLimits.maxPrincipleCharacters)
          )
          .max(studioGenerationLimits.maxPrinciplesPerGuide)
          .optional(),
      })
      .strict(),
  })
  .strict()

const analysisReferenceSchema = z
  .object({
    kind: z.literal("analysis"),
    label: z.string().trim().min(1).max(200),
    canonicalUrl: publicHttpUrlSchema.optional(),
    contentHash: sha256Schema.optional(),
  })
  .strict()

const assetReferenceSchema = z
  .object({
    kind: z.literal("asset"),
    assetId: z.string().trim().min(1).max(200),
    assetVersion: z.string().trim().min(1).max(120).optional(),
  })
  .strict()

const templateCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set_text"),
      nodeId: z.string().min(1).max(200),
      text: z.string().max(studioGenerationLimits.maxTextCharacters),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_visibility"),
      nodeId: z.string().min(1).max(200),
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("insert_image"),
      pageId: z.string().min(1).max(200),
      localId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
      name: z
        .string()
        .trim()
        .min(1)
        .max(studioGenerationLimits.maxNameCharacters),
      assetId: z.string().trim().min(1).max(200),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
      rotation: z.number().finite().min(-360).max(360).default(0),
      opacity: z.number().finite().min(0).max(1).default(1),
      visible: z.boolean().default(true),
      locked: z.boolean().default(false),
      placement: imagePlacementSchema.default(defaultImagePlacement),
      frameMask: imageFrameMaskSchema.default(defaultImageFrameMask),
      alt: z.string().max(2_000).default(""),
      decorative: z.boolean().default(false),
    })
    .strict()
    .superRefine((node, context) => {
      if (node.decorative && node.alt !== "") {
        context.addIssue({
          code: "custom",
          path: ["alt"],
          message:
            "Decorative images must use an empty alternative description",
        })
      }
    }),
])

const templateGenerationStartSchema = z
  .object({
    kind: z.literal("template"),
    template: z
      .object({
        id: z.string().min(1).max(200),
        version: z.number().int().positive(),
      })
      .strict(),
    fieldValues: z.record(z.string(), fieldValueSchema).optional(),
    assetSubstitutions: z
      .array(
        z
          .object({
            nodeId: z.string().min(1).max(200),
            assetId: z.string().min(1).max(200),
            alt: z.string().max(2_000).optional(),
          })
          .strict()
      )
      .max(studioGenerationLimits.maxTemplateCommands)
      .optional(),
    commands: z
      .array(templateCommandSchema)
      .max(studioGenerationLimits.maxTemplateCommands)
      .optional(),
  })
  .strict()
  .superRefine((start, context) => {
    const count =
      (start.assetSubstitutions?.length ?? 0) + (start.commands?.length ?? 0)
    if (count > studioGenerationLimits.maxTemplateCommands) {
      context.addIssue({
        code: "custom",
        message: `Template changes cannot exceed ${studioGenerationLimits.maxTemplateCommands}.`,
      })
    }
  })

const blankGenerationStartSchema = z
  .object({
    kind: z.literal("blank"),
    presetId: z.string().min(1).max(120),
    plan: studioDesignPlanSchema,
  })
  .strict()

export const documentGenerationRequestSchema = z
  .object({
    requestId: requestIdSchema,
    idempotencyKey: idempotencyKeySchema,
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(studioGenerationLimits.maxPromptCharacters),
    skill: generationSkillReferenceSchema,
    start: z.discriminatedUnion("kind", [
      templateGenerationStartSchema,
      blankGenerationStartSchema,
    ]),
    designGuides: z
      .array(designGuideReferenceSchema)
      .max(studioGenerationLimits.maxDesignGuides)
      .default([]),
    references: z
      .array(
        z.discriminatedUnion("kind", [
          analysisReferenceSchema,
          assetReferenceSchema,
        ])
      )
      .max(studioGenerationLimits.maxReferences),
    requestedName: z.string().trim().min(1).max(80).optional(),
    replacementForRequestId: requestIdSchema.optional(),
  })
  .strict()

export type DocumentGenerationRequest = z.infer<
  typeof documentGenerationRequestSchema
>
export type DesignGuideReference = z.infer<typeof designGuideReferenceSchema>
export type GenerationSkillReference = z.infer<
  typeof generationSkillReferenceSchema
>
export type GenerationReference =
  DocumentGenerationRequest["references"][number]

export type GeneratedDocumentPlan = Readonly<{
  requestId: string
  rootRequestId: string
  attempt: number
  replacementForRequestId?: string
  idempotencyKey: string
  requestHash: string
  createdAt: string
  start:
    | Readonly<{
        kind: "template"
        template: Readonly<{
          id: string
          version: number
          snapshotId: string
        }>
      }>
    | Readonly<{
        kind: "blank"
        presetId: string
        designPlanVersion: 1
      }>
  candidate: Document
  summary: Readonly<{
    pages: readonly Readonly<{
      id: string
      name: string
      width: number
      height: number
    }>[]
    nodesByType: Readonly<Record<string, number>>
    fields: readonly string[]
    assets: readonly string[]
    structuralChanges: readonly string[]
  }>
  provenance: Readonly<{
    skill: GenerationSkillReference
    designGuides: readonly DesignGuideReference[]
    references: readonly GenerationReference[]
  }>
  validation: readonly ValidationIssue[]
  warnings: readonly string[]
}>

export type DocumentGenerationCompileOptions = Readonly<{
  now: string
  approvedAssets: ReadonlyMap<string, ApprovedGenerationAsset>
}>

export type DocumentGenerationErrorCode =
  | "invalid_request"
  | "budget_exceeded"
  | "template_unavailable"
  | "template_requires_source"
  | "unknown_field"
  | "unknown_node"
  | "bound_property"
  | "unapproved_asset"
  | "invalid_candidate"

export class DocumentGenerationError extends Error {
  constructor(
    readonly code: DocumentGenerationErrorCode,
    message: string,
    readonly path?: string
  ) {
    super(message)
    this.name = "DocumentGenerationError"
  }
}

const fail = (
  code: DocumentGenerationErrorCode,
  message: string,
  path?: string
): never => {
  throw new DocumentGenerationError(code, message, path)
}

const digest = (value: unknown) =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))

const createIdFactory =
  (requestHash: string) => (kind: string, sourceId: string) =>
    `${kind}-${digest(`${requestHash}\u0000${kind}\u0000${sourceId}`).slice(0, 32)}`

const assertRequestBudgets = (
  input: unknown,
  request: DocumentGenerationRequest
) => {
  const requestBytes = utf8ToBytes(JSON.stringify(input)).byteLength
  if (requestBytes > studioGenerationLimits.maxRequestBytes) {
    fail(
      "budget_exceeded",
      `Generation request uses ${requestBytes} bytes; the limit is ${studioGenerationLimits.maxRequestBytes}.`
    )
  }
  const guideBytes = request.designGuides.reduce(
    (total, guide) =>
      total + utf8ToBytes(JSON.stringify(guide.decisions)).byteLength,
    0
  )
  if (guideBytes > studioGenerationLimits.maxNormalizedDesignGuideBytes) {
    fail(
      "budget_exceeded",
      `Normalized design-guide decisions use ${guideBytes} bytes; the limit is ${studioGenerationLimits.maxNormalizedDesignGuideBytes}.`,
      "designGuides"
    )
  }
}

const requireApprovedAsset = (
  assetId: string,
  options: DocumentGenerationCompileOptions,
  path: string
) => {
  const asset = options.approvedAssets.get(assetId)
  if (!asset || !asset.selectable) {
    fail(
      "unapproved_asset",
      `Asset ${assetId} is not approved for generation.`,
      path
    )
  }
  return asset!
}

const compileTemplateCandidate = (
  request: DocumentGenerationRequest & {
    start: Extract<DocumentGenerationRequest["start"], { kind: "template" }>
  },
  requestHash: string,
  options: DocumentGenerationCompileOptions
) => {
  const definition = (() => {
    try {
      return builtInDesignTemplateRepository.get(
        request.start.template.id,
        request.start.template.version
      )
    } catch {
      return fail(
        "template_unavailable",
        `Unknown design template: ${request.start.template.id}@${request.start.template.version}.`,
        "start.template"
      )
    }
  })()
  if (definition.kind !== "document_starter") {
    fail(
      "template_requires_source",
      `${definition.name} requires quotation source data and cannot be generated from prompt-only input.`,
      "start.template"
    )
  }
  const createId = createIdFactory(requestHash)
  let candidate = builtInDesignTemplateRepository.materialize(
    definition.id,
    definition.version,
    {
      identity: "fresh",
      now: options.now,
      createId,
      name: request.requestedName,
    }
  )
  let commandSequence = 0
  const commandBase = () => ({
    id: createId("generation-command", String(++commandSequence)),
    actor: "agent" as const,
    at: options.now,
  })
  for (const [key, publicValue] of Object.entries(
    request.start.fieldValues ?? {}
  )) {
    const field =
      candidate.fields.find((item) => item.key === key) ??
      fail(
        "unknown_field",
        `Unknown template field: ${key}.`,
        `start.fieldValues.${key}`
      )
    const value =
      field.type === "asset" && typeof publicValue === "string" && publicValue
        ? requireApprovedAsset(publicValue, options, `start.fieldValues.${key}`)
            .src
        : publicValue
    candidate = applyCommand(candidate, {
      ...commandBase(),
      type: "set_field",
      fieldId: field.id,
      value,
    })
  }
  for (const substitution of request.start.assetSubstitutions ?? []) {
    const nodeId = createId("node", substitution.nodeId)
    const node =
      candidate.nodes.find(
        (
          item
        ): item is Extract<
          (typeof candidate.nodes)[number],
          { type: "image" }
        > => item.id === nodeId && item.type === "image"
      ) ??
      fail(
        "unknown_node",
        `Unknown template image layer: ${substitution.nodeId}.`,
        "start.assetSubstitutions"
      )
    if (
      candidate.bindings.some(
        (binding) => binding.nodeId === node.id && binding.property === "src"
      )
    ) {
      fail(
        "bound_property",
        `Image layer ${substitution.nodeId} is field-bound; set its asset field instead.`,
        "start.assetSubstitutions"
      )
    }
    const asset = requireApprovedAsset(
      substitution.assetId,
      options,
      "start.assetSubstitutions.assetId"
    )
    candidate = applyCommand(candidate, {
      ...commandBase(),
      type: "replace_image_source",
      nodeId: node.id,
      assetId: asset.id,
      src: asset.src,
      ...(substitution.alt !== undefined
        ? { alt: substitution.alt, altProvenance: "generated" as const }
        : {}),
    })
  }
  for (const change of request.start.commands ?? []) {
    if (change.type === "insert_image") {
      const pageId = createId("page", change.pageId)
      const page =
        candidate.pages.find((item) => item.id === pageId) ??
        fail(
          "unknown_node",
          `Unknown template page: ${change.pageId}.`,
          "start.commands"
        )
      if (
        change.x + change.width > page.width ||
        change.y + change.height > page.height
      ) {
        fail(
          "invalid_candidate",
          `Inserted image ${change.localId} exceeds page ${change.pageId}.`,
          "start.commands"
        )
      }
      const asset = requireApprovedAsset(
        change.assetId,
        options,
        "start.commands.assetId"
      )
      candidate = applyCommand(candidate, {
        ...commandBase(),
        type: "add_node",
        pageId,
        node: {
          id: createId("generation-node", change.localId),
          type: "image",
          name: change.name,
          x: change.x,
          y: change.y,
          width: change.width,
          height: change.height,
          rotation: change.rotation,
          opacity: change.opacity,
          visible: change.visible,
          locked: change.locked,
          constraints: { horizontal: "min", vertical: "min" },
          assetId: asset.id,
          src: asset.src,
          placement: change.placement,
          frameMask: change.frameMask,
          alt: change.alt,
          altProvenance: "generated",
          decorative: change.decorative,
        },
      })
      continue
    }
    const nodeId = createId("node", change.nodeId)
    const node =
      candidate.nodes.find((item) => item.id === nodeId) ??
      fail(
        "unknown_node",
        `Unknown template layer: ${change.nodeId}.`,
        "start.commands"
      )
    if (change.type === "set_text") {
      if (node.type !== "text") {
        fail(
          "unknown_node",
          `Template layer ${change.nodeId} is not text.`,
          "start.commands"
        )
      }
      if (
        candidate.bindings.some(
          (binding) => binding.nodeId === node.id && binding.property === "text"
        )
      ) {
        fail(
          "bound_property",
          `Text layer ${change.nodeId} is field-bound; set its field instead.`,
          "start.commands"
        )
      }
      candidate = applyCommand(candidate, {
        ...commandBase(),
        type: "update_node",
        nodeId: node.id,
        patch: { text: change.text },
      })
    } else {
      candidate = applyCommand(candidate, {
        ...commandBase(),
        type: "update_node",
        nodeId: node.id,
        patch: { visible: change.visible },
      })
    }
  }
  candidate = documentSchema.parse({
    ...candidate,
    name: request.requestedName ?? candidate.name,
    revision: 0,
    createdAt: options.now,
    updatedAt: options.now,
  })
  return {
    candidate,
    start: {
      kind: "template" as const,
      template: {
        id: definition.id,
        version: definition.version,
        snapshotId: definition.manifest.provenance.contentSha256,
      },
    },
    structuralChanges: [
      `Cloned ${definition.name}@${definition.version}`,
      `${Object.keys(request.start.fieldValues ?? {}).length} field value changes`,
      `${request.start.assetSubstitutions?.length ?? 0} approved asset substitutions`,
      `${request.start.commands?.length ?? 0} bounded layer changes`,
    ],
  }
}

const summarizeCandidate = (
  candidate: Document,
  structuralChanges: readonly string[]
): GeneratedDocumentPlan["summary"] => ({
  pages: candidate.pages.map((page) => ({
    id: page.id,
    name: page.name,
    width: page.width,
    height: page.height,
  })),
  nodesByType: candidate.nodes.reduce<Record<string, number>>(
    (counts, node) => {
      counts[node.type] = (counts[node.type] ?? 0) + 1
      return counts
    },
    {}
  ),
  fields: candidate.fields.map((field) => field.key),
  assets: [
    ...new Set(
      candidate.nodes.flatMap((node) =>
        sceneNodeImageReferences(node).map((reference) => reference.assetId)
      )
    ),
  ].sort(),
  structuralChanges,
})

export function compileDocumentGenerationRequest(
  input: unknown,
  options: DocumentGenerationCompileOptions
): GeneratedDocumentPlan {
  const parsed = documentGenerationRequestSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    fail(
      "invalid_request",
      issue?.message ?? "The document-generation request is invalid.",
      issue?.path.join(".")
    )
  }
  const request = parsed.data!
  assertRequestBudgets(input, request)
  for (const reference of request.references) {
    if (reference.kind === "asset") {
      requireApprovedAsset(reference.assetId, options, "references")
    }
  }
  const requestHash = digest(request)
  const compiled =
    request.start.kind === "blank"
      ? {
          candidate: compileStudioDesignPlan(request.start.plan, {
            presetId: request.start.presetId,
            requestId: request.requestId,
            idempotencyKey: request.idempotencyKey,
            now: options.now,
            approvedAssets: options.approvedAssets,
          }),
          start: {
            kind: "blank" as const,
            presetId: request.start.presetId,
            designPlanVersion: 1 as const,
          },
          structuralChanges: [
            `Created ${request.start.plan.pages.length} pages from ${request.start.presetId}`,
            `Created ${request.start.plan.nodes.length} editable layers`,
            `Created ${request.start.plan.groups.length} groups`,
          ],
        }
      : compileTemplateCandidate(
          request as DocumentGenerationRequest & {
            start: Extract<
              DocumentGenerationRequest["start"],
              { kind: "template" }
            >
          },
          requestHash,
          options
        )
  const candidate = request.requestedName
    ? documentSchema.parse({
        ...compiled.candidate,
        name: request.requestedName,
      })
    : compiled.candidate
  const validation = validateDocument(candidate)
  if (validation.some((issue) => issue.severity === "error")) {
    fail(
      "invalid_candidate",
      "The generated candidate failed canonical validation."
    )
  }
  const warnings = [
    ...request.designGuides.flatMap((guide) =>
      guide.kind !== "inline" && !guide.contentHash
        ? [`Design guide ${guide.title} has no content hash.`]
        : []
    ),
    ...request.references.flatMap((reference) =>
      reference.kind === "analysis" && !reference.contentHash
        ? [`Analysis reference ${reference.label} has no content hash.`]
        : []
    ),
  ]
  return {
    requestId: request.requestId,
    rootRequestId: request.replacementForRequestId ?? request.requestId,
    attempt: 1,
    ...(request.replacementForRequestId
      ? { replacementForRequestId: request.replacementForRequestId }
      : {}),
    idempotencyKey: request.idempotencyKey,
    requestHash,
    createdAt: options.now,
    start: compiled.start,
    candidate,
    summary: summarizeCandidate(candidate, compiled.structuralChanges),
    provenance: {
      skill: request.skill,
      designGuides: request.designGuides,
      references: request.references,
    },
    validation,
    warnings,
  }
}

export const generatedDocumentSnapshotId = (plan: GeneratedDocumentPlan) =>
  deriveDocumentSnapshotId(plan.candidate)
