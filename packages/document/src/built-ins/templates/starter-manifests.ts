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
    "75932e36ad445a25980d085812fa28af71616d0346bfc56a303251a0c5cd76cf",
  "modular-service-proposal":
    "9a7ea284d1ccb76cc0cc669baacbee9c979c0db0dd65ef2bfaba5f3a1c35bd4e",
  "signal-creative-brief":
    "2254ff8ab5834e066a6a27039f0c9141b4ba2fede5ae00710de6203879a97ce4",
  "workshop-alignment-brief":
    "916e588aab71724bfd6a0a2fa31154408d38433c242c3a2464def794514f3ceb",
  "field-notes-report":
    "95264f221060c889a39eeaba49206832c0a0c2447954d1e4404d534ef7440fe3",
  "annual-snapshot-report":
    "c22bc025532b3889981f5f16fbaaa120d0987b474fb17c83f3fd2cb72bac377a",
  "press-room-media-kit":
    "5e073d54020b8aa513e1f99e49b5a4d9ab960eeddc076d2d5d435ba21b7b56aa",
  "venture-pitch-deck":
    "6e4136d802782e891e1344371f28a4797a2a5ff7a8f1a256b2465577d837297d",
  "product-demo-deck":
    "e0bc1e3e7b8970270f65bd47f31a79d6620315cd30c30d92ddd67526118bca06",
  "garden-wedding-invitation":
    "91194d8461568b432eac71bb61d9bd6c486d86fd6672f2763848b237f3a7d966",
  "gallery-opening-invitation":
    "647846813e8036f0a1a62de79e980c2e16ba8272e74596c791d9e5ef9c6052ba",
  "quiet-quote-post":
    "92494c547ee38a92bfc4b5ab5e80592b17a3c4fa861d7a449158d631badeb369",
  "event-countdown-story":
    "7ec6c9094d49d4a82eda4ef267fec9dd4dda328645c5f88367b847d22d4bb069",
  "how-to-carousel":
    "1e277e58afe5afc3513dc59fd2f92988efc019c25081d4f3fc409fa7420d4985",
  "case-study-carousel":
    "9f0e203d34b9e4c6f0e4bfdef3fb94474c8dd66a7074a327bb4af12cbe170fe5",
  "program-overview-one-pager":
    "6ec224f3a88c8aee85d6754bd9540f864cc85365f12c2b537ac531731854914b",
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
