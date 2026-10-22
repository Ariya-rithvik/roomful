// Happy moments: watch for a sustained smile with the front camera and save a short, silent clip
// to the family server. Opt-in per phone, off by default. Nothing is recorded until a smile (or the
// TV's "save a moment" button) triggers it; clips have no sound.
import { MomentDetector, type ClipReason } from '@roomcaption/shared';
import { loadFace, openCamera, smileScore, stopStream } from './vision';

export const CLIP_MS = 4000;
const SAMPLE_MS = 200;

function pickMime(): string | null {
  for (const m of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export interface MomentsOptions {
  room: string;
  speakerId: string;
  uploadToken: string;
  /** Local epoch ms -> server ms. */
  serverTime: (localMs: number) => number;
  onSmile: (score: number | null) => void;
  onSaved: (reason: ClipReason) => void;
  onError: (message: string) => void;
}

export class Moments {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: number | undefined;
  private recording = false;
  private stopped = false;
  private detector = new MomentDetector();

  constructor(private readonly o: MomentsOptions) {}

  async start(video: HTMLVideoElement): Promise<void> {
    this.stopped = false;
    if (!pickMime()) throw new Error('This browser cannot record video.');
    this.stream = await openCamera('user');
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.video = video;
    const lm = await loadFace();
    const tick = () => {
      if (this.stopped || !this.video) return;
      const t = performance.now();
      let score: number | null = null;
      try {
        if (this.video.readyState >= 2) score = smileScore(lm, this.video, t);
      } catch {
        score = null;
      }
      this.o.onSmile(score);
      if (this.detector.push(t, score)) void this.record('smile');
      this.timer = window.setTimeout(tick, SAMPLE_MS);
    };
    tick();
  }

  /** Record one clip now (a smile, or the TV asked). Ignored while a clip is already recording. */
  async record(reason: ClipReason): Promise<void> {
    if (!this.stream || this.recording) return;
    const mime = pickMime();
    if (!mime) return;
    this.recording = true;
    if (reason === 'manual') this.detector.markTriggered(performance.now());
    const startedLocal = performance.timeOrigin + performance.now();
    try {
      const rec = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 1_200_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start();
      await new Promise((r) => setTimeout(r, CLIP_MS));
      rec.stop();
      await done;
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const q = new URLSearchParams({
        room: this.o.room, speaker: this.o.speakerId, reason,
        tStart: String(Math.round(this.o.serverTime(startedLocal))), durationMs: String(CLIP_MS),
      });
      const res = await fetch(`/api/clips?${q}`, { method: 'POST', body: blob, headers: { 'content-type': blob.type, 'x-rc-token': this.o.uploadToken } });
      if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
      this.o.onSaved(reason);
    } catch (e) {
      this.o.onError(`Could not save the moment: ${(e as Error).message}`);
    } finally {
      this.recording = false;
    }
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    stopStream(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }
}
