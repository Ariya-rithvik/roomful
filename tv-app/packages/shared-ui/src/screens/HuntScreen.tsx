import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { OBJECTS } from '@roomcaption/shared';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from '../rc/RoomContext';
import { palette } from '../rc/config';
import { Btn, Col, Panel, Row, Screen, SpeakerTag, type } from '../rc/ui';
import { FONTS } from '../rc/theme';

/**
 * Table Hunt: the TV gives a prompt ("Find something soft"); each person scans a real object with
 * their phone. The phone's detector proposes, the person confirms, and only the object's name is
 * sent. The first matching object wins the round.
 */
export default function HuntScreen() {
  const { hunt, speakers, scans, huntStart, huntNext, huntEnd, settings } = useRoom();
  const name = (id: string) => speakers.find((s) => s.speakerId === id);
  const objName = (label: keyof typeof OBJECTS) => (settings.drafts ? `${OBJECTS[label].display} · ${OBJECTS[label].hindiDraft}` : OBJECTS[label].display);
  const active = hunt && (hunt.status === 'playing' || hunt.status === 'won');

  if (!active) {
    const done = hunt?.status === 'done';
    return (
      <Screen>
        <Text style={type.h1}>Table Hunt</Text>
        <Text style={[type.small, { marginTop: sp(8), maxWidth: sp(1400) }]}>
          The TV asks for something (“Find something soft”). Everyone looks around the room and scans a real object with their phone. First to find a match wins the
          round. The phone sends only the object's name, never a picture.
        </Text>
        {done && (
          <Panel style={{ marginTop: sp(28), maxWidth: sp(1200) }}>
            <Text style={type.label}>Last hunt</Text>
            {hunt!.winners.length ? (
              <Text style={[type.h2, { marginTop: sp(8) }]}>
                Winner{hunt!.winners.length > 1 ? 's' : ''}: {hunt!.winners.map((w) => name(w)?.name ?? 'Someone').join(' & ')}
              </Text>
            ) : (
              <Text style={[type.body, { marginTop: sp(8) }]}>Nobody found anything this time.</Text>
            )}
            <Scores />
          </Panel>
        )}
        {speakers.length === 0 && <Text style={[type.body, { marginTop: sp(28), color: palette.warn }]}>Nobody has joined yet: scan the code on the home screen first.</Text>}
        <Row style={{ marginTop: sp(40) }}>
          <Btn label="3 rounds" hint="Quick" onSelect={() => huntStart(3)} autoFocus />
          <Btn label="5 rounds" onSelect={() => huntStart(5)} />
        </Row>
      </Screen>
    );
  }

  const won = hunt.status === 'won';
  const winner = won ? name(hunt.winners[0]) : null;
  const winningScan = won ? scans.find((s) => s.ok && s.speakerId === hunt.winners[0]) : null;

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={type.label}>
          Table Hunt · round {hunt.round} of {hunt.total}
        </Text>
      </View>
      <Text style={styles.prompt}>{hunt.prompt?.text}</Text>
      {won && (
        <View style={[styles.banner, { borderColor: winner?.color ?? palette.ok }]}>
          <Text style={[styles.bannerText, { color: winner?.color ?? palette.ok }]}>
            {winner?.name ?? 'Someone'} found it{winningScan ? `: ${objName(winningScan.label)}` : ''}!
          </Text>
          <Text style={type.small}>Next round in a moment…</Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>Just shown</Text>
          {scans.length === 0 ? (
            <Text style={[type.body, { color: palette.muted, marginTop: sp(12) }]}>Open the Hunt tab on your phone and scan something.</Text>
          ) : (
            <View style={{ gap: sp(10), marginTop: sp(12) }}>
              {scans.map((s) => {
                const who = name(s.speakerId);
                return (
                  <Text key={s.n} style={[styles.scan, { color: s.ok ? palette.ok : palette.text }]}>
                    <Text style={{ color: who?.color ?? palette.muted, fontFamily: FONTS.bold }}>{who?.name ?? 'Someone'}</Text> showed {objName(s.label)} {s.ok ? '✓' : '✗'}
                  </Text>
                );
              })}
            </View>
          )}
        </View>
        <Panel style={{ width: sp(600) }}>
          <Text style={type.label}>Score</Text>
          <Scores />
        </Panel>
      </View>
      <Col>
        <Row>
          <Btn label={won ? 'Next round now' : 'Skip this round'} small onSelect={huntNext} autoFocus />
          <Btn label="End hunt" small onSelect={huntEnd} />
        </Row>
      </Col>
    </Screen>
  );
}

function Scores() {
  const { hunt, speakers } = useRoom();
  const rows = speakers.map((s) => ({ s, points: hunt?.scores.find((x) => x.speakerId === s.speakerId)?.points ?? 0 })).sort((a, b) => b.points - a.points);
  if (!rows.length) return <Text style={type.small}>Nobody yet.</Text>;
  return (
    <View style={{ gap: sp(12), marginTop: sp(12) }}>
      {rows.map(({ s, points }) => (
        <View key={s.speakerId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SpeakerTag name={s.name} color={s.color} dim={!s.connected} size={34} />
          <Text style={{ color: palette.text, fontSize: sp(44), fontFamily: FONTS.bold }}>{points}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  prompt: { color: palette.text, fontSize: sp(104), fontFamily: FONTS.bold, marginTop: sp(12) },
  banner: { borderWidth: sp(4), borderRadius: sp(20), padding: sp(20), marginTop: sp(16), alignSelf: 'flex-start' },
  bannerText: { fontSize: sp(56), fontFamily: FONTS.bold },
  body: { flex: 1, flexDirection: 'row', gap: sp(48), marginTop: sp(28) },
  scan: { fontSize: sp(36), fontFamily: FONTS.semibold },
});
