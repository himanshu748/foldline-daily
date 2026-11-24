import * as THREE from 'three';
import { calculateFrames, interpolateFrames, type Frame, type Turn } from '../../shared/engine';
import { panelCorners } from '../../shared/view';

export function sceneBounds(
  turns: Turn[],
  committed: readonly number[],
  goal: readonly Frame[],
  shown?: readonly number[]
): THREE.Box3 {
  const poses = [calculateFrames({ turns }, committed).frames, goal];
  if (shown) poses.push(interpolateFrames({ turns }, shown, true).frames);
  const bounds = new THREE.Box3();
  for (const frames of poses) {
    for (const frame of frames) {
      for (const corner of panelCorners(frame)) bounds.expandByPoint(new THREE.Vector3(...corner));
    }
  }
  return bounds;
}

export function floorY(turns: Turn[], committed: readonly number[]): number {
  let min = Infinity;
  for (const frame of calculateFrames({ turns }, committed).frames) {
    for (const corner of panelCorners(frame)) min = Math.min(min, corner[1]);
  }
  return min - 0.012;
}
