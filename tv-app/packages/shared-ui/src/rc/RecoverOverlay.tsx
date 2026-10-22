import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { scaledPixels as sp } from '../hooks/useScale';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { useRoom } from './RoomContext';
import { palette } from './config';
import { FONTS } from './theme';

const WINDOW_MS = 60_000;
const MAX_LINES = 6;

/**
 * Conversation Rescue — "I missed that". Brings the last minute of what was actually said (the real
 * caption lines, never a summary or a guess) to the front, big, so someone can catch up without
 * asking everyone to repeat. Opened from any phone, or with ⏪ (Rewind) on the remote; OK or Back
 * returns to live.
 */
export function RecoverOverlay() {
  const { recoverAsk, askRecover, setRecoverOpen, store, speakers, serverNow, helpOpen, alertOpen } = useRoom();
  const [open, setOpen] = useState<{ byName: string | null; at: number } | null>(null);
  const first = useRef(recoverAsk.n);

  useEffect(() => {
    if (recoverAsk.n !== first.current) setOpen({ byName: recoverAsk.byName, at: serverNow() });
  }, [recoverAsk, serverNow]);
  useEffect(() => setRecoverOpen(open !== null), [open, setRecoverOpen]);

  useEffect(() => {
    const l = RemoteControlManager.addKeydownListener((k) => {
      if (helpOpen || alertOpen) return;
      if (k === SupportedKeys.Rewind && !open) askRecover(null);
      else if (open && (k === SupportedKeys.Enter || k === SupportedKeys.Back || k === SupportedKeys.Rewind)) setOpen(null);
    });
    return () => RemoteControlManager.removeKeydownListener(l);
  }, [open, askRecover, helpOpen, alertOpen]);

  // Close by itself after a while so the TV never gets stuck on it.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(null), 45_000);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;
  const finals = store.all().filter((l) => l.final);
  const recent = finals.filter((l) => open.at - l.tStart <= WINDOW_MS);
  const lines = (recent.length >= 2 ? recent : finals).slice(-MAX_LINES);
  const name = (id: string) => speakers.find((s) => s.speakerId === id);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Text style={styles.kicker}>{open.byName ? `${open.byName} missed something` : 'Catching up'} · here is what was just said</Text>
      <View style={styles.lines}>
        {lines.length === 0 && <Text style={styles.empty}>Nothing has been said in the last minute.</Text>}
        {lines.map((l) => {
          const s = name(l.speakerId);
          const ago = Math.max(0, Math.round((open.at - l.tStart) / 1000));
          return (
            <View key={l.key} style={[styles.line, { borderLeftColor: s?.color ?? palette.muted }]}>
              <Text style={[styles.who, { color: s?.color ?? palette.muted }]}>
                {s?.name ?? 'Someone'} · {ago < 60 ? `${ago} s ago` : `${Math.round(ago / 60)} min ago`}
                {l.reply ? ' · reply' : ''}
              </Text>
              <Text style={styles.text}>{l.text}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.hint}>OK · back to the live conversation</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, zIndex: 180, backgroundColor: 'rgba(14,10,8,0.97)', paddingHorizontal: sp(120), paddingVertical: sp(70) },
  kicker: { color: palette.accent, fontSize: sp(36), fontFamily: FONTS.bold },
  lines: { flex: 1, justifyContent: 'flex-end', gap: sp(26), marginVertical: sp(30) },
  line: { borderLeftWidth: sp(10), paddingLeft: sp(24) },
  who: { fontSize: sp(30), fontFamily: FONTS.bold },
  text: { color: '#FFF7EE', fontSize: sp(60), fontFamily: FONTS.bold, lineHeight: sp(76) },
  empty: { color: palette.muted, fontSize: sp(44) },
  hint: { color: palette.muted, fontSize: sp(30) },
});
