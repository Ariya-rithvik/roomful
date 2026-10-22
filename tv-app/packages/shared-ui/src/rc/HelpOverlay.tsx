import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { scaledPixels as sp } from '../hooks/useScale';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { useBackOverride } from '../app/remote-control/GoBackConfiguration';
import { useRoom } from './RoomContext';
import { FONTS } from './theme';

const COUNTDOWN_S = 5;

/**
 * Help mode on the TV, over every screen. Press ☰ (Menu) on the remote, or "I need help" on the
 * home screen: a 5-second countdown (OK = send now, Back = cancel) so a stray press does not alarm
 * everyone, then every family phone rings until someone answers "I'm coming", and the TV shows who.
 * It alerts family only; the screen always says to call 112 in an emergency.
 */
export function HelpOverlay() {
  const { help, helpOpen, setHelpOpen, helpRaise, helpCancel, speakers, phase, helpAsk } = useRoom();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const active = help?.status === 'active' || help?.status === 'coming';
  const ref = useRef({ countdown, active, confirmCancel });
  ref.current = { countdown, active, confirmCancel };

  // The overlay is "open" (and the screen underneath ignores the remote) during the countdown or an active request.
  useEffect(() => setHelpOpen(countdown !== null || active), [countdown, active, setHelpOpen]);

  // An on-screen "I need help" button asks for the same countdown as the ☰ key.
  const firstAsk = useRef(helpAsk);
  useEffect(() => {
    if (helpAsk !== firstAsk.current && !ref.current.active) setCountdown(COUNTDOWN_S);
  }, [helpAsk]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      helpRaise();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, helpRaise]);

  useEffect(() => {
    if (!confirmCancel) return;
    const t = setTimeout(() => setConfirmCancel(false), 4000);
    return () => clearTimeout(t);
  }, [confirmCancel]);

  // Remote: ☰ starts help from anywhere; OK sends now / cancels (twice) ; Back cancels the countdown.
  useEffect(() => {
    const listener = RemoteControlManager.addKeydownListener((k) => {
      const { countdown: c, active: a, confirmCancel: cc } = ref.current;
      if (k === SupportedKeys.Menu) {
        if (!a && c === null && phase === 'ready') setCountdown(COUNTDOWN_S);
        return;
      }
      if (k !== SupportedKeys.Enter) return;
      if (c !== null) {
        setCountdown(null);
        helpRaise();
      } else if (a) {
        if (cc) {
          setConfirmCancel(false);
          helpCancel();
        } else setConfirmCancel(true);
      }
    });
    return () => RemoteControlManager.removeKeydownListener(listener);
  }, [helpRaise, helpCancel, phase]);

  useBackOverride(() => setCountdown(null), countdown !== null);
  // While help is active, Back must not leave it by accident: it is swallowed.
  useBackOverride(() => {}, active && countdown === null);

  if (!helpOpen && countdown === null && !active) return null;

  const others = speakers.filter((s) => s.connected).map((s) => s.name);
  const coming = help?.status === 'coming';

  return (
    <View style={[styles.wrap, coming ? styles.ok : styles.alarm]} pointerEvents="none">
      {countdown !== null ? (
        <>
          <Text style={styles.big}>Calling your family in {countdown}…</Text>
          <Text style={styles.sub}>Every phone in the family will ring.</Text>
          <View style={styles.keys}>
            <Key k="OK" label="Call them now" />
            <Key k="Back" label="Cancel" />
          </View>
        </>
      ) : coming ? (
        <>
          <Text style={styles.big}>{help?.comingName ?? 'Someone'} is coming</Text>
          <Text style={styles.sub}>Help is on the way.</Text>
          <View style={styles.keys}>
            <Key k="OK" label={confirmCancel ? 'Press OK again to close' : 'All OK now'} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.big}>Your family is being called</Text>
          <Text style={styles.sub}>
            {others.length ? `Alerting ${others.join(', ')}.` : 'No phones are connected right now: nobody can be alerted from this TV.'}
            {help && help.alerts > 1 ? `  Alert ${help.alerts}: nobody has answered yet.` : ''}
          </Text>
          <View style={styles.keys}>
            <Key k="OK" label={confirmCancel ? 'Press OK again to cancel' : "I'm OK, cancel"} />
          </View>
        </>
      )}
      <Text style={styles.note}>This alerts your family only. In an emergency, call 112.</Text>
    </View>
  );
}

function Key({ k, label }: { k: string; label: string }) {
  return (
    <View style={styles.key}>
      <View style={styles.cap}>
        <Text style={styles.capText}>{k}</Text>
      </View>
      <Text style={styles.keyLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, zIndex: 200, alignItems: 'center', justifyContent: 'center', padding: sp(90) },
  alarm: { backgroundColor: 'rgba(110, 22, 14, 0.96)' },
  ok: { backgroundColor: 'rgba(16, 70, 34, 0.96)' },
  big: { color: '#FFFFFF', fontSize: sp(96), fontFamily: FONTS.bold, textAlign: 'center' },
  sub: { color: '#FFE2DC', fontSize: sp(40), marginTop: sp(18), textAlign: 'center' },
  keys: { flexDirection: 'row', gap: sp(64), marginTop: sp(56) },
  key: { flexDirection: 'row', alignItems: 'center', gap: sp(18) },
  cap: { minWidth: sp(96), height: sp(72), borderRadius: sp(14), borderWidth: sp(4), borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp(14) },
  capText: { color: '#FFFFFF', fontSize: sp(32), fontFamily: FONTS.bold },
  keyLabel: { color: '#FFFFFF', fontSize: sp(40), fontFamily: FONTS.bold },
  note: { position: 'absolute', bottom: sp(60), color: '#FFD1C9', fontSize: sp(30) },
});
