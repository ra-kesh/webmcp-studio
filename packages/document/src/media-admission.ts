import { z } from "zod"
import { applyCommand } from "./commands"
import {
  assetReferenceKeysForSource,
  extractAssetReferences,
  localAssetIdFromSource,
  localAssetIdSchema,
  localAssetSource,
  managedAssetIdFromSource,
  managedAssetSourceSchema,
  mediaAssetIdSchema,
} from "./media"
import { documentSchema, type Document } from "./schema"

export const LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT = 5_000

const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const localMediaAdmissionLocalStateSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("ready") }).strict(),
    z.object({ status: z.literal("missing_bytes") }).strict(),
    z.object({ status: z.literal("absent") }).strict(),
    z.object({ status: z.literal("quarantined") }).strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ]
)

const mappedLocalMediaStateSchema = z
  .object({
    status: z.enum(["ready", "archived"]),
    managedAssetId: mediaAssetIdSchema,
    managedSource: managedAssetSourceSchema,
    contentSha256: contentSha256Schema,
  })
  .strict()
  .superRefine((mapping, context) => {
    if (
      managedAssetIdFromSource(mapping.managedSource) !== mapping.managedAssetId
    ) {
      context.addIssue({
        code: "custom",
        path: ["managedSource"],
        message: "Managed asset identity is incoherent",
      })
    }
  })

export const localMediaAdmissionMappingStateSchema = z.discriminatedUnion(
  "status",
  [
    mappedLocalMediaStateSchema.safeExtend({ status: z.literal("ready") }),
    mappedLocalMediaStateSchema.safeExtend({ status: z.literal("archived") }),
    z.object({ status: z.literal("unmapped") }).strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ]
)

export const localMediaAdmissionFactSchema = z
  .object({
    localAssetId: localAssetIdSchema,
    local: localMediaAdmissionLocalStateSchema,
    mapping: localMediaAdmissionMappingStateSchema,
    localContentSha256: contentSha256Schema.optional(),
  })
  .strict()
  .superRefine((fact, context) => {
    const mappingIsExact =
      fact.mapping.status === "ready" || fact.mapping.status === "archived"
    if (
      fact.local.status === "ready" &&
      mappingIsExact &&
      fact.localContentSha256 === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["localContentSha256"],
        message: "A ready mapped local asset requires its exact content hash",
      })
    }
    if (
      fact.localContentSha256 !== undefined &&
      (fact.local.status !== "ready" || !mappingIsExact)
    ) {
      context.addIssue({
        code: "custom",
        path: ["localContentSha256"],
        message: "A local content hash is only valid for a ready mapped asset",
      })
    }
  })

export type LocalMediaAdmissionLocalState = z.infer<
  typeof localMediaAdmissionLocalStateSchema
>
export type LocalMediaAdmissionMappingState = z.infer<
  typeof localMediaAdmissionMappingStateSchema
>
export type LocalMediaAdmissionFact = z.infer<
  typeof localMediaAdmissionFactSchema
>

type LocalAliasReferenceSet = Readonly<{
  localAssetId: string
  localSource: `asset:local/${string}`
  expectedReferenceKeys: readonly string[]
}>

export type SafeLocalMediaAdmissionMigration = LocalAliasReferenceSet &
  Readonly<{
    outcome: "safe_migration"
    localStatus: Exclude<LocalMediaAdmissionLocalState["status"], "unavailable">
    managedStatus: "ready" | "archived"
    managedAssetId: string
    managedSource: `asset:managed/${string}`
    contentSha256: string
    relationship: "same_hash" | "no_local_bytes"
  }>

type ManagedAdmissionCandidate = Readonly<{
  managedStatus: "ready" | "archived"
  managedAssetId: string
  managedSource: `asset:managed/${string}`
  contentSha256: string
}>

export type UnresolvedLocalMediaAdmission = LocalAliasReferenceSet &
  Readonly<{
    outcome:
      | "local_only"
      | "missing_unmapped"
      | "identity_conflict"
      | "local_unavailable"
      | "mapping_unavailable"
    localStatus: LocalMediaAdmissionLocalState["status"]
    mappingStatus: LocalMediaAdmissionMappingState["status"]
    managedCandidate: ManagedAdmissionCandidate | null
  }>

export type LocalMediaAdmissionPlan = Readonly<{
  documentId: string
  sourceRevision: number
  aliasOrder: readonly string[]
  safeMigrations: readonly SafeLocalMediaAdmissionMigration[]
  unresolved: readonly UnresolvedLocalMediaAdmission[]
}>

export type LocalMediaAdmissionPlanResult =
  | Readonly<{ ok: true; plan: LocalMediaAdmissionPlan }>
  | Readonly<{
      ok: false
      reason:
        | "local_media_alias_limit_exceeded"
        | "local_media_document_invalid"
        | "local_media_admission_facts_invalid"
        | "local_media_admission_facts_mismatch"
    }>

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

function extractLocalAliasReferenceSets(
  document: Document
): LocalAliasReferenceSet[] {
  const keysByAssetId = new Map<string, string[]>()
  for (const reference of extractAssetReferences(document)) {
    if (reference.identity !== "local") continue
    const localAssetId = localAssetIdFromSource(reference.source)
    if (!localAssetId) continue
    const keys = keysByAssetId.get(localAssetId) ?? []
    keys.push(reference.key)
    keysByAssetId.set(localAssetId, keys)
  }
  return [...keysByAssetId]
    .sort(([left], [right]) => compareText(left, right))
    .map(([localAssetId, expectedReferenceKeys]) => ({
      localAssetId,
      localSource: localAssetSource(localAssetId),
      expectedReferenceKeys: [...expectedReferenceKeys].sort(compareText),
    }))
}

function managedCandidate(
  mapping: Extract<
    LocalMediaAdmissionMappingState,
    { status: "ready" | "archived" }
  >
): ManagedAdmissionCandidate {
  return {
    managedStatus: mapping.status,
    managedAssetId: mapping.managedAssetId,
    managedSource: mapping.managedSource as `asset:managed/${string}`,
    contentSha256: mapping.contentSha256,
  }
}

/**
 * Projects repository facts onto canonical document-owned local aliases.
 * Facts must be complete and in the exact sorted alias order so an omitted or
 * drifted response can never be interpreted as an unmapped asset.
 */
export function planLocalMediaAdmission(
  input: Document,
  factsInput: readonly LocalMediaAdmissionFact[]
): LocalMediaAdmissionPlanResult {
  const parsedDocument = documentSchema.safeParse(input)
  if (!parsedDocument.success) {
    return { ok: false, reason: "local_media_document_invalid" }
  }
  const document = parsedDocument.data
  const aliases = extractLocalAliasReferenceSets(document)
  if (aliases.length > LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT) {
    return { ok: false, reason: "local_media_alias_limit_exceeded" }
  }

  const parsedFacts = z
    .array(localMediaAdmissionFactSchema)
    .safeParse(factsInput)
  if (!parsedFacts.success) {
    return { ok: false, reason: "local_media_admission_facts_invalid" }
  }
  const facts = parsedFacts.data
  if (
    aliases.length !== facts.length ||
    aliases.some(
      (alias, index) => alias.localAssetId !== facts[index]?.localAssetId
    )
  ) {
    return { ok: false, reason: "local_media_admission_facts_mismatch" }
  }

  const safeMigrations: SafeLocalMediaAdmissionMigration[] = []
  const unresolved: UnresolvedLocalMediaAdmission[] = []

  for (let index = 0; index < aliases.length; index += 1) {
    const alias = aliases[index]!
    const fact = facts[index]!
    const base = {
      ...alias,
      localStatus: fact.local.status,
    }

    if (fact.local.status === "unavailable") {
      unresolved.push({
        ...base,
        outcome: "local_unavailable",
        mappingStatus: fact.mapping.status,
        managedCandidate:
          fact.mapping.status === "ready" || fact.mapping.status === "archived"
            ? managedCandidate(fact.mapping)
            : null,
      })
      continue
    }
    if (fact.mapping.status === "unavailable") {
      unresolved.push({
        ...base,
        outcome: "mapping_unavailable",
        mappingStatus: fact.mapping.status,
        managedCandidate: null,
      })
      continue
    }
    if (fact.mapping.status === "unmapped") {
      unresolved.push({
        ...base,
        outcome:
          fact.local.status === "ready" ? "local_only" : "missing_unmapped",
        mappingStatus: fact.mapping.status,
        managedCandidate: null,
      })
      continue
    }

    if (fact.local.status === "ready") {
      if (fact.localContentSha256 !== fact.mapping.contentSha256) {
        unresolved.push({
          ...base,
          outcome: "identity_conflict",
          mappingStatus: fact.mapping.status,
          managedCandidate: managedCandidate(fact.mapping),
        })
        continue
      }
      safeMigrations.push({
        ...base,
        localStatus: fact.local.status,
        outcome: "safe_migration",
        ...managedCandidate(fact.mapping),
        relationship: "same_hash",
      })
      continue
    }

    safeMigrations.push({
      ...base,
      localStatus: fact.local.status,
      outcome: "safe_migration",
      ...managedCandidate(fact.mapping),
      relationship: "no_local_bytes",
    })
  }

  return {
    ok: true,
    plan: {
      documentId: document.id,
      sourceRevision: document.revision,
      aliasOrder: aliases.map((alias) => alias.localAssetId),
      safeMigrations,
      unresolved,
    },
  }
}

const localMediaAdmissionApplyContextSchema = z
  .object({
    operationId: z.string().min(1).max(128),
    at: z.iso.datetime(),
  })
  .strict()

export type LocalMediaAdmissionApplyContext = z.infer<
  typeof localMediaAdmissionApplyContextSchema
>

export type LocalMediaAdmissionApplyResult =
  | Readonly<{
      ok: true
      status: "applied" | "unchanged"
      document: Document
      appliedLocalAssetIds: readonly string[]
    }>
  | Readonly<{
      ok: false
      reason:
        | "local_media_admission_apply_context_invalid"
        | "local_media_admission_plan_stale"
        | "local_media_admission_candidate_rejected"
      failedLocalAssetId: string | null
    }>

/**
 * Applies every safe mapping to an isolated candidate. A failure returns no
 * document, so callers cannot accidentally persist a successful prefix.
 */
export function applyLocalMediaAdmissionPlan(
  document: Document,
  plan: LocalMediaAdmissionPlan,
  contextInput: LocalMediaAdmissionApplyContext
): LocalMediaAdmissionApplyResult {
  const context = localMediaAdmissionApplyContextSchema.safeParse(contextInput)
  if (!context.success) {
    return {
      ok: false,
      reason: "local_media_admission_apply_context_invalid",
      failedLocalAssetId: null,
    }
  }
  if (
    document.id !== plan.documentId ||
    document.revision !== plan.sourceRevision
  ) {
    return {
      ok: false,
      reason: "local_media_admission_plan_stale",
      failedLocalAssetId: null,
    }
  }
  if (!plan.safeMigrations.length) {
    return {
      ok: true,
      status: "unchanged",
      document,
      appliedLocalAssetIds: [],
    }
  }

  let candidate = document
  for (let index = 0; index < plan.safeMigrations.length; index += 1) {
    const migration = plan.safeMigrations[index]!
    try {
      candidate = applyCommand(candidate, {
        id: `${context.data.operationId}:media:${index}`,
        type: "relink_asset_references",
        actor: "api",
        at: context.data.at,
        from: migration.localSource,
        toAssetId: migration.managedAssetId,
        toSource: migration.managedSource,
        expectedReferenceKeys: [...migration.expectedReferenceKeys],
      })
    } catch {
      return {
        ok: false,
        reason: "local_media_admission_candidate_rejected",
        failedLocalAssetId: migration.localAssetId,
      }
    }
  }

  const referencesByKey = new Map(
    extractAssetReferences(candidate).map((reference) => [
      reference.key,
      reference,
    ])
  )
  for (const migration of plan.safeMigrations) {
    if (
      assetReferenceKeysForSource(candidate, migration.localSource).length >
        0 ||
      migration.expectedReferenceKeys.some(
        (key) => referencesByKey.get(key)?.source !== migration.managedSource
      )
    ) {
      return {
        ok: false,
        reason: "local_media_admission_candidate_rejected",
        failedLocalAssetId: migration.localAssetId,
      }
    }
  }
  for (const remaining of plan.unresolved) {
    if (
      assetReferenceKeysForSource(candidate, remaining.localSource).some(
        (key, index) => key !== remaining.expectedReferenceKeys[index]
      ) ||
      assetReferenceKeysForSource(candidate, remaining.localSource).length !==
        remaining.expectedReferenceKeys.length
    ) {
      return {
        ok: false,
        reason: "local_media_admission_candidate_rejected",
        failedLocalAssetId: remaining.localAssetId,
      }
    }
  }

  return {
    ok: true,
    status: "applied",
    document: candidate,
    appliedLocalAssetIds: plan.safeMigrations.map(
      (migration) => migration.localAssetId
    ),
  }
}
