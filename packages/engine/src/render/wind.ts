import * as THREE from 'three';
import { toonMaterial } from './toon';

export interface WindUniforms {
  uTime: { value: number };
  uWind: { value: number };
}

export function createWindUniforms(strength = 0.35): WindUniforms {
  return { uTime: { value: 0 }, uWind: { value: strength } };
}

/**
 * Toon material whose vertices sway in model space (stronger towards the top, quadratic in y).
 * Intended for instanced grass / crops whose model origin sits at the base.
 */
export function windToonMaterial(params: THREE.MeshToonMaterialParameters, uniforms: WindUniforms): THREE.MeshToonMaterial {
  const mat = toonMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader =
      'uniform float uTime;\nuniform float uWind;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 windOrigin = instanceMatrix[3].xyz;
        #else
          vec3 windOrigin = vec3(0.0);
        #endif
        float windPhase = dot(windOrigin, vec3(0.37, 0.29, 0.33));
        float sway = sin(uTime * 1.7 + windPhase) * 0.7 + sin(uTime * 3.3 + windPhase * 1.9) * 0.3;
        float bend = position.y * position.y * uWind;
        transformed.x += sway * bend;
        transformed.z += sway * bend * 0.4;`,
      );
  };
  mat.customProgramCacheKey = () => 'wind-toon';
  return mat;
}
