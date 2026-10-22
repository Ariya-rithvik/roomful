// Turns the server's measurement logs into the numbers we are allowed to show.
//   npx tsx scripts/summarize.ts [server/data] [--room ABCD] [--refs refs.json]
//
// Latency (measurements.jsonl, one row per final caption the TV showed):
//   speech start -> on TV : from the first recognised word of a sentence on the phone to the
//                           final sentence on the TV. Includes the time the person spent speaking.
//   server -> on TV       : from the server receiving the final sentence to the TV showing it
//                           (network + rendering on the TV).
// Accuracy (captured.jsonl, only when the server ran with CAPTURE_TEXT=1, plus a refs file):
//   refs.json = [{ "speaker": "Meena", "lang": "en-IN", "text": "..." }, ...] in the order read aloud.
//   Each speaker's captured finals are joined and compared with that speaker's joined reference
//   text, so sentence boundaries chosen by the recogniser do not matter.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wordErrorRate } from '../shared/src/logic';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'server/data';
const room = args.includes('--room') ? args[args.indexOf('--room') + 1] : null;
const refsFile = args.includes('--refs') ? args[args.indexOf('--refs') + 1] : null;

const readJsonl = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T).filter((r) => !room || (r as { room?: string }).room === room)
    : [];

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { n: s.length, p50: q(0.5), p90: q(0.9), p95: q(0.95), max: s[s.length - 1], mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length) };
}

interface Row { room: string; endToEndMs: number; tRecv: number | null; tRender: number }
const rows = readJsonl<Row>(join(dir, 'measurements.jsonl'));
console.log(`Latency${room ? ` (room ${room})` : ''}: ${rows.length} final captions`);
if (rows.length) {
  const e2e = stats(rows.map((r) => r.endToEndMs));
  const tail = stats(rows.filter((r) => r.tRecv !== null).map((r) => r.tRender - (r.tRecv as number)));
  console.table({ 'speech start -> on TV (ms)': e2e, 'server -> on TV (ms)': tail });
}

interface Cap { speakerId: string; name: string; lang: string; text: string; tStart: number }
interface Ref { speaker: string; lang: string; text: string }
const caps = readJsonl<Cap>(join(dir, 'captured.jsonl'));
if (refsFile) {
  const refs = JSON.parse(readFileSync(refsFile, 'utf8')) as Ref[];
  const speakers = [...new Set(refs.map((r) => r.speaker))];
  console.log(`\nAccuracy: ${caps.length} captured finals vs ${refs.length} reference sentences`);
  const out: Record<string, unknown> = {};
  for (const sp of speakers) {
    const ref = refs.filter((r) => r.speaker === sp).map((r) => r.text).join(' ');
    const hyp = caps.filter((c) => c.name === sp).sort((a, b) => a.tStart - b.tStart).map((c) => c.text).join(' ');
    const w = wordErrorRate(ref, hyp);
    out[`${sp} (${refs.find((r) => r.speaker === sp)!.lang})`] = { refWords: w.refWords, WER: `${(w.wer * 100).toFixed(1)}%`, sub: w.substitutions, del: w.deletions, ins: w.insertions };
  }
  console.table(out);
} else if (caps.length) {
  console.log(`\n${caps.length} captured finals; pass --refs refs.json to score accuracy.`);
}
