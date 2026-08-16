// Keyboard mode renderer (BongoCat-style standalone typing mirror)
// 独立窗口：画一个卡通键盘 + isla 坐在上面跟手打字。
// 键盘用 canvas 直接绘制，不需要额外精灵图；人物复用 typing/idle-buddy 精灵。
const api = window.electronAPI;
const petCanvas = document.getElementById('pet-canvas');
const kbCanvas = document.getElementById('kb-canvas');
const engine = new SpriteEngine(petCanvas);

// 键盘窗口里打字要跟手，单独调快 typing 帧率（不影响主窗口）
if (ACTIONS['typing']) ACTIONS['typing'].fps = 5;

let holdTimer = null;
const HOLD_MS = 1500; // 停止输入 1.5s 后回到待机

function playTyping() {
  if (!ACTIONS['typing']) return;
  engine.play('typing');
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (ACTIONS['idle-buddy']) engine.play('idle-buddy');
  }, HOLD_MS);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawKey(ctx, x, y, w, h, label) {
  ctx.fillStyle = '#f8f5ff';
  ctx.strokeStyle = '#d8cdf0';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6b5f8a';
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
}

function drawKeyboard() {
  const ctx = kbCanvas.getContext('2d');
  const W = 480, H = 180;
  ctx.clearRect(0, 0, W, H);

  // 底板
  ctx.fillStyle = 'rgba(46, 38, 74, 0.88)';
  roundRectPath(ctx, 6, 4, W - 12, H - 8, 16);
  ctx.fill();

  const rows = [
    { y: 12, keys: ['Esc', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Bksp'] },
    { y: 46, keys: ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'] },
    { y: 80, keys: ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'] },
    { y: 114, keys: ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'] },
  ];
  for (const row of rows) {
    const gap = 5;
    const keyW = (W - 36 - gap * (row.keys.length - 1)) / row.keys.length;
    row.keys.forEach((label, i) => {
      drawKey(ctx, 18 + i * (keyW + gap), row.y, keyW, 28, label);
    });
  }
  // 空格键
  drawKey(ctx, (W - 220) / 2, 148, 220, 28, '');
}

function init() {
  drawKeyboard();

  const petW = 140;
  const petH = Math.round((petW * STAGE_HEIGHT) / STAGE_WIDTH);
  engine.setDisplaySize(petW, petH);
  if (ACTIONS['idle-buddy']) engine.play('idle-buddy');

  if (api) {
    api.onInputEvent((ev) => {
      if (ev.type === 'keydown') playTyping();
    });
  }

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(t - last, 100);
    last = t;
    engine.update(dt);
    engine.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

init();
