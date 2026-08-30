import {
  square,
  story,
  invitation,
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

export const invitationAndSocialStarterPlans: readonly StarterCatalogPlan[] = [
  {
    id: "garden-wedding-invitation",
    name: "Garden wedding invitation",
    outputName: "Wedding invitation",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.olive,
    category: "Invitations",
    description:
      "A formal portrait invitation with a balanced schedule and RSVP block.",
    tags: ["invitation", "wedding", "event", "formal", "portrait"],
    formatFamily: "invitation-portrait",
    useCaseIds: ["invitation", "wedding", "event"],
    job: "Share ceremony details and RSVP information in a print-ready invitation.",
    pages: [
      page("front", "Invitation", invitation, [
        rect(
          "frame",
          "Fine frame",
          { x: 54, y: 54, width: 1092, height: 1492, group: "Frame" },
          "transparent",
          { stroke: palettes.olive.accent, strokeWidth: 3 }
        ),
        ellipse(
          "leaf-a",
          "Botanical mark one",
          { x: 110, y: 110, width: 170, height: 300, group: "Botanical marks" },
          "#D5E0D7"
        ),
        ellipse(
          "leaf-b",
          "Botanical mark two",
          {
            x: 920,
            y: 1190,
            width: 170,
            height: 300,
            group: "Botanical marks",
          },
          "#D5E0D7"
        ),
        label(
          "label",
          "TOGETHER WITH THEIR FAMILIES",
          245,
          250,
          710,
          palettes.olive.accent,
          "Details"
        ),
        title("names", "Mira & Dev", 160, 500, 880, 130, {
          fieldKey: "guest_names",
          align: "center",
          group: "Details",
        }),
        copy(
          "date",
          "Saturday, 20 February 2027 · 4:30 in the afternoon",
          210,
          720,
          780,
          80,
          {
            color: palettes.olive.ink,
            align: "center",
            group: "Details",
            fontSize: 25,
          }
        ),
        line(
          "rule",
          "Invitation divider",
          { x: 400, y: 880, width: 400, height: 1, group: "Details" },
          "#AAB9AD"
        ),
        copy(
          "venue",
          "The Glass Garden\n12 Example Lane · Jaipur",
          250,
          970,
          700,
          120,
          { color: palettes.olive.ink, align: "center", group: "Details" }
        ),
        label(
          "rsvp",
          "RSVP AT MIRA-DEV.EXAMPLE",
          350,
          1330,
          500,
          palettes.olive.accent,
          "RSVP"
        ),
      ]),
    ],
  },
  {
    id: "gallery-opening-invitation",
    name: "Gallery opening invitation",
    outputName: "Gallery invitation",
    outputKind: "custom",
    exportFormats: ["pdf", "png"],
    palette: palettes.ember,
    category: "Invitations",
    description:
      "A graphic invitation for an exhibition, studio opening or private preview.",
    tags: ["invitation", "gallery", "opening", "event", "portrait"],
    formatFamily: "invitation-portrait",
    useCaseIds: ["invitation", "gallery", "event"],
    job: "Announce a visual event with date, place and admission details at a glance.",
    pages: [
      page("poster", "Opening invitation", invitation, [
        rect(
          "top",
          "Coral block",
          { x: 0, y: 0, width: 1200, height: 520, group: "Art" },
          palettes.ember.accent
        ),
        ellipse(
          "cutout",
          "Circular cutout",
          { x: 720, y: 120, width: 620, height: 620, group: "Art" },
          palettes.ember.background
        ),
        label(
          "label",
          "PRIVATE VIEW · ADMISSION FREE",
          70,
          75,
          600,
          "#FFE9DF",
          "Header"
        ),
        title("title", "Form / Function", 70, 260, 930, 150, {
          color: "#FFFFFF",
          fieldKey: "event_title",
          group: "Header",
        }),
        title("date", "08.04.27", 70, 700, 750, 140, {
          role: "heading",
          group: "Details",
          fontSize: 70,
        }),
        copy("time", "Thursday · 18:00–21:00", 70, 870, 700, 70, {
          color: palettes.ember.ink,
          group: "Details",
        }),
        rect(
          "address",
          "Address card",
          { x: 70, y: 1100, width: 850, height: 300, group: "Details" },
          palettes.ember.panel,
          { radius: 8 }
        ),
        label(
          "address-label",
          "EXAMPLE GALLERY",
          120,
          1160,
          400,
          palettes.ember.accent,
          "Details"
        ),
        copy(
          "address-copy",
          "44 Archive Road\nNew Delhi · gallery.example",
          120,
          1250,
          650,
          100,
          { color: palettes.ember.ink, group: "Details" }
        ),
      ]),
    ],
  },
  {
    id: "quiet-quote-post",
    name: "Quiet quote post",
    outputName: "Quote post",
    outputKind: "square",
    exportFormats: ["png"],
    palette: palettes.sand,
    category: "Social posts",
    description:
      "An editorial square for a short quotation, source and small brand mark.",
    tags: ["social-post", "square", "quote", "editorial", "thought-leadership"],
    formatFamily: "social-square",
    useCaseIds: ["social-post", "quote", "thought-leadership"],
    job: "Publish a sourced quotation without crowding the reading experience.",
    pages: [
      page("quote", "Quote post", square, [
        rect(
          "paper",
          "Paper field",
          { x: 48, y: 48, width: 984, height: 984, group: "Frame" },
          palettes.sand.background,
          { stroke: "#CFC2B1", strokeWidth: 2 }
        ),
        ellipse(
          "mark",
          "Quotation mark",
          { x: 100, y: 105, width: 110, height: 110, group: "Quote" },
          palettes.sand.accent
        ),
        title(
          "quote",
          "“Clarity is a design decision, not a writing mood.”",
          100,
          300,
          850,
          310,
          {
            role: "heading",
            fieldKey: "quote_text",
            group: "Quote",
            fontSize: 49,
          }
        ),
        line(
          "rule",
          "Source rule",
          { x: 100, y: 720, width: 280, height: 1, group: "Source" },
          palettes.sand.accent,
          3
        ),
        label(
          "source",
          "SYNTHETIC STARTER QUOTE",
          100,
          780,
          530,
          palettes.sand.accent,
          "Source"
        ),
        copy("brand", "STUDIO.EXAMPLE", 100, 930, 400, 35, {
          group: "Footer",
          fontSize: 17,
        }),
      ]),
    ],
  },
  {
    id: "event-countdown-story",
    name: "Event countdown story",
    outputName: "Event story",
    outputKind: "whatsapp_portrait",
    exportFormats: ["png"],
    palette: palettes.violet,
    category: "Stories",
    description:
      "A two-frame vertical story for a countdown and event detail reveal.",
    tags: ["story", "vertical", "event", "countdown", "social"],
    formatFamily: "social-story",
    useCaseIds: ["story", "event", "countdown"],
    job: "Build anticipation, then reveal the event details in a second frame.",
    pages: [
      page(
        "countdown",
        "Countdown",
        story,
        [
          rect(
            "field",
            "Violet field",
            { x: 0, y: 0, width: 1080, height: 1920, group: "Frame" },
            palettes.violet.accent
          ),
          ellipse(
            "orb-a",
            "Orb one",
            { x: -180, y: 120, width: 700, height: 700, group: "Art" },
            "#8E73E9"
          ),
          ellipse(
            "orb-b",
            "Orb two",
            { x: 640, y: 1020, width: 600, height: 600, group: "Art" },
            "#4E32A8"
          ),
          label("label", "SAVE THE DATE", 90, 100, 500, "#EDE7FF", "Message"),
          title("number", "03", 90, 520, 780, 300, {
            color: "#FFFFFF",
            group: "Message",
            fontSize: 250,
          }),
          title("days", "days to go", 90, 830, 700, 110, {
            role: "heading",
            color: "#FFFFFF",
            fieldKey: "countdown_label",
            group: "Message",
            fontSize: 60,
          }),
          copy("footer", "fictional event · event.example", 90, 1730, 700, 55, {
            color: "#DED4FF",
            group: "Footer",
            fontSize: 20,
          }),
        ],
        palettes.violet.accent
      ),
      page("details", "Details", story, [
        label("label", "THE DETAILS", 90, 100, 400, palettes.violet.accent),
        title("title", "Night School\nfor Better Briefs", 90, 320, 850, 230, {
          fieldKey: "event_title",
        }),
        rect(
          "date-card",
          "Date card",
          { x: 90, y: 740, width: 900, height: 360, group: "Event details" },
          palettes.violet.panel,
          { radius: 28 }
        ),
        label(
          "date-label",
          "THURSDAY · 18:30",
          145,
          815,
          600,
          palettes.violet.accent,
          "Event details"
        ),
        title("date", "17 June 2027", 145, 910, 700, 80, {
          role: "heading",
          group: "Event details",
          fontSize: 43,
        }),
        rect(
          "venue-card",
          "Venue card",
          { x: 90, y: 1160, width: 900, height: 300, group: "Event details" },
          "#231A36",
          { radius: 28 }
        ),
        label(
          "venue-label",
          "VENUE",
          145,
          1230,
          200,
          "#BFAEFF",
          "Event details"
        ),
        copy("venue", "Example Hall · 9 Reference Street", 145, 1320, 720, 70, {
          color: "#FFFFFF",
          group: "Event details",
          fontSize: 27,
        }),
        label(
          "rsvp",
          "RSVP · NIGHT-SCHOOL.EXAMPLE",
          90,
          1730,
          700,
          palettes.violet.accent,
          "Footer"
        ),
      ]),
    ],
  },
]
