import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function isGreen(r: number, g: number, b: number, a: number) {
  if (a < 10) return true;
  return g > 150 && r < 120 && b < 120 && g - r > 70 && g - b > 70;
}

function isGreenFringe(r: number, g: number, b: number, a: number) {
  if (isGreen(r, g, b, a)) return true;
  const maxOther = Math.max(r, b);
  return g > 120 && g > maxOther * 1.25 && g - maxOther > 35;
}

async function createCleanFramePng(
  raw: Buffer,
  sourceWidth: number,
  box: { minX: number; maxX: number; minY: number; maxY: number }
) {
  const extractWidth = box.maxX - box.minX + 1;
  const extractHeight = box.maxY - box.minY + 1;
  const components = 4;
  const frame = Buffer.alloc(extractWidth * extractHeight * components);

  for (let y = 0; y < extractHeight; y++) {
    for (let x = 0; x < extractWidth; x++) {
      const srcIdx = ((box.minY + y) * sourceWidth + box.minX + x) * components;
      const destIdx = (y * extractWidth + x) * components;
      const r = raw[srcIdx];
      const g = raw[srcIdx + 1];
      const b = raw[srcIdx + 2];
      const a = raw[srcIdx + 3];

      if (isGreenFringe(r, g, b, a)) {
        frame[destIdx] = 0;
        frame[destIdx + 1] = 255;
        frame[destIdx + 2] = 0;
        frame[destIdx + 3] = 0;
      } else {
        frame[destIdx] = r;
        frame[destIdx + 1] = g;
        frame[destIdx + 2] = b;
        frame[destIdx + 3] = 255;
      }
    }
  }

  return sharp(frame, { raw: { width: extractWidth, height: extractHeight, channels: 4 } }).png().toBuffer();
}

async function safeRepack(inputBuffer: Buffer, frames: number, padding: number) {
  const image = sharp(inputBuffer).ensureAlpha();
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error('无法读取图片尺寸');
  if (frames < 1) throw new Error('frames 必须大于 0');

  const raw = await image.raw().toBuffer();
  const components = 4;
  const columnsWithContent: number[] = [];
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * components;
      if (!isGreen(raw[idx], raw[idx + 1], raw[idx + 2], raw[idx + 3])) count++;
    }
    if (count > 2) columnsWithContent.push(x);
  }

  const clusters: Array<{ start: number; end: number }> = [];
  for (const x of columnsWithContent) {
    const last = clusters[clusters.length - 1];
    if (!last || x - last.end > 8) clusters.push({ start: x, end: x });
    else last.end = x;
  }
  const usableClusters = clusters
    .filter((cluster) => cluster.end - cluster.start + 1 > 20)
    .sort((a, b) => a.start - b.start);
  if (usableClusters.length !== frames) {
    throw new Error(`检测到 ${usableClusters.length} 个角色区域，但期望 ${frames} 帧`);
  }

  const frameBoxes: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];

  for (let i = 0; i < frames; i++) {
    const startX = usableClusters[i].start;
    const endX = usableClusters[i].end;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = startX; x <= endX; x++) {
        const idx = (y * width + x) * components;
        const r = raw[idx];
        const g = raw[idx + 1];
        const b = raw[idx + 2];
        const a = raw[idx + 3];
        if (!isGreen(r, g, b, a)) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      throw new Error(`第 ${i + 1} 帧未检测到角色内容`);
    }
    frameBoxes.push({ minX, maxX, minY, maxY });
  }

  const contentWidth = Math.max(...frameBoxes.map((box) => box.maxX - box.minX + 1));
  const contentHeight = Math.max(...frameBoxes.map((box) => box.maxY - box.minY + 1));
  const frameWidth = contentWidth + padding * 2;
  const frameHeight = contentHeight + padding * 2;
  const outputWidth = frameWidth * frames;
  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < frames; i++) {
    const box = frameBoxes[i];
    const extractWidth = box.maxX - box.minX + 1;
    const extractHeight = box.maxY - box.minY + 1;
    const frameBuffer = await createCleanFramePng(raw, width, box);
    const left = i * frameWidth + Math.floor((frameWidth - extractWidth) / 2);
    const top = Math.floor((frameHeight - extractHeight) / 2);
    composites.push({ input: frameBuffer, left, top });
  }

  const buffer = await sharp({
    create: {
      width: outputWidth,
      height: frameHeight,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { buffer, frameWidth, frameHeight, boxes: frameBoxes };
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = args['input'];
  const outputPath = args['output'];
  const frames = parseInt(args['frames'], 10);
  const padding = parseInt(args['padding'] || '24', 10);

  if (!inputPath || !outputPath || !frames) {
    console.error(JSON.stringify({
      success: false,
      error: 'Usage: npx tsx scripts/repack-sprite-safe.ts --input <path> --output <path> --frames <n> [--padding 24]',
    }));
    process.exit(1);
  }

  const inputBuffer = await fs.readFile(inputPath);
  const { buffer, frameWidth, frameHeight, boxes } = await safeRepack(inputBuffer, frames, padding);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  console.log(JSON.stringify({ success: true, frameWidth, frameHeight, mode: 'safe-foreground-repack', padding, boxes }));
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
