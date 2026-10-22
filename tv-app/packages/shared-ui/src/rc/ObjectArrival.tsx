import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { OBJECTS, type ObjectArrived } from '@roomcaption/shared';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from './RoomContext';
import { palette, serverUrl } from './config';
import { FONTS } from './theme';

/**
 * When someone brings a real object "into the TV" (scans it and confirms on their phone), its
 * actual photo pops up big over whatever is on screen, with who brought it and its name, then
 * shrinks away into the shelf on the living-room screen. Shown on every screen.
 */
export function ObjectArrival() {
  const { objects, speakers, settings } = useRoom();
  const [current, setCurrent] = useState<ObjectArrived | null>(null);
  const seen = useRef(new Set<string>());
  const queue = useRef<ObjectArrived[]>([]);
  const scale = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  useEffect(() => {
    // Objects replayed when the TV (re)connects are not announced again.
    if (first.current) {
      first.current = false;
      objects.forEach((o) => seen.current.add(o.id));
      return;
    }
    for (const o of objects) {
      if (seen.current.has(o.id)) continue;
      seen.current.add(o.id);
      queue.current.push(o);
    }
    if (!current && queue.current.length) setCurrent(queue.current.shift()!);
  }, [objects, current]);

  useEffect(() => {
    if (!current) return;
    scale.setValue(0);
    const anim = Animated.sequence([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.delay(3200),
      Animated.timing(scale, { toValue: 0, duration: 450, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]);
    anim.start(() => setCurrent(queue.current.shift() ?? null));
    return () => anim.stop();
  }, [current, scale]);

  if (!current) return null;
  const who = speakers.find((s) => s.speakerId === current.speakerId);
  const info = OBJECTS[current.label];
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.View style={[styles.card, { borderColor: who?.color ?? palette.accent, transform: [{ scale }] }]}>
        <Image source={{ uri: serverUrl() + current.url }} style={styles.photo} resizeMode="cover" />
        <Text style={styles.title}>
          <Text style={{ color: who?.color ?? palette.accent }}>{who?.name ?? 'Someone'}</Text> brought a {info.display.toLowerCase()} into the TV!
        </Text>
        {settings.drafts && <Text style={styles.sub}>{info.hindiDraft}</Text>}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  card: { backgroundColor: '#111216', borderWidth: sp(8), borderRadius: sp(36), padding: sp(28), alignItems: 'center', maxWidth: sp(1100) },
  photo: { width: sp(560), height: sp(560), borderRadius: sp(24), backgroundColor: '#000' },
  title: { color: palette.text, fontSize: sp(52), fontFamily: FONTS.bold, marginTop: sp(22), textAlign: 'center' },
  sub: { color: palette.muted, fontSize: sp(40), marginTop: sp(6) },
});
