import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePhoneMessage, parseTvMessage, parseServerToPhone, parseServerToTv, isRoomCode, generateRoomCode,
  MAX_JSON_BYTES, MAX_TEXT, ROOM_CODE_ALPHABET,
} from '../src/protocol';

const j = (o: unknown) => JSON.stringify(o);
const hello = { t: 'hello', v: 1, clientId: 'phone_abc123', name: 'Meena', lang: 'hi-IN', engine: 'device' };
const caption = { t: 'caption', utt: 3, seq: 7, text: 'दादी, खाना खाया?', final: true, lang: 'hi-IN', tStart: 1_760_000_000_000, conf: 0.9 };

test('valid phone messages parse', () => {
  assert.equal(parsePhoneMessage(j(hello)).ok, true);
  assert.equal(parsePhoneMessage(j(caption)).ok, true);
  assert.equal(parsePhoneMessage(j({ t: 'ping', id: 1, tClient: 123.5 })).ok, true);
});

test('unknown fields, wrong types and unknown types are rejected', () => {
  assert.equal(parsePhoneMessage(j({ ...hello, extra: 1 })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...hello, lang: 'fr-FR' })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...hello, v: 2 })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...caption, utt: -1 })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...caption, utt: 1.5 })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...caption, conf: 2 })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...caption, final: 'yes' })).ok, false);
  assert.equal(parsePhoneMessage(j({ t: 'tv_hello', v: 1, room: 'ABCD', token: 'tok_12345' })).ok, false, 'tv message on phone socket');
  assert.equal(parsePhoneMessage('not json').ok, false);
  assert.equal(parsePhoneMessage(j([1, 2])).ok, false);
  assert.equal(parsePhoneMessage(j(null)).ok, false);
});

test('text and name limits', () => {
  assert.equal(parsePhoneMessage(j({ ...caption, text: 'a'.repeat(MAX_TEXT) })).ok, true);
  assert.equal(parsePhoneMessage(j({ ...caption, text: 'a'.repeat(MAX_TEXT + 1) })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...hello, name: '   ' })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...hello, name: 'a\u0007b' })).ok, false, 'control characters');
  assert.equal(parsePhoneMessage(j({ ...hello, clientId: 'x' })).ok, false);
  assert.equal(parsePhoneMessage(j({ ...hello, clientId: '../etc' })).ok, false);
});

test('frames over the byte cap are rejected before parsing', () => {
  const big = j({ ...caption, text: 'ख'.repeat(1400) }); // 3 bytes each in UTF-8: under the char cap of JSON, over the byte cap
  assert.ok(big.length < MAX_JSON_BYTES && Buffer.byteLength(big) > MAX_JSON_BYTES);
  const r = parsePhoneMessage(big);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'too large');
});

test('tv messages', () => {
  assert.equal(parseTvMessage(j({ t: 'tv_hello', v: 1, room: 'AB2C', token: 'tok_12345' })).ok, true);
  assert.equal(parseTvMessage(j({ t: 'tv_hello', v: 1, room: 'ABIO', token: 'tok_12345' })).ok, false, 'I and O are not in the alphabet');
  assert.equal(parseTvMessage(j({ t: 'reply_say', speakerId: 'spk_0001', text: 'Yes, I ate.', lang: 'en-IN' })).ok, true);
  assert.equal(parseTvMessage(j({ t: 'reply_say', speakerId: 'spk_0001', text: '  ', lang: 'en-IN' })).ok, false);
  assert.equal(parseTvMessage(j({ t: 'measure', speakerId: 'spk_0001', utt: 2, tStart: 10, tRender: 900 })).ok, true);
  assert.equal(parseTvMessage(j(caption)).ok, false, 'phone message on tv socket');
});

test('server -> client messages', () => {
  assert.equal(parseServerToPhone(j({ t: 'welcome', v: 1, room: 'AB2C', speakerId: 'spk_0001', color: '#FFD54A', serverTime: 5 })).ok, true);
  assert.equal(parseServerToPhone(j({ t: 'play', url: '/audio/' + 'a'.repeat(64) + '.mp3', text: 'Yes' })).ok, true);
  assert.equal(parseServerToPhone(j({ t: 'play', url: 'https://evil.example/x.mp3', text: 'Yes' })).ok, false);
  const speakers = [{ speakerId: 'spk_0001', name: 'Meena', lang: 'hi-IN', color: '#FFD54A', engine: 'device', connected: true }];
  assert.equal(parseServerToTv(j({ t: 'room', room: 'AB2C', joinUrl: 'https://192.168.1.5:8787/join/AB2C', speakers })).ok, true);
  assert.equal(parseServerToTv(j({ t: 'room', room: 'AB2C', joinUrl: 'https://x/join/AB2C', speakers: [{ ...speakers[0], extra: 1 }] })).ok, false);
  assert.equal(parseServerToTv(j({ t: 'caption', speakerId: 'spk_0001', utt: 1, text: 'hi', final: false, lang: 'en-IN', tStart: 1, tRecv: 2 })).ok, true);
  assert.equal(parseServerToTv(j({ t: 'drop', speakerId: 'spk_0001', utt: 1, reason: 'duplicate' })).ok, true);
  assert.equal(parseServerToTv(j({ t: 'error', code: 'room_full', message: 'Room is full' })).ok, true);
  assert.equal(parseServerToTv(j({ t: 'error', code: 'nope', message: 'x' })).ok, false);
});

test('hunt, scan, moment and clip messages', () => {
  assert.equal(parsePhoneMessage(j({ t: 'scan', label: 'cup', outcome: 'confirmed', detected: 'cup', conf: 0.82 })).ok, true);
  assert.equal(parsePhoneMessage(j({ t: 'scan', label: 'knife', outcome: 'manual' })).ok, false, 'only the safe label list');
  assert.equal(parsePhoneMessage(j({ t: 'scan', label: 'cup', outcome: 'manual', image: 'data:...' })).ok, false, 'no image ever');
  assert.equal(parseTvMessage(j({ t: 'hunt_start', rounds: 3, seed: 12345 })).ok, true);
  assert.equal(parseTvMessage(j({ t: 'hunt_start', rounds: 7, seed: 1 })).ok, false);
  for (const t of ['hunt_next', 'hunt_end', 'moment_now', 'clips_clear']) assert.equal(parseTvMessage(j({ t })).ok, true, t);
  assert.equal(parseTvMessage(j({ t: 'moment_now', who: 'x' })).ok, false);
  const hunt = { t: 'hunt', status: 'won', round: 2, total: 3, prompt: { id: 'soft', text: 'Find something soft' }, scores: [{ speakerId: 'spk_0001', points: 1 }], winners: ['spk_0001'] };
  assert.equal(parseServerToTv(j(hunt)).ok, true);
  assert.equal(parseServerToPhone(j(hunt)).ok, true);
  assert.equal(parseServerToTv(j({ ...hunt, status: 'idle', round: 0, total: 0, prompt: null, scores: [], winners: [] })).ok, true);
  assert.equal(parseServerToTv(j({ ...hunt, scores: [{ speakerId: 'spk_0001', points: -1 }] })).ok, false);
  assert.equal(parseServerToTv(j({ t: 'scan_result', speakerId: 'spk_0001', label: 'book', ok: false, outcome: 'corrected' })).ok, true);
  const clip = { t: 'clip', id: 'a'.repeat(32), speakerId: 'spk_0001', url: `/clips/AB2C/${'a'.repeat(32)}.webm`, tStart: 5, durationMs: 4000, reason: 'smile' };
  assert.equal(parseServerToTv(j(clip)).ok, true);
  assert.equal(parseServerToTv(j({ ...clip, url: 'https://evil.example/x.webm' })).ok, false);
  assert.equal(parseServerToTv(j({ ...clip, url: `/clips/AB2C/../../x.webm` })).ok, false);
  assert.equal(parseServerToTv(j({ t: 'clips_cleared' })).ok, true);
  const obj = { t: 'object', id: 'b'.repeat(32), speakerId: 'spk_0001', label: 'teddy bear', url: `/objects/AB2C/${'b'.repeat(32)}.jpg` };
  assert.equal(parseServerToTv(j(obj)).ok, true);
  assert.equal(parseServerToTv(j({ ...obj, label: 'knife' })).ok, false);
  assert.equal(parseServerToTv(j({ ...obj, url: 'https://x/y.jpg' })).ok, false);
  assert.equal(parseServerToPhone(j({ t: 'moment_request' })).ok, true);
  assert.equal(parseServerToPhone(j({ t: 'welcome', v: 1, room: 'AB2C', speakerId: 'spk_0001', color: '#FFD54A', serverTime: 5, uploadToken: 'up_0123456789abcdef' })).ok, true);
});

test('help messages', () => {
  for (const t of ['help_raise', 'help_ack', 'help_cancel']) assert.equal(parsePhoneMessage(j({ t })).ok, true, t);
  assert.equal(parseTvMessage(j({ t: 'help_raise' })).ok, true);
  assert.equal(parseTvMessage(j({ t: 'help_ack' })).ok, false, 'the TV does not answer its own call');
  const h = { t: 'help', status: 'active', since: 5, byName: null, comingName: null, alerts: 1 };
  assert.equal(parseServerToTv(j(h)).ok, true);
  assert.equal(parseServerToPhone(j({ ...h, status: 'coming', comingName: 'Ravi' })).ok, true);
  assert.equal(parseServerToPhone(j({ ...h, status: 'panic' })).ok, false);
});

test('room codes', () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 200; i++) assert.ok(isRoomCode(generateRoomCode(rnd)));
  assert.equal(generateRoomCode(() => 0.999999999), ROOM_CODE_ALPHABET.at(-1)!.repeat(4));
  assert.equal(isRoomCode('abcd'), false);
  assert.equal(isRoomCode('ABCDE'), false);
});
