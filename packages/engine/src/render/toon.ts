import * as THREE from 'three';

let sharedGradient: THREE.DataTexture | null = null;

/** 3-step light ramp: shadow / mid / lit. Nearest filtering gives hard cel bands. */
export function toonGradient(): THREE.DataTexture {
  if (sharedGradient) return sharedGradient;
  const data = new Uint8Array([95, 175, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sharedGradient = tex;
  return tex;
}

export function toonMaterial(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
}
