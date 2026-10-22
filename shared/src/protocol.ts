// Roomcaption wire protocol v1.
//
// Small JSON messages over WebSocket, discriminated by `t`. Strict and additive: unknown
// fields are rejected, every string has a length cap, every number is range-checked, and a
// whole JSON frame is capped at MAX_JSON_BYTES. Binary frames are only accepted on the
// separate audio socket (server speech engine), never on the JSON sockets.
//
// Clocks: every timestamp on the wire is in SERVER clock milliseconds (Date.now() on the
// server). Phones and the TV estimate their offset with ping/pong (see clock.ts) and convert
// before sending.
//
// Sockets:
//   /ws/phone?room=CODE           phone JSON socket
//   /ws/tv?room=CODE              TV JSON socket (first message must be tv_hello with the room token)
//   /ws/phone-audio?room=CODE&speaker=ID   binary PCM16 16 kHz mono, 100 ms frames (engine 'server' only)
// HTTP:
//   POST /api/rooms               -> RoomCreated (TV calls this on start)
//   GET  /api/health              -> { ok: true, version }
//   GET  /join/CODE               -> phone web app (QR code target)
//   GET  /audio/<sha256>.mp3      -> cached reply audio (Polly)

import { OBJECT_LABELS, SCAN_OUTCOMES, HUNT_MAX_ROUNDS, type ObjectLabel, type ScanOutcome, type HuntView } from './hunt';

export const PROTOCOL_VERSION = 1;

export const LANGS = ['en-IN', 'hi-IN', 'ta-IN'] as const;
export type Lang = (typeof LANGS)[number];

/** Where speech recognition runs: on the phone (browser Web Speech API) or on our server (Amazon Transcribe). */
export const ENGINES = ['device', 'server'] as const;
export type Engine = (typeof ENGINES)[number];

export const MAX_JSON_BYTES = 4096;

/** Video channels the TV can play; a phone can listen to any of them (personal sound). */
export const CHANNEL_IDS = ['kids', 'family'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];
export const MAX_CHANNELS = 4;
export const MAX_TEXT = 500;
export const MAX_NAME = 24;
export const MAX_SPEAKERS = 6;
export const MAX_AUDIO_FRAME_BYTES = 6400; // 200 ms of PCM16 16 kHz mono
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 4;

/** People colours (sky, coral, leaf, lilac, rose, teal; docs/design/DESIGN.md): at least 6.6:1 on every dark surface and never the marigold accent. Never the only cue: names and initials are always shown. */
export const SPEAKER_COLORS = ['#7CC4FF', '#FF8B7B', '#93DB8C', '#C6A8FF', '#FF94C2', '#63D6C6'] as const;

export const ERROR_CODES = ['bad_message', 'room_not_found', 'room_full', 'unauthorized', 'not_joined', 'rate_limited', 'engine_unavailable', 'tts_failed'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------- Phone -> server ----------

export interface PhoneHello { t: 'hello'; v: 1; clientId: string; name: string; lang: Lang; engine: Engine }
/** A recognised (partial or final) piece of speech for one utterance. Partials for the same utt replace each other. */
export interface PhoneCaption {
  t: 'caption'; utt: number; seq: number; text: string; final: boolean; lang: Lang;
  /** Server-clock ms when this utterance's speech started (best estimate). */
  tStart: number;
  /** Recogniser confidence 0..1 if known. */
  conf?: number;
  /** Mean microphone level 0..1 over the utterance if known (used to resolve cross-talk). */
  level?: number;
}
export interface Ping { t: 'ping'; id: number; tClient: number }
/** Table Hunt: the person confirmed which object they are holding. Only the label leaves the phone. */
export interface Scan { t: 'scan'; label: ObjectLabel; outcome: ScanOutcome; detected?: ObjectLabel; conf?: number }
/** Help mode: ask the family for help, say "I'm coming", or cancel ("I'm OK"). */
/** who: from the TV, the name of the person the TV belongs to (\"Dadi\"), so phones say who needs help. */
export interface HelpRaise { t: 'help_raise'; who?: string }
export interface HelpAck { t: 'help_ack' }
export interface HelpCancel { t: 'help_cancel' }
/** "I missed that": ask the TV to bring the last lines of the conversation back into view. */
export interface Missed { t: 'missed' }
export type PhoneToServer = PhoneHello | PhoneCaption | Ping | Scan | HelpRaise | HelpAck | HelpCancel | Missed;
/** Server -> TV: someone asked to catch up; the TV shows the recent transcript. */
export interface Recover { t: 'recover'; byName: string }

/**
 * Help state, sent to the TV and every phone. 'active' = someone needs help and nobody has answered;
 * 'coming' = a family member answered. alerts counts how many times phones were alerted (it repeats
 * until someone answers). This alerts family; it does not contact emergency services.
 */
export interface HelpState {
  t: 'help'; status: 'idle' | 'active' | 'coming'; since: number | null;
  /** Who asked: a person's name, or null when it came from the TV remote. */
  byName: string | null; comingName: string | null; alerts: number;
}

// ---------- Server -> phone ----------

export interface Welcome {
  t: 'welcome'; v: 1; room: string; speakerId: string; color: string; serverTime: number;
  /** Secret for uploading happy-moment clips (x-rc-token header on POST /api/clips). */
  uploadToken?: string;
}
export interface Pong { t: 'pong'; id: number; tClient: number; tServer: number }
/** Play this reply audio on the phone (the replying person's own phone is their loudspeaker). */
export interface PlayAudio { t: 'play'; url: string; text: string }
export interface ErrorMsg { t: 'error'; code: ErrorCode; message: string }
/** The TV asked for a moment now: phones that opted in record a clip. */
export interface MomentRequest { t: 'moment_request' }
/** Table Hunt state, sent to the TV and every phone whenever it changes. */
export interface HuntState extends HuntView { t: 'hunt' }
/**
 * A real disaster alert that concerns this family (from GDACS), or a clearly labelled TEST alert.
 * The TV interrupts what is on screen; phones alarm. kind: EQ earthquake, FL flood, TC cyclone, VO
 * volcano, DR drought, WF forest fire, TS tsunami.
 */
export interface DisasterAlert {
  t: 'alert'; id: string; kind: string; level: 'Green' | 'Orange' | 'Red'; title: string; country: string;
  /** Why it concerns this family, e.g. "120 km from your home". */
  why: string; url: string; source: string; test: boolean;
}
export interface ChannelsState { t: 'channels'; channels: ChannelPlay[] }
export type ServerToPhone = ChannelsState | Welcome | Pong | PlayAudio | ErrorMsg | MomentRequest | HuntState | HelpState | DisasterAlert;

// ---------- TV -> server ----------

export interface TvHello { t: 'tv_hello'; v: 1; room: string; token: string }
/** The person at the reply board picked and confirmed a reply; speak it on their phone and caption it. */
export interface ReplySay { t: 'reply_say'; speakerId: string; text: string; lang: Lang; phraseId?: string }
/** TV reports when a final caption became visible, for end-to-end latency measurement. */
export interface Measure { t: 'measure'; speakerId: string; utt: number; tStart: number; tRender: number }
export interface HuntStart { t: 'hunt_start'; rounds: number; seed: number }
export interface HuntNext { t: 'hunt_next' }
export interface HuntEnd { t: 'hunt_end' }
/** Ask every opted-in phone to save a moment now. */
export interface MomentNow { t: 'moment_now' }
/** Delete every saved clip of this room. */
export interface ClipsClear { t: 'clips_clear' }
/** Where each playing channel is: positionMs (media time) at server-clock time `at`. */
export interface ChannelPlay { id: ChannelId; title: string; url: string; positionMs: number; playing: boolean; at: number }
export interface NowPlaying { t: 'now_playing'; channels: ChannelPlay[] }
export type TvToServer = NowPlaying | TvHello | ReplySay | Measure | Ping | HuntStart | HuntNext | HuntEnd | MomentNow | ClipsClear | HelpRaise | HelpCancel;

// ---------- Server -> TV ----------

export interface SpeakerInfo { speakerId: string; name: string; lang: Lang; color: string; engine: Engine; connected: boolean }
export interface RoomState { t: 'room'; room: string; joinUrl: string; speakers: SpeakerInfo[] }
export interface CaptionOut {
  t: 'caption'; speakerId: string; utt: number; text: string; final: boolean; lang: Lang;
  tStart: number;
  /** Server-clock ms when the server received it. */
  tRecv: number;
  /** True when this line is a spoken reply from the reply board. */
  reply?: boolean;
}
/** Remove a line (cross-talk duplicate heard by another phone). */
export interface CaptionDrop { t: 'drop'; speakerId: string; utt: number; reason: 'duplicate' }
export interface ReplyStatus { t: 'reply_status'; speakerId: string; text: string; status: 'speaking' | 'failed'; reason?: string }
export interface ScanResult { t: 'scan_result'; speakerId: string; label: ObjectLabel; ok: boolean; outcome: ScanOutcome }
export const CLIP_REASONS = ['smile', 'manual'] as const;
export type ClipReason = (typeof CLIP_REASONS)[number];
/** A saved happy-moment clip (video only, no sound), served by the family server. */
export interface ClipInfo { t: 'clip'; id: string; speakerId: string; url: string; tStart: number; durationMs: number; reason: ClipReason }
export interface ClipsCleared { t: 'clips_cleared' }
/** Someone brought a real object "into the TV": a cropped photo they confirmed, with its label. */
export interface ObjectArrived { t: 'object'; id: string; speakerId: string; label: ObjectLabel; url: string }
export type ServerToTv = RoomState | CaptionOut | CaptionDrop | ReplyStatus | Pong | ErrorMsg | HuntState | ScanResult | ClipInfo | ClipsCleared | ObjectArrived | HelpState | DisasterAlert | Recover;

// ---------- HTTP ----------

export interface RoomCreated { room: string; token: string; joinUrl: string }

// ---------- Validation ----------

export type Parsed<T> = { ok: true; msg: T } | { ok: false; error: string };

type Check = (v: unknown) => boolean;
type Spec = Record<string, [Check, boolean]>; // field -> [check, required]

const isStr = (min: number, max: number): Check => (v) => typeof v === 'string' && v.length >= min && v.length <= max;
const isInt = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isBool: Check = (v) => typeof v === 'boolean';
const isOneOf = (xs: readonly string[]): Check => (v) => typeof v === 'string' && xs.includes(v);
const isLit = (x: unknown): Check => (v) => v === x;
const isId: Check = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(v);
const isRoom: Check = (v) => typeof v === 'string' && isRoomCode(v);
/** Visible text: no control characters except none; trimmed length > 0 for names. */
const isText = (max: number): Check => (v) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const isName: Check = (v) => isText(MAX_NAME)(v) && (v as string).trim().length > 0;
const MAX_TS = 8.64e15;
const isTs = isNum(0, MAX_TS);
const isUrlPath: Check = (v) => typeof v === 'string' && v.length <= 300 && /^\/audio\/[a-f0-9]{16,64}\.mp3$/.test(v);

export function isRoomCode(s: string): boolean {
  if (s.length !== ROOM_CODE_LEN) return false;
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

const CHANNEL_SPEC: Spec = {
  id: [isOneOf(CHANNEL_IDS), true], title: [isText(120), true], url: [(v) => typeof v === 'string' && v.length <= 400 && /^https?:\/\/\S+$/.test(v), true],
  positionMs: [isNum(0, 1e9), true], playing: [isBool, true], at: [isTs, true],
};
const isChannelList: Check = (v) =>
  Array.isArray(v) && v.length <= MAX_CHANNELS && v.every((c) => checkSpec(c, CHANNEL_SPEC) === null) && new Set(v.map((c) => (c as ChannelPlay).id)).size === v.length;

const SPECS: Record<string, Spec> = {
  now_playing: { t: [isLit('now_playing'), true], channels: [isChannelList, true] },
  // phone -> server
  hello: { t: [isLit('hello'), true], v: [isLit(1), true], clientId: [isId, true], name: [isName, true], lang: [isOneOf(LANGS), true], engine: [isOneOf(ENGINES), true] },
  caption: {
    t: [isLit('caption'), true], utt: [isInt(0, 2 ** 31), true], seq: [isInt(0, 2 ** 31), true], text: [isText(MAX_TEXT), true],
    final: [isBool, true], lang: [isOneOf(LANGS), true], tStart: [isTs, true], conf: [isNum(0, 1), false], level: [isNum(0, 1), false],
  },
  ping: { t: [isLit('ping'), true], id: [isInt(0, 2 ** 31), true], tClient: [isNum(-MAX_TS, MAX_TS), true] },
  // tv -> server
  tv_hello: { t: [isLit('tv_hello'), true], v: [isLit(1), true], room: [isRoom, true], token: [isId, true] },
  reply_say: { t: [isLit('reply_say'), true], speakerId: [isId, true], text: [(v) => isText(MAX_TEXT)(v) && (v as string).trim().length > 0, true], lang: [isOneOf(LANGS), true], phraseId: [isStr(1, 64), false] },
  measure: { t: [isLit('measure'), true], speakerId: [isId, true], utt: [isInt(0, 2 ** 31), true], tStart: [isTs, true], tRender: [isTs, true] },
  hunt_start: { t: [isLit('hunt_start'), true], rounds: [isInt(1, HUNT_MAX_ROUNDS), true], seed: [isInt(0, 2 ** 31), true] },
  hunt_next: { t: [isLit('hunt_next'), true] },
  hunt_end: { t: [isLit('hunt_end'), true] },
  moment_now: { t: [isLit('moment_now'), true] },
  clips_clear: { t: [isLit('clips_clear'), true] },
  help_raise: { t: [isLit('help_raise'), true], who: [isName, false] },
  help_ack: { t: [isLit('help_ack'), true] },
  help_cancel: { t: [isLit('help_cancel'), true] },
  missed: { t: [isLit('missed'), true] },
  // phone -> server (Table Hunt)
  scan: {
    t: [isLit('scan'), true], label: [isOneOf(OBJECT_LABELS), true], outcome: [isOneOf(SCAN_OUTCOMES), true],
    detected: [isOneOf(OBJECT_LABELS), false], conf: [isNum(0, 1), false],
  },
};

const isHuntPrompt: Check = (v) => v === null || checkSpec(v, { id: [isStr(1, 32), true], text: [isText(120), true] }) === null;
const isScores: Check = (v) =>
  Array.isArray(v) && v.length <= 2 * MAX_SPEAKERS && v.every((s) => checkSpec(s, { speakerId: [isId, true], points: [isInt(0, 1000), true] }) === null);
const isIdList: Check = (v) => Array.isArray(v) && v.length <= 2 * MAX_SPEAKERS && v.every(isId);
const isClipId: Check = (v) => typeof v === 'string' && /^[a-f0-9]{16,32}$/.test(v);
const isClipUrl: Check = (v) => typeof v === 'string' && /^\/clips\/[A-Z0-9]{4}\/[a-f0-9]{16,32}\.(webm|mp4)$/.test(v);

const CLIENT_SPECS: Record<string, Spec> = {
  channels: { t: [isLit('channels'), true], channels: [isChannelList, true] },
  welcome: {
    t: [isLit('welcome'), true], v: [isLit(1), true], room: [isRoom, true], speakerId: [isId, true], color: [isStr(4, 9), true], serverTime: [isTs, true],
    uploadToken: [isId, false],
  },
  moment_request: { t: [isLit('moment_request'), true] },
  hunt: {
    t: [isLit('hunt'), true], status: [isOneOf(['idle', 'playing', 'won', 'done']), true], round: [isInt(0, HUNT_MAX_ROUNDS), true],
    total: [isInt(0, HUNT_MAX_ROUNDS), true], prompt: [isHuntPrompt, true], scores: [isScores, true], winners: [isIdList, true],
  },
  scan_result: { t: [isLit('scan_result'), true], speakerId: [isId, true], label: [isOneOf(OBJECT_LABELS), true], ok: [isBool, true], outcome: [isOneOf(SCAN_OUTCOMES), true] },
  clip: {
    t: [isLit('clip'), true], id: [isClipId, true], speakerId: [isId, true], url: [isClipUrl, true], tStart: [isTs, true],
    durationMs: [isInt(0, 60_000), true], reason: [isOneOf(CLIP_REASONS), true],
  },
  clips_cleared: { t: [isLit('clips_cleared'), true] },
  recover: { t: [isLit('recover'), true], byName: [isName, true] },
  alert: {
    t: [isLit('alert'), true], id: [isStr(1, 64), true], kind: [isStr(1, 8), true], level: [isOneOf(['Green', 'Orange', 'Red']), true],
    title: [isText(300), true], country: [isText(160), true], why: [isText(200), true],
    url: [(v) => typeof v === 'string' && v.length <= 300 && (v === '' || /^https:\/\//.test(v)), true], source: [isText(60), true], test: [isBool, true],
  },
  help: {
    t: [isLit('help'), true], status: [isOneOf(['idle', 'active', 'coming']), true], since: [(v) => v === null || isTs(v), true],
    byName: [(v) => v === null || isName(v), true], comingName: [(v) => v === null || isName(v), true], alerts: [isInt(0, 1000), true],
  },
  object: {
    t: [isLit('object'), true], id: [isClipId, true], speakerId: [isId, true], label: [isOneOf(OBJECT_LABELS), true],
    url: [(v) => typeof v === 'string' && /^\/objects\/[A-Z0-9]{4}\/[a-f0-9]{16,32}\.(jpg|webp)$/.test(v), true],
  },
  pong: { t: [isLit('pong'), true], id: [isInt(0, 2 ** 31), true], tClient: [isNum(-MAX_TS, MAX_TS), true], tServer: [isTs, true] },
  play: { t: [isLit('play'), true], url: [isUrlPath, true], text: [isText(MAX_TEXT), true] },
  error: { t: [isLit('error'), true], code: [isOneOf(ERROR_CODES), true], message: [isText(300), true] },
  room: { t: [isLit('room'), true], room: [isRoom, true], joinUrl: [isStr(8, 300), true], speakers: [(v) => Array.isArray(v) && v.length <= MAX_SPEAKERS && v.every(isSpeakerInfo), true] },
  caption: {
    t: [isLit('caption'), true], speakerId: [isId, true], utt: [isInt(0, 2 ** 31), true], text: [isText(MAX_TEXT), true], final: [isBool, true],
    lang: [isOneOf(LANGS), true], tStart: [isTs, true], tRecv: [isTs, true], reply: [isBool, false],
  },
  drop: { t: [isLit('drop'), true], speakerId: [isId, true], utt: [isInt(0, 2 ** 31), true], reason: [isLit('duplicate'), true] },
  reply_status: { t: [isLit('reply_status'), true], speakerId: [isId, true], text: [isText(MAX_TEXT), true], status: [isOneOf(['speaking', 'failed']), true], reason: [isText(300), false] },
};

const SPEAKER_SPEC: Spec = {
  speakerId: [isId, true], name: [isName, true], lang: [isOneOf(LANGS), true], color: [isStr(4, 9), true], engine: [isOneOf(ENGINES), true], connected: [isBool, true],
};
function isSpeakerInfo(v: unknown): boolean {
  return checkSpec(v, SPEAKER_SPEC) === null;
}

function checkSpec(v: unknown, spec: Spec): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'not an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(k in spec)) return `unknown field ${k}`;
  for (const [k, [check, required]] of Object.entries(spec)) {
    if (!(k in o) || o[k] === undefined) {
      if (required) return `missing field ${k}`;
      continue;
    }
    if (!check(o[k])) return `bad field ${k}`;
  }
  return null;
}

function parseWith<T>(raw: string, allowed: readonly string[], specs: Record<string, Spec>): Parsed<T> {
  if (typeof raw !== 'string') return { ok: false, error: 'not text' };
  if (byteLength(raw) > MAX_JSON_BYTES) return { ok: false, error: 'too large' };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'bad json' };
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, error: 'not an object' };
  const t = (v as { t?: unknown }).t;
  if (typeof t !== 'string' || !allowed.includes(t)) return { ok: false, error: 'unknown type' };
  const err = checkSpec(v, specs[t]);
  return err ? { ok: false, error: err } : { ok: true, msg: v as T };
}

function byteLength(s: string): number {
  // UTF-8 length without depending on Buffer/TextEncoder availability.
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

export const parsePhoneMessage = (raw: string) => parseWith<PhoneToServer>(raw, ['hello', 'caption', 'ping', 'scan', 'help_raise', 'help_ack', 'help_cancel', 'missed'], SPECS);
export const parseTvMessage = (raw: string) =>
  parseWith<TvToServer>(raw, ['tv_hello', 'reply_say', 'measure', 'ping', 'hunt_start', 'hunt_next', 'hunt_end', 'moment_now', 'clips_clear', 'help_raise', 'help_cancel', 'now_playing'], SPECS);
export const parseServerToPhone = (raw: string) => parseWith<ServerToPhone>(raw, ['welcome', 'pong', 'play', 'error', 'moment_request', 'hunt', 'help', 'alert', 'channels'], CLIENT_SPECS);
export const parseServerToTv = (raw: string) =>
  parseWith<ServerToTv>(raw, ['room', 'caption', 'drop', 'reply_status', 'pong', 'error', 'hunt', 'scan_result', 'clip', 'clips_cleared', 'object', 'help', 'alert', 'recover'], CLIENT_SPECS);

/** Room code from any source of random numbers in [0,1). */
export function generateRoomCode(random: () => number): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length];
  return s;
}
