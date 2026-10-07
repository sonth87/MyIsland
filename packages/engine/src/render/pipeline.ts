import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { App } from '../core/App';
import { OutlinePass, type OutlineParams } from './OutlinePass';

/** Static paper grain + soft vignette, applied in display (sRGB) space. */
const PaperShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.035 },
    vignette: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float vignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float grain = hash(floor(gl_FragCoord.xy * 0.75)) - 0.5;
      c.rgb += grain * amount;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * vignette;
      gl_FragColor = c;
    }`,
};

export interface StylizedOptions {
  outline?: Partial<OutlineParams>;
  grain?: number;
  vignette?: number;
}

export interface StylizedPipeline {
  composer: EffectComposer;
  outline: OutlinePass;
  paper: ShaderPass;
}

/** Render → ink outline → color output → paper grain. Replaces `app.render`. */
export function createStylizedPipeline(app: App, options: StylizedOptions = {}): StylizedPipeline {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(app.renderer, target);
  composer.addPass(new RenderPass(app.scene, app.camera));

  const outline = new OutlinePass(app.scene, app.camera, options.outline);
  composer.addPass(outline);
  composer.addPass(new OutputPass());

  const paper = new ShaderPass(PaperShader);
  paper.uniforms.amount.value = options.grain ?? 0.035;
  paper.uniforms.vignette.value = options.vignette ?? 0.35;
  composer.addPass(paper);

  app.onResize((w, h) => {
    composer.setPixelRatio(app.renderer.getPixelRatio());
    composer.setSize(w, h);
  });
  app.render = () => composer.render();

  return { composer, outline, paper };
}
