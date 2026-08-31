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
    "c61087a1e3f599f4f3581baf318405a400ab92223095fdfdee901fee053e4671",
  "modular-service-proposal":
    "8f5c48a0eb507a48610137fab2bfac4f55ef3f22de0a1cbb7c17dfe1bf4b823f",
  "signal-creative-brief":
    "d02b3e2c79dbc00cbe6db14e9239099fbefd3242b6bc4251a187557622ea3628",
  "workshop-alignment-brief":
    "9e46c67e3b2bcf75fcde4eedcc1fe6c16b9fbc48b594b5e3f3ff41514cb6bcb8",
  "field-notes-report":
    "e5c94f91d7dd742146c3ba11e065b83d418ca2ed0f0142811844edd145020ed3",
  "annual-snapshot-report":
    "6c481c85547717b3a98731616fb13899681fa4e4f20ec78b3cefe5b7a5c5b85a",
  "press-room-media-kit":
    "f32c45c48c6c8b4076eae4040f5e675726b20d6bbe86aa7b99cbd40a7825cad6",
  "venture-pitch-deck":
    "db892c988eb3430a102055db0189a77886851c9a8f9e8f9d19c8b80929e002ae",
  "product-demo-deck":
    "ebd2bd5a4c88865aba93ffb1e7952648f88f4ba1f0a45b574738d2b227db1c99",
  "garden-wedding-invitation":
    "dd5eae3dd7771399da4f4920daa493be64802ada802c15e6c26a1ee8daf0b10b",
  "gallery-opening-invitation":
    "518752f8f060d408ce546aa07bd6daa3f83f73abd5d6494b1272cd08a3314bd8",
  "quiet-quote-post":
    "cf5eaabee4214df279704b98aae47616c04bb3e2199581415d722fece239f9ca",
  "event-countdown-story":
    "bcb1bb06f613a0f86b77e304930046d89259450a4f5d89c4c82b3c4dc2141d76",
  "how-to-carousel":
    "f66454a0213ba346159dd7a0e2a91b681260640ceae088735f71498bfe124af2",
  "case-study-carousel":
    "109b37b42fc313abfbef9714a333b91db0115d795b4e8d5409993bf24e691326",
  "program-overview-one-pager":
    "d49afac5ff3960652d7a3fdc2f687743e2ec4bea0fcc9981540db75ca64a2f33",
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
