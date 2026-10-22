// On-phone vision with MediaPipe: smiles (face blendshapes) for happy moments, and the COCO
// object detector for the Table Hunt scan. Models and runtime are served by the family server;
// no frame ever leaves the phone for either task.
import { FaceLandmarker, FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { OBJECT_LABELS, isObjectLabel, type ObjectLabel } from '@roomcaption/shared';

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
const fileset = () => (filesetPromise ??= FilesetResolver.forVisionTasks('/mediapipe/wasm'));

/** GPU is faster on most phones but missing on some; fall back to CPU. */
async function withDelegate<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

let face: Promise<FaceLandmarker> | null = null;
export function loadFace(): Promise<FaceLandmarker> {
  return (face ??= fileset().then((fs) =>
    withDelegate((delegate) =>
      FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numFaces: 4,
        outputFaceBlendshapes: true,
      }),
    ),
  ));
}

/** Highest smile score (0..1) among visible faces, or null when no face is seen. */
export function smileScore(lm: FaceLandmarker, video: HTMLVideoElement, tMs: number): number | null {
  const r = lm.detectForVideo(video, tMs);
  if (!r.faceBlendshapes?.length) return null;
  let best = 0;
  for (const f of r.faceBlendshapes) {
    const get = (name: string) => f.categories.find((c) => c.categoryName === name)?.score ?? 0;
    best = Math.max(best, (get('mouthSmileLeft') + get('mouthSmileRight')) / 2);
  }
  return best;
}

let objects: Promise<ObjectDetector> | null = null;
export function loadObjects(): Promise<ObjectDetector> {
  return (objects ??= fileset().then((fs) =>
    withDelegate((delegate) =>
      ObjectDetector.createFromOptions(fs, {
        baseOptions: { modelAssetPath: '/models/efficientdet_lite0.tflite', delegate },
        runningMode: 'IMAGE',
        scoreThreshold: 0.2,
        maxResults: 5,
        categoryAllowlist: [...OBJECT_LABELS],
      }),
    ),
  ));
}

export interface Box { x: number; y: number; w: number; h: number }
export interface Guess { label: ObjectLabel; score: number; box: Box | null }

/** Detections on a frame, best first, only labels from the safe list, one per label (its best box). */
export function detectObjects(det: ObjectDetector, frame: HTMLCanvasElement | HTMLVideoElement): Guess[] {
  const r = det.detect(frame);
  const best = new Map<ObjectLabel, Guess>();
  for (const d of r.detections) {
    const c = d.categories[0];
    if (!c || !isObjectLabel(c.categoryName)) continue;
    const prev = best.get(c.categoryName);
    if (prev && prev.score >= c.score) continue;
    const b = d.boundingBox;
    best.set(c.categoryName, { label: c.categoryName, score: c.score, box: b ? { x: b.originX, y: b.originY, w: b.width, h: b.height } : null });
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** Copy the current video frame so detection and the photo use the same instant. */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 640;
  c.height = video.videoHeight || 480;
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/**
 * JPEG of just the object: its detection box with 12% margin, or the centre of the frame when
 * nothing was detected. At most 640 px on the long side.
 */
export function cropObject(frame: HTMLCanvasElement, box: Box | null): Promise<Blob> {
  const W = frame.width;
  const H = frame.height;
  let { x, y, w, h } = box ?? { x: W * 0.15, y: H * 0.15, w: W * 0.7, h: H * 0.7 };
  const mx = w * 0.12;
  const my = h * 0.12;
  x = Math.max(0, x - mx);
  y = Math.max(0, y - my);
  w = Math.min(W - x, w + 2 * mx);
  h = Math.min(H - y, h + 2 * my);
  const scale = Math.min(1, 640 / Math.max(w, h));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  out.getContext('2d')!.drawImage(frame, x, y, w, h, 0, 0, out.width, out.height);
  return new Promise((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error('could not make the photo'))), 'image/jpeg', 0.82));
}

export async function openCamera(facing: 'user' | 'environment'): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } } });
}

export function stopStream(s: MediaStream | null): void {
  s?.getTracks().forEach((t) => t.stop());
}
