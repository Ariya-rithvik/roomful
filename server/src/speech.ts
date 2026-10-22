// Server-side speech recognition (engine 'server'). The phone streams PCM16 16 kHz mono over
// /ws/phone-audio; this module turns it into partial/final text. Amazon Transcribe streaming
// is the real adapter. On our account it currently fails with SubscriptionRequiredException,
// so the server reports 'engine_unavailable' and phones fall back to on-device recognition.
import type { Lang } from '@roomcaption/shared';

export interface SpeechResult { text: string; final: boolean; /** ms of audio before this result's speech began, relative to the session start */ startOffsetMs: number; id: string }

export interface SpeechSession {
  write(pcm: Buffer): void;
  end(): void;
}

export interface SpeechEngine {
  readonly name: string;
  start(lang: Lang, onResult: (r: SpeechResult) => void, onError: (e: Error) => void): SpeechSession;
}

/** Amazon Transcribe streaming. ta-IN is not offered for streaming, so it is refused up front. */
export function transcribeEngine(region = process.env.TRANSCRIBE_REGION || 'ap-south-1'): SpeechEngine {
  return {
    name: 'amazon-transcribe',
    start(lang, onResult, onError) {
      const queue: Buffer[] = [];
      let wake: (() => void) | null = null;
      let ended = false;
      if (lang === 'ta-IN') {
        queueMicrotask(() => onError(new Error('Tamil is not supported by Transcribe streaming')));
        return { write() {}, end() {} };
      }
      async function* audio() {
        while (!ended || queue.length) {
          if (!queue.length) await new Promise<void>((r) => (wake = r));
          while (queue.length) yield { AudioEvent: { AudioChunk: queue.shift()! } };
        }
      }
      (async () => {
        const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = await import('@aws-sdk/client-transcribe-streaming');
        const client = new TranscribeStreamingClient({ region });
        const res = await client.send(
          new StartStreamTranscriptionCommand({
            LanguageCode: lang, MediaEncoding: 'pcm', MediaSampleRateHertz: 16000, AudioStream: audio(),
            EnablePartialResultsStabilization: true, PartialResultsStability: 'high',
          }),
        );
        for await (const ev of res.TranscriptResultStream ?? []) {
          for (const r of ev.TranscriptEvent?.Transcript?.Results ?? []) {
            onResult({
              id: r.ResultId ?? '', text: r.Alternatives?.[0]?.Transcript ?? '', final: !r.IsPartial,
              startOffsetMs: Math.round((r.StartTime ?? 0) * 1000),
            });
          }
        }
      })().catch((e: Error) => onError(e));
      return {
        write(pcm) {
          if (ended) return;
          queue.push(pcm);
          wake?.();
          wake = null;
        },
        end() {
          ended = true;
          wake?.();
          wake = null;
        },
      };
    },
  };
}
