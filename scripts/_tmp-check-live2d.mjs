import fs from 'fs';
import path from 'path';
import vm from 'vm';
import sharp from 'sharp';

const root = process.cwd();
const engineSrc = fs.readFileSync(path.join(root, 'renderer', 'sprite-engine.js'), 'utf8');
const dir = path.join(root, 'output', 'isla-20260815-120437', 'sprites');
const actionsJson = JSON.parse(fs.readFileSync(path.join(root, 'output', 'isla-20260815-120437', 'actions.json'), 'utf8'));
const list = Array.isArray(actionsJson) ? actionsJson : actionsJson.actions;

const actions = {};
for (const a of list) actions[a.id] = a;

for (const id of Object.keys(actions)) {
  const png = path.join(dir, id + '.png');
  if (!fs.existsSync(png)) { console.log(id, ': (no sprite)'); continue; }
  const raw = await sharp(png).ensureAlpha().raw().toBuffer();
  // 复刻 removeGreenScreen：绿幕像素 alpha 置 0（真实运行时先绿幕后算质心）
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i], g = raw[i + 1], b = raw[i + 2];
    if (g > 200 && r < 80 && b < 80) raw[i + 3] = 0;
    else if (g > 150 && r < 120 && b < 120 && g > r * 1.5 && g > b * 1.5) raw[i + 3] = Math.round(255 * (1 - (g - Math.max(r, b)) / g));
  }
  const meta = await sharp(png).metadata();
  const fakeCanvas = {
    width: meta.width,
    height: meta.height,
    getContext: () => ({
      getImageData: () => ({ data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength) }),
    }),
  };
  const sandbox = { ACTIONS: actions, console, Uint8Array, Uint8ClampedArray, Math };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox);
  const pairs = sandbox.detectEyePairs(fakeCanvas, id);
  const hits = pairs.map((p, i) => (p ? `${i}` : '')).filter(Boolean).join(',') || '(none)';
  const anchors = sandbox.computeFrameAnchors(fakeCanvas, id);
  const fw = actions[id].frameWidth;
  const aStr = anchors.map((a) => (a == null ? '-' : (a / fw).toFixed(2))).join(' ');
  const spread = Math.max(...anchors.filter((a) => a != null)) - Math.min(...anchors.filter((a) => a != null));
  console.log(`${id.padEnd(15)} eyes:[${hits}]  anchor/fw:[${aStr}]  spread=${spread.toFixed(1)}px`);
}
