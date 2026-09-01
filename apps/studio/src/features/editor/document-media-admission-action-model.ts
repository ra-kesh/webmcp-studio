export function documentMediaAdmissionActionModel(
  restoredAt: string | null,
  restoreUnavailable: boolean
) {
  return {
    showRestore: restoredAt === null && !restoreUnavailable,
    showPreservation: restoredAt === null && restoreUnavailable,
    keepLabel:
      restoredAt === null ? "Keep recovered images" : "Keep restored version",
  } as const
}
