// Sprite animation engine
// Handles frame-based animation from horizontal sprite sheets

class SpriteEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.currentAction = null;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.isPlaying = false;
    this.spriteImage = null;
    this.displayWidth = 256;
    this.displayHeight = 1024;
    this.sizedExternally = false;

    // Callbacks
    this.onFrameChange = null;
    this.onComplete = null;

    // Eye tracking (gaze): eye positions detected per frame on sprite load,
    // pupils drawn on top of the painted eyes and shifted toward the cursor
    this.eyeFrames = null;      // { actionId, frames: [null | {lx,ly,rx,ry,size}] }
    this.gaze = { x: 0, y: 0 }; // smoothed gaze offset, normalized -1..1
    this.gazeTarget = { x: 0, y: 0 };

    // Live2D 化动态：随机眨眼 / 头部微动跟随 / 重心稳定（帧切换一律硬切，不叠旧帧）
    this.blinkAt = 2000 + Math.random() * 4000; // 下次眨眼倒计时（间隔 3~7s）
    this.blinkT = -1;                            // -1=不在眨眼，0~130ms 为一次眨眼
    this.headFollow = { x: 0, y: 0 };            // 头部缓慢跟随注视方向（300ms）
    this.frameAnchors = null;                    // 每帧上身 x 质心（重心稳定用）
    this.anchorX = 0;                            // 平滑后的质心（精灵像素坐标）
    this.loadedActionId = null;                  // 已加载精灵所属动作（切换瞬间不画错帧）
    this.gazeAlpha = 1;                          // 瞳孔透明度（眼睛出现/消失帧间渐隐渐显）

    // Placeholder rendering (while waiting for real sprite sheets)
    this.usePlaceholder = true;
  }

  // Set display size from outside (app.js computes auto-fit scale)
  // Once set externally, configureCanvas() becomes a no-op
  setDisplaySize(w, h) {
    this.displayWidth = w;
    this.displayHeight = h;
    this.sizedExternally = true;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  // Load a sprite sheet image and remove green screen
  async loadSprite(actionId, imagePath) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const action = this.currentAction;
        if (action && action.id === actionId) {
          action.frameWidth = Math.round(img.width / action.frames);
          action.frameHeight = img.height;
          this.configureCanvas();
        }
        this.spriteImage = this.removeGreenScreen(img);
        this.usePlaceholder = false;
        // 眼神跟随：检测每帧红瞳位置（闭眼/侧脸帧检测不到 -> 不画瞳孔，天然眨眼）
        this.eyeFrames = { actionId: actionId, frames: detectEyePairs(this.spriteImage, actionId) };
        // 重心稳定：每帧上身 x 质心，帧间平滑对齐（治帧间左右弹跳）
        this.frameAnchors = computeFrameAnchors(this.spriteImage, actionId);
        this.anchorX = this.frameAnchors.length ? this.frameAnchors[0] : 0;
        this.loadedActionId = actionId;
        resolve(this.spriteImage);
      };
      img.onerror = () => {
        this.usePlaceholder = true;
        resolve(null);
      };
      img.src = imagePath;
    });
  }

  // Remove #00ff00 green screen pixels (make transparent)
  removeGreenScreen(img) {
    const offscreen = document.createElement('canvas');
    offscreen.width = img.width;
    offscreen.height = img.height;
    const octx = offscreen.getContext('2d');
    octx.drawImage(img, 0, 0);
    const imageData = octx.getImageData(0, 0, img.width, img.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (g > 200 && r < 80 && b < 80) {
        d[i + 3] = 0;
      } else if (g > 150 && r < 120 && b < 120 && g > r * 1.5 && g > b * 1.5) {
        const greenness = (g - Math.max(r, b)) / g;
        d[i + 3] = Math.round(255 * (1 - greenness));
      }
    }
    octx.putImageData(imageData, 0, 0);
    return offscreen;
  }

  configureCanvas() {
    // Fallback sizing only (no electronAPI / app.js did not inject a size).
    // Window resizing is triggered by app.js via resizeWindow — not here.
    if (this.sizedExternally) return;
    const scale = typeof DISPLAY_SCALE !== 'undefined' ? DISPLAY_SCALE : 1;
    const stageWidth = typeof STAGE_WIDTH !== 'undefined' ? STAGE_WIDTH : (this.currentAction?.frameWidth || 256);
    const stageHeight = typeof STAGE_HEIGHT !== 'undefined' ? STAGE_HEIGHT : (this.currentAction?.frameHeight || 1024);
    this.setDisplaySize(Math.round(stageWidth * scale), Math.round(stageHeight * scale));
  }

  // Start playing an action
  play(actionId) {
    const action = ACTIONS[actionId];
    if (!action) {
      console.warn(`Unknown action: ${actionId}`);
      return;
    }

    this.currentAction = action;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.isPlaying = true;
    // 动作切换：所有帧切换一律硬切不叠旧帧（实测：任何叠旧帧的淡入都会重影闪，
    // 硬切虽僵硬但不闪）；新精灵未加载前不启用重心稳定（旧 anchors 是新坐标，不能混用）
    this.frameAnchors = null;
    this.anchorX = 0;

    // Try to load the sprite sheet
    const imagePath = `../sprites/${actionId}.png`;
    this.loadSprite(actionId, imagePath);

    this.configureCanvas();
  }

  // Update animation (call each frame with delta time in ms)
  update(dt) {
    if (!this.isPlaying || !this.currentAction) return;

    // 注视平滑：眼神约 80ms 跟上目标方向，不是瞬移
    const k = Math.min(1, dt / 80);
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * k;
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * k;

    // 瞳孔渐隐渐显：换向帧眼睛出现/消失时瞳孔 80ms 淡入淡出，不突然弹出
    const hasEyes = !!(
      this.eyeFrames &&
      this.eyeFrames.actionId === this.currentAction.id &&
      this.eyeFrames.frames[this.currentFrame]
    );
    const kg = Math.min(1, dt / 80);
    this.gazeAlpha += ((hasEyes ? 1 : 0) - this.gazeAlpha) * kg;

    // 头部微动跟随（300ms）：眼睛带路、身体慢一步跟上，站直不倾斜
    const kh = Math.min(1, dt / 300);
    this.headFollow.x += (this.gaze.x - this.headFollow.x) * kh;
    this.headFollow.y += (this.gaze.y - this.headFollow.y) * kh;

    // 随机眨眼：3~7s 一次，一次 130ms（闭 40ms / 保持 50ms / 睁 40ms）
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT >= 130) this.blinkT = -1;
    } else {
      this.blinkAt -= dt;
      if (this.blinkAt <= 0) {
        this.blinkT = 0;
        this.blinkAt = 3000 + Math.random() * 4000;
      }
    }

    // 重心稳定：平滑跟随当前帧上身质心（150ms），渲染时按差值补横移
    if (this.frameAnchors && this.frameAnchors.length) {
      const target = this.frameAnchors[this.currentFrame];
      if (target != null) {
        const ka = Math.min(1, dt / 150);
        this.anchorX += (target - this.anchorX) * ka;
      }
    }

    const action = this.currentAction;
    // 全局放慢 1.5 倍：默认 2fps 动作节奏过快，看着烦躁
    const frameDuration = (1000 / action.fps) * 1.5;
    this.frameTimer += dt;

    if (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.advanceFrame();
    }
  }

  // Advance to next frame
  advanceFrame() {
    const action = this.currentAction;
    const prevFrame = this.currentFrame;
    // 帧切换直接硬切（叠旧帧的淡入会产生重影闪烁，硬切观感最干净）

    if (this.currentFrame < action.frames - 1) {
      this.currentFrame++;
    } else {
      // Reached end of animation
      if (action.loop) {
        this.currentFrame = 0;
      } else {
        this.isPlaying = false;
        if (this.onComplete) {
          this.onComplete(action);
        }
        return;
      }
    }

    if (this.onFrameChange && prevFrame !== this.currentFrame) {
      this.onFrameChange(this.currentFrame);
    }
  }

  // Render current frame
  render() {
    const ctx = this.ctx;
    const action = this.currentAction;
    if (!action) return;

    // Clear canvas
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.usePlaceholder || !this.spriteImage) {
      this.renderPlaceholder(ctx, action);
    } else {
      this.renderSprite(ctx, action);
    }
  }

  renderSprite(ctx, action) {
    // 新动作精灵未加载完成时不画（避免用旧精灵按新帧宽切出错帧闪现）
    if (this.loadedActionId !== action.id) return;
    const sx = this.currentFrame * action.frameWidth;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.displayWidth, this.displayHeight);
    ctx.clip();
    const stageWidth = typeof STAGE_WIDTH !== 'undefined' ? STAGE_WIDTH : action.frameWidth;
    const stageHeight = typeof STAGE_HEIGHT !== 'undefined' ? STAGE_HEIGHT : action.frameHeight;
    const scale = Math.min(this.displayWidth / stageWidth, this.displayHeight / stageHeight);
    const dw = Math.round(action.frameWidth * scale);
    const dh = Math.round(action.frameHeight * scale);
    let dx = Math.round((this.displayWidth - dw) / 2);
    const dy = Math.round(this.displayHeight - dh);
    // 重心稳定：帧间上身质心平滑对齐（横向补差，底对齐不动、脚不滑）
    if (this.frameAnchors && this.frameAnchors.length) {
      const cur = this.frameAnchors[this.currentFrame];
      if (cur != null) dx += Math.round((this.anchorX - cur) * scale);
    }
    // 头部微动跟随：眼睛带路，身体 1~2px 缓慢朝鼠标方向挪（不倾斜、站直）
    dx += Math.round(this.headFollow.x * 2 * scale);
    // 记录本次绘制几何（app.js 天气气泡等需要锚定头部位置）
    const eye = this.eyeFrames && this.eyeFrames.actionId === action.id ? this.eyeFrames.frames[this.currentFrame] : null;
    this.drawInfo = {
      dx, dy, scale,
      cx: dx + (action.frameWidth / 2) * scale,
      eyeY: eye ? eye.ly : null,
    };
    ctx.drawImage(
      this.spriteImage,
      sx, 0,
      action.frameWidth, action.frameHeight,
      dx, dy,
      dw, dh
    );
    ctx.restore();

    // 眼神跟随：在画的眼珠上叠一层瞳孔，随鼠标方向偏移；眨眼时画闭眼线
    this.renderGaze(ctx, action, dx, dy, scale);
  }

  // 设置注视目标方向（归一化 -1..1，原点为窗口中心）
  setGazeTarget(nx, ny) {
    this.gazeTarget.x = nx;
    this.gazeTarget.y = ny;
  }

  // 在当前帧的眼睛位置画瞳孔；无检测数据（闭眼/背身帧）时什么都不画
  renderGaze(ctx, action, dx, dy, scale) {
    if (!this.eyeFrames || this.eyeFrames.actionId !== action.id) return;
    const eye = this.eyeFrames.frames[this.currentFrame];
    if (!eye) return;
    // 眨眼期间画闭眼线，不画瞳孔
    if (this.blinkT >= 0) {
      this.renderBlink(ctx, eye, dx, dy, scale);
      return;
    }
    // 瞳孔半径约为眼睛大小的 30%，偏移上限 20%（不跑出虹膜）
    const r = Math.min(6, Math.max(2.5, eye.size * 0.3)) * scale;
    const maxShift = Math.min(4.5, Math.max(2, eye.size * 0.2));
    const ox = this.gaze.x * maxShift * scale;
    const oy = this.gaze.y * maxShift * scale;
    ctx.save();
    ctx.globalAlpha = Math.max(0.001, this.gazeAlpha);
    ctx.fillStyle = 'rgba(22, 16, 18, 0.98)';
    const eyes = [[eye.lx, eye.ly], [eye.rx, eye.ry]];
    for (let i = 0; i < eyes.length; i++) {
      ctx.beginPath();
      ctx.arc(dx + eyes[i][0] * scale + ox, dy + eyes[i][1] * scale + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 瞳孔上的小高光，让眼神有神
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    const hr = Math.max(0.8, r * 0.28);
    for (let i = 0; i < eyes.length; i++) {
      ctx.beginPath();
      ctx.arc(
        dx + eyes[i][0] * scale + ox - r * 0.35,
        dy + eyes[i][1] * scale + oy - r * 0.35,
        hr, 0, Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  // 随机眨眼：在检测到的眼睛位置画向下微弧的闭眼线，
  // α 按三阶段变化（闭 40ms 渐显 / 保持 50ms / 睁 40ms 渐隐）
  renderBlink(ctx, eye, dx, dy, scale) {
    const phase = this.blinkT;
    const alpha = phase < 40 ? phase / 40 : phase < 90 ? 1 : Math.max(0, 1 - (phase - 90) / 40);
    if (alpha <= 0) return;
    const ew = Math.max(6, eye.size * 1.5) * scale;   // 眼宽约 size*1.5
    const r = Math.max(2.5, eye.size * 0.3) * scale;  // 弧线垂度参考瞳孔半径
    ctx.save();
    ctx.strokeStyle = `rgba(22, 16, 18, ${(0.9 * alpha).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, r * 0.4);
    ctx.lineCap = 'round';
    for (const [ex, ey] of [[eye.lx, eye.ly], [eye.rx, eye.ry]]) {
      const x = dx + ex * scale;
      const y = dy + ey * scale;
      ctx.beginPath();
      ctx.moveTo(x - ew / 2, y);
      ctx.quadraticCurveTo(x, y + r * 0.5, x + ew / 2, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Render placeholder character when no sprite sheet exists
  renderPlaceholder(ctx, action) {
    const w = action.frameWidth;
    const h = action.frameHeight;
    const cx = w / 2;
    const cy = h / 2;

    // Simple stick figure / character placeholder
    ctx.save();

    // Head
    const headRadius = Math.min(w, h) * 0.18;
    ctx.fillStyle = '#FFE4C4';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy - headRadius * 0.8, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Hair (simple arc)
    ctx.fillStyle = '#4A3728';
    ctx.beginPath();
    ctx.arc(cx, cy - headRadius * 0.9, headRadius + 2, Math.PI, Math.PI * 2);
    ctx.fill();

    // Eyes
    const eyeY = cy - headRadius * 0.85;
    const eyeSpacing = headRadius * 0.35;

    // Blinking logic based on current frame
    const blinkFrames = action.id === 'idle' ? [2, 5] :
                         action.id === 'blocked' ? [2, 4] :
                         action.id === 'loading' ? [1, 4] :
                         action.id === 'peek' ? [6] :
                         action.id === 'supervise' ? [4] :
                         action.id === 'nod' ? [1, 3] : [];

    const isBlinking = blinkFrames.includes(this.currentFrame);

    if (isBlinking) {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - eyeSpacing - 5, eyeY);
      ctx.lineTo(cx - eyeSpacing + 5, eyeY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + eyeSpacing - 5, eyeY);
      ctx.lineTo(cx + eyeSpacing + 5, eyeY);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing, eyeY, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + eyeSpacing, eyeY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mouth
    const mouthY = cy - headRadius * 0.45;
    if (action.id === 'celebrate') {
      // Big smile
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, mouthY + 5, 6, 0, Math.PI);
      ctx.stroke();
    } else if (action.id === 'blocked') {
      // Frustrated mouth
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, mouthY + 8, 5, Math.PI, 0);
      ctx.stroke();
    } else {
      // Normal mouth
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cx, mouthY, 4, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    }

    // Body
    const bodyTop = cy - headRadius * 0.3;
    const bodyHeight = h * 0.35;
    ctx.fillStyle = '#5B7DB1';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2.5;
    // Rounded rectangle body
    const bw = w * 0.3;
    const bh = bodyHeight;
    const bx = cx - bw / 2;
    const by = bodyTop;
    ctx.beginPath();
    this.roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();

    // Arms (simple lines with circles for hands)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bx - 4, by + bh * 0.2);
    ctx.lineTo(bx - 14, by + bh * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx + bw + 4, by + bh * 0.2);
    ctx.lineTo(bx + bw + 14, by + bh * 0.6);
    ctx.stroke();

    // Hand circles
    ctx.fillStyle = '#FFE4C4';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    [bx - 14, bx + bw + 14].forEach(hx => {
      ctx.beginPath();
      ctx.arc(hx, by + bh * 0.6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Feet / legs
    const legY = by + bh;
    ctx.fillStyle = '#3A3A3A';
    ctx.beginPath();
    this.roundRect(ctx, bx + 4, legY, bw * 0.35, h * 0.08, 4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    this.roundRect(ctx, bx + bw * 0.55, legY, bw * 0.35, h * 0.08, 4);
    ctx.fill();
    ctx.stroke();

    // Action-specific extras
    if (action.id === 'sync') {
      // Mini laptop
      ctx.fillStyle = '#888';
      ctx.fillRect(cx - 25, by + bh + 5, 50, 15);
      ctx.fillStyle = '#AAD4F0';
      ctx.fillRect(cx - 20, by + bh + 8, 40, 8);
    } else if (action.id === 'blocked') {
      // BLOCK sign
      ctx.fillStyle = '#FFF';
      ctx.strokeStyle = '#E74C3C';
      ctx.lineWidth = 3;
      const sx = cx - 30, sy = by - 30;
      this.roundRect(ctx, sx, sy, 60, 30, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#E74C3C';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BLOCK', cx, sy + 21);
    } else if (action.id === 'sleep') {
      // ZZZ
      ctx.fillStyle = '#666';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('Z' + 'Z'.repeat(Math.min(this.currentFrame, 3)),
                   bx + bw + 20, by);
    } else if (action.id === 'celebrate') {
      // Confetti dots
      const colors = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF8FB4'];
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.arc(
          cx + (Math.sin(i * 1.2 + this.currentFrame * 0.5) * 40),
          cy - headRadius * 1.2 + (Math.cos(i * 0.8 + this.currentFrame * 0.3) * 30),
          3, 0, Math.PI * 2
        );
        ctx.fill();
      }
    } else if (action.id === 'loading') {
      // Progress bar
      const px = cx - 35, py = by + bh + 8;
      const progress = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95][Math.min(this.currentFrame, 5)];
      ctx.fillStyle = '#ECECEC';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      this.roundRect(ctx, px, py, 70, 12, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6BCB77';
      this.roundRect(ctx, px + 1, py + 1, 68 * progress, 10, 5);
      ctx.fill();
    }

    // Draw action name label at bottom
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`[${action.name}] ${this.currentFrame + 1}/${action.frames}`, cx, h - 5);

    ctx.restore();
  }

  // Helper: rounded rectangle path
  roundRect(ctx, x, y, w, h, r) {
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
    return this.ctx;
  }
}

// ===== 眼神跟随：红瞳检测 =====
// 加载精灵后扫描每帧头部区域（帧高 18%~37%）的偏红像素，
// 连通域配对定位双眼。检测不到（闭眼/侧脸/瞳色非红）该帧返回 null，
// 瞳孔就不画 —— 天然兼容眨眼和睡觉。仅对偏红瞳色有效（isla 红瞳）。
const EYE_SCAN_TOP = 0.18;
const EYE_SCAN_BOTTOM = 0.37;
const EYE_MIN_PX = 25;   // 连通域像素数范围
const EYE_MAX_PX = 1200;
const EYE_MIN_W = 8;     // 连通域宽高范围（过滤头发丝/胸结/纸屑等杂块）
const EYE_MAX_W = 45;
const EYE_MIN_H = 10;
const EYE_MAX_H = 42;

function isEyeRed(r, g, b, a) {
  return a > 128 && r > 100 && r > g * 1.6 && r > b * 1.6;
}

function detectEyePairs(spriteCanvas, actionId) {
  const action = ACTIONS[actionId];
  const frames = action ? action.frames : 6;
  const fw = Math.round(spriteCanvas.width / frames);
  const fh = spriteCanvas.height;
  if (!fw || !fh) return [];
  const ctx = spriteCanvas.getContext('2d');
  const full = ctx.getImageData(0, 0, spriteCanvas.width, fh);
  const d = full.data;
  const y0 = Math.floor(fh * EYE_SCAN_TOP);
  const y1 = Math.floor(fh * EYE_SCAN_BOTTOM);
  const bandH = y1 - y0;
  const result = [];
  for (let f = 0; f < frames; f++) {
    result.push(findEyePairInFrame(d, spriteCanvas.width, fw, f, y0, bandH));
  }
  return result;
}

function findEyePairInFrame(d, stripW, fw, frame, y0, bandH) {
  const seen = new Uint8Array(fw * bandH);
  const blobs = [];
  for (let y = 0; y < bandH; y++) {
    for (let x = 0; x < fw; x++) {
      const idx = y * fw + x;
      if (seen[idx]) continue;
      const i = ((frame * fw + x) + (y0 + y) * stripW) * 4;
      if (!isEyeRed(d[i], d[i + 1], d[i + 2], d[i + 3])) continue;
      // 8 连通 BFS 收集一个连通域
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;
      const stack = [[x, y]];
      seen[idx] = 1;
      while (stack.length) {
        const p = stack.pop();
        const cx = p[0], cy = p[1];
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= fw || ny < 0 || ny >= bandH) continue;
            const ni = ny * fw + nx;
            if (seen[ni]) continue;
            const j = ((frame * fw + nx) + (y0 + ny) * stripW) * 4;
            if (isEyeRed(d[j], d[j + 1], d[j + 2], d[j + 3])) {
              seen[ni] = 1;
              stack.push([nx, ny]);
            }
          }
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (
        area >= EYE_MIN_PX && area <= EYE_MAX_PX &&
        bw >= EYE_MIN_W && bw <= EYE_MAX_W &&
        bh >= EYE_MIN_H && bh <= EYE_MAX_H
      ) {
        blobs.push({ cx: (minX + maxX) / 2, cy: y0 + (minY + maxY) / 2, w: bw, h: bh, area: area });
      }
    }
  }
  // 配对：|dy|<=14 且 12<=dx<=85，取最靠上的一对（眼睛在胸结/腮红上方）
  let best = null;
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j];
      const dx = Math.abs(a.cx - b.cx);
      const dy = Math.abs(a.cy - b.cy);
      if (dx >= 12 && dx <= 85 && dy <= 14) {
        const avgY = (a.cy + b.cy) / 2;
        if (!best || avgY < best.avgY) best = { a: a, b: b, avgY: avgY };
      }
    }
  }
  if (!best) return null;
  const left = best.a.cx < best.b.cx ? best.a : best.b;
  const right = best.a.cx < best.b.cx ? best.b : best.a;
  return {
    lx: Math.round(left.cx),
    ly: Math.round(left.cy),
    rx: Math.round(right.cx),
    ry: Math.round(right.cy),
    size: Math.round((left.w + left.h + right.w + right.h) / 4),
  };
}

// ===== 重心稳定：每帧上身 x 质心 =====
// 姿势变化会让每帧身体在帧内的横向位置小幅跳动；取 y∈[0.2h,0.8h]
// 非透明像素的 x 质心，渲染时平滑对齐，帧间不再左右弹
function computeFrameAnchors(spriteCanvas, actionId) {
  const action = ACTIONS[actionId];
  const frames = action ? action.frames : 6;
  const fw = Math.round(spriteCanvas.width / frames);
  const fh = spriteCanvas.height;
  if (!fw || !fh) return [];
  const ctx = spriteCanvas.getContext('2d');
  const d = ctx.getImageData(0, 0, spriteCanvas.width, fh).data;
  const y0 = Math.floor(fh * 0.2);
  const y1 = Math.floor(fh * 0.8);
  const anchors = [];
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = f * fw; x < (f + 1) * fw; x++) {
        if (d[(y * spriteCanvas.width + x) * 4 + 3] > 0) {
          sum += x - f * fw;
          n++;
        }
      }
    }
    anchors.push(n > 0 ? sum / n : null);
  }
  return anchors;
}
