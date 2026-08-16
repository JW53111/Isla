import sharp from 'sharp';

const file = process.argv[2];
const frames = parseInt(process.argv[3] || '6', 10);

const img = sharp(file);
const meta = await img.metadata();
const { width = 0, height = 0 } = meta;
const ch = meta.channels || 4;
console.log(`尺寸: ${width}x${height}, 通道: ${ch}`);

const raw = await img.raw().toBuffer();
const stride = ch;
const frameW = Math.floor(width / frames);

// 与 repack-sprite-safe.ts 相同的绿色判定
function isGreenAt(x: number, y: number): boolean {
  const i = (y * width + x) * stride;
  const r = raw[i];
  const g = raw[i + 1];
  const b = raw[i + 2];
  return g > 150 && r < 120 && b < 120 && g - r > 70 && g - b > 70;
}

for (let f = 0; f < frames; f++) {
  let nonGreen = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = f * frameW; x < (f + 1) * frameW; x++) {
      if (!isGreenAt(x, y)) {
        nonGreen++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const touchesEdge = minX <= f * frameW + 2 || maxX >= (f + 1) * frameW - 3 || minY <= 2 || maxY >= height - 3;
  console.log(
    `帧${f + 1}: 非绿=${nonGreen} (${((nonGreen / (frameW * height)) * 100).toFixed(1)}%) ` +
    `bbox=(${minX},${minY})-(${maxX},${maxY}) ${bboxW}x${bboxH} ` +
    (touchesEdge ? '⚠️ 贴边/可能被裁' : '✓ 安全区完整')
  );
}

console.log('--- 间隔带检查 ---');
for (let f = 1; f < frames; f++) {
  const cx = f * frameW;
  let greenCount = 0, total = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = cx - 10; x < cx + 10; x++) {
      if (isGreenAt(x, y)) greenCount++;
      total++;
    }
  }
  console.log(`间隔${f}: 纯绿 ${((greenCount / total) * 100).toFixed(1)}%`);
}
