// Main application controller — desktop pet app
// v2: auto-fit scaling + zoom, head-poke, idle auto-sleep, drift, breathing,
//     click reactions (键盘镜像：敲键盘 -> 切「敲键盘」动作，停手回到待机)

const canvas = document.getElementById('pet-canvas');
const engine = new SpriteEngine(canvas);
const api = window.electronAPI;

// State
// Default idle action: prefer 'idle', fall back to 'idle-buddy' or the first
// action in ACTIONS (ids vary per pet, e.g. isla uses 'idle-buddy')
const DEFAULT_ACTION_ID = ACTIONS['idle'] ? 'idle' : ACTIONS['idle-buddy'] ? 'idle-buddy' : Object.keys(ACTIONS)[0];
const HEAD_ZONE = 0.3;                // top 30% of canvas counts as the head (Q-version proportions)
const AUTO_SLEEP_MS = 10 * 60 * 1000; // no interaction for 10 min -> fall asleep
const POKE_STREAK_MS = 6000;          // 3 pokes within 6 s -> cheer-up

let currentActionId = DEFAULT_ACTION_ID;
let lastTimestamp = 0;
let isUserTriggered = false;
let lastInteractionAt = Date.now();

// Scaling state
let settings = { zoom: 1, autoScaleRatio: 0.2, opacity: 1 };
let currentWorkArea = null;
let currentScale = 1;

// Drag state
let isDragging = false;
let hasDragged = false;
let dragStartX = 0;
let dragStartY = 0;

// Click / double-click handling
let clickTimer = null;
let clickWasHead = false;

// Typing mirror: hold typing action while keys keep coming, back to idle 1.5 s after
let typingHoldTimer = null;

// 生闷气（sulk）：被戳时随机触发 + 长时间不理她时自己生闷气
const SULK_IDLE_MS = 3 * 60 * 1000; // 无交互 3 分钟
const SULK_HOLD_MS = 5000;          // 生 5 秒闷气自己回来
const SULK_POKE_CHANCE = 0.35;      // 被戳时 35% 生闷气
let sulkHoldTimer = null;
let lastSulkAt = 0;

// Head-poke streak
let pokeStreak = 0;
let lastPokeAt = 0;

// Idle drift (window slowly wanders)
let drifting = false;
let driftVx = 0;
let driftVy = 0;
let driftLeft = 0;

// Breathing
let breatheT = 0;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Auto-fit scale: pet height = ratio of screen work-area height, zoom multiplies on top
function computeScale(workAreaHeight, s) {
  const ratio = clamp(s.autoScaleRatio ?? 0.2, 0.08, 0.45);
  const targetH = clamp(workAreaHeight * ratio, 80, Math.min(420, workAreaHeight * 0.5));
  return (targetH * clamp(s.zoom ?? 1, 0.5, 2.5)) / STAGE_HEIGHT;
}

// Apply current scale to canvas + window (STAGE is fixed, so action switches never resize)
function applyDisplaySize() {
  const w = Math.round(STAGE_WIDTH * currentScale);
  const h = Math.round(STAGE_HEIGHT * currentScale);
  engine.setDisplaySize(w, h);
  api?.resizeWindow(w, h);
}

function markInteraction() {
  lastInteractionAt = Date.now();
}

// 眼神跟随：把「鼠标相对窗口中心」的偏移归一化为注视方向（|v|<=1），
// 离中心太近时看正前方；引擎内部做平滑
function updateGazeTarget(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 40) {
    engine.setGazeTarget(0, 0);
  } else {
    engine.setGazeTarget(dx / len, dy / len);
  }
}

function setZoom(z) {
  z = clamp(z, 0.5, 2.5);
  settings.zoom = z;
  api?.setSettings({ zoom: z });
  // If no main process (plain browser), apply directly
  if (!api && currentWorkArea) {
    currentScale = computeScale(currentWorkArea.height, settings);
    applyDisplaySize();
  }
}

// Initialize
async function init() {
  if (api) {
    try {
      settings = (await api.getSettings()) || settings;
      const dc = await api.getDisplayConfig();
      if (dc && dc.workArea) currentWorkArea = dc.workArea;
    } catch (e) {
      // keep DISPLAY_SCALE fallback below
    }
  }
  if (currentWorkArea) {
    currentScale = computeScale(currentWorkArea.height, settings);
  } else {
    currentScale = typeof DISPLAY_SCALE !== 'undefined' ? DISPLAY_SCALE : 1;
  }
  applyDisplaySize();

  switchAction(DEFAULT_ACTION_ID, false);

  lastTimestamp = performance.now();
  requestAnimationFrame(gameLoop);

  if (api) {
    // Action switches from context menu (main process)
    api.onSwitchAction((actionId) => {
      markInteraction();
      switchAction(actionId, true);
    });

    // Commands from main process (global shortcuts / menu)
    api.onPetCommand((cmd) => {
      if (cmd === 'zoom-in') setZoom(settings.zoom * 1.1);
      else if (cmd === 'zoom-out') setZoom(settings.zoom / 1.1);
    });

    // Settings changed (zoom/opacity/etc from menu or shortcuts)
    api.onSettingsChanged((s) => {
      settings = s;
      if (currentWorkArea) {
        currentScale = computeScale(currentWorkArea.height, settings);
        applyDisplaySize();
      }
    });

    // Display changed (resolution / monitor plug / dragged across screens)
    api.onDisplayChanged((d) => {
      if (d && d.workArea) {
        currentWorkArea = d.workArea;
        currentScale = computeScale(d.workArea.height, settings);
        applyDisplaySize();
      }
    });

    // Global input mirror (uiohook in main process)
    // 敲键盘 -> 切「敲键盘」动作，停手 1.5 秒回到待机；点击别处 -> 撒娇反应
    api.onInputEvent((ev) => {
      if (ev.type === 'keydown') {
        if (!ACTIONS['typing']) return;
        clearTimeout(typingHoldTimer);
        if (currentActionId !== 'typing') switchAction('typing', false);
        typingHoldTimer = setTimeout(() => {
          if (currentActionId === 'typing') switchAction(DEFAULT_ACTION_ID, false);
        }, 1500);
      } else if (ev.type === 'mouse-down' && ACTIONS['poke-react']) {
        // 被戳：35% 几率生闷气（生暗气），否则撒娇
        if (ACTIONS['sulk'] && Math.random() < SULK_POKE_CHANCE) {
          playSulk();
        } else {
          switchAction('poke-react', false);
        }
      }
    });

    // 眼神跟随：主进程发来鼠标相对窗口中心的偏移，归一化后交给引擎
    api.onPointerMove(({ dx, dy }) => {
      updateGazeTarget(dx, dy);
    });
  } else {
    // 无主进程（纯浏览器预览）：窗口内 mousemove 兜底
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      updateGazeTarget(
        e.clientX - rect.left - rect.width / 2,
        e.clientY - rect.top - rect.height / 2
      );
    });
  }

  // Click / double-click handling
  canvas.addEventListener('click', (e) => {
    if (hasDragged) return;
    e.stopPropagation();
    markInteraction();

    const rect = canvas.getBoundingClientRect();
    const isHead = (e.clientY - rect.top) < rect.height * HEAD_ZONE;

    // Clicking a sleeping pet wakes her up
    if (currentActionId === 'sleep') {
      switchAction(DEFAULT_ACTION_ID, true);
      return;
    }

    if (clickTimer) {
      // Second click within 250 ms = double click
      clearTimeout(clickTimer);
      clickTimer = null;
      if (clickWasHead && isHead) {
        pokeHead(); // head-head double click: poke again instead of sleeping
      } else {
        switchAction('sleep', true);
      }
      return;
    }

    clickWasHead = isHead;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (clickWasHead) {
        pokeHead();
      } else {
        cycleNextAction();
      }
    }, 250);
  });

  // Right-click — context menu
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    markInteraction();
    if (api) {
      api.showContextMenu(currentActionId);
    }
  });

  // Mouse drag — move window
  canvas.addEventListener('mousedown', (e) => {
    markInteraction();
    isDragging = true;
    hasDragged = false;
    dragStartX = e.screenX;
    dragStartY = e.screenY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      hasDragged = true;
      if (api) {
        api.moveWindow(dx, dy);
      }
      dragStartX = e.screenX;
      dragStartY = e.screenY;
    }
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// Main game loop
function gameLoop(timestamp) {
  const dt = Math.min(timestamp - lastTimestamp, 100);
  lastTimestamp = timestamp;

  engine.update(dt);

  // Auto-sleep: long time without interaction while resting
  if (currentActionId === DEFAULT_ACTION_ID && Date.now() - lastInteractionAt > AUTO_SLEEP_MS) {
    switchAction('sleep', false);
  }

  // 长时间不理她 → 自己生闷气（3 分钟一次；10 分钟自动睡觉优先接管）
  if (
    currentActionId === DEFAULT_ACTION_ID &&
    !isDragging &&
    Date.now() - lastInteractionAt > SULK_IDLE_MS &&
    Date.now() - lastSulkAt > SULK_IDLE_MS
  ) {
    playSulk();
  }

  // Idle drift — window slowly wanders, clamped to the work area
  if (drifting) {
    if (currentActionId === DEFAULT_ACTION_ID && !isUserTriggered && !isDragging) {
      driftLeft -= dt;
      api?.moveWindow((driftVx * dt) / 1000, (driftVy * dt) / 1000, { clamp: true });
      if (driftLeft <= 0) drifting = false;
    } else {
      drifting = false;
    }
  } else if (
    currentActionId === DEFAULT_ACTION_ID &&
    !isUserTriggered &&
    !isDragging &&
    Math.random() < dt / 35000
  ) {
    startDrift();
  }

  // Live2D 式慢呼吸（只 scaleY，transform-origin 在脚底 = 脚不动、头自然起伏）：
  // 3.6s 周期 = 吸气 1s → 呼气 2s → 停留 0.6s，睡觉时起伏更明显；不倾斜、站直
  breatheT += dt;
  const amp = currentActionId === 'sleep' ? 0.014 : 0.006;
  const phase = (breatheT % 3600) / 3600;
  let v;
  if (phase < 0.28) {
    // 吸气 1s：缓入缓出 0 -> 1
    const t = phase / 0.28;
    v = t * t * (3 - 2 * t);
  } else if (phase < 0.83) {
    // 呼气 2s：缓入缓出 1 -> 0
    const t = (phase - 0.28) / 0.55;
    v = 1 - t * t * (3 - 2 * t);
  } else {
    v = 0; // 停留 0.6s
  }
  // 次谐波小起伏，曲线不那么机械
  v += 0.15 * Math.sin((breatheT / 1700) * Math.PI * 2);
  const breatheScale = 1 + v * amp;
  canvas.style.transform = `scaleY(${breatheScale.toFixed(4)})`;

  engine.render();

  // Non-looping action completed → transition
  if (!engine.isPlaying && engine.currentAction) {
    handleActionComplete(engine.currentAction);
  }

  requestAnimationFrame(gameLoop);
}

// Switch to a specific action
function switchAction(actionId, userTriggered = false) {
  const action = ACTIONS[actionId];
  if (!action) return;

  currentActionId = actionId;
  isUserTriggered = userTriggered;
  if (actionId !== DEFAULT_ACTION_ID) drifting = false;
  engine.play(actionId);
  // Window size is STAGE-based and fixed across actions — no resize here
  // (keeps the existing "no jumping when switching actions" behavior)
}

// Handle action completion
function handleActionComplete(action) {
  if (isUserTriggered) return;
  if (action.nextAction) {
    switchAction(action.nextAction, false);
  } else {
    switchAction(DEFAULT_ACTION_ID, false);
  }
}

// Cycle through showcase actions (click behavior) — semantic actions
// (typing/sleep/poke-react) have their own dedicated triggers and are skipped
function cycleNextAction() {
  const excluded = typeof SEMANTIC_ACTIONS !== 'undefined' ? SEMANTIC_ACTIONS : ['typing', 'sleep'];
  const actionIds = Object.keys(ACTIONS).filter((id) => !excluded.includes(id));
  if (actionIds.length === 0) return;
  const currentIdx = actionIds.indexOf(currentActionId);
  const nextIdx = (currentIdx + 1) % actionIds.length;
  switchAction(actionIds[nextIdx], true);
}

// Head poke: poke-react, 3 pokes within 6 s -> cheer-up
function pokeHead() {
  const now = Date.now();
  pokeStreak = now - lastPokeAt < POKE_STREAK_MS ? pokeStreak + 1 : 1;
  lastPokeAt = now;
  if (pokeStreak >= 3) {
    pokeStreak = 0;
    if (ACTIONS['cheer-up']) switchAction('cheer-up', false);
    else if (ACTIONS['poke-react']) switchAction('poke-react', false);
  } else if (ACTIONS['poke-react']) {
    switchAction('poke-react', false);
  }
}

// 生暗气：切到 sulk 动作，几秒后自己回到待机（期间被敲键盘/点击打断则不回切）
function playSulk() {
  if (!ACTIONS['sulk']) return;
  lastSulkAt = Date.now();
  clearTimeout(sulkHoldTimer);
  switchAction('sulk', false);
  sulkHoldTimer = setTimeout(() => {
    if (currentActionId === 'sulk') switchAction(DEFAULT_ACTION_ID, false);
  }, SULK_HOLD_MS);
}

// Start idle drift: 3-6 s at 8-20 px/s in a random (mostly horizontal) direction
function startDrift() {
  const angle = Math.random() * Math.PI * 2;
  const speed = 8 + Math.random() * 12;
  driftVx = Math.cos(angle) * speed;
  driftVy = Math.sin(angle) * speed * 0.6 - 2;
  driftLeft = 3000 + Math.random() * 3000;
}

engine.onComplete = (action) => {
  handleActionComplete(action);
};

init();
