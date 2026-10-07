import GUI from 'lil-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import type { App } from '../core/App';

/** Debug tools are enabled with `?debug` in the URL. */
export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export interface DebugTools {
  gui: GUI | null;
}

export function createDebug(app: App): DebugTools {
  if (!DEBUG) return { gui: null };
  const gui = new GUI({ title: 'Debug' });
  const stats = new Stats();
  stats.dom.style.left = 'auto';
  stats.dom.style.right = '260px';
  document.body.appendChild(stats.dom);
  app.add({ update: () => stats.update() });

  const info = { drawCalls: 0, triangles: 0 };
  const folder = gui.addFolder('Renderer');
  folder.add(info, 'drawCalls').listen().disable();
  folder.add(info, 'triangles').listen().disable();
  app.add({
    update: () => {
      info.drawCalls = app.renderer.info.render.calls;
      info.triangles = app.renderer.info.render.triangles;
    },
  });
  return { gui };
}
