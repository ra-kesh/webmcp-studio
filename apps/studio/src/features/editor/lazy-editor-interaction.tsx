import { lazy, Suspense } from "react"
import type { ComponentProps, ComponentType } from "react"

type LazyEditorInteractionModule<TComponent extends ComponentType<any>> =
  Readonly<{
    default: TComponent
  }>

/**
 * Keeps interaction-only code splitting below the live editor workspace.
 * Initial route admission owns the outer editor boundary; controls that can
 * first appear after admission must never suspend that renderer-owned tree.
 */
export function createLazyEditorInteraction<
  TComponent extends ComponentType<any>,
>(load: () => Promise<LazyEditorInteractionModule<TComponent>>) {
  const Interaction = lazy(load)
  type Props = ComponentProps<TComponent>

  function LazyEditorInteraction(props: Props) {
    return (
      <Suspense fallback={null}>
        <Interaction {...props} />
      </Suspense>
    )
  }

  LazyEditorInteraction.displayName = "LazyEditorInteraction"
  return LazyEditorInteraction
}
