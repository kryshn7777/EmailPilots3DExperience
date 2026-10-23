import type { Object3D } from 'three';

/**
 * Render layers with a meaning beyond "drawn by the main camera" (layer 0). An object is put on
 * one with `layers.enable`, so it stays visible to the main camera as well.
 *
 * - LAMP_CASTER: what the streetlights' shadow-casting spots draw into their shadow maps: the
 *   small, moving things (cars, people, street furniture, lamp posts). Buildings and trees are left
 *   out on purpose: they are huge instanced meshes, and each spot's shadow pass would draw every
 *   one of them (the sun's shadow already has them).
 * - NO_PROBE: left out of the live reflection probe (the paper plane and its trails hang right in
 *   front of the probe and would fill every reflection).
 */
export const LAMP_CASTER_LAYER = 3;
export const NO_PROBE_LAYER = 4;

/** Marks an object (and everything under it) as a caster of lamp shadows. */
export function castsLampShadows(root: Object3D): void {
  root.traverse((o) => o.layers.enable(LAMP_CASTER_LAYER));
}
