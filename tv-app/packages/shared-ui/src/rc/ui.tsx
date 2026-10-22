import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { DefaultFocus, SpatialNavigationFocusableView, SpatialNavigationNode, SpatialNavigationRoot } from 'react-tv-space-navigation';
import { useIsFocused } from '@react-navigation/native';
import qrcode from 'qrcode-generator';
import { scaledPixels as sp } from '../hooks/useScale';
import { safeZones } from '../theme';
import { palette } from './config';
import { useRoom } from './RoomContext';
import { color, FONTS } from './theme';

/** Text sizes for a 3 m viewing distance (design reference: 1920x1080). */
export const type = StyleSheet.create({
  hero: { fontSize: sp(84), fontFamily: FONTS.bold, color: palette.text },
  h1: { fontSize: sp(56), fontFamily: FONTS.bold, color: palette.text },
  h2: { fontSize: sp(40), fontFamily: FONTS.bold, color: palette.text },
  body: { fontSize: sp(32), color: palette.text, lineHeight: sp(44) },
  small: { fontSize: sp(26), color: palette.muted, lineHeight: sp(36) },
  label: { fontSize: sp(24), fontFamily: FONTS.bold, color: palette.muted, letterSpacing: sp(2), textTransform: 'uppercase' },
});

/** Full-screen page with TV safe-zone padding and its own remote-navigation root. */
export function Screen({ children, padded = true, bg = palette.bg }: { children: React.ReactNode; padded?: boolean; bg?: string }) {
  const focused = useIsFocused();
  const { helpOpen: help, alertOpen, recoverOpen } = useRoom();
  const helpOpen = help || alertOpen || recoverOpen;
  return (
    <SpatialNavigationRoot isActive={focused && !helpOpen}>
      <View style={[styles.screen, { backgroundColor: bg }]}>
        <View style={[{ flex: 1 }, padded && styles.padded]}>{children}</View>
      </View>
    </SpatialNavigationRoot>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SpatialNavigationNode orientation="horizontal">
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: sp(24), flexWrap: 'wrap' }, style]}>{children}</View>
    </SpatialNavigationNode>
  );
}

export function Col({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SpatialNavigationNode orientation="vertical">
      <View style={[{ gap: sp(20) }, style]}>{children}</View>
    </SpatialNavigationNode>
  );
}

interface BtnProps {
  label: string;
  onSelect: () => void;
  hint?: string;
  selected?: boolean;
  small?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  lines?: number;
}

/** The one focusable control used across the app, so the focus indicator is always the same: white fill, dark text, scale. Never colour alone. */
export function Btn({ label, onSelect, hint, selected, small, disabled, autoFocus, style, textStyle, lines = 1 }: BtnProps) {
  const select = () => {
    if (!disabled) onSelect();
  };
  const node = (
    <SpatialNavigationFocusableView onSelect={select}>
      {({ isFocused }) => (
        // The ring sits 4 px outside the control with a gap, so focus never depends on colour alone.
        <View style={[styles.ring, isFocused && styles.ringOn, isFocused && styles.lift]}>
        <View
          accessible
          // On web the focusable wrapper already renders a <button>; a second role would nest buttons.
          accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
          accessibilityLabel={label}
          accessibilityState={{ selected: !!selected, disabled: !!disabled }}
          style={[styles.btn, small && styles.btnSmall, selected && styles.btnSelected, disabled && styles.btnDisabled, isFocused && styles.btnFocused, style]}
        >
          <Text style={[styles.btnText, small && styles.btnTextSmall, isFocused && styles.btnTextFocused, textStyle]} numberOfLines={lines}>
            {selected ? '✓ ' : ''}
            {label}
          </Text>
          {hint ? <Text style={[styles.btnHint, isFocused && styles.btnHintFocused]}>{hint}</Text> : null}
        </View>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
  return autoFocus ? <DefaultFocus>{node}</DefaultFocus> : node;
}

export function Pill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? palette.ok : tone === 'warn' ? palette.warn : palette.bad;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

/** Text that appears briefly. */
export function useToast(ms = 4000): [string | null, (t: string) => void] {
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast, ms]);
  const show = useMemo(() => (text: string) => setToast((p) => ({ text, n: (p?.n ?? 0) + 1 })), []);
  return [toast?.text ?? null, show];
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.toastWrap} pointerEvents="none">
      <View style={styles.toast}>
        <Text style={styles.toastText}>{text}</Text>
      </View>
    </View>
  );
}

/** QR code drawn with plain views (no native module), merged into horizontal runs per row. */
export function QRCode({ value, size }: { value: string; size: number }) {
  const rows = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const out: { dark: boolean; len: number }[][] = [];
    for (let r = 0; r < n; r++) {
      const runs: { dark: boolean; len: number }[] = [];
      for (let c = 0; c < n; c++) {
        const dark = qr.isDark(r, c);
        const last = runs[runs.length - 1];
        if (last && last.dark === dark) last.len++;
        else runs.push({ dark, len: 1 });
      }
      out.push(runs);
    }
    return { out, n };
  }, [value]);
  const quiet = 4;
  const cell = Math.floor(size / (rows.n + quiet * 2));
  const pad = (size - cell * rows.n) / 2;
  return (
    <View style={{ width: size, height: size, backgroundColor: '#FFFFFF', padding: pad, borderRadius: sp(12) }} accessibilityLabel="QR code to join from a phone">
      {rows.out.map((runs, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {runs.map((run, i) => (
            <View key={i} style={{ width: run.len * cell, height: cell, backgroundColor: run.dark ? '#000000' : '#FFFFFF' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** A person's avatar: their colour with their initial, so a person is never colour alone. Offline = dashed outline. */
export function Avatar({ name, color: c, size = 40, offline }: { name: string; color: string; size?: number; offline?: boolean }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <View
      style={{
        width: sp(size), height: sp(size), borderRadius: sp(size), alignItems: 'center', justifyContent: 'center',
        backgroundColor: offline ? 'transparent' : c, borderWidth: offline ? sp(3) : 0, borderColor: c, borderStyle: offline ? 'dashed' : 'solid',
      }}
    >
      <Text style={{ color: offline ? c : color.focusInk, fontSize: sp(size * 0.45), fontFamily: FONTS.bold, lineHeight: sp(size * 0.6) }}>{initial}</Text>
    </View>
  );
}

/** Avatar + name, used on every screen so a person is always the same colour, initial and name. */
export function SpeakerTag({ name, color: c, dim, size = 30 }: { name: string; color: string; dim?: boolean; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(12) }}>
      <Avatar name={name} color={c} size={size * 1.4} offline={dim} />
      <Text style={{ color: dim ? palette.muted : palette.text, fontSize: sp(size), fontFamily: FONTS.bold }}>{name}</Text>
      {dim ? <Text style={{ color: palette.muted, fontSize: sp(Math.max(20, size * 0.7)) }}>(phone offline)</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  padded: { paddingHorizontal: sp(safeZones.titleSafe.horizontal), paddingVertical: sp(safeZones.titleSafe.vertical) },
  btn: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: sp(4),
    borderRadius: sp(18),
    paddingVertical: sp(20),
    paddingHorizontal: sp(36),
    minWidth: sp(260),
    minHeight: sp(88),
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { paddingVertical: sp(12), paddingHorizontal: sp(22), minWidth: sp(80), minHeight: sp(68), borderRadius: sp(14) },
  btnSelected: { borderColor: palette.accent, backgroundColor: palette.panelHi },
  btnDisabled: { opacity: 0.4 },
  btnFocused: { backgroundColor: color.focusFill, borderColor: color.focusFill, elevation: 12 },
  ring: { borderWidth: sp(4), borderColor: 'transparent', borderRadius: sp(28), padding: sp(4) },
  ringOn: { borderColor: color.focusRing },
  lift: { transform: [{ scale: 1.05 }] },
  btnText: { color: palette.text, fontSize: sp(34), fontFamily: FONTS.bold, textAlign: 'center' },
  btnTextSmall: { fontSize: sp(28) },
  btnTextFocused: { color: color.focusInk },
  btnHint: { color: palette.muted, fontSize: sp(22), marginTop: sp(4) },
  btnHintFocused: { color: color.focusMuted },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: sp(3), borderRadius: sp(40), paddingVertical: sp(8), paddingHorizontal: sp(20), gap: sp(12) },
  dot: { width: sp(16), height: sp(16), borderRadius: sp(8) },
  pillText: { fontSize: sp(26), fontFamily: FONTS.bold },
  panel: { backgroundColor: palette.panel, borderColor: palette.line, borderWidth: sp(2), borderRadius: sp(24), padding: sp(32) },
  toastWrap: { position: 'absolute', top: sp(60), left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  toast: { backgroundColor: palette.accent, borderRadius: sp(16), paddingVertical: sp(14), paddingHorizontal: sp(32), maxWidth: '80%' },
  toastText: { color: '#1A1300', fontSize: sp(30), fontFamily: FONTS.bold, textAlign: 'center' },
});
