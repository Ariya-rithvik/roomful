// The phone's connection to the server: JSON socket with hello, clock sync and reconnect.
import { ClockSync, parseServerToPhone, type Engine, type Lang, type PhoneCaption, type Scan, type ServerToPhone } from '@roomcaption/shared';

export type LinkStatus = 'connecting' | 'joined' | 'reconnecting' | 'closed' | 'rejected' | 'ended';

export interface LinkOptions {
  room: string;
  clientId: string;
  name: string;
  lang: Lang;
  engine: Engine;
  onMessage: (m: ServerToPhone) => void;
  onStatus: (s: LinkStatus, detail?: string) => void;
}

export class Link {
  readonly clock = new ClockSync(8);
  private ws: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private pingId = 0;
  private pingTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private pending = new Map<number, number>();
  private pingsSent = 0;

  constructor(private opts: LinkOptions) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  private url(): string {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws/phone?room=${encodeURIComponent(this.opts.room)}`;
  }

  private open(): void {
    this.opts.onStatus(this.retry === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: 1, clientId: this.opts.clientId, name: this.opts.name, lang: this.opts.lang, engine: this.opts.engine }));
    };
    ws.onmessage = (ev) => {
      const parsed = parseServerToPhone(String(ev.data));
      if (!parsed.ok) return;
      const m = parsed.msg;
      if (m.t === 'welcome') {
        this.retry = 0;
        this.opts.onStatus('joined');
        this.pingsSent = 0;
        this.schedulePing(0);
      } else if (m.t === 'pong') {
        const sent = this.pending.get(m.id);
        if (sent !== undefined) {
          this.pending.delete(m.id);
          this.clock.addSample(sent, m.tServer, performance.timeOrigin + performance.now());
        }
      } else if (m.t === 'error' && (m.code === 'room_full' || m.code === 'room_not_found')) {
        this.stopped = true;
        this.opts.onStatus('rejected', m.message);
      }
      this.opts.onMessage(m);
    };
    ws.onclose = (ev) => {
      window.clearTimeout(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped || ev.code === 4001) {
        if (ev.code === 4001) this.opts.onStatus('rejected', 'This room is full.');
        else this.opts.onStatus('closed');
        return;
      }
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      this.opts.onStatus('reconnecting');
      this.reconnectTimer = window.setTimeout(() => void this.retryIfRoomOpen(), delay);
    };
  }

  /** Reconnect only if the room still exists; a room that ended (TV made a new one, server restarted) stops the retries. */
  private async retryIfRoomOpen(): Promise<void> {
    if (this.stopped) return;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(this.opts.room)}`, { cache: 'no-store' });
      if (res.status === 404) {
        this.stopped = true;
        this.opts.onStatus('ended', 'This room has ended. Scan the new code on the TV to join again.');
        return;
      }
    } catch {
      /* server unreachable: keep trying */
    }
    this.open();
  }

  /** Fast pings while syncing (every 1 s for the first 8), then every 15 s. */
  private schedulePing(delay: number): void {
    window.clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const id = ++this.pingId % 2 ** 31;
      const tClient = performance.timeOrigin + performance.now();
      this.pending.set(id, tClient);
      if (this.pending.size > 20) this.pending.delete(this.pending.keys().next().value!);
      this.ws.send(JSON.stringify({ t: 'ping', id, tClient }));
      this.pingsSent++;
      this.schedulePing(this.pingsSent < 8 ? 1000 : 15_000);
    }, delay);
  }

  /** Local epoch ms -> server ms. */
  serverTime(localEpochMs: number): number {
    return Math.round(this.clock.toServer(localEpochMs));
  }

  sendCaption(c: Omit<PhoneCaption, 't'>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t: 'caption', ...c }));
    return true;
  }

  sendHelp(t: 'help_raise' | 'help_ack' | 'help_cancel' | 'missed'): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t }));
    return true;
  }

  sendScan(s: Omit<Scan, 't'>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t: 'scan', ...s }));
    return true;
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.pingTimer);
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export const nowEpoch = () => performance.timeOrigin + performance.now();
