import fs from 'fs/promises';
import path from 'path';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {
    console.error(JSON.stringify({ success: false, error: '找不到 .env 文件，请先复制 .env.example 为 .env 并填入 IMAGE_API_KEY' }));
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const promptFile = args['prompt-file'];
  const outputPath = args['output'];
  const referenceImage = args['reference-image'];

  if (!promptFile || !outputPath) {
    console.error(JSON.stringify({
      success: false,
      error: 'Usage: npx tsx scripts/generate-sprite.ts --prompt-file <path> --output <path> [--reference-image <path>]',
    }));
    process.exit(1);
  }

  const baseUrl = (process.env.IMAGE_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = process.env.IMAGE_API_KEY || '';
  const model = process.env.IMAGE_MODEL || 'gpt-image-1';
  const size = process.env.IMAGE_SIZE || '1536x1024';
  const quality = process.env.IMAGE_QUALITY || 'high';
  const n = parseInt(process.env.IMAGE_N || '1', 10);

  if (!apiKey || apiKey.startsWith('请把') || apiKey === 'YOUR_API_KEY_HERE') {
    console.error(JSON.stringify({ success: false, error: '请在 .env 中配置 IMAGE_API_KEY' }));
    process.exit(1);
  }

  const prompt = await fs.readFile(promptFile, 'utf-8');

  let res: Response;
  if (referenceImage) {
    const imageBuffer = await fs.readFile(referenceImage);
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('n', String(n));
    form.append('image', new Blob([imageBuffer], { type: 'image/png' }), path.basename(referenceImage));

    res = await fetch(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    const body: Record<string, unknown> = { model, prompt, size, quality, n };
    res = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(JSON.stringify({ success: false, error: `Image API error ${res.status}: ${text}` }));
    process.exit(1);
  }

  const data = await res.json();
  const item = data.data?.[0];

  let buffer: Buffer;
  if (item?.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item?.url) {
    const imgRes = await fetch(item.url);
    buffer = Buffer.from(await imgRes.arrayBuffer());
  } else {
    console.error(JSON.stringify({ success: false, error: 'No image data in response' }));
    process.exit(1);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);

  console.log(JSON.stringify({ success: true, path: outputPath, bytes: buffer.length, model, size }));
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
