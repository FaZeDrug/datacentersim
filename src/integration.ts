import { Box3, Group, Mesh, Vector3, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { createGLTFLoader } from './gltf-runtime';

type Slot = 'rack' | 'cooling' | 'power' | 'avatar';
type AssetModel = { url: string; targetHeight?: number; rotationY?: number };
type WorldAsset = {
  provider: 'worldlabs' | 'mint'; url: string; colliderUrl: string; format: 'spz' | 'rad';
  position: [number, number, number]; rotation: [number, number, number]; scale: number;
  enabled?: boolean;
};
export type AssetManifest = {
  version: 1; models: Partial<Record<Slot, AssetModel>>; world: WorldAsset | null;
  audio: { ambient?: string; alarm?: string };
};
type IntegrationWorld = {
  scene: Scene; renderer: WebGLRenderer;
  replaceModel: (slot: Slot, model: Object3D) => void;
  attachEnvironment: (root: Group, collider: Object3D) => void;
};
let audioSources: AssetManifest['audio'] = {};
export function getAudioSources(): AssetManifest['audio'] { return { ...audioSources }; }

function assetURL(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('An asset URL is missing.');
  if (value.startsWith('/') && !value.startsWith('//')) return `${import.meta.env.BASE_URL}${value.slice(1)}`;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Asset URLs must be local /assets paths or HTTPS.');
  return url.href;
}

function normalizeModel(model: Object3D, config: AssetModel): Object3D {
  const wrapper = new Group();
  wrapper.add(model);
  wrapper.rotation.y = config.rotationY ?? 0;
  wrapper.updateMatrixWorld(true);
  const box = new Box3().setFromObject(wrapper);
  const size = box.getSize(new Vector3());
  if (!Number.isFinite(size.y) || size.y < 0.00001) throw new Error('Model has no usable bounds.');
  const target = config.targetHeight ?? 2.8;
  if (!Number.isFinite(target) || target <= 0 || target > 20) throw new Error('Invalid targetHeight.');
  const factor = target / size.y;
  wrapper.scale.setScalar(factor);
  wrapper.updateMatrixWorld(true);
  box.setFromObject(wrapper);
  const center = box.getCenter(new Vector3());
  wrapper.position.set(-center.x, -box.min.y, -center.z);
  wrapper.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  return wrapper;
}

export async function loadIntegrations(world: IntegrationWorld, onStatus: (message: string) => void): Promise<void> {
  const failures: string[] = [];
  let loaded = 0;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}assets/manifest.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Asset manifest unavailable.');
    const manifest = await response.json() as AssetManifest;
    if (manifest.version !== 1 || !manifest.models || !manifest.audio) throw new Error('Unsupported asset manifest.');
    for (const role of ['ambient', 'alarm'] as const) {
      if (manifest.audio[role]) audioSources[role] = assetURL(manifest.audio[role]!);
    }
    const loader = createGLTFLoader(world.renderer);
    await Promise.all((Object.entries(manifest.models) as [Slot, AssetModel][]).map(async ([slot, config]) => {
      if (!['rack', 'cooling', 'power', 'avatar'].includes(slot)) return;
      try {
        const gltf = await loader.loadAsync(assetURL(config.url));
        world.replaceModel(slot, normalizeModel(gltf.scene, config));
        loaded++;
      } catch { failures.push(`${slot} model could not load`); }
    }));
    if (manifest.world && manifest.world.enabled !== false) {
      const config = manifest.world;
      const root = new Group();
      let cleanup: (() => void) | undefined;
      try {
        if (!config.colliderUrl) throw new Error('World needs its matching collider.');
        if (![...config.position, ...config.rotation, config.scale].every(Number.isFinite) || config.scale <= 0) throw new Error('Invalid world transform.');
        const { SparkRenderer, SplatMesh, SplatFileType } = await import('@sparkjsdev/spark');
        const spark = new SparkRenderer({ renderer: world.renderer, enableLod: true });
        const splat = new SplatMesh({
          url: assetURL(config.url), fileType: config.format === 'rad' ? SplatFileType.RAD : SplatFileType.SPZ,
          paged: config.format === 'rad', raycastable: false,
        });
        cleanup = () => { splat.dispose(); spark.dispose(); };
        root.position.set(...config.position);
        root.rotation.set(...config.rotation);
        root.scale.setScalar(config.scale);
        root.add(splat);
        const [, gltf] = await Promise.all([splat.initialized, loader.loadAsync(assetURL(config.colliderUrl))]);
        root.add(gltf.scene);
        root.updateMatrixWorld(true);
        gltf.scene.traverse(object => { object.visible = false; });
        world.scene.add(spark);
        world.attachEnvironment(root, gltf.scene);
        loaded++;
      } catch { cleanup?.(); failures.push('generated environment could not load'); }
    }
    // Preserve the first failure even when another asset finishes later.
    if (failures.length) onStatus(`${failures.join('; ')}. Built-in assets retained for those slots.`);
    else if (loaded) onStatus(`${loaded} custom scene asset${loaded === 1 ? '' : 's'} loaded.`);
    else onStatus('Built-in facility ready.');
  } catch { onStatus('Custom assets unavailable. Built-in facility ready.'); }
}

export type RunSummary = {
  score: number; outcome: 'won' | 'lost'; elapsed: number; mode: 'guided' | 'challenge';
  inspections: number; mistakes: number;
};

export async function saveRun(run: RunSummary): Promise<'saved' | 'local'> {
  const record = { ...run, runId: crypto.randomUUID() };
  try {
    const history = JSON.parse(localStorage.getItem('datacentersim-runs') ?? '[]');
    localStorage.setItem('datacentersim-runs', JSON.stringify([record, ...(Array.isArray(history) ? history : [])].slice(0, 30)));
  } catch { /* A disabled local store must not block a finished run. */ }
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url?.trim()) return 'local';
  try {
    const [{ ConvexHttpClient }, { makeFunctionReference }] = await Promise.all([import('convex/browser'), import('convex/server')]);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    const client = new ConvexHttpClient(url, { fetch: (input, init) => fetch(input, { ...init, signal: controller.signal }) });
    try { await client.mutation(makeFunctionReference<'mutation'>('runs:save'), record); }
    finally { window.clearTimeout(timeout); }
    return 'saved';
  } catch { return 'local'; }
}
