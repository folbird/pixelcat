// ============================================================
// Desktop Pet 动画逻辑 + 番茄钟 + 喝水提醒 + 名字 + 休息拉伸
// ============================================================

// ---- 打字帧 ----
const FRAME_W = 128;
const FRAME_H = 128;
const SCALE = 1;
const WATER_REMINDER_INTERVAL = 45 * 60 * 1000;
const WATER_REMINDER_VISIBLE_MS = 8000;
const TYPING_VISIBLE_MS = 360;
const SLEEP_AFTER_IDLE_MS = 30 * 1000;
const STRETCH_INTERVAL = 60 * 60 * 1000; // 每小时提醒一次休息拉伸

const canvas = document.getElementById('pet');
canvas.width = FRAME_W * SCALE;
canvas.height = FRAME_H * SCALE;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let frameIndex = 0;
let petState = 'idle';
let lastActivityAt = Date.now();
let lastCursorX = null;
let lastCursorY = null;
let eyeOffsetX = 0;
let eyeOffsetY = 0;
let typingStateTimer = null;
let blinkTimer = null;
const frames = ['./press-left.svg', './press-right.svg'].map((src) => {
  const image = new Image();
  image.src = src;
  return image;
});
// Swift 版本 PixelCatRenderer 的 30 x 34 像素猫矩阵。
// 待机时直接按同样的像素、白色描边和黑色填充绘制，保证视觉一致。
const IDLE_SPRITE = [
  '000000004000000000040000000000', '000000044000000000444000000000',
  '000000444400000000444400000000', '000000444422222222444400000000',
  '000004422222222222224400000000', '000002222222222222222200000000',
  '000002222222222222222220000000', '000022222222222222222222000000',
  '000022225552222226662222000000', '000222258885222268886222000000',
  '000222258885222268886222200000', '000222258885222268886222200000',
  '333332225552222226662223333300', '000222222222222222222222200000',
  '000022222222222222222222000000', '333333222222222222222223333330',
  '000022222222222222222222000000', '000022222222222222222220000000',
  '000000222222222222222200000000', '000001122222222222222110000000',
  '000011111222222222211111000000', '000011111111111111111111000000',
  '000011111111111111111111770000', '000111111111111111111111177700',
  '000111111111111111111111177770', '000111111111111111111111777770',
  '000111111111111111111111777770', '000111111111111111111111777770',
  '000011111111111111111111777770', '000011111111111111177777777770',
  '000011111111111111111777777770', '000000111111111111111177770000',
  '000000001111110111111777700000', '000000000111100011110000000000'
];

function drawIdleFrame() {
  const cell = 3;
  const width = 30 * cell;
  const height = 34 * cell;
  const originX = Math.round((canvas.width - width) / 2);
  const originY = Math.round((canvas.height - height) / 2);
  const sleeping = petState === 'sleep';
  const blinking = petState === 'blink' || sleeping;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  IDLE_SPRITE.forEach((row, y) => {
    [...row].forEach((code, x) => {
      // 睡觉时整只猫保持纯黑，不绘制白色外描边。
      if (code !== '0' && !sleeping) {
        ctx.fillRect(originX + x * cell - 1, originY + y * cell - 1, cell + 2, cell + 2);
      }
    });
  });

  IDLE_SPRITE.forEach((row, y) => {
    [...row].forEach((code, x) => {
      if (code === '0') return;
      if (code === '8' && blinking) {
        // 闭眼时瞳孔区域补黑色，避免眼眶内出现透明空洞（白块）
        ctx.fillStyle = '#111';
        ctx.fillRect(originX + x * cell, originY + y * cell, cell, cell);
        return;
      }
      const isEye = code === '5' || code === '6';
      const color = isEye && blinking ? '#111' : (isEye ? '#f5f5f5' : '#111');
      ctx.fillStyle = color;
      const pupilX = code === '8' ? eyeOffsetX : 0;
      const pupilY = code === '8' ? eyeOffsetY : 0;
      ctx.fillRect(originX + x * cell + pupilX, originY + y * cell + pupilY, cell, cell);
    });
  });

  // 睡觉时用两条细浅色横线表示闭眼。
  if (sleeping) {
    ctx.fillStyle = '#f5f5f5';
    const lineY = originY + 10 * cell + 1;
    ctx.fillRect(originX + 8 * cell, lineY, 3 * cell, 2);
    ctx.fillRect(originX + 17 * cell, lineY, 3 * cell, 2);
  }
}

function drawFrame(idx) {
  const frame = frames[idx % frames.length];
  if (!frame.complete || frame.naturalWidth === 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
}

function advanceOneFrame() {
  frameIndex = (frameIndex + 1) % frames.length;
  drawFrame(frameIndex);
}

function setPetState(nextState) {
  petState = nextState;
  document.body.classList.toggle('pet-idle', nextState === 'idle');
  document.body.classList.toggle('pet-blink', nextState === 'blink');
  document.body.classList.toggle('pet-sleep', nextState === 'sleep');
  document.body.classList.toggle('pet-typing', nextState === 'typing');
  if (nextState !== 'typing') drawIdleFrame();
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    if (petState === 'idle') {
      setPetState('blink');
      setTimeout(() => {
        if (petState === 'blink') setPetState('idle');
      }, 160);
    }
    scheduleBlink();
  }, 3000 + Math.random() * 4000);
}

function updateIdleState() {
  if (petState === 'typing' || petState === 'blink') return;
  if (Date.now() - lastActivityAt >= SLEEP_AFTER_IDLE_MS) {
    setPetState('sleep');
    return;
  }
  if (petState === 'sleep') setPetState('idle');
}

function handleTyping() {
  lastActivityAt = Date.now();
  advanceOneFrame();
  setPetState('typing');
  clearTimeout(typingStateTimer);
  typingStateTimer = setTimeout(() => {
    if (petState === 'typing') setPetState('idle');
  }, TYPING_VISIBLE_MS);
}

function handleCursorPosition(event) {
  const point = event && event.payload ? event.payload : event;
  if (!point) return;

  if (lastCursorX !== null && (point.x !== lastCursorX || point.y !== lastCursorY)) {
    lastActivityAt = Date.now();
    if (petState === 'sleep') setPetState('idle');
  }
  lastCursorX = point.x;
  lastCursorY = point.y;

  const targetX = Math.max(-1.2, Math.min(1.2, (point.dx || 0) / 110));
  const targetY = Math.max(-1.2, Math.min(1.2, (point.dy || 0) / 110));
  eyeOffsetX += (targetX - eyeOffsetX) * 0.3;
  eyeOffsetY += (targetY - eyeOffsetY) * 0.3;
  if (petState !== 'typing') drawIdleFrame();
}

// ---- Toast ----
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2500);
}

frames.forEach((frame) => {
  frame.onload = () => {
    if (petState === 'typing') drawFrame(frameIndex);
  };
});
drawIdleFrame();

// ============================================================
// 宠物名字（localStorage 持久化）
// ============================================================
const PET_NAME_KEY = 'pixelcat.pet.name';
const petNameEl = document.getElementById('pet-name');
const nameDialog = document.getElementById('name-dialog');
const nameInput = document.getElementById('name-input');
const nameOkBtn = document.getElementById('name-ok');
const nameCancelBtn = document.getElementById('name-cancel');

function getPetName() {
  try {
    return localStorage.getItem(PET_NAME_KEY) || '';
  } catch {
    return '';
  }
}

function setPetName(name) {
  const trimmed = (name || '').trim().slice(0, 10);
  try {
    if (trimmed) localStorage.setItem(PET_NAME_KEY, trimmed);
    else localStorage.removeItem(PET_NAME_KEY);
  } catch {
    // localStorage 不可用时仅内存生效
  }
  updatePetNameDisplay(trimmed);
}

function updatePetNameDisplay(name) {
  if (!petNameEl) return;
  if (name) {
    petNameEl.textContent = name;
    petNameEl.classList.add('show');
  } else {
    petNameEl.textContent = '';
    petNameEl.classList.remove('show');
  }
}

function openNameDialog() {
  if (!nameDialog || !nameInput) return;
  nameInput.value = getPetName();
  nameDialog.classList.add('open');
  nameInput.focus();
  nameInput.select();
}

function closeNameDialog() {
  if (!nameDialog) return;
  nameDialog.classList.remove('open');
}

function confirmName() {
  const name = nameInput.value;
  if (!name.trim()) {
    showToast('名字不能为空哦');
    return;
  }
  setPetName(name);
  closeNameDialog();
  showToast(`好的，以后叫你 ${name.trim()} 🐱`);
}

if (nameDialog && nameOkBtn && nameCancelBtn) {
  nameOkBtn.addEventListener('click', confirmName);
  nameCancelBtn.addEventListener('click', closeNameDialog);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmName();
    if (e.key === 'Escape') closeNameDialog();
  });
  nameDialog.addEventListener('click', (e) => {
    if (e.target === nameDialog) closeNameDialog();
  });
}

// 初始化名字显示（网页加载 / Tauri 每次启动时）
updatePetNameDisplay(getPetName());

// ============================================================
// 喝水提醒
// ============================================================
let waterReminderTimer = null;
let waterReminderRestoreTimer = null;

function invoke(command, args) {
  const T = window.__TAURI__;
  if (T && T.core && T.core.invoke) {
    return T.core.invoke(command, args).catch(() => {});
  }
  return Promise.resolve();
}

function showWaterReminder() {
  invoke('focus_water_reminder');
  document.body.classList.add('water-active');
  showToast('该喝水啦，起来接一杯水吧');
  advanceOneFrame();
  clearTimeout(waterReminderRestoreTimer);
  waterReminderRestoreTimer = setTimeout(() => {
    document.body.classList.remove('water-active');
    invoke('restore_water_reminder');
  }, WATER_REMINDER_VISIBLE_MS);
}

function startWaterReminder() {
  if (waterReminderTimer) clearInterval(waterReminderTimer);
  waterReminderTimer = setInterval(showWaterReminder, WATER_REMINDER_INTERVAL);
}

// ============================================================
// 休息拉伸提醒
// ============================================================
let stretchTimer = null;

function showStretchReminder() {
  showToast('🧘 起来拉伸一下吧！久坐容易疲劳');
  advanceOneFrame();
  setPetState('typing');
  clearTimeout(typingStateTimer);
  typingStateTimer = setTimeout(() => {
    if (petState === 'typing') setPetState('idle');
  }, TYPING_VISIBLE_MS);
}

function startStretchReminder() {
  if (stretchTimer) clearInterval(stretchTimer);
  stretchTimer = setInterval(showStretchReminder, STRETCH_INTERVAL);
}

// ============================================================
// 番茄钟
// ============================================================
const POMODORO_WORK = 25 * 60;
const POMODORO_BREAK = 5 * 60;
const POMODORO_COUNT_KEY = 'pixelcat.pomodoro.total';

let pomodoroState = 'idle';   // idle | work | break | paused
let pomodoroPausedFrom = 'work';
let pomodoroRemaining = POMODORO_WORK;
let pomodoroTimer = null;
let pomodoroTotalWork = loadPomodoroCount();

const display = document.getElementById('pomodoro-display');
const countEl = document.getElementById('pomodoro-count');

function loadPomodoroCount() {
  try {
    return parseInt(localStorage.getItem(POMODORO_COUNT_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function savePomodoroCount() {
  try {
    localStorage.setItem(POMODORO_COUNT_KEY, String(pomodoroTotalWork));
  } catch {
    // localStorage 不可用时仅内存生效
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateDisplay() {
  display.textContent = formatTime(pomodoroRemaining);
  document.body.classList.toggle('pomodoro-active', pomodoroState !== 'idle');
  document.body.classList.toggle('pomodoro-paused', pomodoroState === 'paused');
  if (countEl) {
    countEl.textContent = `🍅 × ${pomodoroTotalWork}`;
  }
}

function tick() {
  if (pomodoroState !== 'work' && pomodoroState !== 'break') return;
  pomodoroRemaining--;
  updateDisplay();

  if (pomodoroRemaining <= 0) {
    if (pomodoroState === 'work') {
      pomodoroTotalWork++;
      savePomodoroCount();
      showToast(`🍅 番茄完成！休息 5 分钟`);
      advanceOneFrame();
      pomodoroState = 'break';
      pomodoroRemaining = POMODORO_BREAK;
      updateDisplay();
    } else {
      showToast('☕ 休息结束！');
      advanceOneFrame();
      pomodoroState = 'idle';
      pomodoroRemaining = POMODORO_WORK;
      updateDisplay();
      setPanelExpanded(false);
      clearInterval(pomodoroTimer);
      pomodoroTimer = null;
    }
  }
}

function startPomodoro() {
  if (pomodoroState === 'idle' || pomodoroState === 'paused') {
    if (pomodoroState === 'idle') {
      pomodoroRemaining = POMODORO_WORK;
      pomodoroState = 'work';
      showToast(`番茄钟开始：25 分钟专注`);
    } else {
      pomodoroState = pomodoroPausedFrom;
      showToast(pomodoroState === 'work' ? '继续专注' : '继续休息');
    }
    setPanelExpanded(true);
    updateDisplay();
    if (pomodoroTimer) clearInterval(pomodoroTimer);
    pomodoroTimer = setInterval(tick, 1000);
  }
}

function pausePomodoro() {
  if (pomodoroState === 'work' || pomodoroState === 'break') {
    pomodoroPausedFrom = pomodoroState;
    pomodoroState = 'paused';
    showToast('番茄钟已暂停');
    updateDisplay();
  }
}

function resetPomodoro() {
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
  pomodoroState = 'idle';
  pomodoroPausedFrom = 'work';
  pomodoroRemaining = POMODORO_WORK;
  pomodoroTotalWork = 0;
  savePomodoroCount();
  updateDisplay();
  setPanelExpanded(false);
}

function togglePomodoro() {
  if (pomodoroState === 'work' || pomodoroState === 'break') {
    pausePomodoro();
    return;
  }
  startPomodoro();
}

function setPanelExpanded(expanded) {
  invoke('set_panel_expanded', { expanded });
}

// ============================================================
// Tauri API 初始化
// ============================================================
function init() {
  const T = window.__TAURI__;
  const win = T && T.window ? T.window.getCurrentWindow() : null;

  // 全局键盘由 Rust/keytap 发送；本地 keydown 作为权限未开启时的兜底。
  if (T && T.event && T.event.listen) {
    T.event.listen('typing', () => handleTyping());
    T.event.listen('cursor-position', (event) => handleCursorPosition(event));
  }
  document.addEventListener('keydown', () => handleTyping());

  // 右键菜单
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (T && T.core && T.core.invoke) {
      T.core.invoke('show_context_menu');
    }
  });

  // Toast 监听
  if (T && T.event && T.event.listen) {
    T.event.listen('show-toast', (event) => showToast(event.payload));
    T.event.listen('water-reminder-now', () => showWaterReminder());
    T.event.listen('stretch-reminder-now', () => showStretchReminder());
    T.event.listen('open-pomodoro', () => {
      togglePomodoro();
    });
    T.event.listen('open-name-dialog', () => {
      openNameDialog();
    });
  }

  // 窗口拖动
  if (win && typeof win.startDragging === 'function') {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) win.startDragging();
    });
  }

  setPetState('idle');
  scheduleBlink();
  setInterval(updateIdleState, 250);
  startWaterReminder();
  startStretchReminder();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}