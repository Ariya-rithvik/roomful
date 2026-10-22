// Copies the MediaPipe WASM runtime out of node_modules and downloads the two models once, so the
// phone page never calls a CDN at the table. Models come from Google's official MediaPipe model store.
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, '../public');
const require = createRequire(import.meta.url);

const wasmSrc = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
const wasmDst = join(pub, 'mediapipe/wasm');
mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });
console.log(`MediaPipe WASM runtime -> ${wasmDst}`);

const MODELS = [
  // Face landmarks + blendshapes (mouthSmileLeft/Right) for happy moments.
  ['face_landmarker.task', 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
  // COCO object detector for the Table Hunt scan.
  ['efficientdet_lite0.tflite', 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite'],
];
for (const [name, url] of MODELS) {
  const dst = join(pub, 'models', name);
  if (existsSync(dst) && statSync(dst).size > 1_000_000) {
    console.log(`${name} already present (${(statSync(dst).size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  console.log(`Downloading ${name} from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dst, buf);
  console.log(`${name} -> ${dst} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
