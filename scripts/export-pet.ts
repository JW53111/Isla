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

  const transitions = actions
    .filter((a) => a.id !== 'idle')
    .map((a) => JSON.stringify(a.id))
    .join(', ');

  return `const DISPLAY_SCALE = 0.32;\nconst STAGE_WIDTH = ${Math.max(...actions.map((a) => a.frameWidth || 256))};\nconst STAGE_HEIGHT = ${Math.max(...actions.map((a) => a.frameHeight || 1024))};\n\nconst ACTIONS = {\n${entries}\n};\n\nconst IDLE_TRANSITIONS = [${transitions}];\n`;
}

function generateMainJs(actions: ActionDefinition[]): string {
  const menuItems = actions
    .map((a) => `    { id: ${JSON.stringify(a.id)}, label: ${JSON.stringify(a.name)} },`)
    .join('\n');

  return `const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: 200, height: 520,
    x: screenWidth - 350, y: 200,
    transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: false, resizable: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createContextMenu(currentActionId) {
  const actions = [
${menuItems}
  ];
  const menuItems2 = actions.map((a) => ({
    label: a.id === currentActionId ? '\\u2713 ' + a.label : a.label,
    click: () => { mainWindow?.webContents.send('switch-action', a.id); },
  }));
  menuItems2.push({ type: 'separator' }, { label: '\\u9000\\u51fa', click: () => { app.quit(); } });
  return Menu.buildFromTemplate(menuItems2);
}

ipcMain.on('show-context-menu', (_event, currentActionId) => {
  const menu = createContextMenu(currentActionId);
  menu.popup({ window: mainWindow });
});

ipcMain.on('resize-window', (_event, width, height) => {
  if (!mainWindow) return;
  const [wx, wy] = mainWindow.getPosition();
  const currentSize = mainWindow.getSize();
  const dw = width - currentSize[0];
  const dh = height - currentSize[1];
  mainWindow.setBounds({
    x: Math.round(wx - dw / 2), y: Math.round(wy - dh),
    width: Math.round(width), height: Math.round(height),
  });
});

ipcMain.on('move-window', (_event, dx, dy) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { app.quit(); });
`;
}

function generatePackageJson(appName: string, appId: string) {
  return {
    name: 'desk-toy-custom',
    version: '1.0.0',
    description: appName,
    main: 'main.js',
    scripts: { start: 'electron .' },
    build: {
      appId,
      productName: appName,
      directories: { output: 'dist' },
      files: ['main.js', 'preload.js', 'renderer/**/*', 'sprites/**/*', 'assets/icon.png', 'assets/icon.icns'],
      mac: { target: ['dmg'], icon: 'assets/icon.icns', category: 'public.app-category.entertainment' },
      win: { target: ['dir'], icon: 'assets/icon.png' },
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

async function generateIconAssets(referencePath: string, assetsDir: string) {
  const iconPngPath = path.join(assetsDir, 'icon.png');
  const iconsetDir = path.join(assetsDir, 'icon.iconset');
  const iconsetSizes = [16, 32, 64, 128, 256, 512, 1024];
  const cleanedReference = await removeGreenScreenForIcon(referencePath);

  await sharp(cleanedReference)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(iconPngPath);

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
    'preload.js',
    'package.json',
    'renderer/index.html',
    'renderer/style.css',
    'renderer/actions.js',
    'renderer/sprite-engine.js',
    'renderer/app.js',
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
  const spritesDir = path.join(sessionDir, 'sprites');
  const exportDir = path.join(sessionDir, 'export');

  const allActions: ActionDefinition[] = JSON.parse(await fs.readFile(actionsPath, 'utf-8'));
  const readyActions = allActions.filter((a) => a.spriteReady);

  if (readyActions.length === 0) {
    console.error(JSON.stringify({ success: false, error: '没有已完成的精灵图' }));
    process.exit(1);
  }

  await fs.rm(exportDir, { recursive: true, force: true });
  for (const sub of ['renderer', 'sprites', 'assets']) {
    await fs.mkdir(path.join(exportDir, sub), { recursive: true });
  }

  await fs.copyFile(path.join(projectRoot, 'preload.js'), path.join(exportDir, 'preload.js'));
  for (const f of ['index.html', 'style.css', 'sprite-engine.js', 'app.js']) {
    await copyIfExists(path.join(projectRoot, 'renderer', f), path.join(exportDir, 'renderer', f));
  }
  await generateIconAssets(referencePath, path.join(exportDir, 'assets'));

  for (const action of readyActions) {
    const src = path.join(spritesDir, `${action.id}.png`);
    await copyIfExists(src, path.join(exportDir, 'sprites', `${action.id}.png`));
  }

  await fs.writeFile(path.join(exportDir, 'renderer', 'actions.js'), generateActionsJs(readyActions));
  await fs.writeFile(path.join(exportDir, 'main.js'), generateMainJs(readyActions));
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
