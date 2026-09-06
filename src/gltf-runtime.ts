import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { WebGLRenderer } from 'three';

// Every model AND collider shares this Draco decoder. It is lazy until needed.
let draco: DRACOLoader | undefined;
let ktx: KTX2Loader | undefined;

export function createGLTFLoader(renderer: WebGLRenderer): GLTFLoader {
  draco ??= new DRACOLoader().setDecoderPath('https://cdn.mint.gg/runtime/draco/gltf/three-0.184.0/');
  ktx ??= new KTX2Loader()
    .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/basis/')
    .detectSupport(renderer);
  return new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx);
}

export function disposeGLTFRuntime(): void {
  draco?.dispose();
  ktx?.dispose();
  draco = undefined;
  ktx = undefined;
}
