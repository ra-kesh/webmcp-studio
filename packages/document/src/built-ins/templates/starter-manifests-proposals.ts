import {
  a4,
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

export const proposalStarterPlans: readonly StarterCatalogPlan[] = [
  {
    id: "editorial-proposal",
    name: "Editorial project proposal",
    outputName: "Project proposal",
    outputKind: "proposal",
    exportFormats: ["pdf", "png"],
    palette: palettes.olive,
    category: "Proposals",
    description:
      "A three-page proposal for framing a project, scope and next step.",
    tags: ["proposal", "client-work", "editorial", "portrait", "project"],
    formatFamily: "a4-portrait",
    useCaseIds: ["proposal", "client-work"],
    job: "Present a service engagement with a concise scope and decision path.",
    pages: [
      page("cover", "Cover", a4, [
        rect(
          "rail",
          "Olive rail",
          { x: 0, y: 0, width: 34, height: 1754, group: "Frame" },
          palettes.olive.accent
        ),
        label(
          "type",
          "PROJECT PROPOSAL · 2027",
          112,
          112,
          650,
          palettes.olive.accent
        ),
        title(
          "title",
          "A clearer way to launch the next chapter.",
          112,
          300,
          960,
          280,
          { fieldKey: "proposal_title" }
        ),
        copy(
          "intro",
          "Prepared for Northline Labs, a fictional company used only for this starter.",
          112,
          620,
          760,
          100
        ),
        rect(
          "summary",
          "Summary panel",
          { x: 112, y: 1120, width: 1016, height: 350, group: "Summary" },
          palettes.olive.panel,
          { radius: 22 }
        ),
        copy(
          "summary-copy",
          "Strategy, identity and launch support arranged around one measurable outcome.",
          160,
          1210,
          850,
          130,
          { color: palettes.olive.ink, group: "Summary", fontSize: 31 }
        ),
      ]),
      page("scope", "Scope", a4, [
        label("step", "01 · SCOPE", 96, 96, 500, palettes.olive.accent),
        title(
          "heading",
          "Three workstreams, one accountable team.",
          96,
          220,
          980,
          180,
          { role: "heading" }
        ),
        ...[
          "Research and positioning",
          "Identity system",
          "Launch toolkit",
        ].flatMap((item, index) => [
          rect(
            `card-${index}`,
            `${item} card`,
            {
              x: 96,
              y: 520 + index * 300,
              width: 1048,
              height: 230,
              group: item,
            },
            index === 1 ? "#D8E2DB" : palettes.olive.panel,
            { radius: 18 }
          ),
          label(
            `number-${index}`,
            `0${index + 1}`,
            140,
            570 + index * 300,
            90,
            palettes.olive.accent,
            item
          ),
          title(`item-${index}`, item, 260, 550 + index * 300, 700, 70, {
            role: "heading",
            group: item,
            fontSize: 34,
          }),
          copy(
            `detail-${index}`,
            "A defined output, owner and review point keep the work moving.",
            260,
            640 + index * 300,
            700,
            70,
            { group: item, fontSize: 21 }
          ),
        ]),
      ]),
      page("decision", "Decision", a4, [
        rect(
          "field",
          "Accent field",
          { x: 0, y: 0, width: 1240, height: 760, group: "Hero" },
          palettes.olive.accent
        ),
        label("step", "02 · NEXT STEP", 96, 100, 500, "#D9E6DD", "Hero"),
        title("heading", "Ready when the decision is.", 96, 260, 900, 200, {
          color: "#FFFFFF",
          group: "Hero",
        }),
        copy(
          "note",
          "Approve the direction, name one project owner and book a 45-minute start call.",
          96,
          880,
          880,
          140,
          { color: palettes.olive.ink }
        ),
        line(
          "rule",
          "Decision rule",
          { x: 96, y: 1120, width: 1048, height: 1, group: "Decision" },
          "#B9B0A2"
        ),
        title("cta", "hello@northline.example", 96, 1230, 900, 90, {
          role: "heading",
          fieldKey: "contact_email",
        }),
        copy(
          "footer",
          "Synthetic contact address. Replace it before publishing.",
          96,
          1370,
          850,
          70
        ),
      ]),
    ],
  },
  {
    id: "modular-service-proposal",
    name: "Modular service proposal",
    outputName: "Service proposal",
    outputKind: "proposal",
    exportFormats: ["pdf", "png"],
    palette: palettes.cobalt,
    category: "Proposals",
    description:
      "A structured four-page service proposal with proof, plan and pricing.",
    tags: ["proposal", "services", "pricing", "client-work", "portrait"],
    formatFamily: "a4-portrait",
    useCaseIds: ["proposal", "services", "client-work"],
    job: "Explain a professional service, establish proof and present a clear fee.",
    pages: [
      page("cover", "Cover", a4, [
        rect(
          "top",
          "Cobalt header",
          { x: 0, y: 0, width: 1240, height: 530, group: "Hero" },
          palettes.cobalt.accent
        ),
        label("eyebrow", "SERVICE PROPOSAL", 88, 90, 500, "#DDE6FF", "Hero"),
        title(
          "title",
          "Build an operating system for consistent growth.",
          88,
          190,
          990,
          240,
          { color: "#FFFFFF", fieldKey: "proposal_title", group: "Hero" }
        ),
        rect(
          "metric-a",
          "Metric card one",
          { x: 88, y: 700, width: 320, height: 300, group: "Proof" },
          "#FFFFFF",
          { radius: 18, stroke: "#D6DCEC", strokeWidth: 2 }
        ),
        rect(
          "metric-b",
          "Metric card two",
          { x: 460, y: 700, width: 320, height: 300, group: "Proof" },
          "#FFFFFF",
          { radius: 18, stroke: "#D6DCEC", strokeWidth: 2 }
        ),
        rect(
          "metric-c",
          "Metric card three",
          { x: 832, y: 700, width: 320, height: 300, group: "Proof" },
          "#FFFFFF",
          { radius: 18, stroke: "#D6DCEC", strokeWidth: 2 }
        ),
        title("metric-value", "12 weeks", 130, 770, 240, 70, {
          role: "heading",
          group: "Proof",
          fontSize: 36,
        }),
        copy("metric-note", "From kickoff to handoff", 130, 860, 230, 70, {
          group: "Proof",
          fontSize: 20,
        }),
        copy(
          "statement",
          "Prepared for Example Operations Co. · operations.example",
          88,
          1480,
          900,
          60
        ),
      ]),
      page("proof", "Proof", a4, [
        label("eyebrow", "WHY THIS TEAM", 90, 100, 500, palettes.cobalt.accent),
        title("heading", "Evidence before adjectives.", 90, 220, 900, 120, {
          role: "heading",
        }),
        rect(
          "case",
          "Case study field",
          { x: 90, y: 500, width: 1060, height: 520, group: "Case study" },
          palettes.cobalt.panel,
          { radius: 26 }
        ),
        title(
          "case-title",
          "A fictional case study with real structure.",
          145,
          570,
          820,
          120,
          { role: "heading", group: "Case study" }
        ),
        copy(
          "case-copy",
          "Problem, intervention, result and caveat live together so the claim stays useful.",
          145,
          740,
          780,
          130,
          { group: "Case study" }
        ),
        line(
          "rule",
          "Proof divider",
          { x: 90, y: 1180, width: 1060, height: 1, group: "Proof notes" },
          "#C8D0E2"
        ),
        copy(
          "proof-note",
          "Replace every metric with evidence your team can defend.",
          90,
          1270,
          800,
          100,
          { group: "Proof notes" }
        ),
      ]),
      page("plan", "Plan", a4, [
        label("eyebrow", "DELIVERY PLAN", 90, 100, 500, palettes.cobalt.accent),
        title(
          "heading",
          "A plan people can scan in thirty seconds.",
          90,
          220,
          1000,
          150,
          { role: "heading" }
        ),
        line(
          "timeline",
          "Timeline",
          { x: 176, y: 560, width: 2, height: 760, group: "Timeline" },
          palettes.cobalt.accent,
          4
        ),
        ...["Discover", "Decide", "Design", "Deliver"].flatMap(
          (item, index) => [
            ellipse(
              `dot-${index}`,
              `${item} marker`,
              {
                x: 154,
                y: 548 + index * 210,
                width: 46,
                height: 46,
                group: "Timeline",
              },
              index === 3 ? palettes.cobalt.accent : "#FFFFFF",
              { stroke: palettes.cobalt.accent, strokeWidth: 4 }
            ),
            title(`phase-${index}`, item, 250, 530 + index * 210, 400, 60, {
              role: "heading",
              group: "Timeline",
              fontSize: 31,
            }),
            copy(
              `phase-copy-${index}`,
              "Owner, output and review condition",
              250,
              600 + index * 210,
              650,
              55,
              { group: "Timeline", fontSize: 20 }
            ),
          ]
        ),
      ]),
      page("fee", "Fee", a4, [
        rect(
          "fee-panel",
          "Fee panel",
          { x: 80, y: 100, width: 1080, height: 920, group: "Fee" },
          "#111827",
          { radius: 28 }
        ),
        label("label", "FIXED PROJECT FEE", 140, 180, 500, "#9DB7FF", "Fee"),
        title("amount", "₹4,80,000", 140, 340, 820, 120, {
          color: "#FFFFFF",
          fieldKey: "project_fee",
          group: "Fee",
        }),
        copy(
          "terms",
          "40% to begin · 30% at direction approval · 30% at handoff",
          140,
          560,
          780,
          100,
          { color: "#C8D0E2", group: "Fee" }
        ),
        rect(
          "cta",
          "Next step",
          { x: 140, y: 780, width: 480, height: 110, group: "Fee" },
          palettes.cobalt.accent,
          { radius: 55 }
        ),
        label(
          "cta-label",
          "ACCEPT AND SCHEDULE",
          192,
          820,
          380,
          "#FFFFFF",
          "Fee"
        ),
        copy(
          "note",
          "The amount and company are synthetic starter content.",
          100,
          1200,
          900,
          80
        ),
      ]),
    ],
  },
]
