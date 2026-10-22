// Personal sound: this phone plays the audio of the TV channel its person picked, in step with the TV.
// The TV reports "channel X is at position P at server time T"; the phone's clock is synced to the
// server's, so it knows where the channel is now and nudges its own player towards that.
import { useEffect, useRef, useState } from 'react';
import { channelPositionNow, syncStep, type ChannelId, type ChannelPlay } from '@roomcaption/shared';
import { Icon } from './Icon';

const NAMES: Record<ChannelId, string> = { kids: 'Kids channel', family: 'Family channel' };
const STORE = 'rc.listen';

export function ListenPanel({ channels, serverNow }: { channels: ChannelPlay[]; serverNow: () => number }) {
  const [pick, setPick] = useState<ChannelId | null>(null);
  const [driftMs, setDriftMs] = useState<number | null>(null);
  const [problem, setProblem] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chanRef = useRef<ChannelPlay | null>(null);
  const chan = pick ? channels.find((c) => c.id === pick) ?? null : null;
  chanRef.current = chan;

  // Remember the last choice, but only start playing after a tap (browsers require it).
  const remembered = (() => {
    try {
      return localStorage.getItem(STORE) as ChannelId | null;
    } catch {
      return null;
    }
  })();

  const choose = (id: ChannelId | null) => {
    setPick(id);
    setProblem('');
    try {
      if (id) localStorage.setItem(STORE, id);
      else localStorage.removeItem(STORE);
    } catch {
      /* private mode */
    }
    const a = audioRef.current;
    if (!a) return;
    if (!id) {
      a.pause();
      a.removeAttribute('src');
      a.load();
      setDriftMs(null);
      return;
    }
    // Unlock playback inside the tap; the sync loop sets the source and position.
    a.play().catch(() => {});
  };

  // The sync loop: twice a second, compare where we are with where the TV is.
  useEffect(() => {
    if (!pick) return;
    // A jump takes time to land (fetch + decode), so aim ahead by a lead that learns from each jump.
    let leadMs = 150;
    let justSeeked = false;
    const t = window.setInterval(() => {
      const a = audioRef.current;
      const c = chanRef.current;
      if (!a) return;
      if (!c) {
        a.pause();
        setDriftMs(null);
        return;
      }
      if (a.dataset.src !== c.url) {
        a.dataset.src = c.url;
        a.src = c.url;
        a.currentTime = (channelPositionNow(c, serverNow()) + leadMs) / 1000;
      }
      if (!c.playing) {
        if (!a.paused) a.pause();
        if (Math.abs(a.currentTime * 1000 - c.positionMs) > 300) a.currentTime = c.positionMs / 1000;
        setDriftMs(null);
        return;
      }
      if (a.paused) a.play().catch((e: Error) => setProblem(`This phone could not play the sound (${e.name}). Tap the channel again.`));
      if (a.readyState < 2) return; // still loading
      const step = syncStep(a.currentTime * 1000, channelPositionNow(c, serverNow()));
      if (justSeeked && step.seekTo === null) leadMs = Math.min(800, Math.max(0, leadMs - step.driftMs));
      justSeeked = step.seekTo !== null;
      if (step.seekTo !== null) a.currentTime = (step.seekTo + leadMs) / 1000;
      a.playbackRate = step.rate;
      setDriftMs(step.driftMs);
    }, 500);
    return () => window.clearInterval(t);
  }, [pick, serverNow]);

  return (
    <div className="card listen">
      <div className="label-row">
        <Icon name="sound" size={16} />
        <span className="label">Listen on this phone</span>
      </div>
      {channels.length === 0 ? (
        <p className="heard-empty">When the TV is playing a channel, you can hear it here with earphones.</p>
      ) : (
        <div className="listen-choices" role="radiogroup" aria-label="Channel sound on this phone">
          {channels.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={pick === c.id}
              className={`chip ${pick === c.id ? 'on' : ''} ${pick === null && remembered === c.id ? 'suggest' : ''}`}
              onClick={() => choose(pick === c.id ? null : c.id)}
            >
              <b>{NAMES[c.id]}</b>
              <span>{c.title}</span>
            </button>
          ))}
        </div>
      )}
      {pick && (
        <p className="footnote" role="status">
          {!chan
            ? 'That channel is not on the TV right now.'
            : !chan.playing
              ? 'Paused on the TV.'
              : driftMs === null
                ? 'Catching up with the TV…'
                : Math.abs(driftMs) <= 40
                  ? `In step with the TV (${Math.abs(driftMs)} ms).`
                  : `Getting in step (${driftMs > 0 ? '+' : ''}${driftMs} ms)…`}{' '}
          Use earphones, so this phone's microphone does not hear the show.
        </p>
      )}
      {problem && <p className="footnote warn">{problem}</p>}
      <audio ref={audioRef} preload="auto" playsInline />
    </div>
  );
}
