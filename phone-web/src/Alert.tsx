import { useEffect, useRef } from 'react';
import type { DisasterAlert } from '@roomcaption/shared';

const KIND: Record<string, string> = { FL: 'Flood', EQ: 'Earthquake', TC: 'Cyclone', VO: 'Volcano', DR: 'Drought', WF: 'Forest fire', TS: 'Tsunami' };

/**
 * Disaster alert on the phone: full screen with an alarm and vibration until "Got it". The same
 * alert is on the family TV. It comes from GDACS (or is a clearly labelled TEST drill).
 */
export function DisasterAlertView({ alert, onDone }: { alert: DisasterAlert; onDone: () => void }) {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const beep = () => {
      try {
        const ctx = (ctxRef.current ??= new AudioContext());
        void ctx.resume();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(740, ctx.currentTime);
        o.frequency.setValueAtTime(980, ctx.currentTime + 0.3);
        g.gain.setValueAtTime(0.25, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.62);
      } catch {
        /* audio needs one tap on the page first; vibration and the screen still alert */
      }
      navigator.vibrate?.([500, 200, 500]);
    };
    beep();
    const t = window.setInterval(beep, 1500);
    return () => window.clearInterval(t);
  }, [alert.id]);

  return (
    <div className={`disaster ${alert.level === 'Red' ? 'red' : ''}`} role="alertdialog" aria-live="assertive">
      {alert.test && <div className="disaster-test">TEST — drill, not a real alert</div>}
      <div className="disaster-kicker">
        {alert.level} alert · {KIND[alert.kind] ?? 'Disaster'} · {alert.country}
      </div>
      <div className="disaster-title">{alert.title}</div>
      <p className="disaster-why">Why you're seeing this: {alert.why}</p>
      <p className="disaster-advice">Check official local advice now. If you are told to move to safety, go. The family TV shows the same alert.</p>
      {alert.url && (
        <a className="help-btn soft" href={alert.url} target="_blank" rel="noreferrer">
          Details on gdacs.org
        </a>
      )}
      <button className="help-btn go" onClick={onDone}>
        Got it
      </button>
      <p className="help-note">Source: {alert.source === 'GDACS' ? 'GDACS — Global Disaster Alert and Coordination System' : alert.source}</p>
    </div>
  );
}
