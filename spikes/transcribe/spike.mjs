// Day-0 spike: Polly -> 16 kHz PCM -> Transcribe streaming, per language.
// Measures: does the language stream at all in this region, what text comes back,
// time from first audio byte sent to first partial and to the final result.
// Audio is paced in real time (100 ms chunks) like a phone would send it.
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';

const region = process.env.AWS_REGION || 'ap-south-1';
const polly = new PollyClient({ region: 'us-east-1' }); // generative voices are not offered in ap-south-1
const transcribe = new TranscribeStreamingClient({ region });

import { readFileSync } from 'node:fs';
const CASES = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

async function pcm(text, voice, lang) {
  const out = await polly.send(new SynthesizeSpeechCommand({
    Text: text, VoiceId: voice, LanguageCode: lang, Engine: 'generative', OutputFormat: 'pcm', SampleRate: '16000',
  }));
  return Buffer.from(await out.AudioStream.transformToByteArray());
}

async function run({ lang, voice, text }) {
  const audio = await pcm(text, voice, lang);
  const silence = Buffer.alloc(16000 * 2 * 1.5); // 1.5 s trailing silence so the final arrives
  const all = Buffer.concat([audio, silence]);
  const CHUNK = 3200; // 100 ms of 16 kHz 16-bit mono
  let t0 = 0;
  async function* stream() {
    t0 = performance.now();
    for (let i = 0; i < all.length; i += CHUNK) {
      yield { AudioEvent: { AudioChunk: all.subarray(i, i + CHUNK) } };
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const res = await transcribe.send(new StartStreamTranscriptionCommand({
    LanguageCode: lang, MediaEncoding: 'pcm', MediaSampleRateHertz: 16000, AudioStream: stream(),
    EnablePartialResultsStabilization: true, PartialResultsStability: 'high',
  }));
  const speechMs = (audio.length / 32000) * 1000;
  let firstPartial = null, final = null, finalText = '';
  for await (const ev of res.TranscriptResultStream) {
    for (const r of ev.TranscriptEvent?.Transcript?.Results ?? []) {
      const now = performance.now() - t0;
      if (r.IsPartial && firstPartial === null) firstPartial = now;
      if (!r.IsPartial) { final = now; finalText += (finalText ? ' ' : '') + (r.Alternatives?.[0]?.Transcript ?? ''); }
    }
  }
  return { lang, speechMs: Math.round(speechMs), firstPartialMs: firstPartial && Math.round(firstPartial),
    finalMs: final && Math.round(final), finalLagAfterSpeechMs: final && Math.round(final - speechMs), reference: text, heard: finalText };
}

for (const c of CASES) {
  try { console.log(JSON.stringify(await run(c), null, 1)); }
  catch (e) { console.log(JSON.stringify({ lang: c.lang, error: e.name, message: e.message })); }
}

