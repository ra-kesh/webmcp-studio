import type {
  DocumentDraftReadResult,
  DocumentDraftRecord,
  DocumentDraftRepository,
  DocumentDraftSummary,
  DraftRepositoryFailure,
} from "./document-draft-repository"

export type DocumentRouteAdmission =
  | Readonly<{
      status: "opened"
      record: DocumentDraftRecord
      warning: DraftRepositoryFailure | null
    }>
  | Readonly<{ status: "missing"; documentId: string }>
  | Readonly<{
      status: "deleted"
      documentId: string
      summary: DocumentDraftSummary
    }>
  | Readonly<{
      status: "recovery_required"
      documentId: string
      quarantineId: string | null
    }>
  | Readonly<{
      status: "unavailable"
      documentId: string
      failure: DraftRepositoryFailure
    }>
  | Readonly<{ status: "superseded"; documentId: string }>

export type DocumentRouteAdmissionDependencies = Readonly<{
  get: DocumentDraftRepository["get"]
  touchOpened: DocumentDraftRepository["touchOpened"]
}>

const recordHasIdentity = (
  record: DocumentDraftRecord,
  documentId: string
): boolean =>
  record.summary.documentId === documentId &&
  record.envelope.document.id === documentId

export class DocumentRouteAdmissionController {
  #generation = 0
  #disposed = false
  #touchQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly dependencies: DocumentRouteAdmissionDependencies
  ) {}

  get generation() {
    return this.#generation
  }

  get disposed() {
    return this.#disposed
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#generation += 1
  }

  supersede() {
    if (!this.#disposed) this.#generation += 1
  }

  async admit(documentId: string): Promise<DocumentRouteAdmission> {
    const generation = ++this.#generation
    if (this.#disposed) return { status: "superseded", documentId }

    const read = await this.dependencies.get(documentId)
    if (!this.#owns(generation)) return { status: "superseded", documentId }
    const readFailure = this.#projectRead(documentId, read)
    if (readFailure) return readFailure
    if (!read.ok || read.status !== "found") {
      return { status: "missing", documentId }
    }

    const verified = read.record
    if (!recordHasIdentity(verified, documentId)) {
      return {
        status: "recovery_required",
        documentId,
        quarantineId: null,
      }
    }
    if (verified.summary.deletedAt !== null) {
      return {
        status: "deleted",
        documentId,
        summary: verified.summary,
      }
    }

    const previousTouch = this.#touchQueue
    let releaseTouch!: () => void
    this.#touchQueue = new Promise<void>((resolve) => {
      releaseTouch = resolve
    })
    await previousTouch
    if (!this.#owns(generation)) {
      releaseTouch()
      return { status: "superseded", documentId }
    }

    const touched = await this.dependencies
      .touchOpened(documentId)
      .finally(releaseTouch)
    if (!this.#owns(generation)) return { status: "superseded", documentId }
    if (!touched.ok) {
      if (touched.reason === "storage_unavailable") {
        return { status: "opened", record: verified, warning: touched.failure }
      }
      if (touched.reason === "corrupt_record") {
        return {
          status: "recovery_required",
          documentId,
          quarantineId: touched.quarantineId ?? null,
        }
      }
      if (touched.reason === "missing") return { status: "missing", documentId }
      return {
        status: "unavailable",
        documentId,
        failure: touched.failure,
      }
    }

    if (!recordHasIdentity(touched.value, documentId)) {
      return {
        status: "recovery_required",
        documentId,
        quarantineId: null,
      }
    }
    if (touched.value.summary.deletedAt !== null) {
      return {
        status: "deleted",
        documentId,
        summary: touched.value.summary,
      }
    }
    return { status: "opened", record: touched.value, warning: null }
  }

  #owns(generation: number) {
    return !this.#disposed && generation === this.#generation
  }

  #projectRead(
    documentId: string,
    read: DocumentDraftReadResult
  ): Exclude<DocumentRouteAdmission, { status: "opened" }> | null {
    if (read.ok) {
      return read.status === "missing"
        ? { status: "missing", documentId }
        : null
    }
    if (read.reason === "corrupt_record") {
      return {
        status: "recovery_required",
        documentId,
        quarantineId: read.quarantineId,
      }
    }
    return { status: "unavailable", documentId, failure: read.failure }
  }
}
