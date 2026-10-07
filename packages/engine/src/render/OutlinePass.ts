import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export interface OutlineParams {
  color: THREE.ColorRepresentation;
  /** Sample offset in pixels. */
  thickness: number;
  /** Relative depth jump (fraction of distance) that starts an edge. */
  depthThreshold: number;
  /** 1 - cos(angle) between neighbour normals that starts an edge. */
  normalThreshold: number;
  strength: number;
}

const DEFAULTS: OutlineParams = {
  color: '#1f2b2b',
  thickness: 1,
  depthThreshold: 0.04,
  normalThreshold: 0.45,
  strength: 0.9,
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float thickness;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float strength;
uniform vec3 outlineColor;
uniform vec2 fadeRange;
varying vec2 vUv;

float viewDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}

vec3 viewNormal(vec2 uv) {
  return texture2D(tNormal, uv).rgb * 2.0 - 1.0;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  vec2 px = thickness / resolution;
  vec2 o[4];
  o[0] = vec2(px.x, 0.0); o[1] = vec2(-px.x, 0.0); o[2] = vec2(0.0, px.y); o[3] = vec2(0.0, -px.y);

  float d0 = viewDepth(vUv);
  vec3 n0 = viewNormal(vUv);
  float depthDiff = 0.0;
  float normalDiff = 0.0;
  for (int i = 0; i < 4; i++) {
    // Only count neighbours that are farther away, so the line sits on the nearer object.
    depthDiff += max(viewDepth(vUv + o[i]) - d0, 0.0);
    normalDiff += 1.0 - dot(n0, viewNormal(vUv + o[i]));
  }
  depthDiff /= d0;

  float depthEdge = smoothstep(depthThreshold, depthThreshold * 2.0, depthDiff);
  float normalEdge = smoothstep(normalThreshold, normalThreshold * 1.6, normalDiff);
  float edge = max(depthEdge, normalEdge) * strength;
  // Lines fade out with distance (matching fog), so far objects don't show as bare outlines.
  edge *= 1.0 - smoothstep(fadeRange.x, fadeRange.y, d0);
  gl_FragColor = vec4(mix(color.rgb, outlineColor, edge), color.a);
}`;

/**
 * Ink-line outline: renders view-space normals + depth of the scene, then draws lines
 * where depth jumps (silhouettes) or normals bend sharply (creases).
 */
export class OutlinePass extends Pass {
  readonly params: OutlineParams;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly normalMaterial = new THREE.MeshNormalMaterial();
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly excluded = new Set<THREE.Object3D>();
  private readonly tmpColor = new THREE.Color();
  private readonly swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    params: Partial<OutlineParams> = {},
  ) {
    super();
    this.params = { ...DEFAULTS, ...params };
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tNormal: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        thickness: { value: 1 },
        depthThreshold: { value: 0.04 },
        normalThreshold: { value: 0.45 },
        strength: { value: 1 },
        outlineColor: { value: new THREE.Color() },
        fadeRange: { value: new THREE.Vector2(1e5, 1e6) },
      },
      vertexShader,
      fragmentShader,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Objects hidden from the outline pass (e.g. swaying grass, particles). */
  exclude(object: THREE.Object3D): void {
    this.excluded.add(object);
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const { scene, camera } = this;

    // 1) normals + depth
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    const prevAutoShadow = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(this.tmpColor);
    const prevClearAlpha = renderer.getClearAlpha();
    for (const o of this.excluded) o.visible = false;

    // Meshes can bring their own normal material (e.g. one that sways in the wind like the
    // mesh does) via `userData.outlineMaterial`; everything else uses the shared one.
    let custom = false;
    scene.traverseVisible((o) => {
      const m = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh) : null;
      if (m?.userData.outlineMaterial) custom = true;
    });
    if (custom) {
      scene.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        this.swapped.push([m, m.material]);
        m.material = (m.userData.outlineMaterial as THREE.Material | undefined) ?? this.normalMaterial;
      });
    } else {
      scene.overrideMaterial = this.normalMaterial;
    }
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x8080ff, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);

    for (const [m, mat] of this.swapped) m.material = mat;
    this.swapped.length = 0;
    for (const o of this.excluded) o.visible = true;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    renderer.shadowMap.autoUpdate = prevAutoShadow;
    renderer.setClearColor(this.tmpColor, prevClearAlpha);

    // 2) composite
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.thickness.value = this.params.thickness;
    u.depthThreshold.value = this.params.depthThreshold;
    u.normalThreshold.value = this.params.normalThreshold;
    u.strength.value = this.params.strength;
    u.outlineColor.value.set(this.params.color);
    const fog = scene.fog;
    if (fog instanceof THREE.Fog) u.fadeRange.value.set(fog.near * 0.6, fog.far * 0.75);
    else u.fadeRange.value.set(1e5, 1e6);

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.target.dispose();
    this.normalMaterial.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
