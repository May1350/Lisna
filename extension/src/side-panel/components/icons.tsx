// Shared outline-SVG icon set. Replaces emoji glyphs that the OS
// rendered in uncontrolled colors (📝 yellow paper, ⬇ purple arrow,
// 🌐 multi-blue globe, ✨ blue/yellow sparkle) with stroke-only SVGs
// that follow the surrounding text color and stay visually
// consistent with the existing GearIcon / SidePanelIcon /
// ObsidianMark glyphs across the side panel.
//
// Stroke language: 1.7 px, rounded caps + joins, currentColor stroke.
// Default size 14 — callers override via the `size` prop where
// alignment with neighbouring text demands it.

interface IconProps { size?: number; className?: string }

const STROKE_PROPS = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

// Document with a corner fold + horizontal text lines. Replaces 📝
// in: curate buttons (note generate / regenerate), filename label,
// session-history outline-meta badge.
export function NoteIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      {...STROKE_PROPS}
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 }}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  )
}

// Down-arrow into tray. Replaces ⬇ on the .zip export button.
export function DownloadIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      {...STROKE_PROPS}
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 }}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

// Globe with two horizon lines + meridian. Replaces 🌐 on the .html
// export button. Used sparingly — most callers can skip the icon and
// rely on the ".html" label alone.
export function GlobeIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      {...STROKE_PROPS}
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}

// Small camera-frame outline. Replaces 📷 on session-history slide
// counts. In most cases callers just drop the icon entirely and use
// "{n}枚" or "{n} slides" — this stays available for the rare row
// where the icon helps the row scan faster.
export function PhotoIcon({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      {...STROKE_PROPS}
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-1px', flexShrink: 0 }}
    >
      <path d="M3 7h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

// Left-pointing chevron. Used as the back button in NotesViewer.
export function BackIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      {...STROKE_PROPS}
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 }}
    >
      <polyline points="15 6 9 12 15 18" />
    </svg>
  )
}

// Square + outgoing arrow. Used on session-history rows to open the
// source video URL in a new tab (the row's primary action is now
// "view notes" — this icon keeps source-video access one click away).
export function ExternalLinkIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      {...STROKE_PROPS}
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 }}
    >
      <path d="M14 4h6v6" />
      <line x1="20" y1="4" x2="11" y2="13" />
      <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    </svg>
  )
}

// Four-point sparkle. Replaces ✨ on inline-button onboarding and
// related "starred / featured" surfaces. Smaller default (12) since
// it's almost always inline with body text.
export function SparkleIcon({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      {...STROKE_PROPS}
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-1px', flexShrink: 0 }}
    >
      <path d="M12 3l1.6 4.8L18 9l-4.4 1.2L12 15l-1.6-4.8L6 9l4.4-1.2z" />
      <path d="M19 15l0.7 2L21 17.7L19.7 18.4L19 20l-0.7-1.6L17 17.7L18.3 17z" />
    </svg>
  )
}
