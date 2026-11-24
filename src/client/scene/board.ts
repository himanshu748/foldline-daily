import * as THREE from 'three';
import {
  calculateFrames,
  interpolateFrames,
  PANEL_SIZE,
  type Frame,
  type FoldAngle,
  type Turn,
} from '../../shared/engine';
import { foldIntent, foldPreview, type FoldIntent } from '../../shared/gesture';
import { CREAM, MAT, MAT_LINE, MAT_MAJOR, TAPE } from '../../shared/theme';
import { panelCorners, projectPoint, viewBasis, type ViewBasis } from '../../shared/view';
import { floorY, sceneBounds } from './scene-bounds';
import { matchingSlots } from './slot-state';

export interface BoardColors {
  paper: string;
  back: string;
  ink: string;
}

export interface BoardOptions {
  turns: Turn[];
  angles: FoldAngle[];
  start: FoldAngle[];
  goal: FoldAngle[];
  colors: BoardColors;
  reducedMotion: boolean;
  /** A committed fold (hinge index, new absolute angle). */
  onCommit: (index: number, angle: FoldAngle) => void;
}

const THICKNESS = 0.024;
const CAMERA_DISTANCE = 20;
const FIT_MARGIN = 1.15;
const GHOST_OPACITY = 0.1;

interface DragState {
  pointerId: number;
  index: number;
  startAngle: number;
  origin: { x: number; y: number };
  /** Screen-space axis (CSS px) in which the +90 stop moves. */
  axis: { x: number; y: number };
  /** CSS px per panel length, to convert drag travel into gesture units. */
  pxPerPanel: number;
  distance: number;
  armed: FoldIntent;
}

interface FitBox {
  cx: number;
  cy: number;
  halfX: number;
  halfY: number;
}

interface CameraFrame {
  cx: number;
  cy: number;
  halfH: number;
}

interface GhostSlot {
  mesh: THREE.Mesh;
  dashed: THREE.LineSegments;
  solid: THREE.LineSegments;
  locked: boolean;
  pulseStart: number;
}

/**
 * The 3D paper strip. Loaded lazily from the game shell; the splash screen and
 * the loading fallback use the 2D canvas renderer instead. Rendering is
 * on-demand: a frame is drawn only while a drag or an animation is running.
 */
export class BoardScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: BoardOptions;
  private readonly level: { turns: Turn[] };
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly raycaster = new THREE.Raycaster();
  private readonly panels: THREE.Mesh[] = [];
  private readonly ghosts: GhostSlot[] = [];
  private readonly goalFrames: Frame[];
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly ground: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly resizeObserver: ResizeObserver;
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onPointerMove: (event: PointerEvent) => void;
  private readonly onPointerUp: (event: PointerEvent) => void;

  private basis: ViewBasis;
  private flipped = false;
  private fitBox: FitBox;
  private cameraFrame: CameraFrame = { cx: 0, cy: 0, halfH: 1 };
  private cameraAnim: {
    from: CameraFrame;
    to: CameraFrame;
    fromFloor: number;
    toFloor: number;
    t0: number;
  } | null = null;
  private committed: number[];
  private shown: number[];
  private drag: DragState | null = null;
  private anim: { from: number[]; to: number[]; t0: number; dur: number } | null = null;
  private pulseStart = 0;
  private raf = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: BoardOptions) {
    this.canvas = canvas;
    this.options = options;
    this.level = { turns: [...options.turns] };
    this.committed = [...options.angles];
    this.shown = [...options.angles];
    this.basis = viewBasis();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const { paper, back, ink } = options.colors;
    const side = new THREE.MeshLambertMaterial({ color: ink });
    const top = new THREE.MeshLambertMaterial({ color: paper });
    const bottom = new THREE.MeshLambertMaterial({ color: back });
    const geometry = new THREE.BoxGeometry(PANEL_SIZE, THICKNESS, PANEL_SIZE);
    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: ink });
    for (let index = 0; index < options.turns.length; index++) {
      const mesh = new THREE.Mesh(geometry, [side, side, top, bottom, side, side]);
      mesh.userData.index = index;
      mesh.castShadow = true;
      mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
      this.panels.push(mesh);
      this.scene.add(mesh);
    }

    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: CREAM,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
    });
    const ghostEdgeMaterial = new THREE.LineDashedMaterial({
      color: CREAM,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: false,
      dashSize: 0.04,
      gapSize: 0.04,
    });
    const lockedEdgeMaterial = new THREE.LineBasicMaterial({
      color: TAPE,
      depthTest: false,
    });
    const ghostPlane = new THREE.PlaneGeometry(PANEL_SIZE, PANEL_SIZE);
    ghostPlane.rotateX(-Math.PI / 2);
    const ghostEdges = new THREE.EdgesGeometry(ghostPlane);
    ghostPlane.dispose();
    this.goalFrames = calculateFrames(this.level, options.goal).frames;
    for (const frame of this.goalFrames) {
      const ghost = new THREE.Mesh(geometry, this.ghostMaterial);
      const dashed = new THREE.LineSegments(ghostEdges, ghostEdgeMaterial);
      const solid = new THREE.LineSegments(ghostEdges, lockedEdgeMaterial);
      dashed.computeLineDistances();
      dashed.position.y = solid.position.y = THICKNESS / 2 + 0.002;
      dashed.renderOrder = 5;
      solid.renderOrder = 6;
      solid.visible = false;
      ghost.add(dashed, solid);
      ghost.position.set(...frame.center);
      ghost.quaternion.set(
        frame.quaternion[0],
        frame.quaternion[1],
        frame.quaternion[2],
        frame.quaternion[3]
      );
      this.ghosts.push({ mesh: ghost, dashed, solid, locked: false, pulseStart: 0 });
      this.scene.add(ghost);
    }

    const bounds = sceneBounds(this.level.turns, this.committed, this.goalFrames);
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 500;
    textureCanvas.height = 500;
    const ctx = textureCanvas.getContext('2d')!;
    ctx.fillStyle = MAT;
    ctx.fillRect(0, 0, 500, 500);
    ctx.strokeStyle = MAT_LINE;
    ctx.lineWidth = 1;
    for (let cell = 1; cell < 5; cell++) {
      const p = cell * 100;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 500);
      ctx.moveTo(0, p);
      ctx.lineTo(500, p);
      ctx.stroke();
    }
    ctx.strokeStyle = MAT_MAJOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 500, 500);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(100 / (PANEL_SIZE * 2.5), 100 / (PANEL_SIZE * 2.5));
    texture.anisotropy = 2;
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    this.ground = new THREE.Mesh(groundGeometry, new THREE.MeshBasicMaterial({ map: texture }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    this.shadow = new THREE.Mesh(groundGeometry, new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.receiveShadow = true;
    this.scene.add(this.shadow);
    this.setFloor(floorY(this.level.turns, this.committed));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8578, 1.05));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.updateShadowBounds(bounds);

    this.fitBox = this.computeFit();
    this.updateSlots(false);
    this.applyFrames(this.shown);
    this.resize();

    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerMove = (event) => this.pointerMove(event);
    this.onPointerUp = (event) => this.pointerUp(event);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
  }

  /** Move the strip to a new committed state, animating the fold unless reduced motion is on. */
  setAngles(angles: readonly FoldAngle[], animate: boolean): void {
    const from = [...this.shown];
    this.committed = [...angles];
    if (this.disposed) return;
    this.updateSlots(true);
    this.fitBox = this.computeFit();
    const target = this.frameForBox(this.fitBox);
    const bounds = sceneBounds(this.level.turns, this.committed, this.goalFrames);
    const floor = floorY(this.level.turns, this.committed);
    if (animate && !this.options.reducedMotion) {
      this.cameraAnim = {
        from: { ...this.cameraFrame },
        to: target,
        fromFloor: this.ground.position.y,
        toFloor: floor,
        t0: performance.now(),
      };
    } else {
      this.cameraAnim = null;
      this.cameraFrame = target;
      this.setFloor(floor);
      this.updateShadowBounds(bounds);
      this.applyCamera();
    }
    if (!animate || this.options.reducedMotion || this.drag) {
      this.anim = null;
      this.shown = [...angles];
      this.requestRender();
      return;
    }
    this.anim = { from, to: [...angles], t0: performance.now(), dur: 240 };
    this.requestRender();
  }

  /** Briefly brighten the target silhouette when the puzzle is solved. */
  solvePulse(): void {
    if (this.options.reducedMotion) return;
    this.pulseStart = performance.now();
    this.requestRender();
  }

  /** See the back of the paper (the `V` key and the flip button). */
  flip(): void {
    this.flipped = !this.flipped;
    this.basis = viewBasis(38 + (this.flipped ? 180 : 0), 30);
    this.fitBox = this.computeFit();
    this.resize();
  }

  get movableCount(): number {
    return this.options.turns.length - 1;
  }

  inPlaceCount(): number {
    return this.ghosts.filter((ghost) => ghost.locked).length;
  }

  /** CSS-pixel position of a panel's centre, for overlays such as the ghost hand. */
  panelScreenPosition(index: number): { x: number; y: number } | null {
    const frame = calculateFrames(this.level, this.committed).frames[index];
    if (!frame) return null;
    return this.toScreen(frame.center);
  }

  hingeScreenPositions(): Array<{ index: number; x: number; y: number }> {
    return calculateFrames(this.level, this.committed).frames.slice(1).map((frame) => ({
      index: frame.index,
      ...this.toScreen(frame.start),
    }));
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
      material.dispose();
    }
    this.renderer.dispose();
  }

  private setFloor(y: number): void {
    this.ground.position.y = y;
    this.shadow.position.y = y + 0.001;
  }

  private updateShadowBounds(bounds: THREE.Box3): void {
    const shadowBounds = bounds.clone();
    shadowBounds.min.y = Math.min(shadowBounds.min.y, this.ground.position.y);
    const center = shadowBounds.getCenter(new THREE.Vector3());
    const radius = Math.max(2, shadowBounds.getSize(new THREE.Vector3()).length() / 2 + 0.5);
    this.sun.position.copy(center).add(new THREE.Vector3(1, 8, 1).normalize().multiplyScalar(radius * 2 + 4));
    this.sun.target.position.copy(center);
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -radius;
    camera.right = camera.top = radius;
    camera.near = 0.1;
    camera.far = radius * 4 + 12;
    camera.updateProjectionMatrix();
  }

  private computeFit(): FitBox {
    const frames = [calculateFrames(this.level, this.committed).frames, this.goalFrames];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pose of frames) {
      for (const frame of pose) {
        for (const corner of panelCorners(frame)) {
          const point = projectPoint(corner, this.basis);
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      halfX: Math.max(0.001, (maxX - minX) / 2),
      halfY: Math.max(0.001, (maxY - minY) / 2),
    };
  }

  private resize(): void {
    if (this.disposed) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.cameraAnim = null;
    const bounds = sceneBounds(this.level.turns, this.committed, this.goalFrames);
    this.setFloor(floorY(this.level.turns, this.committed));
    this.updateShadowBounds(bounds);
    this.cameraFrame = this.frameForBox(this.fitBox);
    this.applyCamera();
    this.requestRender();
  }

  private frameForBox(box: FitBox): CameraFrame {
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = this.canvas.clientWidth / height;
    const halfH = Math.max(box.halfY, box.halfX / Math.max(0.001, aspect)) * FIT_MARGIN;
    const pixelsPerUnit = height / (2 * halfH);
    const top = height / 2 - box.halfY * pixelsPerUnit;
    const bottom = height / 2 + box.halfY * pixelsPerUnit;
    const shift = Math.max(0, Math.min(85 - top, height - 16 - bottom));
    return {
      cx: box.cx,
      cy: box.cy + shift / pixelsPerUnit,
      halfH,
    };
  }

  private applyCamera(): void {
    const { cx, cy, halfH } = this.cameraFrame;
    const halfW = halfH * (this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;

    const { right, up, toCamera } = this.basis;
    const center = new THREE.Vector3(
      right[0] * cx + up[0] * cy,
      right[1] * cx + up[1] * cy,
      right[2] * cx + up[2] * cy
    );
    this.camera.position
      .set(...toCamera)
      .multiplyScalar(CAMERA_DISTANCE)
      .add(center);
    this.camera.up.set(up[0], up[1], up[2]);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    window.dispatchEvent(new Event('foldline:viewchange'));
  }

  private updateSlots(animate: boolean): void {
    const matching = matchingSlots(this.level.turns, this.committed, this.goalFrames);
    for (let index = 0; index < this.ghosts.length; index++) {
      const slot = this.ghosts[index]!;
      const locked = matching[index] ?? false;
      if (locked && !slot.locked && animate && !this.options.reducedMotion)
        slot.pulseStart = performance.now();
      if (!locked) slot.pulseStart = 0;
      slot.locked = locked;
      slot.dashed.visible = !locked;
      slot.solid.visible = locked;
    }
  }

  private applyFrames(angles: readonly number[]): void {
    const { frames } = interpolateFrames(this.level, angles, true);
    for (const frame of frames) {
      const mesh = this.panels[frame.index];
      if (!mesh) continue;
      mesh.position.set(frame.center[0], frame.center[1], frame.center[2]);
      mesh.quaternion.set(
        frame.quaternion[0],
        frame.quaternion[1],
        frame.quaternion[2],
        frame.quaternion[3]
      );
    }
  }

  private requestRender(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame((time) => this.tick(time));
  }

  private tick(time: number): void {
    this.raf = 0;
    if (this.disposed) return;
    if (this.anim) {
      const k = Math.max(0, Math.min(1, (time - this.anim.t0) / this.anim.dur));
      const eased = 1 + 2.3 * (k - 1) ** 3 + 1.3 * (k - 1) ** 2;
      this.shown = this.anim.from.map((from, index) =>
        from + ((this.anim?.to[index] ?? from) - from) * eased
      );
      if (k >= 1) this.anim = null;
    }
    if (this.cameraAnim) {
      const k = Math.max(0, Math.min(1, (time - this.cameraAnim.t0) / 280));
      const eased = 1 - (1 - k) ** 3;
      const { from, to } = this.cameraAnim;
      this.cameraFrame = {
        cx: from.cx + (to.cx - from.cx) * eased,
        cy: from.cy + (to.cy - from.cy) * eased,
        halfH: from.halfH + (to.halfH - from.halfH) * eased,
      };
      this.setFloor(this.cameraAnim.fromFloor + (this.cameraAnim.toFloor - this.cameraAnim.fromFloor) * eased);
      this.updateShadowBounds(sceneBounds(this.level.turns, this.committed, this.goalFrames, this.shown));
      this.applyCamera();
      if (k >= 1) this.cameraAnim = null;
    }
    let pulsing = false;
    for (const slot of this.ghosts) {
      if (!slot.pulseStart) continue;
      const k = Math.max(0, (time - slot.pulseStart) / 160);
      if (k >= 1) {
        slot.pulseStart = 0;
        slot.mesh.scale.setScalar(1);
      } else {
        slot.mesh.scale.setScalar(1 + 0.04 * Math.sin(Math.PI * k));
        pulsing = true;
      }
    }
    if (this.pulseStart) {
      const k = (time - this.pulseStart) / 700;
      if (k >= 1) {
        this.pulseStart = 0;
        this.ghostMaterial.opacity = GHOST_OPACITY;
      } else {
        this.ghostMaterial.opacity = GHOST_OPACITY + 0.28 * Math.sin(Math.PI * k);
      }
    }
    this.applyFrames(this.shown);
    this.renderer.render(this.scene, this.camera);
    if (this.anim || this.cameraAnim || pulsing || this.pulseStart || this.drag) this.requestRender();
  }

  /** Screen-space (CSS px) position of a world point under the current camera. */
  private toScreen(point: readonly [number, number, number]): { x: number; y: number } {
    const projected = new THREE.Vector3(point[0], point[1], point[2]).project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * this.canvas.clientWidth,
      y: ((1 - projected.y) / 2) * this.canvas.clientHeight,
    };
  }

  private pointerDown(event: PointerEvent): void {
    if (this.drag || this.anim) return;
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.panels, false)[0];
    const index = hit?.object.userData.index as number | undefined;
    if (index === undefined || index < 1 || index >= this.committed.length) return;

    // The fold direction is whichever stop's on-screen motion matches the drag.
    const startAngle = this.committed[index]!;
    const level = this.level;
    const centreAt = (angle: number): { x: number; y: number } | null => {
      if (angle < -90 || angle > 90) return null;
      const angles = [...this.committed];
      angles[index] = angle;
      const frame = calculateFrames(level, angles).frames[index];
      return frame ? this.toScreen(frame.center) : null;
    };
    const origin = centreAt(startAngle);
    const plus = centreAt(startAngle + 90);
    const minus = centreAt(startAngle - 90);
    if (!origin || (!plus && !minus)) return;
    let axis: { x: number; y: number };
    if (plus) axis = { x: plus.x - origin.x, y: plus.y - origin.y };
    else axis = { x: origin.x - minus!.x, y: origin.y - minus!.y };
    const axisLength = Math.hypot(axis.x, axis.y);
    if (axisLength < 1) return;
    axis = { x: axis.x / axisLength, y: axis.y / axisLength };

    const halfH = this.camera.top;
    const pxPerUnit = this.canvas.clientHeight / (2 * halfH);
    this.drag = {
      pointerId: event.pointerId,
      index,
      startAngle,
      origin: { x: event.clientX, y: event.clientY },
      axis,
      pxPerPanel: pxPerUnit * PANEL_SIZE,
      distance: 0,
      armed: 0,
    };
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.origin.x;
    const dy = event.clientY - drag.origin.y;
    drag.distance = (dx * drag.axis.x + dy * drag.axis.y) / drag.pxPerPanel;
    drag.armed = foldIntent(drag.startAngle, drag.distance, drag.armed);
    const preview = foldPreview(drag.startAngle, drag.distance);
    this.shown = [...this.committed];
    this.shown[drag.index] = preview;
    this.requestRender();
  }

  private pointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    const intent = foldIntent(drag.startAngle, drag.distance, drag.armed);
    if (intent !== 0) {
      const angle = (drag.startAngle + intent * 90) as FoldAngle;
      this.committed[drag.index] = angle;
      this.options.onCommit(drag.index, angle);
    }
    this.shown = [...this.committed];
    this.requestRender();
  }
}
