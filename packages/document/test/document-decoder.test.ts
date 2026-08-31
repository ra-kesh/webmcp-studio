import { describe, expect, it } from "vitest"
import {
  DocumentMigrationError,
  applyCommand,
  createTemplateVersion,
  decodeDocument,
  decodeTemplateVersion,
  documentSchema,
  migrateTemplateVersionForRepublication,
  northstarSeed,
} from "../src"

function legacyDocument(document = northstarSeed): Record<string, unknown> {
  const clone = structuredClone(document) as any
  clone.schemaVersion = 1
  delete clone.components
  delete clone.componentInstances
  clone.nodes = clone.nodes.map((node: any) => {
    if (node.type !== "image") return node
    const legacy = {
      ...node,
      fit: node.placement.mode === "fit" ? "contain" : "cover",
      cropX: node.placement.focalX,
      cropY: node.placement.focalY,
    }
    delete legacy.placement
    delete legacy.frameMask
    delete legacy.decorative
    return legacy
  })
  clone.fields = clone.fields.map((field: any) => {
    const {
      agentDescription: _agentDescription,
      validation: _validation,
      ...legacy
    } = field
    return legacy
  })
  clone.groups = clone.groups.map((group: any) => {
    const { role: _role, mask: _mask, ...legacy } = group
    return legacy
  })
  return clone
}

describe("persisted document compatibility decoding", () => {
  it("requires explicit strict v5 group roles and nonempty mask sources", () => {
    const current = structuredClone(decodeDocument(northstarSeed).document)
    current.groups.push({
      id: "strict-v5-group",
      role: "organize",
      pageId: "cover",
      name: "Strict v5 group",
      nodeIds: ["cover-panel", "cover-eyebrow"],
    })
    const group = current.groups[0]
    if (!group || group.nodeIds.length === 0) {
      throw new Error("Expected a grouped Northstar fixture")
    }

    expect(() =>
      documentSchema.parse({
        ...current,
        groups: [
          {
            id: group.id,
            pageId: group.pageId,
            name: group.name,
            nodeIds: group.nodeIds,
          },
        ],
      })
    ).toThrow()
    expect(() =>
      documentSchema.parse({
        ...current,
        groups: [
          {
            ...group,
            role: "mask",
            mask: { type: "vector", sourceNodeIds: [] },
          },
        ],
      })
    ).toThrow()
    expect(
      documentSchema.parse({
        ...current,
        groups: [
          {
            ...group,
            role: "mask",
            mask: {
              type: "luminance",
              sourceNodeIds: [group.nodeIds[0]],
            },
          },
        ],
      }).groups[0]
    ).toMatchObject({
      role: "mask",
      mask: { type: "luminance", sourceNodeIds: [group.nodeIds[0]] },
    })
  })

  it("migrates writable schemaVersion 4 groups to explicit organize roles", () => {
    const persisted = structuredClone(northstarSeed) as any
    persisted.schemaVersion = 4
    persisted.groups = persisted.groups.map((group: any) => {
      const { role: _role, mask: _mask, ...legacy } = group
      return legacy
    })
    const before = structuredClone(persisted)

    const decoded = decodeDocument(persisted)

    expect(persisted).toEqual(before)
    expect(decoded.document.schemaVersion).toBe(5)
    expect(decoded.document.groups).toEqual(
      persisted.groups.map((group: any) => ({ ...group, role: "organize" }))
    )
    expect(decoded.migrations).toEqual([
      {
        code: "legacy_group_roles_initialized",
        message:
          "Document schema version 4 groups received explicit organize roles",
      },
      {
        code: "document_schema_upgraded",
        message: "Document schema was upgraded from version 4 to version 5",
      },
    ])
  })

  it("rewrites early schemaVersion 3 drafts that predate reusable resources", () => {
    const persisted = structuredClone(northstarSeed) as any
    persisted.schemaVersion = 3
    delete persisted.typographyStyles
    delete persisted.paintStyles
    delete persisted.variables
    delete persisted.variableBindings
    delete persisted.components
    delete persisted.componentInstances
    const before = structuredClone(persisted)

    const decoded = decodeDocument(persisted)

    expect(persisted).toEqual(before)
    expect(decoded.document).toMatchObject({
      schemaVersion: 5,
      typographyStyles: [],
      paintStyles: [],
      variables: [],
      variableBindings: [],
      components: [],
      componentInstances: [],
    })
    expect(decoded.migrations.map((migration) => migration.code)).toEqual([
      "legacy_design_resources_initialized",
      "legacy_variable_bindings_initialized",
      "legacy_components_initialized",
      "legacy_group_roles_initialized",
      "document_schema_upgraded",
    ])
  })

  it("migrates schemaVersion 2 rich-text storage explicitly", () => {
    const persisted = structuredClone(northstarSeed) as any
    persisted.schemaVersion = 2
    for (const node of persisted.nodes) {
      if (node.type !== "text") continue
      delete node.runs
      delete node.paragraphs
      delete node.links
    }
    delete persisted.typographyStyles
    delete persisted.paintStyles
    delete persisted.variables
    delete persisted.variableBindings
    delete persisted.components
    delete persisted.componentInstances
    const before = structuredClone(persisted)

    const decoded = decodeDocument(persisted)

    expect(persisted).toEqual(before)
    expect(decoded.document.schemaVersion).toBe(5)
    expect(
      decoded.document.nodes
        .filter((node) => node.type === "text")
        .every(
          (node) =>
            node.runs.length === 0 &&
            node.paragraphs.length === 0 &&
            node.links.length === 0
        )
    ).toBe(true)
    expect(decoded.document).toMatchObject({
      typographyStyles: [],
      paintStyles: [],
      variables: [],
      variableBindings: [],
    })
    expect(decoded.migrations.map((migration) => migration.code)).toEqual(
      expect.arrayContaining([
        "legacy_rich_text_initialized",
        "legacy_design_resources_initialized",
        "legacy_variable_bindings_initialized",
        "legacy_components_initialized",
        "legacy_group_roles_initialized",
        "document_schema_upgraded",
      ])
    )
  })

  it("requires republishing an immutable schemaVersion 2 template", () => {
    const version = createTemplateVersion(northstarSeed, {
      id: "version-schema-two",
      templateId: "northstar",
      version: 1,
      sourceSnapshotId: `sha256-${"2".repeat(64)}`,
      publishedAt: "2026-08-28T11:00:00.000Z",
    }) as any
    version.document.schemaVersion = 2

    expect(() => decodeTemplateVersion(version)).toThrow(
      "Published schemaVersion 2 template versions are immutable"
    )
  })

  it("requires republishing an immutable schemaVersion 3 template", () => {
    const version = createTemplateVersion(northstarSeed, {
      id: "version-schema-three",
      templateId: "northstar",
      version: 1,
      sourceSnapshotId: `sha256-${"3".repeat(64)}`,
      publishedAt: "2026-08-28T11:00:00.000Z",
    }) as any
    version.document.schemaVersion = 3

    expect(() => decodeTemplateVersion(version)).toThrow(
      "Published schemaVersion 3 template versions are immutable"
    )
  })

  it("rejects an immutable schemaVersion 4 template but migrates it on republication", () => {
    const current = decodeDocument(northstarSeed).document
    const version = createTemplateVersion(current, {
      id: "version-schema-four",
      templateId: "northstar",
      version: 1,
      sourceSnapshotId: `sha256-${"4".repeat(64)}`,
      publishedAt: "2026-08-28T11:00:00.000Z",
    }) as any
    version.document.schemaVersion = 4
    version.document.groups = version.document.groups.map((group: any) => {
      const { role: _role, mask: _mask, ...legacy } = group
      return legacy
    })
    const before = structuredClone(version)

    expect(() => decodeTemplateVersion(version)).toThrow(
      "Published schemaVersion 4 template versions are immutable"
    )
    expect(version).toEqual(before)

    const republished = migrateTemplateVersionForRepublication(version, {
      id: "version-schema-four-republished",
      templateId: "northstar",
      version: 2,
      sourceSnapshotId: `sha256-${"5".repeat(64)}`,
      publishedAt: "2026-08-28T12:00:00.000Z",
    })
    expect(republished.version.document.schemaVersion).toBe(5)
    expect(
      republished.version.document.groups.every(
        (group) => group.role === "organize"
      )
    ).toBe(true)
    expect(republished.migrations.map((migration) => migration.code)).toEqual([
      "legacy_group_roles_initialized",
      "document_schema_upgraded",
      "template_manifest_recomputed",
    ])
  })

  it("normalizes a writable legacy managed image to one canonical identity", () => {
    const persisted = structuredClone(northstarSeed) as any
    persisted.nodes.push({
      id: "legacy-managed-image",
      type: "image",
      name: "Legacy managed image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "asset-aaaaaaaaaa",
      src: "asset:managed/asset-bbbbbbbbbb",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      alt: "",
      decorative: false,
    })
    persisted.pages[0].nodeIds.push("legacy-managed-image")
    const before = structuredClone(persisted)

    const decoded = decodeDocument(persisted)

    expect(persisted).toEqual(before)
    expect(
      decoded.document.nodes.find((node) => node.id === "legacy-managed-image")
    ).toMatchObject({
      assetId: "asset-bbbbbbbbbb",
      src: "asset:managed/asset-bbbbbbbbbb",
    })
    expect(decoded.migrations).toContainEqual(
      expect.objectContaining({
        code: "legacy_managed_image_identity_normalized",
        nodeId: "legacy-managed-image",
      })
    )
  })

  it("migrates legacy cover placement and accessibility intent to schemaVersion 4", () => {
    const persisted = legacyDocument() as any
    persisted.nodes.push({
      id: "legacy-cover-image",
      type: "image",
      name: "Legacy cover image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "asset-legacy-cover",
      src: "https://assets.example.test/legacy-cover.png",
      fit: "cover",
      cropX: 0.2,
      cropY: 0.8,
      alt: "",
    })
    persisted.pages[0].nodeIds.push("legacy-cover-image")
    const before = structuredClone(persisted)

    const decoded = decodeDocument(persisted)

    expect(persisted).toEqual(before)
    expect(decoded.document.schemaVersion).toBe(5)
    expect(
      decoded.document.nodes.find((node) => node.id === "legacy-cover-image")
    ).toMatchObject({
      placement: {
        mode: "fill",
        focalX: 0.2,
        focalY: 0.8,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      decorative: false,
    })
    expect(decoded.migrations.map((migration) => migration.code)).toEqual(
      expect.arrayContaining([
        "legacy_image_placement_migrated",
        "legacy_image_frame_mask_defaulted",
        "legacy_image_accessibility_unresolved",
        "legacy_group_roles_initialized",
        "document_schema_upgraded",
      ])
    )
  })

  it("normalizes recognizable legacy dates without mutating input bytes", () => {
    const legacy = legacyDocument() as any
    const field = legacy.fields.find(
      (candidate: any) => candidate.id === "event_date"
    )
    field.type = "date"
    field.defaultValue = "18 January 2027"
    legacy.fieldValues.event_date = "19/01/2027"
    const before = structuredClone(legacy)

    const decoded = decodeDocument(legacy)
    expect(legacy).toEqual(before)
    expect(
      decoded.document.fields.find((candidate) => candidate.id === "event_date")
    ).toMatchObject({ type: "date", defaultValue: "2027-01-18" })
    expect(decoded.document.fieldValues.event_date).toBe("2027-01-19")
    expect(
      decoded.document.nodes.find((node) => node.id === "cover-date")
    ).toMatchObject({ text: "19 January 2027" })
    expect(decoded.migrations).toContainEqual(
      expect.objectContaining({
        code: "legacy_date_normalized",
        fieldId: "event_date",
      })
    )
  })

  it("preserves non-INR legacy currency as text instead of relabeling it INR", () => {
    const legacy = legacyDocument() as any
    const field = legacy.fields.find(
      (candidate: any) => candidate.id === "package_price"
    )
    field.defaultValue = "USD 4,500"
    legacy.fieldValues.package_price = "$5,000"

    const decoded = decodeDocument(legacy)
    expect(
      decoded.document.fields.find(
        (candidate) => candidate.id === "package_price"
      )
    ).toMatchObject({ type: "text", defaultValue: "USD 4,500" })
    expect(decoded.document.fieldValues.package_price).toBe("$5,000")
    expect(
      decoded.document.nodes.find((node) => node.id === "package-price")
    ).toMatchObject({ text: "$5,000" })
    expect(decoded.migrations).toContainEqual(
      expect.objectContaining({
        code: "legacy_field_preserved_as_text",
        fieldId: "package_price",
      })
    )
  })

  it("normalizes writable legacy numeric currency and preserves excessive precision as text", () => {
    const normal = legacyDocument() as any
    const normalField = normal.fields.find(
      (candidate: any) => candidate.id === "package_price"
    )
    normalField.defaultValue = 1e21
    normal.fieldValues.package_price = 12.5
    const normalized = decodeDocument(normal)
    expect(
      normalized.document.fields.find((field) => field.id === "package_price")
    ).toMatchObject({
      type: "currency",
      defaultValue: "1000000000000000000000",
    })
    expect(normalized.document.fieldValues.package_price).toBe("12.5")
    expect(normalized.migrations).toContainEqual(
      expect.objectContaining({ code: "legacy_currency_normalized" })
    )

    const tiny = legacyDocument() as any
    const tinyField = tiny.fields.find(
      (candidate: any) => candidate.id === "package_price"
    )
    tinyField.defaultValue = 1e-7
    tiny.fieldValues.package_price = 1e-7
    const preserved = decodeDocument(tiny)
    expect(
      preserved.document.fields.find((field) => field.id === "package_price")
    ).toMatchObject({ type: "text", defaultValue: "1e-7" })
    expect(preserved.document.fieldValues.package_price).toBe("1e-7")
  })

  it("normalizes supported formatted INR strings to canonical decimal storage", () => {
    const persisted = structuredClone(northstarSeed) as any
    persisted.schemaVersion = 4
    const field = persisted.fields.find(
      (candidate: any) => candidate.id === "package_price"
    )
    field.defaultValue = "INR 3,85,000.50"
    persisted.fieldValues.package_price = "₹3,85,000.50"

    const decoded = decodeDocument(persisted)

    expect(
      decoded.document.fields.find(
        (candidate) => candidate.id === "package_price"
      )?.defaultValue
    ).toBe("385000.50")
    expect(decoded.document.fieldValues.package_price).toBe("385000.50")
    expect(decoded.migrations).toContainEqual(
      expect.objectContaining({
        code: "legacy_currency_normalized",
        fieldId: "package_price",
      })
    )
  })

  it("preserves an unbound unsafe legacy asset as text and rejects a bound one", () => {
    const unbound = legacyDocument() as any
    unbound.fields.push({
      id: "legacy-asset",
      key: "legacy_asset",
      label: "Legacy asset",
      type: "asset",
      required: false,
      defaultValue: "ftp://legacy.example.test/image.png",
    })
    unbound.fieldValues["legacy-asset"] = "ftp://legacy.example.test/image.png"
    const preserved = decodeDocument(unbound)
    expect(
      preserved.document.fields.find((field) => field.id === "legacy-asset")
    ).toMatchObject({
      type: "text",
      defaultValue: "ftp://legacy.example.test/image.png",
    })

    const withImage = applyCommand(northstarSeed, {
      id: "add-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      pageId: "cover",
      node: {
        id: "legacy-image",
        type: "image",
        name: "Legacy image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId: "legacy-image",
        src: "https://assets.example.test/image.png",
        placement: {
          mode: "fill",
          focalX: 0.5,
          focalY: 0.5,
          zoom: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        frameMask: { shape: "rectangle" },
        alt: "Legacy image",
        decorative: false,
      },
    })
    const withField = applyCommand(withImage, {
      id: "add-asset-field",
      type: "add_field",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      field: {
        id: "legacy-asset",
        key: "legacy_asset",
        label: "Legacy asset",
        type: "asset",
        required: true,
        defaultValue: "https://assets.example.test/image.png",
        agentDescription: "Legacy portrait",
        validation: {},
      },
    })
    const bound = applyCommand(withField, {
      id: "bind-asset-field",
      type: "bind_field",
      actor: "human",
      at: "2026-08-28T12:02:00.000Z",
      binding: {
        id: "bind-legacy-asset",
        fieldId: "legacy-asset",
        nodeId: "legacy-image",
        property: "src",
      },
    })
    const unsafe = legacyDocument(bound) as any
    const unsafeField = unsafe.fields.find(
      (candidate: any) => candidate.id === "legacy-asset"
    )
    unsafeField.defaultValue = "ftp://legacy.example.test/image.png"
    unsafe.fieldValues["legacy-asset"] = "ftp://legacy.example.test/image.png"
    expect(() => decodeDocument(unsafe)).toThrow(DocumentMigrationError)
  })

  it("promotes legacy text fill bindings to color without dropping the binding", () => {
    const legacy = legacyDocument() as any
    legacy.fields.push({
      id: "legacy-accent",
      key: "legacy_accent",
      label: "Legacy accent",
      type: "text",
      required: true,
      defaultValue: "#223329",
    })
    legacy.fieldValues["legacy-accent"] = "#33443a"
    legacy.bindings.push({
      id: "bind-legacy-accent",
      fieldId: "legacy-accent",
      nodeId: "cover-panel",
      property: "fill",
    })

    const decoded = decodeDocument(legacy)
    expect(
      decoded.document.fields.find((field) => field.id === "legacy-accent")
    ).toMatchObject({ type: "color" })
    expect(decoded.document.bindings).toContainEqual(
      expect.objectContaining({ id: "bind-legacy-accent", property: "fill" })
    )
    expect(
      decoded.document.nodes.find((node) => node.id === "cover-panel")
    ).toMatchObject({ fill: "#33443a" })
  })

  it("migrates legacy template data only under a replacement publication identity", () => {
    const version = createTemplateVersion(northstarSeed, {
      id: "version-legacy-fields",
      templateId: "northstar",
      version: 1,
      sourceSnapshotId: `sha256-${"a".repeat(64)}`,
      publishedAt: "2026-08-28T12:00:00.000Z",
    })
    const persisted = structuredClone(version) as any
    persisted.document = legacyDocument(version.document)
    const field = persisted.document.fields.find(
      (candidate: any) => candidate.id === "event_date"
    )
    field.type = "date"
    field.defaultValue = "18 January 2027"
    persisted.document.fieldValues.event_date = "18 January 2027"

    const decoded = migrateTemplateVersionForRepublication(persisted, {
      id: "version-migrated-fields",
      templateId: "northstar",
      version: 2,
      sourceSnapshotId: `sha256-${"d".repeat(64)}`,
      publishedAt: "2026-08-28T14:00:00.000Z",
    })
    expect(decoded.version).toMatchObject({
      id: "version-migrated-fields",
      version: 2,
      sourceSnapshotId: `sha256-${"d".repeat(64)}`,
    })
    expect(
      decoded.version.document.fields.find(
        (candidate) => candidate.id === "event_date"
      )
    ).toMatchObject({ type: "date", defaultValue: "2027-01-18" })
    expect(
      decoded.version.manifest.parameters.find(
        (parameter) => parameter.id === "event_date"
      )
    ).toMatchObject({
      type: "date",
      defaultValue: "2027-01-18",
      agentDescription: "",
      validation: {},
    })
    expect(decoded.migrations.at(-1)?.code).toBe("template_manifest_recomputed")
  })

  it("preserves a validated public manifest when its document needs no migration", () => {
    const version = createTemplateVersion(northstarSeed, {
      id: "version-public-manifest",
      templateId: "northstar",
      version: 2,
      sourceSnapshotId: `sha256-${"b".repeat(64)}`,
      publishedAt: "2026-08-28T13:00:00.000Z",
    })
    const persisted = structuredClone(version)
    const parameter = persisted.manifest.parameters[0]
    if (!parameter) throw new Error("Expected a published parameter")
    persisted.manifest.parameters[0] = {
      ...parameter,
      type: "asset",
      defaultValue: "olive-botanical",
      exampleValue: "olive-botanical",
      validation: {},
    }

    const decoded = decodeTemplateVersion(persisted)

    expect(decoded.migrations).toEqual([])
    expect(decoded.version).toEqual(persisted)
    expect(decoded.version.manifest.parameters[0]).toMatchObject({
      type: "asset",
      defaultValue: "olive-botanical",
      exampleValue: "olive-botanical",
    })
  })

  it("never rewrites formatted currency under an immutable publication identity", () => {
    const persisted = createTemplateVersion(northstarSeed, {
      id: "version-immutable-currency",
      templateId: "northstar",
      version: 3,
      sourceSnapshotId: `sha256-${"e".repeat(64)}`,
      publishedAt: "2026-08-28T15:00:00.000Z",
    })
    const currency = persisted.document.fields.find(
      (field) => field.id === "package_price"
    )
    if (!currency) throw new Error("Expected the currency field")
    currency.defaultValue = "₹3,85,000"
    persisted.document.fieldValues.package_price = "₹3,85,000"
    const before = JSON.stringify(persisted)

    const decoded = decodeTemplateVersion(persisted)

    expect(JSON.stringify(decoded.version)).toBe(before)
    expect(decoded.version.sourceSnapshotId).toBe(`sha256-${"e".repeat(64)}`)
    expect(decoded.migrations).toEqual([])
  })

  it("rejects immutable envelopes that would require runtime defaults", () => {
    const version = createTemplateVersion(northstarSeed, {
      id: "version-missing-defaulted-field",
      templateId: "northstar",
      version: 4,
      sourceSnapshotId: `sha256-${"e".repeat(64)}`,
      publishedAt: "2026-08-28T15:00:00.000Z",
    })
    const persisted = structuredClone(version) as unknown as {
      document: { fields: Array<{ agentDescription?: string }> }
    }
    delete persisted.document.fields[0]?.agentDescription

    expect(() => decodeTemplateVersion(persisted)).toThrow(
      "cannot receive schema defaults or migrations in place"
    )
  })
})
