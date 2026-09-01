export const IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON =
  "Wait for the pending image replacement to finish before exporting or publishing."
export const IMAGE_REPLACEMENT_OUTPUT_STALE_REASON =
  "The image replacement preview changed while output was being prepared. Start the export or publication again."

export type ImageReplacementOutputAdmissionLease = Readonly<{
  generation: number
}>

export type ImageReplacementOutputAdmission =
  | Readonly<{ admitted: true; disabledReason: null; generation: number }>
  | Readonly<{ admitted: false; disabledReason: string; generation: number }>

export type ImageReplacementOutputCommandInputs = Readonly<{
  outputBusy: boolean
  publishDisabledReason: string | null
  pdfLabel: string
}>

export function imageReplacementOutputAdmission(
  pending: boolean,
  generation: number
): ImageReplacementOutputAdmission {
  return pending
    ? {
        admitted: false,
        disabledReason: IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON,
        generation,
      }
    : { admitted: true, disabledReason: null, generation }
}

export function captureImageReplacementOutputAdmission(
  admission: ImageReplacementOutputAdmission
): ImageReplacementOutputAdmissionLease {
  assertImageReplacementOutputAdmission(admission)
  return { generation: admission.generation }
}

export function assertImageReplacementOutputAdmission(
  admission: ImageReplacementOutputAdmission,
  lease?: ImageReplacementOutputAdmissionLease
) {
  if (!admission.admitted) throw new Error(admission.disabledReason)
  if (lease && lease.generation !== admission.generation) {
    throw new Error(IMAGE_REPLACEMENT_OUTPUT_STALE_REASON)
  }
}

export function imageReplacementOutputCommandStates(
  admission: ImageReplacementOutputAdmission,
  inputs: ImageReplacementOutputCommandInputs
) {
  const outputBusy = inputs.outputBusy || !admission.admitted
  return {
    "output.export-png": {
      enabled: !outputBusy,
      disabledReason:
        admission.disabledReason ??
        (outputBusy
          ? "Finish the active review, crop, or export first."
          : null),
    },
    "document.publish": {
      enabled: admission.admitted && inputs.publishDisabledReason === null,
      disabledReason: admission.disabledReason ?? inputs.publishDisabledReason,
    },
    "output.export-pdf": {
      enabled: !outputBusy,
      disabledReason:
        admission.disabledReason ??
        (outputBusy
          ? "Finish the active review, crop, or export first."
          : null),
      label: inputs.pdfLabel,
    },
  }
}
