import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { ClipInfo } from '@roomcaption/shared';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from './RoomContext';
import { palette, serverUrl } from './config';
import { SpeakerTag } from './ui';
import { FONTS } from './theme';

// expo-video on web positions the <video> with inset: 0, which does not stretch a video element,
// so it stays at its natural size. The native TV player is unaffected; this fixes the web preview.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('rc-video-fill')) {
  const s = document.createElement('style');
  s.id = 'rc-video-fill';
  s.textContent = 'video { width: 100% !important; height: 100% !important; }';
  document.head.appendChild(s);
}

const clipTime = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Plays the saved happy-moment clips one after another (silent), with what was said around that
 * moment taken from the caption history. index/onIndex let a screen drive it with the remote.
 */
export function ReelPlayer({ clips, index, onIndex, paused, compact }: { clips: ClipInfo[]; index: number; onIndex: (i: number) => void; paused?: boolean; compact?: boolean }) {
  const { store, speakers, version } = useRoom();
  const clip = clips.length ? clips[((index % clips.length) + clips.length) % clips.length] : null;
  const player = useVideoPlayer(clip ? { uri: serverUrl() + clip.url } : null, (p) => {
    p.loop = clips.length <= 1;
    p.muted = true;
    p.play();
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!clip) return;
    setFailed(false);
    player.loop = clips.length <= 1;
    player.replace({ uri: serverUrl() + clip.url }, true);
    player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id]);

  useEffect(() => {
    const end = player.addListener('playToEnd', () => onIndex(index + 1));
    const status = player.addListener('statusChange', (e: { status: string }) => setFailed(e.status === 'error'));
    return () => {
      end.remove();
      status.remove();
    };
  }, [player, index, onIndex]);

  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const said = useMemo(() => (clip ? store.all().filter((l) => l.final && l.tStart >= clip.tStart - 4000 && l.tStart <= clip.tStart + clip.durationMs + 1500).slice(-2) : []), [clip?.id, version]);
  const who = clip ? speakers.find((s) => s.speakerId === clip.speakerId) : null;

  if (!clip) return null;
  return (
    <View style={styles.wrap}>
      <VideoView player={player} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} contentFit="cover" nativeControls={false} />
      {failed && (
        <View style={styles.center}>
          <Text style={styles.failText}>This clip could not be played on this TV.</Text>
        </View>
      )}
      <View style={[styles.top, compact && { padding: sp(14) }]}>
        {who ? <SpeakerTag name={`${who.name}'s phone`} color={who.color} size={compact ? 24 : 30} /> : null}
        <Text style={[styles.meta, compact && { fontSize: sp(20) }]}>
          {clipTime(clip.tStart)} · {clip.reason === 'smile' ? 'a smile' : 'saved from the TV'} · {((index % clips.length) + clips.length) % clips.length + 1}/{clips.length}
        </Text>
      </View>
      {said.length > 0 && (
        <View style={[styles.captions, compact && { padding: sp(14) }]}>
          {said.map((l) => {
            const s = speakers.find((x) => x.speakerId === l.speakerId);
            return (
              <Text key={l.key} style={[styles.said, compact && { fontSize: sp(26) }]} numberOfLines={2}>
                <Text style={{ color: s?.color ?? palette.muted, fontFamily: FONTS.bold }}>{s?.name ?? 'Someone'}: </Text>
                {l.text}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', borderRadius: sp(16), overflow: 'hidden' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  failText: { color: palette.text, fontSize: sp(32) },
  top: { position: 'absolute', top: 0, left: 0, right: 0, padding: sp(24), gap: sp(6), backgroundColor: 'rgba(0,0,0,0.45)' },
  meta: { color: palette.text, fontSize: sp(24) },
  captions: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: sp(24), backgroundColor: 'rgba(0,0,0,0.7)', gap: sp(6) },
  said: { color: '#FFFFFF', fontSize: sp(38), fontFamily: FONTS.semibold },
});
