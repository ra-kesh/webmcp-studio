import type { LibraryItemIdentity } from "@webmcp/document"
import type {
  ResolvedTemplateAction,
  TemplateActionIntent,
} from "../../content/library/library-template-actions"
import type { LibraryPreferenceCommands } from "../../content/library/library-preference-provider"
import type { LibraryTemplateCreateResult } from "./library-template-create-completion"

export type LibraryTemplateCreateCommandPorts = Readonly<{
  resolve: (
    intent: TemplateActionIntent
  ) => Promise<ResolvedTemplateAction | null>
  confirm: (
    resolved: ResolvedTemplateAction
  ) => Promise<LibraryTemplateCreateResult>
  recordUsed: LibraryPreferenceCommands["recordUsed"]
}>

export async function createLibraryTemplateDocument(
  intent: TemplateActionIntent,
  ports: LibraryTemplateCreateCommandPorts
): Promise<boolean> {
  const resolved = await ports.resolve(intent)
  if (!resolved) return false

  const result = await ports.confirm(resolved)
  if (!result.succeeded) return false
  const completionId = result.completionId
  if (completionId) {
    const identity: LibraryItemIdentity = resolved.intent
    void Promise.resolve()
      .then(() =>
        ports.recordUsed(
          identity,
          resolved.detail.summary.name,
          "create",
          completionId
        )
      )
      .catch(() => false)
  }
  return true
}
