import { describe, expect, it } from "vitest"
import type { ProductAppMenu } from "@webmcp/editor/product-commands"

import {
  productCommandMenuDensity,
  responsiveProductCommandMenus,
} from "./product-command-menu"

const menus = [
  { id: "file", label: "File", groups: [] },
  { id: "text", label: "Text", groups: [] },
] as const satisfies readonly ProductAppMenu[]

describe("ResponsiveProductCommandDropdownGroups", () => {
  it("keeps Text in the desktop overflow while compact uses its richer preset surface", () => {
    const responsive = responsiveProductCommandMenus(menus)

    expect(responsive.compact.map((menu) => menu.label)).toEqual(["File"])
    expect(responsive.desktop.map((menu) => menu.label)).toEqual([
      "File",
      "Text",
    ])
  })

  it("keeps desktop menus compact while preserving coarse-pointer-sized compact rows", () => {
    expect(productCommandMenuDensity.desktopItem).toContain("min-h-7")
    expect(productCommandMenuDensity.desktopItem).toContain("text-xs")
    expect(productCommandMenuDensity.compactItem).toContain("min-h-11")
    expect(productCommandMenuDensity.compactItem).toContain(
      "min-[1280px]:min-h-7"
    )
    expect(productCommandMenuDensity.compactItem).toContain(
      "[@media(pointer:coarse)]:min-h-11"
    )
    expect(productCommandMenuDensity.shortcut).toContain("font-mono")
    expect(productCommandMenuDensity.shortcut).toContain("text-[11px]")
    expect(productCommandMenuDensity.shortcut).toContain("tracking-normal")
  })
})
