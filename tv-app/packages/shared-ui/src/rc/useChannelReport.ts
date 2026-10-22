import { useEffect } from 'react';
import type { VideoPlayer } from 'expo-video';
import type { ChannelId } from '@roomcaption/shared';
import { useRoom } from './RoomContext';

const EVERY_MS = 3000;
const MIN_GAP_MS = 500;

/**
 * Personal sound: while a channel is on screen, tell the server what it is playing and where
 * (media position at a server-clock time). Phones that chose this channel play its audio in step.
 * Reports on play/pause and every few seconds so a phone that drifts can correct itself.
 */
export function useChannelReport(id: ChannelId, player: VideoPlayer, show: { title: string; video: string } | null, onScreen = true) {
  const { reportChannel, serverNow } = useRoom();
  // Gone from the screen: phones listening to it stop. (Not between shows: the next report replaces it.)
  useEffect(() => () => reportChannel(id, null), [id, reportChannel]);
  useEffect(() => {
    if (!show || !onScreen) {
      reportChannel(id, null);
      return;
    }
    // "Playing" only counts if the picture is really moving: a browser that blocked autoplay, or a
    // stream that is buffering, says playing=true while standing still, and phones would run ahead.
    let last: { pos: number; at: number } | null = null;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const report = () => {
      let positionMs = 0;
      let playing = false;
      try {
        positionMs = Math.max(0, Math.round((player.currentTime || 0) * 1000));
        playing = !!player.playing;
      } catch {
        return; // the player was released
      }
      const at = Date.now();
      if (playing && last && at - last.at > 1000 && positionMs === last.pos) playing = false;
      last = { pos: positionMs, at };
      // A new show that is still loading sits at 0: not moving yet. Look again shortly, so phones
      // start the moment the picture does.
      if (playing && positionMs === 0) {
        playing = false;
        if (!soon) soon = setTimeout(() => ((soon = null), report()), 300);
      }
      reportChannel(id, { id, title: show.title.slice(0, 120), url: show.video, positionMs, playing, at: serverNow() });
    };
    // Player events can arrive in bursts (a web browser fighting autoplay flips play/pause many times a
    // second): at most one event-driven report per MIN_GAP_MS, and the last event of a burst is
    // always reported (a little later) so phones end up with the true state.
    let lastSent = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const onEvent = () => {
      if (pending) return;
      const wait = lastSent + MIN_GAP_MS - Date.now();
      const go = () => {
        pending = null;
        lastSent = Date.now();
        report();
      };
      if (wait <= 0) go();
      else pending = setTimeout(go, wait);
    };
    report();
    const t = setInterval(report, EVERY_MS);
    const subs = [player.addListener('playingChange', onEvent), player.addListener('sourceChange', onEvent), player.addListener('statusChange', onEvent)];
    return () => {
      clearInterval(t);
      if (pending) clearTimeout(pending);
      if (soon) clearTimeout(soon);
      subs.forEach((s) => s.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, player, show?.video, onScreen]);
}
