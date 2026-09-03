const commonNode = (pageLocalId: string) => ({
  pageLocalId,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
})

const titleNode = (page: string, text: string, y = 120) => ({
  ...commonNode(page),
  localId: `${page}-title`,
  type: "text" as const,
  name: `${text} title`,
  x: 96,
  y,
  width: 1048,
  height: 150,
  text,
  color: "#17211b",
  fontFamily: "Geist Variable",
  fontSize: 64,
  fontWeight: 600,
  italic: false,
  decoration: "none" as const,
  lineHeight: 1.05,
  letterSpacing: -1,
  align: "left" as const,
  sizingMode: "fixed" as const,
  typographyStyleLocalId: "display-style",
})

const bodyNode = (page: string, text: string) => ({
  ...commonNode(page),
  localId: `${page}-body`,
  type: "text" as const,
  name: `${page} body`,
  x: 96,
  y: 350,
  width: 760,
  height: 260,
  text,
  color: "#17211b",
  fontFamily: "Geist Variable",
  fontSize: 28,
  fontWeight: 400,
  italic: false,
  decoration: "none" as const,
  lineHeight: 1.3,
  letterSpacing: 0,
  align: "left" as const,
  sizingMode: "fixed" as const,
})

const accentNode = (page: string) => ({
  ...commonNode(page),
  localId: `${page}-accent`,
  type: "rect" as const,
  name: `${page} accent`,
  x: 96,
  y: 760,
  width: 280,
  height: 28,
  fill: "#b8663b",
  radius: 14,
  strokeWidth: 0,
  paintStyleLocalId: "accent-style",
})

const pageIds = ["cover", "challenge", "approach", "schedule", "next-steps"]

export const blankExternalSkillRequest = {
  requestId: "external-skill-blank-five-page",
  idempotencyKey: "external-skill-blank-five-page",
  prompt:
    "Create a five-page portrait client proposal using two visual references.",
  skill: {
    kind: "repository",
    title: "editorial-proposal-maker",
    canonicalUrl:
      "https://github.com/example/editorial-proposal-maker/blob/main/SKILL.md",
    contentHash: "a".repeat(64),
  },
  start: {
    kind: "blank",
    presetId: "portrait",
    plan: {
      version: 1,
      documentName: "Field Notes client proposal",
      outputs: [
        {
          localId: "proposal-output",
          name: "Client proposal",
          kind: "proposal",
          pageLocalIds: pageIds,
          exportFormats: ["png", "pdf"],
        },
      ],
      pages: pageIds.map((localId, index) => ({
        localId,
        outputLocalId: "proposal-output",
        name: ["Cover", "Challenge", "Approach", "Schedule", "Next steps"][
          index
        ],
        width: 1240,
        height: 1754,
        background: "#f5f0e6",
        nodeLocalIds:
          localId === "cover"
            ? ["cover-title", "cover-image", "cover-accent"]
            : [`${localId}-title`, `${localId}-body`, `${localId}-accent`],
      })),
      nodes: [
        {
          ...titleNode("cover", "Aster & Field Notes"),
          text: "Aster & Field Notes",
        },
        {
          ...commonNode("cover"),
          localId: "cover-image",
          type: "image",
          name: "Workshop architecture",
          x: 660,
          y: 420,
          width: 484,
          height: 760,
          assetId: "sandstone-arches",
          placement: {
            mode: "fill",
            focalX: 0.5,
            focalY: 0.45,
            zoom: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          frameMask: { shape: "rounded_rectangle", radius: 0.04 },
          alt: "Sandstone arches framing a quiet courtyard",
          decorative: false,
        },
        accentNode("cover"),
        titleNode("challenge", "The challenge"),
        bodyNode(
          "challenge",
          "Aster needs a clear launch narrative that aligns product, sales, and customer teams."
        ),
        accentNode("challenge"),
        titleNode("approach", "Working approach"),
        bodyNode(
          "approach",
          "We combine focused research, collaborative framing, and a practical decision system."
        ),
        accentNode("approach"),
        titleNode("schedule", "Two-day schedule"),
        bodyNode(
          "schedule",
          "Day one establishes evidence and direction. Day two turns the direction into an executable launch plan."
        ),
        accentNode("schedule"),
        titleNode("next-steps", "Next steps"),
        bodyNode(
          "next-steps",
          "Confirm the working team, approve the brief, and reserve the workshop dates."
        ),
        accentNode("next-steps"),
      ],
      groups: [
        {
          localId: "cover-story",
          pageLocalId: "cover",
          name: "Cover story",
          role: "organize",
          nodeLocalIds: ["cover-title", "cover-image", "cover-accent"],
        },
      ],
      typographyStyles: [
        {
          localId: "display-style",
          name: "Editorial display",
          fontFamily: "Geist Variable",
          fontSize: 64,
          fontWeight: 600,
          italic: false,
          lineHeight: 1.05,
          letterSpacing: -1,
          decoration: "none",
        },
      ],
      paintStyles: [
        {
          localId: "accent-style",
          name: "Clay accent",
          color: "#b8663b",
          opacity: 1,
        },
      ],
      variables: [
        {
          localId: "accent-color",
          name: "Accent color",
          type: "color",
          value: "#b8663b",
        },
      ],
      variableBindings: [
        {
          localId: "accent-style-color-binding",
          variableLocalId: "accent-color",
          target: {
            kind: "paint_style",
            styleLocalId: "accent-style",
            property: "color",
          },
        },
      ],
      fields: [
        {
          localId: "client-name-field",
          key: "client_name",
          label: "Client name",
          type: "text",
          required: true,
          defaultValue: "Aster & Field Notes",
          agentDescription: "Client and partner names shown on the cover.",
          validation: {},
        },
      ],
      bindings: [
        {
          localId: "client-name-binding",
          fieldLocalId: "client-name-field",
          nodeLocalId: "cover-title",
          property: "text",
        },
      ],
      designIntent: {
        pages: pageIds.map((pageLocalId) => ({
          pageLocalId,
          focalNodeLocalIds: [`${pageLocalId}-title`],
          releaseZones: [],
          inkRoles: [
            { role: "background", color: "#f5f0e6" },
            { role: "primary", color: "#17211b" },
          ],
          requiredText: [
            pageLocalId === "cover"
              ? "Aster & Field Notes"
              : {
                  challenge: "The challenge",
                  approach: "Working approach",
                  schedule: "Two-day schedule",
                  "next-steps": "Next steps",
                }[pageLocalId]!,
          ],
        })),
      },
    },
  },
  designGuides: [
    {
      kind: "repository",
      title: "Field Notes proposal system",
      canonicalUrl:
        "https://github.com/example/editorial-proposal-maker/blob/main/design.md",
      contentHash: "b".repeat(64),
      decisions: {
        colors: { paper: "#f5f0e6", ink: "#17211b", clay: "#b8663b" },
        typography: {
          display: "Geist Variable 600",
          body: "Geist Variable 400",
        },
        spacingBase: 8,
        radii: { card: 24 },
        principles: [
          "Use generous paper and strong left alignment.",
          "Use imagery as evidence rather than decoration.",
        ],
      },
    },
  ],
  references: [
    {
      kind: "analysis",
      label: "Editorial pacing reference",
      canonicalUrl: "https://example.com/reference/editorial-pacing.jpg",
      contentHash: "c".repeat(64),
    },
    {
      kind: "analysis",
      label: "Architectural crop reference",
      canonicalUrl: "https://example.com/reference/architectural-crop.jpg",
      contentHash: "d".repeat(64),
    },
    { kind: "asset", assetId: "sandstone-arches", assetVersion: "1" },
  ],
}

export const templateExternalSkillRequest = {
  requestId: "external-skill-template-wedding",
  idempotencyKey: "external-skill-template-wedding",
  prompt:
    "Adapt an editorial proposal for a two-day destination wedding in Udaipur.",
  requestedName: "Mira and Dev destination wedding proposal",
  skill: {
    kind: "repository",
    title: "editorial-proposal-maker",
    canonicalUrl:
      "https://github.com/example/editorial-proposal-maker/blob/main/SKILL.md",
    contentHash: "a".repeat(64),
  },
  start: {
    kind: "template",
    template: { id: "editorial-one-pager", version: 1 },
    fieldValues: {
      document_title: "Mira & Dev in Udaipur",
      document_subtitle: "A two-day destination wedding shaped around place",
    },
    commands: [
      {
        type: "insert_image",
        pageId: "editorial-one-pager-page",
        localId: "wedding-botanical",
        name: "Udaipur botanical study",
        assetId: "olive-botanical",
        x: 760,
        y: 960,
        width: 320,
        height: 420,
        alt: "Olive botanical study for the wedding proposal",
      },
    ],
  },
  designGuides: [],
  references: [
    { kind: "asset", assetId: "olive-botanical", assetVersion: "1" },
  ],
}
