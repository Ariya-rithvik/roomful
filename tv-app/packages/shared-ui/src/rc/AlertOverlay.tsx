import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { DisasterAlert } from '@roomcaption/shared';
import { scaledPixels as sp } from '../hooks/useScale';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { useRoom } from './RoomContext';
import { FONTS } from './theme';

const KIND: Record<string, string> = { FL: 'Flood', EQ: 'Earthquake', TC: 'Cyclone', VO: 'Volcano', DR: 'Drought', WF: 'Forest fire', TS: 'Tsunami' };

/**
 * The TV keeps watch: when a real disaster alert concerns this family (GDACS), it interrupts
 * whatever is on screen, even cartoons, until someone presses OK. Every phone alarms at the same
 * time. Alerts replayed when the TV reconnects are shown only if this TV has not acknowledged them.
 */
export function AlertOverlay() {
  const { alerts, setAlertOpen, helpOpen } = useRoom();
  const seen = useRef(new Set<string>());
  const [current, setCurrent] = useState<DisasterAlert | null>(null);

  useEffect(() => {
    if (current) return;
    const next = alerts.find((a) => !seen.current.has(a.id));
    if (next) setCurrent(next);
  }, [alerts, current]);

  useEffect(() => setAlertOpen(current !== null), [current, setAlertOpen]);

  useEffect(() => {
    if (!current) return;
    const l = RemoteControlManager.addKeydownListener((k) => {
      if (k === SupportedKeys.Enter && !helpOpen) {
        seen.current.add(current.id);
        setCurrent(null);
      }
    });
    return () => RemoteControlManager.removeKeydownListener(l);
  }, [current, helpOpen]);

  if (!current) return null;
  const red = current.level === 'Red';
  return (
    <View style={[styles.wrap, { backgroundColor: red ? 'rgba(120,14,10,0.97)' : 'rgba(120,64,0,0.97)' }]} pointerEvents="none">
      {current.test && <Text style={styles.test}>TEST — DRILL, NOT A REAL ALERT</Text>}
      <Text style={styles.kicker}>
        {current.level.toUpperCase()} ALERT · {(KIND[current.kind] ?? 'DISASTER').toUpperCase()} · {current.country}
      </Text>
      <Text style={styles.title}>{current.title}</Text>
      <Text style={styles.why}>Why you're seeing this: {current.why}</Text>
      <Text style={styles.advice}>Check local official advice now. If you are told to move to safety, go. Every phone in the family is being alerted.</Text>
      <View style={styles.key}>
        <View style={styles.cap}>
          <Text style={styles.capText}>OK</Text>
        </View>
        <Text style={styles.keyLabel}>We've seen it</Text>
      </View>
      <Text style={styles.source}>Source: {current.source === 'GDACS' ? 'GDACS (gdacs.org), Global Disaster Alert and Coordination System' : current.source}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, zIndex: 190, justifyContent: 'center', paddingHorizontal: sp(120) },
  test: { color: '#1A1300', backgroundColor: '#FFD54A', alignSelf: 'flex-start', fontSize: sp(32), fontFamily: FONTS.bold, paddingHorizontal: sp(20), paddingVertical: sp(6), borderRadius: sp(10), marginBottom: sp(20) },
  kicker: { color: '#FFE2C2', fontSize: sp(34), fontFamily: FONTS.bold, letterSpacing: sp(2) },
  title: { color: '#FFFFFF', fontSize: sp(72), fontFamily: FONTS.bold, marginTop: sp(16), lineHeight: sp(84) },
  why: { color: '#FFE2C2', fontSize: sp(40), marginTop: sp(24) },
  advice: { color: '#FFFFFF', fontSize: sp(36), marginTop: sp(20), lineHeight: sp(50) },
  key: { flexDirection: 'row', alignItems: 'center', gap: sp(18), marginTop: sp(48) },
  cap: { minWidth: sp(96), height: sp(72), borderRadius: sp(14), borderWidth: sp(4), borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  capText: { color: '#FFFFFF', fontSize: sp(32), fontFamily: FONTS.bold },
  keyLabel: { color: '#FFFFFF', fontSize: sp(40), fontFamily: FONTS.bold },
  source: { position: 'absolute', bottom: sp(56), left: sp(120), color: '#FFD9B0', fontSize: sp(26) },
});
