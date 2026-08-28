import { describe, expect, it } from "vitest"
import type { TemplateParameter } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
import { publicParameterExampleValue } from "./api-playground-dialog"

const assetParameter = (exampleValue: string): TemplateParameter => ({
  id: "hero_asset",
  key: "hero_asset",
  label: "Hero asset",
  type: "asset",
  required: true,
  defaultValue: exampleValue,
  exampleValue,
  agentDescription: "Choose approved hero artwork",
  validation: {},
  bindings: [],
})

describe("API Playground public parameter values", () => {
  it("projects a private catalog source to the stable public asset ID", () => {
    expect(
      publicParameterExampleValue(assetParameter(studioAssets[0].src))
    ).toBe(studioAssets[0].id)
  })

  it("keeps unresolved asset values invalid and visible for replacement", () => {
    expect(
      publicParameterExampleValue(
        assetParameter("https://example.test/unresolved.png")
      )
    ).toBe("https://example.test/unresolved.png")
  })
})
