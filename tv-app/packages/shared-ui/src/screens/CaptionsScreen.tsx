import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { scaledPixels as sp } from '../hooks/useScale';
import { safeZones } from '../theme';
import { useRoom } from '../rc/RoomContext';
import { captionThemes, palette, textSizes } from '../rc/config';
import { QRCode, Screen, Toast, useToast } from '../rc/ui';
import { SupportedKeys, useRemoteKeys } from '../rc/useRemoteKeys';
import { FONTS } from '../rc/theme';

const PARTIAL_TIMEOUT_MS = 8000;

export default function CaptionsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { store, version, speakers, settings, setSettings, touch, measure, room, replyStatus, serverNow } = useRoom();
  const [toast, showToast] = useToast();
  const theme = captionThemes[settings.theme];
  const size = textSizes[settings.textSize] ?? textSizes[1];
  const measured = useRef(new Set<string>());

  const byId = useMemo(() => new Map(speakers.map((s) => [s.speakerId, s])), [speakers]);
  const nowMs = serverNow();
  // A partial whose phone went quiet (disconnected mid-sentence) stops showing after a while.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => store.visible(size.lines).filter((l) => l.final || (settings.showPartials && nowMs - l.tRecv < PARTIAL_TIMEOUT_MS)), [store, version, size.lines, settings.showPartials]);
  const live = store.isLive();
  const paused = store.isPaused();
  const talking = new Set(store.all().filter((l) => !l.final && nowMs - l.tRecv < PARTIAL_TIMEOUT_MS).map((l) => l.speakerId));

  // Latency log: a final line becoming visible on the live view is "rendered".
  useEffect(() => {
    if (!live) return;
    for (const l of lines) {
      if (!l.final || l.reply || measured.current.has(l.key)) continue;
      measured.current.add(l.key);
      measure(l.speakerId, l.utt, l.tStart);
    }
    if (measured.current.size > 2000) measured.current.clear();
  }, [lines, live, measure]);

  useEffect(() => {
    if (replyStatus?.status === 'failed') showToast(`Could not speak the reply aloud (${replyStatus.reason ?? 'error'}). It is shown as text.`);
  }, [replyStatus, showToast]);

  useRemoteKeys((k) => {
    switch (k) {
      case SupportedKeys.Left:
      case SupportedKeys.Rewind:
        store.scrollBack(k === SupportedKeys.Rewind ? size.lines : 2);
        touch();
        break;
      case SupportedKeys.Right:
        store.scrollForward(2);
        touch();
        break;
      case SupportedKeys.FastForward:
        store.scrollToLive();
        touch();
        break;
      case SupportedKeys.PlayPause:
        if (store.isPaused()) store.resume();
        else store.pause();
        touch();
        break;
      case SupportedKeys.Up:
        if (settings.textSize < textSizes.length - 1) setSettings({ textSize: settings.textSize + 1 });
        showToast(`Text: ${textSizes[Math.min(textSizes.length - 1, settings.textSize + 1)].name}`);
        break;
      case SupportedKeys.Down:
        if (settings.textSize > 0) setSettings({ textSize: settings.textSize - 1 });
        showToast(`Text: ${textSizes[Math.max(0, settings.textSize - 1)].name}`);
        break;
      case SupportedKeys.Enter:
        nav.navigate('Reply');
        break;
      default:
        break;
    }
  });

  const light = settings.theme === 'light';

  return (
    <Screen padded={false} bg={theme.bg}>
      <View style={styles.wrap}>
        <View style={styles.strip}>
          {speakers.length === 0 && <Text style={[styles.stripEmpty, { color: theme.partial }]}>Nobody has joined yet.</Text>}
          {speakers.map((s) => (
            <View key={s.speakerId} style={[styles.who, light && { backgroundColor: s.color }, talking.has(s.speakerId) && styles.whoTalking, talking.has(s.speakerId) && { borderColor: light ? '#111111' : s.color }]}>
              <View style={[styles.whoDot, { backgroundColor: light ? '#111111' : s.color }]} />
              <Text style={[styles.whoName, { color: light ? '#111111' : s.color }, !s.connected && { opacity: 0.5 }]}>{s.name}</Text>
              {talking.has(s.speakerId) && <Text style={[styles.whoName, { color: light ? '#111111' : s.color }]}> is speaking…</Text>}
            </View>
          ))}
        </View>

        <View style={styles.lines}>
          {lines.length === 0 && (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.partial }]}>Waiting for someone to speak…</Text>
              {speakers.length === 0 && room && (
                <View style={{ marginTop: sp(30), alignItems: 'center' }}>
                  <QRCode value={room.joinUrl} size={sp(300)} />
                  <Text style={[styles.hint, { color: theme.partial, marginTop: sp(12) }]}>Scan with your phone to join · room {room.room}</Text>
                </View>
              )}
            </View>
          )}
          {lines.map((l) => {
            const s = byId.get(l.speakerId);
            const color = s?.color ?? palette.muted;
            return (
              <View key={l.key} style={[styles.line, { borderLeftColor: light ? '#111111' : color }]}>
                <Text
                  style={[styles.name, { fontSize: sp(Math.round(size.font * 0.55)) }, light ? { color: '#111111', backgroundColor: color, paddingHorizontal: sp(10), borderRadius: sp(8), alignSelf: 'flex-start' } : { color }]}
                >
                  {s?.name ?? 'Someone'}
                  {l.reply ? ' (reply)' : ''}
                </Text>
                <Text style={[styles.text, { fontSize: sp(size.font), lineHeight: sp(Math.round(size.font * 1.22)), color: l.final ? theme.text : theme.partial }]}>
                  {l.text}
                  {l.final ? '' : ' …'}
                </Text>
              </View>
            );
          })}
        </View>

        {!live && (
          <View style={[styles.banner, { backgroundColor: palette.accent }]}>
            <Text style={styles.bannerText}>{paused ? 'Paused — press Play/Pause to continue' : 'Showing earlier lines — press Fast-forward for live'}</Text>
          </View>
        )}
        <Text style={[styles.hint, { color: theme.partial }]}>
          ◀ earlier   ▶ later   ⏯ pause   ⏩ live   ▲▼ text size   OK reply   Back home
        </Text>
      </View>
      <Toast text={toast} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: sp(safeZones.titleSafe.horizontal), paddingVertical: sp(safeZones.actionSafe.vertical) },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(18), minHeight: sp(64), alignItems: 'center' },
  stripEmpty: { fontSize: sp(30) },
  who: { flexDirection: 'row', alignItems: 'center', gap: sp(10), paddingVertical: sp(6), paddingHorizontal: sp(16), borderRadius: sp(40), borderWidth: sp(3), borderColor: 'transparent' },
  whoTalking: { borderWidth: sp(3) },
  whoDot: { width: sp(22), height: sp(22), borderRadius: sp(11) },
  whoName: { fontSize: sp(32), fontFamily: FONTS.bold },
  lines: { flex: 1, justifyContent: 'flex-end', gap: sp(18), paddingVertical: sp(16), overflow: 'hidden' },
  line: { borderLeftWidth: sp(10), paddingLeft: sp(22) },
  name: { fontFamily: FONTS.bold, marginBottom: sp(2) },
  text: { fontFamily: FONTS.semibold },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: sp(48), fontFamily: FONTS.semibold },
  banner: { alignSelf: 'center', paddingVertical: sp(10), paddingHorizontal: sp(28), borderRadius: sp(14), marginBottom: sp(8) },
  bannerText: { color: '#1A1300', fontSize: sp(30), fontFamily: FONTS.bold },
  hint: { fontSize: sp(24), textAlign: 'center' },
});
