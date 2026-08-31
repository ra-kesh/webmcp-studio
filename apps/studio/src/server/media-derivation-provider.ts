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
