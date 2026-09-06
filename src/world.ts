import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { EQUIPMENT } from './simulation';
import type { Equipment, SimState } from './simulation';

type CameraMode = 'third' | 'first' | 'overview';
type Material = THREE.MeshStandardMaterial;
type EquipmentView = {
  definition: Equipment;
  root: THREE.Group;
  visual: THREE.Group;
  ring: THREE.LineSegments;
  thermal: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  signal: Material;
  label: THREE.Sprite;
  fans: THREE.Group[];
  obstruction?: THREE.Group;
};

const COLORS = { cyan: 0x76eadb, amber: 0xffbf60, red: 0xff715c, navy: 0x182d39 };
const EQUIPMENT_HEIGHT = { rack: 3.2, cooling: 2.8, power: 2.8, vent: 0.12 };
const UP = new THREE.Vector3(0, 1, 0);

/** Shared box geometry and instanced details keep the authored server kit inexpensive. */
class BoxBatch {
  private entries = new Map<THREE.Material, THREE.Matrix4[]>();
  constructor(private geometry: THREE.BoxGeometry) {}

  add(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): void {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(w, h, d),
    );
    const entries = this.entries.get(material) ?? [];
    entries.push(matrix);
    this.entries.set(material, entries);
  }

  flush(group: THREE.Group, shadows = true): void {
    for (const [material, matrices] of this.entries) {
      const mesh = new THREE.InstancedMesh(this.geometry, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    this.entries.clear();
  }
}

function material(color: number, metalness = 0.1, roughness = 0.7): Material {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function labelTexture(text: string, subtext = '', color = '#d6e5e9', background = '#182d39'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = subtext ? 160 : 100;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#76eadb';
  ctx.fillRect(0, 0, 7, canvas.height);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = '600 48px system-ui, sans-serif';
  ctx.fillText(text, 30, subtext ? 58 : 51);
  if (subtext) {
    ctx.fillStyle = '#91acb7';
    ctx.font = '400 24px system-ui, sans-serif';
    ctx.fillText(subtext, 32, 117);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function editableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'));
}

/**
 * Spatial contract: right-handed, meters, +Y up, initial player forward -Z.
 * Player x/z/yaw are canonical; collision commits them before mesh/camera presentation.
 * All incident visuals are illustrative projections of SimState, not physical CFD.
 */
export class FacilityWorld {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.08, 150);
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly kit = {
    shell: material(0x1c2c36, 0.45, 0.52), panel: material(0x314450, 0.35, 0.57),
    tray: material(0x101d26, 0.3, 0.56), trim: material(0x647984, 0.6, 0.44),
    white: material(0xd7e2e5, 0.15, 0.75), floor: material(0x899b9f, 0.1, 0.9),
    dark: material(0x0a1720, 0.03, 0.9), amber: material(COLORS.amber, 0.1, 0.65),
    cyan: new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 0.6, roughness: 0.45 }),
    light: new THREE.MeshBasicMaterial({ color: 0xd5f5f1 }),
  };
  private readonly shell = new THREE.Group();
  private readonly views = new Map<string, EquipmentView>();
  private readonly proxies: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly collisionRay = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly avatar = new THREE.Group();
  private readonly avatarVisual = new THREE.Group();
  private readonly jacket = material(0xf29651, 0.03, 0.9);
  private readonly limbs: THREE.Group[] = [];
  private readonly keyLight: THREE.DirectionalLight;
  private readonly emergencyLight: THREE.PointLight;
  private readonly resizeObserver: ResizeObserver;
  private readonly keys = new Set<string>();
  private readonly cleanups: (() => void)[] = [];
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly touch = { x: 0, y: 0 };
  private player = { x: -3, z: 9, yaw: 0 };
  private active = false;
  private cameraMode: CameraMode = 'overview';
  private pitch = 0.22;
  private time = 0;
  private walking = 0;
  private cameraInitialized = false;
  private pointerDown: { id: number; x: number; y: number; lastX: number; lastY: number; dragged: boolean } | null = null;
  private environment: THREE.Group | null = null;
  private environmentCollider: THREE.Object3D | null = null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onSelect: (id: string) => void) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x10202b);
    this.scene.fog = new THREE.Fog(0x10202b, 55, 115);
    this.scene.add(new THREE.HemisphereLight(0xdaeeff, 0x384b4b, 2.45));
    this.keyLight = new THREE.DirectionalLight(0xe2f5ff, 3.3);
    this.keyLight.position.set(-10, 24, 9);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1536, 1536);
    Object.assign(this.keyLight.shadow.camera, { left: -21, right: 21, top: 22, bottom: -22, near: 1, far: 70 });
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.045;
    this.scene.add(this.keyLight);
    const rim = new THREE.DirectionalLight(0x8de3de, 1.9);
    rim.position.set(14, 11, -15);
    this.scene.add(rim);
    this.emergencyLight = new THREE.PointLight(COLORS.red, 0, 20, 2);
    this.emergencyLight.position.set(-3, 4, -3);
    this.scene.add(this.emergencyLight);
    this.scene.add(this.shell);
    this.buildRoom();
    for (const equipment of EQUIPMENT) this.buildEquipment(equipment);
    this.buildAvatar();
    this.avatar.add(this.avatarVisual);
    this.scene.add(this.avatar);
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.reset();
  }

  private buildRoom(): void {
    const b = new BoxBatch(this.cube);
    b.add(this.kit.dark, 0, -0.42, 0, 28.8, 0.7, 32.8);
    b.add(this.kit.floor, 0, -0.03, 0, 28, 0.12, 32);
    b.add(this.kit.white, 0, 2.1, -16, 28.4, 4.2, 0.32);
    b.add(this.kit.panel, 0, 0.23, 16, 28.4, 0.46, 0.32);
    for (const x of [-14, 14]) {
      b.add(this.kit.panel, x, 0.36, 0, 0.3, 0.72, 32);
      b.add(this.kit.trim, x, 0.77, 0, 0.32, 0.1, 32);
      b.add(this.kit.shell, x, 2.6, -15.8, 0.55, 5.2, 0.55);
      b.add(this.kit.shell, x, 2.1, -5, 0.42, 4.2, 0.42);
    }
    for (const x of [-8, -3, 3, 8]) {
      b.add(this.kit.shell, x, 4.15, -3, 1.2, 0.1, 20);
      b.add(this.kit.trim, x - 0.55, 4.3, -3, 0.06, 0.25, 20);
      b.add(this.kit.trim, x + 0.55, 4.3, -3, 0.06, 0.25, 20);
      for (let z = -12; z <= 6; z += 1.5) b.add(this.kit.trim, x, 4.24, z, 1.16, 0.08, 0.055);
      for (let strand = 0; strand < 3; strand++) b.add(strand === 1 ? this.kit.cyan : this.kit.amber, x - 0.28 + strand * 0.28, 4.26, -3, 0.06, 0.06, 19.5);
      b.add(this.kit.light, x, 3.99, -3, 0.14, 0.035, 19.2);
    }
    for (const z of [-11, -5.5, -0.5, 4.8, 11.3]) {
      b.add(this.kit.amber, 0, 0.042, z, 25.8, 0.015, 0.07);
    }
    for (const x of [-12.6, 12.6]) b.add(this.kit.amber, x, 0.042, -0.8, 0.07, 0.015, 27.2);
    // Front staging area: entrance threshold, low storage, wall-scale visual anchors.
    b.add(this.kit.dark, -3, 0.048, 12.5, 4.6, 0.02, 2.2);
    b.add(this.kit.cyan, -3, 0.065, 13.58, 4.6, 0.018, 0.07);
    for (let i = 0; i < 4; i++) {
      b.add(this.kit.panel, 7.6 + i * 1.1, 0.7, 13.5, 1, 1.4, 1.4);
      b.add(this.kit.white, 7.6 + i * 1.1, 1.42, 13.5, 1, 0.05, 1.4);
      b.add(this.kit.trim, 7.6 + i * 1.1, 0.83, 12.785, 0.15, 0.25, 0.04);
    }
    // A narrow equipment pipe loop follows the back wall rather than filling aisles.
    for (const y of [0.8, 1.15]) b.add(this.kit.trim, 0, y, -15.7, 25.7, 0.09, 0.09);
    b.flush(this.shell);
    const grid = new THREE.GridHelper(28, 28, 0x5c767c, 0x748b91);
    grid.position.y = 0.04;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.33;
    grid.scale.z = 32 / 28;
    this.shell.add(grid);
    this.wallLabel('EDGE FACILITY / 07', 'DATA CENTER SIM   ·   NIGHT SHIFT', 0, 2.7, -15.81, 7.2);
    this.floorLabel('OPERATIONS', -3, 12.5, 3.7);
    this.floorLabel('COOLING', -10.8, -10.8, 2.8);
    this.floorLabel('POWER', 10.8, -10.8, 2.5);
    for (const [i, x] of [-8, -3, 3, 8].entries()) this.floorLabel(`ZONE ${'ABCD'[i]}`, x, 5.7, 2.5);
    for (const z of [8, 5.1, -0.7, -6.2]) {
      const triangle = new THREE.Shape();
      triangle.moveTo(-0.18, -0.2); triangle.lineTo(0.18, -0.2); triangle.lineTo(0, 0.25); triangle.closePath();
      const arrow = new THREE.Mesh(new THREE.ShapeGeometry(triangle), this.kit.cyan);
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(0, 0.06, z);
      this.shell.add(arrow);
    }
  }

  private wallLabel(text: string, subtext: string, x: number, y: number, z: number, width: number): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: labelTexture(text, subtext), side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    this.shell.add(mesh);
  }

  private floorLabel(text: string, x: number, z: number, width: number): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 6.4), new THREE.MeshBasicMaterial({ map: labelTexture(text, '', '#d8e8e9', '#526c73'), transparent: true, opacity: 0.9 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.065, z);
    this.shell.add(mesh);
  }

  private buildEquipment(definition: Equipment): void {
    const { kind, width: w, depth: d } = definition;
    const h = EQUIPMENT_HEIGHT[kind];
    const root = new THREE.Group();
    root.name = definition.id;
    root.position.set(definition.x, 0, definition.z);
    const visual = new THREE.Group();
    root.add(visual);
    const signal = new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 0.8, roughness: 0.45 });
    const b = new BoxBatch(this.cube);
    const fans: THREE.Group[] = [];
    let obstruction: THREE.Group | undefined;
    if (kind === 'rack') {
      b.add(this.kit.dark, 0, 0.08, 0, w + 0.18, 0.16, d + 0.15);
      b.add(this.kit.shell, 0, h / 2, 0, w, h, d);
      b.add(this.kit.dark, 0, h / 2, d / 2 + 0.014, w - 0.12, h - 0.3, 0.08);
      b.add(this.kit.panel, 0, h - 0.1, 0, w + 0.08, 0.13, d + 0.08);
      b.add(this.kit.trim, -w / 2 + 0.06, h / 2, d / 2 + 0.07, 0.06, h - 0.28, 0.055);
      b.add(this.kit.trim, w / 2 - 0.06, h / 2, d / 2 + 0.07, 0.06, h - 0.28, 0.055);
      for (let row = 0; row < 12; row++) {
        const y = 0.3 + row * 0.225;
        b.add(row % 4 === 0 ? this.kit.panel : this.kit.tray, 0, y, d / 2 + 0.085, w - 0.26, 0.18, 0.06);
        b.add(this.kit.trim, -0.53, y, d / 2 + 0.13, 0.04, 0.09, 0.025);
        for (let vent = 0; vent < 6; vent++) b.add(this.kit.dark, -0.38 + vent * 0.105, y, d / 2 + 0.125, 0.048, 0.115, 0.025);
        for (let led = 0; led < 3; led++) b.add(signal, 0.36 + led * 0.085, y + 0.01, d / 2 + 0.135, 0.038, 0.042, 0.02);
      }
      for (let rib = 0; rib < 7; rib++) b.add(this.kit.panel, -w / 2 - 0.015, 1.65, -0.8 + rib * 0.25, 0.026, 2.48, 0.065);
      b.add(this.kit.cyan, -w / 2 - 0.03, h - 0.27, 0, 0.03, 0.065, d - 0.2);
    } else if (kind === 'cooling') {
      b.add(this.kit.panel, 0, h / 2, 0, w, h, d);
      b.add(this.kit.white, 0, h / 2 + 0.1, d / 2 + 0.04, w - 0.17, h - 0.2, 0.12);
      b.add(this.kit.shell, 0, 0.12, 0, w + 0.2, 0.24, d + 0.2);
      for (const fx of [-0.71, 0.71]) {
        const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.11, 32), this.kit.dark);
        housing.rotation.x = Math.PI / 2;
        housing.position.set(fx, 1.53, d / 2 + 0.15);
        visual.add(housing);
        const fan = new THREE.Group();
        fan.position.set(fx, 1.53, d / 2 + 0.22);
        const blades = new BoxBatch(this.cube);
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Mesh(this.cube, this.kit.trim);
          blade.scale.set(0.17, 0.43, 0.025);
          blade.position.set(Math.sin(i * Math.PI / 2) * 0.23, Math.cos(i * Math.PI / 2) * 0.23, 0);
          blade.rotation.z = -i * Math.PI / 2 + 0.26;
          fan.add(blade);
        }
        blades.add(this.kit.white, 0, 0, 0.03, 0.13, 0.13, 0.08);
        blades.flush(fan, false);
        visual.add(fan); fans.push(fan);
        for (let grille = 0; grille < 5; grille++) b.add(this.kit.panel, fx - 0.36 + grille * 0.18, 1.53, d / 2 + 0.27, 0.028, 0.85, 0.025);
      }
      for (let vent = 0; vent < 6; vent++) b.add(this.kit.trim, 0, 0.39 + vent * 0.08, d / 2 + 0.12, 2.4, 0.025, 0.025);
      b.add(signal, 0.92, 2.43, d / 2 + 0.11, 0.38, 0.12, 0.04);
    } else if (kind === 'power') {
      b.add(this.kit.shell, 0, h / 2, 0, w, h, d);
      b.add(this.kit.white, 0, h / 2, d / 2 + 0.025, w - 0.18, h - 0.2, 0.06);
      b.add(this.kit.panel, 0.38, 1.65, d / 2 + 0.09, 1.08, 1.7, 0.1);
      for (let row = 0; row < 5; row++) {
        b.add(this.kit.dark, 0.2, 1 + row * 0.29, d / 2 + 0.18, 0.25, 0.16, 0.13);
        b.add(this.kit.amber, 0.2, 1 + row * 0.29, d / 2 + 0.26, 0.08, 0.12, 0.045);
        b.add(signal, 0.65, 1 + row * 0.29, d / 2 + 0.17, 0.1, 0.045, 0.03);
      }
      b.add(this.kit.dark, -0.65, 2.17, d / 2 + 0.07, 0.48, 0.33, 0.06);
      b.add(signal, -0.65, 2.17, d / 2 + 0.11, 0.36, 0.19, 0.025);
      b.add(this.kit.amber, -0.65, 1.2, d / 2 + 0.07, 0.23, 0.32, 0.04);
      b.add(this.kit.trim, -0.92, 1.6, d / 2 + 0.1, 0.07, 0.48, 0.12);
    } else {
      b.add(this.kit.dark, 0, 0.025, 0, w, 0.07, d);
      for (let slat = 0; slat < 9; slat++) b.add(this.kit.trim, -0.68 + slat * 0.17, 0.075, 0, 0.05, 0.06, d - 0.12);
      obstruction = new THREE.Group();
      const block = new BoxBatch(this.cube);
      const cardboard = material(0xa88a5e, 0, 1);
      block.add(cardboard, 0.2, 0.24, 0.05, 0.95, 0.36, 0.63, 0.12);
      block.add(this.kit.amber, 0.2, 0.43, 0.05, 0.13, 0.015, 0.63, 0.12);
      block.flush(obstruction);
      visual.add(obstruction);
    }
    b.flush(visual);
    const ring = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.45, 0.04, d + 0.45)),
      new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.52, depthWrite: false }),
    );
    ring.position.y = 0.1;
    root.add(ring);
    const thermal = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.1, d + 0.1), new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    thermal.rotation.x = -Math.PI / 2;
    thermal.position.y = h + 0.12;
    thermal.visible = false;
    root.add(thermal);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(kind === 'rack' ? definition.name.toUpperCase() : kind === 'vent' ? 'INTAKE B2' : kind === 'cooling' ? 'COOLING C-01' : 'POWER P-01'), depthTest: true }));
    label.position.set(0, h + 0.45, 0);
    label.scale.set(kind === 'rack' ? 1.65 : 2.4, kind === 'rack' ? 0.258 : 0.375, 1);
    root.add(label);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, Math.max(h, 0.45), d + 0.1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    proxy.position.y = Math.max(h, 0.45) / 2;
    proxy.userData.equipmentId = definition.id;
    root.add(proxy); this.proxies.push(proxy);
    this.scene.add(root);
    this.views.set(definition.id, { definition, root, visual, ring, thermal, signal, label, fans, obstruction });
  }

  private buildAvatar(): void {
    const skin = material(0xb9815c, 0, 0.92);
    const fabric = material(0x263c48, 0, 1);
    const b = new BoxBatch(this.cube);
    b.add(this.jacket, 0, 1.02, 0, 0.47, 0.57, 0.28);
    b.add(this.kit.dark, 0, 0.73, 0, 0.43, 0.09, 0.3);
    b.add(this.kit.white, 0, 1.04, -0.151, 0.47, 0.052, 0.025);
    for (const x of [-0.17, 0.17]) b.add(this.kit.white, x, 1.09, -0.16, 0.045, 0.43, 0.02);
    b.add(this.kit.dark, 0, 1.02, 0.2, 0.34, 0.42, 0.14);
    b.add(this.kit.cyan, 0, 1.08, 0.28, 0.18, 0.025, 0.02);
    b.add(skin, 0, 1.48, 0, 0.3, 0.3, 0.27);
    b.add(this.kit.white, 0, 1.65, 0, 0.36, 0.15, 0.33);
    b.add(this.kit.white, 0, 1.58, -0.15, 0.4, 0.04, 0.16);
    b.add(this.kit.dark, 0, 1.48, -0.145, 0.23, 0.065, 0.02);
    b.add(this.kit.cyan, 0.09, 1.48, -0.16, 0.045, 0.032, 0.015);
    b.flush(this.avatarVisual);
    for (let i = 0; i < 4; i++) {
      const arm = i < 2;
      const side = i % 2 === 0 ? -1 : 1;
      const joint = new THREE.Group();
      joint.position.set(side * (arm ? 0.32 : 0.12), arm ? 1.25 : 0.7, 0);
      const part = new BoxBatch(this.cube);
      if (arm) {
        part.add(this.jacket, 0, -0.18, 0, 0.15, 0.38, 0.18);
        part.add(skin, 0, -0.43, 0, 0.13, 0.15, 0.15);
        part.add(this.kit.white, 0, -0.3, -0.01, 0.155, 0.035, 0.185);
      } else {
        part.add(fabric, 0, -0.29, 0, 0.17, 0.55, 0.21);
        part.add(this.kit.dark, 0, -0.61, -0.065, 0.2, 0.13, 0.34);
      }
      part.flush(joint); this.avatarVisual.add(joint); this.limbs.push(joint);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.43, 32), new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.75, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    this.avatar.add(ring);
  }

  private bindInput(): void {
    const listen = <K extends keyof WindowEventMap>(event: K, listener: (event: WindowEventMap[K]) => void): void => {
      window.addEventListener(event, listener);
      this.cleanups.push(() => window.removeEventListener(event, listener));
    };
    listen('keydown', (event) => {
      if (!this.active || editableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) {
        event.preventDefault(); this.keys.add(event.code);
      }
    });
    listen('keyup', (event) => this.keys.delete(event.code));
    listen('blur', () => { this.clearInput(); });
    const down = (event: PointerEvent): void => {
      if (!this.active || event.button !== 0) return;
      this.pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false };
      this.canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
      const previous = this.pointerDown;
      if (!previous || previous.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 5) previous.dragged = true;
      if (previous.dragged && this.cameraMode !== 'overview') this.turn(event.clientX - previous.lastX, event.clientY - previous.lastY);
      previous.lastX = event.clientX; previous.lastY = event.clientY;
    };
    const up = (event: PointerEvent): void => {
      const previous = this.pointerDown;
      if (!previous || previous.id !== event.pointerId) return;
      this.pointerDown = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      if (!previous.dragged && this.active) this.pick(event.clientX, event.clientY);
    };
    const cancel = (): void => { this.pointerDown = null; };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', cancel);
    this.cleanups.push(() => {
      this.canvas.removeEventListener('pointerdown', down); this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up); this.canvas.removeEventListener('pointercancel', cancel);
    });
  }

  private pick(x: number, y: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
    this.scene.updateMatrixWorld(true);
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.proxies, false)[0];
    if (hit) this.onSelect(hit.object.userData.equipmentId as string);
  }

  private clearInput(): void {
    this.keys.clear(); this.touch.x = 0; this.touch.y = 0; this.pointerDown = null;
  }

  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.clearInput();
  }

  setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    this.cameraInitialized = false;
    this.pitch = mode === 'first' ? 0.07 : 0.22;
  }

  setAvatar(color: string): void { this.jacket.color.set(color); }

  setTouchMove(x: number, y: number): void {
    if (!this.active) { this.touch.x = 0; this.touch.y = 0; return; }
    this.touch.x = THREE.MathUtils.clamp(x, -1, 1); this.touch.y = THREE.MathUtils.clamp(y, -1, 1);
  }

  /** Pointer delta in CSS pixels. Yaw zero faces north (-Z). */
  turn(dx: number, dy: number): void {
    if (!this.active) return;
    this.player.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.003, this.cameraMode === 'first' ? -0.7 : 0.05, 0.8);
  }

  reset(): void {
    this.player = { x: -3, z: 9, yaw: 0 };
    this.clearInput(); this.walking = 0; this.cameraInitialized = false;
    this.avatar.position.set(this.player.x, 0.08, this.player.z);
  }

  getPlayer(): { x: number; z: number; yaw: number } { return { ...this.player }; }

  getDistance(id: string): number {
    const eq = this.views.get(id)?.definition;
    if (!eq) return Infinity;
    const dx = Math.max(0, Math.abs(this.player.x - eq.x) - eq.width / 2);
    const dz = Math.max(0, Math.abs(this.player.z - eq.z) - eq.depth / 2);
    return Math.hypot(dx, dz);
  }

  getNearest(): { id: string; distance: number } | null {
    let nearest: { id: string; distance: number } | null = null;
    for (const eq of EQUIPMENT) {
      const distance = this.getDistance(eq.id);
      if (!nearest || distance < nearest.distance) nearest = { id: eq.id, distance };
    }
    return nearest;
  }

  private canOccupy(x: number, z: number): boolean {
    const radius = 0.32;
    if (x < -13.5 || x > 13.5 || z < -15.45 || z > 15.4) return false;
    for (const eq of EQUIPMENT) {
      if (eq.kind === 'vent') continue;
      if (Math.abs(x - eq.x) < eq.width / 2 + radius && Math.abs(z - eq.z) < eq.depth / 2 + radius) return false;
    }
    // Storage and the rear structural columns use the same simple navigation proxy policy.
    if (x > 6.75 && x < 11.8 && z > 12.4 && z < 14.5) return false;
    if (!this.environmentCollider) return true;
    const travel = new THREE.Vector3(x - this.player.x, 0, z - this.player.z);
    const length = travel.length();
    if (length < 0.00001) return true;
    travel.multiplyScalar(1 / length);
    for (const y of [0.28, 1.1]) {
      this.collisionRay.set(new THREE.Vector3(this.player.x, y, this.player.z), travel);
      this.collisionRay.near = 0;
      this.collisionRay.far = length + radius;
      if (this.collisionRay.intersectObject(this.environmentCollider, true).length) return false;
    }
    return true;
  }

  private movePlayer(dt: number): number {
    if (!this.active) return 0;
    const turning = Number(this.keys.has('ArrowLeft')) - Number(this.keys.has('ArrowRight'));
    this.player.yaw += turning * dt * 1.7;
    let forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) + this.touch.y;
    let strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) + this.touch.x;
    const length = Math.hypot(forward, strafe);
    if (length < 0.025) return 0;
    if (length > 1) { forward /= length; strafe /= length; }
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 5.4 : 3.6) * dt;
    const dx = (-Math.sin(this.player.yaw) * forward + Math.cos(this.player.yaw) * strafe) * speed;
    const dz = (-Math.cos(this.player.yaw) * forward - Math.sin(this.player.yaw) * strafe) * speed;
    const oldX = this.player.x; const oldZ = this.player.z;
    if (this.canOccupy(this.player.x + dx, this.player.z)) this.player.x += dx;
    if (this.canOccupy(this.player.x, this.player.z + dz)) this.player.z += dz;
    return Math.hypot(this.player.x - oldX, this.player.z - oldZ) / Math.max(dt, 0.00001);
  }

  private updateCamera(dt: number): void {
    const { x, z, yaw } = this.player;
    if (this.cameraMode === 'overview') {
      const orbit = this.active || this.reducedMotion ? 0 : Math.sin(this.time * 0.06) * 0.035;
      const narrow = this.camera.aspect < 1 ? 1.5 : 1;
      this.cameraDesired.set((24 + orbit * 35) * narrow, 29 * narrow, 32 * narrow);
      this.cameraTarget.set(0, 0.6, -1.6);
    } else if (this.cameraMode === 'first') {
      this.cameraDesired.set(x, 1.66, z);
      this.cameraTarget.set(x - Math.sin(yaw) * 8, 1.66 - Math.sin(this.pitch) * 8, z - Math.cos(yaw) * 8);
    } else {
      this.cameraTarget.set(x - Math.sin(yaw) * 1.4, 1.25, z - Math.cos(yaw) * 1.4);
      const distance = 7.8;
      this.cameraDesired.set(x + Math.sin(yaw) * distance, 4.6 + this.pitch * 5, z + Math.cos(yaw) * distance);
      this.cameraDesired.x = THREE.MathUtils.clamp(this.cameraDesired.x, -13.7, 13.7);
      this.cameraDesired.z = THREE.MathUtils.clamp(this.cameraDesired.z, -15.5, 18);
      // Camera collisions use authored equipment dimensions, never detailed server trays.
      const cameraOrigin = new THREE.Vector3(x, 1.65, z);
      const direction = this.cameraDesired.clone().sub(cameraOrigin);
      const distanceToCamera = direction.length(); direction.normalize();
      this.raycaster.set(cameraOrigin, direction);
      this.raycaster.near = 0.3; this.raycaster.far = distanceToCamera;
      this.scene.updateMatrixWorld(true);
      const hit = this.raycaster.intersectObjects(this.proxies, false)[0];
      if (hit && hit.distance < distanceToCamera) this.cameraDesired.copy(cameraOrigin).addScaledVector(direction, Math.max(0.2, hit.distance - 0.25));
    }
    if (!this.cameraInitialized || this.cameraMode === 'first' || this.reducedMotion) {
      this.camera.position.copy(this.cameraDesired); this.cameraLook.copy(this.cameraTarget); this.cameraInitialized = true;
    } else {
      const ease = 1 - Math.exp(-dt * 9);
      this.camera.position.lerp(this.cameraDesired, ease); this.cameraLook.lerp(this.cameraTarget, ease);
    }
    this.camera.lookAt(this.cameraLook);
  }

  update(dt: number, state: SimState, options: { thermal: boolean; selectedId: string | null; paused: boolean }): void {
    if (this.disposed) return;
    const delta = Math.max(0, Math.min(dt, 0.05));
    if (!options.paused) this.time += delta;
    const speed = options.paused ? 0 : this.movePlayer(delta);
    this.walking += speed * delta * 2.8;
    this.avatar.position.set(this.player.x, 0.08, this.player.z);
    this.avatar.rotation.y = this.player.yaw;
    this.avatar.visible = this.cameraMode !== 'first';
    for (let i = 0; i < this.limbs.length; i++) this.limbs[i].rotation.x = speed > 0.1 && !this.reducedMotion ? Math.sin(this.walking + (i % 2 ? Math.PI : 0)) * (i < 2 ? 0.3 : -0.5) : 0;
    const incident = state.status !== 'ready';
    const heat = THREE.MathUtils.clamp((state.temperature - 28) / 30, 0, 1);
    const pulse = this.reducedMotion ? 1 : 0.8 + Math.sin(this.time * 2.6) * 0.2;
    this.emergencyLight.intensity = incident ? (state.breakerTripped ? 30 : heat * 7) * pulse : 0;
    this.keyLight.intensity = state.breakerTripped ? 2.4 : 3.3;
    for (const view of this.views.values()) {
      const { definition: eq, ring, thermal, signal, label } = view;
      const critical = eq.id === 'rack-b2';
      const isFault = incident && ((critical && state.temperature > 32) || (eq.kind === 'power' && state.breakerTripped));
      const color = isFault ? state.breakerTripped || state.temperature > 50 ? COLORS.red : COLORS.amber : COLORS.cyan;
      signal.color.setHex(color); signal.emissive.setHex(color);
      signal.emissiveIntensity = state.breakerTripped && eq.kind === 'rack' ? 0.05 : (isFault ? pulse : 0.7);
      const ringMaterial = ring.material as THREE.LineBasicMaterial;
      ringMaterial.color.setHex(options.selectedId === eq.id ? 0xffffff : color);
      ringMaterial.opacity = options.selectedId === eq.id ? 1 : isFault ? pulse : 0.3;
      ring.scale.setScalar(options.selectedId === eq.id ? 1.035 : 1);
      thermal.visible = options.thermal && eq.kind === 'rack';
      const localHeat = critical ? heat : heat * Math.exp(-Math.hypot(eq.x + 3, eq.z + 3) / 5) * 0.6;
      thermal.material.color.setHSL((1 - localHeat) * 0.46, 0.86, 0.54);
      thermal.material.opacity = 0.22 + localHeat * 0.38;
      label.visible = this.cameraMode === 'overview' || this.getDistance(eq.id) < 7 || critical || options.selectedId === eq.id;
      for (const fan of view.fans) if (!options.paused && !state.breakerTripped && !this.reducedMotion) fan.rotation.z += delta * (state.coolingBoosted ? 13 : 6);
      if (view.obstruction) view.obstruction.visible = !state.ventCleared;
    }
    this.updateCamera(delta);
    this.renderer.render(this.scene, this.camera);
  }

  setEquipmentModel(id: string, object: THREE.Object3D): void {
    const view = this.views.get(id);
    if (!view) return;
    view.visual.visible = false;
    const previous = view.root.getObjectByName('imported-visual');
    if (previous) view.root.remove(previous);
    object.name = 'imported-visual';
    object.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
    view.root.add(object);
  }

  setAvatarModel(object: THREE.Object3D): void {
    this.avatarVisual.visible = false;
    const previous = this.avatar.getObjectByName('imported-avatar');
    if (previous) this.avatar.remove(previous);
    object.name = 'imported-avatar';
    this.avatar.add(object);
  }

  replaceModel(slot: 'rack' | 'cooling' | 'power' | 'avatar', template: THREE.Object3D): void {
    if (slot === 'avatar') { this.setAvatarModel(cloneSkeleton(template)); return; }
    for (const eq of EQUIPMENT) if (eq.kind === slot) this.setEquipmentModel(eq.id, cloneSkeleton(template));
  }

  /** Optional environments must be calibrated to this 28×32 m authored gameplay footprint. */
  attachEnvironment(root: THREE.Group, collider: THREE.Object3D): void {
    if (this.environment) this.scene.remove(this.environment);
    this.environment = root; this.environmentCollider = collider;
    if (!root.getObjectById(collider.id)) root.add(collider);
    collider.visible = false;
    this.scene.add(root); root.updateMatrixWorld(true);
    // Keep the flat authored floor and exact gameplay collision proxies as the navigation contract.
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      dpr: this.renderer.getPixelRatio(), shadowMap: 1536, postPasses: 0,
      cameraMode: this.cameraMode, player: this.getPlayer(), equipment: this.views.size,
      generatedCollider: Boolean(this.environmentCollider), active: this.active,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.resizeObserver.disconnect(); this.cleanups.forEach((cleanup) => cleanup()); this.clearInput();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (renderable.material) for (const mat of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) materials.add(mat);
    });
    for (const mat of materials) for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    geometries.forEach((geometry) => geometry.dispose()); textures.forEach((texture) => texture.dispose()); materials.forEach((mat) => mat.dispose());
    this.renderer.dispose();
  }
}
