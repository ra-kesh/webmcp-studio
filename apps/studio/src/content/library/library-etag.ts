export const matchesCanonicalEtag = (
  received: string | null,
  canonical: string
) => received === canonical || received === `W/${canonical}`
