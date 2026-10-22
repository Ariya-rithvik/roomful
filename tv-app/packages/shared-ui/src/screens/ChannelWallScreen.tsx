import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { ChannelId } from '@roomcaption/shared';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from '../rc/RoomContext';
import { palette, serverUrl } from '../rc/config';
import { Screen, SpeakerTag, Toast, useToast } from '../rc/ui';
import { SupportedKeys, useRemoteKeys } from '../rc/useRemoteKeys';
import { useChannelReport } from '../rc/useChannelReport';
import { FONTS } from '../rc/theme';

interface Show { id: string; title: string; video: string; poster: string }
type Tile = 'kids' | 'family' | 'news' | 'table';
const TILES: Tile[] = ['kids', 'family', 'news', 'table'];
const TILE_NAME: Record<Tile, string> = { kids: 'KIDS CHANNEL', family: 'FAMILY CHANNEL', news: 'NEWS', table: 'AT THE TABLE' };

function useJson<T>(path: string, everyMs = 0): T | null | undefined {
  // undefined = loading, null = failed
  const [data, setData] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${serverUrl()}${path}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: T) => alive && setData(d))
        .catch(() => alive && setData((prev) => (prev === undefined ? null : prev)));
    load();
    const t = everyMs ? setInterval(load, everyMs) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [path, everyMs]);
  return data;
}

/** One video channel: plays its lineup show after show; heard on the TV only when focused. */
function VideoTile({ id, focused, paused, skip }: { id: ChannelId; focused: boolean; paused: boolean; skip: number }) {
  const lineup = useJson<{ items: Show[] }>(`/api/channels/${id}`);
  const shows = lineup?.items ?? [];
  const [index, setIndex] = useState(0);
  const show = shows.length ? shows[index % shows.length] : null;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.muted = true;
  });

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    player
      .replaceAsync({ uri: show.video, metadata: { title: show.title, artist: `${TILE_NAME[id].toLowerCase()} · Roomful` } })
      .then(() => !cancelled && !pausedRef.current && player.play())
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.id]);

  useEffect(() => {
    const subs = [
      player.addListener('playToEnd', () => setIndex((i) => i + 1)),
      player.addListener('statusChange', (e: { status: string }) => {
        if (e.status === 'readyToPlay' && !pausedRef.current) player.play();
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  // The TV speaker plays the focused channel; everyone else listens on their phone.
  useEffect(() => {
    player.muted = !focused;
  }, [focused, player]);
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  useEffect(() => {
    if (skip) setIndex((i) => i + 1);
  }, [skip]);

  useChannelReport(id, player, show);

  if (lineup === undefined) return <Text style={styles.muted}>Tuning…</Text>;
  if (!show) return <Text style={styles.muted}>This channel is not available right now (no internet on the family computer?).</Text>;
  return (
    <>
      <VideoView player={player} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} contentFit="cover" nativeControls={false} />
      <View style={styles.caption}>
        <Text style={styles.showTitle} numberOfLines={1}>
          {show.title}
        </Text>
        <Text style={styles.sound}>{paused ? 'Paused' : focused ? 'Sound on the TV' : 'Sound on phones · Listen on this phone'}</Text>
      </View>
    </>
  );
}

/**
 * Several channels on one TV. The family doesn't have to agree on one programme: four tiles play
 * at once, the TV speaker follows the highlighted tile, and anyone can hear any channel on their own
 * phone (Talk tab → "Listen on this phone"), in step with the picture.
 */
export default function ChannelWallScreen() {
  const { speakers, store, version, room } = useRoom();
  const news = useJson<{ source: string; items: { title: string }[] }>('/api/news', 10 * 60_000);
  const [focus, setFocus] = useState<Tile>('kids');
  const [big, setBig] = useState(false);
  const [paused, setPaused] = useState<Record<ChannelId, boolean>>({ kids: false, family: false });
  const [skip, setSkip] = useState<Record<ChannelId, number>>({ kids: 0, family: 0 });
  const [toast, showToast] = useToast();

  useRemoteKeys((k) => {
    const i = TILES.indexOf(focus);
    const move = (to: number) => !big && setFocus(TILES[to]);
    switch (k) {
      case SupportedKeys.Left:
        move(i % 2 ? i - 1 : i);
        break;
      case SupportedKeys.Right:
        move(i % 2 ? i : i + 1);
        break;
      case SupportedKeys.Up:
        move(i >= 2 ? i - 2 : i);
        break;
      case SupportedKeys.Down:
        move(i < 2 ? i + 2 : i);
        break;
      case SupportedKeys.Enter:
        setBig((b) => !b);
        break;
      case SupportedKeys.PlayPause:
        if (focus === 'kids' || focus === 'family') setPaused((p) => ({ ...p, [focus]: !p[focus as ChannelId] }));
        break;
      case SupportedKeys.FastForward:
        if (focus === 'kids' || focus === 'family') {
          setSkip((s) => ({ ...s, [focus]: s[focus as ChannelId] + 1 }));
          showToast('Next show');
        }
        break;
      default:
        break;
    }
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => store.all().filter((l) => l.final).slice(-4), [store, version]);
  const byId = useMemo(() => new Map(speakers.map((s) => [s.speakerId, s])), [speakers]);

  const tile = (t: Tile) => {
    const on = focus === t;
    const hidden = big && !on;
    return (
      <View key={t} style={[styles.tile, on && styles.tileOn, hidden && styles.hidden]}>
        {t === 'kids' || t === 'family' ? (
          <VideoTile id={t} focused={on} paused={paused[t]} skip={skip[t]} />
        ) : t === 'news' ? (
          <View style={styles.textTile}>
            {news && news.items.length ? (
              <>
                {news.items.slice(0, big ? 8 : 4).map((n, i) => (
                  <Text key={i} style={styles.headline} numberOfLines={2}>
                    {n.title}
                  </Text>
                ))}
                <Text style={styles.source}>Headlines: {news.source}</Text>
              </>
            ) : (
              <Text style={styles.muted}>{news === undefined ? 'Loading headlines…' : 'Headlines are not available right now.'}</Text>
            )}
          </View>
        ) : (
          <View style={[styles.textTile, { justifyContent: 'flex-end' }]}>
            {lines.length === 0 && <Text style={styles.muted}>{speakers.length ? 'Waiting for someone to speak…' : `Scan the code on Home to join · room ${room?.room ?? ''}`}</Text>}
            {lines.map((l) => {
              const s = byId.get(l.speakerId);
              return (
                <View key={l.key} style={[styles.lineWrap, { borderLeftColor: s?.color ?? palette.muted }]}>
                  <Text style={{ color: s?.color ?? palette.muted, fontSize: sp(20), fontFamily: FONTS.bold }}>{s?.name ?? 'Someone'}</Text>
                  <Text style={styles.line} numberOfLines={2}>
                    {l.text}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        <View style={[styles.label, on && styles.labelOn]}>
          <Text style={[styles.labelText, on && styles.labelTextOn]}>{TILE_NAME[t]}</Text>
        </View>
      </View>
    );
  };

  const topRowOn = focus === 'kids' || focus === 'family';
  return (
    <Screen padded={false}>
      <View style={styles.wrap}>
        <View style={styles.top}>
          <Text style={styles.title}>Channel wall</Text>
          <View style={styles.people}>
            {speakers.map((s) => (
              <SpeakerTag key={s.speakerId} name={s.name} color={s.color} dim={!s.connected} size={24} />
            ))}
          </View>
        </View>
        <View style={styles.grid}>
          {/* Hidden tiles stay mounted, so their channels keep playing for phones while one is big. */}
          <View style={[styles.row, big && !topRowOn && styles.hidden]}>{(['kids', 'family'] as Tile[]).map(tile)}</View>
          <View style={[styles.row, big && topRowOn && styles.hidden]}>{(['news', 'table'] as Tile[]).map(tile)}</View>
        </View>
        <Text style={styles.hint}>
          ◀▶▲▼ choose   OK {big ? 'back to four' : 'bigger'}   ⏯ pause   ⏩ next show   TV sound follows the highlight · phones: Listen on this phone
        </Text>
      </View>
      <Toast text={toast} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: sp(40), paddingVertical: sp(24), gap: sp(14) },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: sp(48) },
  title: { color: palette.text, fontSize: sp(36), fontFamily: FONTS.bold },
  people: { flexDirection: 'row', gap: sp(24), alignItems: 'center' },
  grid: { flex: 1, gap: sp(18) },
  row: { flex: 1, flexDirection: 'row', gap: sp(18) },
  tile: { flex: 1, borderRadius: sp(18), overflow: 'hidden', backgroundColor: '#000', borderWidth: sp(5), borderColor: 'transparent', justifyContent: 'center' },
  tileOn: { borderColor: palette.accent },
  hidden: { display: 'none' },
  label: { position: 'absolute', top: sp(14), left: sp(14), backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: sp(10), paddingVertical: sp(5), paddingHorizontal: sp(12) },
  labelOn: { backgroundColor: palette.accent },
  labelText: { color: palette.text, fontSize: sp(18), fontFamily: FONTS.bold, letterSpacing: sp(2) },
  labelTextOn: { color: '#1A1300' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: sp(18), paddingVertical: sp(12), backgroundColor: 'rgba(0,0,0,0.6)' },
  showTitle: { color: '#FFFFFF', fontSize: sp(28), fontFamily: FONTS.bold },
  sound: { color: palette.muted, fontSize: sp(20), fontFamily: FONTS.semibold },
  textTile: { flex: 1, backgroundColor: palette.panel, paddingHorizontal: sp(24), paddingTop: sp(64), paddingBottom: sp(20), gap: sp(12) },
  headline: { color: palette.text, fontSize: sp(26), fontFamily: FONTS.semibold, lineHeight: sp(34) },
  source: { color: palette.muted, fontSize: sp(18), marginTop: 'auto' },
  lineWrap: { borderLeftWidth: sp(5), paddingLeft: sp(12) },
  line: { color: palette.text, fontSize: sp(28), fontFamily: FONTS.semibold },
  muted: { color: palette.muted, fontSize: sp(24), textAlign: 'center', padding: sp(24) },
  hint: { color: palette.muted, fontSize: sp(20), textAlign: 'center' },
});
