import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, textSimilarity, CrossTalkFilter, ClockSync, CaptionStore, wordErrorRate,
  classifyUtterance, suggestReplies, REPLY_PHRASES, channelPositionNow, syncStep,
} from '../src/logic';
import type { CaptionOut } from '../src/protocol';

test('normalizeText keeps scripts, drops punctuation', () => {
  assert.equal(normalizeText('  Grandma, did you EAT?! '), 'grandma did you eat');
  assert.equal(normalizeText('दादी, खाना खाया?'), 'दादी खाना खाया');
  assert.equal(normalizeText('हम मंदिर जा रहे हैं।'), 'हम मंदिर जा रहे हैं');
  assert.equal(normalizeText('சாப்பிட்டீர்களா?'), 'சாப்பிட்டீர்களா');
  assert.equal(normalizeText('...'), '');
});

test('textSimilarity', () => {
  assert.equal(textSimilarity('Did you eat?', 'did you eat'), 1);
  assert.equal(textSimilarity('hello there', 'goodbye now'), 0);
  assert.equal(textSimilarity('', ''), 1);
  assert.equal(textSimilarity('a', ''), 0);
  const s = textSimilarity('we go to the temple at five', 'we go to the temple at 5');
  assert.ok(s > 0.8 && s < 1, String(s));
  assert.equal(textSimilarity('yes yes', 'yes'), 2 / 3);
});

const fin = (speakerId: string, utt: number, text: string, tStart: number, extra: { level?: number; conf?: number } = {}) => ({ speakerId, utt, text, tStart, tRecv: tStart + 500, ...extra });

test('cross-talk: louder phone owns the sentence regardless of arrival order', () => {
  for (const order of [0, 1]) {
    const f = new CrossTalkFilter();
    const near = fin('spk_aaaa', 1, 'Did you have lunch?', 1000, { level: 0.6 });
    const far = fin('spk_bbbb', 7, 'did you have lunch', 1200, { level: 0.2 });
    const [first, second] = order === 0 ? [near, far] : [far, near];
    const d1 = f.offer(first);
    const d2 = f.offer(second);
    assert.equal(d1.keep, true);
    if (order === 0) {
      assert.deepEqual(d2, { keep: false, drop: [] });
    } else {
      assert.deepEqual(d2, { keep: true, drop: [{ speakerId: 'spk_bbbb', utt: 7 }] });
    }
  }
});

test('cross-talk: different sentences, same speaker, or far apart in time are all kept', () => {
  const f = new CrossTalkFilter();
  assert.equal(f.offer(fin('spk_aaaa', 1, 'Did you have lunch?', 1000)).keep, true);
  assert.equal(f.offer(fin('spk_bbbb', 1, 'Yes I had rice and dal', 1300)).keep, true);
  assert.equal(f.offer(fin('spk_aaaa', 2, 'did you have lunch', 1400)).keep, true, 'same speaker repeating');
  assert.equal(f.offer(fin('spk_cccc', 1, 'did you have lunch', 5000)).keep, true, 'outside the window');
});

test('cross-talk: falls back to confidence, then earlier start, then speaker id', () => {
  let f = new CrossTalkFilter();
  f.offer(fin('spk_aaaa', 1, 'see you tomorrow', 1000, { conf: 0.5 }));
  assert.equal(f.offer(fin('spk_bbbb', 1, 'see you tomorrow', 1100, { conf: 0.9 })).keep, true);
  f = new CrossTalkFilter();
  f.offer(fin('spk_bbbb', 1, 'see you tomorrow', 1100));
  assert.deepEqual(f.offer(fin('spk_aaaa', 1, 'see you tomorrow', 1000)).drop, [{ speakerId: 'spk_bbbb', utt: 1 }]);
  f = new CrossTalkFilter();
  f.offer(fin('spk_bbbb', 1, 'see you tomorrow', 1000));
  assert.equal(f.offer(fin('spk_aaaa', 1, 'see you tomorrow', 1000)).keep, true);
});

test('clock sync picks the lowest round-trip sample', () => {
  const c = new ClockSync(4);
  assert.equal(c.offset(), null);
  assert.equal(c.toServer(100), 100);
  c.addSample(0, 1050, 100); // rtt 100, offset 1000
  c.addSample(200, 1215, 220); // rtt 20, offset 1005
  c.addSample(300, 2000, 900); // rtt 600
  c.addSample(10, 0, 5); // negative rtt ignored
  assert.equal(c.rtt(), 20);
  assert.equal(c.offset(), 1005);
  assert.equal(c.toServer(0), 1005);
  for (let i = 0; i < 4; i++) c.addSample(1000, 2500, 1300); // pushes the good sample out
  assert.equal(c.rtt(), 300);
});

const cap = (speakerId: string, utt: number, text: string, final: boolean, tStart: number, reply = false): CaptionOut => ({
  t: 'caption', speakerId, utt, text, final, lang: 'en-IN', tStart, tRecv: tStart + 300, ...(reply ? { reply } : {}),
});

test('caption store: partials replace, finals freeze, empty final removes, order by start time', () => {
  const s = new CaptionStore();
  s.apply(cap('spk_aaaa', 1, 'did you', false, 1000));
  s.apply(cap('spk_aaaa', 1, 'did you eat', false, 1000));
  assert.deepEqual(s.all().map((l) => l.text), ['did you eat']);
  s.apply(cap('spk_aaaa', 1, 'Did you eat?', true, 1000));
  s.apply(cap('spk_aaaa', 1, 'stale partial', false, 1000));
  assert.deepEqual(s.all().map((l) => [l.text, l.final]), [['Did you eat?', true]]);
  s.apply(cap('spk_bbbb', 4, 'earlier sentence', true, 500));
  assert.deepEqual(s.all().map((l) => l.text), ['earlier sentence', 'Did you eat?']);
  s.apply(cap('spk_cccc', 2, 'um', false, 1500));
  s.apply(cap('spk_cccc', 2, '', true, 1500));
  assert.equal(s.all().length, 2);
  s.drop({ t: 'drop', speakerId: 'spk_bbbb', utt: 4, reason: 'duplicate' });
  s.apply(cap('spk_bbbb', 4, 'late partial after drop', false, 500));
  assert.deepEqual(s.all().map((l) => l.text), ['Did you eat?']);
});

test('caption store: max lines', () => {
  const s = new CaptionStore(3);
  for (let i = 0; i < 6; i++) s.apply(cap('spk_aaaa', i, `line ${i}`, true, i * 100));
  assert.deepEqual(s.all().map((l) => l.text), ['line 3', 'line 4', 'line 5']);
});

test('caption store: pause, scroll back, scroll forward, live', () => {
  const s = new CaptionStore();
  for (let i = 0; i < 10; i++) s.apply(cap('spk_aaaa', i, `L${i}`, true, i * 100));
  assert.deepEqual(s.visible(3).map((l) => l.text), ['L7', 'L8', 'L9']);
  assert.equal(s.isLive(), true);
  s.pause();
  s.apply(cap('spk_aaaa', 10, 'L10', true, 1000));
  assert.deepEqual(s.visible(3).map((l) => l.text), ['L7', 'L8', 'L9'], 'paused view does not move');
  s.scrollBack(4);
  assert.deepEqual(s.visible(3).map((l) => l.text), ['L3', 'L4', 'L5']);
  s.scrollForward(100);
  assert.deepEqual(s.visible(2).map((l) => l.text), ['L9', 'L10'], 'paused: forward stops at newest but stays paused');
  assert.equal(s.isLive(), false);
  s.resume();
  assert.equal(s.isLive(), true);
  s.scrollBack(2);
  assert.deepEqual(s.visible(2).map((l) => l.text), ['L7', 'L8']);
  s.scrollForward(2);
  assert.equal(s.isLive(), true, 'not paused: reaching the newest line goes live');
  s.scrollBack(1000);
  assert.deepEqual(s.visible(5).map((l) => l.text), ['L0']);
  s.scrollToLive();
  assert.deepEqual(s.visible(1).map((l) => l.text), ['L10']);
});

test('caption store: a late line inserted above a frozen view keeps the view anchored', () => {
  const s = new CaptionStore();
  for (let i = 0; i < 5; i++) s.apply(cap('spk_aaaa', i, `L${i}`, true, i * 100));
  s.pause();
  s.apply(cap('spk_bbbb', 1, 'late', true, 250));
  // The view stays anchored on L4; the late line slots in by start time.
  assert.deepEqual(s.visible(3).map((l) => l.text), ['late', 'L3', 'L4']);
});

test('caption store: pause on empty store stays empty until resume', () => {
  const s = new CaptionStore();
  s.pause();
  s.apply(cap('spk_aaaa', 0, 'hello', true, 0));
  assert.deepEqual(s.visible(3), []);
  s.resume();
  assert.equal(s.visible(3).length, 1);
});

test('caption store: lastFinal', () => {
  const s = new CaptionStore();
  assert.equal(s.lastFinal(), null);
  s.apply(cap('spk_aaaa', 0, 'Did you eat?', true, 0));
  s.apply(cap('spk_bbbb', 0, 'Yes', true, 100, true));
  s.apply(cap('spk_aaaa', 1, 'partial', false, 200));
  assert.equal(s.lastFinal()?.text, 'Yes');
  assert.equal(s.lastFinal('spk_bbbb')?.text, 'Did you eat?');
});

test('word error rate', () => {
  assert.deepEqual(wordErrorRate('did you eat lunch', 'did you eat lunch'), { wer: 0, substitutions: 0, deletions: 0, insertions: 0, refWords: 4, hypWords: 4 });
  // Several alignments cost 3 here; only the total is defined.
  const r = wordErrorRate('did you eat lunch', 'did eat munch today');
  assert.equal(r.substitutions + r.deletions + r.insertions, 3);
  assert.equal(r.wer, 3 / 4);
  const d = wordErrorRate('one two three four', 'one four');
  assert.deepEqual([d.substitutions, d.deletions, d.insertions], [0, 2, 0]);
  const i = wordErrorRate('one two', 'one extra two more');
  assert.deepEqual([i.substitutions, i.deletions, i.insertions], [0, 0, 2]);
  assert.equal(wordErrorRate('', '').wer, 0);
  assert.equal(wordErrorRate('', 'noise').wer, 1);
  assert.equal(wordErrorRate('दादी खाना खाया', 'दादी खाना').wer, 1 / 3);
  assert.equal(wordErrorRate('Hello, world!', 'hello world').wer, 0);
});

test('classifyUtterance', () => {
  assert.equal(classifyUtterance('Did you have lunch?', 'en-IN'), 'food');
  assert.equal(classifyUtterance('दादी, खाना खाया?', 'hi-IN'), 'food');
  assert.equal(classifyUtterance('How are you feeling today?', 'en-IN'), 'health_check');
  assert.equal(classifyUtterance('Are we going to the temple tomorrow?', 'en-IN'), 'plans');
  assert.equal(classifyUtterance('Where did you keep my glasses?', 'en-IN'), 'wh_question');
  assert.equal(classifyUtterance('Is Ravi coming?', 'en-IN'), 'yes_no_question');
  assert.equal(classifyUtterance('क्या रवि आ रहा है', 'hi-IN'), 'yes_no_question');
  assert.equal(classifyUtterance('Thank you so much', 'en-IN'), 'thanks');
  assert.equal(classifyUtterance('Good morning everyone', 'en-IN'), 'greeting');
  assert.equal(classifyUtterance('The match was amazing', 'en-IN'), 'statement');
  assert.equal(classifyUtterance('', 'en-IN'), 'statement');
});

test('suggestReplies is deterministic and fits the intent', () => {
  const a = suggestReplies('Did you have lunch?', 'en-IN');
  assert.deepEqual(a, suggestReplies('Did you have lunch?', 'en-IN'));
  assert.equal(a.length, 8);
  assert.ok(a[0].fits.includes('food'));
  assert.equal(a[0].text, 'Yes, I have eaten.');
  const none = suggestReplies(null, 'en-IN', { limit: 4 });
  assert.ok(none.every((p) => p.fits.includes('any')));
  // Hindi drafts are not shown unless asked: falls back to reviewed English.
  assert.ok(suggestReplies('खाना खाया?', 'hi-IN').every((p) => p.lang === 'en-IN'));
  const drafts = suggestReplies('खाना खाया?', 'hi-IN', { includeDrafts: true });
  assert.equal(drafts[0].lang, 'hi-IN');
  assert.ok(drafts[0].fits.includes('food'));
});

test('phrase pack sanity', () => {
  const ids = new Set(REPLY_PHRASES.map((p) => p.id));
  assert.equal(ids.size, REPLY_PHRASES.length, 'unique ids');
  assert.ok(REPLY_PHRASES.filter((p) => p.lang === 'en-IN' && p.reviewed).length >= 40);
  assert.ok(REPLY_PHRASES.filter((p) => p.lang === 'hi-IN').length >= 25);
  assert.ok(REPLY_PHRASES.filter((p) => p.lang === 'hi-IN').every((p) => !p.reviewed));
  assert.ok(REPLY_PHRASES.every((p) => p.text.length <= 80));
});

test('personal sound: position extrapolation and sync steps', () => {
  assert.equal(channelPositionNow({ positionMs: 10_000, playing: true, at: 1000 }, 3500), 12_500);
  assert.equal(channelPositionNow({ positionMs: 10_000, playing: false, at: 1000 }, 3500), 10_000, 'paused stays put');
  assert.equal(channelPositionNow({ positionMs: 10_000, playing: true, at: 5000 }, 3500), 10_000, 'clock skew never goes backwards');
  assert.deepEqual(syncStep(5000, 9000), { seekTo: 9000, rate: 1, driftMs: -4000 });
  assert.deepEqual(syncStep(9100, 9000), { seekTo: null, rate: 0.96, driftMs: 100 }, 'ahead: slow down');
  assert.deepEqual(syncStep(8900, 9000), { seekTo: null, rate: 1.04, driftMs: -100 }, 'behind: speed up');
  assert.deepEqual(syncStep(9020, 9000), { seekTo: null, rate: 1, driftMs: 20 });
});
