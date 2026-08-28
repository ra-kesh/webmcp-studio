import type { AlignmentSnapTarget } from "@webmcp/editor"
import type { PageGuide } from "@webmcp/editor/page-guides"

export function projectVisibleGuideSnapTargets(
  guides: readonly PageGuide[],
  guidesVisible: boolean
): readonly AlignmentSnapTarget[] {
  if (!guidesVisible) return []
  return guides.map((guide) => ({
    axis: guide.axis,
    value: guide.position,
    source: "guide",
  }))
}
