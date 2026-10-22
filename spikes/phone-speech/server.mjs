// Day-0 phone spike: serves index.html over HTTPS (self-signed) so a phone on the same Wi-Fi
// can use its microphone. The page posts each result back here so we get a log of real timings.
import { createServer } from 'node:https';
import { readFileSync, appendFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const certDir = 'D:/motionmates/certs/';
const page = readFileSync(new URL('./index.html', import.meta.url));
const port = 8443;

createServer({ cert: readFileSync(certDir + 'test.pem'), key: readFileSync(certDir + 'test-key.pem') }, (req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      appendFileSync(new URL('./results.jsonl', import.meta.url), body.trim() + '\n');
      console.log(body.trim());
      res.end('ok');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
}).listen(port, () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('Open on the phone (same Wi-Fi), accept the certificate warning:');
  for (const ip of ips) console.log(`  https://${ip}:${port}`);
});
