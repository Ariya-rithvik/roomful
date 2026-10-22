import {
  ClockSync, parseServerToTv, type ClipsClear, type HelpCancel, type HelpRaise, type HuntEnd, type HuntNext, type HuntStart, type Lang, type MomentNow, type NowPlaying, type ServerToTv,
} from '@roomcaption/shared';
import { serverUrl } from './config';

export type LinkState = 'connecting' | 'connected' | 'reconnecting' | 'unauthorized' | 'replaced' | 'gone';

export interface TvLinkHandlers {
  onMessage: (m: ServerToTv) => void;
  onState: (s: LinkState) => void;
}

/** The TV's WebSocket to the server: authenticates with the room token, keeps a clock offset, reconnects on its own. */
export class TvLink {
  readonly clock = new ClockSync(8);
  private ws: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;
  private pingId = 0;
  private pingsSent = 0;
  private pending = new Map<number, number>();

  constructor(private readonly room: string, private readonly token: string, private readonly h: TvLinkHandlers) {
    this.open();
  }

  private open() {
    this.h.onState(this.retry === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(`${serverUrl().replace(/^http/, 'ws')}/ws/tv?room=${encodeURIComponent(this.room)}`);
    this.ws = ws;
    let authed = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify({ t: 'tv_hello', v: 1, room: this.room, token: this.token }));
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      const parsed = parseServerToTv(String(e.data));
      if (!parsed.ok) return;
      const m = parsed.msg;
      if (m.t === 'room' && !authed) {
        // The first room state is the server's answer to tv_hello.
        authed = true;
        this.retry = 0;
        this.h.onState('connected');
        this.pingsSent = 0;
        this.schedulePing(0);
      }
      if (m.t === 'pong') {
        const sent = this.pending.get(m.id);
        if (sent !== undefined) {
          this.pending.delete(m.id);
          this.clock.addSample(sent, m.tServer, Date.now());
        }
        return;
      }
      this.h.onMessage(m);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      clearTimeout(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (ev.code === 4004) return this.h.onState('unauthorized');
      if (ev.code === 4000) return this.h.onState('replaced');
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      this.h.onState('reconnecting');
      this.reconnectTimer = setTimeout(() => void this.retryIfRoomOpen(), delay);
    };
  }

  /** If the server no longer knows this room (it restarted), report 'gone' so the TV opens a new room. */
  private async retryIfRoomOpen(): Promise<void> {
    if (this.stopped) return;
    try {
      const res = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(this.room)}`);
      if (res.status === 404) {
        this.stopped = true;
        this.h.onState('gone');
        return;
      }
    } catch {
      /* server unreachable: keep trying */
    }
    this.open();
  }

  private schedulePing(delay: number) {
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const id = ++this.pingId % 2 ** 31;
      const t = Date.now();
      this.pending.set(id, t);
      if (this.pending.size > 20) this.pending.delete(this.pending.keys().next().value!);
      this.ws.send(JSON.stringify({ t: 'ping', id, tClient: t }));
      this.pingsSent++;
      this.schedulePing(this.pingsSent < 8 ? 1000 : 10_000);
    }, delay);
  }

  private send(m: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  /** Server-clock now. */
  serverNow(): number {
    return Math.round(this.clock.toServer(Date.now()));
  }

  synced(): boolean {
    return this.clock.offset() !== null;
  }

  say(speakerId: string, text: string, lang: Lang, phraseId?: string): boolean {
    return this.send({ t: 'reply_say', speakerId, text, lang, ...(phraseId ? { phraseId } : {}) });
  }

  measure(speakerId: string, utt: number, tStart: number, tRender: number): void {
    this.send({ t: 'measure', speakerId, utt, tStart, tRender });
  }

  /** Hunt, moment and clip commands. */
  command(m: HuntStart | HuntNext | HuntEnd | MomentNow | ClipsClear | HelpRaise | HelpCancel | NowPlaying): void {
    this.send(m);
  }

  close() {
    this.stopped = true;
    clearTimeout(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export interface RoomCreated { room: string; token: string; joinUrl: string }

// The TV remembers its room, so reloading the app does not send the whole family back to scanning.
// (Web build: localStorage. Native builds keep the room for the life of the app process.)
const ROOM_KEY = 'rc.tvRoom';
let memoryRoom: RoomCreated | null = null;

function savedRoom(): RoomCreated | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = JSON.parse(localStorage.getItem(ROOM_KEY) ?? 'null') as RoomCreated | null;
      if (v && typeof v.room === 'string' && typeof v.token === 'string' && typeof v.joinUrl === 'string') return v;
    }
  } catch {
    /* storage blocked */
  }
  return memoryRoom;
}

function saveRoom(r: RoomCreated): void {
  memoryRoom = r;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ROOM_KEY, JSON.stringify(r));
  } catch {
    /* storage blocked */
  }
}

/** Forget the saved room ("New room", or the server no longer has it). */
export function forgetRoom(): void {
  memoryRoom = null;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(ROOM_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The saved room if the server still has it, otherwise a new one. */
export async function openRoom(): Promise<RoomCreated> {
  const old = savedRoom();
  if (old) {
    try {
      const res = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(old.room)}`, { cache: 'no-store' });
      if (res.ok) return old;
      if (res.status === 404) forgetRoom();
    } catch {
      return old; // server unreachable right now: keep the room and let the link retry
    }
  }
  const created = await createRoom();
  saveRoom(created);
  return created;
}

export async function createRoom(): Promise<RoomCreated> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${serverUrl()}/api/rooms`, { method: 'POST', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as RoomCreated;
  } finally {
    clearTimeout(timer);
  }
}
