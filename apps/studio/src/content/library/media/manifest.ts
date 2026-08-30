import type { LibraryProvenance } from "@webmcp/document"
import { z } from "zod"

const catalogIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const normalizedTokenPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
const sha256Pattern = /^[a-f0-9]{64}$/
const sha1Pattern = /^[a-f0-9]{40}$/
const openMojiRevision = "aeb8bb3a59e2de39c754ac79180c8131c906acea"
const openMojiTimestamp = "2026-08-12T09:57:37.000Z"
const studioOriginalCreatedAt = "2026-08-26T00:00:00.000Z"
const studioOriginalUpdatedAt = "2026-08-31T00:00:00.000Z"
const wikimediaPhotoImportedAt = "2026-08-31T00:00:00.000Z"

const unique = <Value>(values: readonly Value[]) =>
  new Set(values).size === values.length

const publicHttpUrlSchema = z
  .string()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))

const studioMediaProvenanceSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(200),
    sourceUrl: publicHttpUrlSchema.nullable(),
    license: z
      .object({
        id: z.enum(["studio-original-artwork", "cc-by-sa-4.0", "cc0-1.0"]),
        name: z.string().trim().min(1).max(200),
        url: publicHttpUrlSchema.nullable(),
      })
      .strict(),
    attribution: z
      .object({
        required: z.boolean(),
        text: z.string().trim().min(1).max(500).nullable(),
      })
      .strict(),
    contentSha256: z.string().regex(sha256Pattern),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.attribution.required && !provenance.attribution.text) {
      context.addIssue({
        code: "custom",
        path: ["attribution", "text"],
        message: "Required attribution must include display text",
      })
    }
  })

const wikimediaSourceEvidenceSchema = z
  .object({
    provider: z.literal("Wikimedia Commons"),
    creatorName: z.string().trim().min(1).max(200),
    filePageUrl: publicHttpUrlSchema.refine(
      (value) => value.startsWith("https://commons.wikimedia.org/wiki/File:"),
      "Wikimedia evidence must link to the exact Commons file page"
    ),
    originalUrl: publicHttpUrlSchema.refine(
      (value) => new URL(value).hostname === "upload.wikimedia.org",
      "Wikimedia evidence must link to the original upload host"
    ),
    sourceContentSha1: z.string().regex(sha1Pattern),
    retrievedAt: z.string().datetime(),
    originalBytesPreserved: z.literal(true),
  })
  .strict()

const immutableMediaPathSchema = z
  .string()
  .startsWith("/library/media/")
  .refine(
    (value) =>
      /^\/library\/media\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}\/v[1-9][0-9]*\/[a-f0-9]{64}\.(?:svg|jpg|png|webp)$/.test(
        value
      ),
    "Curated media paths must encode the item ID, version, and SHA-256"
  )

export const studioMediaManifestItemSchema = z
  .object({
    id: z.string().regex(catalogIdPattern),
    version: z.number().int().positive(),
    contentSha256: z.string().regex(sha256Pattern),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(300),
    tags: z
      .array(z.string().regex(normalizedTokenPattern))
      .min(2)
      .max(20)
      .refine(unique, "Media tags must be unique"),
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
    resourcePath: immutableMediaPathSchema,
    mimeType: z.enum([
      "image/svg+xml",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    bytes: z.number().int().positive().max(25_000_000),
    categoryId: z.enum([
      "background",
      "texture",
      "illustration",
      "graphic-element",
      "photograph",
    ]),
    useCaseIds: z
      .array(z.string().regex(normalizedTokenPattern))
      .min(1)
      .max(12)
      .refine(unique, "Media use cases must be unique"),
    formatFamily: z.enum(["vector", "raster"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    provenance: studioMediaProvenanceSchema,
    sourceEvidence: wikimediaSourceEvidenceSchema.nullable().default(null),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.provenance.contentSha256 !== item.contentSha256) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "contentSha256"],
        message: "Provenance checksum must match the exact media bytes",
      })
    }
    const extension =
      item.mimeType === "image/svg+xml"
        ? "svg"
        : item.mimeType === "image/jpeg"
          ? "jpg"
          : item.mimeType === "image/png"
            ? "png"
            : "webp"
    const expectedResourcePath = `/library/media/${item.id}/v${item.version}/${item.contentSha256}.${extension}`
    if (item.resourcePath !== expectedResourcePath) {
      context.addIssue({
        code: "custom",
        path: ["resourcePath"],
        message: "Media resource path must match its identity and checksum",
      })
    }
    if (item.updatedAt < item.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Media update time cannot precede its creation time",
      })
    }
    if (
      (item.mimeType === "image/svg+xml") !==
      (item.formatFamily === "vector")
    ) {
      context.addIssue({
        code: "custom",
        path: ["formatFamily"],
        message: "Vector media must be SVG and raster media must not be SVG",
      })
    }
    const isStudioOriginal =
      item.provenance.license.id === "studio-original-artwork"
    if (isStudioOriginal) {
      if (
        item.provenance.sourceName !== "Studio originals" ||
        item.provenance.sourceUrl !== null ||
        item.provenance.license.url !== null ||
        item.provenance.attribution.required ||
        item.provenance.attribution.text !== null ||
        item.sourceEvidence !== null ||
        item.formatFamily !== "vector"
      ) {
        context.addIssue({
          code: "custom",
          path: ["provenance"],
          message: "Studio originals must use the internal provenance policy",
        })
      }
    } else if (item.provenance.license.id === "cc-by-sa-4.0") {
      const validOpenMojiSource =
        item.provenance.sourceName === "OpenMoji" &&
        item.provenance.sourceUrl?.startsWith(
          `https://github.com/hfg-gmuend/openmoji/blob/${openMojiRevision}/color/svg/`
        ) &&
        item.provenance.license.name ===
          "Creative Commons Attribution-ShareAlike 4.0" &&
        item.provenance.license.url ===
          "https://creativecommons.org/licenses/by-sa/4.0/" &&
        item.provenance.attribution.required &&
        Boolean(item.provenance.attribution.text)
      if (!validOpenMojiSource) {
        context.addIssue({
          code: "custom",
          path: ["provenance"],
          message:
            "OpenMoji media requires its pinned source, exact license, and creator attribution",
        })
      }
      if (item.sourceEvidence !== null) {
        context.addIssue({
          code: "custom",
          path: ["sourceEvidence"],
          message: "OpenMoji items use their pinned repository revision",
        })
      }
    } else {
      const evidence = item.sourceEvidence
      const validWikimediaCc0Source =
        item.provenance.sourceName === "Wikimedia Commons" &&
        item.provenance.sourceUrl === evidence?.filePageUrl &&
        item.provenance.license.name ===
          "Creative Commons CC0 1.0 Universal Public Domain Dedication" &&
        item.provenance.license.url ===
          "https://creativecommons.org/publicdomain/zero/1.0/" &&
        !item.provenance.attribution.required &&
        Boolean(item.provenance.attribution.text) &&
        item.formatFamily === "raster" &&
        item.categoryId !== "illustration" &&
        item.categoryId !== "graphic-element" &&
        evidence !== null
      if (!validWikimediaCc0Source) {
        context.addIssue({
          code: "custom",
          path: ["provenance"],
          message:
            "CC0 photographs require exact Wikimedia source evidence and license terms",
        })
      }
    }
  })

export type StudioMediaManifestItem = z.infer<
  typeof studioMediaManifestItemSchema
>

const studioOriginalProvenance = (
  contentSha256: string
): z.infer<typeof studioMediaProvenanceSchema> =>
  ({
    sourceName: "Studio originals",
    sourceUrl: null,
    license: {
      id: "studio-original-artwork" as const,
      name: "Original Studio artwork",
      url: null,
    },
    attribution: { required: false, text: null },
    contentSha256,
  }) satisfies LibraryProvenance

const openMojiProvenance = (
  codepoint: string,
  creator: string,
  contentSha256: string
): z.infer<typeof studioMediaProvenanceSchema> =>
  ({
    sourceName: "OpenMoji",
    sourceUrl: `https://github.com/hfg-gmuend/openmoji/blob/${openMojiRevision}/color/svg/${codepoint}.svg`,
    license: {
      id: "cc-by-sa-4.0" as const,
      name: "Creative Commons Attribution-ShareAlike 4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    attribution: {
      required: true,
      text: `OpenMoji artwork by ${creator}, licensed under CC BY-SA 4.0.`,
    },
    contentSha256,
  }) satisfies LibraryProvenance

const wikimediaCc0Provenance = (
  creatorName: string,
  filePageUrl: string,
  contentSha256: string
): z.infer<typeof studioMediaProvenanceSchema> =>
  ({
    sourceName: "Wikimedia Commons",
    sourceUrl: filePageUrl,
    license: {
      id: "cc0-1.0" as const,
      name: "Creative Commons CC0 1.0 Universal Public Domain Dedication",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    attribution: {
      required: false,
      text: `Photograph by ${creatorName}, made available via Wikimedia Commons under CC0 1.0.`,
    },
    contentSha256,
  }) satisfies LibraryProvenance

type ManifestDefinition = z.input<typeof studioMediaManifestItemSchema>

const studioOriginal = (
  definition: Omit<
    ManifestDefinition,
    "mimeType" | "formatFamily" | "createdAt" | "updatedAt" | "provenance"
  >
): ManifestDefinition => ({
  ...definition,
  mimeType: "image/svg+xml",
  formatFamily: "vector",
  createdAt: studioOriginalCreatedAt,
  updatedAt: studioOriginalUpdatedAt,
  provenance: studioOriginalProvenance(definition.contentSha256),
})

const openMoji = (
  definition: Omit<
    ManifestDefinition,
    | "version"
    | "width"
    | "height"
    | "mimeType"
    | "formatFamily"
    | "createdAt"
    | "updatedAt"
    | "provenance"
  > & { codepoint: string; creator: string }
): ManifestDefinition => {
  const { codepoint, creator, ...item } = definition
  return {
    ...item,
    version: 1,
    width: 72,
    height: 72,
    mimeType: "image/svg+xml",
    formatFamily: "vector",
    createdAt: openMojiTimestamp,
    updatedAt: openMojiTimestamp,
    provenance: openMojiProvenance(codepoint, creator, item.contentSha256),
  }
}

const wikimediaCc0Photo = (
  definition: Omit<
    ManifestDefinition,
    | "version"
    | "mimeType"
    | "formatFamily"
    | "createdAt"
    | "updatedAt"
    | "provenance"
    | "sourceEvidence"
  > & {
    creatorName: string
    filePageUrl: string
    originalUrl: string
    sourceContentSha1: string
  }
): ManifestDefinition => {
  const { creatorName, filePageUrl, originalUrl, sourceContentSha1, ...item } =
    definition
  return {
    ...item,
    version: 1,
    mimeType: "image/jpeg",
    formatFamily: "raster",
    createdAt: wikimediaPhotoImportedAt,
    updatedAt: wikimediaPhotoImportedAt,
    provenance: wikimediaCc0Provenance(
      creatorName,
      filePageUrl,
      item.contentSha256
    ),
    sourceEvidence: {
      provider: "Wikimedia Commons",
      creatorName,
      filePageUrl,
      originalUrl,
      sourceContentSha1,
      retrievedAt: wikimediaPhotoImportedAt,
      originalBytesPreserved: true,
    },
  }
}

const manifestDefinitions: ManifestDefinition[] = [
  studioOriginal({
    id: "olive-botanical",
    version: 2,
    contentSha256:
      "a8930b85774f6690aceb75ddbf7729cdc7d5a0e789abd091264bd18fb4d79236",
    name: "Olive botanical",
    description: "Soft botanical composition on warm ivory.",
    tags: ["botanical", "olive", "wedding", "editorial", "ivory"],
    width: 1200,
    height: 1500,
    resourcePath:
      "/library/media/olive-botanical/v2/a8930b85774f6690aceb75ddbf7729cdc7d5a0e789abd091264bd18fb4d79236.svg",
    bytes: 962,
    categoryId: "illustration",
    useCaseIds: ["wedding", "invitation", "proposal"],
  }),
  studioOriginal({
    id: "sandstone-arches",
    version: 2,
    contentSha256:
      "e9796107e3bb59c82655400455c7d9a7c9aaa707021da3a457e9c44bd91047e2",
    name: "Sandstone arches",
    description: "Architectural arches with restrained earth tones.",
    tags: ["architecture", "arches", "sandstone", "travel", "minimal"],
    width: 1600,
    height: 1200,
    resourcePath:
      "/library/media/sandstone-arches/v2/e9796107e3bb59c82655400455c7d9a7c9aaa707021da3a457e9c44bd91047e2.svg",
    bytes: 595,
    categoryId: "background",
    useCaseIds: ["proposal", "presentation", "media-kit"],
  }),
  studioOriginal({
    id: "linen-paper",
    version: 2,
    contentSha256:
      "e26c8837305e1f4ac1b1935021ab2db9f579ec9b03fad043fd3e345507e0f280",
    name: "Linen paper",
    description: "Subtle woven paper texture for quiet backgrounds.",
    tags: ["paper", "linen", "texture", "neutral", "background"],
    width: 1400,
    height: 1400,
    resourcePath:
      "/library/media/linen-paper/v2/e26c8837305e1f4ac1b1935021ab2db9f579ec9b03fad043fd3e345507e0f280.svg",
    bytes: 628,
    categoryId: "texture",
    useCaseIds: ["proposal", "report", "invitation"],
  }),
  studioOriginal({
    id: "dusk-blocks",
    version: 2,
    contentSha256:
      "bac57630634ee666e05a1010cb8053ca68ec053372c9ff874ec31869289f5edc",
    name: "Dusk blocks",
    description: "Deep plum and clay geometric editorial study.",
    tags: ["abstract", "plum", "clay", "geometric", "modern"],
    width: 1600,
    height: 1000,
    resourcePath:
      "/library/media/dusk-blocks/v2/bac57630634ee666e05a1010cb8053ca68ec053372c9ff874ec31869289f5edc.svg",
    bytes: 529,
    categoryId: "background",
    useCaseIds: ["presentation", "media-kit", "social-post"],
  }),
  studioOriginal({
    id: "floral-linework",
    version: 2,
    contentSha256:
      "272cf5663b71b3fb1c96a2b8868c8bc0d0ff57d097d8761efe16cac8965beec7",
    name: "Floral linework",
    description: "Fine ink flowers on a muted blush field.",
    tags: ["floral", "linework", "blush", "invitation", "delicate"],
    width: 1200,
    height: 1500,
    resourcePath:
      "/library/media/floral-linework/v2/272cf5663b71b3fb1c96a2b8868c8bc0d0ff57d097d8761efe16cac8965beec7.svg",
    bytes: 681,
    categoryId: "illustration",
    useCaseIds: ["invitation", "wedding", "story"],
  }),
  studioOriginal({
    id: "warm-grain",
    version: 2,
    contentSha256:
      "9fb85e0e8d56927e0aeb53d9c52fe5d2b5d24001ccf4fb58199976b8717d8805",
    name: "Warm grain",
    description: "Soft terracotta gradient with an organic grain.",
    tags: ["gradient", "terracotta", "warm", "grain", "background"],
    width: 1600,
    height: 1200,
    resourcePath:
      "/library/media/warm-grain/v2/9fb85e0e8d56927e0aeb53d9c52fe5d2b5d24001ccf4fb58199976b8717d8805.svg",
    bytes: 628,
    categoryId: "texture",
    useCaseIds: ["presentation", "social-post", "story"],
  }),
  openMoji({
    id: "cherry-blossom",
    codepoint: "1F338",
    creator: "Hilda Kalyoncu",
    contentSha256:
      "f8cee8b0a231fc395288cd2c33e41ede7150be2a72f0e3d1c0308b08405b3a4f",
    name: "Cherry blossom",
    description: "A bright floral accent for invitations and announcements.",
    tags: ["flower", "blossom", "spring", "pink", "celebration"],
    resourcePath:
      "/library/media/cherry-blossom/v1/f8cee8b0a231fc395288cd2c33e41ede7150be2a72f0e3d1c0308b08405b3a4f.svg",
    bytes: 3565,
    categoryId: "illustration",
    useCaseIds: ["invitation", "social-post", "announcement"],
  }),
  openMoji({
    id: "hibiscus",
    codepoint: "1F33A",
    creator: "Hilda Kalyoncu",
    contentSha256:
      "6d297061a2a9cc5da0993769e76235936e50c67a3864f6fcf1e2ef93625231f2",
    name: "Hibiscus",
    description: "A tropical floral accent with a vivid pink bloom.",
    tags: ["flower", "tropical", "pink", "summer", "accent"],
    resourcePath:
      "/library/media/hibiscus/v1/6d297061a2a9cc5da0993769e76235936e50c67a3864f6fcf1e2ef93625231f2.svg",
    bytes: 3356,
    categoryId: "illustration",
    useCaseIds: ["invitation", "social-post", "story"],
  }),
  openMoji({
    id: "sunflower",
    codepoint: "1F33B",
    creator: "Hilda Kalyoncu",
    contentSha256:
      "8ec898c7225016a95cc1c71c1634ac2e1966f5c97b7d9ee209ebe35a003fa08b",
    name: "Sunflower",
    description: "A warm botanical illustration for upbeat seasonal work.",
    tags: ["flower", "sunflower", "yellow", "summer", "botanical"],
    resourcePath:
      "/library/media/sunflower/v1/8ec898c7225016a95cc1c71c1634ac2e1966f5c97b7d9ee209ebe35a003fa08b.svg",
    bytes: 4348,
    categoryId: "illustration",
    useCaseIds: ["invitation", "social-post", "announcement"],
  }),
  openMoji({
    id: "seedling",
    codepoint: "1F331",
    creator: "Hilda Kalyoncu",
    contentSha256:
      "5f7b280dd0435ea429e6086f18f11a4e02ce46b2497c2231a115feca40634513",
    name: "Seedling",
    description: "A simple growth symbol for reports and launch stories.",
    tags: ["plant", "growth", "green", "sustainability", "new"],
    resourcePath:
      "/library/media/seedling/v1/5f7b280dd0435ea429e6086f18f11a4e02ce46b2497c2231a115feca40634513.svg",
    bytes: 1380,
    categoryId: "illustration",
    useCaseIds: ["report", "presentation", "social-post"],
  }),
  openMoji({
    id: "herb",
    codepoint: "1F33F",
    creator: "Hilda Kalyoncu",
    contentSha256:
      "c12bbb477a76f25279cc908beb8de5b9c1a72abc707242b2aeb4a2ec73314e45",
    name: "Herb sprig",
    description: "A restrained green sprig for editorial and event layouts.",
    tags: ["herb", "leaf", "green", "botanical", "editorial"],
    resourcePath:
      "/library/media/herb/v1/c12bbb477a76f25279cc908beb8de5b9c1a72abc707242b2aeb4a2ec73314e45.svg",
    bytes: 2308,
    categoryId: "illustration",
    useCaseIds: ["proposal", "invitation", "report"],
  }),
  openMoji({
    id: "rocket",
    codepoint: "1F680",
    creator: "Kris Kowal",
    contentSha256:
      "2403e0a305f931cf8c2ebd1a06de994c08733d0554eda8c0e52d1b8fe1be7001",
    name: "Rocket",
    description: "A launch and momentum illustration for product stories.",
    tags: ["rocket", "launch", "growth", "startup", "momentum"],
    resourcePath:
      "/library/media/rocket/v1/2403e0a305f931cf8c2ebd1a06de994c08733d0554eda8c0e52d1b8fe1be7001.svg",
    bytes: 4498,
    categoryId: "illustration",
    useCaseIds: ["launch", "presentation", "social-post"],
  }),
  openMoji({
    id: "star",
    codepoint: "2B50",
    creator: "Vanessa Boutzikoudi",
    contentSha256:
      "0927c3818e30711a17aa2a14b6b7383f4aab767c865d8f88ad491e91b0de49f0",
    name: "Star",
    description: "A bold yellow star for ratings, highlights and badges.",
    tags: ["star", "rating", "highlight", "yellow", "badge"],
    resourcePath:
      "/library/media/star/v1/0927c3818e30711a17aa2a14b6b7383f4aab767c865d8f88ad491e91b0de49f0.svg",
    bytes: 693,
    categoryId: "graphic-element",
    useCaseIds: ["presentation", "social-post", "media-kit"],
  }),
  openMoji({
    id: "sparkles",
    codepoint: "2728",
    creator: "Laura Humpfer",
    contentSha256:
      "76228cbcc43f550920f5913a32efd87356abb454c904f272d13bc0f317228cbd",
    name: "Sparkles",
    description: "A lively sparkle cluster for celebratory emphasis.",
    tags: ["sparkle", "shine", "celebration", "highlight", "magic"],
    resourcePath:
      "/library/media/sparkles/v1/76228cbcc43f550920f5913a32efd87356abb454c904f272d13bc0f317228cbd.svg",
    bytes: 4695,
    categoryId: "graphic-element",
    useCaseIds: ["invitation", "social-post", "story"],
  }),
  openMoji({
    id: "confetti-ball",
    codepoint: "1F38A",
    creator: "Laura Humpfer",
    contentSha256:
      "003dc0178b1cde3ec3f2ed7a82d85488a56f7cbd62053ccadb681f5d102f5026",
    name: "Confetti ball",
    description: "A party accent for milestones, launches and events.",
    tags: ["confetti", "party", "celebration", "event", "colorful"],
    resourcePath:
      "/library/media/confetti-ball/v1/003dc0178b1cde3ec3f2ed7a82d85488a56f7cbd62053ccadb681f5d102f5026.svg",
    bytes: 3126,
    categoryId: "illustration",
    useCaseIds: ["invitation", "announcement", "social-post"],
  }),
  openMoji({
    id: "wrapped-gift",
    codepoint: "1F381",
    creator: "Laura Humpfer",
    contentSha256:
      "3153933c75f6195a64d67041ecd76b7ec7f391fd7bf2552709d6b6cf59dbe2dd",
    name: "Wrapped gift",
    description: "A colorful gift illustration for offers and celebrations.",
    tags: ["gift", "present", "celebration", "offer", "surprise"],
    resourcePath:
      "/library/media/wrapped-gift/v1/3153933c75f6195a64d67041ecd76b7ec7f391fd7bf2552709d6b6cf59dbe2dd.svg",
    bytes: 3138,
    categoryId: "illustration",
    useCaseIds: ["invitation", "announcement", "social-post"],
  }),
  openMoji({
    id: "bullseye",
    codepoint: "1F3AF",
    creator: "Vanessa Boutzikoudi",
    contentSha256:
      "dda0ccf93e7ffb4a513cd8ffc056066a5650470fa4b55a5770b7ebbb7eb5baf6",
    name: "Bullseye",
    description: "A clear target symbol for goals, plans and results.",
    tags: ["target", "goal", "strategy", "focus", "result"],
    resourcePath:
      "/library/media/bullseye/v1/dda0ccf93e7ffb4a513cd8ffc056066a5650470fa4b55a5770b7ebbb7eb5baf6.svg",
    bytes: 2879,
    categoryId: "graphic-element",
    useCaseIds: ["brief", "report", "presentation"],
  }),
  openMoji({
    id: "artist-palette",
    codepoint: "1F3A8",
    creator: "Martin Wehl",
    contentSha256:
      "1e440790c0d02486a2dbd061ec465f78e28111d0c778dec08de62df123959cb6",
    name: "Artist palette",
    description: "A creative-work illustration for portfolios and media kits.",
    tags: ["palette", "creative", "art", "design", "color"],
    resourcePath:
      "/library/media/artist-palette/v1/1e440790c0d02486a2dbd061ec465f78e28111d0c778dec08de62df123959cb6.svg",
    bytes: 2502,
    categoryId: "illustration",
    useCaseIds: ["media-kit", "presentation", "social-post"],
  }),
  openMoji({
    id: "megaphone",
    codepoint: "1F4E3",
    creator: "Abby Esquivel",
    contentSha256:
      "96834a755ee2dafbaddfef2344bccd56428ae2f1521bea3b39366df0afec98ed",
    name: "Megaphone",
    description: "A strong announcement symbol for launches and campaigns.",
    tags: ["megaphone", "announcement", "marketing", "campaign", "launch"],
    resourcePath:
      "/library/media/megaphone/v1/96834a755ee2dafbaddfef2344bccd56428ae2f1521bea3b39366df0afec98ed.svg",
    bytes: 2302,
    categoryId: "illustration",
    useCaseIds: ["launch", "media-kit", "social-post"],
  }),
  openMoji({
    id: "camera",
    codepoint: "1F4F7",
    creator: "Sina Schulz",
    contentSha256:
      "9e3990ec197bcbad99beed791e7605def1d64c8ac80f276dfb61580fd4badbc3",
    name: "Camera",
    description: "A photographic services symbol for proposals and media kits.",
    tags: ["camera", "photography", "photo", "studio", "media"],
    resourcePath:
      "/library/media/camera/v1/9e3990ec197bcbad99beed791e7605def1d64c8ac80f276dfb61580fd4badbc3.svg",
    bytes: 2686,
    categoryId: "illustration",
    useCaseIds: ["proposal", "media-kit", "social-post"],
  }),
  openMoji({
    id: "video-camera",
    codepoint: "1F4F9",
    creator: "Sina Schulz",
    contentSha256:
      "d30ccd2cddd2850302c954118d5355c71105b0672223fbef0fc3b4eaf40d025a",
    name: "Video camera",
    description: "A film and recording symbol for creative service layouts.",
    tags: ["video", "camera", "film", "recording", "media"],
    resourcePath:
      "/library/media/video-camera/v1/d30ccd2cddd2850302c954118d5355c71105b0672223fbef0fc3b4eaf40d025a.svg",
    bytes: 2706,
    categoryId: "illustration",
    useCaseIds: ["proposal", "media-kit", "presentation"],
  }),
  openMoji({
    id: "light-bulb",
    codepoint: "1F4A1",
    creator: "Sina Schulz",
    contentSha256:
      "fb98f3985e05ab294e1ca1beee18d5c557d1572b316756a9abd00d8901807b43",
    name: "Light bulb",
    description: "An idea symbol for briefs, concepts and presentations.",
    tags: ["idea", "light", "concept", "innovation", "insight"],
    resourcePath:
      "/library/media/light-bulb/v1/fb98f3985e05ab294e1ca1beee18d5c557d1572b316756a9abd00d8901807b43.svg",
    bytes: 2016,
    categoryId: "illustration",
    useCaseIds: ["brief", "presentation", "report"],
  }),
  openMoji({
    id: "envelope",
    codepoint: "2709",
    creator: "Marius Schnabel",
    contentSha256:
      "df6fdfb9ed5a02e5aedabbfc03040034c3f085deafa6caeeeddeb78ae0054d8f",
    name: "Envelope",
    description:
      "A classic correspondence symbol for invitations and contact cards.",
    tags: ["envelope", "mail", "message", "contact", "invitation"],
    resourcePath:
      "/library/media/envelope/v1/df6fdfb9ed5a02e5aedabbfc03040034c3f085deafa6caeeeddeb78ae0054d8f.svg",
    bytes: 3008,
    categoryId: "graphic-element",
    useCaseIds: ["invitation", "proposal", "media-kit"],
  }),
  openMoji({
    id: "calendar",
    codepoint: "1F4C5",
    creator: "Sina Schulz",
    contentSha256:
      "ea09b06a917f3d813cf3a9aee3f5d3e922899a74930e52e64bddb51360b23160",
    name: "Calendar",
    description: "A schedule and date symbol for plans and event details.",
    tags: ["calendar", "date", "schedule", "event", "plan"],
    resourcePath:
      "/library/media/calendar/v1/ea09b06a917f3d813cf3a9aee3f5d3e922899a74930e52e64bddb51360b23160.svg",
    bytes: 2752,
    categoryId: "graphic-element",
    useCaseIds: ["brief", "report", "invitation"],
  }),
  openMoji({
    id: "chart-increasing",
    codepoint: "1F4C8",
    creator: "Sina Schulz",
    contentSha256:
      "e5dcc84cab48509aefd6c0ac830fff3189832cb9a2710bd5f0abfc362d5e4893",
    name: "Increasing chart",
    description: "A performance graphic for reports, goals and presentations.",
    tags: ["chart", "growth", "performance", "analytics", "report"],
    resourcePath:
      "/library/media/chart-increasing/v1/e5dcc84cab48509aefd6c0ac830fff3189832cb9a2710bd5f0abfc362d5e4893.svg",
    bytes: 3107,
    categoryId: "graphic-element",
    useCaseIds: ["report", "presentation", "brief"],
  }),
  openMoji({
    id: "round-pushpin",
    codepoint: "1F4CD",
    creator: "Sina Schulz",
    contentSha256:
      "a24f24e9b06e25591de0a42a37b4b0794c8d50f4c34ca6adaac7092ff6dfc5a2",
    name: "Round pushpin",
    description:
      "A location marker for venues, itineraries and contact details.",
    tags: ["location", "pin", "venue", "map", "place"],
    resourcePath:
      "/library/media/round-pushpin/v1/a24f24e9b06e25591de0a42a37b4b0794c8d50f4c34ca6adaac7092ff6dfc5a2.svg",
    bytes: 1384,
    categoryId: "graphic-element",
    useCaseIds: ["invitation", "brief", "proposal"],
  }),
  openMoji({
    id: "check-mark-button",
    codepoint: "2705",
    creator: "Hilda Kalyoncu",
    contentSha256:
      "35aeed71b9dcd2ad35a481468916ed10ae12192a64986d59843675bbbb8832ad",
    name: "Check mark",
    description: "A positive status marker for lists, plans and deliverables.",
    tags: ["check", "complete", "approved", "status", "task"],
    resourcePath:
      "/library/media/check-mark-button/v1/35aeed71b9dcd2ad35a481468916ed10ae12192a64986d59843675bbbb8832ad.svg",
    bytes: 1473,
    categoryId: "graphic-element",
    useCaseIds: ["brief", "report", "presentation"],
  }),
  openMoji({
    id: "speech-balloon",
    codepoint: "1F4AC",
    creator: "Laura Humpfer",
    contentSha256:
      "4c27a874ea4eb7d11ae09b2c082d2708c8c027e1f7e666b570eb17436fa9ac19",
    name: "Speech balloon",
    description:
      "A conversation symbol for quotes, feedback and social layouts.",
    tags: ["speech", "conversation", "quote", "message", "feedback"],
    resourcePath:
      "/library/media/speech-balloon/v1/4c27a874ea4eb7d11ae09b2c082d2708c8c027e1f7e666b570eb17436fa9ac19.svg",
    bytes: 1199,
    categoryId: "graphic-element",
    useCaseIds: ["social-post", "presentation", "report"],
  }),
  openMoji({
    id: "globe-americas",
    codepoint: "1F30E",
    creator: "Martin Wehl",
    contentSha256:
      "646738669bbba2382054c92428f9ef0850ad900a1ac912f7537012fef883786e",
    name: "Globe",
    description: "A global reach illustration for reports and brand stories.",
    tags: ["globe", "world", "global", "travel", "international"],
    resourcePath:
      "/library/media/globe-americas/v1/646738669bbba2382054c92428f9ef0850ad900a1ac912f7537012fef883786e.svg",
    bytes: 5346,
    categoryId: "illustration",
    useCaseIds: ["report", "presentation", "media-kit"],
  }),
  openMoji({
    id: "ring",
    codepoint: "1F48D",
    creator: "Jonas Roßner",
    contentSha256:
      "c79c0ee50b7377d82b7dd5684a719dda1ef560281b65a68cf15c9f01371c3978",
    name: "Ring",
    description: "A wedding and commitment illustration for event documents.",
    tags: ["ring", "wedding", "engagement", "commitment", "jewelry"],
    resourcePath:
      "/library/media/ring/v1/c79c0ee50b7377d82b7dd5684a719dda1ef560281b65a68cf15c9f01371c3978.svg",
    bytes: 1464,
    categoryId: "illustration",
    useCaseIds: ["wedding", "invitation", "proposal"],
  }),
  wikimediaCc0Photo({
    id: "dordogne-valley",
    contentSha256:
      "c3e2eef6af01a10882c83f71ff849d2ffb95220aad0e70e98daf6cf27e1975b7",
    name: "Dordogne valley",
    description:
      "A broad green valley and river framed by trees under a clear summer sky.",
    tags: ["valley", "river", "forest", "summer", "travel"],
    width: 4592,
    height: 3056,
    resourcePath:
      "/library/media/dordogne-valley/v1/c3e2eef6af01a10882c83f71ff849d2ffb95220aad0e70e98daf6cf27e1975b7.jpg",
    bytes: 2140794,
    categoryId: "photograph",
    useCaseIds: ["proposal", "report", "presentation", "travel"],
    creatorName: "Jebulon",
    filePageUrl:
      "https://commons.wikimedia.org/wiki/File:Landscape_Dordogne_Ch%C3%A2teau_de_Hautefort_18.jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/4/4d/Landscape_Dordogne_Ch%C3%A2teau_de_Hautefort_18.jpg",
    sourceContentSha1: "db675295401627b073c83e88983c1dd35abb463e",
  }),
  wikimediaCc0Photo({
    id: "marmolada-snow",
    contentSha256:
      "be834b795e32b38b3a33a890566ac7b3a8a8e4be03a29be52147b8f8aad6dfc2",
    name: "Marmolada snow",
    description:
      "Snow-covered Dolomite peaks beneath soft high clouds and a cool blue sky.",
    tags: ["mountain", "snow", "winter", "alps", "travel"],
    width: 3904,
    height: 2604,
    resourcePath:
      "/library/media/marmolada-snow/v1/be834b795e32b38b3a33a890566ac7b3a8a8e4be03a29be52147b8f8aad6dfc2.jpg",
    bytes: 3396302,
    categoryId: "photograph",
    useCaseIds: ["proposal", "report", "presentation", "travel"],
    creatorName: "Marco Bonomo",
    filePageUrl: "https://commons.wikimedia.org/wiki/File:Marmolada,_Italy.jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/6/63/Marmolada%2C_Italy.jpg",
    sourceContentSha1: "d557c8ec714758c85a11a65500841762da3af891",
  }),
  wikimediaCc0Photo({
    id: "oahu-rainforest-panorama",
    contentSha256:
      "694975dc6d5ac637c1406830beaecd55b8050fb54994ade44ad027f6220fc539",
    name: "Oahu rainforest panorama",
    description:
      "A cinematic panoramic view across Oahu's dense green valleys and ridges.",
    tags: ["panorama", "rainforest", "island", "green", "travel"],
    width: 2400,
    height: 936,
    resourcePath:
      "/library/media/oahu-rainforest-panorama/v1/694975dc6d5ac637c1406830beaecd55b8050fb54994ade44ad027f6220fc539.jpg",
    bytes: 2918961,
    categoryId: "photograph",
    useCaseIds: ["media-kit", "presentation", "carousel", "travel"],
    creatorName: "Bernard Spragg. NZ",
    filePageUrl: "https://commons.wikimedia.org/wiki/File:Oahu_Landscape.jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/9/91/Oahu_Landscape.jpg",
    sourceContentSha1: "77086f2e828e69830327176cc02198c74895f116",
  }),
  wikimediaCc0Photo({
    id: "silver-water-waves",
    contentSha256:
      "cacb73e4f49cdc336ae89d5961d4ce790ef8a1d37d4bf0a936bfa9d505c125f1",
    name: "Silver water waves",
    description:
      "Layered grey water and small waves for understated full-bleed backgrounds.",
    tags: ["water", "waves", "silver", "grey", "calm"],
    width: 2560,
    height: 1920,
    resourcePath:
      "/library/media/silver-water-waves/v1/cacb73e4f49cdc336ae89d5961d4ce790ef8a1d37d4bf0a936bfa9d505c125f1.jpg",
    bytes: 2999808,
    categoryId: "texture",
    useCaseIds: ["background", "report", "presentation", "social-post"],
    creatorName: "MartinThoma",
    filePageUrl: "https://commons.wikimedia.org/wiki/File:Water-2.jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/c/c3/Water-2.jpg",
    sourceContentSha1: "e6a0e29e96705634c8d21a89422b6f0ea663829c",
  }),
  wikimediaCc0Photo({
    id: "metal-water-drops",
    contentSha256:
      "b766464038cc04ef456b261b16d1d57cff0756c8bf87176e8463fe57fe028faf",
    name: "Metal water drops",
    description:
      "Softly lit droplets on brushed metal for restrained technology layouts.",
    tags: ["metal", "water", "drops", "silver", "technology"],
    width: 1600,
    height: 1200,
    resourcePath:
      "/library/media/metal-water-drops/v1/b766464038cc04ef456b261b16d1d57cff0756c8bf87176e8463fe57fe028faf.jpg",
    bytes: 455412,
    categoryId: "texture",
    useCaseIds: ["background", "brief", "presentation", "media-kit"],
    creatorName: "Jan Helebrant",
    filePageUrl:
      "https://commons.wikimedia.org/wiki/File:Technology_metal_texture_with_drops_05_(51327873722).jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/0/0e/Technology_metal_texture_with_drops_05_%2851327873722%29.jpg",
    sourceContentSha1: "36d3a495cb524c14cc713385f91b41c4fabfc553",
  }),
  wikimediaCc0Photo({
    id: "sunlit-yellow-textile",
    contentSha256:
      "9712103c80a55ddf61353f01f2ded20e7de182737c00b40fd7f7d55a0f2e5eac",
    name: "Sunlit yellow textile",
    description:
      "A warm macro textile pattern for energetic stories and social layouts.",
    tags: ["textile", "yellow", "pattern", "warm", "macro"],
    width: 2394,
    height: 3195,
    resourcePath:
      "/library/media/sunlit-yellow-textile/v1/9712103c80a55ddf61353f01f2ded20e7de182737c00b40fd7f7d55a0f2e5eac.jpg",
    bytes: 1773524,
    categoryId: "texture",
    useCaseIds: ["background", "story", "social-post", "invitation"],
    creatorName: "Kippelboy",
    filePageUrl:
      "https://commons.wikimedia.org/wiki/File:Texture_yellow_2015.jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/7/7a/Texture_yellow_2015.jpg",
    sourceContentSha1: "6d4adb53bb321f4e062c89fc72d1d49fa63e01b7",
  }),
  wikimediaCc0Photo({
    id: "spring-daffodil-field",
    contentSha256:
      "4a077103f60fe2efc9434c3bc8cc496138a958e6dd2f7fd5dcfbb916d6f8b3f0",
    name: "Spring daffodil field",
    description:
      "A broad bed of white daffodils in a green spring garden with open copy space.",
    tags: ["flowers", "daffodil", "spring", "garden", "green"],
    width: 2000,
    height: 1329,
    resourcePath:
      "/library/media/spring-daffodil-field/v1/4a077103f60fe2efc9434c3bc8cc496138a958e6dd2f7fd5dcfbb916d6f8b3f0.jpg",
    bytes: 3465702,
    categoryId: "photograph",
    useCaseIds: ["invitation", "wedding", "story", "social-post"],
    creatorName: "Bruce Emmerling",
    filePageUrl:
      "https://commons.wikimedia.org/wiki/File:Flowers_in_Full_Bloom.jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/a/ad/Flowers_in_Full_Bloom.jpg",
    sourceContentSha1: "b2f484289eeca65f53258a81685d89d5feaa1b32",
  }),
]

export function parseStudioMediaManifest(value: unknown) {
  const items = z.array(studioMediaManifestItemSchema).min(1).parse(value)
  const identities = items.map((item) => `${item.id}@${item.version}`)
  const paths = items.map((item) => item.resourcePath)
  if (!unique(identities)) {
    throw new Error("Studio media manifest contains duplicate identities")
  }
  if (!unique(paths)) {
    throw new Error("Studio media manifest contains duplicate resource paths")
  }
  return items
}

const freezeManifestItem = (
  item: StudioMediaManifestItem
): Readonly<StudioMediaManifestItem> => {
  Object.freeze(item.tags)
  Object.freeze(item.useCaseIds)
  Object.freeze(item.provenance.license)
  Object.freeze(item.provenance.attribution)
  Object.freeze(item.provenance)
  if (item.sourceEvidence) {
    Object.freeze(item.sourceEvidence)
  }
  return Object.freeze(item)
}

export const studioMediaManifest = Object.freeze(
  parseStudioMediaManifest(manifestDefinitions).map(freezeManifestItem)
)
