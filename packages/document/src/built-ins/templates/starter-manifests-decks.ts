import {
  wide,
  palettes,
  label,
  title,
  copy,
  page,
  ellipse,
  line,
  rect,
  type StarterCatalogPlan,
} from "./starter-manifest-primitives"

export const deckStarterPlans: readonly StarterCatalogPlan[] = [
  {
    id: "venture-pitch-deck",
    name: "Venture pitch deck",
    outputName: "Pitch deck",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.lemon,
    category: "Presentations",
    description:
      "A five-slide pitch deck for the problem, product, proof and ask.",
    tags: ["presentation", "pitch", "startup", "fundraising", "landscape"],
    formatFamily: "presentation-16x9",
    useCaseIds: ["presentation", "pitch", "fundraising"],
    job: "Explain a venture in five slides without hiding the claim behind decoration.",
    pages: [
      page(
        "cover",
        "Cover",
        wide,
        [
          rect(
            "field",
            "Lemon field",
            { x: 0, y: 0, width: 1600, height: 900, group: "Cover" },
            palettes.lemon.background
          ),
          label(
            "label",
            "NORTHLINE · SEED DECK",
            80,
            75,
            500,
            palettes.lemon.ink,
            "Cover"
          ),
          title(
            "title",
            "The operating layer for field teams.",
            80,
            250,
            1100,
            230,
            { fieldKey: "deck_title", group: "Cover", fontSize: 88 }
          ),
          rect(
            "chip",
            "Round chip",
            { x: 80, y: 700, width: 300, height: 72, group: "Cover" },
            palettes.lemon.ink,
            { radius: 36 }
          ),
          label(
            "chip-label",
            "FICTIONAL COMPANY",
            125,
            725,
            220,
            "#FFFFFF",
            "Cover"
          ),
        ],
        palettes.lemon.background
      ),
      page(
        "problem",
        "Problem",
        wide,
        [
          label("label", "01 · PROBLEM", 80, 75, 400, "#717740"),
          title(
            "statement",
            "The work changes outside.\nThe plan stays inside.",
            80,
            220,
            850,
            250,
            { fontSize: 76 }
          ),
          rect(
            "stat",
            "Problem statistic",
            { x: 1080, y: 160, width: 400, height: 560, group: "Evidence" },
            palettes.lemon.ink,
            { radius: 24 }
          ),
          title("stat-value", "7h", 1140, 250, 280, 120, {
            role: "heading",
            color: palettes.lemon.background,
            group: "Evidence",
            fontSize: 88,
          }),
          copy(
            "stat-copy",
            "lost each week to status reconstruction",
            1140,
            430,
            260,
            140,
            { color: "#D8D8D0", group: "Evidence", fontSize: 25 }
          ),
        ],
        "#FFFFFF"
      ),
      page(
        "product",
        "Product",
        wide,
        [
          rect(
            "screen",
            "Product frame",
            { x: 80, y: 120, width: 920, height: 650, group: "Product" },
            "#171717",
            { radius: 28 }
          ),
          rect(
            "screen-nav",
            "Product navigation",
            { x: 115, y: 165, width: 850, height: 72, group: "Product" },
            "#2B2B2B",
            { radius: 12 }
          ),
          ...[0, 1, 2].map((index) =>
            rect(
              `screen-row-${index}`,
              `Product row ${index + 1}`,
              {
                x: 140,
                y: 290 + index * 130,
                width: 800 - index * 75,
                height: 84,
                group: "Product",
              },
              index === 1 ? "#F4FF80" : "#353535",
              { radius: 10 }
            )
          ),
          label("label", "02 · PRODUCT", 1100, 150, 380, "#717740", "Pitch"),
          title(
            "heading",
            "Plan, prove and hand off in one view.",
            1100,
            270,
            380,
            180,
            { role: "heading", group: "Pitch", fontSize: 44 }
          ),
          copy(
            "copy",
            "The frame is intentionally abstract. Replace it with an approved product image.",
            1100,
            520,
            350,
            130,
            { group: "Pitch", fontSize: 20 }
          ),
        ],
        "#FFFFFF"
      ),
      page(
        "proof",
        "Proof",
        wide,
        [
          label("label", "03 · PROOF", 80, 75, 400, "#717740"),
          title(
            "heading",
            "Three signals. One honest caveat.",
            80,
            190,
            800,
            110,
            { role: "heading" }
          ),
          ...[
            ["84%", "weekly active teams"],
            ["2.3x", "faster handoffs"],
            ["11", "design partners"],
          ].flatMap(([value, detail], index) => [
            title(`value-${index}`, value!, 100 + index * 500, 420, 380, 110, {
              role: "heading",
              fontSize: 70,
              group: `Signal ${index + 1}`,
            }),
            line(
              `rule-${index}`,
              `Signal ${index + 1} rule`,
              {
                x: 100 + index * 500,
                y: 570,
                width: 360,
                height: 1,
                group: `Signal ${index + 1}`,
              },
              "#1A1A1A",
              3
            ),
            copy(`detail-${index}`, detail!, 100 + index * 500, 620, 350, 80, {
              group: `Signal ${index + 1}`,
              fontSize: 22,
            }),
          ]),
          copy(
            "caveat",
            "Synthetic metrics. Replace with a dated source before use.",
            80,
            790,
            800,
            45,
            { fontSize: 17 }
          ),
        ],
        palettes.lemon.background
      ),
      page(
        "ask",
        "Ask",
        wide,
        [
          rect(
            "left",
            "Ask field",
            { x: 0, y: 0, width: 980, height: 900, group: "Ask" },
            palettes.lemon.ink
          ),
          label(
            "label",
            "04 · THE ASK",
            80,
            80,
            400,
            palettes.lemon.background,
            "Ask"
          ),
          title(
            "heading",
            "₹6 crore to prove repeatable growth.",
            80,
            260,
            800,
            220,
            {
              color: "#FFFFFF",
              fieldKey: "funding_ask",
              group: "Ask",
              fontSize: 72,
            }
          ),
          copy(
            "allocation",
            "45% product · 35% go-to-market · 20% operations",
            80,
            670,
            760,
            70,
            { color: "#B9B9B0", group: "Ask", fontSize: 23 }
          ),
          title("contact", "founders@northline.example", 1070, 300, 430, 140, {
            role: "heading",
            group: "Contact",
            fontSize: 38,
          }),
          copy(
            "note",
            "Fictional company and contact address.",
            1070,
            500,
            390,
            80,
            { group: "Contact", fontSize: 18 }
          ),
        ],
        "#FFFFFF"
      ),
    ],
  },
  {
    id: "product-demo-deck",
    name: "Product demo deck",
    outputName: "Product demo",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.midnight,
    category: "Presentations",
    description:
      "A four-slide product walkthrough built around tasks, not feature inventory.",
    tags: ["presentation", "product", "demo", "sales", "landscape"],
    formatFamily: "presentation-16x9",
    useCaseIds: ["presentation", "product", "demo"],
    job: "Walk a buyer through one product task and the evidence behind it.",
    pages: [
      page(
        "opening",
        "Opening",
        wide,
        [
          rect(
            "frame",
            "Demo frame",
            { x: 70, y: 70, width: 1460, height: 760, group: "Frame" },
            palettes.midnight.panel,
            { radius: 30 }
          ),
          label(
            "label",
            "PRODUCT WALKTHROUGH",
            130,
            130,
            500,
            palettes.midnight.accent,
            "Frame"
          ),
          title(
            "title",
            "See the whole handoff before it slips.",
            130,
            300,
            950,
            200,
            { color: "#FFFFFF", fieldKey: "demo_title", group: "Frame" }
          ),
          ellipse(
            "cursor",
            "Cursor marker",
            { x: 1220, y: 590, width: 150, height: 150, group: "Frame" },
            palettes.midnight.accent
          ),
        ],
        palettes.midnight.background
      ),
      page(
        "task",
        "Task",
        wide,
        [
          label("label", "THE TASK", 70, 70, 300, palettes.midnight.accent),
          title(
            "heading",
            "Turn a request into owned work.",
            70,
            190,
            700,
            120,
            { role: "heading" }
          ),
          rect(
            "request",
            "Request card",
            { x: 70, y: 420, width: 420, height: 300, group: "Workflow" },
            "#FFFFFF",
            { radius: 20, stroke: "#D7DCE0", strokeWidth: 2 }
          ),
          rect(
            "arrow",
            "Flow connector",
            { x: 540, y: 555, width: 160, height: 12, group: "Workflow" },
            palettes.midnight.accent,
            { radius: 6 }
          ),
          rect(
            "owned",
            "Owned work card",
            { x: 750, y: 370, width: 760, height: 400, group: "Workflow" },
            palettes.midnight.panel,
            { radius: 22 }
          ),
          label(
            "request-label",
            "REQUEST",
            110,
            470,
            220,
            palettes.midnight.accent,
            "Workflow"
          ),
          copy(
            "request-copy",
            "Outcome, context, deadline",
            110,
            560,
            300,
            80,
            { group: "Workflow", fontSize: 22 }
          ),
          label(
            "owned-label",
            "OWNED WORK",
            800,
            430,
            260,
            palettes.midnight.accent,
            "Workflow"
          ),
          title("owned-copy", "Decision\nOwner\nProof", 800, 530, 500, 180, {
            role: "heading",
            color: "#FFFFFF",
            group: "Workflow",
            fontSize: 38,
          }),
        ],
        "#F5F7F8"
      ),
      page(
        "sequence",
        "Sequence",
        wide,
        [
          rect(
            "band",
            "Sequence band",
            { x: 0, y: 300, width: 1600, height: 300, group: "Sequence" },
            palettes.midnight.background
          ),
          ...["Capture", "Clarify", "Commit", "Confirm"].flatMap(
            (item, index) => [
              ellipse(
                `step-${index}`,
                `${item} step`,
                {
                  x: 120 + index * 380,
                  y: 400,
                  width: 100,
                  height: 100,
                  group: "Sequence",
                },
                index === 2 ? palettes.midnight.accent : "#FFFFFF"
              ),
              label(
                `step-label-${index}`,
                item.toUpperCase(),
                82 + index * 380,
                540,
                180,
                index === 2 ? palettes.midnight.accent : "#FFFFFF",
                "Sequence"
              ),
            ]
          ),
          title("heading", "One repeatable path.", 80, 100, 800, 100, {
            role: "heading",
          }),
          copy(
            "caption",
            "Each step can be demonstrated with a real customer-safe fixture.",
            80,
            720,
            760,
            60
          ),
        ],
        "#FFFFFF"
      ),
      page(
        "close",
        "Close",
        wide,
        [
          ellipse(
            "halo",
            "Close halo",
            { x: 980, y: 70, width: 520, height: 520, group: "Art" },
            palettes.midnight.accent
          ),
          ellipse(
            "core",
            "Close core",
            { x: 1110, y: 200, width: 260, height: 260, group: "Art" },
            palettes.midnight.background
          ),
          label("label", "NEXT STEP", 80, 90, 300, palettes.midnight.accent),
          title(
            "heading",
            "Bring one live handoff.\nWe will map it together.",
            80,
            260,
            780,
            220,
            { fieldKey: "demo_next_step" }
          ),
          rect(
            "cta",
            "Demo call to action",
            { x: 80, y: 650, width: 420, height: 90, group: "Action" },
            palettes.midnight.background,
            { radius: 45 }
          ),
          label(
            "cta-label",
            "BOOK AT DEMO.EXAMPLE",
            130,
            680,
            320,
            "#FFFFFF",
            "Action"
          ),
        ],
        "#FFFFFF"
      ),
    ],
  },
]
