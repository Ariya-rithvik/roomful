// Text to speech for the reply board, with a disk cache keyed by voice + language + text.
// Polly's generative voices are offered in us-east-1 (not ap-south-1), so the client is
// pinned there. Tamil has no Polly voice: synth() rejects and the reply is shown as text only.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lang } from '@roomcaption/shared';

export interface TtsEngine {
  /** MP3 bytes for the text, or a rejected promise with a short reason. */
  synth(text: string, lang: Lang): Promise<Buffer>;
}

const VOICES: Partial<Record<Lang, { voice: string; engine: 'generative' | 'neural' }>> = {
  'en-IN': { voice: 'Kajal', engine: 'generative' },
  'hi-IN': { voice: 'Kajal', engine: 'generative' },
};

export function pollyTts(region = process.env.POLLY_REGION || 'us-east-1'): TtsEngine {
  let client: import('@aws-sdk/client-polly').PollyClient | null = null;
  return {
    async synth(text, lang) {
      const v = VOICES[lang];
      if (!v) throw new Error(`no voice for ${lang}`);
      const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
      type Input = import('@aws-sdk/client-polly').SynthesizeSpeechCommandInput;
      client ??= new PollyClient({ region });
      const out = await client.send(
        new SynthesizeSpeechCommand({
          Text: text, VoiceId: v.voice as Input['VoiceId'], LanguageCode: lang as Input['LanguageCode'], Engine: v.engine, OutputFormat: 'mp3',
        }),
      );
      if (!out.AudioStream) throw new Error('empty audio');
      return Buffer.from(await out.AudioStream.transformToByteArray());
    },
  };
}

/** Wraps an engine with a content-addressed cache; returns the file's hash (served at /audio/<hash>.mp3). */
export class TtsCache {
  constructor(private readonly engine: TtsEngine, private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  static key(text: string, lang: Lang): string {
    return createHash('sha256').update(`v1|${lang}|${text}`).digest('hex');
  }
  async get(text: string, lang: Lang): Promise<string> {
    const hash = TtsCache.key(text, lang);
    const file = join(this.dir, `${hash}.mp3`);
    if (!existsSync(file)) writeFileSync(file, await this.engine.synth(text, lang));
    return hash;
  }
  read(hash: string): Buffer | null {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const file = join(this.dir, `${hash}.mp3`);
    return existsSync(file) ? readFileSync(file) : null;
  }
}
