const rendererErrorByteLimit = 1_024
const stableCode = /^[a-z][a-z0-9_]{0,79}$/

type RendererErrorPayload = {
  error?: unknown
  code?: unknown
  message?: unknown
  nodeId?: unknown
  assetId?: unknown
}

export class RendererInvocationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly nodeId?: string,
    readonly assetId?: string
  ) {
    super(message)
    this.name = "RendererInvocationError"
  }
}

function errorMessages(error: unknown): string[] {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current = error
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) messages.push(current.message)
    current =
      typeof current === "object" && "cause" in current
        ? current.cause
        : undefined
  }
  return messages
}

export function rendererBindingFailureResponse(
  error: unknown
): Response | null {
  const message = errorMessages(error).join("\n")
  if (/code:\s*429|rate limit exceeded/i.test(message)) {
    return Response.json(
      {
        error: "renderer_capacity_exhausted",
        code: "browser_session_rate_limited",
        retryable: true,
      },
      { status: 503, headers: { "Retry-After": "10" } }
    )
  }
  if (/network connection lost/i.test(message)) {
    return Response.json(
      {
        error: "renderer_connection_lost",
        code: "browser_session_connection_lost",
        retryable: true,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    )
  }
  return null
}

async function readRendererErrorBody(response: Response): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteCount = 0
  try {
    while (byteCount < rendererErrorByteLimit) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = rendererErrorByteLimit - byteCount
      const chunk =
        value.byteLength > remaining ? value.slice(0, remaining) : value
      chunks.push(chunk)
      byteCount += chunk.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteCount)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes).trim()
}

export async function rendererInvocationErrorFromResponse(
  response: Response
): Promise<RendererInvocationError> {
  const text = await readRendererErrorBody(response)
  let payload: RendererErrorPayload | null = null
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed
    }
  } catch {
    // A private renderer failure still receives a stable fallback below.
  }

  const errorCode =
    typeof payload?.error === "string" && stableCode.test(payload.error)
      ? payload.error
      : "renderer_failed"
  const detailCode =
    typeof payload?.code === "string" && stableCode.test(payload.code)
      ? payload.code
      : undefined
  const code =
    errorCode === "render_resource_failed" && detailCode
      ? detailCode
      : errorCode
  const nodeId =
    typeof payload?.nodeId === "string" && payload.nodeId.length <= 128
      ? payload.nodeId
      : undefined
  const assetId =
    typeof payload?.assetId === "string" && payload.assetId.length <= 128
      ? payload.assetId
      : undefined
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim().slice(0, 500)
      : nodeId
        ? `Required render resource failed for node ${nodeId}`
        : `Renderer returned ${response.status}`

  return new RendererInvocationError(
    code,
    message,
    response.status,
    nodeId,
    assetId
  )
}
