import { Platform } from 'react-native';
import { color } from './theme';

/**
 * Where the Roomcaption server lives, as seen from the TV.
 *
 * Set EXPO_PUBLIC_RC_SERVER_URL at build time, e.g. http://192.168.1.5:8788 (the server's plain
 * HTTP port for the TV: a TV does not trust a self-signed certificate; phones use the HTTPS port).
 * Fallbacks are for development only: the web build talks to port 8788 on the page's host, and
 * the Android emulator reaches the development PC at 10.0.2.2.
 */
export function serverUrl(): string {
  const env = process.env.EXPO_PUBLIC_RC_SERVER_URL;
  if (env) return env.replace(/\/+$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `http://${window.location.hostname}:8788`;
  return 'http://10.0.2.2:8788';
}

/**
 * Screen colours, from the "Evening" tokens in theme.ts (docs/design/DESIGN.md section 2). The keys
 * are kept so every screen picks up the theme without other edits.
 */
export const palette = {
  bg: color.bgBase,
  panel: color.surface1,
  panelHi: color.surface3,
  line: color.line,
  text: color.textStrong,
  muted: color.textMuted,
  accent: color.accent,
  ok: color.ok,
  warn: color.warn,
  bad: color.bad,
  focus: color.focusRing,
};

export type CaptionTheme = 'dark' | 'yellow' | 'light';

/** Caption colours per theme. Speaker colours are tuned for dark backgrounds; the light theme shows names on coloured chips instead. */
export const captionThemes: Record<CaptionTheme, { bg: string; text: string; partial: string; label: string }> = {
  dark: { bg: '#16110F', text: '#FFF7EE', partial: '#A8998D', label: 'Cream on dark' },
  yellow: { bg: '#000000', text: '#FFE14D', partial: '#B3A040', label: 'Yellow on black' },
  light: { bg: '#FBF6EF', text: '#1F1712', partial: '#6B5D52', label: 'Dark on light' },
};

/** Caption text sizes (design pixels at 1920x1080) and how many lines fit. */
export const textSizes = [
  { name: 'Medium', font: 52, lines: 6 },
  { name: 'Large', font: 66, lines: 5 },
  { name: 'Extra large', font: 84, lines: 4 },
  { name: 'Huge', font: 104, lines: 3 },
];
