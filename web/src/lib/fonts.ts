import { Fraunces, Inter, Noto_Serif_JP, Caveat } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
});

export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const caveat = Caveat({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
});

export const notoSerifJP = Noto_Serif_JP({
  weight: ['400'],
  subsets: ['latin'],
  variable: '--font-noto-serif-jp',
  display: 'swap',
  preload: false,  // only load when locale === 'ja' (done at [locale]/layout in Task 17)
});
