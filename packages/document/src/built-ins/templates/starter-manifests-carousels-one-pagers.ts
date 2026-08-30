import {
  a4,
  square,
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

export const carouselAndOnePagerStarterPlans: readonly StarterCatalogPlan[] = [
  {
    id: "how-to-carousel",
    name: "How-to carousel",
    outputName: "How-to carousel",
    outputKind: "square",
    exportFormats: ["png", "pdf"],
    palette: palettes.cobalt,
    category: "Carousels",
    description:
      "A five-card teaching carousel with a clear promise, sequence and recap.",
    tags: ["carousel", "education", "how-to", "social", "square"],
    formatFamily: "social-carousel",
    useCaseIds: ["carousel", "education", "how-to"],
    job: "Teach one small process in a swipeable sequence that remains coherent card by card.",
    pages: [
      page(
        "cover",
        "Cover",
        square,
        [
          rect(
            "field",
            "Cobalt field",
            { x: 0, y: 0, width: 1080, height: 1080, group: "Frame" },
            palettes.cobalt.accent
          ),
          label(
            "label",
            "A PRACTICAL GUIDE · 5 CARDS",
            80,
            80,
            600,
            "#DDE6FF",
            "Message"
          ),
          title("title", "Write a brief\npeople can use.", 80, 300, 880, 250, {
            color: "#FFFFFF",
            fieldKey: "carousel_title",
            group: "Message",
            fontSize: 82,
          }),
          ellipse(
            "swipe",
            "Swipe marker",
            { x: 790, y: 790, width: 170, height: 170, group: "Action" },
            "#FFFFFF"
          ),
          label(
            "swipe-label",
            "SWIPE",
            828,
            860,
            100,
            palettes.cobalt.accent,
            "Action"
          ),
        ],
        palettes.cobalt.accent
      ),
      ...[
        [
          "01",
          "Name the decision",
          "What must be true when the work is complete?",
        ],
        ["02", "Choose the audience", "Who has to notice, understand or act?"],
        ["03", "Show the proof", "Which evidence makes the promise credible?"],
      ].map(([number, heading, detail], index) =>
        page(
          `step-${index + 1}`,
          `Step ${index + 1}`,
          square,
          [
            label("number", number!, 80, 80, 180, palettes.cobalt.accent),
            title("heading", heading!, 80, 280, 850, 160, {
              role: "heading",
              fontSize: 58,
            }),
            rect(
              "note",
              "Teaching note",
              { x: 80, y: 570, width: 920, height: 300, group: "Lesson" },
              index === 1 ? palettes.cobalt.panel : "#FFFFFF",
              { radius: 22, stroke: "#CED6E8", strokeWidth: 2 }
            ),
            copy("detail", detail!, 135, 650, 780, 120, {
              color: palettes.cobalt.ink,
              group: "Lesson",
              fontSize: 30,
            }),
            line(
              "progress",
              "Progress",
              {
                x: 80,
                y: 970,
                width: 220 + index * 240,
                height: 1,
                group: "Footer",
              },
              palettes.cobalt.accent,
              8
            ),
          ],
          "#F6F8FD"
        )
      ),
      page("recap", "Recap", square, [
        label("label", "SAVE THIS", 80, 80, 300, palettes.cobalt.accent),
        title("heading", "Decision.\nAudience.\nProof.", 80, 250, 740, 280, {
          fontSize: 84,
        }),
        rect(
          "summary",
          "Summary card",
          { x: 80, y: 650, width: 920, height: 250, group: "Summary" },
          palettes.cobalt.accent,
          { radius: 24 }
        ),
        copy(
          "summary-copy",
          "Three checks before the first draft begins.",
          140,
          730,
          740,
          90,
          { color: "#FFFFFF", group: "Summary", fontSize: 29 }
        ),
        label(
          "footer",
          "STUDIO.EXAMPLE",
          80,
          980,
          300,
          palettes.cobalt.accent,
          "Footer"
        ),
      ]),
    ],
  },
  {
    id: "case-study-carousel",
    name: "Case study carousel",
    outputName: "Case study carousel",
    outputKind: "square",
    exportFormats: ["png", "pdf"],
    palette: palettes.ember,
    category: "Carousels",
    description:
      "A four-card case study sequence for context, intervention, result and caveat.",
    tags: ["carousel", "case-study", "proof", "social", "square"],
    formatFamily: "social-carousel",
    useCaseIds: ["carousel", "case-study", "proof"],
    job: "Explain a result with enough context that the reader can judge whether it transfers.",
    pages: [
      page("context", "Context", square, [
        rect(
          "top",
          "Context header",
          { x: 0, y: 0, width: 1080, height: 420, group: "Header" },
          palettes.ember.accent
        ),
        label("label", "CASE STUDY · 01", 75, 70, 400, "#FFE5DA", "Header"),
        title(
          "title",
          "The launch was on time.\nThe team was not aligned.",
          75,
          180,
          900,
          180,
          {
            role: "heading",
            color: "#FFFFFF",
            fieldKey: "case_study_title",
            group: "Header",
            fontSize: 52,
          }
        ),
        copy(
          "context",
          "Fictional context: six owners, four channels and no shared acceptance test.",
          75,
          570,
          850,
          140,
          { color: palettes.ember.ink, fontSize: 30 }
        ),
        label(
          "next",
          "SWIPE FOR THE INTERVENTION →",
          75,
          940,
          650,
          palettes.ember.accent,
          "Footer"
        ),
      ]),
      page("intervention", "Intervention", square, [
        label("label", "02 · INTERVENTION", 75, 70, 420, palettes.ember.accent),
        title(
          "heading",
          "One owner.\nOne weekly decision.\nOne visible definition of done.",
          75,
          220,
          900,
          280,
          { role: "heading", fontSize: 54 }
        ),
        ...["OWNER", "DECISION", "DONE"].map((item, index) =>
          rect(
            `pill-${index}`,
            `${item} pill`,
            {
              x: 75 + index * 310,
              y: 680,
              width: 270,
              height: 100,
              group: "Method",
            },
            index === 1 ? palettes.ember.accent : palettes.ember.panel,
            { radius: 50 }
          )
        ),
        ...["OWNER", "DECISION", "DONE"].map((item, index) =>
          label(
            `pill-label-${index}`,
            item,
            130 + index * 310,
            716,
            160,
            index === 1 ? "#FFFFFF" : palettes.ember.accent,
            "Method"
          )
        ),
      ]),
      page(
        "result",
        "Result",
        square,
        [
          rect(
            "field",
            "Result field",
            { x: 0, y: 0, width: 1080, height: 1080, group: "Result" },
            "#2A1712"
          ),
          label("label", "03 · RESULT", 75, 75, 350, "#F2A58E", "Result"),
          title("value", "−31%", 75, 270, 800, 190, {
            color: "#FFFFFF",
            group: "Result",
            fontSize: 150,
          }),
          title("heading", "fewer revision loops", 75, 500, 850, 100, {
            role: "heading",
            color: "#FFFFFF",
            group: "Result",
            fontSize: 52,
          }),
          copy(
            "source",
            "Synthetic result. Replace with a dated source and sample definition.",
            75,
            780,
            760,
            110,
            { color: "#C9AEA6", group: "Result", fontSize: 22 }
          ),
        ],
        "#2A1712"
      ),
      page("caveat", "Caveat", square, [
        ellipse(
          "mark",
          "Caveat mark",
          { x: 75, y: 75, width: 130, height: 130, group: "Caveat" },
          palettes.ember.accent
        ),
        label("mark-label", "04", 122, 124, 60, "#FFFFFF", "Caveat"),
        title(
          "heading",
          "What did not transfer automatically.",
          75,
          300,
          900,
          130,
          { role: "heading", fontSize: 54 }
        ),
        line(
          "rule",
          "Caveat divider",
          { x: 75, y: 535, width: 930, height: 1, group: "Caveat" },
          "#D9C5BC",
          3
        ),
        copy(
          "copy",
          "The process depended on one empowered owner. Teams without that authority need a different intervention.",
          75,
          640,
          850,
          180,
          { color: palettes.ember.ink, group: "Caveat", fontSize: 31 }
        ),
        label(
          "footer",
          "FULL METHOD · CASES.EXAMPLE",
          75,
          950,
          600,
          palettes.ember.accent,
          "Footer"
        ),
      ]),
    ],
  },
  {
    id: "program-overview-one-pager",
    name: "Program overview one-pager",
    outputName: "Program overview",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.rose,
    category: "Documents",
    description:
      "A one-page program overview for the promise, curriculum, dates and enrollment path.",
    tags: ["document", "one-pager", "program", "education", "portrait"],
    formatFamily: "a4-portrait",
    useCaseIds: ["document", "program", "education"],
    job: "Explain a short program and its enrollment details on one printable page.",
    pages: [
      page("overview", "Overview", a4, [
        rect(
          "hero",
          "Rose hero",
          { x: 0, y: 0, width: 1240, height: 620, group: "Hero" },
          palettes.rose.panel
        ),
        label(
          "label",
          "SPRING PROGRAM · 2027",
          90,
          90,
          600,
          palettes.rose.accent,
          "Hero"
        ),
        title(
          "title",
          "Make better decisions with smaller research.",
          90,
          220,
          960,
          230,
          { fieldKey: "program_title", group: "Hero" }
        ),
        copy(
          "intro",
          "A four-week fictional program for product and service teams.",
          90,
          500,
          800,
          60,
          { color: palettes.rose.ink, group: "Hero" }
        ),
        ...[
          "Week 1 · Frame",
          "Week 2 · Observe",
          "Week 3 · Synthesize",
          "Week 4 · Decide",
        ].map((item, index) =>
          rect(
            `week-${index}`,
            item,
            {
              x: 90 + (index % 2) * 535,
              y: 760 + Math.floor(index / 2) * 240,
              width: 495,
              height: 190,
              group: "Curriculum",
            },
            index === 2 ? palettes.rose.accent : "#FFFFFF",
            { radius: 16, stroke: "#E1CBD1", strokeWidth: 2 }
          )
        ),
        ...[
          "Week 1 · Frame",
          "Week 2 · Observe",
          "Week 3 · Synthesize",
          "Week 4 · Decide",
        ].map((item, index) =>
          copy(
            `week-copy-${index}`,
            item,
            130 + (index % 2) * 535,
            825 + Math.floor(index / 2) * 240,
            410,
            60,
            {
              group: "Curriculum",
              color: index === 2 ? "#FFFFFF" : palettes.rose.ink,
              fontSize: 22,
            }
          )
        ),
        line(
          "rule",
          "Enrollment rule",
          { x: 90, y: 1330, width: 1030, height: 1, group: "Enrollment" },
          "#D7C1C7"
        ),
        title("date", "Applications close 18 March", 90, 1410, 720, 70, {
          role: "heading",
          group: "Enrollment",
          fontSize: 31,
        }),
        label(
          "url",
          "APPLY.PROGRAM.EXAMPLE",
          90,
          1540,
          520,
          palettes.rose.accent,
          "Enrollment"
        ),
      ]),
    ],
  },
]
