import { describe, expect, it } from "vitest"
import {
  applyLocalMediaAdmissionPlan,
  assetReferenceKeysForSource,
  documentSchema,
  LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT,
  localAssetSource,
  managedAssetSource,
  planLocalMediaAdmission,
  sceneNodeSchema,
  type Document,
  type LocalMediaAdmissionFact,
} from "../src"

const at = "2026-08-30T06:00:00.000Z"
const hashA = "a".repeat(64)
const hashB = "b".repeat(64)

const image = (id: string, localAssetId: string, x = 10) =>
  sceneNodeSchema.parse({
    id,
    type: "image",
    name: id,
    assetId: localAssetId,
    src: localAssetSource(localAssetId),
    alt: id,
    altProvenance: "authored",
    decorative: false,
    placement: {
      mode: "manual",
      focalX: 0.4,
      focalY: 0.6,
      zoom: 1.25,
      rotation: 4,
      flipX: false,
      flipY: true,
    },
    frameMask: { shape: "ellipse" },
    x,
    y: 20,
    width: 180,
    height: 120,
    rotation: 2,
    opacity: 0.85,
    visible: true,
    locked: false,
  })

function admissionDocument(
  assetIds: readonly string[] = ["local-alpha", "local-zeta"]
): Document {
  const [alpha = "local-alpha", zeta = alpha] = assetIds
  const alphaSource = localAssetSource(alpha)
  const zetaSource = localAssetSource(zeta)
  const nodes = assetIds.map((assetId, index) =>
    image(`node-${index}`, assetId, 20 + index * 200)
  )
  if (assetIds.length === 2) {
    nodes.push(image("alpha-bound", alpha, 420))
  }
  return documentSchema.parse({
    schemaVersion: 5,
    id: "media-admission-document",
    name: "Admission fixture",
    revision: 11,
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
        nodeIds: nodes
          .filter((_, index) => index % 2 === 0)
          .map((node) => node.id),
      },
      {
        id: "page-two",
        outputId: "social-output",
        name: "Two",
        width: 1080,
        height: 1080,
        background: "#eee",
        nodeIds: nodes
          .filter((_, index) => index % 2 === 1)
          .map((node) => node.id),
      },
    ],
    nodes,
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    components: [],
    componentInstances: [],
    variableBindings: [],
    groups: [
      {
        id: "media-group",
        role: "organize",
        pageId: "page-one",
        name: "Media",
        nodeIds: nodes.length ? [nodes[0]!.id] : [],
      },
    ],
    fields:
      assetIds.length === 2
        ? [
            {
              id: "alpha-field",
              key: "alpha_field",
              label: "Alpha image",
              type: "asset",
              required: true,
              defaultValue: alphaSource,
              agentDescription: "Bound alpha image",
              validation: {},
            },
            {
              id: "zeta-default",
              key: "zeta_default",
              label: "Zeta default",
              type: "asset",
              required: false,
              defaultValue: zetaSource,
              agentDescription: "Default-only zeta image",
              validation: {},
            },
          ]
        : [],
    fieldValues:
      assetIds.length === 2
        ? {
            "alpha-field": alphaSource,
            "zeta-default": "",
          }
        : {},
    bindings:
      assetIds.length === 2
        ? [
            {
              id: "alpha-source-binding",
              fieldId: "alpha-field",
              nodeId: "alpha-bound",
              property: "src",
            },
          ]
        : [],
  })
}

const mapping = (
  suffix: string,
  status: "ready" | "archived" = "ready",
  contentSha256 = hashA
) => {
  const managedAssetId = `asset-managed-${suffix.padEnd(10, "x")}`
  return {
    status,
    managedAssetId,
    managedSource: managedAssetSource(managedAssetId),
    contentSha256,
  } as const
}

const fact = (
  localAssetId: string,
  local: LocalMediaAdmissionFact["local"],
  mappingState: LocalMediaAdmissionFact["mapping"],
  localContentSha256?: string
): LocalMediaAdmissionFact => ({
  localAssetId,
  local,
  mapping: mappingState,
  ...(localContentSha256 === undefined ? {} : { localContentSha256 }),
})

function singleAliasPlan(input: LocalMediaAdmissionFact) {
  return planLocalMediaAdmission(admissionDocument([input.localAssetId]), [
    input,
  ])
}

describe("local media admission planning", () => {
  it("projects ready mapped files by exact hash and never by metadata guesses", () => {
    const same = singleAliasPlan(
      fact("local-alpha", { status: "ready" }, mapping("alpha"), hashA)
    )
    expect(same).toMatchObject({
      ok: true,
      plan: {
        aliasOrder: ["local-alpha"],
        safeMigrations: [
          {
            localAssetId: "local-alpha",
            localStatus: "ready",
            managedStatus: "ready",
            relationship: "same_hash",
            outcome: "safe_migration",
          },
        ],
        unresolved: [],
      },
    })

    const different = singleAliasPlan(
      fact("local-alpha", { status: "ready" }, mapping("alpha"), hashB)
    )
    expect(different).toMatchObject({
      ok: true,
      plan: {
        safeMigrations: [],
        unresolved: [
          {
            localAssetId: "local-alpha",
            outcome: "identity_conflict",
            managedCandidate: { managedStatus: "ready" },
          },
        ],
      },
    })

    const archivedSame = singleAliasPlan(
      fact(
        "local-alpha",
        { status: "ready" },
        mapping("alpha-archive", "archived"),
        hashA
      )
    )
    expect(archivedSame).toMatchObject({
      ok: true,
      plan: {
        safeMigrations: [
          { managedStatus: "archived", relationship: "same_hash" },
        ],
      },
    })
  })

  it.each(["missing_bytes", "absent", "quarantined"] as const)(
    "safely recovers %s local media from ready and archived Studio copies",
    (localStatus) => {
      for (const managedStatus of ["ready", "archived"] as const) {
        const result = singleAliasPlan(
          fact(
            "local-alpha",
            { status: localStatus },
            mapping(`${localStatus}-${managedStatus}`, managedStatus)
          )
        )
        expect(result).toMatchObject({
          ok: true,
          plan: {
            safeMigrations: [
              {
                localStatus,
                managedStatus,
                relationship: "no_local_bytes",
              },
            ],
            unresolved: [],
          },
        })
      }
    }
  )

  it("keeps ready unmapped media local and missing unmapped media recoverable", () => {
    const ready = singleAliasPlan(
      fact("local-alpha", { status: "ready" }, { status: "unmapped" })
    )
    expect(ready).toMatchObject({
      ok: true,
      plan: { unresolved: [{ outcome: "local_only" }] },
    })

    for (const localStatus of [
      "missing_bytes",
      "absent",
      "quarantined",
    ] as const) {
      const missing = singleAliasPlan(
        fact("local-alpha", { status: localStatus }, { status: "unmapped" })
      )
      expect(missing).toMatchObject({
        ok: true,
        plan: {
          unresolved: [
            {
              localStatus,
              outcome: "missing_unmapped",
              managedCandidate: null,
            },
          ],
        },
      })
    }
  })

  it("does not misreport unavailable repositories as unmapped", () => {
    for (const localStatus of ["ready", "missing_bytes"] as const) {
      const mappingUnavailable = singleAliasPlan(
        fact("local-alpha", { status: localStatus }, { status: "unavailable" })
      )
      expect(mappingUnavailable).toMatchObject({
        ok: true,
        plan: {
          unresolved: [
            {
              localStatus,
              mappingStatus: "unavailable",
              outcome: "mapping_unavailable",
            },
          ],
        },
      })
    }

    for (const mappingState of [
      mapping("ready-candidate"),
      mapping("archived-candidate", "archived"),
      { status: "unmapped" } as const,
      { status: "unavailable" } as const,
    ]) {
      const localUnavailable = singleAliasPlan(
        fact("local-alpha", { status: "unavailable" }, mappingState)
      )
      expect(localUnavailable).toMatchObject({
        ok: true,
        plan: {
          safeMigrations: [],
          unresolved: [
            {
              localStatus: "unavailable",
              mappingStatus: mappingState.status,
              outcome: "local_unavailable",
              managedCandidate:
                mappingState.status === "ready" ||
                mappingState.status === "archived"
                  ? { managedStatus: mappingState.status }
                  : null,
            },
          ],
        },
      })
    }
  })

  it("requires complete canonical facts in exact sorted alias order", () => {
    const document = admissionDocument()
    const alpha = fact(
      "local-alpha",
      { status: "ready" },
      mapping("alpha"),
      hashA
    )
    const zeta = fact(
      "local-zeta",
      { status: "absent" },
      { status: "unmapped" }
    )

    expect(planLocalMediaAdmission(document, [alpha])).toEqual({
      ok: false,
      reason: "local_media_admission_facts_mismatch",
    })
    expect(planLocalMediaAdmission(document, [zeta, alpha])).toEqual({
      ok: false,
      reason: "local_media_admission_facts_mismatch",
    })
    expect(
      planLocalMediaAdmission(document, [
        {
          ...alpha,
          mapping: {
            ...mapping("alpha"),
            managedSource: managedAssetSource("asset-managed-wrongxxxxx"),
          },
        },
        zeta,
      ])
    ).toEqual({
      ok: false,
      reason: "local_media_admission_facts_invalid",
    })
    expect(
      planLocalMediaAdmission(document, [
        {
          localAssetId: "local-alpha",
          local: { status: "ready" },
          mapping: mapping("alpha"),
        } as LocalMediaAdmissionFact,
        zeta,
      ])
    ).toEqual({
      ok: false,
      reason: "local_media_admission_facts_invalid",
    })
    expect(
      planLocalMediaAdmission(document, [
        {
          ...alpha,
          fileName: "must-not-cross-the-domain-boundary.png",
        } as LocalMediaAdmissionFact,
        zeta,
      ])
    ).toEqual({
      ok: false,
      reason: "local_media_admission_facts_invalid",
    })

    const projected = planLocalMediaAdmission(document, [alpha, zeta])
    if (!projected.ok) throw new Error(projected.reason)
    expect(projected.plan.aliasOrder).toEqual(["local-alpha", "local-zeta"])
    expect(projected.plan.safeMigrations[0]?.expectedReferenceKeys).toEqual([
      "field/alpha-field/current",
      "field/alpha-field/default",
      "node/alpha-bound/src",
      "node/node-0/src",
    ])
    expect(projected.plan.unresolved[0]?.expectedReferenceKeys).toEqual([
      "field/zeta-default/default",
      "node/node-1/src",
    ])
  })

  it("applies every safe alias to one isolated canonical candidate and preserves unresolved identity", () => {
    const document = admissionDocument()
    const result = planLocalMediaAdmission(document, [
      fact("local-alpha", { status: "ready" }, mapping("alpha"), hashA),
      fact("local-zeta", { status: "absent" }, mapping("zeta", "archived")),
    ])
    if (!result.ok) throw new Error(result.reason)
    const applied = applyLocalMediaAdmissionPlan(document, result.plan, {
      operationId: "admission-operation-01",
      at,
    })
    if (!applied.ok) throw new Error(applied.reason)

    expect(applied.status).toBe("applied")
    expect(applied.appliedLocalAssetIds).toEqual(["local-alpha", "local-zeta"])
    expect(applied.document.revision).toBe(document.revision + 2)
    expect(applied.document.updatedAt).toBe(at)
    expect(
      assetReferenceKeysForSource(
        applied.document,
        localAssetSource("local-alpha")
      )
    ).toEqual([])
    expect(
      assetReferenceKeysForSource(
        applied.document,
        managedAssetSource("asset-managed-alphaxxxxx")
      )
    ).toEqual(result.plan.safeMigrations[0]!.expectedReferenceKeys)
    expect(applied.document.groups).toEqual(document.groups)
    expect(applied.document.pages).toEqual(document.pages)
    expect(applied.document.outputs).toEqual(document.outputs)
    expect(applied.document.bindings).toEqual(document.bindings)
    const expected = structuredClone(document)
    expected.revision += 2
    expected.updatedAt = at
    const targets = new Map<
      string,
      { assetId: string; source: `asset:managed/${string}` }
    >([
      [
        localAssetSource("local-alpha"),
        {
          assetId: "asset-managed-alphaxxxxx",
          source: managedAssetSource("asset-managed-alphaxxxxx"),
        },
      ],
      [
        localAssetSource("local-zeta"),
        {
          assetId: "asset-managed-zetaxxxxxx",
          source: managedAssetSource("asset-managed-zetaxxxxxx"),
        },
      ],
    ])
    for (const field of expected.fields) {
      if (field.type !== "asset") continue
      const defaultTarget =
        typeof field.defaultValue === "string"
          ? targets.get(field.defaultValue)
          : undefined
      if (defaultTarget) field.defaultValue = defaultTarget.source
      const currentTarget = targets.get(String(expected.fieldValues[field.id]))
      if (currentTarget) expected.fieldValues[field.id] = currentTarget.source
    }
    for (const node of expected.nodes) {
      if (node.type !== "image") continue
      const target = targets.get(node.src)
      if (!target) continue
      node.assetId = target.assetId
      node.src = target.source
    }
    expect(applied.document).toEqual(expected)

    const mixed = planLocalMediaAdmission(document, [
      fact("local-alpha", { status: "ready" }, mapping("alpha"), hashA),
      fact("local-zeta", { status: "absent" }, { status: "unmapped" }),
    ])
    if (!mixed.ok) throw new Error(mixed.reason)
    const mixedApplied = applyLocalMediaAdmissionPlan(document, mixed.plan, {
      operationId: "admission-operation-02",
      at,
    })
    if (!mixedApplied.ok) throw new Error(mixedApplied.reason)
    expect(
      assetReferenceKeysForSource(
        mixedApplied.document,
        localAssetSource("local-zeta")
      )
    ).toEqual(
      mixed.plan.unresolved.find((alias) => alias.localAssetId === "local-zeta")
        ?.expectedReferenceKeys
    )
  })

  it("returns no candidate when any safe alias application is stale or malformed", () => {
    const document = admissionDocument()
    const planned = planLocalMediaAdmission(document, [
      fact("local-alpha", { status: "ready" }, mapping("alpha"), hashA),
      fact("local-zeta", { status: "absent" }, mapping("zeta")),
    ])
    if (!planned.ok) throw new Error(planned.reason)
    const forgedPlan = {
      ...planned.plan,
      safeMigrations: planned.plan.safeMigrations.map((migration, index) =>
        index === 1
          ? { ...migration, expectedReferenceKeys: ["node/stale/src"] }
          : migration
      ),
    }
    const before = structuredClone(document)
    const rejected = applyLocalMediaAdmissionPlan(document, forgedPlan, {
      operationId: "admission-operation-03",
      at,
    })

    expect(rejected).toEqual({
      ok: false,
      reason: "local_media_admission_candidate_rejected",
      failedLocalAssetId: "local-zeta",
    })
    expect("document" in rejected).toBe(false)
    expect(document).toEqual(before)

    expect(
      applyLocalMediaAdmissionPlan(
        { ...document, revision: document.revision + 1 },
        planned.plan,
        { operationId: "admission-operation-03", at }
      )
    ).toMatchObject({ ok: false, reason: "local_media_admission_plan_stale" })
  })

  it("refuses more than the bounded canonical alias limit before facts are considered", () => {
    const assetIds = Array.from(
      { length: LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT + 1 },
      (_, index) => `local-${index}`
    )
    const document = admissionDocument(assetIds)

    expect(planLocalMediaAdmission(document, [])).toEqual({
      ok: false,
      reason: "local_media_alias_limit_exceeded",
    })
  })
})
