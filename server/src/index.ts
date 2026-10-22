import { existsSync, readFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { pollyTts } from './tts';
import { transcribeEngine } from './speech';
import { liveSources } from './channels';
import { GDACS_RSS, parseGdacs } from './alerts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency): KEY=value lines in server/.env.
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const port = Number(process.env.PORT ?? 8787);
const tls =
  process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
    ? { certFile: resolve(root, process.env.TLS_CERT_FILE), keyFile: resolve(root, process.env.TLS_KEY_FILE) }
    : undefined;

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);
// PUBLIC_URL unset or "auto": the join link follows this PC's current Wi-Fi address, so moving to
// another network does not leave phones with a dead QR code. The address is the one the OS would use
// for the internet (a UDP "connect" picks the route; no packet is sent), which skips VirtualBox, VPN
// and WSL adapters.
const routeIp = await new Promise<string | undefined>((ok) => {
  const sock = createSocket('udp4');
  sock.on('error', () => (sock.close(), ok(undefined)));
  sock.connect(53, '1.1.1.1', () => {
    const ip = sock.address().address;
    sock.close();
    ok(ip);
  });
});
const homeLan = routeIp && lan.includes(routeIp) ? routeIp : lan.find((ip) => /^(192\.168\.|10\.)/.test(ip)) ?? lan[0];
const autoUrl = homeLan ? `${tls ? 'https' : 'http'}://${homeLan}:${port}` : undefined;
const publicUrl = !process.env.PUBLIC_URL || process.env.PUBLIC_URL === 'auto' ? autoUrl : process.env.PUBLIC_URL;

const app = createApp({
  publicUrl,
  staticDir: resolve(root, process.env.PHONE_DIST ?? '../phone-web/dist'),
  dataDir: resolve(root, process.env.DATA_DIR ?? 'data'),
  tls,
  tts: process.env.TTS === 'off' ? undefined : pollyTts(),
  speech: process.env.SERVER_SPEECH === 'transcribe' ? transcribeEngine() : undefined,
  captureText: process.env.CAPTURE_TEXT === '1',
  sources: liveSources(),
  alerts: {
    poll: async () => {
      const res = await fetch(GDACS_RSS, { headers: { 'user-agent': 'Roomcaption/0.1 (family TV)' } });
      return res.ok ? parseGdacs(await res.text()) : null;
    },
    watch: {
      homeLat: process.env.HOME_LAT ? Number(process.env.HOME_LAT) : null,
      homeLon: process.env.HOME_LON ? Number(process.env.HOME_LON) : null,
      radiusKm: Number(process.env.ALERT_RADIUS_KM ?? 300),
      countries: (process.env.ALERT_COUNTRIES ?? 'IND').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
    },
    allowTest: process.env.ALERT_TEST === '1',
  },
  log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
});

await app.listen(port);
const plainPort = tls && process.env.TV_HTTP_PORT ? await app.listenPlain(Number(process.env.TV_HTTP_PORT)) : null;
const scheme = tls ? 'https' : 'http';
console.log(`Roomful server on ${scheme}://localhost:${port}`);
console.log(`  Phones join at: ${publicUrl ?? '(the address the TV used)'}`);
for (const ip of lan) console.log(`  LAN: ${scheme}://${ip}:${port}${plainPort ? `   TV (plain): http://${ip}:${plainPort}` : ''}`);
if (!tls && !process.env.PUBLIC_URL?.startsWith('https://')) console.log('  NOTE: phones need HTTPS for the microphone. Set TLS_CERT_FILE/TLS_KEY_FILE or PUBLIC_URL.');
console.log(`  Speech on the server: ${process.env.SERVER_SPEECH === 'transcribe' ? 'Amazon Transcribe' : 'off (phones recognise speech themselves)'}`);
if (process.env.CAPTURE_TEXT === '1') console.log('  MEASUREMENT MODE: caption text is being saved to data/captured.jsonl (phones are told).');

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
