import { describe, expect, it } from "vitest"
import {
  applyCommand,
  assetReferenceKeysForSource,
  documentSchema,
  extractAssetReferences,
  localAssetSource,
  managedAssetSource,
  sceneNodeSchema,
  type Document,
} from "../src"

const from = "asset:local/local-portrait-01"
const localAssetId = "local-portrait-01"
const toAssetId = "asset-managedportrait01"
const toSource = managedAssetSource(toAssetId)
const otherAssetId = "asset-otherportrait001"
const otherSource = managedAssetSource(otherAssetId)
const replacementLocalAssetId = "local-portrait-02"
const replacementLocalSource = localAssetSource(replacementLocalAssetId)
const at = "2026-08-30T05:00:00.000Z"

const image = (id: string, assetId = localAssetId, src = from, x = 10) =>
  sceneNodeSchema.parse({
    id,
    type: "image",
    name: `Image ${id}`,
    assetId,
    src,
    alt: `Description ${id}`,
    altProvenance: "authored",
    decorative: false,
    placement: {
      mode: "manual",
      focalX: 0.25,
      focalY: 0.75,
      zoom: 1.4,
      rotation: 7,
      flipX: true,
      flipY: false,
    },
    frameMask: { shape: "rounded_rectangle", radius: 0.2 },
    x,
    y: 20,
    width: 160,
    height: 90,
    rotation: 3,
    opacity: 0.8,
    visible: true,
    locked: true,
  })

function mediaRelinkDocument(): Document {
  return documentSchema.parse({
    schemaVersion: 4,
    id: "media-relink-document",
    name: "Media relink fixture",
    revision: 7,
    createdAt: "2026-08-30T04:00:00.000Z",
    updatedAt: "2026-08-30T04:30:00.000Z",
    outputs: [
      {
        id: "proposal-output",
        name: "Proposal",
        kind: "proposal",
        pageIds: ["page-one"],
        exportFormats: ["pdf"],
      },
      {
        id: "social-output",
        name: "Social",
        kind: "square",
        pageIds: ["page-two"],
        exportFormats: ["png"],
      },
    ],
    pages: [
      {
        id: "page-one",
        outputId: "proposal-output",
        name: "One",
        width: 800,
        height: 600,
        background: "#fff",
        nodeIds: ["direct-one", "bound-one", "bound-two"],
      },
      {
        id: "page-two",
        outputId: "social-output",
        name: "Two",
        width: 800,
        height: 600,
        background: "#eee",
        nodeIds: ["direct-two", "bound-current", "managed-other"],
      },
    ],
    nodes: [
      image("direct-one", localAssetId, from, 10),
      image("bound-one", localAssetId, from, 180),
      image("bound-two", localAssetId, from, 350),
      image("direct-two", localAssetId, from, 10),
      image("bound-current", localAssetId, from, 180),
      image("managed-other", otherAssetId, otherSource, 350),
    ],
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    components: [],
    componentInstances: [],
    variableBindings: [],
    groups: [
      {
        id: "media-group",
        pageId: "page-one",
        name: "Media",
        nodeIds: ["direct-one", "bound-one"],
      },
    ],
    fields: [
      {
        id: "shared-asset",
        key: "shared_asset",
        label: "Shared asset",
        type: "asset",
        required: true,
        defaultValue: from,
        agentDescription: "Used by two layers",
        validation: {},
      },
      {
        id: "default-only",
        key: "default_only",
        label: "Default only",
        type: "asset",
        required: false,
        defaultValue: from,
        agentDescription: "Its current value is different",
        validation: {},
      },
      {
        id: "current-only",
        key: "current_only",
        label: "Current only",
        type: "asset",
        required: false,
        defaultValue: otherSource,
        agentDescription: "Its default is different",
        validation: {},
      },
    ],
    fieldValues: {
      "shared-asset": from,
      "default-only": otherSource,
      "current-only": from,
    },
    bindings: [
      {
        id: "bind-one",
        fieldId: "shared-asset",
        nodeId: "bound-one",
        property: "src",
      },
      {
        id: "bind-two",
        fieldId: "shared-asset",
        nodeId: "bound-two",
        property: "src",
      },
      {
        id: "bind-current",
        fieldId: "current-only",
        nodeId: "bound-current",
        property: "src",
      },
    ],
  })
}

const commandFor = (document: Document) => ({
  id: "relink-local-portrait",
  type: "relink_asset_references" as const,
  actor: "human" as const,
  at,
  from,
  toAssetId,
  toSource,
  expectedReferenceKeys: assetReferenceKeysForSource(document, from),
})

const localCommandFor = (document: Document) => ({
  id: "reidentify-local-portrait",
  type: "relink_local_asset_references" as const,
  actor: "human" as const,
  at,
  from,
  toAssetId: replacementLocalAssetId,
  toSource: replacementLocalSource,
  expectedReferenceKeys: assetReferenceKeysForSource(document, from),
})

describe("asset reference extraction and relink", () => {
  it("extracts stable sorted node, field, page, output, and bound-projection references", () => {
    const document = mediaRelinkDocument()
    const references = extractAssetReferences(document)
    const local = references.filter((reference) => reference.source === from)

    expect(local.map((reference) => reference.key)).toEqual([
      "field/current-only/current",
      "field/default-only/default",
      "field/shared-asset/current",
      "field/shared-asset/default",
      "node/bound-current/src",
      "node/bound-one/src",
      "node/bound-two/src",
      "node/direct-one/src",
      "node/direct-two/src",
    ])
    expect(
      local.find((reference) => reference.key === "node/bound-current/src")
    ).toMatchObject({
      identity: "local",
      location: "node",
      assetId: localAssetId,
      fieldId: "current-only",
      pageIds: ["page-two"],
      outputIds: ["social-output"],
      projectedByBindingId: "bind-current",
    })
    expect(
      local.find((reference) => reference.key === "field/shared-asset/current")
    ).toMatchObject({
      projectedNodeIds: ["bound-one", "bound-two"],
      projectionBindingIds: ["bind-one", "bind-two"],
      pageIds: ["page-one"],
      outputIds: ["proposal-output"],
    })
    expect(
      references.find((reference) => reference.key === "node/managed-other/src")
    ).toMatchObject({
      identity: "managed",
      assetId: otherAssetId,
      source: otherSource,
    })
  })

  it("atomically relinks duplicate direct, field, and bound uses without changing other properties", () => {
    const document = mediaRelinkDocument()
    const updated = applyCommand(document, commandFor(document))
    const expected = structuredClone(document)
    expected.revision += 1
    expected.updatedAt = at
    for (const field of expected.fields) {
      if (field.type === "asset" && field.defaultValue === from) {
        field.defaultValue = toSource
      }
      if (expected.fieldValues[field.id] === from) {
        expected.fieldValues[field.id] = toSource
      }
    }
    for (const node of expected.nodes) {
      if (node.type === "image" && node.src === from) {
        node.src = toSource
        node.assetId = toAssetId
      }
    }

    expect(updated).toEqual(expected)
    expect(assetReferenceKeysForSource(updated, from)).toEqual([])
    expect(assetReferenceKeysForSource(updated, toSource)).toEqual(
      commandFor(document).expectedReferenceKeys
    )
    expect(updated.fieldValues["default-only"]).toBe(otherSource)
    expect(
      updated.fields.find((field) => field.id === "current-only")?.defaultValue
    ).toBe(otherSource)
    expect(updated.nodes.find((node) => node.id === "managed-other")).toEqual(
      document.nodes.find((node) => node.id === "managed-other")
    )
  })

  it("atomically reidentifies every local alias use while preserving all non-identity properties", () => {
    const document = mediaRelinkDocument()
    const command = localCommandFor(document)
    const updated = applyCommand(document, command)
    const expected = structuredClone(document)
    expected.revision += 1
    expected.updatedAt = at
    for (const field of expected.fields) {
      if (field.type === "asset" && field.defaultValue === from) {
        field.defaultValue = replacementLocalSource
      }
      if (expected.fieldValues[field.id] === from) {
        expected.fieldValues[field.id] = replacementLocalSource
      }
    }
    for (const node of expected.nodes) {
      if (node.type === "image" && node.src === from) {
        node.src = replacementLocalSource
        node.assetId = replacementLocalAssetId
      }
    }

    expect(updated).toEqual(expected)
    expect(documentSchema.parse(updated)).toEqual(updated)
    expect(assetReferenceKeysForSource(updated, from)).toEqual([])
    expect(
      assetReferenceKeysForSource(updated, replacementLocalSource)
    ).toEqual(command.expectedReferenceKeys)
    expect(
      extractAssetReferences(updated)
        .filter((reference) => reference.source === replacementLocalSource)
        .map(({ key, pageIds, outputIds, projectedNodeIds }) => ({
          key,
          pageIds,
          outputIds,
          projectedNodeIds,
        }))
    ).toEqual(
      extractAssetReferences(document)
        .filter((reference) => reference.source === from)
        .map(({ key, pageIds, outputIds, projectedNodeIds }) => ({
          key,
          pageIds,
          outputIds,
          projectedNodeIds,
        }))
    )
    expect(updated.nodes.find((node) => node.id === "managed-other")).toEqual(
      document.nodes.find((node) => node.id === "managed-other")
    )
    expect(updated.groups).toEqual(document.groups)
    expect(updated.pages).toEqual(document.pages)
    expect(updated.outputs).toEqual(document.outputs)
    expect(updated.bindings).toEqual(document.bindings)
  })

  it("requires a genuinely new coherent local identity so different bytes cannot reuse the old alias", () => {
    const document = mediaRelinkDocument()
    const command = localCommandFor(document)

    expect(() =>
      applyCommand(document, {
        ...command,
        toAssetId: localAssetId,
        toSource: from,
      })
    ).toThrow("must be distinct")
    expect(() =>
      applyCommand(document, {
        ...command,
        toSource: localAssetSource("another-local-identity"),
      })
    ).toThrow("new local asset identity is incoherent")

    const targetAlreadyUsed = structuredClone(document)
    const defaultOnly = targetAlreadyUsed.fields.find(
      (field) => field.id === "default-only"
    )
    if (!defaultOnly || defaultOnly.type !== "asset") {
      throw new Error("Expected an asset field")
    }
    defaultOnly.defaultValue = replacementLocalSource
    expect(() =>
      applyCommand(targetAlreadyUsed, localCommandFor(targetAlreadyUsed))
    ).toThrow("new local asset identity is already in use")
  })

  it("rejects stale local reidentity preflights, projection drift, and replay without partial mutation", () => {
    const document = mediaRelinkDocument()
    const command = localCommandFor(document)
    const before = structuredClone(document)

    expect(() =>
      applyCommand(document, {
        ...command,
        expectedReferenceKeys: command.expectedReferenceKeys.slice(1),
      })
    ).toThrow("reference set changed")
    expect(document).toEqual(before)

    const projectionDrift = structuredClone(document)
    projectionDrift.bindings.push({
      id: "bind-unrelated-managed-for-local-reidentity",
      fieldId: "default-only",
      nodeId: "managed-other",
      property: "src",
    })
    const unrelatedNode = projectionDrift.nodes.find(
      (node) => node.id === "managed-other"
    )
    if (!unrelatedNode || unrelatedNode.type !== "image") {
      throw new Error("Expected an image")
    }
    unrelatedNode.assetId = "asset-driftedmanaged02"
    unrelatedNode.src = managedAssetSource("asset-driftedmanaged02")
    const driftBefore = structuredClone(projectionDrift)
    expect(() =>
      applyCommand(projectionDrift, localCommandFor(projectionDrift))
    ).toThrow("unrelated field projection changes")
    expect(projectionDrift).toEqual(driftBefore)

    const updated = applyCommand(document, command)
    expect(() => applyCommand(updated, command)).toThrow("already in use")
  })

  it("rejects stale, missing, unsorted, and incoherent target reference sets", () => {
    const document = mediaRelinkDocument()
    const command = commandFor(document)

    expect(() =>
      applyCommand(document, {
        ...command,
        expectedReferenceKeys: command.expectedReferenceKeys.slice(1),
      })
    ).toThrow("reference set changed")
    expect(() =>
      applyCommand(document, {
        ...command,
        expectedReferenceKeys: [...command.expectedReferenceKeys].reverse(),
      })
    ).toThrow("unique and sorted")
    expect(() =>
      applyCommand(document, {
        ...command,
        from: "asset:local/not-used",
        expectedReferenceKeys: ["node/not-used/src"],
      })
    ).toThrow("no references")
    expect(() =>
      applyCommand(document, {
        ...command,
        toSource: managedAssetSource("asset-anothermanaged01"),
      })
    ).toThrow("managed asset identity is incoherent")
    expect(() =>
      applyCommand(document, {
        ...command,
        from: "asset:local/../escape" as typeof from,
      })
    ).toThrow()

    const updated = applyCommand(document, command)
    expect(() => applyCommand(updated, command)).toThrow("no references")
  })

  it("uses one bounded local alias contract for sources and field values", () => {
    expect(localAssetSource("a".repeat(128))).toBe(
      `asset:local/${"a".repeat(128)}`
    )
    expect(() => localAssetSource("a".repeat(129))).toThrow()
    expect(() => localAssetSource("../escape")).toThrow()

    const malformedField = structuredClone(mediaRelinkDocument())
    malformedField.fields[0]!.defaultValue = "asset:local/../escape"
    expect(() => documentSchema.parse(malformedField)).toThrow()
  })

  it("rejects incoherent local node identity and stale bound projections", () => {
    const incoherent = mediaRelinkDocument()
    const direct = incoherent.nodes.find((node) => node.id === "direct-one")!
    if (direct.type !== "image") throw new Error("Expected an image")
    direct.assetId = "different-local-id"
    expect(() => applyCommand(incoherent, commandFor(incoherent))).toThrow(
      "Local image assetId must match local-portrait-01"
    )

    const staleProjection = mediaRelinkDocument()
    staleProjection.fieldValues["shared-asset"] = otherSource
    expect(() =>
      applyCommand(staleProjection, commandFor(staleProjection))
    ).toThrow("not an exact projection")

    const staleNode = mediaRelinkDocument()
    const bound = staleNode.nodes.find((node) => node.id === "bound-one")!
    if (bound.type !== "image") throw new Error("Expected an image")
    bound.src = otherSource
    bound.assetId = otherAssetId
    expect(() => applyCommand(staleNode, commandFor(staleNode))).toThrow(
      "not an exact projection"
    )
  })

  it("keeps canonical bound-field projection coherent for local sources", () => {
    const document = mediaRelinkDocument()
    const replacementSource = localAssetSource("replacement-local")
    const projected = applyCommand(document, {
      id: "set-local-bound-field",
      type: "set_field",
      actor: "human",
      at,
      fieldId: "shared-asset",
      value: replacementSource,
    })

    for (const nodeId of ["bound-one", "bound-two"]) {
      expect(projected.nodes.find((node) => node.id === nodeId)).toMatchObject({
        assetId: "replacement-local",
        src: replacementSource,
      })
    }
    const relinked = applyCommand(projected, {
      ...commandFor(projected),
      from: replacementSource,
      expectedReferenceKeys: assetReferenceKeysForSource(
        projected,
        replacementSource
      ),
    })
    expect(assetReferenceKeysForSource(relinked, replacementSource)).toEqual([])
  })

  it("rejects unrelated bound projection drift instead of mutating it", () => {
    const document = mediaRelinkDocument()
    document.bindings.push({
      id: "bind-unrelated-managed",
      fieldId: "default-only",
      nodeId: "managed-other",
      property: "src",
    })
    const unrelatedNode = document.nodes.find(
      (node) => node.id === "managed-other"
    )!
    if (unrelatedNode.type !== "image") throw new Error("Expected an image")
    unrelatedNode.assetId = "asset-driftedmanaged01"
    unrelatedNode.src = managedAssetSource("asset-driftedmanaged01")
    const before = structuredClone(document)

    expect(() => applyCommand(document, commandFor(document))).toThrow(
      "unrelated field projection changes"
    )
    expect(document).toEqual(before)
  })

  it("rejects malformed and incoherent local image identities at admission", () => {
    const malformed = structuredClone(mediaRelinkDocument())
    const malformedNode = malformed.nodes.find(
      (node) => node.id === "direct-one"
    )!
    if (malformedNode.type !== "image") throw new Error("Expected an image")
    malformedNode.src = "asset:local/../escape"
    expect(() => documentSchema.parse(malformed)).toThrow(
      "Image asset source identity is malformed"
    )

    const incoherent = structuredClone(mediaRelinkDocument())
    const incoherentNode = incoherent.nodes.find(
      (node) => node.id === "direct-one"
    )!
    if (incoherentNode.type !== "image") throw new Error("Expected an image")
    incoherentNode.assetId = "another-local-id"
    expect(() => documentSchema.parse(incoherent)).toThrow(
      "Local image assetId must match local-portrait-01"
    )
  })

  it("keeps ordinary replacement guards for source-bound images", () => {
    const document = mediaRelinkDocument()
    expect(() =>
      applyCommand(document, {
        id: "ordinary-replace",
        type: "replace_image_source",
        actor: "human",
        at,
        nodeId: "bound-one",
        assetId: toAssetId,
        src: toSource,
      })
    ).toThrow("Shared asset controls this layer")
  })
})
