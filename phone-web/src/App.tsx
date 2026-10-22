import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { LANGS, isRoomCode, type ChannelPlay, type DisasterAlert, type Engine, type HelpState, type HuntState, type Lang, type ServerToPhone } from '@roomcaption/shared';
import { Link, nowEpoch, type LinkStatus } from './link';
import { Recognizer, recognitionSupported, type Heard, type RecognizerState } from './recognizer';
import { AudioStreamer } from './audioStream';
import { HuntPanel, MomentsPanel, type MomentsHandle } from './Extras';
import { HelpAlert } from './Help';
import { DisasterAlertView } from './Alert';
import { ListenPanel } from './Listen';
import { Icon, Notice, type IconName } from './Icon';

const LANG_LABEL: Record<Lang, string> = { 'en-IN': 'English', 'hi-IN': 'हिन्दी (Hindi)', 'ta-IN': 'தமிழ் (Tamil)' };
/** Language cards on the join screen: the language's own script big, its English name small. */
const LANG_CARD: Record<Lang, { native: string; english: string }> = {
  'en-IN': { native: 'English', english: 'English (India)' },
  'hi-IN': { native: 'हिन्दी', english: 'Hindi' },
  'ta-IN': { native: 'தமிழ்', english: 'Tamil' },
};

function store(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: fine */
  }
}
function clientId(): string {
  let id = store('rc.clientId');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    id = 'c_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    save('rc.clientId', id);
  }
  return id;
}
function roomFromPath(): string {
  const m = /^\/join\/([A-Z0-9]{4})\/?$/.exec(location.pathname);
  return m && isRoomCode(m[1]) ? m[1] : '';
}
/** First letter of a name for the avatar (first code point, so Hindi and Tamil names work). */
function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase();
}

interface Joined { room: string; name: string; lang: Lang; engine: Engine }

export function App() {
  const [joined, setJoined] = useState<Joined | null>(null);
  return joined ? <Live {...joined} onLeave={() => setJoined(null)} /> : <JoinForm onJoin={setJoined} />;
}

function JoinForm({ onJoin }: { onJoin: (j: Joined) => void }) {
  const [room, setRoom] = useState(roomFromPath());
  const [name, setName] = useState(store('rc.name'));
  const [lang, setLang] = useState<Lang>((LANGS as readonly string[]).includes(store('rc.lang')) ? (store('rc.lang') as Lang) : 'en-IN');
  const [engine, setEngine] = useState<Engine>('device');
  const [serverSpeech, setServerSpeech] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { speech?: string | null; capturing?: boolean }) => {
        setServerSpeech(h.speech ?? null);
        setCapturing(h.capturing === true);
      })
      .catch(() => setServerSpeech(null));
  }, []);

  const deviceOk = recognitionSupported();
  const secure = window.isSecureContext;
  const canJoin = isRoomCode(room) && name.trim().length > 0 && consent && secure && (engine === 'server' || deviceOk);
  const pathRoom = roomFromPath();
  const missing = [!isRoomCode(room) && 'the room code from the TV', !name.trim() && 'your name', !consent && 'tick “I agree”'].filter(Boolean) as string[];

  return (
    <main className="page join">
      <header className="hero">
        <div className="wordmark">
          Roomful<span className="dot">.</span>
        </div>
        <p className="tagline">Everyone at the table, on the TV.</p>
        <p className="lead">Join the family TV from this phone. No app to install.</p>
        <ul className="ways" aria-label="What this phone can do">
          <li>
            <span className="way-ic">
              <Icon name="mic" size={22} />
            </span>
            <b>Talk</b>
            <span>Your words in big captions</span>
          </li>
          <li>
            <span className="way-ic">
              <Icon name="camera" size={22} />
            </span>
            <b>Show</b>
            <span>Real things pop up on the TV</span>
          </li>
          <li>
            <span className="way-ic">
              <Icon name="smile" size={22} />
            </span>
            <b>Smile</b>
            <span>Tonight's happy moments</span>
          </li>
        </ul>
        {pathRoom && (
          <p className="room-badge">
            <Icon name="tv" size={18} /> Joining room <b>{pathRoom}</b>
          </p>
        )}
      </header>

      {!secure && (
        <Notice tone="warn" icon="lock" role="alert">
          This page is not secure (no HTTPS), so the microphone is blocked. Open the link from the TV's QR code.
        </Notice>
      )}
      {secure && !deviceOk && engine === 'device' && (
        <Notice tone="warn" icon="alert" role="alert">
          This browser cannot recognise speech. Please open this page in Chrome.
        </Notice>
      )}

      <form
        className="join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canJoin) return;
          save('rc.name', name.trim());
          save('rc.lang', lang);
          onJoin({ room, name: name.trim(), lang, engine });
        }}
      >
        {!pathRoom && (
          <label className="field">
            <span className="field-label">Room code on the TV</span>
            <input
              className="input code"
              value={room}
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="K7QM"
              onChange={(e) => setRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">Your name</span>
          <input className="input" value={name} maxLength={24} autoComplete="given-name" onChange={(e) => setName(e.target.value)} placeholder="e.g. Meena" />
          <span className="field-hint">Shown on the TV next to what you say.</span>
        </label>

        <fieldset className="field">
          <legend className="field-label">I will speak in</legend>
          <div className="lang-cards">
            {LANGS.map((l) => (
              <label key={l} className={`choice-card lang-card ${lang === l ? 'on' : ''}`}>
                <input type="radio" name="lang" value={l} checked={lang === l} onChange={() => setLang(l)} />
                <span className="native" lang={l}>
                  {LANG_CARD[l].native}
                </span>
                <span className="english">{LANG_CARD[l].english}</span>
                <span className="tick" aria-hidden>
                  <Icon name="check" size={16} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {serverSpeech && (
          <fieldset className="field">
            <legend className="field-label">Speech recognition</legend>
            <div className="stack-cards">
              {(
                [
                  ['device', 'On this phone'],
                  ['server', 'On the family server (Amazon Transcribe)'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className={`choice-card row-card ${engine === v ? 'on' : ''}`}>
                  <input type="radio" name="engine" value={v} checked={engine === v} onChange={() => setEngine(v)} />
                  <span className="radio-dot" aria-hidden />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <section className="card consent" aria-labelledby="consent-title">
          <h2 id="consent-title" className="card-title">
            Before you join
          </h2>
          <ul className="icon-rows">
            <li>
              <span className="row-ic">
                <Icon name="mic" />
              </span>
              <p>
                {engine === 'device'
                  ? "Your speech is turned into text by this phone's built-in speech recognition. In Chrome that is Google's online service."
                  : 'Your voice is sent to the family server and to Amazon Transcribe to be turned into text.'}
              </p>
            </li>
            <li>
              <span className="row-ic">
                <Icon name="tv" />
              </span>
              <p>It is shown on the TV in your home. You can stop at any time.</p>
            </li>
            <li className={capturing ? 'measure' : ''}>
              <span className="row-ic">
                <Icon name={capturing ? 'alert' : 'shield'} />
              </span>
              <p>
                {capturing
                  ? 'This is a measurement session: the caption text is saved on the family computer to check accuracy. Your voice is not recorded.'
                  : 'Roomful does not record your voice or save the captions. Only timing numbers are kept, to measure speed.'}
              </p>
            </li>
          </ul>
          <label className={`agree ${consent ? 'on' : ''}`}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="box" aria-hidden>
              <Icon name="check" size={22} />
            </span>
            <span>I agree</span>
          </label>
        </section>

        <button type="submit" className="btn primary block" disabled={!canJoin}>
          {isRoomCode(room) ? `Join room ${room}` : 'Join'}
          <Icon name="arrow" size={22} />
        </button>
        {secure && missing.length > 0 && <p className="join-hint">Still needed: {missing.join(', ')}.</p>}
      </form>
    </main>
  );
}

function Live({ room, name, lang, engine: wantedEngine, onLeave }: Joined & { onLeave: () => void }) {
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState('');
  const [me, setMe] = useState<{ speakerId: string; color: string } | null>(null);
  const [engine, setEngine] = useState<Engine>(wantedEngine);
  const [mode, setMode] = useState<'always' | 'hold'>(store('rc.mode') === 'hold' ? 'hold' : 'always');
  const [rec, setRec] = useState<RecognizerState>('idle');
  const [problem, setProblem] = useState('');
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<{ text: string; final: boolean } | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);

  const linkRef = useRef<Link | null>(null);
  const recRef = useRef<Recognizer | null>(null);
  const streamRef = useRef<AudioStreamer | null>(null);
  const wakeRef = useRef<{ release(): Promise<void> } | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [hunt, setHunt] = useState<HuntState | null>(null);
  const [help, setHelp] = useState<HelpState | null>(null);
  const [alerts, setAlerts] = useState<DisasterAlert[]>([]);
  const [seenAlerts, setSeenAlerts] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('rc.seenAlerts') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const openAlert = alerts.find((a) => !seenAlerts.includes(a.id)) ?? null;
  const [tab, setTab] = useState<'talk' | 'hunt' | 'moments'>('talk');
  const [channels, setChannels] = useState<ChannelPlay[]>([]);
  const serverNow = useCallback(() => linkRef.current?.serverTime(nowEpoch()) ?? Date.now(), []);
  const momentsHandle = useRef<MomentsHandle | null>(null);

  useEffect(() => {
    const onHeard = (h: Heard) => {
      setHeard({ text: h.text, final: h.final });
      const link = linkRef.current;
      if (!link) return;
      link.sendCaption({
        utt: h.utt % 2 ** 31, seq: 0, text: h.text.slice(0, 500), final: h.final, lang,
        tStart: link.serverTime(h.startedAt), ...(h.conf !== undefined ? { conf: Math.min(1, Math.max(0, h.conf)) } : {}),
      });
    };
    const recognizer = new Recognizer(lang, nowEpoch, onHeard, (s, detail) => {
      setRec(s);
      if (s === 'error') setProblem(detail ?? 'Speech recognition stopped.');
      if (s === 'listening') setProblem('');
    });
    recRef.current = recognizer;

    const onMessage = (m: ServerToPhone) => {
      if (m.t === 'welcome') {
        setMe({ speakerId: m.speakerId, color: m.color });
        setUploadToken(m.uploadToken ?? null);
      } else if (m.t === 'hunt') {
        setHunt((prev) => {
          // A newly started hunt brings its tab forward.
          if (m.status === 'playing' && (!prev || prev.status === 'idle' || prev.status === 'done')) setTab('hunt');
          return m;
        });
      } else if (m.t === 'alert') {
        setAlerts((a) => (a.some((x) => x.id === m.id) ? a : [...a, m]));
      } else if (m.t === 'help') {
        setHelp(m);
      } else if (m.t === 'channels') {
        setChannels(m.channels);
      } else if (m.t === 'moment_request') {
        momentsHandle.current?.record();
      } else if (m.t === 'error' && m.code === 'engine_unavailable') {
        streamRef.current?.stop();
        streamRef.current = null;
        setEngine('device');
        setProblem('Server speech recognition is not available, so this phone recognises your speech instead.');
      } else if (m.t === 'play') {
        setSpeaking(m.text);
        recognizer.pause();
        streamRef.current?.stop();
        const audio = new Audio(m.url);
        const done = () => {
          setSpeaking(null);
          recognizer.resume();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      }
    };
    const link = new Link({
      room, clientId: clientId(), name, lang, engine: wantedEngine, onMessage,
      onStatus: (s, detail) => {
        setStatus(s);
        setStatusDetail(detail ?? '');
      },
    });
    linkRef.current = link;
    link.start();
    return () => {
      recognizer.stop();
      streamRef.current?.stop();
      link.stop();
      void wakeRef.current?.release().catch(() => {});
    };
  }, [room, name, lang, wantedEngine]);

  async function keepAwake(on: boolean) {
    try {
      if (on && !wakeRef.current && 'wakeLock' in navigator) {
        wakeRef.current = await (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen');
      } else if (!on && wakeRef.current) {
        await wakeRef.current.release();
        wakeRef.current = null;
      }
    } catch {
      /* not supported: the phone may sleep; the page says so */
    }
  }

  async function startListening() {
    setProblem('');
    if (engine === 'server' && meRef.current) {
      const s = new AudioStreamer(room, meRef.current.speakerId, (why) => {
        setProblem(`Server audio stopped (${why}). Using this phone instead.`);
        setEngine('device');
        recRef.current?.start();
      });
      streamRef.current = s;
      try {
        await s.start();
        setRec('listening');
      } catch {
        setProblem('Microphone permission was refused. Allow the microphone for this site and try again.');
        return;
      }
    } else {
      recRef.current?.start();
    }
    setListening(true);
    void keepAwake(true);
  }

  function stopListening() {
    recRef.current?.stop();
    streamRef.current?.stop();
    streamRef.current = null;
    setListening(false);
    setRec('idle');
    void keepAwake(false);
  }

  function setModeAndSave(m: 'always' | 'hold') {
    stopListening();
    setMode(m);
    save('rc.mode', m);
  }

  const connected = status === 'joined';
  const huntOn = !!hunt && (hunt.status === 'playing' || hunt.status === 'won');

  // Status pill: an icon and a word for every state, never colour alone.
  const pill: { tone: 'ok' | 'wait' | 'bad' | 'info'; icon: IconName; text: string; spin?: boolean } =
    status === 'joined'
      ? listening
        ? rec === 'paused'
          ? { tone: 'ok', icon: 'sound', text: 'Paused' }
          : { tone: 'ok', icon: 'mic', text: 'Listening — speak normally' }
        : { tone: 'ok', icon: 'check', text: 'Connected to the TV' }
      : status === 'connecting'
        ? { tone: 'wait', icon: 'refresh', text: 'Connecting…', spin: true }
        : status === 'reconnecting'
          ? { tone: 'wait', icon: 'refresh', text: 'Connection lost — reconnecting…', spin: true }
          : status === 'closed'
            ? { tone: 'bad', icon: 'close', text: 'Disconnected' }
            : status === 'rejected'
              ? { tone: 'bad', icon: 'alert', text: statusDetail || 'The TV did not accept this phone.' }
              : { tone: 'info', icon: 'info', text: statusDetail };

  const micCaption = !connected
    ? 'Not connected to the TV'
    : mode === 'always'
      ? listening
        ? rec === 'paused'
          ? 'Paused while your reply plays'
          : 'Listening, tap to stop'
        : 'Tap to talk'
      : listening
        ? 'Listening… release to stop'
        : 'Hold to talk';

  const tabs: [typeof tab, IconName, string][] = [
    ['talk', 'mic', 'Talk'],
    ['hunt', 'camera', 'Show'],
    ['moments', 'smile', 'Smile'],
  ];

  return (
    <main className="page live" style={{ '--me': me?.color ?? 'var(--accent)' } as CSSProperties}>
      <header className="topbar">
        <span className={`avatar ${me ? '' : 'pending'}`} style={me ? { background: me.color } : undefined} aria-hidden>
          {initialOf(name)}
        </span>
        <div className="who">
          <strong>{name}</strong>
          <span className="small">
            Room {room} · {LANG_LABEL[lang]}
          </span>
        </div>
        <button
          className="btn help-trigger"
          disabled={!connected}
          onClick={() => {
            if (window.confirm('Send a help alert to everyone in the family now?')) linkRef.current?.sendHelp('help_raise');
          }}
        >
          <Icon name="bell" size={20} />
          Need help
        </button>
        <button
          className="btn ghost leave"
          aria-label="Leave"
          title="Leave"
          onClick={() => {
            stopListening();
            onLeave();
          }}
        >
          <Icon name="leave" size={20} />
          <span className="leave-label">Leave</span>
        </button>
      </header>
      {openAlert && (
        <DisasterAlertView
          alert={openAlert}
          onDone={() =>
            setSeenAlerts((s) => {
              const next = [...s, openAlert.id].slice(-50);
              try {
                localStorage.setItem('rc.seenAlerts', JSON.stringify(next));
              } catch {
                /* private mode */
              }
              return next;
            })
          }
        />
      )}
      {help && help.status !== 'idle' && (
        <HelpAlert help={help} myName={name} onAck={() => linkRef.current?.sendHelp('help_ack')} onCancel={() => linkRef.current?.sendHelp('help_cancel')} />
      )}

      <div className="status-row">
        <p className={`status ${pill.tone}`} role="status">
          <Icon name={pill.icon} size={18} className={pill.spin ? 'spin' : undefined} />
          <span>{pill.text}</span>
        </p>
      </div>
      {status === 'ended' && (
        <button className="btn primary block" onClick={() => (location.href = '/')}>
          Join the new room
          <Icon name="arrow" size={22} />
        </button>
      )}
      {problem && (
        <Notice tone="warn" icon="alert" role="alert">
          {problem}
        </Notice>
      )}
      {speaking && (
        <Notice tone="speaking" icon="sound" role="status">
          Speaking your reply: “{speaking}”
        </Notice>
      )}

      <section id="panel-hunt" role="tabpanel" aria-labelledby="tab-hunt" className={tab === 'hunt' ? 'panel' : 'panel hidden'}>
        <HuntPanel hunt={hunt} mySpeakerId={me?.speakerId ?? null} room={room} uploadToken={uploadToken} onScan={(s) => linkRef.current?.sendScan(s)} />
      </section>
      {/* Kept mounted on every tab so the camera keeps watching while you talk. */}
      <section id="panel-moments" role="tabpanel" aria-labelledby="tab-moments" className={tab === 'moments' ? 'panel' : 'panel hidden'}>
        <MomentsPanel room={room} speakerId={me?.speakerId ?? null} uploadToken={uploadToken} serverTime={(t) => linkRef.current?.serverTime(t) ?? t} handleRef={momentsHandle} />
      </section>

      <section id="panel-talk" role="tabpanel" aria-labelledby="tab-talk" className={tab === 'talk' ? 'panel talk' : 'panel talk hidden'}>
        <div className="mic-wrap">
          {mode === 'always' ? (
            <button
              className={`mic ${listening ? 'on' : ''} ${rec === 'paused' ? 'paused' : ''}`}
              disabled={!connected}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              aria-pressed={listening}
              onClick={() => (listening ? stopListening() : void startListening())}
            >
              <Icon name={listening ? 'stop' : 'mic'} size={56} filled={listening} />
            </button>
          ) : (
            <button
              className={`mic hold ${listening ? 'on' : ''}`}
              disabled={!connected}
              aria-label={listening ? 'Listening… release to stop' : 'Hold to talk'}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                void startListening();
              }}
              onPointerUp={stopListening}
              onPointerCancel={stopListening}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Icon name="mic" size={56} filled={listening} />
            </button>
          )}
          <p className="mic-caption" aria-hidden>
            {micCaption}
          </p>
        </div>

        <button className="missed-btn" disabled={!connected} onClick={() => linkRef.current?.sendHelp('missed')}>
          I missed that — show the last minute on the TV
        </button>
        <ListenPanel channels={channels} serverNow={serverNow} />
        <div className={`card heard ${heard && !heard.final ? 'is-partial' : ''}`} aria-live="polite">
          <div className="label-row">
            <Icon name="tv" size={16} />
            <span className="label">{connected ? 'On the TV now' : 'Heard on this phone'}</span>
          </div>
          {heard ? (
            <p className={`heard-text ${heard.final ? '' : 'partial'}`} lang={lang}>
              {heard.text}
            </p>
          ) : (
            <p className="heard-empty">What you say appears here and on the TV.</p>
          )}
        </div>

        <fieldset className="field mode">
          <legend className="label">How should this phone listen?</legend>
          <div className="mode-cards">
            <label className={`choice-card mode-card ${mode === 'always' ? 'on' : ''}`}>
              <input type="radio" name="listen-mode" checked={mode === 'always'} onChange={() => setModeAndSave('always')} />
              <Icon name="mic" size={22} />
              <b>Always</b>
              <span>Phone near you on the table</span>
            </label>
            <label className={`choice-card mode-card ${mode === 'hold' ? 'on' : ''}`}>
              <input type="radio" name="listen-mode" checked={mode === 'hold'} onChange={() => setModeAndSave('hold')} />
              <Icon name="hand" size={22} />
              <b>Hold to talk</b>
              <span>Best when people talk over each other</span>
            </label>
          </div>
        </fieldset>
        <p className="footnote">Keep this screen open while you talk. Engine: {engine === 'device' ? 'this phone' : 'family server'}.</p>
      </section>

      <nav className="tabbar" role="tablist" aria-label="Ways onto the TV">
        {tabs.map(([k, icon, label]) => (
          <button key={k} id={`tab-${k}`} role="tab" aria-selected={tab === k} aria-controls={`panel-${k}`} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>
            <span className="tab-pill">
              <Icon name={icon} size={26} filled={tab === k} />
              {k === 'hunt' && huntOn && <span className="tab-dot" aria-hidden />}
            </span>
            <span className="tab-label">{label}</span>
            {k === 'hunt' && huntOn && <span className="sr-only">, Table Hunt is on</span>}
          </button>
        ))}
      </nav>
    </main>
  );
}
