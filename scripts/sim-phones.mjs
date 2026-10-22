// Test tool, not part of the product: two scripted "phones" join a room and talk, so the TV
// screens can be checked without real people. Includes a cross-talk duplicate (the far phone
// also hears Meena) and partial results that grow word by word, like a real recogniser.
//
//   node scripts/sim-phones.mjs <ROOM> [server=ws://localhost:8788]
import WebSocket from 'ws';

const room = process.argv[2];
const server = process.argv[3] ?? 'ws://localhost:8788';
if (!/^[A-Z0-9]{4}$/.test(room ?? '')) {
  console.error('usage: node scripts/sim-phones.mjs <ROOM> [ws://host:port]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function phone(clientId, name, lang) {
  const ws = new WebSocket(`${server}/ws/phone?room=${room}`);
  await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail); });
  ws.send(JSON.stringify({ t: 'hello', v: 1, clientId, name, lang, engine: 'device' }));
  const welcome = await new Promise((ok) => ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'welcome') ok(m); }));
  console.log(`${name} joined as ${welcome.speakerId}`);
  let utt = 0;
  return {
    ws,
    async say(text, { level, partialMs = 120 } = {}) {
      const u = utt++;
      const tStart = Date.now();
      const words = text.split(' ');
      for (let i = 1; i < words.length; i++) {
        ws.send(JSON.stringify({ t: 'caption', utt: u, seq: i, text: words.slice(0, i).join(' '), final: false, lang, tStart }));
        await sleep(partialMs);
      }
      ws.send(JSON.stringify({ t: 'caption', utt: u, seq: words.length, text, final: true, lang, tStart, ...(level !== undefined ? { level } : {}) }));
      return tStart;
    },
  };
}

const meena = await phone('sim_meena', 'Meena', 'en-IN');
const ravi = await phone('sim_ravi', 'Ravi', 'en-IN');
const dadi = await phone('sim_dadi', 'Dadi', 'hi-IN');
await sleep(1500);

await meena.say('Dadi, did you have lunch today?', { level: 0.7 });
// Ravi's phone overhears Meena a little later and more quietly: the server must drop it.
await ravi.say('did you have lunch today', { level: 0.2, partialMs: 40 });
await sleep(1200);
await dadi.say('हाँ, मैंने दाल चावल खाया।', { level: 0.6 });
await sleep(1000);
await ravi.say('We are going to the temple at five in the evening.', { level: 0.6 });
await sleep(800);
await meena.say('Do you want to come with us, or rest at home?', { level: 0.6 });
await sleep(1500);
await ravi.say('The match last night was amazing, we won by three wickets.', { level: 0.6 });
console.log('script done; phones stay connected for 60 s');
await sleep(60_000);
for (const p of [meena, ravi, dadi]) p.ws.close();
