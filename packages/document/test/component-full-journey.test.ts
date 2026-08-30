import { describe, expect, it } from "vitest"
import { buildComponentPublicationJourney } from "../src"

describe("component create-to-publication journey", () => {
  it("keeps canonical instance semantics through override, variant, propagation, reset, detach, and publication", () => {
    const journey = buildComponentPublicationJourney()
    const sourceEyebrow = journey.source.nodes.find(
      (node) => node.id === "cover-eyebrow"
    )
    expect(sourceEyebrow?.type).toBe("text")
    const sourceEyebrowColor =
      sourceEyebrow?.type === "text" ? sourceEyebrow.color : undefined
    expect(sourceEyebrowColor).toBeDefined()
    expect(journey.componentCreated.components).toHaveLength(1)
    expect(journey.instanceCreated.componentInstances).toHaveLength(1)
    expect(
      journey.overridden.componentInstances[0]?.overrides["cover-eyebrow"]
    ).toMatchObject({ color: "#dc2626" })
    expect(
      journey.variantSwitched.nodes.find(
        (node) => node.id === "journey-instance-eyebrow"
      )
    ).toMatchObject({ color: "#dc2626", fontSize: 12, height: 24 })
    expect(
      journey.sourceUpdated.nodes.find(
        (node) => node.id === "journey-instance-eyebrow"
      )
    ).toMatchObject({
      text: "Updated reusable proposal",
      color: "#dc2626",
    })
    expect(
      Object.keys(
        journey.overrideReset.componentInstances[0]?.overrides[
          "cover-eyebrow"
        ] ?? {}
      )
    ).not.toContain("color")
    expect(
      journey.overrideReset.nodes.find(
        (node) => node.id === "journey-instance-eyebrow"
      )
    ).toMatchObject({ color: sourceEyebrowColor, fontSize: 12, height: 24 })
    expect(journey.detached.componentInstances).toHaveLength(0)
    expect(
      journey.detached.nodes.find(
        (node) => node.id === "journey-instance-eyebrow"
      )
    ).toMatchObject({
      text: "Updated reusable proposal",
      color: sourceEyebrowColor,
      fontSize: 12,
      height: 24,
    })
    expect(journey.published.document.componentInstances).toHaveLength(0)
    expect(journey.published.document.components).toHaveLength(1)
    expect(journey.published.document).toEqual(journey.detached)
    expect(journey.published.document).not.toBe(journey.detached)
    expect(
      journey.published.document.nodes.find(
        (node) => node.id === "journey-instance-eyebrow"
      )
    ).toMatchObject({
      text: "Updated reusable proposal",
      color: sourceEyebrowColor,
      fontSize: 12,
      height: 24,
    })
  })
})
