import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from '../rc/RoomContext';
import { palette } from '../rc/config';
import { ReelPlayer } from '../rc/ReelPlayer';
import { Btn, Panel, Row, Screen, Toast, type, useToast } from '../rc/ui';
import { SupportedKeys, useRemoteKeys } from '../rc/useRemoteKeys';
import { FONTS } from '../rc/theme';

export default function ReelScreen() {
  const { clips, momentNow, speakers } = useRoom();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [toast, showToast] = useToast();

  useRemoteKeys((k) => {
    if (!clips.length) return;
    if (k === SupportedKeys.Right || k === SupportedKeys.FastForward) setIndex((i) => i + 1);
    else if (k === SupportedKeys.Left || k === SupportedKeys.Rewind) setIndex((i) => i - 1);
    else if (k === SupportedKeys.PlayPause) setPaused((p) => !p);
    else if (k === SupportedKeys.Enter) {
      momentNow();
      showToast('Asked every phone to save a moment');
    }
  });

  if (!clips.length) {
    return (
      <Screen>
        <Text style={type.h1}>Happy moments</Text>
        <Panel style={{ marginTop: sp(32), maxWidth: sp(1400) }}>
          <Text style={type.body}>No moments saved yet.</Text>
          <Text style={[type.small, { marginTop: sp(12) }]}>
            On a phone, open the Moments tab and switch on “Save happy moments”. When someone at the table smiles, that phone saves a 4-second clip without sound.
            {speakers.length ? '' : ' Nobody has joined yet.'}
          </Text>
        </Panel>
        <Row style={{ marginTop: sp(40) }}>
          <Btn
            label="Save a moment now"
            hint="Every phone with Moments on records 4 seconds"
            autoFocus
            onSelect={() => {
              momentNow();
              showToast('Asked every phone to save a moment');
            }}
          />
        </Row>
        <Toast text={toast} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.full}>
        <ReelPlayer clips={clips} index={index} onIndex={setIndex} paused={paused} />
      </View>
      {paused && (
        <View style={styles.paused}>
          <Text style={styles.pausedText}>Paused</Text>
        </View>
      )}
      <Text style={styles.hint}>◀ ▶ previous / next   ⏯ pause   OK save a moment now   Back home</Text>
      <Toast text={toast} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, margin: sp(24) },
  paused: { position: 'absolute', top: sp(40), right: sp(60), backgroundColor: palette.accent, borderRadius: sp(12), paddingHorizontal: sp(20), paddingVertical: sp(8) },
  pausedText: { color: '#1A1300', fontSize: sp(30), fontFamily: FONTS.bold },
  hint: { color: palette.muted, fontSize: sp(24), textAlign: 'center', marginBottom: sp(16) },
});
