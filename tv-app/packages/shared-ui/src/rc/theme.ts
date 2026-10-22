import { Easing } from 'react-native';
import type { Lang } from '@roomcaption/shared';

/**
 * The "Evening" visual system for the TV (docs/design/DESIGN.md sections 2-5).
 * Warm near-black, cream text, one marigold accent. Sizes are design pixels at 1920x1080:
 * pass them through scaledPixels (sp) at the point of use.
 */
export const color = {
  bgBase: '#16110F',
  bgGlow: '#2A1D16',
  surface1: '#211A17',
  surface2: '#2D2420',
  surface3: '#3A2F2A',
  line: '#45382F',
  lineStrong: '#6A5A4E',
  textStrong: '#FFF7EE',
  text: '#F3E9DF',
  textMuted: '#CDBFB3',
  textFaint: '#A8998D',
  accent: '#FFB547',
  accentInk: '#2A1A05',
  focusFill: '#FFF1DC',
  focusInk: '#1C1410',
  focusRing: '#FFF7EE',
  /** Muted text on the cream focus fill (hint lines of a focused button). */
  focusMuted: '#5C4A3E',
  ok: '#8EE39A',
  warn: '#FFCF6B',
  bad: '#FF9A8A',
  scrim: 'rgba(12,8,6,0.72)',
  /** Video and photo wells stay true black. */
  well: '#000000',
  /** Instant-photo card frame. */
  cream: '#FFF4E6',
  /** QR card. */
  qrCard: '#FFF7EE',
  coral: '#FF8B7B',
} as const;

/** People colours, same order as SPEAKER_COLORS in shared/src/protocol.ts. */
export const PEOPLE_COLORS = ['#7CC4FF', '#FF8B7B', '#93DB8C', '#C6A8FF', '#FF94C2', '#63D6C6'] as const;

/** Background gradient: lamp light from the top-left, settling to the base by 60%. */
export const backgroundGradient = {
  colors: [color.bgGlow, color.bgBase, color.bgBase] as const,
  locations: [0, 0.6, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

// ---------- Fonts ----------

/**
 * Family names registered in apps/expo-multi-tv/App.tsx (one family per weight file: on React
 * Native Android fontWeight with custom fonts is unreliable, so never set fontWeight with these).
 */
export const FONTS = {
  display: 'Baloo2-ExtraBold',
  displayBold: 'Baloo2-Bold',
  regular: 'NotoSans-Regular',
  semibold: 'NotoSans-SemiBold',
  bold: 'NotoSans-Bold',
  devaRegular: 'NotoSansDevanagari-Regular',
  devaSemibold: 'NotoSansDevanagari-SemiBold',
  devaBold: 'NotoSansDevanagari-Bold',
  tamlRegular: 'NotoSansTamil-Regular',
  tamlSemibold: 'NotoSansTamil-SemiBold',
  tamlBold: 'NotoSansTamil-Bold',
} as const;

export type Weight = 'regular' | 'semibold' | 'bold';
type Script = 'latn' | 'deva' | 'taml';

const SCRIPT_OF_LANG: Record<string, Script> = { 'en-IN': 'latn', 'hi-IN': 'deva', 'ta-IN': 'taml' };

const FAMILY: Record<Script, Record<Weight, string>> = {
  latn: { regular: FONTS.regular, semibold: FONTS.semibold, bold: FONTS.bold },
  deva: { regular: FONTS.devaRegular, semibold: FONTS.devaSemibold, bold: FONTS.devaBold },
  taml: { regular: FONTS.tamlRegular, semibold: FONTS.tamlSemibold, bold: FONTS.tamlBold },
};

const scriptFor = (lang: Lang | string | null | undefined): Script => (lang ? SCRIPT_OF_LANG[lang] ?? 'latn' : 'latn');

/**
 * The text family for a line, picked by the line's language (not by fallback). Every Noto file
 * here also contains Latin, so mixed lines still render.
 */
export function fontFor(lang: Lang | string | null | undefined, weight: Weight = 'regular'): string {
  return FAMILY[scriptFor(lang)][weight];
}

/** Display family (Baloo 2 covers Latin and Devanagari; Tamil falls back to Noto Sans Tamil Bold). */
export function displayFontFor(lang: Lang | string | null | undefined = 'en-IN', weight: 'bold' | 'extrabold' = 'extrabold'): string {
  if (scriptFor(lang) === 'taml') return FONTS.tamlBold;
  return weight === 'bold' ? FONTS.displayBold : FONTS.display;
}

/** The language a piece of text is written in, guessed from its script (for names, headlines, object names). */
export function langOfText(text: string | null | undefined, fallback: Lang = 'en-IN'): Lang {
  if (!text) return fallback;
  if (/[஀-௿]/.test(text)) return 'ta-IN';
  if (/[ऀ-ॿ꣠-ꣿ]/.test(text)) return 'hi-IN';
  return fallback;
}

/** True for scripts that must never get letterSpacing or uppercase (spacing breaks conjuncts). */
export const isIndic = (lang: Lang | string | null | undefined) => scriptFor(lang) !== 'latn';

/** Line-height ratio: 1.25 for Latin, 1.45 for Devanagari and Tamil (taller vowel signs). */
export const lineRatio = (lang: Lang | string | null | undefined) => (isIndic(lang) ? 1.45 : 1.25);

/** A language's own name, in its own script. */
export const LANG_NATIVE: Record<string, string> = { 'en-IN': 'English', 'hi-IN': 'हिन्दी', 'ta-IN': 'தமிழ்' };

/** TV type scale, design px (size / line height). */
export const scale = {
  displayXl: { size: 120, line: 128 },
  displayL: { size: 88, line: 96 },
  displayM: { size: 64, line: 72 },
  title: { size: 48, line: 58 },
  heading: { size: 36, line: 44 },
  bodyL: { size: 34, line: 46 },
  body: { size: 30, line: 42 },
  label: { size: 24, line: 28 },
  meta: { size: 24, line: 32 },
} as const;

// ---------- Space, radii, elevation ----------

export const space = { xxs: 4, xs: 8, s: 16, m: 24, l: 32, xl: 48, xxl: 64, xxxl: 96 } as const;
export const radius = { keycap: 8, chip: 12, button: 20, panel: 28, hero: 40, pill: 999 } as const;

/** Shadows (design px for offsets/blur are applied by the caller through sp where it matters). */
export const elevation = {
  e2: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  e3: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 40, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
  e4: { shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 64, shadowOffset: { width: 0, height: 24 }, elevation: 24 },
} as const;

// ---------- Motion ----------

export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
  hero: 600,
  enter: Easing.bezier(0.2, 0, 0, 1),
  exit: Easing.bezier(0.3, 0, 1, 1),
  spring: { friction: 7, tension: 70 },
  /** Every motion becomes this crossfade when the system asks for reduced motion. */
  reduced: 200,
} as const;
