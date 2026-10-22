// On-device speech recognition through the browser's Web Speech API (Chrome on Android uses
// Google's recogniser). Wraps the quirks: continuous sessions end on their own and must be
// restarted, partials and finals arrive as a growing result list, and recognition must pause
// while the phone plays a reply so it does not caption its own loudspeaker.

export interface Heard { utt: number; text: string; final: boolean; conf?: number; startedAt: number }

export type RecognizerState = 'idle' | 'listening' | 'paused' | 'error';

// Minimal typing for the Web Speech API (not in TypeScript's DOM lib).
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string; message?: string }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null; onspeechstart: (() => void) | null; onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SR;

export function recognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export class Recognizer {
  private sr: SR | null = null;
  private want = false;
  private holdPaused = false;
  private utt = 0;
  /** Epoch ms when the current utterance's speech began (speechstart or first partial). */
  private uttStart: number | null = null;
  private speechStartAt: number | null = null;
  private lastPartialSent = 0;
  private restarts = 0;
  private lastError = '';

  constructor(
    private lang: string,
    private readonly now: () => number,
    private readonly onHeard: (h: Heard) => void,
    private readonly onState: (s: RecognizerState, detail?: string) => void,
  ) {}

  get restartCount() {
    return this.restarts;
  }

  setLang(lang: string) {
    this.lang = lang;
    if (this.want) this.restart();
  }

  start(): void {
    this.want = true;
    this.holdPaused = false;
    this.spawn();
  }

  stop(): void {
    this.want = false;
    // stop() (unlike abort) still delivers the final for the speech in flight; onend then
    // closes anything left. Flushing here as well would send that sentence twice.
    if (this.sr) this.sr.stop();
    else this.flushPartialAsFinal();
  }

  /** Pause while a reply plays (or the hold-to-talk button is released). */
  pause(): void {
    this.holdPaused = true;
    this.flushPartialAsFinal();
    this.sr?.abort();
    this.onState('paused');
  }

  resume(): void {
    if (!this.want) return;
    this.holdPaused = false;
    this.spawn();
  }

  private restart() {
    this.sr?.abort();
  }

  private lastPartial: { utt: number; text: string } | null = null;

  /** A session cut off mid-sentence leaves a partial: send it as final so the TV line closes. */
  private flushPartialAsFinal() {
    if (this.lastPartial && this.lastPartial.text.trim()) {
      this.onHeard({ utt: this.lastPartial.utt, text: this.lastPartial.text, final: true, startedAt: this.uttStart ?? this.now() });
      this.utt++;
    }
    this.lastPartial = null;
    this.uttStart = null;
  }

  private spawn(): void {
    if (!this.want || this.holdPaused) return;
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      this.onState('error', 'This browser cannot recognise speech. Use Chrome on Android.');
      return;
    }
    const sr = new Ctor();
    this.sr = sr;
    // Chrome on Android can re-deliver results that were already final in later events of the
    // same session; remember which result slots were sent so a sentence is never sent twice.
    const sentFinal = new Set<number>();
    sr.lang = this.lang;
    sr.continuous = true;
    sr.interimResults = true;
    sr.maxAlternatives = 1;
    sr.onstart = () => this.onState('listening');
    sr.onspeechstart = () => {
      this.speechStartAt = this.now();
    };
    sr.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (sentFinal.has(i)) continue;
        if (r.isFinal) sentFinal.add(i);
        const text = (r[0]?.transcript ?? '').trim();
        if (this.uttStart === null) {
          // Prefer the browser's speech-start time when it is recent; otherwise the first partial.
          const t = this.now();
          this.uttStart = this.speechStartAt !== null && t - this.speechStartAt < 8000 ? this.speechStartAt : t;
          this.speechStartAt = null;
        }
        if (r.isFinal) {
          const conf = r[0]?.confidence;
          this.onHeard({ utt: this.utt, text, final: true, conf: conf && conf > 0 ? conf : undefined, startedAt: this.uttStart });
          this.utt++;
          this.uttStart = null;
          this.lastPartial = null;
        } else if (text) {
          this.lastPartial = { utt: this.utt, text };
          const t = this.now();
          if (t - this.lastPartialSent >= 150) {
            this.lastPartialSent = t;
            this.onHeard({ utt: this.utt, text, final: false, startedAt: this.uttStart });
          }
        }
      }
    };
    sr.onerror = (e) => {
      this.lastError = e.error;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.want = false;
        this.onState('error', 'Microphone permission was refused. Allow the microphone for this site and try again.');
      } else if (e.error === 'network') {
        this.onState('error', 'Speech recognition needs an internet connection on this phone.');
      } else if (e.error === 'language-not-supported') {
        this.want = false;
        this.onState('error', 'This phone cannot recognise the chosen language.');
      }
      // 'no-speech' and 'aborted' are normal: onend restarts.
    };
    sr.onend = () => {
      if (this.sr !== sr) return;
      this.sr = null;
      this.flushPartialAsFinal();
      if (this.want && !this.holdPaused) {
        this.restarts++;
        // Back off a little after errors so a broken recogniser does not spin.
        const delay = this.lastError && this.lastError !== 'no-speech' && this.lastError !== 'aborted' ? 1500 : 50;
        this.lastError = '';
        window.setTimeout(() => this.spawn(), delay);
      } else if (!this.want) {
        this.onState('idle');
      }
    };
    try {
      sr.start();
    } catch {
      window.setTimeout(() => this.spawn(), 300);
    }
  }
}
