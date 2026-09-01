import { useEffect, useState } from "react"
import { AlertTriangle, Check, LoaderCircle, ScanLine } from "lucide-react"
import { Button } from "@webmcp/ui/components/button"
import { Checkbox } from "@webmcp/ui/components/checkbox"
import { managedMediaContentUrl } from "./managed-media-repository"
import type { BackgroundRemovalModel } from "./use-background-removal"

const failureMessage = (code: string | null) => {
  if (!code) return "Background removal failed."
  const messages: Record<string, string> = {
    unsupported_input:
      "This image format is not supported by the configured processor.",
    derivation_quota_exceeded:
      "The workspace has reached its background-removal limit.",
    provider_timeout: "Processing took too long.",
    provider_unavailable: "The image processor is temporarily unavailable.",
    invalid_provider_output:
      "The processor returned an invalid transparent image.",
    storage_failure: "Studio could not save the processed image.",
  }
  return messages[code] ?? "Background removal failed safely."
}

export function BackgroundRemovalControl({
  model,
  sourceAssetId,
}: {
  model: BackgroundRemovalModel
  sourceAssetId: string | null
}) {
  const [consented, setConsented] = useState(false)
  useEffect(
    () => setConsented(false),
    [model.policy?.privacyPolicyVersion, sourceAssetId]
  )

  const job = model.job
  const outputAssetId = job?.outputAssetId ?? null
  const processing = job?.state === "queued" || job?.state === "running"

  return (
    <div className="space-y-3 rounded-lg border bg-muted/25 p-2.5">
      <div className="flex items-start gap-2">
        <ScanLine className="mt-0.5 size-3.5 shrink-0 text-studio-accent" />
        <div>
          <p className="text-xs font-medium">Remove background</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Creates a new Studio image. The original stays unchanged.
          </p>
        </div>
      </div>

      {model.policyLoading ? (
        <div
          className="flex items-center gap-2 text-[11px] text-muted-foreground"
          role="status"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          Loading processing and privacy terms…
        </div>
      ) : model.policy && !job ? (
        <div className="space-y-2 text-[11px] leading-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
            <dt>Processor</dt>
            <dd className="text-foreground">{model.policy.subprocessor}</dd>
            <dt>Retention</dt>
            <dd className="text-foreground">{model.policy.retention}</dd>
            {model.policy.region ? (
              <>
                <dt>Region</dt>
                <dd className="text-foreground">{model.policy.region}</dd>
              </>
            ) : null}
            <dt>Cost</dt>
            <dd className="text-foreground">{model.policy.cost}</dd>
            <dt>Cancel</dt>
            <dd className="text-foreground">
              {model.policy.cancellationLimits}
            </dd>
          </dl>
          <label className="flex items-start gap-2 rounded-md border bg-background p-2">
            <Checkbox
              className="mt-0.5"
              checked={consented}
              onCheckedChange={(checked) => setConsented(checked === true)}
            />
            <span>
              Send this image to {model.policy.subprocessor} under policy{" "}
              {model.policy.privacyPolicyVersion}.
            </span>
          </label>
        </div>
      ) : null}

      {!model.available && model.unavailableReason ? (
        <p
          className="text-[11px] leading-4 text-muted-foreground"
          role="status"
        >
          {model.unavailableReason}
        </p>
      ) : null}

      {processing || job?.state === "cancelling" ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-[11px]">
            <LoaderCircle className="size-3.5 animate-spin" />
            {job.state === "queued"
              ? "Waiting to process…"
              : job.state === "cancelling"
                ? "Cancelling…"
                : `Processing attempt ${job.attemptCount} of ${job.maxAttempts}…`}
          </div>
          {job.state !== "cancelling" ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={model.cancel}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {job?.state === "failed" ? (
        <div className="space-y-2" role="alert">
          <p className="flex items-start gap-2 text-[11px] leading-4 text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {failureMessage(job.safeFailureCode)}
          </p>
          {job.retryable ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={model.retry}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      {job?.state === "cancelled" ? (
        <p className="text-[11px] text-muted-foreground" role="status">
          Processing was cancelled. The original image was not changed.
        </p>
      ) : null}

      {job?.state === "succeeded" && outputAssetId && sourceAssetId ? (
        <div className="space-y-2">
          <div
            className="grid grid-cols-2 gap-2"
            aria-label="Background removal comparison"
          >
            <figure className="space-y-1">
              <img
                className="aspect-square w-full rounded-md border bg-background object-contain"
                src={managedMediaContentUrl(sourceAssetId)}
                alt="Original selected image"
              />
              <figcaption className="text-center text-[11px] text-muted-foreground">
                Before
              </figcaption>
            </figure>
            <figure className="space-y-1">
              <img
                className="aspect-square w-full rounded-md border bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:12px_12px] bg-[position:0_0,0_6px,6px_-6px,-6px_0] object-contain"
                src={managedMediaContentUrl(outputAssetId)}
                alt="Processed image with background removed"
              />
              <figcaption className="text-center text-[11px] text-muted-foreground">
                After
              </figcaption>
            </figure>
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={model.applying || model.applied}
            onClick={model.apply}
          >
            {model.applying ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : model.applied ? (
              <Check data-icon="inline-start" />
            ) : null}
            {model.applied
              ? "Applied"
              : model.applying
                ? "Applying…"
                : "Apply to image"}
          </Button>
          <p className="text-[11px] leading-4 text-muted-foreground">
            The result is already saved in Media. Apply waits for both live
            renderers, then creates one Undo step.
          </p>
          {model.provenance ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 rounded-md border bg-background p-2 text-[11px] leading-4">
              <dt className="text-muted-foreground">Derived from</dt>
              <dd className="break-all">{model.provenance.sourceAssetId}</dd>
              <dt className="text-muted-foreground">Job</dt>
              <dd className="break-all">{model.provenance.derivationJobId}</dd>
              <dt className="text-muted-foreground">Policy</dt>
              <dd>{model.provenance.privacyPolicyVersion}</dd>
              <dt className="text-muted-foreground">Output</dt>
              <dd>
                {model.provenance.outputWidth} × {model.provenance.outputHeight}
                {" PNG"}
              </dd>
            </dl>
          ) : null}
        </div>
      ) : null}

      {!job ? (
        <Button
          size="sm"
          className="w-full"
          disabled={
            !model.available ||
            !model.policy ||
            !consented ||
            model.policyLoading
          }
          onClick={model.start}
        >
          Remove background
        </Button>
      ) : null}

      {model.error ? (
        <p className="text-[11px] leading-4 text-destructive" role="alert">
          {model.error}
        </p>
      ) : null}
    </div>
  )
}
