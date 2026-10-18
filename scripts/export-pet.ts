import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface ActionDefinition {
  id: string;
  name: string;
  frames: number;
  fps: number;
  description: string;
  prompt: string | null;
  spriteReady: boolean;
  frameWidth: number | null;
  frameHeight: number | null;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--build') {
      args['build'] = 'true';
    } else if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function generateActionsJs(actions: ActionDefinition[]): string {
  const entries = actions
    .map(
      (a) => `  ${JSON.stringify(a.id)}: {
    id: ${JSON.stringify(a.id)},
    name: ${JSON.stringify(a.name)},
    frames: ${a.frames},
    fps: ${a.fps},
    frameWidth: ${a.frameWidth || 256},
    frameHeight: ${a.frameHeight || 1024},
    loop: true,
    nextAction: null,
  }`
    )
    .join(',\n');

  // 语义动作（typing=键盘镜像、sleep=双击/自动睡觉、poke-react=戳一戳/点击反应、sulk=被戳随机/长时间不理）
  // 不参与单击循环切换：它们各有专属触发方式，混进循环里会让用户困惑
  const SEMANTIC_ACTIONS = ['idle', 'typing', 'sleep', 'poke-react', 'sulk'];

  return `// DISPLAY_SCALE is only a fallback for environments without the Electron
// main process (e.g. plain browser preview). In the real app the pet auto-fits
// the screen height and this constant is ignored.
const DISPLAY_SCALE = 0.32;
const STAGE_WIDTH = ${Math.max(...actions.map((a) => a.frameWidth || 256))};
const STAGE_HEIGHT = ${Math.max(...actions.map((a) => a.frameHeight || 1024))};

const ACTIONS = {
${entries}
};

const SEMANTIC_ACTIONS = ${JSON.stringify(SEMANTIC_ACTIONS)};
`;
}

async function generateMainJs(actions: ActionDefinition[], persona: unknown, appName: string, templatePath: string): Promise<string> {
  const stageWidth = Math.max(...actions.map((a) => a.frameWidth || 256));
  const stageHeight = Math.max(...actions.map((a) => a.frameHeight || 1024));
  const menuItems = actions.filter((a) => a.id !== 'typing').map((a) => ({ id: a.id, label: a.name }));
  const personaName = persona && typeof persona === 'object' && 'name' in persona
    ? String((persona as { name?: unknown }).name || appName)
    : appName;
  const template = await fs.readFile(templatePath, 'utf8');
  return template
    .replace('__APP_NAME__', JSON.stringify(appName))
    .replace('__STAGE_WIDTH__', String(stageWidth))
    .replace('__STAGE_HEIGHT__', String(stageHeight))
    .replace('__HAS_ACTION__', JSON.stringify(Object.fromEntries(actions.map((a) => [a.id, true]))))
    .replace('__DEFAULT_PERSONA__', JSON.stringify({ name: personaName }))
    .replace('__ACTION_MENU_ITEMS__', JSON.stringify(menuItems, null, 2));
}
function generatePackageJson(appName: string, appId: string) {
  return {
    name: 'desk-toy-custom',
    version: '1.0.0',
    description: appName,
    main: 'main.js',
    scripts: { start: 'electron .' },
    dependencies: {
      // N-API prebuilds — both load fine under Electron 28 (Node 18.18) without
      // rebuild, so @electron/rebuild is skipped entirely (it would try node-gyp
      // and fail on machines without Visual Studio).
      'uiohook-napi': '^1.5.5',
    },
    build: {
      appId,
      productName: appName,
      directories: { output: 'dist' },
      files: ['main.js', 'runtime.js', 'preload.js', 'renderer/**/*', 'sprites/**/*', 'assets/icon.png', 'assets/icon.ico', 'assets/icon.icns'],
      asarUnpack: ['node_modules/uiohook-napi/**'],
      npmRebuild: false,
      mac: { target: ['dmg'], icon: 'assets/icon.icns', category: 'public.app-category.entertainment' },
      // signAndEditExecutable: false — 两种写 exe 图标的路径都不可行：
      // 1) 开启它时 winCodeSign 解压在无符号链接权限的 Windows 上必失败（darwin .dylib 软链）
      // 2) 手动 rcedit（2019 版）处理不了 Electron 大 exe，会把 176MB 文件写坏成 3.4GB
      // 托盘图标来自 assets/icon.png 不受影响；assets/icon.ico 保留给桌面快捷方式图标用。
      win: { target: ['dir'], icon: 'assets/icon.ico', signAndEditExecutable: false },
    },
    author: 'DeskToy',
    devDependencies: { electron: '28.3.3', 'electron-builder': '^25.0.0' },
  };
}

async function copyIfExists(src: string, dest: string) {
  try {
    await fs.copyFile(src, dest);
  } catch {}
}

async function removeGreenScreenForIcon(referencePath: string) {
  const image = sharp(referencePath).ensureAlpha();
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error('无法读取 reference.png 尺寸');

  const raw = await image.raw().toBuffer();
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const maxOther = Math.max(r, b);
    const isGreen = g > 140 && g > maxOther * 1.25 && g - maxOther > 35;
    if (isGreen) {
      raw[i] = 0;
      raw[i + 1] = 255;
      raw[i + 2] = 0;
      raw[i + 3] = 0;
    }
  }

  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// ICO 容器（内嵌 PNG，Vista+ 支持）：exe 文件图标写入需要 .ico
async function generateIco(iconPngPath: string): Promise<Buffer> {
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs: Buffer[] = [];
  for (const size of sizes) {
    pngs.push(await sharp(iconPngPath).resize(size, size).png().toBuffer());
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const parts: Buffer[] = [header];
  for (let i = 0; i < sizes.length; i++) {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // 宽（0 = 256）
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1); // 高
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    parts.push(e, pngs[i]);
    offset += pngs[i].length;
  }
  return Buffer.concat(parts);
}

async function generateIconAssets(referencePath: string, assetsDir: string) {
  const iconPngPath = path.join(assetsDir, 'icon.png');
  const iconsetDir = path.join(assetsDir, 'icon.iconset');
  const iconsetSizes = [16, 32, 64, 128, 256, 512, 1024];
  const cleanedReference = await removeGreenScreenForIcon(referencePath);

  await sharp(cleanedReference)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(iconPngPath);

  // exe 文件图标（Windows）：同源 PNG 转多尺寸 ICO
  await fs.writeFile(path.join(assetsDir, 'icon.ico'), await generateIco(iconPngPath));

  try {
    await fs.mkdir(iconsetDir, { recursive: true });
    for (const size of iconsetSizes) {
      const buffer = await sharp(iconPngPath).resize(size, size).png().toBuffer();
      await fs.writeFile(path.join(iconsetDir, `icon_${size}x${size}.png`), buffer);
      if (size <= 512) {
        await fs.writeFile(path.join(iconsetDir, `icon_${size}x${size}@2x.png`), await sharp(iconPngPath).resize(size * 2, size * 2).png().toBuffer());
      }
    }
    await execFileAsync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(assetsDir, 'icon.icns')]);
    await fs.rm(iconsetDir, { recursive: true, force: true });
  } catch {
    await copyIfExists(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'assets', 'icon.icns'), path.join(assetsDir, 'icon.icns'));
  }
}

async function assertRequiredFiles(exportDir: string, actionIds: string[]) {
  const requiredFiles = [
    'main.js',
    'runtime.js',
    'preload.js',
    'package.json',
    'renderer/index.html',
    'renderer/style.css',
    'renderer/actions.js',
    'renderer/sprite-engine.js',
    'renderer/app.js',
    'renderer/chat.html',
    'renderer/chat.css',
    'renderer/chat.js',
    ...actionIds.map((id) => `sprites/${id}.png`),
  ];

  const missing = [];
  for (const file of requiredFiles) {
    try {
      await fs.access(path.join(exportDir, file));
    } catch {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    throw new Error(`导出缺少必要文件：${missing.join(', ')}`);
  }
}

async function warnIfMacBuildIsUnsigned(exportDir: string, appName: string) {
  const appPath = path.join(exportDir, 'dist', 'mac', `${appName}.app`);
  try {
    await fs.access(appPath);
  } catch {
    return null;
  }

  try {
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', appPath]);
    return null;
  } catch {
    return [
      `macOS 应用未签名：${appPath}`,
      '这类 DMG/APP 在本机可能能打开，但发给别人时常会被 Gatekeeper 拦截，表现为“打不开”或“已损坏”。',
      '解决方式：用 Apple Developer 证书签名并公证；仅自己测试时，可在系统设置 > 隐私与安全中允许打开，或手动移除隔离属性。',
    ].join('\n');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const sessionDir = args['session-dir'];
  const appName = args['app-name'] || '我的桌宠';
  const appId = args['app-id'] || 'com.desktoy.custom';
  const platform = args['platform'] || 'mac';
  const shouldBuild = args['build'] === 'true';

  if (!sessionDir) {
    console.error(JSON.stringify({
      success: false,
      error: 'Usage: npx tsx scripts/export-pet.ts --session-dir <path> [--app-name <name>] [--app-id <id>] [--platform mac|win|all] [--build]',
    }));
    process.exit(1);
  }

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const actionsPath = path.join(sessionDir, 'actions.json');
  const referencePath = path.join(sessionDir, 'reference.png');
  const characterPath = path.join(sessionDir, 'character.json');
  const spritesDir = path.join(sessionDir, 'sprites');
  const exportDir = path.join(sessionDir, 'export');

  const allActions: ActionDefinition[] = JSON.parse(await fs.readFile(actionsPath, 'utf-8'));
  const readyActions = allActions.filter((a) => a.spriteReady);

  // Persona for the AI chat system prompt (baked from character.json, no secrets)
  let persona: unknown = { name: appName };
  try {
    persona = JSON.parse(await fs.readFile(characterPath, 'utf-8'));
  } catch {
    persona = { name: appName };
  }

  if (readyActions.length === 0) {
    console.error(JSON.stringify({ success: false, error: '没有已完成的精灵图' }));
    process.exit(1);
  }

  try {
    await fs.rm(exportDir, { recursive: true, force: true });
  } catch {
    // Windows: another process (杀软扫描/残留 CWD) may hold a handle on the dir
    // object itself even though its contents are free — clear contents best-effort
    // and reuse the directory instead of failing the whole export.
    const entries = await fs.readdir(exportDir, { withFileTypes: true });
    await Promise.allSettled(
      entries.map((e) => fs.rm(path.join(exportDir, e.name), { recursive: true, force: true }))
    );
  }
  for (const sub of ['renderer', 'sprites', 'assets']) {
    await fs.mkdir(path.join(exportDir, sub), { recursive: true });
  }

  await fs.copyFile(path.join(projectRoot, 'preload.js'), path.join(exportDir, 'preload.js'));
  await fs.copyFile(path.join(projectRoot, 'runtime.js'), path.join(exportDir, 'runtime.js'));
  for (const f of ['index.html', 'style.css', 'sprite-engine.js', 'app.js', 'chat.html', 'chat.css', 'chat.js']) {
    await copyIfExists(path.join(projectRoot, 'renderer', f), path.join(exportDir, 'renderer', f));
  }
  await generateIconAssets(referencePath, path.join(exportDir, 'assets'));

  for (const action of readyActions) {
    const src = path.join(spritesDir, `${action.id}.png`);
    await copyIfExists(src, path.join(exportDir, 'sprites', `${action.id}.png`));
  }

  await fs.writeFile(path.join(exportDir, 'renderer', 'actions.js'), generateActionsJs(readyActions));
  await fs.writeFile(path.join(exportDir, 'main.js'), await generateMainJs(readyActions, persona, appName, path.join(projectRoot, 'templates', 'main.js')));
  await fs.writeFile(path.join(exportDir, 'package.json'), JSON.stringify(generatePackageJson(appName, appId), null, 2));
  await assertRequiredFiles(exportDir, readyActions.map((action) => action.id));

  console.log(JSON.stringify({ success: true, exportDir, actions: readyActions.length }));

  if (shouldBuild) {
    const target = platform === 'win' ? '--win' : platform === 'all' ? '--mac --win' : '--mac';
    console.error(`Installing dependencies...`);
    await execAsync('npm install', { cwd: exportDir });
    console.error(`Building with electron-builder ${target}...`);
    const { stdout } = await execAsync(`npx electron-builder ${target}`, { cwd: exportDir, timeout: 300000 });
    const macSigningWarning = target.includes('--mac') ? await warnIfMacBuildIsUnsigned(exportDir, appName) : null;
    if (macSigningWarning) {
      console.error(macSigningWarning);
    }
    console.log(JSON.stringify({ success: true, built: true, stdout: stdout.slice(-500), macSigningWarning }));
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
