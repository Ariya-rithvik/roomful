// Roomcaption server: rooms, the phone and TV sockets, cross-talk resolution, spoken replies,
// and a latency log. One process on the family's own PC; no database, nothing stored except
// the reply-audio cache and the measurement log in dataDir.
import http from 'node:http';
import https from 'node:https';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  CLIP_REASONS, CrossTalkFilter, Hunt, MAX_AUDIO_FRAME_BYTES, MAX_JSON_BYTES, MAX_SPEAKERS, PROTOCOL_VERSION, SPEAKER_COLORS,
  generateRoomCode, isRoomCode, parsePhoneMessage, parseTvMessage, textSimilarity,
  isObjectLabel,
  type CaptionOut, type ClipInfo, type ClipReason, type ErrorCode, type ObjectArrived, type PhoneCaption, type PhoneHello, type ReplySay, type RoomCreated,
  type ChannelPlay, type DisasterAlert, type Scan, type ServerToPhone, type ServerToTv, type SpeakerInfo,
} from '@roomcaption/shared';
import { TtsCache, type TtsEngine } from './tts';
import type { ChannelItem, NewsItem } from './channels';
import { concerns, EVENT_KINDS, type GdacsEvent, type WatchConfig } from './alerts';
import type { SpeechEngine, SpeechSession } from './speech';

export interface AppOptions {
  /** Base URL phones open, e.g. https://192.168.1.5:8787 or a tunnel. Derived from the request when unset. */
  publicUrl?: string;
  /** Built phone web app (index.html + assets). */
  staticDir: string;
  /** Reply-audio cache and measurements.jsonl live here. */
  dataDir: string;
  tls?: { certFile: string; keyFile: string };
  tts?: TtsEngine;
  speech?: SpeechEngine;
  now?: () => number;
  random?: () => number;
  /** Rooms with nobody connected are removed after this long. */
  roomIdleMs?: number;
  /** Disaster alerts (see alerts.ts). poll returns current GDACS events, or null if the feed is unreachable. */
  alerts?: { poll: () => Promise<GdacsEvent[] | null>; watch: WatchConfig; intervalMs?: number; allowTest?: boolean };
  /** Kids channel and news sources (see channels.ts); unset = those endpoints answer 503. */
  sources?:{ kids: () => Promise<ChannelItem[] | null>; news: () => Promise<{ source: string; items: NewsItem[] } | null> };
  /**
   * Measurement sessions only: append every shown final caption's text to dataDir/captured.jsonl
   * so word error rate can be computed against a read-aloud script. Off by default; the phone's
   * consent text must say captions are being saved when this is on.
   */
  captureText?: boolean;
  helloTimeoutMs?: number;
  /** How often an unanswered help request re-alerts the phones (default 30 s). */
  helpRepeatMs?: number;
  log?: (m: string) => void;
}

interface Speaker {
  info: SpeakerInfo;
  clientId: string;
  uploadToken: string;
  ws: WebSocket | null;
  bucket: { tokens: number; at: number };
  audio: SpeechSession | null;
  audioStart: number;
  serverUtt: number;
  resultUtt: Map<string, number>;
}

interface Room {
  code: string;
  token: string;
  tv: WebSocket | null;
  speakers: Map<string, Speaker>;
  filter: CrossTalkFilter;
  /** Lines that lost a cross-talk decision or were echoes: later messages for them are ignored. */
  lost: BoundedSet;
  /** tRecv of shown finals, for the latency log. */
  recv: Map<string, number>;
  /** Replies spoken recently: a phone hearing the loudspeaker must not caption it as its owner's speech. */
  echo: { text: string; until: number }[];
  replyUtt: number;
  lastActive: number;
  hunt: Hunt;
  huntTimer: ReturnType<typeof setTimeout> | null;
  clips: ClipInfo[];
  objects: ObjectArrived[];
  /** What the TV is playing, for phones that listen along (personal sound). */
  channels: ChannelPlay[];
  channelsAt: number;
  channelsTimer: ReturnType<typeof setTimeout> | null;
  help: { status: 'idle' | 'active' | 'coming'; since: number | null; byName: string | null; comingName: string | null; alerts: number; timer: ReturnType<typeof setInterval> | null };
}

/** Fastest the TV's now_playing reports are passed on to phones. */
const CHANNEL_MIN_GAP_MS = 200;

/** While nobody has answered a help request, phones are alerted again this often, up to HELP_MAX_ALERTS times. */
const HELP_REPEAT_MS = 30_000;
const HELP_MAX_ALERTS = 20;

const MAX_OBJECTS_PER_ROOM = 24;
const MAX_OBJECT_BYTES = 1_500_000;

/** Saved clips per room; the oldest are deleted beyond this. */
const MAX_CLIPS_PER_ROOM = 60;
const MAX_CLIP_BYTES = 8 * 1024 * 1024;
/** After a round is won the next prompt appears on its own. */
const HUNT_NEXT_DELAY_MS = 4000;

class BoundedSet {
  private order: string[] = [];
  private set = new Set<string>();
  constructor(private readonly cap = 2000) {}
  add(k: string) {
    if (this.set.has(k)) return;
    this.set.add(k);
    this.order.push(k);
    if (this.order.length > this.cap) this.set.delete(this.order.shift()!);
  }
  has(k: string) {
    return this.set.has(k);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
};

const RATE_PER_SEC = 25;
const RATE_BURST = 50;
const ECHO_MS = 15_000;
const ECHO_SIMILARITY = 0.6;
const REPLY_UTT_BASE = 2_000_000_000;

const id = (prefix: string, bytes: number) => prefix + randomBytes(bytes).toString('hex');
const lineKey = (speakerId: string, utt: number) => `${speakerId}:${utt}`;

export function createApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const log = opts.log ?? (() => {});
  const roomIdleMs = opts.roomIdleMs ?? 2 * 60 * 60_000;
  const helloTimeoutMs = opts.helloTimeoutMs ?? 5000;
  const rooms = new Map<string, Room>();
  mkdirSync(opts.dataDir, { recursive: true });
  const tts = opts.tts ? new TtsCache(opts.tts, join(opts.dataDir, 'audio')) : null;
  const measureFile = join(opts.dataDir, 'measurements.jsonl');
  let httpsPort = 0;

  // ---------- helpers ----------

  const send = (ws: WebSocket | null, msg: ServerToPhone | ServerToTv) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const sendError = (ws: WebSocket, code: ErrorCode, message: string) => send(ws, { t: 'error', code, message });

  function roomState(room: Room): ServerToTv {
    return { t: 'room', room: room.code, joinUrl: joinUrl(room.code), speakers: [...room.speakers.values()].map((s) => ({ ...s.info })) };
  }
  const pushRoom = (room: Room) => send(room.tv, roomState(room));

  let lastHost = 'localhost';
  function joinUrl(code: string): string {
    const base = opts.publicUrl
      ? opts.publicUrl.replace(/\/+$/, '')
      : opts.tls
        ? `https://${lastHost.replace(/:\d+$/, '')}:${httpsPort}`
        : `http://${lastHost}`;
    return `${base}/join/${code}`;
  }

  function createRoom(): Room {
    let code = generateRoomCode(random);
    for (let i = 0; rooms.has(code) && i < 50; i++) code = generateRoomCode(random);
    if (rooms.has(code)) throw new Error('could not allocate a room code');
    const room: Room = {
      code, token: id('tok_', 16), tv: null, speakers: new Map(), filter: new CrossTalkFilter(), lost: new BoundedSet(),
      recv: new Map(), echo: [], replyUtt: REPLY_UTT_BASE, lastActive: now(), hunt: new Hunt(), huntTimer: null, clips: [], objects: [], channels: [], channelsAt: 0, channelsTimer: null,
      help: { status: 'idle', since: null, byName: null, comingName: null, alerts: 0, timer: null },
    };
    rooms.set(code, room);
    log(`room ${code} created`);
    return room;
  }

  function allowed(sp: Speaker): boolean {
    const t = now();
    const b = sp.bucket;
    b.tokens = Math.min(RATE_BURST, b.tokens + ((t - b.at) / 1000) * RATE_PER_SEC);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // ---------- captions ----------

  function onCaption(room: Room, sp: Speaker, m: PhoneCaption): void {
    const tRecv = now();
    room.lastActive = tRecv;
    const speakerId = sp.info.speakerId;
    const key = lineKey(speakerId, m.utt);
    if (room.lost.has(key)) return;
    // A phone clock that is badly off must not push lines into the future.
    const tStart = Math.min(m.tStart, tRecv);
    const out: CaptionOut = { t: 'caption', speakerId, utt: m.utt, text: m.text, final: m.final, lang: m.lang, tStart, tRecv };
    if (!m.final || m.text.trim() === '') {
      send(room.tv, out);
      return;
    }
    room.echo = room.echo.filter((e) => e.until > tRecv);
    if (room.echo.some((e) => textSimilarity(e.text, m.text) >= ECHO_SIMILARITY)) {
      room.lost.add(key);
      send(room.tv, { t: 'drop', speakerId, utt: m.utt, reason: 'duplicate' });
      return;
    }
    const d = room.filter.offer({ speakerId, utt: m.utt, text: m.text, tStart, tRecv, level: m.level, conf: m.conf });
    if (!d.keep) {
      room.lost.add(key);
      send(room.tv, { t: 'drop', speakerId, utt: m.utt, reason: 'duplicate' });
      return;
    }
    for (const x of d.drop) {
      room.lost.add(lineKey(x.speakerId, x.utt));
      send(room.tv, { t: 'drop', speakerId: x.speakerId, utt: x.utt, reason: 'duplicate' });
    }
    send(room.tv, out);
    if (opts.captureText) {
      const row = { room: room.code, speakerId, name: sp.info.name, lang: m.lang, utt: m.utt, text: m.text, tStart, tRecv };
      try {
        appendFileSync(join(opts.dataDir, 'captured.jsonl'), JSON.stringify(row) + '\n');
      } catch (e) {
        log(`capture write failed: ${(e as Error).message}`);
      }
    }
    room.recv.set(key, tRecv);
    if (room.recv.size > 1000) room.recv.delete(room.recv.keys().next().value!);
  }

  async function onReply(room: Room, m: ReplySay): Promise<void> {
    const sp = room.speakers.get(m.speakerId);
    if (!sp) {
      send(room.tv, { t: 'reply_status', speakerId: m.speakerId, text: m.text, status: 'failed', reason: 'unknown speaker' });
      return;
    }
    const t = now();
    room.lastActive = t;
    room.echo.push({ text: m.text, until: t + ECHO_MS });
    send(room.tv, { t: 'caption', speakerId: m.speakerId, utt: room.replyUtt++, text: m.text, final: true, lang: m.lang, tStart: t, tRecv: t, reply: true });
    if (!tts) {
      send(room.tv, { t: 'reply_status', speakerId: m.speakerId, text: m.text, status: 'failed', reason: 'no voice configured' });
      return;
    }
    try {
      const hash = await tts.get(m.text, m.lang);
      if (!sp.ws || sp.ws.readyState !== WebSocket.OPEN) throw new Error('phone not connected');
      send(sp.ws, { t: 'play', url: `/audio/${hash}.mp3`, text: m.text });
      send(room.tv, { t: 'reply_status', speakerId: m.speakerId, text: m.text, status: 'speaking' });
    } catch (e) {
      const reason = (e as Error).message.slice(0, 200);
      log(`reply failed: ${reason}`);
      send(room.tv, { t: 'reply_status', speakerId: m.speakerId, text: m.text, status: 'failed', reason });
    }
  }

  // ---------- Table Hunt ----------

  function broadcastHunt(room: Room): void {
    const msg = { t: 'hunt' as const, ...room.hunt.view() };
    send(room.tv, msg);
    for (const s of room.speakers.values()) send(s.ws, msg);
  }

  function clearHuntTimer(room: Room): void {
    if (room.huntTimer) clearTimeout(room.huntTimer);
    room.huntTimer = null;
  }

  function onHuntCommand(room: Room, cmd: 'start' | 'next' | 'end', start?: { rounds: number; seed: number }): void {
    clearHuntTimer(room);
    if (cmd === 'start' && start) room.hunt.start(start.seed, start.rounds);
    else if (cmd === 'next') room.hunt.next();
    else room.hunt.end();
    room.lastActive = now();
    broadcastHunt(room);
  }

  function onScan(room: Room, sp: Speaker, m: Scan): void {
    const verdict = room.hunt.scan(sp.info.speakerId, m.label);
    const row = {
      room: room.code, speakerId: sp.info.speakerId, label: m.label, detected: m.detected ?? null, conf: m.conf ?? null, outcome: m.outcome,
      accepted: verdict.accepted, ok: verdict.accepted ? verdict.ok : null, t: now(),
    };
    try {
      appendFileSync(join(opts.dataDir, 'scans.jsonl'), JSON.stringify(row) + '\n');
    } catch (e) {
      log(`scan log write failed: ${(e as Error).message}`);
    }
    if (!verdict.accepted) return;
    send(room.tv, { t: 'scan_result', speakerId: sp.info.speakerId, label: m.label, ok: verdict.ok, outcome: m.outcome });
    if (verdict.roundWon) {
      broadcastHunt(room);
      clearHuntTimer(room);
      room.huntTimer = setTimeout(() => {
        room.huntTimer = null;
        room.hunt.next();
        broadcastHunt(room);
      }, HUNT_NEXT_DELAY_MS);
      room.huntTimer.unref?.();
    }
  }

  // ---------- disaster alerts (the TV keeps watch) ----------

  const alertsOn = new Map<string, DisasterAlert & { at: number }>();
  const ALERT_KEEP_MS = 24 * 60 * 60_000;
  const liveAlerts = (): DisasterAlert[] =>
    [...alertsOn.values()].filter((a) => now() - a.at < ALERT_KEEP_MS).map(({ at: _at, ...a }) => a);

  function raiseAlert(a: DisasterAlert): void {
    if (alertsOn.has(a.id)) return;
    alertsOn.set(a.id, { ...a, at: now() });
    log(`ALERT ${a.test ? '(TEST) ' : ''}${a.level} ${a.kind}: ${a.title} (${a.why})`);
    try {
      appendFileSync(join(opts.dataDir, 'alerts.jsonl'), JSON.stringify({ ...a, at: now() }) + '\n');
    } catch {
      /* logging is best effort */
    }
    for (const room of rooms.values()) {
      send(room.tv, a);
      for (const s of room.speakers.values()) send(s.ws, a);
    }
  }

  let lastAlertPoll: { at: number; ok: boolean; events: number; matching: number } | null = null;
  async function pollAlerts(): Promise<void> {
    if (!opts.alerts) return;
    const events = await opts.alerts.poll().catch(() => null);
    if (!events) {
      lastAlertPoll = { at: now(), ok: false, events: 0, matching: 0 };
      return;
    }
    let matching = 0;
    for (const e of events) {
      const c = concerns(e, opts.alerts.watch);
      if (!c.yes) continue;
      matching++;
      raiseAlert({
        t: 'alert', id: e.id.slice(0, 64), kind: e.kind.slice(0, 8) || 'XX', level: e.level,
        title: `${EVENT_KINDS[e.kind] ?? 'Disaster'}: ${e.title}`.slice(0, 300), country: e.country.slice(0, 160) || '—',
        why: c.why.slice(0, 200), url: e.url.startsWith('https://') ? e.url.slice(0, 300) : '', source: 'GDACS', test: false,
      });
    }
    lastAlertPoll = { at: now(), ok: true, events: events.length, matching };
  }
  const alertTimer = opts.alerts ? setInterval(() => void pollAlerts(), opts.alerts.intervalMs ?? 5 * 60_000) : null;
  alertTimer?.unref?.();
  if (opts.alerts) void pollAlerts();

  // ---------- Help mode ----------

  const helpState = (room: Room) => {
    const h = room.help;
    return { t: 'help' as const, status: h.status, since: h.since, byName: h.byName, comingName: h.comingName, alerts: h.alerts };
  };
  /**
   * Keep the latest report and pass it on to phones. Bursts (a TV changing show sends "gone" then "new
   * show" within a millisecond) are coalesced: never more than one message per CHANNEL_MIN_GAP_MS,
   * and the last report of a burst is always delivered.
   */
  function setChannels(room: Room, channels: ChannelPlay[]): void {
    if (channels.length === 0 && room.channels.length === 0 && !room.channelsTimer) return;
    room.channels = channels;
    if (room.channelsTimer) return; // the pending flush will send the latest
    const wait = room.channelsAt + CHANNEL_MIN_GAP_MS - now();
    const flush = () => {
      room.channelsTimer = null;
      room.channelsAt = now();
      for (const s of room.speakers.values()) send(s.ws, { t: 'channels', channels: room.channels });
    };
    if (wait <= 0) return void flush();
    room.channelsTimer = setTimeout(flush, Math.min(wait, CHANNEL_MIN_GAP_MS));
    room.channelsTimer.unref?.();
  }

  function broadcastHelp(room: Room): void {
    const msg = helpState(room);
    send(room.tv, msg);
    for (const s of room.speakers.values()) send(s.ws, msg);
  }
  function logHelp(room: Room, event: string, who: string | null): void {
    try {
      appendFileSync(join(opts.dataDir, 'help.jsonl'), JSON.stringify({ room: room.code, event, who, t: now() }) + '\n');
    } catch (e) {
      log(`help log write failed: ${(e as Error).message}`);
    }
  }
  function stopHelpTimer(room: Room): void {
    if (room.help.timer) clearInterval(room.help.timer);
    room.help.timer = null;
  }
  function onHelp(room: Room, action: 'raise' | 'ack' | 'cancel', who: Speaker | null, tvOwner?: string): void {
    const h = room.help;
    const name = who?.info.name ?? tvOwner?.trim() ?? null;
    room.lastActive = now();
    if (action === 'raise') {
      if (h.status !== 'idle') return void broadcastHelp(room); // already raised: just resend
      Object.assign(h, { status: 'active', since: now(), byName: name, comingName: null, alerts: 1 });
      logHelp(room, 'raise', name ?? 'tv');
      log(`room ${room.code}: HELP requested by ${name ?? 'the TV remote'}`);
      stopHelpTimer(room);
      h.timer = setInterval(() => {
        if (h.status !== 'active' || h.alerts >= HELP_MAX_ALERTS) return stopHelpTimer(room);
        h.alerts++;
        broadcastHelp(room);
      }, opts.helpRepeatMs ?? HELP_REPEAT_MS);
      h.timer.unref?.();
    } else if (action === 'ack') {
      if (h.status === 'idle') return;
      Object.assign(h, { status: 'coming', comingName: name });
      stopHelpTimer(room);
      logHelp(room, 'coming', name);
    } else {
      if (h.status === 'idle') return;
      stopHelpTimer(room);
      Object.assign(h, { status: 'idle', since: null, byName: null, comingName: null, alerts: 0 });
      logHelp(room, 'cancel', name ?? 'tv');
    }
    broadcastHelp(room);
  }

  // ---------- happy-moment clips ----------

  const clipDir = (code: string) => join(opts.dataDir, 'clips', code);

  function addClip(room: Room, clip: ClipInfo): void {
    room.clips.push(clip);
    while (room.clips.length > MAX_CLIPS_PER_ROOM) {
      const old = room.clips.shift()!;
      try {
        unlinkSync(join(clipDir(room.code), old.url.split('/').pop()!));
      } catch {
        /* already gone */
      }
    }
    send(room.tv, clip);
  }

  function clearClips(room: Room): void {
    room.clips = [];
    try {
      rmSync(clipDir(room.code), { recursive: true, force: true });
    } catch (e) {
      log(`clip delete failed: ${(e as Error).message}`);
    }
    send(room.tv, { t: 'clips_cleared' });
  }

  async function onClipUpload(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const room = rooms.get(url.searchParams.get('room') ?? '');
    const sp = room?.speakers.get(url.searchParams.get('speaker') ?? '');
    const token = req.headers['x-rc-token'];
    if (!room || !sp || typeof token !== 'string' || token !== sp.uploadToken) return json(res, 403, { error: 'not allowed' });
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const ext = type === 'video/webm' ? 'webm' : type === 'video/mp4' ? 'mp4' : null;
    if (!ext) return json(res, 415, { error: 'video/webm or video/mp4 only' });
    const reason = (url.searchParams.get('reason') ?? 'smile') as ClipReason;
    const tStart = Number(url.searchParams.get('tStart'));
    const durationMs = Math.round(Number(url.searchParams.get('durationMs')));
    if (!(CLIP_REASONS as readonly string[]).includes(reason) || !Number.isFinite(tStart) || tStart <= 0 || !(durationMs > 0 && durationMs <= 60_000)) {
      return json(res, 400, { error: 'bad clip metadata' });
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_CLIP_BYTES) return json(res, 413, { error: 'clip too large' });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_CLIP_BYTES) return json(res, 413, { error: 'clip too large' });
      chunks.push(c as Buffer);
    }
    if (size === 0) return json(res, 400, { error: 'empty clip' });
    const cid = randomBytes(16).toString('hex');
    mkdirSync(clipDir(room.code), { recursive: true });
    writeFileSync(join(clipDir(room.code), `${cid}.${ext}`), Buffer.concat(chunks));
    const clip: ClipInfo = { t: 'clip', id: cid, speakerId: sp.info.speakerId, url: `/clips/${room.code}/${cid}.${ext}`, tStart: Math.min(tStart, now()), durationMs, reason };
    room.lastActive = now();
    addClip(room, clip);
    log(`room ${room.code}: clip ${cid} from ${sp.info.speakerId} (${reason}, ${Math.round(size / 1024)} KB)`);
    return json(res, 201, { id: cid, url: clip.url });
  }

  // ---------- objects brought "into the TV" ----------

  const objectDir = (code: string) => join(opts.dataDir, 'objects', code);

  async function onObjectUpload(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const room = rooms.get(url.searchParams.get('room') ?? '');
    const sp = room?.speakers.get(url.searchParams.get('speaker') ?? '');
    const token = req.headers['x-rc-token'];
    if (!room || !sp || typeof token !== 'string' || token !== sp.uploadToken) return json(res, 403, { error: 'not allowed' });
    const label = url.searchParams.get('label');
    if (!isObjectLabel(label)) return json(res, 400, { error: 'unknown object' });
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : null;
    if (!ext) return json(res, 415, { error: 'image/jpeg or image/webp only' });
    const body = await readBody(req, MAX_OBJECT_BYTES);
    if (body === 'too_large') return json(res, 413, { error: 'image too large' });
    if (!body.length) return json(res, 400, { error: 'empty image' });
    const oid = randomBytes(16).toString('hex');
    mkdirSync(objectDir(room.code), { recursive: true });
    writeFileSync(join(objectDir(room.code), `${oid}.${ext}`), body);
    const msg: ObjectArrived = { t: 'object', id: oid, speakerId: sp.info.speakerId, label, url: `/objects/${room.code}/${oid}.${ext}` };
    room.objects.push(msg);
    while (room.objects.length > MAX_OBJECTS_PER_ROOM) {
      const old = room.objects.shift()!;
      try {
        unlinkSync(join(objectDir(room.code), old.url.split('/').pop()!));
      } catch {
        /* gone */
      }
    }
    room.lastActive = now();
    send(room.tv, msg);
    log(`room ${room.code}: ${sp.info.speakerId} brought a ${label} into the TV`);
    return json(res, 201, { id: oid, url: msg.url });
  }

  async function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | 'too_large'> {
    if (Number(req.headers['content-length'] ?? 0) > max) return 'too_large';
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > max) return 'too_large';
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /** Serves a clip with HTTP Range support (video players on TV seek with range requests). */
  function serveClip(req: http.IncomingMessage, res: http.ServerResponse, code: string, file: string): void {
    const path = join(clipDir(code), file);
    if (!existsSync(path)) return json(res, 404, { error: 'not found' });
    const size = statSync(path).size;
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', 'access-control-allow-origin': '*' };
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return void res.end();
      }
      end = Math.min(end, size - 1);
      start = Math.max(0, start);
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return void res.end();
      return void createReadStream(path, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'content-length': size });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(path).pipe(res);
  }

  // ---------- phone socket ----------

  function onPhoneHello(room: Room, ws: WebSocket, m: PhoneHello): Speaker | null {
    let sp = [...room.speakers.values()].find((s) => s.clientId === m.clientId) ?? null;
    if (sp) {
      if (sp.ws && sp.ws !== ws) sp.ws.close(4000, 'replaced by a newer connection');
      sp.audio?.end();
      sp.audio = null;
    } else {
      if (room.speakers.size >= MAX_SPEAKERS) {
        sendError(ws, 'room_full', `This room already has ${MAX_SPEAKERS} people.`);
        ws.close(4001, 'room full');
        return null;
      }
      const used = new Set([...room.speakers.values()].map((s) => s.info.color));
      const color = SPEAKER_COLORS.find((c) => !used.has(c)) ?? SPEAKER_COLORS[room.speakers.size % SPEAKER_COLORS.length];
      sp = {
        info: { speakerId: id('spk_', 4), name: m.name, lang: m.lang, color, engine: m.engine, connected: true },
        clientId: m.clientId, uploadToken: id('up_', 16), ws, bucket: { tokens: RATE_BURST, at: now() }, audio: null, audioStart: 0, serverUtt: 0, resultUtt: new Map(),
      };
      room.speakers.set(sp.info.speakerId, sp);
    }
    sp.ws = ws;
    sp.info = { ...sp.info, name: m.name.trim(), lang: m.lang, engine: m.engine, connected: true };
    room.lastActive = now();
    send(ws, { t: 'welcome', v: PROTOCOL_VERSION, room: room.code, speakerId: sp.info.speakerId, color: sp.info.color, serverTime: now(), uploadToken: sp.uploadToken });
    if (m.engine === 'server' && !opts.speech) sendError(ws, 'engine_unavailable', 'Server speech recognition is not available. Using this phone instead.');
    if (room.hunt.view().status !== 'idle') send(ws, { t: 'hunt', ...room.hunt.view() });
    if (room.help.status !== 'idle') send(ws, helpState(room));
    for (const a of liveAlerts()) send(ws, a);
    if (room.channels.length) send(ws, { t: 'channels', channels: room.channels });
    pushRoom(room);
    log(`room ${room.code}: ${sp.info.speakerId} (${sp.info.lang}, ${sp.info.engine}) joined`);
    return sp;
  }

  function attachPhone(room: Room, ws: WebSocket): void {
    // Without an error listener an oversized or malformed frame would crash the process.
    ws.on('error', (e) => log(`phone socket error: ${e.message}`));
    let sp: Speaker | null = null;
    const timer = setTimeout(() => {
      if (!sp) ws.close(4002, 'no hello');
    }, helloTimeoutMs);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return void ws.close(1003, 'binary frames are not accepted here');
      const parsed = parsePhoneMessage(data.toString());
      if (!parsed.ok) return void sendError(ws, 'bad_message', parsed.error);
      const m = parsed.msg;
      if (m.t === 'ping') return void send(ws, { t: 'pong', id: m.id, tClient: m.tClient, tServer: now() });
      if (m.t === 'hello') {
        sp = onPhoneHello(room, ws, m);
        if (sp) clearTimeout(timer);
        return;
      }
      if (!sp || sp.ws !== ws) return void sendError(ws, 'not_joined', 'Send hello first.');
      if (!allowed(sp)) return void sendError(ws, 'rate_limited', 'Too many messages.');
      if (m.t === 'scan') return void onScan(room, sp, m);
      if (m.t === 'help_raise') return void onHelp(room, 'raise', sp);
      if (m.t === 'help_ack') return void onHelp(room, 'ack', sp);
      if (m.t === 'help_cancel') return void onHelp(room, 'cancel', sp);
      if (m.t === 'missed') return void send(room.tv, { t: 'recover', byName: sp.info.name });
      onCaption(room, sp, m);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (sp && sp.ws === ws) {
        sp.ws = null;
        sp.info = { ...sp.info, connected: false };
        sp.audio?.end();
        sp.audio = null;
        room.lastActive = now();
        pushRoom(room);
      }
    });
  }

  // ---------- phone audio socket (engine 'server') ----------

  function attachAudio(room: Room, sp: Speaker, ws: WebSocket): void {
    ws.on('error', (e) => log(`audio socket error: ${e.message}`));
    if (!opts.speech) {
      sendError(sp.ws ?? ws, 'engine_unavailable', 'Server speech recognition is not available.');
      return void ws.close(4003, 'engine unavailable');
    }
    sp.audio?.end();
    sp.audioStart = now();
    sp.resultUtt.clear();
    const session = opts.speech.start(
      sp.info.lang,
      (r) => {
        let utt = sp.resultUtt.get(r.id);
        if (utt === undefined) {
          utt = sp.serverUtt++;
          sp.resultUtt.set(r.id, utt);
        }
        onCaption(room, sp, { t: 'caption', utt, seq: 0, text: r.text.slice(0, 500), final: r.final, lang: sp.info.lang, tStart: sp.audioStart + r.startOffsetMs });
      },
      (e) => {
        log(`speech engine error for ${sp.info.speakerId}: ${e.message}`);
        if (sp.ws) sendError(sp.ws, 'engine_unavailable', 'Server speech recognition failed. Using this phone instead.');
        ws.close(4003, 'engine error');
      },
    );
    sp.audio = session;
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) return void ws.close(1003, 'audio only');
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      if (buf.length === 0 || buf.length % 2 !== 0) return;
      session.write(buf);
    });
    ws.on('close', () => {
      session.end();
      if (sp.audio === session) sp.audio = null;
    });
  }

  // ---------- TV socket ----------

  function attachTv(room: Room, ws: WebSocket): void {
    ws.on('error', (e) => log(`tv socket error: ${e.message}`));
    let authed = false;
    const timer = setTimeout(() => {
      if (!authed) ws.close(4002, 'no hello');
    }, helloTimeoutMs);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return void ws.close(1003, 'binary frames are not accepted here');
      const parsed = parseTvMessage(data.toString());
      if (!parsed.ok) return void sendError(ws, 'bad_message', parsed.error);
      const m = parsed.msg;
      if (m.t === 'ping') return void send(ws, { t: 'pong', id: m.id, tClient: m.tClient, tServer: now() });
      if (m.t === 'tv_hello') {
        if (m.room !== room.code || m.token !== room.token) {
          sendError(ws, 'unauthorized', 'Wrong room token.');
          return void ws.close(4004, 'unauthorized');
        }
        authed = true;
        clearTimeout(timer);
        if (room.tv && room.tv !== ws) room.tv.close(4000, 'replaced by a newer TV connection');
        room.tv = ws;
        room.lastActive = now();
        send(ws, roomState(room));
        for (const c of room.clips) send(ws, c);
        for (const o of room.objects) send(ws, o);
        for (const a of liveAlerts()) send(ws, a);
        if (room.help.status !== 'idle') send(ws, helpState(room));
        if (room.hunt.view().status !== 'idle') send(ws, { t: 'hunt', ...room.hunt.view() });
        return;
      }
      if (!authed) return void sendError(ws, 'unauthorized', 'Send tv_hello first.');
      if (m.t === 'reply_say') return void onReply(room, m);
      if (m.t === 'hunt_start') return void onHuntCommand(room, 'start', { rounds: m.rounds, seed: m.seed });
      if (m.t === 'hunt_next') return void onHuntCommand(room, 'next');
      if (m.t === 'hunt_end') return void onHuntCommand(room, 'end');
      if (m.t === 'moment_now') {
        for (const s of room.speakers.values()) send(s.ws, { t: 'moment_request' });
        return;
      }
      if (m.t === 'clips_clear') return void clearClips(room);
      if (m.t === 'now_playing') return void setChannels(room, m.channels);
      if (m.t === 'help_raise') return void onHelp(room, 'raise', null, m.who);
      if (m.t === 'help_cancel') return void onHelp(room, 'cancel', null);
      if (m.t === 'measure') {
        const key = lineKey(m.speakerId, m.utt);
        const tRecv = room.recv.get(key);
        const row = {
          room: room.code, speakerId: m.speakerId, utt: m.utt, tStart: m.tStart, tRecv: tRecv ?? null, tRender: m.tRender,
          endToEndMs: Math.round(m.tRender - m.tStart), phoneToServerMs: tRecv === undefined ? null : Math.round(tRecv - m.tStart),
        };
        try {
          appendFileSync(measureFile, JSON.stringify(row) + '\n');
        } catch (e) {
          log(`measure write failed: ${(e as Error).message}`);
        }
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (room.tv === ws) {
        room.tv = null;
        // Nothing plays without the TV: tell listening phones to stop rather than drift on alone.
        setChannels(room, []);
      }
      room.lastActive = now();
    });
  }

  // ---------- HTTP ----------

  const staticRoot = resolve(opts.staticDir);

  function serveFile(res: http.ServerResponse, file: string, cache: string): void {
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': cache, 'x-content-type-options': 'nosniff' });
    res.end(readFileSync(file));
  }

  function json(res: http.ServerResponse, status: number, body: unknown): void {
    // Any origin: the web build of the TV app runs on another port. No cookies or credentials are used,
    // and the room token is only ever returned to whoever created the room.
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body));
  }

  const handler: http.RequestListener = (req, res) => {
    try {
      if (req.headers.host) lastHost = req.headers.host;
      const url = new URL(req.url ?? '/', 'http://x');
      const p = url.pathname;
      if (p.startsWith('/api/') && req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-max-age': '600' });
        return void res.end();
      }
      if (p === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, version: PROTOCOL_VERSION, speech: opts.speech?.name ?? null, tts: !!tts, capturing: !!opts.captureText });
      if (p === '/api/rooms' && req.method === 'POST') {
        const room = createRoom();
        const body: RoomCreated = { room: room.code, token: room.token, joinUrl: joinUrl(room.code) };
        return json(res, 201, body);
      }
      if (p === '/api/clips' && req.method === 'POST') {
        onClipUpload(req, res, url).catch((e: Error) => {
          log(`clip upload failed: ${e.message}`);
          if (!res.headersSent) json(res, 500, { error: 'upload failed' });
        });
        return;
      }
      if (p === '/api/alerts' && req.method === 'GET') {
        return json(res, 200, { watching: !!opts.alerts, watch: opts.alerts?.watch ?? null, lastPoll: lastAlertPoll, alerts: liveAlerts() });
      }
      if (p === '/api/alerts/test' && req.method === 'POST') {
        if (!opts.alerts?.allowTest) return json(res, 403, { error: 'test alerts are off (start the server with ALERT_TEST=1)' });
        const id = `TEST-${now()}`;
        raiseAlert({
          t: 'alert', id, kind: 'FL', level: 'Orange', title: 'TEST: Flood warning for your area (a drill, not a real alert)',
          country: 'Test', why: 'drill started from the family computer', url: '', source: 'TEST', test: true,
        });
        return json(res, 201, { id });
      }
      const roomCheck = /^\/api\/rooms\/([A-Z0-9]{4})$/.exec(p);
      if (roomCheck && req.method === 'GET') {
        // Lets a phone or TV tell "room ended (server restarted)" apart from "network blip".
        return rooms.has(roomCheck[1]) ? json(res, 200, { room: roomCheck[1], open: true }) : json(res, 404, { error: 'room not found' });
      }
      if (p === '/api/objects' && req.method === 'POST') {
        onObjectUpload(req, res, url).catch((e: Error) => {
          log(`object upload failed: ${e.message}`);
          if (!res.headersSent) json(res, 500, { error: 'upload failed' });
        });
        return;
      }
      if ((p === '/api/channels/kids' || p === '/api/channels/family' || p === '/api/news') && req.method === 'GET') {
        // ChannelSources widens AppOptions['sources'] with the optional family channel.
        const sources: import('./channels').ChannelSources | undefined = opts.sources;
        const load = p === '/api/news' ? sources?.news : p === '/api/channels/family' ? sources?.family : sources?.kids;
        if (!load) return json(res, 503, { error: 'not configured' });
        load()
          .then((v) => (v ? json(res, 200, p === '/api/news' ? v : { items: v }) : json(res, 503, { error: 'source unavailable' })))
          .catch(() => json(res, 503, { error: 'source unavailable' }));
        return;
      }
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      const clip = /^\/clips\/([A-Z0-9]{4})\/([a-f0-9]{32}\.(?:webm|mp4))$/.exec(p);
      if (clip && (req.method === 'GET' || req.method === 'HEAD')) return serveClip(req, res, clip[1], clip[2]);
      const obj = /^\/objects\/([A-Z0-9]{4})\/([a-f0-9]{32}\.(?:jpg|webp))$/.exec(p);
      if (obj && req.method === 'GET') {
        const file = join(objectDir(obj[1]), obj[2]);
        if (!existsSync(file)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': obj[2].endsWith('.jpg') ? 'image/jpeg' : 'image/webp', 'cache-control': 'private, max-age=3600', 'access-control-allow-origin': '*' });
        return void res.end(readFileSync(file));
      }
      const audio = /^\/audio\/([a-f0-9]{64})\.mp3$/.exec(p);
      if (audio && req.method === 'GET') {
        const buf = tts?.read(audio[1]);
        if (!buf) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=86400' });
        return void res.end(buf);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      const index = join(staticRoot, 'index.html');
      if (p === '/' || /^\/join\/[A-Z0-9]{4}\/?$/.test(p)) {
        if (!existsSync(index)) return json(res, 503, { error: 'phone app not built: run npm run build:phone' });
        return serveFile(res, index, 'no-cache');
      }
      const file = resolve(staticRoot, '.' + decodeURIComponent(p));
      if (!file.startsWith(staticRoot + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
      return serveFile(res, file, p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    } catch (e) {
      log(`http error: ${(e as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: 'server error' });
      else res.end();
    }
  };

  // ---------- WebSocket routing ----------

  const jsonWss = new WebSocketServer({ noServer: true, maxPayload: MAX_JSON_BYTES });
  const audioWss = new WebSocketServer({ noServer: true, maxPayload: MAX_AUDIO_FRAME_BYTES });

  function onUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://x');
    const code = url.searchParams.get('room') ?? '';
    const room = isRoomCode(code) ? rooms.get(code) : undefined;
    const reject = (status: number) => {
      socket.write(`HTTP/1.1 ${status} ${status === 404 ? 'Not Found' : 'Bad Request'}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname === '/ws/phone') {
      if (!room) return reject(404);
      return void jsonWss.handleUpgrade(req, socket, head, (ws) => attachPhone(room, ws));
    }
    if (url.pathname === '/ws/tv') {
      if (!room) return reject(404);
      return void jsonWss.handleUpgrade(req, socket, head, (ws) => attachTv(room, ws));
    }
    if (url.pathname === '/ws/phone-audio') {
      const sp = room?.speakers.get(url.searchParams.get('speaker') ?? '');
      if (!room || !sp || sp.info.engine !== 'server') return reject(404);
      return void audioWss.handleUpgrade(req, socket, head, (ws) => attachAudio(room, sp, ws));
    }
    reject(404);
  }

  // ---------- lifecycle ----------

  const servers: http.Server[] = [];
  const sweep = setInterval(() => {
    const t = now();
    for (const [code, room] of rooms) {
      const anyone = room.tv !== null || [...room.speakers.values()].some((s) => s.ws !== null);
      if (!anyone && t - room.lastActive > roomIdleMs) {
        rooms.delete(code);
        clearHuntTimer(room);
        stopHelpTimer(room);
        // Saved moments belong to that evening: they go when the room goes.
        if (room.clips.length) clearClips(room);
        rmSync(objectDir(code), { recursive: true, force: true });
        log(`room ${code} expired`);
      }
    }
  }, 60_000);
  sweep.unref();

  function start(server: http.Server, port: number, host?: string): Promise<number> {
    server.on('upgrade', onUpgrade);
    servers.push(server);
    return new Promise((ok, fail) => {
      server.once('error', fail);
      server.listen(port, host, () => ok((server.address() as { port: number }).port));
    });
  }

  return {
    rooms,
    /** Main listener: HTTPS when tls is set (phones need it for the microphone), else HTTP. */
    async listen(port: number, host?: string): Promise<number> {
      const server = opts.tls
        ? https.createServer({ cert: readFileSync(opts.tls.certFile), key: readFileSync(opts.tls.keyFile) }, handler)
        : http.createServer(handler);
      const p = await start(server, port, host);
      if (opts.tls) httpsPort = p;
      return p;
    },
    /** Extra plain-HTTP listener for the TV on the LAN (the TV does not trust a self-signed certificate). */
    listenPlain(port: number, host?: string): Promise<number> {
      return start(http.createServer(handler), port, host);
    },
    async close(): Promise<void> {
      clearInterval(sweep);
      if (alertTimer) clearInterval(alertTimer);
      for (const ws of [...jsonWss.clients, ...audioWss.clients]) ws.terminate();
      for (const room of rooms.values()) {
        clearHuntTimer(room);
        stopHelpTimer(room);
        for (const s of room.speakers.values()) s.audio?.end();
      }
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    },
  };
}
