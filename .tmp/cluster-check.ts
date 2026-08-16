import sharp from 'sharp';

const file = process.argv[2];
const frames = parseInt(process.argv[3] || '6', 10);

const img = sharp(file);
const meta = await img.metadata();
const width = meta.width || 0;
const height = meta.height || 0;
console.log(`尺寸: ${width}x${height}, 通道: ${meta.channels}`);

const raw = await img.raw().toBuffer();
const components = meta.channels || 4;
const ch = components; // raw() 按实际通道数

function isGreenAt(x: number, y: number): boolean {
  const i = (y * width + x) * ch;
  const r = raw[i];
  const g = raw[i + 1];
  const b = raw[i + 2];
  return g > 150 && r < 120 && b < 120 && g - r > 70 && g - b > 70;
}

// 逐列统计（镜像 repack 的 columnsWithContent: count > 2）
const columnsWithContent: number[] = [];
for (let x = 0; x < width; x++) {
  let count = 0;
  for (let y = 0; y < height; y++) {
    if (!isGreenAt(x, y)) count++;
  }
  if (count > 2) columnsWithContent.push(x);
}

const clusters: Array<{ start: number; end: number }> = [];
for (const x of columnsWithContent) {
  const last = clusters[clusters.length - 1];
  if (!last || x - last.end > 8) clusters.push({ start: x, end: x });
  else last.end = x;
}

console.log(`repack 聚类: ${clusters.length} 个区域（期望 ${frames}）`);
for (const [i, c] of clusters.entries()) {
  console.log(`  区域${i + 1}: x=${c.start}..${c.end} (宽 ${c.end - c.start + 1})`);
}

// 若有合并，打印边界处的非绿像素位置（判断是什么越过间隔带）
if (clusters.length !== frames) {
  console.log('--- 边界附近非绿像素（前 20 个） ---');
  const boundaries = clusters.slice(0, clusters.length - 1).map((c) => c.end);
  for (const bx of boundaries) {
    let printed = 0;
    for (let x = bx; x < Math.min(bx + 12, width) && printed < 20; x++) {
      for (let y = 0; y < height; y++) {
        if (!isGreenAt(x, y)) {
          console.log(`  x=${x} y=${y}`);
          printed++;
          if (printed >= 20) break;
        }
      }
      if (printed >= 20) break;
    }
  }
}
