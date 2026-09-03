import type { QuotationRenderPayloadV1 } from "./quotation-contract"

const event = (
  key: string,
  label: string,
  date: string,
  location: string,
  guestCount: string,
  side: "common" | "bride" | "groom" = "common"
) => ({
  key,
  eventType: { id: `event-type-${key}`, key, label },
  side,
  guestCount,
  timelineMode: "fixed" as const,
  fixedDate: date,
  dateWindow: null,
  location,
  notes: null,
})

export const northstarQuotationPayload: QuotationRenderPayloadV1 = {
  contractVersion: 1,
  source: {
    type: "external.quotation",
    quotationId: "quote-demo-2026-0142",
    revision: 3,
  },
  quote: {
    quoteNumber: "Q-2026-0142",
    quoteVersion: 3,
    validUntil: "2026-10-15",
    createdAt: "2026-08-26T09:30:00.000Z",
  },
  branding: {
    schemaVersion: 1,
    organizationName: "Northstar Studio",
    address: "Indiranagar, Bengaluru, Karnataka",
    email: "hello@northstar.studio",
    phone: "+91 98765 43210",
    taxIdentifier: "29ABCDE1234F1Z5",
    timezone: "Asia/Kolkata",
    logoUrl: null,
  },
  document: {
    schemaVersion: 1,
    quotationDate: "2026-08-26",
    quotationType: {
      id: "quotation-type-wedding",
      key: "wedding",
      label: "Wedding photography & films",
    },
    title: "Aditi & Kabir — Wedding Story",
    currency: "INR",
    participants: [
      {
        key: "aditi",
        clientId: "client-aditi",
        clientUpdatedAt: "2026-08-25T12:00:00.000Z",
        contact: {
          name: "Aditi Sharma",
          email: "aditi@example.com",
          phoneNumber: "+91 90000 00001",
          alternatePhone: null,
          address: "Bengaluru, Karnataka",
          profession: null,
          source: "Referral",
          socialHandle: null,
          notes: null,
        },
      },
      {
        key: "kabir",
        clientId: "client-kabir",
        clientUpdatedAt: "2026-08-25T12:05:00.000Z",
        contact: {
          name: "Kabir Mehta",
          email: "kabir@example.com",
          phoneNumber: "+91 90000 00002",
          alternatePhone: null,
          address: "Mumbai, Maharashtra",
          profession: null,
          source: "Referral",
          socialHandle: null,
          notes: null,
        },
      },
    ],
    events: [
      event("welcome", "Welcome dinner", "2026-11-19", "The Courtyard", "120"),
      event("haldi", "Haldi", "2026-11-20", "Garden Pavilion", "180", "bride"),
      event("sangeet", "Sangeet", "2026-11-20", "Grand Ballroom", "320"),
      event(
        "wedding",
        "Wedding ceremony",
        "2026-11-21",
        "Lakeside Mandap",
        "450"
      ),
      event("reception", "Reception", "2026-11-22", "Orchid Hall", "600"),
    ],
    packages: [
      {
        key: "essential",
        configuration: null,
        name: "Essential Story",
        price: "325000",
        summary:
          "Thoughtful photo and film coverage for the wedding’s central moments.",
        coverage: [
          {
            key: "essential-sangeet",
            eventKey: "sangeet",
            roles: "2 photographers · 2 cinematographers",
          },
          {
            key: "essential-wedding",
            eventKey: "wedding",
            roles: "3 photographers · 3 cinematographers · drone",
          },
          {
            key: "essential-reception",
            eventKey: "reception",
            roles: "2 photographers · 2 cinematographers",
          },
        ],
        deliverables: [
          {
            key: "essential-photos",
            name: "Curated edited photographs",
            quantity: 650,
            details: "High-resolution digital delivery",
          },
          {
            key: "essential-film",
            name: "Wedding film",
            quantity: 1,
            details: "18–22 minute cinematic film",
          },
          {
            key: "essential-teaser",
            name: "Social teaser",
            quantity: 1,
            details: "60–90 second vertical edit",
          },
        ],
      },
      {
        key: "signature",
        configuration: null,
        name: "Signature Story",
        price: "485000",
        summary:
          "Complete multi-day storytelling with an expanded crew and heirloom album.",
        coverage: [
          {
            key: "signature-welcome",
            eventKey: "welcome",
            roles: "1 photographer · 1 cinematographer",
          },
          {
            key: "signature-haldi",
            eventKey: "haldi",
            roles: "2 photographers · 2 cinematographers",
          },
          {
            key: "signature-sangeet",
            eventKey: "sangeet",
            roles: "3 photographers · 3 cinematographers",
          },
          {
            key: "signature-wedding",
            eventKey: "wedding",
            roles: "4 photographers · 4 cinematographers · drone",
          },
          {
            key: "signature-reception",
            eventKey: "reception",
            roles: "3 photographers · 3 cinematographers",
          },
        ],
        deliverables: [
          {
            key: "signature-photos",
            name: "Curated edited photographs",
            quantity: 1000,
            details: "High-resolution and web-ready galleries",
          },
          {
            key: "signature-film",
            name: "Feature wedding film",
            quantity: 1,
            details: "25–30 minute cinematic film",
          },
          {
            key: "signature-highlight",
            name: "Highlight film",
            quantity: 1,
            details: "5–7 minute shareable edit",
          },
          {
            key: "signature-teasers",
            name: "Social teasers",
            quantity: 3,
            details: "Vertical edits delivered across the celebration",
          },
          {
            key: "signature-album",
            name: "Fine-art album",
            quantity: 1,
            details: "40 spreads with collaborative design",
          },
        ],
      },
      {
        key: "legacy",
        configuration: null,
        name: "Legacy Story",
        price: "695000",
        summary:
          "Our fullest production, including same-day edits, archival films and parent albums.",
        coverage: [
          {
            key: "legacy-welcome",
            eventKey: "welcome",
            roles: "2 photographers · 2 cinematographers",
          },
          {
            key: "legacy-haldi",
            eventKey: "haldi",
            roles: "3 photographers · 2 cinematographers",
          },
          {
            key: "legacy-sangeet",
            eventKey: "sangeet",
            roles: "4 photographers · 4 cinematographers · live edit",
          },
          {
            key: "legacy-wedding",
            eventKey: "wedding",
            roles: "5 photographers · 5 cinematographers · drone",
          },
          {
            key: "legacy-reception",
            eventKey: "reception",
            roles: "4 photographers · 4 cinematographers",
          },
        ],
        deliverables: [
          {
            key: "legacy-photos",
            name: "Curated edited photographs",
            quantity: 1400,
            details: "High-resolution, web-ready and archival galleries",
          },
          {
            key: "legacy-film",
            name: "Feature wedding film",
            quantity: 1,
            details: "35–45 minute cinematic film",
          },
          {
            key: "legacy-documentary",
            name: "Documentary ceremony films",
            quantity: 3,
            details: "Full-length multi-camera edits",
          },
          {
            key: "legacy-highlight",
            name: "Highlight film",
            quantity: 1,
            details: "7–9 minute shareable edit",
          },
          {
            key: "legacy-sde",
            name: "Same-day edit",
            quantity: 1,
            details: "Screened during the reception",
          },
          {
            key: "legacy-teasers",
            name: "Social teasers",
            quantity: 5,
            details: "Vertical edits throughout the celebration",
          },
          {
            key: "legacy-album",
            name: "Couple fine-art album",
            quantity: 1,
            details: "50 spreads with presentation box",
          },
          {
            key: "legacy-parent-albums",
            name: "Parent albums",
            quantity: 2,
            details: "30 spreads each",
          },
        ],
      },
    ],
    recommendedPackageKey: "signature",
    termsConfiguration: {
      id: "terms-standard-wedding",
      key: "standard-wedding",
      label: "Standard wedding terms",
      metadataVersion: 1,
    },
    deliveryTimelines: [
      {
        key: "preview",
        text: "A preview gallery of 50–75 photographs will be delivered within 7 working days.",
      },
      {
        key: "gallery",
        text: "The complete edited photography gallery will be delivered within 10–12 weeks.",
      },
      {
        key: "films",
        text: "Highlight and feature films will be delivered within 14–16 weeks after music selection.",
      },
      {
        key: "albums",
        text: "Album design begins after photograph selection and includes two consolidated revision rounds.",
      },
    ],
    paymentMilestones: [
      {
        key: "booking",
        label: "Booking",
        percentage: "30",
        timing: "On quotation acceptance",
      },
      {
        key: "production",
        label: "Production",
        percentage: "50",
        timing: "30 days before the first event",
      },
      {
        key: "delivery",
        label: "Final delivery",
        percentage: "20",
        timing: "Before release of final films",
      },
    ],
    fixedTerms: [
      {
        key: "travel",
        text: "Travel, accommodation and local transport outside Bengaluru are billed at actuals and arranged by the client.",
      },
      {
        key: "meals",
        text: "Crew meals and safe drinking water must be provided during every covered event.",
      },
      {
        key: "permissions",
        text: "The client is responsible for venue, music and drone permissions where applicable.",
      },
      {
        key: "usage",
        text: "Northstar Studio may use selected work in its portfolio unless a written confidentiality addendum is agreed.",
      },
      {
        key: "reschedule",
        text: "Date changes remain subject to team availability and may require revised travel or production charges.",
      },
      {
        key: "cancellation",
        text: "The booking amount is non-refundable because the production dates and team are reserved exclusively.",
      },
    ],
  },
}
