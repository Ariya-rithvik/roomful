import { useEffect, useRef, useState } from 'react';
import type { HelpState } from '@roomcaption/shared';
import { Icon } from './Icon';

/**
 * Help alert on every phone: full screen, loud, vibrating, until someone taps "I'm coming".
 * It alerts family; it does not call emergency services, so "Call 112" is always one tap away.
 */
export function HelpAlert({ help, myName, onAck, onCancel }: { help: HelpState; myName: string; onAck: () => void; onCancel: () => void }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(false);
  const askedByMe = help.byName === myName;
  const ringing = help.status === 'active' && !askedByMe && !muted;

  // Alarm: a two-tone beep every second plus vibration, while nobody has answered.
  useEffect(() => {
    if (!ringing) return;
    const beep = () => {
      try {
        const ctx = (ctxRef.current ??= new AudioContext());
        void ctx.resume();
        for (const [f, at] of [[880, 0], [660, 0.25]] as const) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
          g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + at + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + at);
          o.stop(ctx.currentTime + at + 0.24);
        }
      } catch {
        /* audio blocked until the page is touched: vibration and the screen still alert */
      }
      navigator.vibrate?.([300, 150, 300]);
    };
    beep();
    const t = window.setInterval(beep, 1000);
    return () => window.clearInterval(t);
  }, [ringing, help.alerts]);

  const who = help.byName ?? 'Someone at the TV';
  const minutes = help.since ? Math.max(0, Math.round((Date.now() - help.since) / 60000)) : 0;

  return (
    <div className={`help-alert ${help.status === 'coming' ? 'coming' : ''}`} role="alertdialog" aria-live="assertive">
      {help.status === 'active' ? (
        <>
          <span className="help-ic" aria-hidden>
            <Icon name="bell" size={56} />
          </span>
          <div className="help-big">{askedByMe ? 'Help is being called' : `${who} needs help`}</div>
          <p className="help-sub">
            {askedByMe ? 'Your family is being alerted now.' : 'They asked from the living room TV.'} {minutes > 0 ? `${minutes} min ago.` : 'Just now.'}
            {help.alerts > 1 ? ` Alert ${help.alerts}: nobody has answered yet.` : ''}
          </p>
          {!askedByMe && (
            <button className="help-btn go" onClick={onAck}>
              <Icon name="check" size={30} />
              I'm coming
            </button>
          )}
          <a className="help-btn call" href="tel:112">
            <Icon name="phone" size={24} />
            Call 112 (emergency)
          </a>
          {askedByMe ? (
            <button className="help-btn soft" onClick={onCancel}>
              <Icon name="close" size={22} />
              I'm OK, cancel
            </button>
          ) : (
            <button className="help-btn soft" onClick={() => setMuted(true)} disabled={muted}>
              <Icon name="mute" size={22} />
              {muted ? 'Sound off on this phone' : 'Silence this phone'}
            </button>
          )}
        </>
      ) : (
        <>
          <span className="help-ic" aria-hidden>
            <Icon name="check" size={56} />
          </span>
          <div className="help-big">{help.comingName ?? 'Someone'} is coming</div>
          <p className="help-sub">{askedByMe ? 'Help is on the way.' : `${who} asked for help. The TV shows that help is on the way.`}</p>
          <button className="help-btn soft" onClick={onCancel}>
            <Icon name="check" size={22} />
            All OK now, close
          </button>
        </>
      )}
      <p className="help-note">This alerts your family only. In an emergency, call 112.</p>
    </div>
  );
}
