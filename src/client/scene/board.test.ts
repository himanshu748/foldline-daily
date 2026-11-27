import { expect, it, vi } from 'vitest';
import { BoardScene } from './board';

function armedDrag() {
  const onCommit = vi.fn();
  const scene = Object.assign(Object.create(BoardScene.prototype), {
    drag: { pointerId: 1, index: 1, startAngle: 0, distance: 0.6, armed: 1 },
    committed: [0, 0],
    shown: [0, 60],
    options: { onCommit },
    requestRender: vi.fn(),
  });
  return { scene, onCommit };
}

it.each(['pointercancel', 'lostpointercapture'])('discards an armed preview on %s', (type) => {
  const { scene, onCommit } = armedDrag();

  scene.pointerEnd({ type, pointerId: 2 });
  expect(scene.drag).not.toBeNull();

  scene.pointerEnd({ type, pointerId: 1 });
  expect(scene.drag).toBeNull();
  expect(scene.shown).toEqual([0, 0]);
  expect(onCommit).not.toHaveBeenCalled();
  expect(scene.requestRender).toHaveBeenCalledOnce();
});

it('commits one fold when the active pointer is released', () => {
  const { scene, onCommit } = armedDrag();

  scene.pointerEnd({ type: 'pointerup', pointerId: 1 });
  scene.pointerEnd({ type: 'lostpointercapture', pointerId: 1 });

  expect(scene.drag).toBeNull();
  expect(scene.shown).toEqual([0, 90]);
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(1, 90);
});
