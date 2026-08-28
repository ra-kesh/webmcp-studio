export const DOCUMENT_ROUTE_PREFIX = "/documents/"

export type DocumentRouteResult =
  | Readonly<{
      ok: true
      documentId: string
      encodedDocumentId: string
      pathname: string
    }>
  | Readonly<{
      ok: false
      reason: "empty_document_id" | "malformed_document_id" | "not_one_segment"
    }>

const validDocumentId = (documentId: string) => documentId.length > 0

export const documentPath = (documentId: string): DocumentRouteResult => {
  if (!validDocumentId(documentId)) {
    return { ok: false, reason: "empty_document_id" }
  }

  try {
    const encodedDocumentId = encodeURIComponent(documentId)
    return {
      ok: true,
      documentId,
      encodedDocumentId,
      pathname: `${DOCUMENT_ROUTE_PREFIX}${encodedDocumentId}`,
    }
  } catch {
    return { ok: false, reason: "malformed_document_id" }
  }
}

export const decodeDocumentRouteSegment = (
  encodedDocumentId: string
): DocumentRouteResult => {
  if (encodedDocumentId.length === 0) {
    return { ok: false, reason: "empty_document_id" }
  }
  if (encodedDocumentId.includes("/")) {
    return { ok: false, reason: "not_one_segment" }
  }

  try {
    const documentId = decodeURIComponent(encodedDocumentId)
    if (!validDocumentId(documentId)) {
      return { ok: false, reason: "empty_document_id" }
    }
    const canonical = documentPath(documentId)
    if (!canonical.ok) return canonical
    return canonical
  } catch {
    return { ok: false, reason: "malformed_document_id" }
  }
}

export type DocumentLibraryRedirectNotice =
  | "document_missing"
  | "document_deleted"
  | "document_recovery_required"
  | "document_unavailable"
  | "invalid_document_route"

export type DocumentLibraryNoticeSearch = Readonly<{
  notice: DocumentLibraryRedirectNotice
  documentId?: string
}>

const documentSpecificNotices: readonly DocumentLibraryRedirectNotice[] = [
  "document_missing",
  "document_deleted",
  "document_recovery_required",
  "document_unavailable",
]

export const validateDocumentLibraryNoticeSearch = (
  search: unknown
): DocumentLibraryNoticeSearch | null => {
  if (!search || typeof search !== "object" || Array.isArray(search))
    return null
  const candidate = search as Record<string, unknown>
  const notice = candidate.notice
  if (
    notice !== "document_missing" &&
    notice !== "document_deleted" &&
    notice !== "document_recovery_required" &&
    notice !== "document_unavailable" &&
    notice !== "invalid_document_route"
  ) {
    return null
  }

  if (notice === "invalid_document_route") {
    return { notice }
  }
  if (
    typeof candidate.documentId !== "string" ||
    !validDocumentId(candidate.documentId)
  ) {
    return null
  }
  return { notice, documentId: candidate.documentId }
}

export const documentLibraryNoticeCopy = (
  search: DocumentLibraryNoticeSearch
): string => {
  if (search.notice === "invalid_document_route") {
    return "That document link is invalid."
  }

  const documentId = search.documentId ?? "the requested document"
  switch (search.notice) {
    case "document_missing":
      return `The document “${documentId}” could not be found.`
    case "document_deleted":
      return `The document “${documentId}” is in Trash.`
    case "document_recovery_required":
      return `The document “${documentId}” needs recovery before it can be opened.`
    case "document_unavailable":
      return `The document “${documentId}” is temporarily unavailable.`
  }
}

export const isDocumentSpecificLibraryNotice = (
  notice: DocumentLibraryRedirectNotice
) => documentSpecificNotices.includes(notice)
