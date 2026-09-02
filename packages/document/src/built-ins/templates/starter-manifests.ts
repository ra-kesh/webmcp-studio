import type { DesignTemplateDefinition } from "../../design-templates"
import { createStarterDocument } from "./starter-document-builder"
import type { StarterCatalogPlan } from "./starter-manifest-primitives"
import { briefStarterPlans } from "./starter-manifests-briefs"
import { carouselAndOnePagerStarterPlans } from "./starter-manifests-carousels-one-pagers"
import { deckStarterPlans } from "./starter-manifests-decks"
import { invitationAndSocialStarterPlans } from "./starter-manifests-invitations-social"
import { proposalStarterPlans } from "./starter-manifests-proposals"
import { reportAndMediaStarterPlans } from "./starter-manifests-reports-media"
import { createStudioTemplateManifest } from "./template-manifest"

const createdAt = "2026-08-31T00:00:00.000Z"

const starterPlans: readonly StarterCatalogPlan[] = [
  ...proposalStarterPlans,
  ...briefStarterPlans,
  ...reportAndMediaStarterPlans,
  ...deckStarterPlans,
  ...invitationAndSocialStarterPlans,
  ...carouselAndOnePagerStarterPlans,
]

const starterContentHashes: Readonly<Record<string, string>> = {
  "editorial-proposal":
    "67b7cdb2e98108d0f6095729264c015ed0b5ca790769e6e80eead78493615db7",
  "modular-service-proposal":
    "5e64a63389c54e207d4c34f72ee417999efd0eedbcb3021322de75d7c7eba139",
  "signal-creative-brief":
    "34ef0b0b8321599ebe664eb49f75d0d9aece6404e56aa929d67b120dfbd6181a",
  "workshop-alignment-brief":
    "2b9d10c485e274fc8a84e37e1e28d9ea3a4fbb84219ceba11114ed5cbdf7ce2e",
  "field-notes-report":
    "059d3cb32add58a68a06f74eba6ac7139c3e2e21786e30dc46f99f3e8a7bef30",
  "annual-snapshot-report":
    "f82a52cf3bbb222e85f99dd4ef1d4cc0947c40467f381434cfdd13a51a18571c",
  "press-room-media-kit":
    "9ad056f0e04152baa0aba4363a6ebf70f9c0af7f276495b10c2938bcfa3a9487",
  "venture-pitch-deck":
    "0cd94119a57c97bb960b884a716d388233a5161fe3bcc18765f9a49690c5ae87",
  "product-demo-deck":
    "84a51ff213919cb2a72e0da12a5bfcbac796a7ec21e22aa046c13a2255e662ea",
  "garden-wedding-invitation":
    "4a2c0e9e906b2d3012d0cb5cb200852b3ff14a7dacb4349298d2382b7c19920b",
  "gallery-opening-invitation":
    "c5d41c6223396870775f39d9faf9a63cd1e766d37241cb1ec660858242187a28",
  "quiet-quote-post":
    "2ce3309f2be5ae7d2ff9ec7d319429eb11de65ea6cb5603681d46ebf2999465d",
  "event-countdown-story":
    "89ced8d965d8371e30160678ad29b576e20c2f82a8754856a0d938ee49b351d2",
  "how-to-carousel":
    "6fecccdec7574ead851d470d9e00b46b5c6d0ffd5c4bd6c15ab2c65b13eded6e",
  "case-study-carousel":
    "4e49c860422b4391b77071a7caf3187f5e324f443f0c794b0427cf9c3e303a80",
  "program-overview-one-pager":
    "a5800766355013872f603c9dc35b61ad33aac83b57d9946a35ea61670f0d19ec",
}

export const builtInDocumentStarterDefinitions: DesignTemplateDefinition[] =
  starterPlans.map((plan) => {
    const document = createStarterDocument(plan)
    return {
      schemaVersion: 1,
      id: plan.id,
      version: 1,
      kind: "document_starter" as const,
      name: plan.name,
      description: plan.description,
      category: plan.category,
      tags: [...plan.tags],
      createdAt,
      source: {
        name: "Studio originals",
        license: "Studio original template",
      },
      manifest: createStudioTemplateManifest({
        id: plan.id,
        formatFamily: plan.formatFamily,
        useCaseIds: plan.useCaseIds,
        job: plan.job,
        document,
        contentSha256: starterContentHashes[plan.id]!,
      }),
      document,
    }
  })

export const builtInStarterPlans = starterPlans
