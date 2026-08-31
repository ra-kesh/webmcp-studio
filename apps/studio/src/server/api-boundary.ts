const REQUEST_ID_HEADER = "X-Request-Id"
const AUDIT_PRINCIPAL_HEADER = "X-Studio-Audit-Principal"
const AUDIT_WORKSPACE_HEADER = "X-Studio-Audit-Workspace"
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_ERROR_BODY_BYTES = 64 * 1024
const ERROR_BODY_TIMEOUT_MS = 1_000

export type ApiIssue = {
  path: readonly (string | number)[]
  code: string
  message: string
}

export type ApiErrorDetail = {
  code: string
  message: string
  requestId: string
  retryable: boolean
  issues?: readonly ApiIssue[]
  [key: string]: unknown
}

export type ApiErrorEnvelope = {
  error: ApiErrorDetail
}

type FinalizedApiResponse = {
  response: Response
  audit: Promise<void>
}

const publicMessageFor = (code: string) => code.replaceAll("_", " ")

const retryableFor = (status: number, code: string) =>
  [408, 425, 429, 502, 503, 504].includes(status) ||
  /(?:capacity|concurrency|rate|connection|timeout|timed_out|temporarily|unavailable|status_unknown)/.test(
    code
  )

const normalizeCode = (value: unknown, status: number) => {
  if (typeof value === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(value)) {
    return value
  }
  return status >= 500 ? "internal_error" : "request_failed"
}

const errorDetailFrom = (
  payload: unknown,
  status: number,
  requestId: string
): ApiErrorDetail => {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null
  const rawError = record?.error
  const detail =
    rawError && typeof rawError === "object"
      ? (rawError as Record<string, unknown>)
      : null
  const code = normalizeCode(
    typeof rawError === "string" ? rawError : detail?.code,
    status
  )
  const suppliedMessage =
    typeof detail?.message === "string"
      ? detail.message
      : typeof record?.message === "string"
        ? record.message
        : null
  const message =
    status >= 500 && code === "internal_error"
      ? "The request could not be completed"
      : suppliedMessage || publicMessageFor(code)
  const retryable =
    typeof detail?.retryable === "boolean"
      ? detail.retryable
      : retryableFor(status, code)
  const metadataSource = detail ?? record ?? {}
  const metadata = Object.fromEntries(
    Object.entries(metadataSource)
      .filter(
        ([key]) =>
          key !== "error" &&
          key !== "message" &&
          key !== "requestId" &&
          key !== "retryable"
      )
      .map(([key, value]) =>
        !detail && key === "code" ? ["detailCode", value] : [key, value]
      )
  )
  return { ...metadata, code, message, requestId, retryable }
}

export const apiIssuesFrom = (
  issues: readonly {
    path: PropertyKey[]
    code: string
    message: string
  }[]
): readonly ApiIssue[] =>
  issues.map((issue) => ({
    path: issue.path.filter(
      (part): part is string | number =>
        typeof part === "string" || typeof part === "number"
    ),
    code: issue.code,
    message: issue.message,
  }))

export const requestIdFor = (request: Request) => {
  const supplied = request.headers.get(REQUEST_ID_HEADER)?.trim()
  return supplied && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : crypto.randomUUID()
}

export const withApiRequestId = (request: Request, requestId: string) => {
  const headers = new Headers(request.headers)
  headers.delete(AUDIT_PRINCIPAL_HEADER)
  headers.delete(AUDIT_WORKSPACE_HEADER)
  headers.set(REQUEST_ID_HEADER, requestId)
  return new Request(request, { headers })
}

export const apiErrorResponse = (
  request: Request,
  input: Omit<ApiErrorDetail, "requestId">,
  init: ResponseInit & { status: number }
) => {
  const requestId = requestIdFor(request)
  const headers = new Headers(init.headers)
  headers.set(REQUEST_ID_HEADER, requestId)
  headers.set("Cache-Control", "no-store")
  headers.set("X-Content-Type-Options", "nosniff")
  return Response.json({ error: { ...input, requestId } }, { ...init, headers })
}

export const withApiPrincipalAudit = (
  response: Response,
  principalId: string,
  workspaceId: string
) => {
  const headers = new Headers(response.headers)
  headers.set(AUDIT_PRINCIPAL_HEADER, principalId)
  headers.set(AUDIT_WORKSPACE_HEADER, workspaceId)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const normalizedApiPath = (request: Request) => {
  const requestPath = new URL(request.url).pathname
  const path =
    request.method === "GET" &&
    requestPath === "/v1/studio/assets/local-promotions/resolve"
      ? "/v1/studio/assets/local-promotions/:localAssetId"
      : requestPath
  return path
    .replace(
      /^\/v1\/studio\/assets\/local-promotions\/(?!resolve$)[^/]+$/,
      "/v1/studio/assets/local-promotions/:localAssetId"
    )
    .replace(
      /^\/v1\/studio\/documents\/[^/]+\/revisions\/[^/]+$/,
      "/v1/studio/documents/:documentId/revisions/:snapshotId"
    )
    .replace(
      /^\/v1\/studio\/assets\/(?!local-promotions(?:\/|$))[^/]+(?:\/(content|deletion-impact|used))?$/,
      (_match, suffix: string | undefined) =>
        `/v1/studio/assets/:assetId${suffix ? `/${suffix}` : ""}`
    )
    .replace(
      /^\/v1\/studio\/assets\/[^/]+\/derivations$/,
      "/v1/studio/assets/:assetId/derivations"
    )
    .replace(
      /^\/v1\/studio\/media-derivations\/(?!policy$)[^/]+(?:\/(cancel|retry))?$/,
      (_match, suffix: string | undefined) =>
        `/v1/studio/media-derivations/:jobId${suffix ? `/${suffix}` : ""}`
    )
    .replace(
      /^\/v1\/studio\/templates\/[^/]+$/,
      "/v1/studio/templates/:templateId"
    )
    .replace(
      /^\/v1\/studio\/library\/items\/[^/]+\/[^/]+\/versions\/[^/]+(?:\/(favorite|used))?$/,
      (_match, suffix: string | undefined) =>
        `/v1/studio/library/items/:itemKind/:itemId/versions/:version${suffix ? `/${suffix}` : ""}`
    )
    .replace(
      /^\/v1\/studio\/library\/collections\/[^/]+\/items\/[^/]+\/[^/]+\/versions\/[^/]+$/,
      "/v1/studio/library/collections/:collectionId/items/:itemKind/:itemId/versions/:version"
    )
    .replace(
      /^\/v1\/studio\/library\/collections\/[^/]+(?:\/(order))?$/,
      (_match, suffix: string | undefined) =>
        `/v1/studio/library/collections/:collectionId${suffix ? `/${suffix}` : ""}`
    )
    .replace(
      /^\/v1\/renders\/[^/]+\/outputs\/[^/]+$/,
      "/v1/renders/:renderId/outputs/:outputId"
    )
    .replace(/^\/v1\/renders\/[^/]+$/, "/v1/renders/:renderId")
}

const readBoundedErrorPayload = async (
  response: Response
): Promise<unknown> => {
  const declaredLength = Number(response.headers.get("content-length"))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ERROR_BODY_BYTES
  ) {
    return null
  }
  const clone = response.clone()
  const reader = clone.body?.getReader()
  if (!reader) return null
  const timeout = setTimeout(() => {
    void reader.cancel("error_body_timeout").catch(() => undefined)
  }, ERROR_BODY_TIMEOUT_MS)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_ERROR_BODY_BYTES) {
        await reader.cancel("error_body_too_large").catch(() => undefined)
        return null
      }
      chunks.push(part.value)
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    reader.releaseLock()
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    return null
  }
}

const recordApiRequest = async (
  db: D1Database,
  request: Request,
  response: Response,
  requestId: string,
  startedAt: number,
  errorCode: string | null,
  retryable: boolean
) => {
  const principalId = response.headers.get(AUDIT_PRINCIPAL_HEADER)
  const workspaceId = response.headers.get(AUDIT_WORKSPACE_HEADER)
  await db
    .prepare(
      `INSERT INTO api_request_audit
       (request_id, occurred_at, method, route_path, status, duration_ms,
        principal_id, workspace_id, error_code, retryable)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      requestId,
      new Date().toISOString(),
      request.method,
      normalizedApiPath(request),
      response.status,
      Math.max(0, Math.round(performance.now() - startedAt)),
      principalId,
      workspaceId,
      errorCode,
      retryable ? 1 : 0
    )
    .run()
}

export async function finalizeApiResponse(
  db: D1Database,
  request: Request,
  response: Response,
  requestId: string,
  startedAt: number
): Promise<FinalizedApiResponse> {
  const headers = new Headers(response.headers)
  headers.delete(AUDIT_PRINCIPAL_HEADER)
  headers.delete(AUDIT_WORKSPACE_HEADER)
  headers.set(REQUEST_ID_HEADER, requestId)

  let finalized: Response
  let errorCode: string | null = null
  let retryable = false
  if (response.status >= 400) {
    const payload = await readBoundedErrorPayload(response)
    const error = errorDetailFrom(payload, response.status, requestId)
    errorCode = error.code
    retryable = error.retryable
    headers.set("Cache-Control", "no-store")
    headers.set("Content-Type", "application/json; charset=utf-8")
    headers.set("X-Content-Type-Options", "nosniff")
    finalized = new Response(JSON.stringify({ error }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } else {
    finalized = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  return {
    response: finalized,
    audit: recordApiRequest(
      db,
      request,
      response,
      requestId,
      startedAt,
      errorCode,
      retryable
    ).catch((error: unknown) => {
      console.error("api_request_audit_failed", { requestId, error })
    }),
  }
}

export const internalApiErrorResponse = (request: Request) =>
  apiErrorResponse(
    request,
    {
      code: "internal_error",
      message: "The request could not be completed",
      retryable: false,
    },
    { status: 500 }
  )
