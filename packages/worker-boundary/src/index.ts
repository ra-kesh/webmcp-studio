export type JsonBodyErrorCode =
  | "content_length_required"
  | "invalid_content_length"
  | "unsupported_media_type"
  | "request_too_large"
  | "empty_json_body"
  | "invalid_json"
  | "request_body_unreadable"

export class JsonBodyError extends Error {
  readonly code: JsonBodyErrorCode
  readonly status: 400 | 411 | 413
  readonly maxBytes?: number

  constructor(
    code: JsonBodyErrorCode,
    status: 400 | 411 | 413,
    message: string,
    maxBytes?: number
  ) {
    super(message)
    this.name = "JsonBodyError"
    this.code = code
    this.status = status
    this.maxBytes = maxBytes
  }
}

export type ReadJsonBodyOptions = {
  maxBytes: number
  requireContentLength?: boolean
}

const parseContentLength = (
  request: Request,
  options: ReadJsonBodyOptions
): number | null => {
  const header = request.headers.get("content-length")
  if (header === null) return null
  if (!/^\d+$/.test(header)) {
    throw new JsonBodyError(
      "invalid_content_length",
      400,
      "Content-Length must be a non-negative integer"
    )
  }
  const length = Number(header)
  if (!Number.isSafeInteger(length)) {
    throw new JsonBodyError(
      "invalid_content_length",
      400,
      "Content-Length is outside the supported range"
    )
  }
  if (length > options.maxBytes) {
    throw new JsonBodyError(
      "request_too_large",
      413,
      `Request body exceeds ${options.maxBytes} bytes`,
      options.maxBytes
    )
  }
  return length
}

export async function readJsonBody(
  request: Request,
  options: ReadJsonBodyOptions
): Promise<unknown> {
  request.signal.throwIfAborted()
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer")
  }
  const contentType = request.headers.get("content-type")
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new JsonBodyError(
      "unsupported_media_type",
      400,
      "Content-Type must be application/json"
    )
  }
  const declaredLength = parseContentLength(request, options)
  if (!request.body) {
    if (declaredLength !== null && declaredLength > 0) {
      throw new JsonBodyError(
        "invalid_content_length",
        400,
        "Content-Length does not match the received body"
      )
    }
    throw new JsonBodyError("empty_json_body", 400, "JSON body is empty")
  }

  const reader = request.body.getReader()
  const abortRead = () => {
    void reader.cancel(request.signal.reason).catch(() => undefined)
  }
  request.signal.addEventListener("abort", abortRead, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      request.signal.throwIfAborted()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > options.maxBytes) {
        await reader.cancel("request_too_large").catch(() => undefined)
        throw new JsonBodyError(
          "request_too_large",
          413,
          `Request body exceeds ${options.maxBytes} bytes`,
          options.maxBytes
        )
      }
      chunks.push(part.value)
    }
  } catch (error) {
    if (error instanceof JsonBodyError) throw error
    request.signal.throwIfAborted()
    throw new JsonBodyError(
      "request_body_unreadable",
      400,
      "Request body could not be read"
    )
  } finally {
    request.signal.removeEventListener("abort", abortRead)
    reader.releaseLock()
  }

  request.signal.throwIfAborted()

  if (bytes === 0) {
    throw new JsonBodyError("empty_json_body", 400, "JSON body is empty")
  }
  if (declaredLength !== null && declaredLength !== bytes) {
    throw new JsonBodyError(
      "invalid_content_length",
      400,
      "Content-Length does not match the received body"
    )
  }
  if (declaredLength === null && options.requireContentLength) {
    throw new JsonBodyError(
      "content_length_required",
      411,
      "Content-Length is required"
    )
  }

  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    throw new JsonBodyError("invalid_json", 400, "JSON body is not UTF-8")
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new JsonBodyError("invalid_json", 400, "JSON body is malformed")
  }
}

export const jsonBodyErrorResponse = (
  error: JsonBodyError,
  nested = false
): Response => {
  const detail = {
    code: error.code,
    message: error.message,
    ...(error.maxBytes ? { maxBytes: error.maxBytes } : {}),
  }
  return Response.json(
    nested ? { error: detail } : { error: detail.code, ...detail },
    {
      status: error.status,
    }
  )
}
