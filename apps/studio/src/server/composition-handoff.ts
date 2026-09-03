import { quotationCompositionRequestV1Schema } from "@webmcp/document"
import { z } from "zod"

export const COMPOSITION_HANDOFF_TTL_MS = 10 * 60_000

export const compositionHandoffV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal("quotation-composition"),
    payload: quotationCompositionRequestV1Schema,
  })
  .strict()

export type CompositionHandoffV1 = z.infer<typeof compositionHandoffV1Schema>

type StoredCompositionHandoff = Readonly<{
  tokenHash: string
  sourceKind: string
  sourceId: string
  sourceRevision: number
  requestJson: string
  expiresAt: string
  createdAt: string
}>

export interface CompositionHandoffStore {
  create: (handoff: StoredCompositionHandoff) => Promise<void>
  claimAndRead: (
    tokenHash: string,
    workspaceId: string,
    now: string
  ) => Promise<string | null>
}

export class D1CompositionHandoffStore implements CompositionHandoffStore {
  constructor(private readonly db: D1Database) {}

  async create(handoff: StoredCompositionHandoff) {
    await this.db.batch([
      this.db
        .prepare(
          "DELETE FROM studio_composition_handoffs WHERE expires_at <= ?1"
        )
        .bind(handoff.createdAt),
      this.db
        .prepare(
          `INSERT INTO studio_composition_handoffs (
            token_hash,
            source_kind,
            source_id,
            source_revision,
            request_json,
            expires_at,
            created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        )
        .bind(
          handoff.tokenHash,
          handoff.sourceKind,
          handoff.sourceId,
          handoff.sourceRevision,
          handoff.requestJson,
          handoff.expiresAt,
          handoff.createdAt
        ),
    ])
  }

  async claimAndRead(tokenHash: string, workspaceId: string, now: string) {
    const row = await this.db
      .prepare(
        `UPDATE studio_composition_handoffs
         SET claimed_workspace_id = COALESCE(claimed_workspace_id, ?2)
         WHERE token_hash = ?1
           AND expires_at > ?3
           AND (claimed_workspace_id IS NULL OR claimed_workspace_id = ?2)
         RETURNING request_json`
      )
      .bind(tokenHash, workspaceId, now)
      .first<{ request_json: string }>()
    return row?.request_json ?? null
  }
}

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

export const createCompositionHandoffToken = () =>
  bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))

export const compositionHandoffTokenHash = async (token: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export const createCompositionHandoff = async ({
  input,
  store,
  now = () => new Date(),
  createToken = createCompositionHandoffToken,
}: {
  input: unknown
  store: CompositionHandoffStore
  now?: () => Date
  createToken?: () => string
}) => {
  const handoff = compositionHandoffV1Schema.parse(input)
  const token = createToken()
  const tokenHash = await compositionHandoffTokenHash(token)
  const createdAt = now()
  await store.create({
    tokenHash,
    sourceKind: handoff.payload.payload.source.type,
    sourceId: handoff.payload.payload.source.quotationId,
    sourceRevision: handoff.payload.payload.source.revision,
    requestJson: JSON.stringify(handoff),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(
      createdAt.getTime() + COMPOSITION_HANDOFF_TTL_MS
    ).toISOString(),
  })
  return token
}

export const redeemCompositionHandoff = async ({
  token,
  workspaceId,
  store,
  now = () => new Date(),
}: {
  token: string
  workspaceId: string
  store: CompositionHandoffStore
  now?: () => Date
}): Promise<CompositionHandoffV1 | null> => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const requestJson = await store.claimAndRead(
    await compositionHandoffTokenHash(token),
    workspaceId,
    now().toISOString()
  )
  if (!requestJson) return null
  try {
    return compositionHandoffV1Schema.parse(JSON.parse(requestJson))
  } catch {
    return null
  }
}

const secureStringEqual = async (left: string, right: string) => {
  const [leftHash, rightHash] = await Promise.all([
    compositionHandoffTokenHash(left),
    compositionHandoffTokenHash(right),
  ])
  let difference = leftHash.length ^ rightHash.length
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |=
      leftHash.charCodeAt(index) ^ (rightHash.charCodeAt(index) || 0)
  }
  return difference === 0
}

export const hasValidCompositionHandoffCredential = async (
  request: Request,
  expectedSecret: string | undefined
) => {
  const secret = expectedSecret?.trim()
  const authorization = request.headers.get("Authorization")
  if (!secret || !authorization?.startsWith("Bearer ")) return false
  return secureStringEqual(authorization.slice(7), secret)
}
