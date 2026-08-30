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

export const reportAndMediaStarterPlans: readonly StarterCatalogPlan[] = [
  {
    id: "field-notes-report",
    name: "Field notes report",
    outputName: "Research report",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.sand,
    category: "Reports",
    description:
      "A four-page qualitative report for context, findings, quotes and actions.",
    tags: ["report", "research", "insights", "findings", "portrait"],
    formatFamily: "a4-portrait",
    useCaseIds: ["report", "research", "insights"],
    job: "Turn qualitative research into findings that connect to product decisions.",
    pages: [
      page("cover", "Cover", a4, [
        label(
          "label",
          "FIELD NOTES · REPORT 01",
          92,
          100,
          600,
          palettes.sand.accent
        ),
        title(
          "title",
          "Where the handoff actually breaks.",
          92,
          300,
          950,
          240,
          { fieldKey: "report_title" }
        ),
        rect(
          "window",
          "Observation window",
          { x: 92, y: 780, width: 1056, height: 500, group: "Study summary" },
          palettes.sand.panel,
          { radius: 10 }
        ),
        label(
          "window-label",
          "STUDY WINDOW",
          140,
          840,
          340,
          palettes.sand.accent,
          "Study summary"
        ),
        title(
          "window-value",
          "12 interviews\n4 working sessions\n3 repeated failures",
          140,
          950,
          750,
          230,
          { role: "heading", group: "Study summary" }
        ),
      ]),
      page("finding", "Finding", a4, [
        label("label", "FINDING 01", 92, 100, 400, palettes.sand.accent),
        title(
          "heading",
          "The delay begins before the task changes hands.",
          92,
          240,
          990,
          170,
          { role: "heading" }
        ),
        ellipse(
          "number",
          "Finding number",
          { x: 92, y: 600, width: 220, height: 220, group: "Finding" },
          palettes.sand.accent
        ),
        title("number-text", "67%", 112, 665, 180, 80, {
          role: "heading",
          color: "#FFFFFF",
          align: "center",
          group: "Finding",
          fontSize: 45,
        }),
        copy(
          "finding-copy",
          "Participants started waiting when the requested outcome was unclear, not when the next owner was unavailable.",
          380,
          600,
          700,
          220,
          { color: palettes.sand.ink, group: "Finding", fontSize: 30 }
        ),
        line(
          "rule",
          "Evidence rule",
          { x: 92, y: 1040, width: 1056, height: 1, group: "Evidence" },
          "#CFC2B1"
        ),
        copy(
          "method",
          "Synthetic numbers and organizations are included only as replaceable starter copy.",
          92,
          1120,
          820,
          80,
          { group: "Evidence", fontSize: 19 }
        ),
      ]),
      page("voices", "Voices", a4, [
        label("label", "VOICE OF THE WORK", 92, 100, 500, palettes.sand.accent),
        ...[
          "I know who owns it. I do not know what done means.",
          "We copy the request into chat and lose the decision behind it.",
          "The fastest projects begin with a small written contract.",
        ].flatMap((quote, index) => [
          rect(
            `quote-${index}`,
            `Quote ${index + 1}`,
            {
              x: 92,
              y: 270 + index * 410,
              width: 1056,
              height: 320,
              group: `Quote ${index + 1}`,
            },
            index === 1 ? "#302921" : palettes.sand.panel,
            { radius: 22 }
          ),
          title(
            `quote-copy-${index}`,
            `“${quote}”`,
            145,
            340 + index * 410,
            900,
            150,
            {
              role: "heading",
              group: `Quote ${index + 1}`,
              color: index === 1 ? "#FFFFFF" : palettes.sand.ink,
              fontSize: 33,
            }
          ),
        ]),
      ]),
      page("actions", "Actions", a4, [
        rect(
          "header",
          "Action header",
          { x: 0, y: 0, width: 1240, height: 430, group: "Header" },
          palettes.sand.accent
        ),
        label("label", "WHAT CHANGES MONDAY", 92, 92, 500, "#F5E6DC", "Header"),
        title(
          "heading",
          "Make the outcome visible before assigning the work.",
          92,
          180,
          980,
          160,
          { role: "heading", color: "#FFFFFF", group: "Header" }
        ),
        ...[
          "Name the decision",
          "Define done",
          "Confirm the next owner",
        ].flatMap((item, index) => [
          label(
            `number-${index}`,
            `0${index + 1}`,
            92,
            610 + index * 260,
            90,
            palettes.sand.accent,
            "Actions"
          ),
          title(`action-${index}`, item, 230, 590 + index * 260, 720, 70, {
            role: "heading",
            group: "Actions",
            fontSize: 34,
          }),
          line(
            `rule-${index}`,
            `${item} rule`,
            {
              x: 230,
              y: 700 + index * 260,
              width: 760,
              height: 1,
              group: "Actions",
            },
            "#D3C7B8"
          ),
        ]),
      ]),
    ],
  },
  {
    id: "annual-snapshot-report",
    name: "Annual snapshot report",
    outputName: "Annual report",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.midnight,
    category: "Reports",
    description:
      "A compact three-page annual report with a scorecard and operating priorities.",
    tags: ["report", "annual", "metrics", "business", "landscape"],
    formatFamily: "presentation-16x9",
    useCaseIds: ["report", "annual", "business"],
    job: "Summarize a year of operating results without turning the report into a spreadsheet.",
    pages: [
      page(
        "cover",
        "Cover",
        wide,
        [
          rect(
            "field",
            "Midnight field",
            { x: 0, y: 0, width: 1600, height: 900, group: "Cover" },
            palettes.midnight.background
          ),
          ellipse(
            "orbit-a",
            "Orbit one",
            { x: 1010, y: -80, width: 620, height: 620, group: "Cover art" },
            "#263A36"
          ),
          ellipse(
            "orbit-b",
            "Orbit two",
            { x: 1160, y: 110, width: 340, height: 340, group: "Cover art" },
            palettes.midnight.accent
          ),
          label(
            "label",
            "ANNUAL SNAPSHOT · 2027",
            90,
            85,
            600,
            palettes.midnight.accent,
            "Cover"
          ),
          title(
            "title",
            "What held.\nWhat changed.\nWhat comes next.",
            90,
            250,
            800,
            330,
            { color: "#FFFFFF", fieldKey: "report_title", group: "Cover" }
          ),
          copy(
            "org",
            "Example Works Cooperative · works.example",
            90,
            760,
            700,
            50,
            { color: palettes.midnight.muted, group: "Cover" }
          ),
        ],
        palettes.midnight.background
      ),
      page(
        "scorecard",
        "Scorecard",
        wide,
        [
          label(
            "label",
            "YEAR AT A GLANCE",
            80,
            70,
            500,
            palettes.midnight.accent
          ),
          title(
            "heading",
            "A scorecard with context built in.",
            80,
            160,
            720,
            100,
            { role: "heading" }
          ),
          ...[
            ["82%", "Work delivered on the agreed week"],
            ["4.6", "Average client confidence score"],
            ["18", "Reusable systems shipped"],
            ["31%", "Reduction in revision cycles"],
          ].flatMap(([value, detail], index) => [
            rect(
              `metric-${index}`,
              `Metric ${index + 1}`,
              {
                x: 80 + index * 375,
                y: 370,
                width: 330,
                height: 330,
                group: `Metric ${index + 1}`,
              },
              index === 0 ? palettes.midnight.panel : "#FFFFFF",
              { radius: 20, stroke: "#DDE2E7", strokeWidth: 1 }
            ),
            title(`value-${index}`, value!, 120 + index * 375, 435, 250, 80, {
              role: "heading",
              group: `Metric ${index + 1}`,
              color: index === 0 ? "#FFFFFF" : palettes.midnight.ink,
              fontSize: 48,
            }),
            copy(`detail-${index}`, detail!, 120 + index * 375, 560, 240, 90, {
              group: `Metric ${index + 1}`,
              color: index === 0 ? palettes.midnight.muted : "#5E6670",
              fontSize: 19,
            }),
          ]),
        ],
        "#F6F8FA"
      ),
      page(
        "priorities",
        "Priorities",
        wide,
        [
          rect(
            "left",
            "Priority field",
            { x: 0, y: 0, width: 560, height: 900, group: "Position" },
            palettes.midnight.accent
          ),
          label("label", "NEXT YEAR", 70, 80, 360, "#1F362D", "Position"),
          title(
            "statement",
            "Fewer bets.\nBetter proof.\nLonger useful life.",
            70,
            250,
            430,
            280,
            { color: "#102018", group: "Position", fontSize: 58 }
          ),
          ...[
            "Make service quality measurable",
            "Turn repeat work into systems",
            "Protect focused time",
          ].flatMap((item, index) => [
            label(
              `number-${index}`,
              `0${index + 1}`,
              680,
              210 + index * 210,
              80,
              palettes.midnight.accent,
              "Priorities"
            ),
            title(`priority-${index}`, item, 800, 190 + index * 210, 650, 70, {
              role: "heading",
              group: "Priorities",
              fontSize: 34,
            }),
            copy(
              `owner-${index}`,
              "Owner · measure · first review",
              800,
              270 + index * 210,
              500,
              45,
              { group: "Priorities", fontSize: 18 }
            ),
          ]),
        ],
        "#F6F8FA"
      ),
    ],
  },
  {
    id: "press-room-media-kit",
    name: "Press room media kit",
    outputName: "Media kit",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.cobalt,
    category: "Media kits",
    description:
      "A three-page media kit for a profile, key facts and approved contact details.",
    tags: ["media-kit", "press", "profile", "facts", "portrait"],
    formatFamily: "a4-portrait",
    useCaseIds: ["media-kit", "press", "profile"],
    job: "Give editors a usable company profile, fact sheet and press contact in one file.",
    pages: [
      page("profile", "Profile", a4, [
        rect(
          "portrait",
          "Portrait placeholder",
          { x: 0, y: 0, width: 1240, height: 720, group: "Image area" },
          "#CED9F3"
        ),
        ellipse(
          "mark",
          "Brand mark",
          { x: 90, y: 620, width: 170, height: 170, group: "Identity" },
          palettes.cobalt.accent
        ),
        label("mark-label", "NS", 128, 678, 95, "#FFFFFF", "Identity"),
        title("title", "Northstar Systems", 90, 900, 900, 100, {
          role: "heading",
          fieldKey: "organization_name",
        }),
        copy(
          "profile-copy",
          "Northstar Systems is a fictional workflow company created for this template. Replace this paragraph with a concise, verifiable company description.",
          90,
          1050,
          900,
          210,
          { color: palettes.cobalt.ink }
        ),
        label(
          "contact",
          "PRESS.NORTHSTAR.EXAMPLE",
          90,
          1490,
          700,
          palettes.cobalt.accent,
          "Footer"
        ),
      ]),
      page("facts", "Key facts", a4, [
        label("label", "KEY FACTS", 90, 90, 400, palettes.cobalt.accent),
        title(
          "heading",
          "Numbers an editor can use without hunting.",
          90,
          210,
          980,
          140,
          { role: "heading" }
        ),
        ...[
          ["2024", "Founded"],
          ["18", "Markets served"],
          ["42", "People"],
          ["3", "Products"],
        ].flatMap(([value, detail], index) => [
          rect(
            `fact-${index}`,
            `Fact ${index + 1}`,
            {
              x: 90 + (index % 2) * 540,
              y: 500 + Math.floor(index / 2) * 380,
              width: 500,
              height: 320,
              group: `Fact ${index + 1}`,
            },
            index === 0 ? palettes.cobalt.accent : palettes.cobalt.panel,
            { radius: 22 }
          ),
          title(
            `value-${index}`,
            value!,
            135 + (index % 2) * 540,
            570 + Math.floor(index / 2) * 380,
            350,
            90,
            {
              role: "heading",
              group: `Fact ${index + 1}`,
              color: index === 0 ? "#FFFFFF" : palettes.cobalt.ink,
              fontSize: 52,
            }
          ),
          copy(
            `detail-${index}`,
            detail!,
            135 + (index % 2) * 540,
            690 + Math.floor(index / 2) * 380,
            300,
            55,
            {
              group: `Fact ${index + 1}`,
              color: index === 0 ? "#DDE6FF" : palettes.cobalt.muted,
              fontSize: 20,
            }
          ),
        ]),
      ]),
      page("contact", "Press contact", a4, [
        rect(
          "card",
          "Contact card",
          { x: 90, y: 180, width: 1060, height: 1280, group: "Contact" },
          "#111827",
          { radius: 32 }
        ),
        label("label", "PRESS CONTACT", 150, 260, 400, "#9DB7FF", "Contact"),
        title("name", "Jordan Lee", 150, 430, 800, 100, {
          role: "heading",
          color: "#FFFFFF",
          fieldKey: "press_contact",
          group: "Contact",
        }),
        copy(
          "role",
          "Communications lead · fictional profile",
          150,
          560,
          720,
          65,
          { color: "#AAB6CC", group: "Contact" }
        ),
        line(
          "rule",
          "Contact divider",
          { x: 150, y: 770, width: 780, height: 1, group: "Contact" },
          "#40506A"
        ),
        title("email", "press@northstar.example", 150, 880, 820, 80, {
          role: "heading",
          color: "#FFFFFF",
          group: "Contact",
          fontSize: 34,
        }),
        copy(
          "note",
          "All names, organizations and addresses in this starter are synthetic.",
          150,
          1170,
          760,
          100,
          { color: "#AAB6CC", group: "Contact", fontSize: 19 }
        ),
      ]),
    ],
  },
]
