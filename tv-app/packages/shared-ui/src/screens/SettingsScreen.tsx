import React from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from '../rc/RoomContext';
import { captionThemes, serverUrl, textSizes, type CaptionTheme } from '../rc/config';
import { Btn, Col, Row, Screen, type } from '../rc/ui';

export default function SettingsScreen() {
  const nav = useNavigation();
  const { settings, setSettings, clips, clipsClear } = useRoom();
  return (
    <Screen>
      <Text style={type.h1}>Settings</Text>
      <Col style={{ marginTop: sp(32), gap: sp(30) }}>
        <View>
          <Text style={type.label}>Caption text size</Text>
          <Row style={{ marginTop: sp(12) }}>
            {textSizes.map((t, i) => (
              <Btn key={t.name} label={t.name} small selected={settings.textSize === i} onSelect={() => setSettings({ textSize: i })} autoFocus={i === settings.textSize} />
            ))}
          </Row>
        </View>
        <View>
          <Text style={type.label}>Colours</Text>
          <Row style={{ marginTop: sp(12) }}>
            {(Object.keys(captionThemes) as CaptionTheme[]).map((k) => (
              <Btn key={k} label={captionThemes[k].label} small selected={settings.theme === k} onSelect={() => setSettings({ theme: k })} />
            ))}
          </Row>
        </View>
        <View>
          <Text style={type.label}>Show words while they are being spoken</Text>
          <Row style={{ marginTop: sp(12) }}>
            <Btn label="On" small selected={settings.showPartials} onSelect={() => setSettings({ showPartials: true })} />
            <Btn label="Off (only finished sentences)" small selected={!settings.showPartials} onSelect={() => setSettings({ showPartials: false })} />
          </Row>
        </View>
        <View>
          <Text style={type.label}>Hindi reply phrases (drafts, not yet checked by a native speaker)</Text>
          <Row style={{ marginTop: sp(12) }}>
            <Btn label="Hide" small selected={!settings.drafts} onSelect={() => setSettings({ drafts: false })} />
            <Btn label="Show" small selected={settings.drafts} onSelect={() => setSettings({ drafts: true })} />
          </Row>
        </View>
        <View>
          <Text style={type.label}>Whose TV is this? (help alerts say “… needs help”)</Text>
          <Row style={{ marginTop: sp(12) }}>
            {['Dadi', 'Dada', 'Nani', 'Nana', 'Mummy', 'Papa'].map((n) => (
              <Btn key={n} label={n} small selected={settings.tvOwner === n} onSelect={() => setSettings({ tvOwner: settings.tvOwner === n ? null : n })} />
            ))}
          </Row>
        </View>
        <View>
          <Text style={type.label}>Happy moments ({clips.length} saved on the family computer)</Text>
          <Row style={{ marginTop: sp(12) }}>
            <Btn label="Delete all saved moments" small disabled={!clips.length} onSelect={clipsClear} />
          </Row>
        </View>
        <Row>
          <Btn label="Done" onSelect={() => nav.goBack()} />
        </Row>
      </Col>
      <Text style={[type.small, { marginTop: sp(24) }]}>Server: {serverUrl()}</Text>
    </Screen>
  );
}
