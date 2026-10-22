// Joins a room as a phone and prints the channel reports the TV sends (personal sound check).
// Usage: node scripts/listen-probe.mjs ROOM [seconds]
import WebSocket from 'ws';
const room = process.argv[2]; const secs = Number(process.argv[3] ?? 12);
const ws = new WebSocket(`ws://127.0.0.1:8788/ws/phone?room=${room}`);
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, clientId: 'probe_listen', name: 'Probe', lang: 'en-IN', engine: 'device' })));
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.t === 'channels') console.log(Date.now(), JSON.stringify(m.channels.map((c) => ({ id: c.id, title: c.title, pos: c.positionMs, playing: c.playing, age: Date.now() - c.at }))));
  else if (m.t !== 'pong') console.log('msg', m.t);
});
setTimeout(() => process.exit(0), secs * 1000);
