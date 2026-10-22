import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CaptionStore, type ChannelId, type ChannelPlay, type ClipInfo, type DisasterAlert, type HelpState, type HuntState, type Lang, type ObjectArrived, type ReplyStatus, type ScanResult, type ServerToTv, type SpeakerInfo } from '@roomcaption/shared';
import { forgetRoom, openRoom, TvLink, type LinkState, type RoomCreated } from './TvLink';
import { serverUrl, type CaptionTheme } from './config';

export interface Settings {
  textSize: number;
  theme: CaptionTheme;
  showPartials: boolean;
  /** Who replies from the reply board (their phone plays the voice). */
  replyAs: string | null;
  /** Show unreviewed Hindi drafts (reply phrases, object names). */
  drafts: boolean;
  /** Who this TV belongs to, so a help alert says \"Dadi needs help\". */
  tvOwner: string | null;
}

interface RoomValue {
  phase: 'creating' | 'ready' | 'error';
  error: string | null;
  room: RoomCreated | null;
  link: LinkState;
  speakers: SpeakerInfo[];
  store: CaptionStore;
  /** Bumped whenever captions change, so screens re-render. */
  version: number;
  replyStatus: ReplyStatus | null;
  hunt: HuntState | null;
  /** Latest scan results, newest first. */
  scans: (ScanResult & { n: number })[];
  clips: ClipInfo[];
  /** Real objects people brought into the TV tonight, oldest first. */
  objects: ObjectArrived[];
  help: HelpState | null;
  /** Disaster alerts that concern this family (newest last). */
  alerts: DisasterAlert[];
  /** True while the alert screen covers everything. */
  alertOpen: boolean;
  setAlertOpen: (open: boolean) => void;
  /** "I missed that": who asked (bumped n opens the catch-up screen). */
  recoverAsk: { n: number; byName: string | null };
  askRecover: (byName: string | null) => void;
  recoverOpen: boolean;
  setRecoverOpen: (open: boolean) => void;
  /** True while the help screen covers everything: screens ignore the remote. */
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  helpRaise: () => void;
  helpCancel: () => void;
  /** Bumped by an on-screen help button: the help overlay starts its countdown. */
  helpAsk: number;
  askHelp: () => void;
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  /** Re-render now (after pause/scroll on the store). */
  touch: () => void;
  say: (speakerId: string, text: string, lang: Lang, phraseId?: string) => boolean;
  measure: (speakerId: string, utt: number, tStart: number) => void;
  /** Server-clock now (falls back to the local clock until synced). */
  serverNow: () => number;
  huntStart: (rounds: number) => void;
  huntNext: () => void;
  huntEnd: () => void;
  momentNow: () => void;
  clipsClear: () => void;
  /** Personal sound: tell the server where a channel is (null = no longer on screen). */
  reportChannel: (id: ChannelId, c: ChannelPlay | null) => void;
  newRoom: () => void;
}

const Ctx = createContext<RoomValue | null>(null);

export function useRoom(): RoomValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoom outside RoomProvider');
  return v;
}

export function RoomProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<RoomValue['phase']>('creating');
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomCreated | null>(null);
  const [link, setLink] = useState<LinkState>('connecting');
  const [speakers, setSpeakers] = useState<SpeakerInfo[]>([]);
  const [version, setVersion] = useState(0);
  const [replyStatus, setReplyStatus] = useState<ReplyStatus | null>(null);
  const [hunt, setHunt] = useState<HuntState | null>(null);
  const [scans, setScans] = useState<(ScanResult & { n: number })[]>([]);
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [objects, setObjects] = useState<ObjectArrived[]>([]);
  const [help, setHelp] = useState<HelpState | null>(null);
  const [alerts, setAlerts] = useState<DisasterAlert[]>([]);
  const [alertOpen, setAlertOpen] = useState(false);
  const [recoverAsk, setRecoverAsk] = useState<{ n: number; byName: string | null }>({ n: 0, byName: null });
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpAsk, setHelpAsk] = useState(0);
  const [settings, setSettingsState] = useState<Settings>({ textSize: 1, theme: 'dark', showPartials: true, replyAs: null, drafts: false, tvOwner: null });
  const [attempt, setAttempt] = useState(0);
  const storeRef = useRef(new CaptionStore(300));
  const linkRef = useRef<TvLink | null>(null);
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanN = useRef(0);

  // Coalesce bursts of partials into one render per ~50 ms.
  const bump = useCallback(() => {
    if (bumpTimer.current) return;
    bumpTimer.current = setTimeout(() => {
      bumpTimer.current = null;
      setVersion((v) => v + 1);
    }, 50);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase('creating');
    setError(null);
    openRoom()
      .then((r) => {
        if (cancelled) return;
        storeRef.current = new CaptionStore(300);
        setRoom(r);
        setHunt(null);
        setScans([]);
        setClips([]);
        setObjects([]);
        setPhase('ready');
        const onMessage = (m: ServerToTv) => {
          switch (m.t) {
            case 'room':
              setSpeakers(m.speakers);
              setSettingsState((s) => (s.replyAs && m.speakers.some((x) => x.speakerId === s.replyAs) ? s : { ...s, replyAs: m.speakers[0]?.speakerId ?? null }));
              break;
            case 'caption':
              storeRef.current.apply(m);
              bump();
              break;
            case 'drop':
              storeRef.current.drop(m);
              bump();
              break;
            case 'reply_status':
              setReplyStatus(m);
              break;
            case 'hunt':
              setHunt((prev) => {
                if (m.status === 'playing' && (!prev || prev.status === 'idle' || prev.status === 'done')) setScans([]);
                return m;
              });
              break;
            case 'scan_result':
              setScans((s) => [{ ...m, n: ++scanN.current }, ...s].slice(0, 6));
              break;
            case 'clip':
              setClips((c) => (c.some((x) => x.id === m.id) ? c : [...c, m]));
              break;
            case 'clips_cleared':
              setClips([]);
              break;
            case 'help':
              setHelp(m);
              break;
            case 'recover':
              setRecoverAsk((r) => ({ n: r.n + 1, byName: m.byName }));
              break;
            case 'alert':
              setAlerts((a) => (a.some((x) => x.id === m.id) ? a : [...a, m].slice(-20)));
              break;
            case 'object':
              setObjects((o) => (o.some((x) => x.id === m.id) ? o : [...o, m].slice(-24)));
              break;
            default:
              break;
          }
        };
        linkRef.current = new TvLink(r.room, r.token, {
          onMessage,
          onState: (s) => {
            setLink(s);
            // The server restarted and forgot this room: open a fresh one (new QR code) by itself.
            if (s === 'gone') {
              forgetRoom();
              setAttempt((a) => a + 1);
            }
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPhase('error');
        setError(`Cannot reach the Roomful family server at ${serverUrl()}.`);
      });
    return () => {
      cancelled = true;
      linkRef.current?.close();
      linkRef.current = null;
    };
  }, [attempt, bump]);

  // What each on-screen channel is playing, sent as one now_playing message whenever any changes.
  const channelsRef = useRef(new Map<ChannelId, ChannelPlay>());
  const reportChannel = useCallback((id: ChannelId, c: ChannelPlay | null) => {
    if (c) channelsRef.current.set(id, c);
    else if (!channelsRef.current.delete(id)) return;
    linkRef.current?.command({ t: 'now_playing', channels: [...channelsRef.current.values()] });
  }, []);

  const value = useMemo<RoomValue>(
    () => ({
      phase, error, room, link, speakers, store: storeRef.current, version, replyStatus, hunt, scans, clips, objects, help, helpOpen, setHelpOpen, helpAsk, alerts, alertOpen, setAlertOpen, recoverAsk, recoverOpen, setRecoverOpen,
      askRecover: (byName) => setRecoverAsk((r) => ({ n: r.n + 1, byName })),
      settings,
      askHelp: () => setHelpAsk((n) => n + 1),
      setSettings: (p) => setSettingsState((s) => ({ ...s, ...p })),
      touch: () => setVersion((v) => v + 1),
      say: (speakerId, text, lang, phraseId) => linkRef.current?.say(speakerId, text, lang, phraseId) ?? false,
      measure: (speakerId, utt, tStart) => {
        const l = linkRef.current;
        if (l && l.synced()) l.measure(speakerId, utt, tStart, l.serverNow());
      },
      serverNow: () => linkRef.current?.serverNow() ?? Date.now(),
      huntStart: (rounds) => linkRef.current?.command({ t: 'hunt_start', rounds, seed: Math.floor(Math.random() * 2 ** 31) }),
      huntNext: () => linkRef.current?.command({ t: 'hunt_next' }),
      huntEnd: () => linkRef.current?.command({ t: 'hunt_end' }),
      momentNow: () => linkRef.current?.command({ t: 'moment_now' }),
      clipsClear: () => linkRef.current?.command({ t: 'clips_clear' }),
      helpRaise: () => linkRef.current?.command({ t: 'help_raise', ...(settings.tvOwner ? { who: settings.tvOwner } : {}) }),
      helpCancel: () => linkRef.current?.command({ t: 'help_cancel' }),
      reportChannel,
      newRoom: () => {
        forgetRoom();
        setAttempt((a) => a + 1);
      },
    }),
    [reportChannel, phase, error, room, link, speakers, version, replyStatus, hunt, scans, clips, objects, help, helpOpen, helpAsk, alerts, alertOpen, recoverAsk, recoverOpen, settings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
