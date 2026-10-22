import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Hunt, MomentDetector, OBJECTS, OBJECT_LABELS, HUNT_PROMPTS, decideScan, scanOutcome, pickHuntPrompts, matchesPrompt, isObjectLabel,
} from '../src/hunt';

test('every prompt can be satisfied by at least one object', () => {
  for (const p of HUNT_PROMPTS) assert.ok(OBJECT_LABELS.some((l) => matchesPrompt(p, l)), p.id);
  for (const l of OBJECT_LABELS) assert.equal(OBJECTS[l].label, l);
  assert.equal(isObjectLabel('knife'), false);
  assert.equal(isObjectLabel('cup'), true);
});

test('scan decisions ask rather than guess', () => {
  assert.equal(decideScan(0.9), 'propose');
  assert.equal(decideScan(0.6), 'propose');
  assert.equal(decideScan(0.5), 'pick');
  assert.equal(decideScan(0.2), 'manual');
  assert.equal(decideScan(null), 'manual');
  assert.equal(decideScan(Number.NaN), 'manual');
  assert.equal(scanOutcome('cup', 'cup'), 'confirmed');
  assert.equal(scanOutcome('cup', 'bowl'), 'corrected');
  assert.equal(scanOutcome(null, 'bowl'), 'manual');
});

test('prompts are deterministic per seed and distinct', () => {
  assert.deepEqual(pickHuntPrompts(42, 4), pickHuntPrompts(42, 4));
  const p = pickHuntPrompts(7, 6);
  assert.equal(new Set(p.map((x) => x.id)).size, 6);
  assert.equal(pickHuntPrompts(1, 50).length, HUNT_PROMPTS.length);
});

test('hunt: first matching scan wins the round, wrong scans score nothing', () => {
  const h = new Hunt();
  assert.deepEqual(h.scan('a', 'cup'), { accepted: false, reason: 'not_playing' });
  h.start(3, 2);
  const v = h.view();
  assert.equal(v.status, 'playing');
  assert.deepEqual([v.round, v.total], [1, 2]);
  const prompt = HUNT_PROMPTS.find((p) => p.id === v.prompt!.id)!;
  const right = OBJECT_LABELS.find((l) => matchesPrompt(prompt, l))!;
  const wrong = OBJECT_LABELS.find((l) => !matchesPrompt(prompt, l))!;
  assert.deepEqual(h.scan('a', wrong), { accepted: true, ok: false, roundWon: false });
  assert.deepEqual(h.scan('b', right), { accepted: true, ok: true, roundWon: true });
  assert.deepEqual(h.scan('a', right), { accepted: false, reason: 'already_won' });
  assert.deepEqual(h.view().winners, ['b']);
  assert.equal(h.view().status, 'won');
  h.next();
  assert.equal(h.view().round, 2);
  h.next(); // skip the last round
  const done = h.view();
  assert.equal(done.status, 'done');
  assert.deepEqual(done.scores, [{ speakerId: 'b', points: 1 }]);
  assert.deepEqual(done.winners, ['b']);
});

test('hunt: ties at the end list every leader; rounds are clamped', () => {
  const h = new Hunt();
  h.start(9, 99);
  assert.equal(h.view().total, 6);
  for (const who of ['x', 'y']) {
    const p = HUNT_PROMPTS.find((q) => q.id === h.view().prompt!.id)!;
    h.scan(who, OBJECT_LABELS.find((l) => matchesPrompt(p, l))!);
    h.next();
  }
  h.end();
  assert.deepEqual(h.view().winners, ['x', 'y']);
  h.reset();
  assert.equal(h.view().status, 'idle');
});

test('moments: sustained smile triggers once, then cooldown; gaps break the sustain', () => {
  const m = new MomentDetector({ threshold: 0.6, sustainMs: 500, cooldownMs: 20_000 });
  const fired: number[] = [];
  for (let t = 0; t <= 2000; t += 200) if (m.push(t, 0.8)) fired.push(t);
  assert.deepEqual(fired, [600]);
  assert.equal(m.push(25_000, 0.9), false, 'new smile must be sustained again');
  assert.equal(m.push(25_600, 0.9), true);
  // A 1.5 s gap (no face) resets the sustain.
  const g = new MomentDetector({ threshold: 0.6, sustainMs: 500, cooldownMs: 0 });
  g.push(0, 0.9);
  assert.equal(g.push(1500, 0.9), false);
  assert.equal(g.push(2000, 0.9), true);
  // Below threshold or no face never fires.
  const n = new MomentDetector();
  for (let t = 0; t < 5000; t += 100) assert.equal(n.push(t, t % 200 === 0 ? 0.5 : null), false);
  // A manual moment starts the cooldown.
  const c = new MomentDetector({ threshold: 0.6, sustainMs: 0, cooldownMs: 10_000 });
  c.markTriggered(0);
  assert.equal(c.push(5000, 0.9), false);
  assert.equal(c.push(10_000, 0.9), true);
});
