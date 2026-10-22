// Test tool, not part of the product: one scripted phone ("Anu") brings a generated, clearly
// labelled test photo "into the TV" and saves a generated test clip as a moment, so the arrival
// animation, the shelf and the Family break can be checked without a phone camera.
//
//   npx tsx scripts/sim-object.ts <ROOM> <photo.jpg> <clip.mp4> [label] [http://localhost:8788]
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const [room, photo, clip, label = 'teddy bear', base = 'http://localhost:8788'] = process.argv.slice(2);
if (!/^[A-Z0-9]{4}$/.test(room ?? '') || !photo || !clip) {
  console.error('usage: npx tsx scripts/sim-object.ts <ROOM> <photo.jpg> <clip.mp4> [label] [http://host:port]');
  process.exit(1);
}
const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/phone?room=${room}`);
await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail); });
ws.send(JSON.stringify({ t: 'hello', v: 1, clientId: 'sim_anu', name: 'Anu', lang: 'en-IN', engine: 'device' }));
const w = await new Promise<{ speakerId: string; uploadToken: string }>((ok) => ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'welcome') ok(m); }));
const h = { 'x-rc-token': w.uploadToken };
const c = await fetch(`${base}/api/clips?${new URLSearchParams({ room, speaker: w.speakerId, reason: 'smile', tStart: String(Date.now()), durationMs: '4000' })}`, {
  method: 'POST', body: readFileSync(clip), headers: { ...h, 'content-type': 'video/mp4' },
});
console.log(`test moment upload: HTTP ${c.status}`);
await new Promise((r) => setTimeout(r, 3000));
const o = await fetch(`${base}/api/objects?${new URLSearchParams({ room, speaker: w.speakerId, label })}`, {
  method: 'POST', body: readFileSync(photo), headers: { ...h, 'content-type': 'image/jpeg' },
});
console.log(`test object upload (${label}): HTTP ${o.status}`);
await new Promise((r) => setTimeout(r, 60_000));
ws.close();
