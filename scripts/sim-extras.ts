// Test tool, not part of the product: two scripted phones play the Table Hunt (one wrong and one
// right scan per round) and upload a generated, clearly labelled test clip as a "moment", so the TV
// screens can be checked without people or cameras.
//
//   npx tsx scripts/sim-extras.ts <ROOM> [clip.mp4] [http://localhost:8788]
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { HUNT_PROMPTS, OBJECT_LABELS, matchesPrompt } from '../shared/src/hunt';

const [room, clipPath, base = 'http://localhost:8788'] = process.argv.slice(2);
if (!/^[A-Z0-9]{4}$/.test(room ?? '')) {
  console.error('usage: npx tsx scripts/sim-extras.ts <ROOM> [clip.mp4] [http://host:port]');
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Phone { ws: WebSocket; speakerId: string; uploadToken: string; name: string }

async function phone(clientId: string, name: string): Promise<Phone> {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/phone?room=${room}`);
  await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail); });
  ws.send(JSON.stringify({ t: 'hello', v: 1, clientId, name, lang: 'en-IN', engine: 'device' }));
  const w = await new Promise<{ speakerId: string; uploadToken: string }>((ok) => ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'welcome') ok(m); }));
  console.log(`${name} joined as ${w.speakerId}`);
  return { ws, speakerId: w.speakerId, uploadToken: w.uploadToken, name };
}

const asha = await phone('sim_asha', 'Asha');
const ravi = await phone('sim_ravi2', 'Ravi');

if (clipPath) {
  const body = readFileSync(clipPath);
  const q = new URLSearchParams({ room, speaker: asha.speakerId, reason: 'manual', tStart: String(Date.now()), durationMs: '4000' });
  const res = await fetch(`${base}/api/clips?${q}`, { method: 'POST', body, headers: { 'content-type': 'video/mp4', 'x-rc-token': asha.uploadToken } });
  console.log(`test clip upload: HTTP ${res.status}`);
}

// Play the hunt whenever the TV starts one: Ravi shows a wrong object, then Asha the right one.
let lastRound = -1;
asha.ws.on('message', async (d) => {
  const m = JSON.parse(String(d));
  if (m.t !== 'hunt' || m.status !== 'playing' || m.round === lastRound) return;
  lastRound = m.round;
  const prompt = HUNT_PROMPTS.find((p) => p.id === m.prompt.id)!;
  const right = OBJECT_LABELS.find((l) => matchesPrompt(prompt, l))!;
  const wrong = OBJECT_LABELS.find((l) => !matchesPrompt(prompt, l))!;
  await sleep(2500);
  ravi.ws.send(JSON.stringify({ t: 'scan', label: wrong, outcome: 'confirmed', detected: wrong, conf: 0.71 }));
  console.log(`round ${m.round} "${prompt.text}": Ravi shows ${wrong}`);
  await sleep(2500);
  asha.ws.send(JSON.stringify({ t: 'scan', label: right, outcome: 'manual' }));
  console.log(`round ${m.round}: Asha shows ${right}`);
});
console.log('waiting for the TV to start a hunt (2 minutes)…');
await sleep(120_000);
asha.ws.close();
ravi.ws.close();
