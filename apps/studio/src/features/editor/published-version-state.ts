import {
  decodeDocument,
  decodeTemplateVersion,
  createTemplateManifest,
  deriveDocumentSnapshotId,
} from "@webmcp/document"
import type { TemplateVersion } from "@webmcp/document"

const samePublishedSlot = (
  left: Pick<TemplateVersion, "id" | "templateId" | "version" | "document">,
  right: Pick<TemplateVersion, "id" | "templateId" | "version" | "document">
) =>
  left.id === right.id ||
  (left.templateId === right.templateId &&
    left.version === right.version &&
    left.document.id === right.document.id)

export function publishedVersionsForDocument(
  versions: readonly TemplateVersion[],
  templateId: string,
  documentId: string
) {
  return versions.filter(
    (version) =>
      version.templateId === templateId && version.document.id === documentId
  )
}

export function replaceAuthoritativePublishedVersions(
  current: TemplateVersion[],
  authoritative: TemplateVersion[]
): TemplateVersion[] {
  const remaining = [...authoritative]
  const replaced = current.map((candidate) => {
    const index = remaining.findIndex((version) =>
      samePublishedSlot(candidate, version)
    )
    if (index < 0) return candidate
    const [version] = remaining.splice(index, 1)
    return version
  })
  return [...replaced, ...remaining]
}

export async function restorePublishedVersions(
  serialized: string
): Promise<TemplateVersion[]> {
  const input = JSON.parse(serialized) as unknown
  if (!Array.isArray(input)) {
    throw new TypeError("Published version storage must be an array")
  }
  return Promise.all(
    input.map(async (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("document" in value)
      ) {
        throw new TypeError("Published version storage is invalid")
      }
      if ("sourceSnapshotId" in value) {
        return decodeTemplateVersion(value).version
      }
      const document = decodeDocument(value.document).document
      return decodeTemplateVersion({
        ...value,
        document,
        manifest: createTemplateManifest(document),
        sourceSnapshotId: await deriveDocumentSnapshotId(document),
      }).version
    })
  )
}
