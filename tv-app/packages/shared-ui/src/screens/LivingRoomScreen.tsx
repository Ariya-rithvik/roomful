import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { OBJECTS } from '@roomcaption/shared';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from '../rc/RoomContext';
import { palette, serverUrl } from '../rc/config';
import { ReelPlayer } from '../rc/ReelPlayer';
import { QRCode, Screen, SpeakerTag, Toast, useToast } from '../rc/ui';
import { SupportedKeys, useRemoteKeys } from '../rc/useRemoteKeys';
import { useChannelReport } from '../rc/useChannelReport';
import { FONTS } from '../rc/theme';

interface Show { id: string; title: string; description: string; video: string; poster: string; durationSec: number | null }
interface News { source: string; items: { title: string; link: string }[] }
type Panel = 'news' | 'captions' | 'moments';
const PANELS: Panel[] = ['news', 'captions', 'moments'];
const PANEL_NAME: Record<Panel, string> = { news: 'News', captions: 'At the table', moments: 'Happy moments' };
const BREAK_CLIPS = 3;

/**
 * The family's living room on one screen:
 *  - left: a kids channel (royalty-free Scrap TV shows) with sound. When a show ends and new happy
 *    moments were saved, a "Family break" plays them before the next show.
 *  - right: News headlines, live captions of the table, or the happy-moments reel (▲▼ to switch).
 *  - bottom: the real objects people brought into the TV tonight.
 */
export default function LivingRoomScreen() {
  const { speakers, store, version, clips, objects, hunt, room, momentNow, settings } = useRoom();
  const [shows, setShows] = useState<Show[] | null>(null);
  const [news, setNews] = useState<News | null>(null);
  const [showIndex, setShowIndex] = useState(0);
  const [panel, setPanel] = useState<Panel>('news');
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [breakClips, setBreakClips] = useState<typeof clips>([]);
  const [breakIndex, setBreakIndex] = useState(0);
  const [momentIndex, setMomentIndex] = useState(0);
  const shownInBreak = useRef(new Set<string>());
  const [toast, showToast] = useToast();

  // Channel content from the family server (which fetches and caches it).
  useEffect(() => {
    let alive = true;
    const loadShows = () =>
      fetch(`${serverUrl()}/api/channels/kids`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { items: Show[] }) => alive && setShows(d.items))
        .catch(() => alive && setShows([]));
    const loadNews = () =>
      fetch(`${serverUrl()}/api/news`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: News) => alive && setNews(d))
        .catch(() => alive && setNews(null));
    loadShows();
    loadNews();
    const t = setInterval(loadNews, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const inBreak = breakClips.length > 0;
  const show = shows && shows.length ? shows[showIndex % shows.length] : null;

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    // An Android Media Session for the kids channel: on Fire TV this is how Alexa voice commands
    // ("Alexa, pause", "Alexa, resume", "Alexa, rewind 10 seconds") reach the app, from the remote's
    // mic or an Echo. Needs the com.amazon.permission.media.session.voicecommandcontrol permission (app.json).
    p.showNowPlayingNotification = true;
  });

  // Swapping the source finishes asynchronously (on web especially); play only once it has.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    if (!show || inBreak) return;
    let cancelled = false;
    player.muted = muted;
    player
      .replaceAsync({ uri: show.video, metadata: { title: show.title, artist: 'Kids channel · Roomful', artwork: show.poster || undefined } })
      .then(() => {
        if (!cancelled && !pausedRef.current) player.play();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.id, inBreak]);

  // Belt and braces: whenever the player becomes ready and we are not paused, play.
  useEffect(() => {
    const sub = player.addListener('statusChange', (e: { status: string }) => {
      if (e.status === 'readyToPlay' && !pausedRef.current && !inBreak) player.play();
    });
    return () => sub.remove();
  }, [player, inBreak]);

  useChannelReport('kids', player, show, !inBreak);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  useEffect(() => {
    if (paused || inBreak) player.pause();
    else player.play();
  }, [paused, inBreak, player]);

  // When a show ends: a family break if there are new moments, otherwise the next show.
  const onShowEnded = useCallback(() => {
    const fresh = clips.filter((c) => !shownInBreak.current.has(c.id)).slice(-BREAK_CLIPS);
    setShowIndex((i) => i + 1);
    if (fresh.length) {
      fresh.forEach((c) => shownInBreak.current.add(c.id));
      setBreakIndex(0);
      setBreakClips(fresh);
    }
  }, [clips]);

  useEffect(() => {
    const sub = player.addListener('playToEnd', onShowEnded);
    return () => sub.remove();
  }, [player, onShowEnded]);

  const onBreakIndex = useCallback(
    (i: number) => {
      if (i >= breakClips.length) setBreakClips([]);
      else setBreakIndex(i);
    },
    [breakClips.length],
  );

  useRemoteKeys((k) => {
    switch (k) {
      case SupportedKeys.Up:
        setPanel((p) => PANELS[(PANELS.indexOf(p) + PANELS.length - 1) % PANELS.length]);
        break;
      case SupportedKeys.Down:
        setPanel((p) => PANELS[(PANELS.indexOf(p) + 1) % PANELS.length]);
        break;
      case SupportedKeys.Left:
        setMuted((m) => {
          showToast(m ? 'Kids channel sound on' : 'Kids channel muted');
          return !m;
        });
        break;
      case SupportedKeys.PlayPause:
        setPaused((p) => !p);
        break;
      case SupportedKeys.FastForward:
      case SupportedKeys.Right:
        if (inBreak) setBreakClips([]);
        else setShowIndex((i) => i + 1);
        break;
      case SupportedKeys.Enter:
        momentNow();
        showToast('Asked every phone to save a moment');
        break;
      default:
        break;
    }
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => store.all().filter((l) => l.final).slice(-6), [store, version]);
  const byId = useMemo(() => new Map(speakers.map((s) => [s.speakerId, s])), [speakers]);
  const huntOn = hunt && (hunt.status === 'playing' || hunt.status === 'won');

  return (
    <Screen padded={false}>
      <View style={styles.wrap}>
        <View style={styles.top}>
          <View style={styles.people}>
            {speakers.map((s) => (
              <SpeakerTag key={s.speakerId} name={s.name} color={s.color} dim={!s.connected} size={26} />
            ))}
            {speakers.length === 0 && <Text style={styles.muted}>Nobody has joined yet · room {room?.room}</Text>}
          </View>
          {huntOn && (
            <View style={styles.huntChip}>
              <Text style={styles.huntText}>
                Hunt {hunt!.round}/{hunt!.total}: {hunt!.prompt?.text}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.row}>
          {/* Channel 1: kids channel, or the family break */}
          <View style={styles.left}>
            {inBreak ? (
              <>
                <ReelPlayer clips={breakClips} index={breakIndex} onIndex={onBreakIndex} />
                <View style={styles.breakBanner}>
                  <Text style={styles.breakText}>Family break · today's happy moments</Text>
                </View>
              </>
            ) : show ? (
              <View style={styles.player}>
                <VideoView player={player} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} contentFit="cover" nativeControls={false} />
                <View style={styles.chanLabel}>
                  <Text style={styles.chanName}>KIDS CHANNEL</Text>
                  <Text style={styles.showTitle}>{show.title}</Text>
                </View>
                {(muted || paused) && (
                  <View style={styles.state}>
                    <Text style={styles.stateText}>{paused ? 'Paused' : 'Muted'}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{shows === null ? 'Tuning the kids channel…' : 'The kids channel is not available right now (no internet on the family computer?).'}</Text>
              </View>
            )}
          </View>

          {/* Channel 2: news, captions or happy moments */}
          <View style={styles.right}>
            <View style={styles.tabs}>
              {PANELS.map((p) => (
                <Text key={p} style={[styles.tab, p === panel && styles.tabOn]}>
                  {PANEL_NAME[p]}
                </Text>
              ))}
            </View>
            {panel === 'news' && (
              <View style={styles.panelBody}>
                {news && news.items.length ? (
                  <>
                    {news.items.slice(0, 6).map((n, i) => (
                      <Text key={i} style={styles.headline} numberOfLines={2}>
                        {n.title}
                      </Text>
                    ))}
                    <Text style={styles.source}>Headlines: {news.source}</Text>
                  </>
                ) : (
                  <Text style={styles.muted}>{news === null ? 'Headlines are not available right now.' : 'No headlines.'}</Text>
                )}
              </View>
            )}
            {panel === 'captions' && (
              <View style={[styles.panelBody, { justifyContent: 'flex-end' }]}>
                {lines.length === 0 && <Text style={styles.muted}>Waiting for someone to speak…</Text>}
                {lines.map((l) => {
                  const s = byId.get(l.speakerId);
                  return (
                    <View key={l.key} style={[styles.lineWrap, { borderLeftColor: s?.color ?? palette.muted }]}>
                      <Text style={{ color: s?.color ?? palette.muted, fontSize: sp(22), fontFamily: FONTS.bold }}>{s?.name ?? 'Someone'}</Text>
                      <Text style={[styles.line, { fontSize: sp(settings.textSize >= 2 ? 40 : 34) }]}>{l.text}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            {panel === 'moments' && (
              <View style={styles.panelBody}>
                {clips.length ? (
                  <ReelPlayer clips={clips} index={momentIndex} onIndex={setMomentIndex} compact />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.muted}>No happy moments yet. Switch on Moments on a phone.</Text>
                    {room && <QRCode value={room.joinUrl} size={sp(220)} />}
                  </View>
                )}
              </View>
            )}
          </View>
        </View>

        {/* The real things people brought into the TV tonight */}
        <View style={styles.shelf}>
          <Text style={styles.shelfLabel}>BROUGHT INTO THE TV</Text>
          {objects.length === 0 ? (
            <Text style={styles.muted}>Scan something real with your phone (Scan tab) and it appears here.</Text>
          ) : (
            objects.slice(-8).map((o) => {
              const s = byId.get(o.speakerId);
              return (
                <View key={o.id} style={[styles.thing, { borderColor: s?.color ?? palette.line }]}>
                  <Image source={{ uri: serverUrl() + o.url }} style={styles.thingImg} />
                  <Text style={styles.thingName} numberOfLines={1}>
                    {OBJECTS[o.label].display}
                  </Text>
                </View>
              );
            })
          )}
        </View>
        <Text style={styles.hint}>▲▼ right channel   ◀ sound   ⏯ pause   ▶ next show   OK save a moment   ☰ need help   Back home</Text>
      </View>
      <Toast text={toast} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: sp(48), paddingVertical: sp(28), gap: sp(14) },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: sp(50) },
  people: { flexDirection: 'row', gap: sp(28), alignItems: 'center', flexWrap: 'wrap' },
  huntChip: { backgroundColor: palette.accent, borderRadius: sp(30), paddingVertical: sp(8), paddingHorizontal: sp(22) },
  huntText: { color: '#1A1300', fontSize: sp(26), fontFamily: FONTS.bold },
  row: { flex: 1, flexDirection: 'row', gap: sp(24) },
  left: { flex: 62, borderRadius: sp(18), overflow: 'hidden', backgroundColor: '#000' },
  player: { flex: 1 },
  chanLabel: { position: 'absolute', top: sp(18), left: sp(18), backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: sp(12), paddingVertical: sp(8), paddingHorizontal: sp(16) },
  chanName: { color: palette.accent, fontSize: sp(20), fontFamily: FONTS.bold, letterSpacing: sp(2) },
  showTitle: { color: '#FFFFFF', fontSize: sp(32), fontFamily: FONTS.bold },
  state: { position: 'absolute', top: sp(18), right: sp(18), backgroundColor: palette.accent, borderRadius: sp(10), paddingHorizontal: sp(14), paddingVertical: sp(6) },
  stateText: { color: '#1A1300', fontSize: sp(24), fontFamily: FONTS.bold },
  breakBanner: { position: 'absolute', bottom: sp(110), alignSelf: 'center', backgroundColor: palette.accent, borderRadius: sp(30), paddingVertical: sp(10), paddingHorizontal: sp(28) },
  breakText: { color: '#1A1300', fontSize: sp(32), fontFamily: FONTS.bold },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp(40) },
  emptyText: { color: palette.muted, fontSize: sp(32), textAlign: 'center' },
  right: { flex: 38, backgroundColor: palette.panel, borderRadius: sp(18), padding: sp(22) },
  tabs: { flexDirection: 'row', gap: sp(12), marginBottom: sp(14) },
  tab: { color: palette.muted, fontSize: sp(24), fontFamily: FONTS.bold, paddingVertical: sp(6), paddingHorizontal: sp(14), borderRadius: sp(20) },
  tabOn: { color: '#0B0B0D', backgroundColor: palette.text },
  panelBody: { flex: 1, gap: sp(14), overflow: 'hidden' },
  headline: { color: palette.text, fontSize: sp(30), fontFamily: FONTS.semibold, lineHeight: sp(38) },
  source: { color: palette.muted, fontSize: sp(20), marginTop: 'auto' },
  lineWrap: { borderLeftWidth: sp(6), paddingLeft: sp(14) },
  line: { color: palette.text, fontFamily: FONTS.semibold },
  shelf: { flexDirection: 'row', alignItems: 'center', gap: sp(16), minHeight: sp(130) },
  shelfLabel: { color: palette.muted, fontSize: sp(20), fontFamily: FONTS.bold, letterSpacing: sp(2), width: sp(160) },
  thing: { width: sp(150), borderWidth: sp(4), borderRadius: sp(16), overflow: 'hidden', backgroundColor: '#000' },
  thingImg: { width: '100%', height: sp(92) },
  thingName: { color: '#FFFFFF', fontSize: sp(20), fontFamily: FONTS.bold, textAlign: 'center', paddingVertical: sp(4) },
  muted: { color: palette.muted, fontSize: sp(26) },
  hint: { color: palette.muted, fontSize: sp(22), textAlign: 'center' },
});
