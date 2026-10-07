// Captures representative screenshots of both games into ./screenshots.
// Usage: pnpm screenshots   (needs Google Chrome installed; set CHROME=/path/to/chrome to override)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = new URL('..', import.meta.url).pathname;

async function serve(app, port) {
  const p = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort'], { cwd: `${root}apps/${app}`, stdio: 'ignore' });
  // Wait until the dev server answers.
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://localhost:${port}/`);
      return p;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`dev server for ${app} did not start`);
}

async function shoot(page, dir, name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`  ${dir.split('/').pop()}/${name}.png`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const hideDebug = () => page.addStyleTag({ content: '.lil-gui, div[style*="z-index: 10000"] { display:none !important }' });
const wait = (ms) => page.waitForTimeout(ms);

// ---- Himeji Castle
{
  const dir = `${root}screenshots/himeji-castle`;
  mkdirSync(dir, { recursive: true });
  const server = await serve('himeji-castle', 5292);
  await page.goto('http://localhost:5292/?debug');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('himeji-castle:settings:v1', JSON.stringify({ detail: 'ultra' })); });
  await page.reload();
  await wait(3500);
  await hideDebug();
  const set = (p) => page.evaluate((p) => window.valley.settings.set(p), p);
  const fly = (expr, dist) => page.evaluate(([e, d]) => { const v = window.valley; v.director.flyTo(new Function('v', `return ${e}`)(v), d); }, [expr, dist]);
  await set({ timeMode: 'fixed', fixedHour: 10.5, rain: 0, snow: 0, clouds: 1, wind: 1 });
  await page.mouse.move(720, 430);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 300);
  await wait(3000);
  await shoot(page, dir, '01-toan-canh');
  await set({ camera: 'castle' }); await wait(3500); await shoot(page, dir, '02-lau-dai');
  await set({ camera: 'overview' });
  await fly('v.valley.groves[1].center', 60); await wait(4000); await shoot(page, dir, '03-cong-vien-hoa');
  await fly('v.valley.village', 55); await wait(4000); await shoot(page, dir, '04-lang');
  await fly('v.layout.stationCenter', 45); await wait(4000); await shoot(page, dir, '05-nha-ga');
  await fly('v.valley.paddy', 40); await wait(4000); await shoot(page, dir, '06-ruong-lua');
  await set({ camera: 'train' }); await wait(4000); await shoot(page, dir, '07-tau');
  // Put the train on open track (away from tunnels) for the cab view.
  await page.evaluate(() => {
    const v = window.valley; const r = v.valley.rail;
    for (let i = 0; i < r.count; i++) {
      let open = true;
      for (let k = 0; k < 80; k++) if (r.tunnel[(i + k) % r.count]) open = false;
      if (open) { v.train.s = i; break; }
    }
  });
  await set({ camera: 'driver' }); await wait(3000); await shoot(page, dir, '08-lai-tau');
  await set({ camera: 'boat' }); await wait(3500); await shoot(page, dir, '09-cano');
  await set({ camera: 'bridges' }); await wait(3500); await shoot(page, dir, '10-cau');
  await set({ camera: 'castle', fixedHour: 18.1 }); await wait(5000); await shoot(page, dir, '11-hoang-hon');
  await set({ camera: 'overview', fixedHour: 21.5 });
  await fly('v.valley.village', 50); await wait(5000); await shoot(page, dir, '12-dem');
  await set({ fixedHour: 14, rain: 3, clouds: 4, camera: 'boat' }); await wait(9000); await shoot(page, dir, '13-mua');
  await set({ rain: 0, snow: 3, camera: 'castle' }); await wait(15000); await shoot(page, dir, '14-tuyet');
  // Four seasons, same view.
  await set({ rain: 0, snow: 0, fixedHour: 10.5, camera: 'castle' });
  for (const [i, season] of ['spring', 'summer', 'autumn', 'winter'].entries()) {
    await set({ season });
    await wait(season === 'winter' ? 8000 : 6000);
    await shoot(page, dir, `${15 + i}-mua-${{ spring: 'xuan', summer: 'ha', autumn: 'thu', winter: 'dong' }[season]}`);
  }
  server.kill();
}

// ---- Keepsakeland
{
  const dir = `${root}screenshots/keepsakeland`;
  mkdirSync(dir, { recursive: true });
  const server = await serve('keepsakeland', 5291);
  await page.goto('http://localhost:5291/?debug');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('keepsakeland:settings:v1', JSON.stringify({ detail: 'high' })); });
  await page.reload();
  await wait(3000);
  await hideDebug();
  const set = (p) => page.evaluate((p) => window.isles.settings.set(p), p);
  await set({ timeMode: 'fixed', fixedHour: 16.8, rain: 0, snow: 0, wind: 1 });
  await wait(3500);
  await shoot(page, dir, '01-gioi-thieu');
  await page.click('[data-action=start]');
  await wait(3500);
  await set({ fixedHour: 10 }); await wait(3000); await shoot(page, dir, '02-di-bo');
  await set({ view: 'second' }); await wait(1500); await shoot(page, dir, '03-goc-nhin-thu-hai');
  await set({ view: 'third' });
  await page.evaluate(() => {
    const { characters, game } = window.isles;
    const f = characters.find((c) => c.config.id === 'fisher');
    const t = characters[0];
    const dir = f.controller.position.clone().addScaledVector(f.controller.forward, -2.5).normalize();
    t.controller.spawn(dir, f.controller.forward);
    game.walk.reset(t.controller.position, f.controller.forward, 1);
    game.walk.pitch = 0.5;
  });
  await wait(5000); await shoot(page, dir, '04-ho-ong-cau-ca');
  await set({ fixedHour: 18.1 }); await wait(5000); await shoot(page, dir, '05-hoang-hon');
  await set({ fixedHour: 22 }); await wait(5000); await shoot(page, dir, '06-dem');
  await set({ fixedHour: 11, rain: 3, clouds: 4 }); await wait(9000); await shoot(page, dir, '07-mua');
  await set({ rain: 0, snow: 4 }); await wait(14000); await shoot(page, dir, '08-tuyet');
  await page.keyboard.press('Escape'); await set({ snow: 0, fixedHour: 17.5 }); await wait(5000); await shoot(page, dir, '09-hanh-tinh-hoang-hon');
  server.kill();
}

await browser.close();
