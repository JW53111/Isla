// Main application controller — desktop pet app

const canvas = document.getElementById('pet-canvas');
const engine = new SpriteEngine(canvas);

// State
let currentActionId = 'idle';
let idleTimer = 0;
let idleThreshold = 10000 + Math.random() * 15000;
let lastTimestamp = 0;
let isUserTriggered = false;

// Drag state
let isDragging = false;
let hasDragged = false;
let dragStartX = 0;
let dragStartY = 0;

// Initialize
function init() {
  switchAction('idle', false);

  lastTimestamp = performance.now();
  requestAnimationFrame(gameLoop);

  // Listen for action switches from context menu (main process)
  if (window.electronAPI) {
    window.electronAPI.onSwitchAction((actionId) => {
      switchAction(actionId, true);
    });
  }

  // Click / double-click handling
  let clickTimeout = null;

  canvas.addEventListener('click', (e) => {
    if (hasDragged) return;
    e.stopPropagation();
    if (clickTimeout) {
      clearTimeout(clickTimeout);
      clickTimeout = null;
      // Double-click: toggle sleep
      if (currentActionId === 'sleep') {
        switchAction('idle', true);
      } else {
        switchAction('sleep', true);
      }
    } else {
      clickTimeout = setTimeout(() => {
        clickTimeout = null;
        cycleNextAction();
      }, 250);
    }
  });

  // Right-click — context menu
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.electronAPI) {
      window.electronAPI.showContextMenu(currentActionId);
    }
  });

  // Mouse drag — move window
  canvas.addEventListener('mousedown', (e) => {
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
      if (window.electronAPI) {
        window.electronAPI.moveWindow(dx, dy);
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
  engine.render();

  // Idle transition — random action after a while
  if (currentActionId === 'idle' && !isUserTriggered) {
    idleTimer += dt;
    if (idleTimer >= idleThreshold) {
      triggerRandomAction();
      idleTimer = 0;
      idleThreshold = 12000 + Math.random() * 25000;
    }
  }

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
  engine.play(actionId);

  const scale = typeof DISPLAY_SCALE !== 'undefined' ? DISPLAY_SCALE : 1;
  const stageWidth = typeof STAGE_WIDTH !== 'undefined' ? STAGE_WIDTH : action.frameWidth;
  const stageHeight = typeof STAGE_HEIGHT !== 'undefined' ? STAGE_HEIGHT : action.frameHeight;
  const dw = Math.round(stageWidth * scale);
  const dh = Math.round(stageHeight * scale);
  if (window.electronAPI) {
    window.electronAPI.resizeWindow(dw, dh);
  }
}

// Handle action completion
function handleActionComplete(action) {
  if (isUserTriggered) return;
  if (action.nextAction) {
    switchAction(action.nextAction, false);
  } else {
    switchAction('idle', false);
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

engine.onComplete = (action) => {
  handleActionComplete(action);
};

init();
