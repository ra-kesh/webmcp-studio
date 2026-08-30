import {
  a4,
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

export const briefStarterPlans: readonly StarterCatalogPlan[] = [
  {
    id: "signal-creative-brief",
    name: "Signal creative brief",
    outputName: "Creative brief",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.ember,
    category: "Briefs",
    description:
      "A two-page creative brief that pairs the decision with audience and guardrails.",
    tags: ["brief", "creative", "campaign", "strategy", "portrait"],
    formatFamily: "a4-portrait",
    useCaseIds: ["brief", "creative", "campaign"],
    job: "Align a creative team on the audience, promise, proof and non-negotiables.",
    pages: [
      page("direction", "Direction", a4, [
        label(
          "label",
          "CREATIVE BRIEF / 01",
          92,
          96,
          500,
          palettes.ember.accent
        ),
        title(
          "title",
          "Make the useful choice feel like the obvious one.",
          92,
          250,
          980,
          240,
          { fieldKey: "brief_title" }
        ),
        rect(
          "prompt",
          "Core prompt",
          { x: 92, y: 650, width: 1056, height: 360, group: "Prompt" },
          palettes.ember.panel,
          { radius: 18 }
        ),
        label(
          "prompt-label",
          "THE CREATIVE TASK",
          140,
          710,
          420,
          palettes.ember.accent,
          "Prompt"
        ),
        copy(
          "prompt-copy",
          "Show a time-poor operator that a simpler workflow can still be rigorous.",
          140,
          800,
          820,
          120,
          { color: palettes.ember.ink, group: "Prompt", fontSize: 30 }
        ),
        line(
          "rule",
          "Footer rule",
          { x: 92, y: 1370, width: 1056, height: 1, group: "Footer" },
          "#DCC8BC"
        ),
        copy(
          "footer",
          "Fictional brand: Common Thread Systems · common-thread.example",
          92,
          1430,
          880,
          60,
          { group: "Footer", fontSize: 18 }
        ),
      ]),
      page("guardrails", "Guardrails", a4, [
        label(
          "label",
          "CREATIVE BRIEF / 02",
          92,
          96,
          500,
          palettes.ember.accent
        ),
        title(
          "heading",
          "Who, what, why now and what to avoid.",
          92,
          220,
          980,
          140,
          { role: "heading" }
        ),
        ...[
          ["Audience", "Operations leads at growing service firms"],
          ["Promise", "See the full week without managing five tools"],
          ["Proof", "One shared plan, visible ownership, fewer handoffs"],
          ["Avoid", "Hype, vague speed claims and generic dashboards"],
        ].flatMap(([heading, detail], index) => [
          rect(
            `row-${index}`,
            `${heading} row`,
            {
              x: 92,
              y: 480 + index * 240,
              width: 1056,
              height: 190,
              group: heading,
            },
            index % 2 ? "#FFFDFB" : palettes.ember.panel,
            { radius: 14, stroke: "#E4D4CB", strokeWidth: 1 }
          ),
          label(
            `row-label-${index}`,
            heading!.toUpperCase(),
            132,
            525 + index * 240,
            220,
            palettes.ember.accent,
            heading
          ),
          copy(`row-copy-${index}`, detail!, 380, 510 + index * 240, 680, 90, {
            color: palettes.ember.ink,
            group: heading,
            fontSize: 24,
          }),
        ]),
      ]),
    ],
  },
  {
    id: "workshop-alignment-brief",
    name: "Workshop alignment brief",
    outputName: "Workshop brief",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.violet,
    category: "Briefs",
    description:
      "A landscape workshop brief with decision lanes, agenda and owner map.",
    tags: ["brief", "workshop", "alignment", "agenda", "landscape"],
    formatFamily: "presentation-16x9",
    useCaseIds: ["brief", "workshop", "alignment"],
    job: "Give workshop participants the context, agenda and decisions before the session.",
    pages: [
      page("map", "Decision map", wide, [
        rect(
          "sidebar",
          "Violet sidebar",
          { x: 0, y: 0, width: 430, height: 900, group: "Context" },
          palettes.violet.accent
        ),
        label("label", "WORKSHOP BRIEF", 64, 70, 300, "#E7DDFC", "Context"),
        title(
          "title",
          "Decide the offer, not the adjectives.",
          64,
          190,
          300,
          260,
          {
            color: "#FFFFFF",
            fieldKey: "workshop_title",
            group: "Context",
            fontSize: 54,
          }
        ),
        copy("date", "14 March 2027 · 90 minutes", 64, 720, 300, 70, {
          color: "#E7DDFC",
          group: "Context",
          fontSize: 20,
        }),
        ...[
          ["Know", "What evidence changes the decision?"],
          ["Choose", "Which audience and promise lead?"],
          ["Leave", "Who owns the first working draft?"],
        ].flatMap(([heading, detail], index) => [
          rect(
            `lane-${index}`,
            `${heading} lane`,
            {
              x: 500 + index * 350,
              y: 180,
              width: 300,
              height: 520,
              group: heading,
            },
            index === 1 ? palettes.violet.panel : "#FFFFFF",
            { radius: 20, stroke: "#DCD5E8", strokeWidth: 2 }
          ),
          label(
            `lane-label-${index}`,
            `0${index + 1} · ${heading!.toUpperCase()}`,
            540 + index * 350,
            235,
            230,
            palettes.violet.accent,
            heading
          ),
          copy(
            `lane-copy-${index}`,
            detail!,
            540 + index * 350,
            340,
            220,
            180,
            { color: palettes.violet.ink, group: heading, fontSize: 24 }
          ),
        ]),
      ]),
      page("agenda", "Agenda", wide, [
        label("label", "RUN OF SHOW", 80, 72, 400, palettes.violet.accent),
        title(
          "heading",
          "Ninety minutes with no mystery middle.",
          80,
          170,
          700,
          140,
          { role: "heading" }
        ),
        line(
          "line",
          "Agenda line",
          { x: 120, y: 420, width: 1360, height: 2, group: "Agenda" },
          "#CFC5DF",
          3
        ),
        ...["Context", "Options", "Decision", "Owners"].flatMap(
          (item, index) => [
            ellipse(
              `stop-${index}`,
              `${item} stop`,
              {
                x: 145 + index * 350,
                y: 397,
                width: 48,
                height: 48,
                group: "Agenda",
              },
              index === 2 ? palettes.violet.accent : "#FFFFFF",
              { stroke: palettes.violet.accent, strokeWidth: 4 }
            ),
            title(
              `stop-title-${index}`,
              item,
              110 + index * 350,
              500,
              240,
              55,
              {
                role: "heading",
                group: "Agenda",
                fontSize: 30,
                align: "center",
              }
            ),
            copy(
              `stop-time-${index}`,
              `${[15, 30, 30, 15][index]} minutes`,
              110 + index * 350,
              575,
              240,
              45,
              { group: "Agenda", fontSize: 19, align: "center" }
            ),
          ]
        ),
      ]),
    ],
  },
]
