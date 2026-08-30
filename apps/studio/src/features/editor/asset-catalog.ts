import { validateAssetFieldPublicationIdentities } from "@webmcp/document"
import type { Document, ValidationIssue } from "@webmcp/document"

export type StudioAsset = {
  id: string
  version: number
  contentSha256: string
  name: string
  description: string
  tags: string[]
  width: number
  height: number
  src: string
  license: string
}

const svgDataUri = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

const asset = (
  definition: Omit<StudioAsset, "src" | "license">,
  artwork: string
): StudioAsset => ({
  ...definition,
  src: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${definition.width}" height="${definition.height}" viewBox="0 0 ${definition.width} ${definition.height}">${artwork}</svg>`
  ),
  license: "Original Studio artwork",
})

export const studioAssets: StudioAsset[] = [
  asset(
    {
      id: "olive-botanical",
      version: 1,
      contentSha256:
        "85cc8f05bda0255e74a2057f4d27c948eafaa4156bee4bab83f4e725bb056f24",
      name: "Olive botanical",
      description: "Soft botanical composition on warm ivory",
      tags: ["botanical", "olive", "wedding", "editorial", "ivory"],
      width: 1200,
      height: 1500,
    },
    `<rect width="1200" height="1500" fill="#F3EFE5"/><path d="M154 1304C313 1025 426 783 490 514C542 296 665 167 862 88" fill="none" stroke="#24352A" stroke-width="16" stroke-linecap="round"/><g fill="#66745C"><ellipse cx="280" cy="1050" rx="72" ry="142" transform="rotate(-42 280 1050)"/><ellipse cx="420" cy="783" rx="67" ry="133" transform="rotate(-32 420 783)"/><ellipse cx="538" cy="496" rx="64" ry="126" transform="rotate(-17 538 496)"/><ellipse cx="695" cy="247" rx="61" ry="120" transform="rotate(31 695 247)"/></g><g fill="#9B7656"><circle cx="337" cy="951" r="32"/><circle cx="475" cy="677" r="28"/><circle cx="607" cy="393" r="26"/><circle cx="778" cy="169" r="24"/></g><path d="M1147 1090C993 1018 866 1028 755 1121C681 1182 614 1219 532 1226" fill="none" stroke="#9B7656" stroke-width="9"/><circle cx="1010" cy="1054" r="104" fill="#D8C3A7" opacity=".7"/>`
  ),
  asset(
    {
      id: "sandstone-arches",
      version: 1,
      contentSha256:
        "9d439ee5bbcef006feb158ec818d9f3c69cf4206e8d2d166c29deb9c7c439571",
      name: "Sandstone arches",
      description: "Architectural arches with restrained earth tones",
      tags: ["architecture", "arches", "sandstone", "travel", "minimal"],
      width: 1600,
      height: 1200,
    },
    `<rect width="1600" height="1200" fill="#E9DED0"/><rect y="770" width="1600" height="430" fill="#C9A57D"/><path d="M90 1200V388C90 205 238 58 420 58s330 147 330 330v812H90Z" fill="#B9825D"/><path d="M260 1200V436c0-89 72-161 160-161s160 72 160 161v764H260Z" fill="#EFE7DC"/><path d="M810 1200V525c0-244 198-442 442-442s442 198 442 442v675H810Z" fill="#735A49"/><path d="M1053 1200V574c0-110 89-199 199-199s199 89 199 199v626h-398Z" fill="#D7C0A2"/><circle cx="1410" cy="170" r="80" fill="#F5E9CE"/>`
  ),
  asset(
    {
      id: "linen-paper",
      version: 1,
      contentSha256:
        "af55dfd6f6ed63652ebf6107bb66ec21de4aa0e00b5b52001ac9c017454a594c",
      name: "Linen paper",
      description: "Subtle woven paper texture for quiet backgrounds",
      tags: ["paper", "linen", "texture", "neutral", "background"],
      width: 1400,
      height: 1400,
    },
    `<defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#F2EEE5"/><path d="M0 5H24M0 17H24" stroke="#D7D0C3" stroke-width="1" opacity=".58"/><path d="M7 0V24M19 0V24" stroke="#E2DBCF" stroke-width="1" opacity=".62"/></pattern><radialGradient id="g"><stop stop-color="#FFFFFF" stop-opacity=".38"/><stop offset="1" stop-color="#B9A991" stop-opacity=".18"/></radialGradient></defs><rect width="1400" height="1400" fill="url(#p)"/><rect width="1400" height="1400" fill="url(#g)"/>`
  ),
  asset(
    {
      id: "dusk-blocks",
      version: 1,
      contentSha256:
        "f06daf3c63c4bc03ec13680269d20c068d51f21f8ee838720cb19197cc0c803d",
      name: "Dusk blocks",
      description: "Deep plum and clay geometric editorial study",
      tags: ["abstract", "plum", "clay", "geometric", "modern"],
      width: 1600,
      height: 1000,
    },
    `<rect width="1600" height="1000" fill="#2B252D"/><rect x="80" y="88" width="610" height="824" rx="12" fill="#704957"/><rect x="738" y="88" width="782" height="376" rx="12" fill="#C47F62"/><rect x="738" y="512" width="376" height="400" rx="12" fill="#E0C7A4"/><rect x="1162" y="512" width="358" height="400" rx="12" fill="#4A5B50"/><circle cx="384" cy="500" r="224" fill="#D0A47E"/><circle cx="384" cy="500" r="122" fill="#2B252D"/>`
  ),
  asset(
    {
      id: "floral-linework",
      version: 1,
      contentSha256:
        "c172e192873d1d354685e49c9fb4bef9bf3c4668026255bf76b053ea8d90988a",
      name: "Floral linework",
      description: "Fine ink flowers on a muted blush field",
      tags: ["floral", "linework", "blush", "invitation", "delicate"],
      width: 1200,
      height: 1500,
    },
    `<rect width="1200" height="1500" fill="#DABBB0"/><g fill="none" stroke="#342D2A" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M563 1460C557 1110 527 806 434 490C399 371 352 253 260 120M533 1110C708 930 800 725 819 474M450 668C307 642 205 566 134 448"/><path d="M403 390c-108-39-176 78-113 165 84 116 230 15 178-101-32-72-107-111-173-112M793 395c-87-67-187 21-148 120 51 132 217 77 200-48-10-78-66-133-128-145M162 377c-75-48-151 26-114 102 49 99 175 52 164-43-7-59-48-101-98-112"/><path d="M537 1002c84-15 139-66 169-147M498 877c-84-6-145-49-185-119"/></g>`
  ),
  asset(
    {
      id: "warm-grain",
      version: 1,
      contentSha256:
        "b85dca42ce5c01c6b5d419c127afd5420b313b0e91785eb12ee2bc9984ed3db4",
      name: "Warm grain",
      description: "Soft terracotta gradient with an organic grain",
      tags: ["gradient", "terracotta", "warm", "grain", "background"],
      width: 1600,
      height: 1200,
    },
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#E7C1A4"/><stop offset=".48" stop-color="#B87961"/><stop offset="1" stop-color="#5B4642"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".65" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .16 0"/></filter></defs><rect width="1600" height="1200" fill="url(#g)"/><rect width="1600" height="1200" filter="url(#n)" opacity=".34"/><circle cx="1270" cy="280" r="260" fill="#EAD5B5" opacity=".28"/>`
  ),
]

export const studioAssetIdForValue = (value: unknown) =>
  typeof value === "string"
    ? studioAssets.find(
        (candidate) => candidate.id === value || candidate.src === value
      )?.id
    : undefined

export function studioAssetFieldPublicationIssues(
  document: Document
): ValidationIssue[] {
  return validateAssetFieldPublicationIdentities(document, (value) =>
    Boolean(studioAssetIdForValue(value))
  ).map((issue) => ({
    ...issue,
    message: issue.message.replace("approved asset", "approved Studio asset"),
  }))
}
