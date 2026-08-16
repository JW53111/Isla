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

    // Try to load the sprite sheet
    const imagePath = `../sprites/${actionId}.png`;
    this.loadSprite(actionId, imagePath);

    this.configureCanvas();
  }

  // Update animation (call each frame with delta time in ms)
  update(dt) {
    if (!this.isPlaying || !this.currentAction) return;

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
    const dx = Math.round((this.displayWidth - dw) / 2);
    const dy = Math.round(this.displayHeight - dh);
    ctx.drawImage(
      this.spriteImage,
      sx, 0,
      action.frameWidth, action.frameHeight,
      dx, dy,
      dw, dh
    );
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
