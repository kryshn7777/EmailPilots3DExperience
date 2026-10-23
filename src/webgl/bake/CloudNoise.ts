import {
  Data3DTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three';
import { DETAIL_SIZE, SHAPE_SIZE, bakeDetail, bakeShape } from './cloudNoiseGen';

function volume(size: number): Data3DTexture {
  const t = new Data3DTexture(new Uint8Array(size * size * size * 4), size, size, size);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.generateMipmaps = true;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/**
 * The two 3D noise volumes every cloud shader reads (see bake/cloudNoiseGen.ts for what is in them).
 *
 * They exist from the first frame, empty, so programs compile against real samplers; a worker
 * fills them in a moment later and `ready` flips. Until then the clouds simply have no density,
 * which is invisible: the sky is not on screen while the flight is still in the room.
 */
export class CloudNoise {
  readonly shape = volume(SHAPE_SIZE);
  readonly detail = volume(DETAIL_SIZE);
  ready = false;

  constructor() {
    this.start();
  }

  private start(): void {
    try {
      const worker = new Worker(new URL('./cloudNoise.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ shape: Uint8Array; detail: Uint8Array }>) => {
        this.fill(e.data.shape, e.data.detail);
        worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        this.bakeHere();
      };
      worker.postMessage(0);
    } catch {
      this.bakeHere();
    }
  }

  /** no worker support: do the same work on the main thread, after the first frames have been drawn */
  private bakeHere(): void {
    setTimeout(() => this.fill(bakeShape(), bakeDetail()), 400);
  }

  private fill(shape: Uint8Array, detail: Uint8Array): void {
    (this.shape.image.data as Uint8Array).set(shape);
    (this.detail.image.data as Uint8Array).set(detail);
    this.shape.needsUpdate = true;
    this.detail.needsUpdate = true;
    this.ready = true;
  }

  dispose(): void {
    this.shape.dispose();
    this.detail.dispose();
  }
}
