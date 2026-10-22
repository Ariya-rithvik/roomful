import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from '../rc/RoomContext';
import { palette, serverUrl } from '../rc/config';
import { Btn, Col, Panel, Pill, QRCode, Row, Screen, SpeakerTag, type } from '../rc/ui';
import { FONTS } from '../rc/theme';

const LANG_NAME: Record<string, string> = { 'en-IN': 'English', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil' };

export default function HomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { phase, error, room, link, speakers, clips, newRoom, askHelp } = useRoom();

  if (phase === 'error') {
    return (
      <Screen>
        <Text style={type.hero}>Roomful</Text>
        <Panel style={{ marginTop: sp(40), maxWidth: sp(1300) }}>
          <Text style={type.h2}>The TV cannot find the Roomful family server</Text>
          <Text style={[type.body, { marginTop: sp(16) }]}>{error}</Text>
          <Text style={[type.small, { marginTop: sp(16) }]}>
            Start the server on the family computer, and make sure the TV and the computer are on the same Wi-Fi.
          </Text>
        </Panel>
        <Row style={{ marginTop: sp(40) }}>
          <Btn label="Try again" onSelect={newRoom} autoFocus />
        </Row>
      </Screen>
    );
  }

  const linkPill =
    link === 'connected' ? <Pill label="Connected" tone="ok" /> : link === 'unauthorized' || link === 'replaced' ? <Pill label={link === 'replaced' ? 'Opened on another TV' : 'Not allowed'} tone="bad" /> : <Pill label="Connecting…" tone="warn" />;

  return (
    <Screen>
      <View style={styles.top}>
        <View>
          <Text style={type.hero}>Roomful</Text>
          <Text style={type.small}>The family's own channel: live captions, real things brought into the TV, and the evening's happy moments.</Text>
        </View>
        {phase === 'ready' && linkPill}
      </View>

      <View style={styles.body}>
        <View style={styles.qrCol}>
          {room ? (
            <>
              <QRCode value={room.joinUrl} size={sp(420)} />
              <Text style={[type.h2, { marginTop: sp(20) }]}>Scan with each phone</Text>
              <Text style={type.small}>
                Room <Text style={{ color: palette.accent, fontFamily: FONTS.bold }}>{room.room}</Text> · {room.joinUrl}
              </Text>
            </>
          ) : (
            <Text style={type.body}>Opening a room…</Text>
          )}
        </View>

        <View style={styles.people}>
          <Text style={type.label}>At the table</Text>
          {speakers.length === 0 ? (
            <Text style={[type.body, { marginTop: sp(16), color: palette.muted }]}>
              Nobody has joined yet. Each person scans the code with their own phone, types their name and taps Start listening.
            </Text>
          ) : (
            <View style={{ marginTop: sp(16), gap: sp(18) }}>
              {speakers.map((s) => (
                <View key={s.speakerId} style={styles.person}>
                  <SpeakerTag name={s.name} color={s.color} dim={!s.connected} size={40} />
                  <Text style={type.small}>
                    {LANG_NAME[s.lang] ?? s.lang}
                    {s.connected ? '' : ' · phone offline'}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <Col style={{ marginTop: sp(32) }}>
            <Row>
              <Btn label="Living room" hint="Kids channel + news, captions, moments" onSelect={() => nav.navigate('LivingRoom')} autoFocus disabled={phase !== 'ready'} />
              <Btn label="Channel wall" hint="Four channels · each phone hears its own" onSelect={() => nav.navigate('ChannelWall')} disabled={phase !== 'ready'} />
            </Row>
            <Row>
              <Btn label="Captions" small onSelect={() => nav.navigate('Captions')} disabled={phase !== 'ready'} />
              <Btn label="Table Hunt" small onSelect={() => nav.navigate('Hunt')} disabled={phase !== 'ready'} />
              <Btn label={`Happy moments${clips.length ? ` (${clips.length})` : ''}`} small onSelect={() => nav.navigate('Reel')} disabled={phase !== 'ready'} />
            </Row>
            <Row>
              <Btn label="I need help" hint="or press ☰ on the remote" small onSelect={askHelp} disabled={phase !== 'ready'} textStyle={{ color: '#FF9A8A' }} />
              <Btn label="Settings" small onSelect={() => nav.navigate('Settings')} />
              <Btn label="New room" small onSelect={newRoom} />
            </Row>
          </Col>
        </View>
      </View>
      <Text style={[type.small, styles.footer]}>Server: {serverUrl()} · Speech is turned into text on each phone. Nothing is recorded.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  body: { flex: 1, flexDirection: 'row', gap: sp(80), marginTop: sp(40) },
  qrCol: { width: sp(620) },
  people: { flex: 1 },
  person: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', maxWidth: sp(900) },
  footer: { fontSize: sp(22) },
});
