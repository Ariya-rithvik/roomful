import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { suggestReplies, type ReplyPhrase } from '@roomcaption/shared';
import type { RootStackParamList } from '../navigation/types';
import { scaledPixels as sp } from '../hooks/useScale';
import { useRoom } from '../rc/RoomContext';
import { palette } from '../rc/config';
import { Btn, Col, Panel, Row, Screen, SpeakerTag, type } from '../rc/ui';
import { FONTS } from '../rc/theme';

/**
 * Reply board for someone who finds speaking hard. Pick a suggested reply (ranked by what was
 * just said, by fixed rules), confirm it, and it is spoken by the replying person's own phone
 * and captioned on the TV. Nothing is spoken without the confirm step.
 */
export default function ReplyScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { speakers, settings, setSettings, store, say } = useRoom();
  const [confirm, setConfirm] = useState<ReplyPhrase | null>(null);

  const me = speakers.find((s) => s.speakerId === settings.replyAs) ?? speakers[0] ?? null;
  const heard = me ? store.lastFinal(me.speakerId) : store.lastFinal();
  const heardBy = heard ? speakers.find((s) => s.speakerId === heard.speakerId) : null;
  const lang = me?.lang ?? 'en-IN';
  const phrases = useMemo(() => suggestReplies(heard?.text ?? null, lang, { limit: 8, includeDrafts: settings.drafts }), [heard?.text, lang, settings.drafts]);

  if (!me) {
    return (
      <Screen>
        <Text style={type.h1}>Reply board</Text>
        <Panel style={{ marginTop: sp(40), maxWidth: sp(1300) }}>
          <Text style={type.body}>
            The person replying needs to join with their own phone first: their phone is the loudspeaker that says the reply.
          </Text>
        </Panel>
        <Row style={{ marginTop: sp(40) }}>
          <Btn label="Back" onSelect={() => nav.goBack()} autoFocus />
        </Row>
      </Screen>
    );
  }

  const cycle = () => {
    if (speakers.length < 2) return;
    const i = speakers.findIndex((s) => s.speakerId === me.speakerId);
    setSettings({ replyAs: speakers[(i + 1) % speakers.length].speakerId });
  };

  if (confirm) {
    return (
      <Screen>
        <Text style={type.label}>Say this aloud as {me.name}?</Text>
        <Text style={[styles.confirmText]}>“{confirm.text}”</Text>
        {!confirm.reviewed && <Text style={type.small}>Draft phrase, not yet checked by a native speaker.</Text>}
        <Row style={{ marginTop: sp(48) }}>
          <Btn
            label="Yes, say it"
            autoFocus
            onSelect={() => {
              say(me.speakerId, confirm.text, confirm.lang, confirm.id);
              setConfirm(null);
              nav.goBack();
            }}
          />
          <Btn label="No, go back" onSelect={() => setConfirm(null)} />
        </Row>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={type.h1}>Reply</Text>
        <Row>
          <Btn label={`Replying as ${me.name}`} hint={speakers.length > 1 ? 'Select to change' : undefined} small onSelect={cycle} />
        </Row>
      </View>
      <Panel style={{ marginTop: sp(24) }}>
        <Text style={type.label}>Last thing said</Text>
        {heard ? (
          <View style={{ marginTop: sp(10), gap: sp(6) }}>
            {heardBy && <SpeakerTag name={heardBy.name} color={heardBy.color} size={30} />}
            <Text style={styles.heard}>{heard.text}</Text>
          </View>
        ) : (
          <Text style={[type.body, { color: palette.muted }]}>Nothing yet.</Text>
        )}
      </Panel>
      <Col style={{ marginTop: sp(32) }}>
        <Row>
          {phrases.slice(0, 4).map((p, i) => (
            <Btn key={p.id} label={p.text} onSelect={() => setConfirm(p)} autoFocus={i === 0} style={styles.choice} lines={2} />
          ))}
        </Row>
        <Row>
          {phrases.slice(4, 8).map((p) => (
            <Btn key={p.id} label={p.text} onSelect={() => setConfirm(p)} style={styles.choice} lines={2} />
          ))}
        </Row>
        <Row>
          <Btn label="Back to captions" small onSelect={() => nav.goBack()} />
        </Row>
      </Col>
      <Text style={[type.small, { marginTop: sp(16) }]}>Suggestions follow simple rules about what was just said (question, food, plans…). No AI writes them.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heard: { fontSize: sp(48), fontFamily: FONTS.bold, color: palette.text },
  choice: { width: sp(400), minHeight: sp(120) },
  confirmText: { fontSize: sp(96), fontFamily: FONTS.bold, color: palette.text, marginTop: sp(24) },
});
