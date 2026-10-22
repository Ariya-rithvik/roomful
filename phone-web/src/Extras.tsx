import { useEffect, useRef, useState } from 'react';
import { OBJECTS, OBJECT_LABELS, decideScan, scanOutcome, type HuntState, type ObjectLabel, type Scan } from '@roomcaption/shared';
import { cropObject, detectObjects, grabFrame, loadObjects, openCamera, stopStream, type Box, type Guess } from './vision';
import { Moments } from './moments';
import { Icon, Notice } from './Icon';

// ---------- Table Hunt ----------

type Step = { k: 'idle' } | { k: 'camera' } | { k: 'checking' } | { k: 'propose'; g: Guess } | { k: 'pick'; guesses: Guess[] } | { k: 'manual'; top: Guess | null } | { k: 'sent'; label: ObjectLabel };

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** Cream corner brackets of the viewfinder. */
function Brackets() {
  return (
    <span className="brackets" aria-hidden>
      <i className="tl" />
      <i className="tr" />
      <i className="bl" />
      <i className="br" />
    </span>
  );
}

/** The still frame the detector looked at, with its detection box when there is one. */
function FrozenFrame({ frame, box, label, small = false }: { frame: HTMLCanvasElement; box: Box | null; label?: string; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = frame.width;
    c.height = frame.height;
    c.getContext('2d')?.drawImage(frame, 0, 0);
  }, [frame]);
  const W = frame.width || 1;
  const H = frame.height || 1;
  const pct = (v: number, of: number) => `${Math.min(100, Math.max(0, (v / of) * 100))}%`;
  const maxVh = small ? 26 : 46;
  return (
    <div className={`frozen ${small ? 'small' : ''}`} style={{ aspectRatio: `${W} / ${H}`, maxWidth: `${(maxVh * W) / H}vh` }}>
      <canvas ref={ref} role="img" aria-label={label ? `The photo the phone took, with the ${label.toLowerCase()} marked` : 'The photo the phone took'} />
      {box && (
        <span className="det-box" style={{ left: pct(box.x, W), top: pct(box.y, H), width: pct(Math.min(box.w, W - box.x), W), height: pct(Math.min(box.h, H - box.y), H) }} aria-hidden>
          {label && <span className="det-chip">{label}</span>}
        </span>
      )}
      <Brackets />
    </div>
  );
}

/**
 * Scan a real object. During a Table Hunt the label counts for the round; at any time, the
 * confirmed object's cropped photo is sent to the family computer and pops up on the TV.
 */
export function HuntPanel({
  hunt, mySpeakerId, room, uploadToken, onScan,
}: {
  hunt: HuntState | null;
  mySpeakerId: string | null;
  room: string;
  uploadToken: string | null;
  onScan: (s: Omit<Scan, 't'>) => void;
}) {
  const [step, setStep] = useState<Step>({ k: 'idle' });
  const [err, setErr] = useState('');
  const [sentNote, setSentNote] = useState('');
  const [sentTone, setSentTone] = useState<'ok' | 'info' | 'warn'>('ok');
  /** The frozen frame shown while the person confirms (display only; frameRef drives the logic). */
  const [snap, setSnap] = useState<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const guessesRef = useRef<Guess[]>([]);
  const promptId = hunt?.prompt?.id;
  const playing = hunt?.status === 'playing' || hunt?.status === 'won';

  useEffect(() => () => stopStream(streamRef.current), []);
  // A new prompt starts a fresh scan.
  useEffect(() => {
    setStep({ k: 'idle' });
    setSnap(null);
    stopStream(streamRef.current);
    streamRef.current = null;
  }, [promptId]);

  const myPoints = hunt?.scores.find((s) => s.speakerId === mySpeakerId)?.points ?? 0;
  const iWon = hunt?.status === 'done' && hunt.winners.includes(mySpeakerId ?? '');
  const finished =
    hunt?.status === 'done' ? (
      <Notice tone={iWon ? 'ok' : 'info'} icon="trophy">
        Last hunt: {iWon ? 'you won!' : 'well played!'} You found {myPoints}.
      </Notice>
    ) : null;

  async function openCam() {
    setErr('');
    setSnap(null);
    try {
      const s = await openCamera('environment');
      streamRef.current = s;
      setStep({ k: 'camera' });
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
      });
      void loadObjects(); // warm up while the person aims
    } catch {
      setErr('Camera permission was refused, so pick the object from the list instead.');
      setStep({ k: 'manual', top: null });
    }
  }

  async function check() {
    if (!videoRef.current) return;
    setStep({ k: 'checking' });
    try {
      const det = await loadObjects();
      const frame = grabFrame(videoRef.current);
      frameRef.current = frame;
      setSnap(frame);
      const guesses = detectObjects(det, frame);
      guessesRef.current = guesses;
      const top = guesses[0] ?? null;
      const d = decideScan(top?.score ?? null);
      if (d === 'propose' && top) setStep({ k: 'propose', g: top });
      else if (d === 'pick') setStep({ k: 'pick', guesses: guesses.slice(0, 3) });
      else setStep({ k: 'manual', top });
    } catch {
      setErr('The object scanner did not load on this phone. Pick from the list.');
      setStep({ k: 'manual', top: null });
    }
  }

  function send(label: ObjectLabel, top: Guess | null) {
    if (hunt?.status === 'playing') {
      onScan({ label, outcome: scanOutcome(top?.label ?? null, label), ...(top ? { detected: top.label, conf: Math.round(top.score * 100) / 100 } : {}) });
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    setSentNote('');
    setSentTone('ok');
    setSnap(null);
    setStep({ k: 'sent', label });
    const frame = frameRef.current;
    frameRef.current = null;
    if (!frame || !mySpeakerId || !uploadToken) {
      if (hunt?.status !== 'playing') {
        setSentNote('A photo needs the camera, so nothing was shown on the TV.');
        setSentTone('info');
      }
      return;
    }
    const box = guessesRef.current.find((g) => g.label === label)?.box ?? null;
    void (async () => {
      try {
        const photo = await cropObject(frame, box);
        const q = new URLSearchParams({ room, speaker: mySpeakerId, label });
        const res = await fetch(`/api/objects?${q}`, { method: 'POST', body: photo, headers: { 'content-type': 'image/jpeg', 'x-rc-token': uploadToken } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSentNote(`Your ${OBJECTS[label].display.toLowerCase()} is on the TV now!`);
        setSentTone('ok');
      } catch (e) {
        setSentNote(`Could not send the photo (${(e as Error).message}).`);
        setSentTone('warn');
      }
    })();
  }

  const won = hunt?.status === 'won';
  const camOpen = step.k === 'camera' || step.k === 'checking';
  return (
    <div className="hunt">
      {playing ? (
        <div className="panel-head">
          <p className="eyebrow">
            <Icon name="trophy" size={16} />
            Table Hunt · round {hunt!.round} of {hunt!.total}
          </p>
          <h2 className="display">{hunt!.prompt?.text}</h2>
        </div>
      ) : (
        <div className="panel-head">
          <h2 className="title">Bring something real into the TV</h2>
          <p className="sub">Point the camera at a toy, cup, book, ball or fruit. After you confirm, a photo of just that object pops up on the TV.</p>
        </div>
      )}
      {finished}
      {won && (
        <Notice tone="ok" icon="sparkle" role="status">
          {hunt!.winners[0] === mySpeakerId ? 'You found it! Next round soon…' : 'Someone found it! Next round soon…'}
        </Notice>
      )}
      {err && (
        <Notice tone="warn" icon="alert" role="alert">
          {err}
        </Notice>
      )}

      {!won && step.k === 'idle' && (
        <div className="viewfinder idle" aria-hidden>
          <Brackets />
          <Icon name="camera" size={44} />
          <span>The camera opens here</span>
        </div>
      )}
      {step.k === 'sent' && (
        <div className={`sent-card ${sentTone}`} role="status">
          <span className="sent-ic">
            <Icon name={sentTone === 'warn' ? 'alert' : sentTone === 'info' ? 'info' : 'check'} size={28} />
          </span>
          <p>{sentNote || `Sent: ${OBJECTS[step.label].display}. Look at the TV!`}</p>
        </div>
      )}
      {!won && (step.k === 'idle' || step.k === 'sent') && (
        <button className="btn primary block" onClick={() => void openCam()}>
          <Icon name="camera" size={24} />
          {step.k === 'sent' ? 'Scan something else' : 'Scan an object'}
        </button>
      )}

      {camOpen && (
        <>
          <div className="viewfinder">
            <video ref={videoRef} className="cam" playsInline muted />
            <Brackets />
            {step.k === 'checking' && (
              <span className="vf-overlay" role="status">
                <Icon name="refresh" size={22} className="spin" />
                Looking…
              </span>
            )}
          </div>
          <button className="btn primary block" disabled={step.k === 'checking'} onClick={() => void check()}>
            <Icon name="sparkle" size={22} />
            {step.k === 'checking' ? 'Looking…' : 'Check this object'}
          </button>
          <p className="privacy-line">
            <Icon name="lock" size={16} />
            Nothing is sent until you confirm. Then only the cropped photo of the object and its name go to the family computer.
          </p>
        </>
      )}

      {step.k === 'propose' && (
        <>
          {snap && <FrozenFrame frame={snap} box={step.g.box} label={OBJECTS[step.g.label].display} />}
          <div className="sheet">
            <p className="ask-q">
              Is this {article(OBJECTS[step.g.label].display)} <strong>{OBJECTS[step.g.label].display.toLowerCase()}</strong>?
            </p>
            <button className="btn primary block" onClick={() => send(step.g.label, step.g)}>
              <Icon name="tv" size={22} />
              Yes, show it on the TV
            </button>
            <button className="btn outline block" onClick={() => setStep({ k: 'manual', top: step.g })}>
              No, something else
            </button>
            <p className="privacy-line">
              <Icon name="lock" size={16} />
              Only this cropped photo and its name are sent.
            </p>
          </div>
        </>
      )}
      {step.k === 'pick' && (
        <>
          {snap && <FrozenFrame frame={snap} box={null} small />}
          <div className="sheet">
            <p className="ask-q">Not sure. Which one is it?</p>
            <div className="choices">
              {step.guesses.map((g) => (
                <button key={g.label} className="btn choice" onClick={() => send(g.label, step.guesses[0])}>
                  {OBJECTS[g.label].display}
                </button>
              ))}
              <button className="btn outline choice" onClick={() => setStep({ k: 'manual', top: step.guesses[0] })}>
                Something else
              </button>
            </div>
            <p className="privacy-line">
              <Icon name="lock" size={16} />
              Only this cropped photo and its name are sent.
            </p>
          </div>
        </>
      )}
      {step.k === 'manual' && (
        <>
          {snap && <FrozenFrame frame={snap} box={null} small />}
          <div className="sheet">
            <p className="ask-q">{step.top ? 'Pick what you are holding:' : 'I could not tell. Pick what you are holding:'}</p>
            <div className="choices">
              {OBJECT_LABELS.map((l) => (
                <button key={l} className="btn choice" onClick={() => send(l, step.top)}>
                  {OBJECTS[l].display}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Happy moments ----------

export interface MomentsHandle {
  record: () => void;
}

export function MomentsPanel({
  room, speakerId, uploadToken, serverTime, handleRef,
}: {
  room: string;
  speakerId: string | null;
  uploadToken: string | null;
  serverTime: (local: number) => number;
  handleRef: React.MutableRefObject<MomentsHandle | null>;
}) {
  const [on, setOn] = useState(false);
  const [smile, setSmile] = useState<number | null>(null);
  const [saved, setSaved] = useState(0);
  const [msg, setMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const momentsRef = useRef<Moments | null>(null);

  useEffect(
    () => () => {
      momentsRef.current?.stop();
      handleRef.current = null;
    },
    [handleRef],
  );

  async function toggle(next: boolean) {
    setMsg('');
    if (!next) {
      momentsRef.current?.stop();
      momentsRef.current = null;
      handleRef.current = null;
      setOn(false);
      setSmile(null);
      return;
    }
    if (!speakerId || !uploadToken || !videoRef.current) return;
    const m = new Moments({
      room, speakerId, uploadToken, serverTime,
      onSmile: setSmile,
      onSaved: (reason) => {
        setSaved((n) => n + 1);
        setMsg(reason === 'smile' ? 'Saved a happy moment.' : 'Saved the moment the TV asked for.');
      },
      onError: setMsg,
    });
    try {
      await m.start(videoRef.current);
      momentsRef.current = m;
      handleRef.current = { record: () => void m.record('manual') };
      setOn(true);
    } catch (e) {
      m.stop();
      setMsg((e as Error).message.includes('Permission') || (e as Error).name === 'NotAllowedError' ? 'Camera permission was refused.' : (e as Error).message);
    }
  }

  const unavailable = !speakerId ? 'Available once this phone is connected to the TV.' : !uploadToken ? 'This family server does not accept moments.' : '';
  const pct = Math.round((smile ?? 0) * 100);

  return (
    <div className="moments">
      <div className="panel-head">
        <h2 className="title">Save the evening's smiles</h2>
        <p className="sub">When the kids show ends, the TV plays a short family break of tonight's smiles.</p>
      </div>
      <ul className="card icon-rows">
        <li>
          <span className="row-ic">
            <Icon name="smile" />
          </span>
          <p>When someone at the table smiles, this phone saves a 4-second clip (no sound) to the family computer.</p>
        </li>
        <li>
          <span className="row-ic">
            <Icon name="tv" />
          </span>
          <p>The TV can play the evening's happy moments with what was said.</p>
        </li>
        <li>
          <span className="row-ic">
            <Icon name="shield" />
          </span>
          <p>Off unless you switch it on. Clips are deleted when the room closes or from the TV.</p>
        </li>
      </ul>

      <label className={`switch-row ${on ? 'on' : ''} ${unavailable ? 'disabled' : ''}`}>
        <span className="switch-text">
          <b>Save happy moments</b>
          <span>{on ? 'On · front camera is watching for smiles' : 'Off · uses the front camera'}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} onChange={(e) => void toggle(e.target.checked)} disabled={!speakerId || !uploadToken} />
      </label>
      {unavailable && <p className="footnote">{unavailable}</p>}

      <div className={`selfie ${on ? '' : 'hidden'}`}>
        <video ref={videoRef} className="cam small-cam" playsInline muted />
        <span className="live-tag">
          <Icon name="smile" size={14} /> Watching for smiles
        </span>
      </div>
      {on && (
        <div className="card meter-card">
          <div className="meter-head">
            <span className="label">Smile</span>
            <span className="meter-value">{smile === null ? 'No face' : `${pct}%`}</span>
          </div>
          <div className="meter" role="meter" aria-label="Smile" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <p className="small">
            {smile === null ? 'No face in view — prop the phone up facing the table.' : `Smile ${pct}%`} · saved {saved}
          </p>
          <button className="btn outline block" onClick={() => void momentsRef.current?.record('manual')}>
            <Icon name="sparkle" size={22} />
            Save a moment now
          </button>
        </div>
      )}
      {msg && (
        <Notice tone="info" icon="info" role="status">
          {msg}
        </Notice>
      )}
    </div>
  );
}
