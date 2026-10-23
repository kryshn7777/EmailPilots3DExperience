import { bakeDetail, bakeShape } from './cloudNoiseGen';

// Baking the two volumes takes a few hundred ms of pure arithmetic, which is exactly what a
// worker is for: the page stays interactive while the cloud noise is made.
const scope = self as unknown as Worker;

scope.onmessage = () => {
  const shape = bakeShape();
  const detail = bakeDetail();
  scope.postMessage({ shape, detail }, [shape.buffer, detail.buffer]);
};
