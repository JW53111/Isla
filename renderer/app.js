// Main application controller — desktop pet app
// v2: auto-fit scaling + zoom, head-poke, idle auto-sleep, drift, breathing,
//     click reactions (键盘镜像已分离到独立的键盘模式窗口)

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
let idleTimer = 0;
let idleThreshold = 25000 + Math.random() * 20000;
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
    // 键盘镜像已分离到独立的「键盘模式」窗口（BongoCat 风格），这里只留鼠标点击反应
    api.onInputEvent((ev) => {
      if (ev.type === 'mouse-down' && ACTIONS['poke-react']) {
        switchAction('poke-react', false);
      }
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

  // Idle transition — random action after a while
  if (currentActionId === DEFAULT_ACTION_ID && !isUserTriggered) {
    idleTimer += dt;
    if (idleTimer >= idleThreshold) {
      triggerRandomAction();
      idleTimer = 0;
      idleThreshold = 30000 + Math.random() * 30000;
    }
  }

  // Auto-sleep: long time without interaction while resting
  if (currentActionId === DEFAULT_ACTION_ID && Date.now() - lastInteractionAt > AUTO_SLEEP_MS) {
    switchAction('sleep', false);
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

  // Breathing only (CSS transform, pivot at the feet) — 视线倾斜已取消，保持站直
  breatheT += dt;
  const breatheScale = 1 + Math.sin((breatheT / 900) * Math.PI * 2) * (currentActionId === 'sleep' ? 0.008 : 0.004);
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
  idleTimer = 0;
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

// Trigger a random action from idle
function triggerRandomAction() {
  const idx = Math.floor(Math.random() * IDLE_TRANSITIONS.length);
  switchAction(IDLE_TRANSITIONS[idx], false);
}

// Cycle through all actions (click behavior)
function cycleNextAction() {
  const actionIds = Object.keys(ACTIONS);
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
