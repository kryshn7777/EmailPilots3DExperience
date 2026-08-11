import type { Object3D } from 'three';

/**
 * Late-arrival shader warming. Actors that stream content in after boot
 * (city GLB, desk props) hand the new subtree here so the engine can compile
 * its programs off the critical path — otherwise the first scroll frame that
 * shows them stalls on a synchronous program link.
 */

type Compiler = (subtree: Object3D) => void;

let compiler: Compiler | null = null;

export function setCompiler(fn: Compiler): void {
  compiler = fn;
}

export function requestCompile(subtree: Object3D): void {
  compiler?.(subtree);
}
