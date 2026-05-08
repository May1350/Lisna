// Obsidian brand mark — stylised purple gem with 6 distinct facets
// matching the asymmetric kite-shape silhouette of the official
// Obsidian logo. Bright top highlight + graduated mid-tones + dark
// bottom shadow give the gem a visible depth that the previous
// 4-facet version lacked.
//
// Inline SVG so the mark renders identically across platforms,
// stays crisp at any size, and isn't subject to system emoji style
// drift (the original 🔮 emoji shipped looked completely different
// on macOS vs Windows). Kept as a shared component so the modal's
// ExportMenu and the Options page can use the same source of truth.
//
// The colour palette is calibrated to Obsidian's brand purple
// (#483699) with a 6-step gradient between #2A1F60 (deepest shadow)
// and #A78BFA (brightest highlight).
export function ObsidianMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 }}
    >
      {/* Bright highlight — the diamond shape on top, the most
          distinctive cue of the Obsidian mark */}
      <path d="M50 4 L86 28 L62 48 L36 30 Z" fill="#A78BFA" />
      {/* Upper-left mid-tone face */}
      <path d="M50 4 L36 30 L8 40 Z" fill="#7C5BC8" />
      {/* Left flank, slightly darker */}
      <path d="M36 30 L8 40 L14 60 L26 92 Z" fill="#5C49B8" />
      {/* Inner centre facet */}
      <path d="M36 30 L62 48 L52 80 L14 60 Z" fill="#6F58D9" />
      {/* Right flank — dark, gives the asymmetric depth */}
      <path d="M62 48 L86 28 L92 56 L70 92 L52 80 Z" fill="#3A2780" />
      {/* Bottom shadow seam */}
      <path d="M52 80 L70 92 L26 92 L14 60 Z" fill="#2A1F60" />
    </svg>
  )
}
