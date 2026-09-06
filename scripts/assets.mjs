#!/usr/bin/env node
/** Optional, server-side asset pipeline. Nothing runs during npm install/dev/build. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'public/assets/manifest.json');
const work = resolve(root, 'work/assets');
if (existsSync(resolve(root, '.env.local'))) process.loadEnvFile(resolve(root, '.env.local'));
const models = ['rack', 'cooling', 'power', 'avatar'];
const heights = { rack: 2.8, cooling: 2.8, power: 2.6, avatar: 1.7 };
const providers = {
  tripo: { base: 'https://openapi.tripo3d.ai/v3', key: 'TRIPO_API_KEY' },
  worldlabs: { base: 'https://api.worldlabs.ai/marble/v1', key: 'WORLDLABS_API_KEY' },
  mint: { base: 'https://api.mint.gg/v1', key: 'MINT_API_KEY' },
};
const prompts = {
  rack: 'One modern black data center server rack, front-facing upright floor-standing cabinet, rectangular 42U proportions, subtle cyan status LEDs, closed mesh door, realistic hard-surface model, clean silhouette, no room, no floor, no text, physically based materials.',
  cooling: 'One industrial data center precision cooling cabinet, upright white and graphite enclosure with visible fan grille, blue trim, compact floor-standing proportions, realistic hard-surface model, no room, no floor, no text, physically based materials.',
  power: 'One data center power distribution cabinet, upright dark graphite enclosure with a yellow electrical hazard symbol and small breaker panel, clean hard-surface model, no room, no floor, no text, physically based materials.',
  avatar: 'One friendly stylized adult data center technician standing upright in neutral A pose, navy work jumpsuit, orange safety vest, short dark hair, sneakers, low polygon clean game character, no tool, no ground, no scenery.',
  world: 'A spacious modern data center at night, rectangular 30 by 36 meter server hall, open wide central walkway, server aisles around the perimeter, raised floor, overhead cable trays, graphite architecture, cyan guide lighting, white cooling cabinets along the back wall, amber electrical bay, no people, no readable text, realistic industrial interior.',
  ambient: 'Seamless steady ambience inside a modern data center: soft server fan airflow, low electrical hum, subtle distant ventilation, calm night shift, no voices, no music, no sudden noises.',
  alarm: 'A short clear data center equipment warning: two restrained electronic beeps followed by silence, professional industrial alarm, no voices, no music, no siren.',
};

const help = `Data Center Sim asset CLI — Node 22.12+\n
  npm run assets -- prompts
  npm run assets -- generate tripo rack|cooling|power|avatar
  npm run assets -- generate worldlabs world
  npm run assets -- generate mint ambient|alarm
  npm run assets -- status tripo|worldlabs|mint JOB_ID
  npm run assets -- fetch tripo|worldlabs|mint JOB_ID SLOT
  npm run assets -- import rack|cooling|power|avatar /absolute/model.glb
  npm run assets -- import ambient|alarm /absolute/sound.mp3
  npm run assets -- mint-manifest SLOT /absolute/mint-manifest.json
  npm run assets -- check

Generation spends provider credits when you run it. Fetch only imports finished jobs.
No automatic retries of generation. Keys stay in .env.local or the terminal environment.
World imports are saved disabled until you calibrate the room transform; see docs/API_SETUP.md.`;

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function updateManifest(fn) {
  const manifest = await json(manifestPath);
  fn(manifest);
  await save(manifestPath, manifest);
}
function safeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(value)) throw new Error('Invalid job ID.');
  return value;
}
function provider(name) {
  const config = providers[name];
  if (!config) throw new Error('Provider must be tripo, worldlabs, or mint.');
  if (!process.env[config.key]?.trim()) throw new Error(`Set ${config.key} in .env.local. No request was made.`);
  return config;
}
async function api(name, path, body, idempotencyKey) {
  const config = provider(name);
  const headers = { 'Content-Type': 'application/json' };
  if (name === 'worldlabs') headers['WLT-Api-Key'] = process.env[config.key];
  else headers.Authorization = `Bearer ${process.env[config.key]}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${config.base}${path}`, {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || (name === 'tripo' && data?.code !== 0)) {
    const code = data?.error?.code ?? data?.code ?? response.status;
    throw new Error(`${name} request rejected (${code}). Check your account credits, key, and provider dashboard. No automatic retry was made.`);
  }
  return data;
}
function checkGLB(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) throw new Error('Asset is not a valid GLB 2 file.');
  const length = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || 20 + length > bytes.length) throw new Error('GLB JSON chunk is invalid.');
  const data = JSON.parse(bytes.toString('utf8', 20, 20 + length).trim());
  const supported = new Set(['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu','KHR_materials_unlit','KHR_texture_transform','KHR_mesh_quantization','KHR_materials_clearcoat','KHR_materials_transmission','KHR_materials_volume','KHR_materials_ior','KHR_materials_specular','KHR_materials_sheen','KHR_materials_iridescence','KHR_materials_anisotropy','KHR_materials_emissive_strength','EXT_mesh_gpu_instancing','KHR_lights_punctual','EXT_texture_webp','EXT_texture_avif']);
  const unknown = (data.extensionsRequired ?? []).filter(x => !supported.has(x));
  if (unknown.length) throw new Error(`Unsupported required GLB extensions: ${unknown.join(', ')}`);
  return { extensionsUsed: data.extensionsUsed ?? [], extensionsRequired: data.extensionsRequired ?? [] };
}
async function download(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS asset downloads are supported.');
  // Never forward account authorization to a storage/download host.
  const response = await fetch(parsed, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Asset download failed (${response.status}). Fetch the job again for a fresh URL.`);
  return Buffer.from(await response.arrayBuffer());
}
async function importBytes(slot, bytes, extension, source = { provider: 'manual' }) {
  if (![...models, 'ambient', 'alarm'].includes(slot)) throw new Error('Unknown asset slot.');
  const metadata = models.includes(slot) ? checkGLB(bytes) : {};
  if (models.includes(slot) && extension !== '.glb') throw new Error('Model slots require a GLB file.');
  if (!models.includes(slot) && !['.mp3','.wav','.ogg','.m4a'].includes(extension)) throw new Error('Audio needs MP3, WAV, OGG, or M4A.');
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const url = `/assets/imported/${slot}-${hash}${extension}`;
  const destination = resolve(root, `public${url}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  await updateManifest(manifest => {
    if (models.includes(slot)) manifest.models[slot] = { url, targetHeight: heights[slot], rotationY: 0, ...metadata, source };
    else manifest.audio[slot] = url;
  });
  console.log(`Imported ${slot} → ${url}. Refresh the game. Existing generated files were preserved.`);
}
async function importMintManifest(slot, input) {
  const manifest = input?.data ?? input;
  if (slot === 'world') {
    const runtime = manifest.runtime;
    if (manifest.integrationMode !== 'remote_stream' || !runtime?.runtimeUrl || !runtime?.collider?.runtimeUrl) throw new Error('Mint world requires final remote_stream RAD and matching collider runtime URLs.');
    await updateManifest(m => { m.world = { provider: 'mint', format: 'rad', url: runtime.runtimeUrl, colliderUrl: runtime.collider.runtimeUrl, position: [0, 1.5, 0], rotation: [Math.PI, Math.PI, 0], scale: 2.5, enabled: false }; });
    console.log('Mint RAD + collider registered. Calibrate the shared transform and set enabled:true.');
  } else {
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : Object.values(manifest.artifacts ?? {});
    const artifact = artifacts.find(a => models.includes(slot) ? (a.role === 'canonical_model' && a.format === 'glb') : /audio/.test(a.contentType ?? '') && a.downloadUrl)
      ?? artifacts.find(a => models.includes(slot) ? a.format === 'glb' : /mp3|wav|ogg|m4a/.test(a.format ?? ''));
    if (!artifact?.downloadUrl) throw new Error('No ready compatible downloadable artifact in Mint manifest.');
    const ext = models.includes(slot) ? '.glb' : `.${artifact.format === 'mpeg' ? 'mp3' : artifact.format}`;
    await importBytes(slot, await download(artifact.downloadUrl), ext, { provider: 'mint', artifactId: artifact.artifactId });
  }
  // API artifacts belong to the Mint account library, not an MCP chat/project.
  const registryPath = resolve(root, 'provider-assets.json');
  const registry = existsSync(registryPath) ? await json(registryPath) : { registryVersion: 1, source: 'mint-public-api', assets: {} };
  const current = await json(manifestPath);
  registry.assets[slot] = { importedAt: new Date().toISOString(), runtime: slot === 'world' ? current.world : current.models[slot] ?? { url: current.audio[slot] } };
  await save(registryPath, registry);
}
async function generate(name, slot) {
  provider(name);
  let path, body;
  if (name === 'tripo' && models.includes(slot)) {
    path = '/generation/text-to-model';
    body = { prompt: prompts[slot], model: process.env.TRIPO_MODEL || 'v3.1-20260211' };
  } else if (name === 'worldlabs' && slot === 'world') {
    path = '/worlds:generate';
    body = { display_name: 'Data Center Sim — Night Shift', model: process.env.WORLDLABS_MODEL || 'marble-1.1', world_prompt: { type: 'text', text_prompt: prompts.world } };
  } else if (name === 'mint' && ['ambient', 'alarm'].includes(slot)) {
    path = '/audio:generate';
    body = { name: `Night Shift ${slot}`, prompt: prompts[slot], audioKind: slot === 'alarm' ? 'sound_effect' : 'general_audio', generationPreset: 'standard', durationSeconds: slot === 'alarm' ? 3 : 20 };
  } else throw new Error('Unsupported provider/slot combination. Run npm run assets -- help.');
  const requestId = randomUUID();
  const requestPath = resolve(work, `request-${requestId}.json`);
  await save(requestPath, { provider: name, slot, path, body, idempotencyKey: name === 'mint' ? requestId : null, status: 'submitting' });
  console.log(`Submitting ${name} ${slot}; provider credits may be consumed. Local request record: ${relative(root, requestPath)}`);
  const result = await api(name, path, body, name === 'mint' ? requestId : undefined);
  const id = name === 'tripo' ? result.data?.task_id : name === 'worldlabs' ? result.operation_id : result.id;
  if (!id) throw new Error('No operation ID returned. Check provider history before resubmitting.');
  await save(resolve(work, `${name}-${safeId(id)}.json`), { provider: name, slot, requestId, result });
  console.log(`Job ${id}\nCheck: npm run assets -- status ${name} ${id}\nWhen complete: npm run assets -- fetch ${name} ${id} ${slot}`);
}
async function status(name, id, slot) {
  safeId(id);
  const path = name === 'tripo' ? `/tasks/${id}` : `/operations/${id}`;
  const result = await api(name, path);
  const task = name === 'tripo' ? result.data : result;
  const state = name === 'worldlabs' ? task.done ? task.error ? 'failed' : 'succeeded' : 'running' : task.status;
  console.log(`${name} ${id}: ${state}${typeof task.progress === 'number' ? ` (${task.progress}%)` : ''}`);
  await save(resolve(work, `${name}-${id}.json`), { provider: name, slot, result });
  if (!slot) return;
  if (!['success', 'succeeded'].includes(state)) throw new Error(state === 'billing_required' ? 'Resolve billing in Mint Platform; resume the original operation. Do not start a duplicate.' : 'Job is not successfully completed. Re-run status later; failed jobs need provider review.');
  if (name === 'tripo') {
    if (!models.includes(slot) || !task.output?.model_url) throw new Error('Missing model_url or invalid model slot.');
    await importBytes(slot, await download(task.output.model_url), '.glb', { provider: name, taskId: id });
  } else if (name === 'worldlabs') {
    if (slot !== 'world') throw new Error('World Labs imports must use the world slot.');
    const world = task.response?.world ?? task.response;
    const assets = world?.assets;
    const url = assets?.splats?.spz_urls?.['100k'] ?? assets?.splats?.spz_urls?.['500k'];
    const colliderUrl = assets?.mesh?.collider_mesh_url;
    if (!url || !colliderUrl) throw new Error('World response lacks SPZ and matching collider.');
    const semantic = assets.splats.semantics_metadata;
    await updateManifest(m => { m.world = { provider: 'worldlabs', format: 'spz', url, colliderUrl, position: [0, semantic?.ground_plane_offset ?? 0, 0], rotation: [Math.PI, 0, 0], scale: semantic?.metric_scale_factor ?? 1, enabled: false }; });
    console.log('World Labs SPZ + collider registered (100k preferred). Calibrate the shared transform and set enabled:true.');
  } else {
    if (!task.resource?.id || !task.resource?.type) throw new Error('Mint operation has no completed resource.');
    const manifest = await api('mint', `/assets/${encodeURIComponent(task.resource.type)}/${encodeURIComponent(task.resource.id)}/artifact-manifest`);
    await importMintManifest(slot, manifest);
  }
}
async function check() {
  const manifest = await json(manifestPath);
  if (manifest.version !== 1 || !manifest.models || !manifest.audio) throw new Error('Invalid manifest shape.');
  let count = 0;
  for (const [slot, item] of Object.entries(manifest.models)) {
    if (!models.includes(slot)) throw new Error(`Unknown model slot: ${slot}`);
    if (!item.url.startsWith('/assets/')) throw new Error(`Model ${slot} should use a local /assets path.`);
    const path = resolve(root, `public${item.url}`);
    if (!path.startsWith(resolve(root, 'public/assets') + '/')) throw new Error('Asset path escapes public/assets.');
    const info = checkGLB(await readFile(path));
    console.log(`${slot}: GLB valid; required extensions: ${info.extensionsRequired.join(', ') || 'none'}`);
    count++;
  }
  for (const [slot, url] of Object.entries(manifest.audio)) {
    const path = resolve(root, `public${url}`);
    if (!url.startsWith('/assets/') || !path.startsWith(resolve(root, 'public/assets') + '/')) throw new Error(`Audio ${slot} must be a local /assets path.`);
    if (!(await stat(path)).isFile()) throw new Error(`Audio missing: ${slot}`);
    count++;
  }
  if (manifest.world) {
    for (const key of ['url', 'colliderUrl']) if (new URL(manifest.world[key]).protocol !== 'https:') throw new Error(`World ${key} must be HTTPS.`);
    console.log(`World registered (${manifest.world.enabled ? 'enabled' : 'disabled pending calibration'}); remote network and visual compatibility not tested.`);
  }
  console.log(`Asset checks passed: ${count} local imported files. Built-in facility needs no external files.`);
}

const [command, name, value, slot] = process.argv.slice(2);
try {
  if (!command || command === 'help' || command === '--help') console.log(help);
  else if (command === 'prompts') console.log(JSON.stringify(prompts, null, 2));
  else if (command === 'generate') await generate(name, value);
  else if (command === 'status') await status(name, value);
  else if (command === 'fetch') {
    if (!slot) throw new Error('Fetch needs a destination slot after the job ID.');
    await status(name, value, slot);
  }
  else if (command === 'import') await importBytes(name, await readFile(resolve(value)), extname(value).toLowerCase());
  else if (command === 'mint-manifest') await importMintManifest(name, await json(resolve(value)));
  else if (command === 'check') await check();
  else throw new Error(help);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Asset operation failed.');
  process.exitCode = 1;
}
