import type { Config } from 'tailwindcss'

// Lisna Design System tokens — see docs/DESIGN.md for the full spec
// (philosophy, when-to-use rules, color reservation policy).
//
// Tokens are exposed as Tailwind theme keys so the rest of the codebase
// can use idiomatic utilities (bg-paper-100, text-ink-900,
// border-paper-edge, etc.) without dropping into raw CSS variables.
// The actual color values also live as CSS variables on :root in
// side-panel/index.css so they're readable from raw style attributes
// and from injected content (mockups, generated HTML, etc.).

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        paper: {
          100: '#FFFEFB',
          200: '#FBFAF7',
          300: '#F4F2EC',
          edge: '#E8E4DC',
        },
        ink: {
          900: '#1A1614',
          700: '#3D3733',
          500: '#6E6660',
          300: '#A39A93',
          200: '#C8C0B7',
        },
        terra: {
          DEFAULT: '#C2410C',
          700: '#9A330A',
          soft: '#FED7AA',
          tint: '#FFF7ED',
        },
        warn: {
          red: '#B91C1C',
          amber: '#B45309',
        },
        ok: {
          green: '#4F7C5C',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Hiragino Sans',
          'Apple SD Gothic Neo',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      borderRadius: {
        // Aliases that match the design tokens in DESIGN.md §2.3.
        // Tailwind already ships rounded-md (6px) etc., these explicit
        // aliases prevent confusion at review time.
        'sm-design': '6px',
        'md-design': '10px',
        'lg-design': '14px',
      },
      boxShadow: {
        'card': '0 1px 0 rgba(26, 22, 20, 0.02), 0 8px 24px -12px rgba(26, 22, 20, 0.08)',
        'modal': '0 1px 0 rgba(26, 22, 20, 0.04), 0 16px 32px -16px rgba(26, 22, 20, 0.12)',
      },
      letterSpacing: {
        'headline-tight': '-0.015em',
        'eyebrow': '0.16em',
      },
    },
  },
  plugins: [],
} satisfies Config
