import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/app';
import type { TtsEngine } from '../src/tts';
import type { SpeechEngine, SpeechResult } from '../src/speech';
import type { RoomCreated, ServerToTv, ServerToPhone, Lang } from '@roomcaption/shared';

type Msg = Record<string, any>;

class Client {
  msgs: Msg[] = [];
  waiters: { pred: (m: Msg) => boolean; ok: (m: Msg) => void }[] = [];
  closed: Promise<{ code: number; reason: string }>;
  constructor(public ws: WebSocket) {
    ws.on('error', () => {}); // closes are asserted through the close code
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.ok(m); }
    });
    this.closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
  }
  static async open(url: string): Promise<Client> {
    const ws = new WebSocket(url);
    const c = new Client(ws);
    await new Promise<void>((ok, fail) => { ws.once('open', () => ok()); ws.once('error', fail); });
    return c;
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  next(pred: (m: Msg) => boolean, ms = 2000): Promise<Msg> {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('timeout waiting for message; got ' + JSON.stringify(this.msgs))), ms);
      this.waiters.push({ pred, ok: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); ok(m); } });
    });
  }
  type(t: string, ms?: number) { return this.next((m) => m.t === t, ms); }
  close() { this.ws.close(); }
}

const fakeTts = (fail = false): TtsEngine => ({
  async synth(text: string, lang: Lang) {
    if (fail || lang === 'ta-IN') throw new Error(`no voice for ${lang}`);
    return Buffer.from(`MP3:${lang}:${text}`);
  },
});

async function setup(extra: { tts?: TtsEngine; speech?: SpeechEngine; staticDir?: string } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'rc-test-'));
  let t = 1_760_000_000_000;
  const app = createApp({ staticDir: extra.staticDir ?? join(dataDir, 'nostatic'), dataDir, tts: extra.tts, speech: extra.speech, now: () => (t += 10), helloTimeoutMs: 300 });
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const ws = `ws://127.0.0.1:${port}`;
  const created = (await (await fetch(base + '/api/rooms', { method: 'POST' })).json()) as RoomCreated;
  return { app, base, ws, created, dataDir };
}

async function tvFor(s: Awaited<ReturnType<typeof setup>>) {
  const tv = await Client.open(`${s.ws}/ws/tv?room=${s.created.room}`);
  tv.send({ t: 'tv_hello', v: 1, room: s.created.room, token: s.created.token });
  await tv.type('room');
  return tv;
}

async function phoneFor(s: Awaited<ReturnType<typeof setup>>, name: string, clientId: string, lang: Lang = 'en-IN', engine = 'device') {
  const p = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  p.send({ t: 'hello', v: 1, clientId, name, lang, engine });
  const w = await p.type('welcome');
  return { p, speakerId: w.speakerId as string, color: w.color as string };
}

const caption = (utt: number, text: string, final: boolean, tStart: number, extra: object = {}) => ({ t: 'caption', utt, seq: 0, text, final, lang: 'en-IN', tStart, ...extra });

test('room creation and join URL', async () => {
  const s = await setup();
  assert.match(s.created.room, /^[A-Z0-9]{4}$/);
  assert.match(s.created.token, /^tok_[a-f0-9]{32}$/);
  assert.equal(s.created.joinUrl, `${s.base}/join/${s.created.room}`);
  const hr = await fetch(s.base + '/api/health');
  assert.equal(hr.headers.get('access-control-allow-origin'), '*', 'the web build of the TV app is on another origin');
  const h = (await hr.json()) as { ok: boolean };
  assert.equal(h.ok, true);
  const pre = await fetch(s.base + '/api/rooms', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal((await fetch(s.base + '/api/nope')).status, 404);
  assert.equal((await fetch(`${s.base}/api/rooms/${s.created.room}`)).status, 200);
  assert.equal((await fetch(`${s.base}/api/rooms/ZZZZ`)).status, 404, 'an ended room is reported, so clients stop retrying');
  await s.app.close();
});

test('phone joins, TV sees speakers, captions flow to the TV', async () => {
  const s = await setup();
  const tv = await tvFor(s);
  const a = await phoneFor(s, 'Meena', 'client_aaaa');
  const room = await tv.next((m) => m.t === 'room' && m.speakers.length === 1);
  assert.deepEqual(room.speakers[0], { speakerId: a.speakerId, name: 'Meena', lang: 'en-IN', color: a.color, engine: 'device', connected: true });
  a.p.send(caption(1, 'did you', false, 1_000));
  const partial = await tv.type('caption');
  assert.equal(partial.final, false);
  assert.equal(partial.speakerId, a.speakerId);
  a.p.send(caption(1, 'Did you eat?', true, 1_000));
  const fin = await tv.type('caption');
  assert.deepEqual([fin.text, fin.final], ['Did you eat?', true]);
  a.p.close();
  const left = await tv.next((m) => m.t === 'room' && m.speakers[0]?.connected === false);
  assert.equal(left.speakers.length, 1);
  await s.app.close();
});

test('reconnect with the same clientId keeps the speaker id and colour', async () => {
  const s = await setup();
  const a = await phoneFor(s, 'Meena', 'client_aaaa');
  a.p.close();
  await a.p.closed;
  const b = await phoneFor(s, 'Meena M', 'client_aaaa', 'hi-IN');
  assert.equal(b.speakerId, a.speakerId);
  assert.equal(b.color, a.color);
  const c = await phoneFor(s, 'Ravi', 'client_bbbb');
  assert.notEqual(c.color, a.color);
  await s.app.close();
});

test('cross-talk: the quieter phone hearing the same sentence is dropped', async () => {
  const s = await setup();
  const tv = await tvFor(s);
  const near = await phoneFor(s, 'Meena', 'client_aaaa');
  const far = await phoneFor(s, 'Ravi', 'client_bbbb');
  far.p.send(caption(4, 'did you have lunch', true, 1_000, { level: 0.1 }));
  const first = await tv.type('caption');
  assert.equal(first.speakerId, far.speakerId);
  near.p.send(caption(9, 'Did you have lunch?', true, 1_100, { level: 0.7 }));
  const drop = await tv.type('drop');
  assert.deepEqual(drop, { t: 'drop', speakerId: far.speakerId, utt: 4, reason: 'duplicate' });
  const win = await tv.type('caption');
  assert.equal(win.speakerId, near.speakerId);
  // A late partial for the dropped line is ignored.
  far.p.send(caption(4, 'did you', false, 1_000));
  near.p.send(caption(10, 'Yes', true, 3_000));
  const nextCap = await tv.type('caption');
  assert.equal(nextCap.text, 'Yes');
  await s.app.close();
});

test('rejects bad messages, unknown rooms, wrong tokens, binary frames and silent sockets', async () => {
  const s = await setup();
  const p = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  p.send({ t: 'hello', v: 1, clientId: 'client_aaaa', name: 'M', lang: 'xx', engine: 'device' });
  assert.equal((await p.type('error')).code, 'bad_message');
  p.send(caption(1, 'hi', true, 1));
  assert.equal((await p.type('error')).code, 'not_joined');
  p.ws.send(Buffer.from([1, 2, 3]), { binary: true });
  assert.equal((await p.closed).code, 1003);

  await assert.rejects(Client.open(`${s.ws}/ws/phone?room=ZZZZ`));
  await assert.rejects(Client.open(`${s.ws}/ws/whatever?room=${s.created.room}`));

  const tv = await Client.open(`${s.ws}/ws/tv?room=${s.created.room}`);
  tv.send({ t: 'tv_hello', v: 1, room: s.created.room, token: 'tok_wrongwrong' });
  assert.equal((await tv.type('error')).code, 'unauthorized');
  assert.equal((await tv.closed).code, 4004);

  const silent = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  assert.equal((await silent.closed).code, 4002);

  const big = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  big.ws.send('x'.repeat(10_000));
  assert.equal((await big.closed).code, 1009);
  await s.app.close();
});

test('room holds at most 6 people', async () => {
  const s = await setup();
  for (let i = 0; i < 6; i++) await phoneFor(s, `P${i}`, `client_${i}xxx`);
  const p = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  p.send({ t: 'hello', v: 1, clientId: 'client_7xxx', name: 'Seventh', lang: 'en-IN', engine: 'device' });
  assert.equal((await p.type('error')).code, 'room_full');
  assert.equal((await p.closed).code, 4001);
  await s.app.close();
});

test('ping/pong carries server time', async () => {
  const s = await setup();
  const a = await phoneFor(s, 'Meena', 'client_aaaa');
  a.p.send({ t: 'ping', id: 5, tClient: 123 });
  const pong = await a.p.type('pong');
  assert.equal(pong.id, 5);
  assert.equal(pong.tClient, 123);
  assert.ok(pong.tServer > 1_760_000_000_000);
  await s.app.close();
});

test('reply board: caption on TV, audio on the phone, echo of the loudspeaker suppressed', async () => {
  const s = await setup({ tts: fakeTts() });
  const tv = await tvFor(s);
  const nani = await phoneFor(s, 'Nani', 'client_nani');
  const ravi = await phoneFor(s, 'Ravi', 'client_ravi');
  tv.send({ t: 'reply_say', speakerId: nani.speakerId, text: 'Yes, I have eaten.', lang: 'en-IN', phraseId: 'en-14' });
  const line = await tv.type('caption');
  assert.deepEqual([line.speakerId, line.reply, line.final], [nani.speakerId, true, true]);
  const play = await nani.p.type('play');
  assert.match(play.url, /^\/audio\/[a-f0-9]{64}\.mp3$/);
  assert.equal((await tv.type('reply_status')).status, 'speaking');
  const audio = await fetch(s.base + play.url);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await audio.text(), 'MP3:en-IN:Yes, I have eaten.');
  // Ravi's phone hears the loudspeaker: not captioned as Ravi.
  ravi.p.send(caption(1, 'yes I have eaten', true, 2_000));
  assert.deepEqual(await tv.type('drop'), { t: 'drop', speakerId: ravi.speakerId, utt: 1, reason: 'duplicate' });
  await s.app.close();
});

test('reply board: no voice for Tamil is reported, text still shown', async () => {
  const s = await setup({ tts: fakeTts() });
  const tv = await tvFor(s);
  const a = await phoneFor(s, 'Paati', 'client_paati', 'ta-IN');
  tv.send({ t: 'reply_say', speakerId: a.speakerId, text: 'ஆமாம்', lang: 'ta-IN' });
  assert.equal((await tv.type('caption')).text, 'ஆமாம்');
  const st = await tv.type('reply_status');
  assert.equal(st.status, 'failed');
  assert.match(st.reason, /no voice/);
  await s.app.close();
});

test('measurements are logged with end-to-end latency', async () => {
  const s = await setup();
  const tv = await tvFor(s);
  const a = await phoneFor(s, 'Meena', 'client_aaaa');
  a.p.send(caption(1, 'hello there', true, 1_759_999_999_000));
  const c = await tv.type('caption');
  tv.send({ t: 'measure', speakerId: a.speakerId, utt: 1, tStart: c.tStart, tRender: c.tStart + 850 });
  tv.send({ t: 'ping', id: 1, tClient: 0 });
  await tv.type('pong'); // measure handled before the pong
  const rows = readFileSync(join(s.dataDir, 'measurements.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].endToEndMs, 850);
  assert.equal(typeof rows[0].phoneToServerMs, 'number');
  await s.app.close();
});

test('server speech engine: unavailable is reported; fake engine results become captions', async () => {
  const s1 = await setup();
  const p = await Client.open(`${s1.ws}/ws/phone?room=${s1.created.room}`);
  p.send({ t: 'hello', v: 1, clientId: 'client_aaaa', name: 'M', lang: 'en-IN', engine: 'server' });
  await p.type('welcome');
  assert.equal((await p.type('error')).code, 'engine_unavailable');
  await s1.app.close();

  const results: ((r: SpeechResult) => void)[] = [];
  const written: Buffer[] = [];
  const speech: SpeechEngine = { name: 'fake', start: (_lang, onResult) => { results.push(onResult); return { write: (b) => written.push(b), end: () => {} }; } };
  const s = await setup({ speech });
  const tv = await tvFor(s);
  const a = await phoneFor(s, 'Meena', 'client_aaaa', 'hi-IN', 'server');
  const audio = new WebSocket(`${s.ws}/ws/phone-audio?room=${s.created.room}&speaker=${a.speakerId}`);
  await new Promise((r) => audio.once('open', r));
  audio.send(Buffer.alloc(3200));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(written.length, 1);
  results[0]({ id: 'r1', text: 'दादी', final: false, startOffsetMs: 200 });
  results[0]({ id: 'r1', text: 'दादी खाना खाया', final: true, startOffsetMs: 200 });
  const c1 = await tv.type('caption');
  const c2 = await tv.type('caption');
  assert.equal(c1.utt, c2.utt);
  assert.deepEqual([c2.text, c2.final, c2.lang], ['दादी खाना खाया', true, 'hi-IN']);
  audio.send('text is not allowed');
  await new Promise((r) => audio.once('close', r));
  await s.app.close();
});

test('caption text is saved only in measurement mode', async () => {
  const s = await setup();
  const tv = await tvFor(s);
  const a = await phoneFor(s, 'Meena', 'client_aaaa');
  a.p.send(caption(1, 'not saved', true, 1_000));
  await tv.type('caption');
  assert.throws(() => readFileSync(join(s.dataDir, 'captured.jsonl')));
  await s.app.close();

  const dataDir = mkdtempSync(join(tmpdir(), 'rc-cap-'));
  const app = createApp({ staticDir: dataDir, dataDir, captureText: true });
  const port = await app.listen(0, '127.0.0.1');
  const created = (await (await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST' })).json()) as RoomCreated;
  const health = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { capturing: boolean };
  assert.equal(health.capturing, true, 'phones are told');
  const p = await Client.open(`ws://127.0.0.1:${port}/ws/phone?room=${created.room}`);
  p.send({ t: 'hello', v: 1, clientId: 'client_aaaa', name: 'Meena', lang: 'en-IN', engine: 'device' });
  await p.type('welcome');
  p.send(caption(1, 'saved for scoring', true, Date.now()));
  p.send({ t: 'ping', id: 1, tClient: 0 });
  await p.type('pong');
  const row = JSON.parse(readFileSync(join(dataDir, 'captured.jsonl'), 'utf8').trim());
  assert.deepEqual([row.name, row.text, row.lang], ['Meena', 'saved for scoring', 'en-IN']);
  await app.close();
});

test('table hunt: start, wrong and right scans, scoring, auto-advance, scan log', async () => {
  const s = await setup();
  const tv = await tvFor(s);
  const a = await phoneFor(s, 'Asha', 'client_asha');
  const b = await phoneFor(s, 'Ravi', 'client_ravi');
  tv.send({ t: 'hunt_start', rounds: 2, seed: 11 });
  const st = await tv.type('hunt');
  assert.equal(st.status, 'playing');
  assert.equal((await a.p.type('hunt')).prompt.id, st.prompt.id, 'phones get the same prompt');
  const { HUNT_PROMPTS, OBJECT_LABELS, matchesPrompt } = await import('@roomcaption/shared');
  const prompt = HUNT_PROMPTS.find((p) => p.id === st.prompt.id)!;
  const right = OBJECT_LABELS.find((l) => matchesPrompt(prompt, l))!;
  const wrong = OBJECT_LABELS.find((l) => !matchesPrompt(prompt, l))!;
  a.p.send({ t: 'scan', label: wrong, outcome: 'confirmed', detected: wrong, conf: 0.9 });
  assert.deepEqual(await tv.type('scan_result'), { t: 'scan_result', speakerId: a.speakerId, label: wrong, ok: false, outcome: 'confirmed' });
  b.p.send({ t: 'scan', label: right, outcome: 'manual' });
  assert.equal((await tv.type('scan_result')).ok, true);
  const won = await tv.type('hunt');
  assert.deepEqual([won.status, won.winners, won.scores], ['won', [b.speakerId], [{ speakerId: b.speakerId, points: 1 }]]);
  const next = await tv.type('hunt', 6000);
  assert.deepEqual([next.status, next.round], ['playing', 2], 'next round starts by itself');
  tv.send({ t: 'hunt_end' });
  assert.equal((await tv.next((m) => m.t === 'hunt' && m.status === 'done')).winners[0], b.speakerId);
  const log = readFileSync(join(s.dataDir, 'scans.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((r) => r.outcome), ['confirmed', 'manual']);
  // A phone joining mid-hunt gets the state.
  const late = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  late.send({ t: 'hello', v: 1, clientId: 'client_late', name: 'Late', lang: 'en-IN', engine: 'device' });
  await late.type('welcome');
  assert.equal((await late.type('hunt')).status, 'done');
  await s.app.close();
});

test('moments: TV request reaches phones; clip upload needs the token; range requests; clear deletes', async () => {
  const s = await setup();
  const tv = await tvFor(s);
  const p = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  p.send({ t: 'hello', v: 1, clientId: 'client_aaaa', name: 'Meena', lang: 'en-IN', engine: 'device' });
  const w = await p.type('welcome');
  assert.match(w.uploadToken, /^up_[a-f0-9]{32}$/);
  tv.send({ t: 'moment_now' });
  assert.deepEqual(await p.type('moment_request'), { t: 'moment_request' });

  const body = Buffer.alloc(10_000, 7);
  const q = (extra = '') => `${s.base}/api/clips?room=${s.created.room}&speaker=${w.speakerId}&tStart=1760000000000&durationMs=4000&reason=smile${extra}`;
  assert.equal((await fetch(q(), { method: 'POST', body, headers: { 'content-type': 'video/webm', 'x-rc-token': 'up_wrong' } })).status, 403);
  assert.equal((await fetch(q(), { method: 'POST', body, headers: { 'content-type': 'image/png', 'x-rc-token': w.uploadToken } })).status, 415);
  assert.equal((await fetch(q().replace('durationMs=4000', 'durationMs=0'), { method: 'POST', body, headers: { 'content-type': 'video/webm', 'x-rc-token': w.uploadToken } })).status, 400);
  const up = await fetch(q(), { method: 'POST', body, headers: { 'content-type': 'video/webm;codecs=vp8', 'x-rc-token': w.uploadToken } });
  assert.equal(up.status, 201);
  const clip = await tv.type('clip');
  assert.match(clip.url, new RegExp(`^/clips/${s.created.room}/[a-f0-9]{32}\\.webm$`));
  assert.equal(clip.speakerId, w.speakerId);
  const full = await fetch(s.base + clip.url);
  assert.equal(full.headers.get('content-type'), 'video/webm');
  assert.equal((await full.arrayBuffer()).byteLength, 10_000);
  const part = await fetch(s.base + clip.url, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/10000');
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(s.base + clip.url, { headers: { range: 'bytes=20000-' } })).status, 416);

  // A TV that reconnects gets the saved clips again.
  const tv2 = await Client.open(`${s.ws}/ws/tv?room=${s.created.room}`);
  tv2.send({ t: 'tv_hello', v: 1, room: s.created.room, token: s.created.token });
  await tv2.type('room');
  assert.equal((await tv2.type('clip')).id, clip.id);
  tv2.send({ t: 'clips_clear' });
  await tv2.type('clips_cleared');
  assert.equal((await fetch(s.base + clip.url)).status, 404);
  await s.app.close();
});

test('objects come into the TV: token, label and type checks, served image, replay to a new TV', async () => {
  const s = await setup();
  const tv = await tvFor(s);
  const p = await Client.open(`${s.ws}/ws/phone?room=${s.created.room}`);
  p.send({ t: 'hello', v: 1, clientId: 'client_kid1', name: 'Anu', lang: 'en-IN', engine: 'device' });
  const w = await p.type('welcome');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2000, 1)]);
  const q = (label: string) => `${s.base}/api/objects?room=${s.created.room}&speaker=${w.speakerId}&label=${encodeURIComponent(label)}`;
  const post = (label: string, type: string, token: string, body: Buffer = jpeg) => fetch(q(label), { method: 'POST', body, headers: { 'content-type': type, 'x-rc-token': token } });
  assert.equal((await post('teddy bear', 'image/jpeg', 'up_nope')).status, 403);
  assert.equal((await post('knife', 'image/jpeg', w.uploadToken)).status, 400);
  assert.equal((await post('teddy bear', 'image/png', w.uploadToken)).status, 415);
  assert.equal((await post('teddy bear', 'image/jpeg', w.uploadToken, Buffer.alloc(1_600_000))).status, 413);
  assert.equal((await post('teddy bear', 'image/jpeg', w.uploadToken)).status, 201);
  const obj = await tv.type('object');
  assert.deepEqual([obj.label, obj.speakerId], ['teddy bear', w.speakerId]);
  const img = await fetch(s.base + obj.url);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await img.arrayBuffer()).byteLength, jpeg.length);
  const tv2 = await Client.open(`${s.ws}/ws/tv?room=${s.created.room}`);
  tv2.send({ t: 'tv_hello', v: 1, room: s.created.room, token: s.created.token });
  await tv2.type('room');
  assert.equal((await tv2.type('object')).id, obj.id);
  await s.app.close();
});

test('channel endpoints answer 503 when not configured and pass through sources', async () => {
  const s = await setup();
  assert.equal((await fetch(s.base + '/api/channels/kids')).status, 503);
  await s.app.close();
  const dataDir = mkdtempSync(join(tmpdir(), 'rc-ch-'));
  const app = createApp({
    staticDir: dataDir, dataDir,
    sources: {
      kids: async () => [{ id: 'cereal', title: 'Cereal', description: '', video: 'https://example.org/c.mp4', poster: '', durationSec: 10 }],
      news: async () => null,
    },
  });
  const port = await app.listen(0, '127.0.0.1');
  const kids = (await (await fetch(`http://127.0.0.1:${port}/api/channels/kids`)).json()) as { items: { id: string }[] };
  assert.equal(kids.items[0].id, 'cereal');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/news`)).status, 503, 'a failed source is reported, not faked');
  await app.close();
});

test('help mode: TV raises, phones are alerted and re-alerted, one answers, then cancel', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'rc-help-'));
  const app = createApp({ staticDir: dataDir, dataDir, helpRepeatMs: 100 });
  const port = await app.listen(0, '127.0.0.1');
  try {
  const base = `ws://127.0.0.1:${port}`;
  const created = (await (await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST' })).json()) as RoomCreated;
  const s = { ws: base, created } as Awaited<ReturnType<typeof setup>>;
  const tv = await tvFor(s);
  const ravi = await phoneFor(s, 'Ravi', 'client_ravi');
  const meena = await phoneFor(s, 'Meena', 'client_meena');
  tv.send({ t: 'help_raise' });
  const a = await ravi.p.type('help');
  assert.deepEqual([a.status, a.byName, a.alerts], ['active', null, 1]);
  assert.equal((await tv.type('help')).status, 'active');
  const again = await meena.p.next((m) => m.t === 'help' && m.alerts >= 2, 2000);
  assert.equal(again.status, 'active', 'unanswered requests alert again');
  ravi.p.send({ t: 'help_ack' });
  const coming = await tv.next((m) => m.t === 'help' && m.status === 'coming');
  assert.equal(coming.comingName, 'Ravi');
  // A phone joining now still learns about it.
  const late = await phoneFor(s, 'Late', 'client_late');
  assert.equal((await late.p.type('help')).status, 'coming');
  tv.send({ t: 'help_cancel' });
  assert.equal((await meena.p.next((m) => m.t === 'help' && m.status === 'idle')).alerts, 0);
  // A phone can ask for help too (a parent with their own phone).
  meena.p.send({ t: 'help_raise' });
  assert.equal((await tv.next((m) => m.t === 'help' && m.status === 'active' && m.byName !== null)).byName, 'Meena');
  meena.p.send({ t: 'help_cancel' });
  await tv.next((m) => m.t === 'help' && m.status === 'idle');
  tv.send({ t: 'help_raise', who: 'Dadi' });
  assert.equal((await ravi.p.next((m) => m.t === 'help' && m.byName === 'Dadi')).status, 'active', 'phones say whose TV asked');
  const events = readFileSync(join(dataDir, 'help.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
  assert.deepEqual(events, ['raise', 'coming', 'cancel', 'raise', 'cancel', 'raise']);
  } finally {
    await app.close();
  }
});

test('personal sound: the TV says what is playing, phones hear it (and late joiners too), validated, cleared when the TV leaves', async () => {
  const s = await setup();
  try {
    const tv = await tvFor(s);
    const ravi = await phoneFor(s, 'Ravi', 'client_ravi');
    const kids = { id: 'kids', title: 'Space Pals', url: 'https://example.org/a.mp4', positionMs: 12_000, playing: true, at: 1_760_000_000_500 };
    tv.send({ t: 'now_playing', channels: [kids] });
    assert.deepEqual((await ravi.p.type('channels')).channels, [kids]);
    const late = await phoneFor(s, 'Late', 'client_late');
    assert.deepEqual((await late.p.type('channels')).channels, [kids], 'a phone that joins later can listen straight away');
    tv.send({ t: 'now_playing', channels: [{ ...kids, url: 'javascript:alert(1)' }] });
    assert.equal((await tv.type('error')).code, 'bad_message', 'only http(s) media URLs');
    tv.send({ t: 'now_playing', channels: [kids, kids] });
    assert.equal((await tv.type('error')).code, 'bad_message', 'one entry per channel');
    // A show change is a burst ("gone", then "next show at 0"): the last one always reaches phones.
    const next = { ...kids, title: 'Next show', url: 'https://example.org/b.mp4', positionMs: 0 };
    tv.send({ t: 'now_playing', channels: [] });
    tv.send({ t: 'now_playing', channels: [next] });
    assert.equal((await ravi.p.next((m) => m.t === 'channels' && m.channels[0]?.title === 'Next show')).channels[0].url, next.url);
    ravi.p.send({ t: 'now_playing', channels: [kids] });
    assert.equal((await ravi.p.type('error')).code, 'bad_message', 'phones cannot say what the TV plays');
    tv.close();
    assert.deepEqual((await ravi.p.next((m) => m.t === 'channels' && m.channels.length === 0)).channels, []);
  } finally {
    await s.app.close();
  }
});

test('disaster alerts: a nearby event reaches the TV and phones; far ones do not; test alerts need ALERT_TEST', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'rc-alert-'));
  const ev = (id: string, lat: number, lon: number, level: 'Green' | 'Orange' | 'Red', iso3: string) =>
    ({ id, kind: 'FL', level, title: `${level} flood ${id}`, country: iso3, iso3, lat, lon, bbox: null, url: 'https://www.gdacs.org/x', from: '' });
  let feed = [ev('FL1', 27.6, 85.4, 'Orange', 'NPL'), ev('EQ9', -30, 150, 'Red', 'AUS')];
  const app = createApp({
    staticDir: dataDir, dataDir,
    alerts: { poll: async () => feed, watch: { homeLat: 27.71, homeLon: 85.32, radiusKm: 100, countries: ['NPL'] }, intervalMs: 100, allowTest: false },
  });
  const port = await app.listen(0, '127.0.0.1');
  try {
    const created = (await (await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST' })).json()) as RoomCreated;
    const s = { ws: `ws://127.0.0.1:${port}`, created } as Awaited<ReturnType<typeof setup>>;
    const tv = await tvFor(s);
    const a = await tv.type('alert');
    assert.deepEqual([a.id, a.level, a.source, a.test], ['FL1', 'Orange', 'GDACS', false]);
    assert.match(a.why, /km from your home|inside the affected area/);
    const ph = await phoneFor(s, 'Ravi', 'client_ravi');
    assert.equal((await ph.p.type('alert')).id, 'FL1', 'a phone joining later still gets the live alert');
    feed = [...feed, ev('FL2', 27.7, 85.3, 'Red', 'NPL')];
    assert.equal((await tv.type('alert', 2000)).id, 'FL2', 'new alerts are pushed as they appear');
    assert.ok(!tv.msgs.some((m) => m.t === 'alert' && m.id === 'EQ9'), 'far-away events never alarm');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/alerts/test`, { method: 'POST' })).status, 403);
    const list = (await (await fetch(`http://127.0.0.1:${port}/api/alerts`)).json()) as { alerts: { id: string }[] };
    assert.deepEqual(list.alerts.map((x) => x.id), ['FL1', 'FL2']);
  } finally {
    await app.close();
  }
});

test('static files: index for / and /join/CODE, no path traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>phone</title>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  const s = await setup({ staticDir: dir });
  for (const p of ['/', `/join/${s.created.room}`]) {
    const r = await fetch(s.base + p);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /phone/);
  }
  const js = await fetch(s.base + '/assets/app.js');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(s.base + '/%2e%2e/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(s.base + '/..%5c..%5cpackage.json')).status, 404);
  await s.app.close();
});
