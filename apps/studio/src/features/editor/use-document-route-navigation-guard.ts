import { useBlocker } from "@tanstack/react-router"

export type DocumentRouteNavigationGuardOptions = Readonly<{
  enabled: boolean
  shouldWarnBeforeUnload: () => boolean
  prepareToLeave: () => boolean | Promise<boolean>
  onBlocked: (error: unknown | null) => void
}>

/**
 * Holds SPA history navigation at the current document route until the editor
 * has settled and durably retired its active persistence session.
 */
export function useDocumentRouteNavigationGuard({
  enabled,
  shouldWarnBeforeUnload,
  prepareToLeave,
  onBlocked,
}: DocumentRouteNavigationGuardOptions) {
  useBlocker({
    disabled: !enabled,
    enableBeforeUnload: shouldWarnBeforeUnload,
    shouldBlockFn: async ({ current, next }) => {
      if (current.pathname === next.pathname) return false

      try {
        if (!(await prepareToLeave())) {
          onBlocked(null)
          return true
        }
        return false
      } catch (error) {
        onBlocked(error)
        return true
      }
    },
  })
}
