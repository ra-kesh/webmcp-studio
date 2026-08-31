import { describe, expect, it } from "vitest"
import type { FieldDefinition } from "@webmcp/document"
import { studioMediaManifest } from "../../content/library/media/manifest"
import { studioAssets } from "./asset-catalog"
import {
  assetValueDisplay,
  displayFieldChangeValue,
} from "./field-review-display"

const field = (
  type: FieldDefinition["type"],
  overrides: Partial<FieldDefinition> = {}
): FieldDefinition => ({
  id: `${type}_field`,
  key: `${type}_field`,
  label: `${type} field`,
  type,
  required: false,
  defaultValue: type === "number" ? 0 : type === "boolean" ? false : "",
  agentDescription: "",
  validation: {},
  ...overrides,
})

describe("field-aware review display", () => {
  it("formats canonical currency, date, and choice values for people", () => {
    expect(displayFieldChangeValue(field("currency"), "385000.50")).toBe(
      "₹3,85,000.50"
    )
    expect(displayFieldChangeValue(field("date"), "2028-02-29")).toBe(
      "29 February 2028"
    )
    expect(
      displayFieldChangeValue(
        field("choice", {
          validation: {
            options: [
              {
                value: "midnight",
                label: "Midnight Film",
                agentDescription: "",
              },
            ],
          },
        }),
        "midnight"
      )
    ).toBe("Midnight Film")
  })

  it("uses compatibility labels and never exposes renderer sources", () => {
    const catalogAsset = studioAssets[0]
    expect(displayFieldChangeValue(field("asset"), catalogAsset.src)).toBe(
      `${catalogAsset.name} · Legacy curated value`
    )
    expect(
      displayFieldChangeValue(
        field("asset"),
        "https://assets.example.test/private-source.png"
      )
    ).toBe("Historical HTTPS image")
    expect(
      displayFieldChangeValue(
        field("asset"),
        "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M0%200h1v1z%22%2F%3E%3C%2Fsvg%3E"
      )
    ).toBe("Embedded renderer-safe image")
  })

  it("distinguishes every persisted asset identity without exposing sources", () => {
    const curated = studioMediaManifest[0]
    expect(assetValueDisplay(curated.resourcePath)).toMatchObject({
      kind: "canonical_curated",
      label: `${curated.name} · Curated Studio asset`,
      valid: true,
      publishRequiresResolution: false,
    })
    expect(assetValueDisplay("asset:managed/asset-workspace01")).toMatchObject({
      kind: "workspace_managed",
      label: "Workspace-managed image (asset-workspace01)",
      valid: true,
    })
    expect(assetValueDisplay("asset:local/device-image-1")).toMatchObject({
      kind: "device_local",
      label: "Device-local image (device-image-1)",
      valid: true,
    })
    expect(assetValueDisplay("data:image/png;base64,AA==")).toMatchObject({
      kind: "embedded_renderer_safe",
      label: "Embedded renderer-safe image",
      valid: true,
    })
    expect(assetValueDisplay("https://example.test/old.png")).toMatchObject({
      kind: "historical_https",
      label: "Historical HTTPS image",
      valid: true,
    })
    expect(assetValueDisplay("library-old-value")).toEqual({
      kind: "legacy",
      label: "Legacy asset value",
      valid: false,
      publishRequiresResolution: true,
    })
  })
})
