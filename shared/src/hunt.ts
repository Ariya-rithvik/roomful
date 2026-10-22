// Table Hunt and happy moments: pure, deterministic rules shared by phone, server and TV.
//
// Only a label from OBJECT_LABELS ever leaves the phone for a scan: no image, no video, no free
// text. Labels are COCO class names (MediaPipe's EfficientDet-Lite detector uses them verbatim);
// sharp, hot, fragile, large or electronic things are deliberately absent.

export const OBJECT_LABELS = ['teddy bear', 'sports ball', 'cup', 'bowl', 'bottle', 'book', 'remote', 'clock', 'banana', 'apple', 'orange'] as const;
export type ObjectLabel = (typeof OBJECT_LABELS)[number];

export type Property = 'soft' | 'round' | 'holds' | 'readable' | 'buttons' | 'time' | 'fruit' | 'yellow';

export interface ObjectInfo {
  label: ObjectLabel;
  display: string;
  /** Hindi name: a draft until a native speaker reviews it. */
  hindiDraft: string;
  properties: Property[];
}

export const OBJECTS: Record<ObjectLabel, ObjectInfo> = {
  'teddy bear': { label: 'teddy bear', display: 'Teddy bear', hindiDraft: 'टेडी भालू', properties: ['soft'] },
  'sports ball': { label: 'sports ball', display: 'Ball', hindiDraft: 'गेंद', properties: ['round'] },
  cup: { label: 'cup', display: 'Cup', hindiDraft: 'कप', properties: ['holds'] },
  bowl: { label: 'bowl', display: 'Bowl', hindiDraft: 'कटोरा', properties: ['holds', 'round'] },
  bottle: { label: 'bottle', display: 'Bottle', hindiDraft: 'बोतल', properties: ['holds'] },
  book: { label: 'book', display: 'Book', hindiDraft: 'किताब', properties: ['readable'] },
  remote: { label: 'remote', display: 'Remote control', hindiDraft: 'रिमोट', properties: ['buttons'] },
  clock: { label: 'clock', display: 'Clock', hindiDraft: 'घड़ी', properties: ['round', 'time'] },
  banana: { label: 'banana', display: 'Banana', hindiDraft: 'केला', properties: ['fruit', 'yellow'] },
  apple: { label: 'apple', display: 'Apple', hindiDraft: 'सेब', properties: ['fruit', 'round'] },
  orange: { label: 'orange', display: 'Orange', hindiDraft: 'संतरा', properties: ['fruit', 'round'] },
};

export function isObjectLabel(s: unknown): s is ObjectLabel {
  return typeof s === 'string' && (OBJECT_LABELS as readonly string[]).includes(s);
}

// ---------- Scan decisions: ask rather than guess ----------

/** At or above this confidence the phone proposes the label ("Is this a cup?"). The person still confirms. */
export const SCAN_PROPOSE = 0.6;
/** Between this and SCAN_PROPOSE the phone shows a short picker instead of guessing. Below it, the full list. */
export const SCAN_PICK = 0.35;

export type ScanDecision = 'propose' | 'pick' | 'manual';

export function decideScan(conf: number | null | undefined): ScanDecision {
  if (conf === null || conf === undefined || !Number.isFinite(conf)) return 'manual';
  if (conf >= SCAN_PROPOSE) return 'propose';
  if (conf >= SCAN_PICK) return 'pick';
  return 'manual';
}

export const SCAN_OUTCOMES = ['confirmed', 'corrected', 'manual'] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

/** confirmed = the detector's top label was chosen; corrected = the person chose another; manual = no usable detection. */
export function scanOutcome(detected: ObjectLabel | null | undefined, chosen: ObjectLabel): ScanOutcome {
  if (!detected) return 'manual';
  return detected === chosen ? 'confirmed' : 'corrected';
}

// ---------- Hunt prompts and game ----------

export interface HuntPrompt { id: string; text: string; wants: Property }

export const HUNT_PROMPTS: HuntPrompt[] = [
  { id: 'soft', text: 'Find something soft', wants: 'soft' },
  { id: 'round', text: 'Find something round', wants: 'round' },
  { id: 'holds', text: 'Find something that holds a drink', wants: 'holds' },
  { id: 'readable', text: 'Find something to read', wants: 'readable' },
  { id: 'buttons', text: 'Find something with buttons', wants: 'buttons' },
  { id: 'time', text: 'Find something that tells the time', wants: 'time' },
  { id: 'fruit', text: 'Find a fruit', wants: 'fruit' },
];

export const HUNT_MAX_ROUNDS = 6;

/** Small seeded generator (mulberry32): the same seed always gives the same prompts. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickHuntPrompts(seed: number, n: number): HuntPrompt[] {
  const r = rng(seed);
  const pool = [...HUNT_PROMPTS];
  const out: HuntPrompt[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

export function matchesPrompt(prompt: HuntPrompt, label: ObjectLabel): boolean {
  return OBJECTS[label].properties.includes(prompt.wants);
}

export type HuntStatus = 'idle' | 'playing' | 'won' | 'done';

export interface HuntView {
  status: HuntStatus;
  /** 1-based round number (0 when idle). */
  round: number;
  total: number;
  prompt: { id: string; text: string } | null;
  scores: { speakerId: string; points: number }[];
  /** Who won the current round (status 'won'), or the overall leaders (status 'done'). */
  winners: string[];
}

export type ScanVerdict = { accepted: false; reason: 'not_playing' | 'already_won' } | { accepted: true; ok: boolean; roundWon: boolean };

/**
 * The Table Hunt: one prompt per round; the first person to scan a matching object wins the
 * round and a point; then next() moves on. Wrong objects are allowed (and shown) but score
 * nothing. Deterministic for a given seed and sequence of scans.
 */
export class Hunt {
  private prompts: HuntPrompt[] = [];
  private index = -1;
  private status: HuntStatus = 'idle';
  private points = new Map<string, number>();
  private roundWinner: string | null = null;

  start(seed: number, rounds: number): void {
    const n = Math.max(1, Math.min(HUNT_MAX_ROUNDS, Math.floor(rounds)));
    this.prompts = pickHuntPrompts(seed, n);
    this.index = 0;
    this.status = 'playing';
    this.points = new Map();
    this.roundWinner = null;
  }

  scan(speakerId: string, label: ObjectLabel): ScanVerdict {
    if (this.status === 'won') return { accepted: false, reason: 'already_won' };
    if (this.status !== 'playing') return { accepted: false, reason: 'not_playing' };
    const ok = matchesPrompt(this.prompts[this.index], label);
    if (!ok) return { accepted: true, ok: false, roundWon: false };
    this.points.set(speakerId, (this.points.get(speakerId) ?? 0) + 1);
    this.roundWinner = speakerId;
    this.status = 'won';
    return { accepted: true, ok: true, roundWon: true };
  }

  /** Next round (from 'playing' = skip, or from 'won'); after the last round the hunt is done. */
  next(): void {
    if (this.status !== 'playing' && this.status !== 'won') return;
    this.roundWinner = null;
    if (this.index + 1 >= this.prompts.length) {
      this.status = 'done';
      return;
    }
    this.index++;
    this.status = 'playing';
  }

  end(): void {
    if (this.status === 'idle') return;
    this.status = 'done';
    this.roundWinner = null;
  }

  reset(): void {
    this.status = 'idle';
    this.prompts = [];
    this.index = -1;
    this.points = new Map();
    this.roundWinner = null;
  }

  view(): HuntView {
    const scores = [...this.points.entries()]
      .map(([speakerId, points]) => ({ speakerId, points }))
      .sort((a, b) => b.points - a.points || (a.speakerId < b.speakerId ? -1 : 1));
    let winners: string[] = [];
    if (this.status === 'won' && this.roundWinner) winners = [this.roundWinner];
    if (this.status === 'done' && scores.length) winners = scores.filter((s) => s.points === scores[0].points).map((s) => s.speakerId);
    const p = this.status === 'playing' || this.status === 'won' ? this.prompts[this.index] : null;
    return {
      status: this.status,
      round: this.status === 'idle' ? 0 : Math.min(this.index + 1, this.prompts.length),
      total: this.prompts.length,
      prompt: p ? { id: p.id, text: p.text } : null,
      scores,
      winners,
    };
  }
}

// ---------- Happy moments ----------

export interface MomentOptions {
  /** Mean smile score (0..1, from face blendshapes) that counts as smiling. */
  threshold: number;
  /** How long the smile must last. */
  sustainMs: number;
  /** Minimum time between two saved moments from the same phone. */
  cooldownMs: number;
}
export const DEFAULT_MOMENT: MomentOptions = { threshold: 0.6, sustainMs: 500, cooldownMs: 20_000 };

/**
 * Turns a stream of smile scores into "save a moment now" triggers: the score must stay at or
 * above the threshold for sustainMs, and triggers are at least cooldownMs apart. A gap in samples
 * longer than 1 s breaks the sustain (no face, or the camera paused).
 */
export class MomentDetector {
  private since: number | null = null;
  private lastSample = -Infinity;
  private lastTrigger = -Infinity;
  constructor(private readonly opts: MomentOptions = DEFAULT_MOMENT) {}

  push(tMs: number, smile: number | null): boolean {
    if (tMs - this.lastSample > 1000) this.since = null;
    this.lastSample = tMs;
    if (smile === null || !(smile >= this.opts.threshold)) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = tMs;
    if (tMs - this.since >= this.opts.sustainMs && tMs - this.lastTrigger >= this.opts.cooldownMs) {
      this.lastTrigger = tMs;
      this.since = null;
      return true;
    }
    return false;
  }

  /** A manual or TV-requested moment also starts the cooldown. */
  markTriggered(tMs: number): void {
    this.lastTrigger = tMs;
    this.since = null;
  }
}
