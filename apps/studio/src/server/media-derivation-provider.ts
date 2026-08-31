import type { SupportedMediaAssetType } from "./media-assets"

export type VerifiedDerivationInput = Readonly<{
  jobId: string
  attemptId: string
  workspaceId: string
  sourceAssetId: string
  sourceContentHash: string
  mediaType: SupportedMediaAssetType
  width: number
  height: number
  bytes: Uint8Array
}>

export type ProviderExecution = Readonly<{
  id: string
}>

export type ProviderResult =
  | Readonly<{ state: "running" }>
  | Readonly<{
      state: "succeeded"
      mediaType: SupportedMediaAssetType
      bytes: Uint8Array
    }>
  | Readonly<{
      state: "failed"
      code: string
      retryable: boolean
    }>

export type ProviderCancelResult = Readonly<{
  accepted: boolean
}>

export interface MediaDerivationProvider {
  readonly key: string
  readonly modelVersion: string
  start(input: VerifiedDerivationInput): Promise<ProviderExecution>
  poll(execution: ProviderExecution): Promise<ProviderResult>
  cancel(execution: ProviderExecution): Promise<ProviderCancelResult>
}

export class MediaDerivationDispatchError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = "MediaDerivationDispatchError"
  }
}

const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index])

export function sanitizeProviderInput(
  input: VerifiedDerivationInput
): VerifiedDerivationInput {
  if (
    input.mediaType !== "image/png" ||
    !equalBytes(input.bytes.subarray(0, 8), pngSignature)
  ) {
    throw new MediaDerivationDispatchError(
      "unsupported_input",
      false,
      "The configured adapter currently admits canonical PNG sources only"
    )
  }
  const retained: Uint8Array[] = [input.bytes.subarray(0, 8)]
  let offset = 8
  let sawHeader = false
  let sawImageData = false
  let sawEnd = false
  const view = new DataView(
    input.bytes.buffer,
    input.bytes.byteOffset,
    input.bytes.byteLength
  )
  while (offset < input.bytes.byteLength) {
    if (offset + 12 > input.bytes.byteLength) {
      throw new MediaDerivationDispatchError(
        "unsupported_input",
        false,
        "The source PNG is truncated"
      )
    }
    const length = view.getUint32(offset)
    const end = offset + length + 12
    if (end > input.bytes.byteLength) {
      throw new MediaDerivationDispatchError(
        "unsupported_input",
        false,
        "The source PNG is truncated"
      )
    }
    const type = new TextDecoder().decode(
      input.bytes.subarray(offset + 4, offset + 8)
    )
    if (type === "IHDR") sawHeader = true
    if (type === "IDAT") sawImageData = true
    if (type === "IEND") sawEnd = true
    const critical = type[0] === type[0]?.toUpperCase()
    if (critical || type === "tRNS") {
      retained.push(input.bytes.subarray(offset, end))
    }
    offset = end
  }
  if (!sawHeader || !sawImageData || !sawEnd) {
    throw new MediaDerivationDispatchError(
      "unsupported_input",
      false,
      "The source PNG structure is incomplete"
    )
  }
  const bytes = new Uint8Array(
    retained.reduce((total, part) => total + part.byteLength, 0)
  )
  let writeOffset = 0
  for (const part of retained) {
    bytes.set(part, writeOffset)
    writeOffset += part.byteLength
  }
  return { ...input, bytes }
}

export class DeterministicMediaDerivationProvider implements MediaDerivationProvider {
  readonly key = "deterministic-local-fake"
  readonly modelVersion = "fixture-v1"
  readonly starts: VerifiedDerivationInput[] = []
  readonly cancellations: string[] = []

  constructor(
    private readonly output: Readonly<{
      mediaType: SupportedMediaAssetType
      bytes: Uint8Array
    }>,
    private readonly result: "succeeded" | "failed" = "succeeded"
  ) {}

  async start(input: VerifiedDerivationInput): Promise<ProviderExecution> {
    this.starts.push(input)
    return { id: `fake:${input.attemptId}` }
  }

  async poll(): Promise<ProviderResult> {
    return this.result === "failed"
      ? { state: "failed", code: "provider_unavailable", retryable: true }
      : { state: "succeeded", ...this.output }
  }

  async cancel(execution: ProviderExecution): Promise<ProviderCancelResult> {
    this.cancellations.push(execution.id)
    return { accepted: true }
  }
}
