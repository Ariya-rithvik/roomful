// Records the Roomful demo video from the REAL Fire OS APK running on the Android TV emulator (AVD
// motionmates_tv; the same APK sideloads onto a Fire TV stick). The family's phones are scripted test
// phones (scripts/sim-phones.mjs style) and the remote is driven with adb key events. Narration is
// Amazon Polly (Kajal); Dadi's spoken reply is the real Polly audio the server sent to her phone.
// Needs: the server on :8788 with ALERT_TEST=1, the emulator booted with the app open on the home screen.
//   npx tsx scripts/record-demo.ts
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = process.env.RC_URL ?? 'http://localhost:8788';
const ADB = join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const OUT = join(process.cwd(), 'demo');
const VO = join(OUT, 'vo');
mkdirSync(VO, { recursive: true });
const SERVER_LOG = process.env.RC_SERVER_LOG!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const adb = (...a: string[]) => execFileSync(ADB, a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const key = (code: number | string) => adb('shell', 'input', 'keyevent', String(code));
const KEY = { up: 19, down: 20, left: 21, right: 22, enter: 23, back: 4, menu: 82, rewind: 89 };

// ---------- voices ----------
const synth = (text: string, voice = 'Kajal', lang = 'en-IN') => {
  const file = join(VO, `${voice}-${createHash('sha1').update(voice + text).digest('hex').slice(0, 12)}.mp3`);
  if (!existsSync(file)) execFileSync('aws', ['polly', 'synthesize-speech', '--region', 'us-east-1', '--engine', 'neural', '--voice-id', voice, '--language-code', lang, '--output-format', 'mp3', '--text', text, file]);
  return { file, dur: Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) };
};
let go = 0;
const now = () => (Date.now() - go) / 1000;
const clips: { file: string; at: number }[] = [];
const caps: { at: number; end: number; text: string }[] = [];
const cap = (text: string) => { const l = caps[caps.length - 1]; if (l && l.end < 0) l.end = now(); caps.push({ at: now(), end: -1, text }); };
async function say(text: string) { const s = synth(text); clips.push({ file: s.file, at: now() }); await sleep(s.dur * 1000 + 350); }

// ---------- scripted test phones ----------
async function phone(clientId: string, name: string, lang: string, room: string) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/phone?room=${room}`);
  await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail); });
  ws.send(JSON.stringify({ t: 'hello', v: 1, clientId, name, lang, engine: 'device' }));
  const plays: { url: string; at: number }[] = [];
  let help = 'idle';
  ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'play') plays.push({ url: m.url, at: now() }); if (m.t === 'help') help = m.status; });
  await new Promise((ok) => ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'welcome') ok(null); }));
  let utt = 0;
  return {
    ws, plays, help: () => help,
    async say(text: string, level = 0.6, partialMs = 140) {
      const u = utt++, tStart = Date.now(), words = text.split(' ');
      for (let i = 1; i < words.length; i++) { ws.send(JSON.stringify({ t: 'caption', utt: u, seq: i, text: words.slice(0, i).join(' '), final: false, lang, tStart })); await sleep(partialMs); }
      ws.send(JSON.stringify({ t: 'caption', utt: u, seq: words.length, text, final: true, lang, tStart, level }));
    },
    send: (m: object) => ws.send(JSON.stringify(m)),
  };
}

// ---------- record ----------
const roomOf = () => [...readFileSync(SERVER_LOG, 'utf8').matchAll(/room ([A-Z0-9]{4}) created/g)].pop()?.[1];
const room = roomOf();
if (!room) throw new Error('no room yet: open the app on the TV first');
console.log('room', room);
spawnSync(ADB, ['shell', 'rm', '-f', '/sdcard/rf.mp4']);
const rec = spawn(ADB, ['shell', 'screenrecord', '--time-limit', '178', '--bit-rate', '10000000', '/sdcard/rf.mp4']);
await sleep(1500);
go = Date.now();

cap('Roomful · the family TV captions the table · Fire OS APK on the Android TV emulator · phones are scripted test phones');
await say('Roomful. Dadi is losing her hearing, and family dinners move too fast for her. Roomful turns the family TV into captions for the whole table.');
cap('Everyone scans the QR code with their own phone: no app to install');
const dadi = await phone('demo_dadi', 'Dadi', 'hi-IN', room);
await sleep(700);
const meena = await phone('demo_meena', 'Meena', 'en-IN', room);
await sleep(700);
const ravi = await phone('demo_ravi', 'Ravi', 'en-IN', room);
await say('Everyone joins by scanning the code with their own phone. No app to install.');

cap('Talk: each phone captions its owner, with name and colour · a cross-talk duplicate from a second phone is dropped');
key(KEY.down); await sleep(400); key(KEY.enter); // Home → Captions
await sleep(1200);
const talk = say('Each phone turns its owner’s speech into text, and the TV shows it big, with their name and colour.');
await meena.say('Dadi, did you have lunch today?', 0.7);
await ravi.say('did you have lunch today', 0.2, 40); // overheard by Ravi's phone: dropped
await sleep(900);
await dadi.say('हाँ, मैंने दाल चावल खाया।');
await sleep(600);
await ravi.say('We are going to the temple at five in the evening.');
await talk;
await meena.say('Do you want to come with us, or rest at home?');
await sleep(1500);

cap('Recover: Dadi presses Rewind on the remote → the last minute comes back, with “20 s ago” labels');
key(KEY.rewind);
await say('Missed something? Dadi presses rewind on the remote, and the last minute comes back.');
await sleep(1500);
key(KEY.rewind); // close it again
await sleep(1200);

cap('Reply: Dadi picks a phrase with the remote → Amazon Polly says it aloud from her own phone');
key(KEY.enter); // Captions → Reply board
await sleep(1500);
await say('Speaking is hard for her too, so she picks a reply with the remote.');
key(KEY.enter); await sleep(1500); // pick the first phrase → confirm screen
key(KEY.enter); // "Yes, say it"
const replyAt = now();
await sleep(6000);
const play = dadi.plays[dadi.plays.length - 1];
if (play) {
  const f = join(VO, `reply-${Date.now()}.mp3`);
  const r = await fetch(new URL(play.url, BASE));
  writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  clips.push({ file: f, at: play.at });
  console.log('reply audio from the server at', play.at.toFixed(1));
} else console.log('no reply audio arrived (reply at', replyAt.toFixed(1), ')');
await say('Amazon Polly speaks it from her own phone, so the voice comes from where she sits.');

cap('Help mode: the Menu key on the remote → 5 s countdown → every family phone alarms until someone answers “I’m coming”');
key(KEY.menu);
await say('If she needs help, one button. After a five second countdown, every family phone alarms, until someone answers.');
for (let i = 0; i < 20 && ravi.help() !== 'active'; i++) await sleep(500);
await sleep(2500);
ravi.send({ t: 'help_ack' });
await sleep(1200);
await say('Ravi answers, I’m coming, and the TV turns green so she knows.');
await sleep(1500);
dadi.send({ t: 'help_cancel' });
await sleep(1500);

cap('The watchful TV: real GDACS disaster alerts for the family’s home (Chennai) · this one is a labelled TEST drill');
await fetch(`${BASE}/api/alerts/test`, { method: 'POST' });
await say('The TV also watches real disaster alerts for the family’s home area. This one is a drill, and it says so.');
await sleep(2000);
key(KEY.enter); await sleep(800);

cap('Channel wall: four channels at once · each phone plays the channel its owner chose, in sync with the picture');
key(KEY.back); await sleep(1000);
for (let i = 0; i < 3; i++) { key(KEY.up); await sleep(250); }
key(KEY.right); await sleep(400); key(KEY.enter);
await sleep(2500);
await say('And for the kids: four channels at once. Each phone plays the sound of the channel its owner picked, in step with the picture.');
await sleep(4000);
cap('Roomful · Talk · Recover · Reply · Show · nobody at the table is left out');
await say('Roomful. Talk, recover, reply, show. Nobody at the table is left out.');
await sleep(1500);
const total = now();
caps[caps.length - 1].end = total;
for (const p of [dadi, meena, ravi]) p.ws.close();
await new Promise((ok) => { rec.on('exit', ok); spawnSync(ADB, ['shell', 'pkill', '-INT', 'screenrecord']); });
await sleep(1500);
adb('pull', '/sdcard/rf.mp4', join(OUT, 'tv-raw.mp4'));
console.log(`recorded ${total.toFixed(1)} s`);

// ---------- composite ----------
const FONT = "C\\:/Windows/Fonts/segoeui.ttf", BOLD = "C\\:/Windows/Fonts/segoeuib.ttf";
let nf = 0;
const tf = (text: string) => { const f = join(VO, `t${nf++}.txt`); writeFileSync(f, text); return f.replace(/\\/g, '/').replace(':', '\\:'); };
const wrap = (t: string, n: number) => { const out: string[] = []; let line = ''; for (const w of t.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w; } out.push(line.trim()); return out; };
const en = (a: number, b: number) => `enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`;
const draws = [
  `drawbox=x=1380:y=14:w=526:h=40:color=0x05080C@0.85:t=fill`,
  `drawtext=fontfile='${BOLD}':textfile='${tf('Android TV emulator · same Fire OS APK')}':x=1394:y=22:fontsize=21:fontcolor=0xFFC247`,
];
for (const c of caps) {
  const lines = wrap(c.text, 110);
  draws.push(`drawbox=x=0:y=968:w=1920:h=112:color=0x0B0705@0.9:t=fill:${en(c.at, c.end)}`, `drawbox=x=0:y=968:w=1920:h=3:color=0xF4A259:t=fill:${en(c.at, c.end)}`);
  lines.forEach((l, i) => draws.push(`drawtext=fontfile='${FONT}':textfile='${tf(l)}':x=(1920-text_w)/2:y=${lines.length === 1 ? 1008 : 988 + i * 40}:fontsize=30:fontcolor=white:${en(c.at, c.end)}`));
}
const vf = [`[0:v]scale=1920:1080,fps=30,${draws.join(',')}[v]`];
clips.forEach((c, i) => vf.push(`[${1 + i}:a]adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)}[s${i}]`));
vf.push(`${clips.map((_, i) => `[s${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,volume=1.5,apad[aud]`);
writeFileSync(join(OUT, 'filter.txt'), vf.join(';\n'));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1.5', '-i', join(OUT, 'tv-raw.mp4'), ...clips.flatMap((c) => ['-i', c.file]), '-filter_complex_script', join(OUT, 'filter.txt'), '-map', '[v]', '-map', '[aud]', '-t', total.toFixed(2),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', join(OUT, 'roomful-demo.mp4')], { stdio: 'inherit' });
console.log(`done: demo/roomful-demo.mp4 (${total.toFixed(1)} s)`);
