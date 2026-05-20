import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50:  '#fefbf5',
          100: '#faf6ef',
          200: '#f8f3e9',
          300: '#ebe2cf',
        },
        ink: {
          700: '#3a3025',
          900: '#1a1410',
        },
        margin: {
          red: '#b85050',
        },
        accent: {
          tan:  '#8a6a3a',
          sage: '#5fa872',
        },
      },
      fontFamily: {
        serif:      ['var(--font-fraunces)', 'Iowan Old Style', 'Georgia', 'serif'],
        'serif-jp': ['var(--font-noto-serif-jp)', 'Yu Mincho', 'Hiragino Mincho ProN', 'serif'],
        sans:       ['var(--font-inter)', '-apple-system', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-1':       ['3.5rem',    { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '400' }],
        'display-2':       ['2.75rem',   { lineHeight: '1',    letterSpacing: '-0.03em',  fontWeight: '400' }],
        h1:                ['2.5rem',    { lineHeight: '1.1',  letterSpacing: '-0.02em',  fontWeight: '400' }],
        h2:                ['2.375rem',  { lineHeight: '1.1',  letterSpacing: '-0.02em',  fontWeight: '400' }],
        'h2-sm':           ['2rem',      { lineHeight: '1.15', letterSpacing: '-0.018em', fontWeight: '400' }],
        feature:           ['2rem',      { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '400' }],
        'feature-primary': ['2.125rem',  { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '400' }],
        plan:              ['1.25rem',   { lineHeight: '1.3',                             fontWeight: '400' }],
        'grid-title':      ['1.125rem',  { lineHeight: '1.3',                             fontWeight: '400' }],
        q:                 ['1.0625rem', { lineHeight: '1.4',                             fontWeight: '400' }],
        sub:               ['1.03125rem',{ lineHeight: '1.55',                            fontWeight: '400' }],
        body:              ['0.9375rem', { lineHeight: '1.65',                            fontWeight: '400' }],
        'body-sm':         ['0.78125rem',{ lineHeight: '1.65',                            fontWeight: '400' }],
        meta:              ['0.75rem',   { lineHeight: '1.5',  letterSpacing: '0.1em',    fontWeight: '700' }],
        hint:              ['0.6875rem', { lineHeight: '1.5',                             fontWeight: '400' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
};

export default config;
