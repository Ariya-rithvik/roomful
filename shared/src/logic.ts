// Shared, deterministic logic. Everything here is pure: no I/O, no Date.now(), no
// Math.random() - time and randomness are passed in, so the same inputs always give the
// same outputs and the TV, server and tests agree.
import type { CaptionOut, CaptionDrop, Lang } from './protocol';

// ---------- Text normalisation and similarity ----------

/** Lowercase, strip punctuation (Latin, Devanagari danda, Tamil), collapse whitespace. Keeps letters, combining marks and digits in any script. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s: string): string[] => {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
};

/** Similarity 0..1 of two utterances: Dice coefficient over normalised word multisets. Identical -> 1, disjoint -> 0. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of tb) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      shared++;
      counts.set(t, c - 1);
    }
  }
  return (2 * shared) / (ta.length + tb.length);
}

// ---------- Cross-talk: the same sentence heard by two phones ----------

export interface HeardFinal { speakerId: string; utt: number; text: string; tStart: number; tRecv: number; level?: number; conf?: number }
export interface CrossTalkDecision {
  /** Whether the offered final should be shown. */
  keep: boolean;
  /** Earlier, already shown finals that this one beats and that must now be removed. */
  drop: { speakerId: string; utt: number }[];
}
export interface CrossTalkOptions { windowMs: number; minSimilarity: number }
export const DEFAULT_CROSSTALK: CrossTalkOptions = { windowMs: 1500, minSimilarity: 0.6 };

/** True when a should own the sentence rather than b. Total order, independent of arrival order. */
function beats(a: HeardFinal, b: HeardFinal): boolean {
  if (a.level !== undefined && b.level !== undefined && a.level !== b.level) return a.level > b.level;
  if (a.conf !== undefined && b.conf !== undefined && a.conf !== b.conf) return a.conf > b.conf;
  if (a.tStart !== b.tStart) return a.tStart < b.tStart;
  return a.speakerId < b.speakerId;
}

/**
 * Decides which phone "owns" a sentence that several phones recognised.
 * Two finals collide when they come from different speakers, their tStart values are within
 * windowMs, and textSimilarity >= minSimilarity. The winner is the one with the higher level;
 * if level is missing on either, the higher conf; if still tied, the earlier tStart; then
 * the lexicographically smaller speakerId (so the result never depends on arrival order).
 * Finals older than windowMs relative to the newest tStart are forgotten.
 */
export class CrossTalkFilter {
  private shown: HeardFinal[] = [];
  private newest = -Infinity;
  constructor(private readonly opts: CrossTalkOptions = DEFAULT_CROSSTALK) {}

  offer(f: HeardFinal): CrossTalkDecision {
    this.newest = Math.max(this.newest, f.tStart);
    this.shown = this.shown.filter((e) => this.newest - e.tStart <= this.opts.windowMs);
    const colliding = this.shown.filter(
      (e) => e.speakerId !== f.speakerId && Math.abs(e.tStart - f.tStart) <= this.opts.windowMs && textSimilarity(e.text, f.text) >= this.opts.minSimilarity,
    );
    if (colliding.some((e) => !beats(f, e))) return { keep: false, drop: [] };
    this.shown = this.shown.filter((e) => !colliding.includes(e));
    this.shown.push(f);
    return { keep: true, drop: colliding.map((e) => ({ speakerId: e.speakerId, utt: e.utt })) };
  }
}

// ---------- Clock sync (NTP-style) ----------

/**
 * Collects ping/pong samples and estimates the offset to add to the local clock to get server
 * time. Uses the sample with the smallest round-trip among the last `keep` samples.
 * offset = tServer - (tSend + tRecv) / 2 for that sample.
 */
export class ClockSync {
  private samples: { offset: number; rtt: number }[] = [];
  constructor(private readonly keep = 8) {}

  addSample(tSendLocal: number, tServer: number, tRecvLocal: number): void {
    const rtt = tRecvLocal - tSendLocal;
    if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(tServer)) return;
    this.samples.push({ offset: tServer - (tSendLocal + tRecvLocal) / 2, rtt });
    if (this.samples.length > this.keep) this.samples.shift();
  }
  private best(): { offset: number; rtt: number } | null {
    let b: { offset: number; rtt: number } | null = null;
    for (const s of this.samples) if (!b || s.rtt < b.rtt) b = s;
    return b;
  }
  /** null until at least one sample. */
  offset(): number | null {
    return this.best()?.offset ?? null;
  }
  /** Best round-trip ms, null until at least one sample. */
  rtt(): number | null {
    return this.best()?.rtt ?? null;
  }
  /** Local ms -> server ms (identity until synced). */
  toServer(tLocal: number): number {
    return tLocal + (this.offset() ?? 0);
  }
}

// ---------- Caption store (what the TV shows) ----------

export interface CaptionLine { key: string; speakerId: string; utt: number; text: string; final: boolean; lang: Lang; tStart: number; tRecv: number; reply: boolean }

const lineKey = (speakerId: string, utt: number) => `${speakerId}:${utt}`;
const before = (a: { tStart: number; key: string }, b: { tStart: number; key: string }) => a.tStart < b.tStart || (a.tStart === b.tStart && a.key < b.key);

/**
 * Ordered caption lines for the TV. Lines are ordered by tStart (ties by key) so a late final
 * from a slower phone slots into the right place. A partial for (speakerId, utt) is replaced by
 * newer partials and by the final; once final, later partials for that utt are ignored; an empty
 * final removes the line. drop() removes a line. At most maxLines are kept (oldest discarded).
 * Pause freezes visible(): new lines are stored but the view does not move until resume().
 * Scroll-back moves the view window toward older lines; scrollForward toward newer; resume()
 * and scrollToLive() return to the newest lines.
 */
export class CaptionStore {
  private lines = new Map<string, CaptionLine>();
  /** Keys whose final has arrived (or that were dropped): later partials are ignored. */
  private closed = new Set<string>();
  private sorted: CaptionLine[] | null = [];
  private paused = false;
  /** Bottom line of a frozen view; null = live. 'top' = frozen before any line existed. */
  private anchor: { tStart: number; key: string } | 'top' | null = null;

  constructor(private readonly maxLines = 300) {}

  apply(msg: CaptionOut): void {
    const key = lineKey(msg.speakerId, msg.utt);
    if (this.closed.has(key) && !msg.final) return;
    if (msg.final) this.closed.add(key);
    if (msg.final && msg.text.trim() === '') {
      this.lines.delete(key);
    } else {
      this.lines.set(key, {
        key, speakerId: msg.speakerId, utt: msg.utt, text: msg.text, final: msg.final, lang: msg.lang,
        tStart: msg.tStart, tRecv: msg.tRecv, reply: msg.reply === true,
      });
    }
    this.sorted = null;
    this.evict();
  }

  drop(msg: CaptionDrop): void {
    const key = lineKey(msg.speakerId, msg.utt);
    this.closed.add(key);
    if (this.lines.delete(key)) this.sorted = null;
  }

  all(): CaptionLine[] {
    if (!this.sorted) this.sorted = [...this.lines.values()].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
    return this.sorted;
  }

  private evict(): void {
    if (this.lines.size <= this.maxLines) return;
    const extra = this.all().slice(0, this.lines.size - this.maxLines);
    for (const l of extra) this.lines.delete(l.key);
    this.sorted = null;
    // Bound the closed-key memory too: forget keys of lines that no longer exist and are old.
    if (this.closed.size > this.maxLines * 4) {
      const keep = new Set(this.lines.keys());
      for (const k of this.closed) if (!keep.has(k)) this.closed.delete(k);
    }
  }

  /** Index of the bottom visible line, or -1 if none. */
  private bottomIndex(): number {
    const all = this.all();
    if (this.anchor === null) return all.length - 1;
    if (this.anchor === 'top') return -1;
    const a = this.anchor;
    let idx = -1;
    for (let i = 0; i < all.length; i++) {
      if (before(all[i], a) || all[i].key === a.key) idx = i;
      else break;
    }
    return idx;
  }

  private freezeAt(index: number): void {
    const all = this.all();
    this.anchor = index < 0 || all.length === 0 ? 'top' : { tStart: all[index].tStart, key: all[index].key };
  }

  /** The window of up to n lines currently in view. */
  visible(n: number): CaptionLine[] {
    const end = this.bottomIndex();
    if (end < 0 || n <= 0) return [];
    return this.all().slice(Math.max(0, end - n + 1), end + 1);
  }

  pause(): void {
    if (this.anchor === null) this.freezeAt(this.all().length - 1);
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    this.anchor = null;
  }
  isPaused(): boolean {
    return this.paused;
  }
  scrollBack(lines: number): void {
    const len = this.all().length;
    if (len === 0 || lines <= 0) return;
    const bottom = this.bottomIndex();
    this.freezeAt(Math.max(0, (bottom < 0 ? 0 : bottom) - lines));
  }
  scrollForward(lines: number): void {
    if (this.anchor === null || lines <= 0) return;
    const len = this.all().length;
    const next = this.bottomIndex() + lines;
    if (next >= len - 1 && !this.paused) this.anchor = null;
    else this.freezeAt(Math.min(next, len - 1));
  }
  scrollToLive(): void {
    this.resume();
  }
  /** True when the view is at the newest lines and not paused. */
  isLive(): boolean {
    return !this.paused && this.anchor === null;
  }
  /** The most recent final line, for "say that again" and reply suggestions. */
  lastFinal(excludeSpeakerId?: string): CaptionLine | null {
    const all = this.all();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].final && all[i].speakerId !== excludeSpeakerId) return all[i];
    return null;
  }
}

// ---------- Word error rate (measurement) ----------

export interface WerResult { wer: number; substitutions: number; deletions: number; insertions: number; refWords: number; hypWords: number }

/** Standard WER = (S + D + I) / N over normalizeText tokens, by Levenshtein alignment. Empty reference: wer 0 if hyp empty else 1. */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const r = tokens(reference);
  const h = tokens(hypothesis);
  const n = r.length;
  const m = h.length;
  // cost[i][j] with backpointers: 0 = match/sub (diag), 1 = deletion (up), 2 = insertion (left)
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const op: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) { cost[i][0] = i; op[i][0] = 1; }
  for (let j = 1; j <= m; j++) { cost[0][j] = j; op[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = cost[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1);
      const up = cost[i - 1][j] + 1;
      const left = cost[i][j - 1] + 1;
      if (diag <= up && diag <= left) { cost[i][j] = diag; op[i][j] = 0; }
      else if (up <= left) { cost[i][j] = up; op[i][j] = 1; }
      else { cost[i][j] = left; op[i][j] = 2; }
    }
  }
  let s = 0, d = 0, ins = 0;
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const o = op[i][j];
    if (i > 0 && j > 0 && o === 0) { if (r[i - 1] !== h[j - 1]) s++; i--; j--; }
    else if (i > 0 && (o === 1 || j === 0)) { d++; i--; }
    else { ins++; j--; }
  }
  const wer = n === 0 ? (m === 0 ? 0 : 1) : (s + d + ins) / n;
  return { wer, substitutions: s, deletions: d, insertions: ins, refWords: n, hypWords: m };
}

// ---------- Reply board (deterministic suggestions) ----------

export const REPLY_INTENTS = ['yes_no_question', 'wh_question', 'greeting', 'thanks', 'food', 'health_check', 'plans', 'statement'] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export interface ReplyPhrase {
  id: string;
  text: string;
  lang: Lang;
  /** Intents this reply fits; 'any' fits everything. */
  fits: (ReplyIntent | 'any')[];
  /** Hindi/Tamil phrases are drafts until a native speaker reviews them. */
  reviewed: boolean;
}

const has = (n: string, words: string[]) => words.some((w) => (w.includes(' ') ? n.includes(w) : n.split(' ').includes(w)));

const CUES: { intent: ReplyIntent; en: string[]; hi: string[] }[] = [
  { intent: 'thanks', en: ['thank', 'thanks', 'thank you'], hi: ['धन्यवाद', 'शुक्रिया'] },
  { intent: 'greeting', en: ['hi', 'hello', 'good morning', 'good evening', 'good night', 'good afternoon', 'namaste'], hi: ['नमस्ते', 'नमस्कार', 'प्रणाम'] },
  { intent: 'health_check', en: ['how are you', 'feeling', 'are you ok', 'are you okay', 'tired', 'pain', 'medicine', 'sleep', 'slept'], hi: ['कैसे हो', 'कैसी हो', 'कैसे हैं', 'कैसी हैं', 'तबीयत', 'दवा', 'दर्द', 'थक'] },
  { intent: 'food', en: ['eat', 'ate', 'eaten', 'lunch', 'dinner', 'breakfast', 'food', 'tea', 'chai', 'hungry', 'coffee', 'water'], hi: ['खाना', 'खाया', 'खाओ', 'खाएंगे', 'चाय', 'भूख', 'नाश्ता', 'पानी'] },
  { intent: 'plans', en: ['tomorrow', 'tonight', 'going', 'go to', 'temple', 'market', 'visit', 'come with', 'later', 'weekend'], hi: ['कल', 'जाना', 'जा रहे', 'चलेंगे', 'चलो', 'मंदिर', 'बाजार', 'बाद में'] },
];
const WH_EN = ['what', 'where', 'when', 'who', 'why', 'how', 'which', 'whose'];
const WH_HI = ['कहाँ', 'कहां', 'कब', 'कौन', 'क्यों', 'कैसे', 'कितना', 'कितने', 'किसका'];
const YN_EN = ['do', 'did', 'are', 'is', 'can', 'will', 'have', 'has', 'should', 'would', 'could', 'shall', 'was', 'were', 'does'];

/** Rule-based intent of the last thing someone said (English and Hindi cues; '?' and question words). */
export function classifyUtterance(text: string, lang: Lang): ReplyIntent {
  void lang; // cues for every supported language are checked: families mix languages
  const n = normalizeText(text);
  if (!n) return 'statement';
  for (const c of CUES) if (has(n, c.en) || has(n, c.hi)) return c.intent;
  const first = n.split(' ')[0];
  if (WH_EN.includes(first) || has(n, WH_HI)) return 'wh_question';
  if (/\?\s*$/.test(text.trim()) || YN_EN.includes(first) || first === 'क्या') return 'yes_no_question';
  return 'statement';
}

const en = (id: number, text: string, fits: ReplyPhrase['fits']): ReplyPhrase => ({ id: `en-${String(id).padStart(2, '0')}`, text, lang: 'en-IN', fits, reviewed: true });
const hi = (id: number, text: string, fits: ReplyPhrase['fits']): ReplyPhrase => ({ id: `hi-${String(id).padStart(2, '0')}`, text, lang: 'hi-IN', fits, reviewed: false });

/** Phrase pack: English (reviewed) and Hindi drafts (reviewed: false until a native speaker checks them). */
export const REPLY_PHRASES: ReplyPhrase[] = [
  en(1, 'Yes.', ['yes_no_question', 'any']),
  en(2, 'No.', ['yes_no_question', 'any']),
  en(3, 'I am not sure.', ['yes_no_question', 'wh_question']),
  en(4, 'Please say that again.', ['any']),
  en(5, 'Please speak a little slower.', ['any']),
  en(6, 'Wait, I am still reading.', ['any']),
  en(7, 'I understood.', ['statement', 'any']),
  en(8, 'I did not follow that.', ['statement', 'wh_question']),
  en(9, 'Hello! Good to see you.', ['greeting']),
  en(10, 'Good morning.', ['greeting']),
  en(11, 'Good night. Sleep well.', ['greeting']),
  en(12, 'Thank you.', ['thanks', 'any']),
  en(13, 'You are welcome.', ['thanks']),
  en(14, 'Yes, I have eaten.', ['food']),
  en(15, 'Not yet. I will eat soon.', ['food']),
  en(16, 'I would like some tea.', ['food']),
  en(17, 'I am hungry.', ['food']),
  en(18, 'Just a little for me, please.', ['food']),
  en(19, 'The food is very good.', ['food']),
  en(20, 'Some water, please.', ['food']),
  en(21, 'I am fine.', ['health_check']),
  en(22, 'I am a little tired.', ['health_check']),
  en(23, 'I slept well.', ['health_check']),
  en(24, 'I need to rest for a while.', ['health_check', 'plans']),
  en(25, 'I have taken my medicine.', ['health_check']),
  en(26, 'Yes, I will come.', ['plans']),
  en(27, 'I will stay at home.', ['plans']),
  en(28, 'What time are we going?', ['plans']),
  en(29, 'Who else is coming?', ['plans']),
  en(30, 'That sounds nice.', ['plans', 'statement']),
  en(31, 'Maybe later.', ['plans', 'yes_no_question']),
  en(32, 'I do not know.', ['wh_question']),
  en(33, 'Let me think.', ['wh_question', 'yes_no_question']),
  en(34, 'It is in my room.', ['wh_question']),
  en(35, 'Tell me more.', ['statement']),
  en(36, 'That is funny!', ['statement']),
  en(37, 'Oh no, I am sorry.', ['statement']),
  en(38, 'I am happy for you.', ['statement']),
  en(39, 'Really?', ['statement']),
  en(40, 'I agree.', ['statement', 'yes_no_question']),
  en(41, 'Can someone help me, please?', ['any']),
  en(42, 'I love you all.', ['any']),
  hi(1, 'हाँ।', ['yes_no_question', 'any']),
  hi(2, 'नहीं।', ['yes_no_question', 'any']),
  hi(3, 'पता नहीं।', ['yes_no_question', 'wh_question']),
  hi(4, 'फिर से बोलिए।', ['any']),
  hi(5, 'थोड़ा धीरे बोलिए।', ['any']),
  hi(6, 'रुकिए, मैं पढ़ रहा हूँ।', ['any']),
  hi(7, 'समझ गया।', ['statement', 'any']),
  hi(8, 'मुझे समझ नहीं आया।', ['statement', 'wh_question']),
  hi(9, 'नमस्ते! आपको देखकर अच्छा लगा।', ['greeting']),
  hi(10, 'शुभ रात्रि।', ['greeting']),
  hi(11, 'धन्यवाद।', ['thanks', 'any']),
  hi(12, 'हाँ, मैंने खाना खा लिया।', ['food']),
  hi(13, 'अभी नहीं, थोड़ी देर में खाऊँगा।', ['food']),
  hi(14, 'मुझे चाय चाहिए।', ['food']),
  hi(15, 'थोड़ा पानी दीजिए।', ['food']),
  hi(16, 'खाना बहुत अच्छा है।', ['food']),
  hi(17, 'मैं ठीक हूँ।', ['health_check']),
  hi(18, 'मैं थोड़ा थक गया हूँ।', ['health_check']),
  hi(19, 'मैंने दवा ले ली है।', ['health_check']),
  hi(20, 'हाँ, मैं चलूँगा।', ['plans']),
  hi(21, 'मैं घर पर ही रहूँगा।', ['plans']),
  hi(22, 'कितने बजे चलना है?', ['plans']),
  hi(23, 'और बताइए।', ['statement']),
  hi(24, 'बहुत अच्छा!', ['statement']),
  hi(25, 'कोई मेरी मदद करेगा?', ['any']),
];

/**
 * Suggested replies for the reply board, best first. Phrases whose `fits` include the intent of
 * lastHeard come first, then 'any' phrases; within a group, pack order. Only phrases in `lang`
 * (falling back to en-IN if that language has fewer than `limit`). Unreviewed phrases are
 * included only when includeDrafts is true. Deterministic.
 */
export function suggestReplies(lastHeard: string | null, lang: Lang, opts: { limit?: number; includeDrafts?: boolean } = {}): ReplyPhrase[] {
  const limit = Math.max(1, opts.limit ?? 8);
  const intent = lastHeard ? classifyUtterance(lastHeard, lang) : null;
  const pick = (l: Lang): ReplyPhrase[] => {
    const pool = REPLY_PHRASES.filter((p) => p.lang === l && (p.reviewed || opts.includeDrafts === true));
    const first = intent ? pool.filter((p) => p.fits.includes(intent)) : [];
    const second = pool.filter((p) => p.fits.includes('any') && !first.includes(p));
    return [...first, ...second];
  };
  let out = pick(lang);
  if (out.length < limit && lang !== 'en-IN') out = [...out, ...pick('en-IN')];
  return out.slice(0, limit);
}

// ---------- Personal sound: a phone plays a TV channel's audio in step with the TV ----------

/** Where the channel's media should be now (ms), given the TV's report and the server clock. */
export function channelPositionNow(c: { positionMs: number; playing: boolean; at: number }, serverNowMs: number): number {
  return c.playing ? c.positionMs + Math.max(0, serverNowMs - c.at) : c.positionMs;
}

export const SYNC_SEEK_MS = 300;
export const SYNC_OK_MS = 40;
export const SYNC_NUDGE = 0.04;

/**
 * One correction step for the phone's player: far off -> jump; slightly off -> play a little faster or
 * slower (inaudible at ±4%) until back in step; within SYNC_OK_MS -> normal speed.
 */
export function syncStep(currentMs: number, targetMs: number): { seekTo: number | null; rate: number; driftMs: number } {
  const driftMs = Math.round(currentMs - targetMs);
  if (Math.abs(driftMs) > SYNC_SEEK_MS) return { seekTo: targetMs, rate: 1, driftMs };
  if (Math.abs(driftMs) > SYNC_OK_MS) return { seekTo: null, rate: driftMs > 0 ? 1 - SYNC_NUDGE : 1 + SYNC_NUDGE, driftMs };
  return { seekTo: null, rate: 1, driftMs };
}
