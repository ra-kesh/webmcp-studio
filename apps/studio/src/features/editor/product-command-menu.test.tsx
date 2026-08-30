import { describe, expect, it } from "vitest"
import type { ProductAppMenu } from "@webmcp/editor/product-commands"

import { responsiveProductCommandMenus } from "./product-command-menu"

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
})
