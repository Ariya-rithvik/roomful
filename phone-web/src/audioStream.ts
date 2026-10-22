// Engine 'server': stream the microphone as PCM16 16 kHz mono in 100 ms frames to
// /ws/phone-audio, where the server runs Amazon Transcribe. Used only when the server says
// it has a speech engine; otherwise the phone recognises speech itself.

const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1600); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice().buffer, []); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pcm16', Pcm16);
`;

export class AudioStreamer {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;

  constructor(private readonly room: string, private readonly speakerId: string, private readonly onFail: (why: string) => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(this.ctx, 'pcm16');
    this.ctx.createMediaStreamSource(this.stream).connect(node);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws/phone-audio?room=${encodeURIComponent(this.room)}&speaker=${encodeURIComponent(this.speakerId)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    ws.onclose = (ev) => {
      if (this.ws === ws && ev.code !== 1000) this.onFail(ev.reason || 'audio connection closed');
    };
  }

  stop(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
  }
}
