import sharp from 'sharp';

const file = process.argv[2];
const img = sharp(file);
const meta = await img.metadata();
const w = meta.width || 0;
const h = meta.height || 0;
const ch = meta.channels || 0;
console.log(`尺寸: ${w}x${h}, 通道: ${ch}`);

const raw = await img.raw().toBuffer();
const stride = ch;

const points: Array<[number, number]> = [
  [10, 10],
  [Math.floor(w / 2), 10],
  [10, Math.floor(h / 2)],
  [Math.floor(w / 2), Math.floor(h / 2)],
  [Math.floor(w * 0.7), Math.floor(h * 0.8)],
  [Math.floor(w * 0.3), Math.floor(h * 0.9)],
];
for (const [x, y] of points) {
  const i = (y * w + x) * stride;
  const vals = Array.from({ length: stride }, (_, k) => raw[i + k]);
  console.log(`(${x},${y}) = [${vals.join(',')}]`);
}
