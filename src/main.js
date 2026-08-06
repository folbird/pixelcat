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

// ---- 打字红温系统（Heat System）----
// 只有打字速率超过阈值（每秒 >6 次敲击）才触发红温：
// 慢速正常打字无论打多久都不红，连续高速输入才红，
// 且红色强度随速率提升平滑加深。
const HEAT_RATE_THRESHOLD = 6;    // 每秒 6 次敲击才触发红温
const HEAT_RATE_WINDOW_MS = 1000; // 统计最近 1 秒内的敲击次数
const HEAT_RATE_MAX = 9;          // 达到每秒 9 键时红色最浓（满红温）
const HEAT_MAX = 100;             // 红温强度上限（满=完全红温）
// 满热度时红色叠加的最大不透明度（source-atop 只作用于猫身像素，透明区不受影响）
const HEAT_MAX_ALPHA = 0.55;
let petHeat = 0;                  // 当前红温强度 0~100（由敲击速率映射）
let keyTimes = [];                // 最近敲击时间戳（滑动窗口统计速率）

// 眼睛保护区（canvas 128×128 坐标）：红色滤镜不染眼白与瞳孔，外围黑毛要吃到红。
// 打字帧(press-left/right.svg，viewBox -2~48，缩放 128/50=2.56，偏移 +2×2.56=+5.12)：
//   左眼 svg x11~16 → 画布 x33~46；右眼 svg x20~25 → 画布 x56~69；y14~19 → 画布 y41~54。
const HEAT_EYE_RECTS_TYPING = [
  { x: 33, y: 41, w: 13, h: 13 },
  { x: 56, y: 41, w: 13, h: 13 },
];
// 待机帧(IDLE_SPRITE)：左眼 4 白块+瞳占画布 x40~55,y37~52；右眼 x67~82,y37~52。
// 矩形精确贴合，外围黑色毛不被保护，可正常染红。
const HEAT_EYE_RECTS_IDLE = [
  { x: 40, y: 37, w: 16, h: 16 },
  { x: 67, y: 37, w: 16, h: 16 },
];
// 离屏缓存：用于把眼睛区域的原猫像素贴回（避免滤镜染色眼睛）。
let heatScratchCanvas = null;
let heatScratchCtx = null;

// 瞳孔跟随椭圆约束：瞳孔 9×9 在 16×16 眼白框内，边距 3.5px，
// 椭圆半径 X=3 / Y=2.5 保证上下眼白不被遮挡，鼠标绕窗时瞳孔沿椭圆轨道环绕。
const EYE_RADIUS_X = 3;
const EYE_RADIUS_Y = 2.5;
// 瞳孔用「运动速度」驱动：鼠标每次事件之间的位移（≈速度向量）直接驱动瞳孔方向与幅度，
// 快速甩动瞳孔立刻看过去、鼠标静止瞳孔优雅回中。这比「位置差」灵动得多。
const EYE_VEL_SCALE = 9;       // 移动像素 ÷ 9 = 瞳孔偏移（鼠标扫 100px → 偏移 ~11px，clamp 到 3）
const EYE_FOLLOW_SMOOTH = 0.42; // 跟随速度（越大响应越快）
// 鼠标静止多久后瞳孔完全回中（ms），期间微小的抖动也保留灵动感。
const EYE_IDLE_RETURN_MS = 260;
let lastCursorRawX = null;
let lastCursorRawY = null;
let lastCursorMoveTime = 0;

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
  '000011111111111111111111000007', '000111111111111111111111100077',
  '000111111111111111111111100777', '000111111111111111111111100777',
  '000111111111111111111111100777', '000111111111111111111111100777',
  '000011111111111111111111007777', '000011111111111111117777777777',
  '000011111111111111111177777777', '000000111111111111111100777770',
  '000000001111110111111000007700', '000000000111100011110000000000'
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
      // 眼睛区域（5/6/8）由 drawPixelEyes 统一绘制，避免瞳孔随光标错位散开。
      if (code === '5' || code === '6' || code === '8') return;
      ctx.fillStyle = '#111';
      ctx.fillRect(originX + x * cell, originY + y * cell, cell, cell);
    });
  });

  // 眼睛绘制：睁开 → 4 个白色矩形（上/下/左/右）围框 + 中央黑色瞳孔（整体随 eyeOffset 移动）；
  // 眨眼/睡觉 → 整眼黑色闭眼（睡觉时加两条细浅横线）。
  if (sleeping) {
    ctx.fillStyle = '#111';
    ctx.fillRect(40, 37, 16, 16);
    ctx.fillRect(67, 37, 16, 16);
    ctx.fillStyle = '#f5f5f5';
    const lineY = originY + 10 * cell + 1;
    ctx.fillRect(originX + 8 * cell, lineY, 3 * cell, 2);
    ctx.fillRect(originX + 17 * cell, lineY, 3 * cell, 2);
  } else if (blinking) {
    ctx.fillStyle = '#111';
    ctx.fillRect(40, 37, 16, 16);
    ctx.fillRect(67, 37, 16, 16);
  } else {
    drawPixelEyes();
  }

  // 打字红温后处理层（仅猫身像素叠加红色）。
  applyHeatEffects();
}

// 像素猫眼睛：4 个白色矩形（上、下、左、右）围框 + 中央黑色瞳孔。
// 数据来自 IDLE_SPRITE 30×34 矩阵（cell=3, origin=(19,13)）：
//   左眼：上白(43,37,9,3) 下白(43,49,9,3) 左竖(40,40,3,9) 右竖(52,40,3,9)，瞳孔(43,40,9,9)
//   右眼：上白(70,37,9,3) 下白(70,49,9,3) 左竖(67,40,3,9) 右竖(79,40,3,9)，瞳孔(70,40,9,9)
function drawPixelEyes() {
  const ex = Math.round(eyeOffsetX);
  const ey = Math.round(eyeOffsetY);
  ctx.fillStyle = '#f5f5f5';
  // 左眼 4 块白色
  ctx.fillRect(43, 37, 9, 3);
  ctx.fillRect(43, 49, 9, 3);
  ctx.fillRect(40, 40, 3, 9);
  ctx.fillRect(52, 40, 3, 9);
  // 右眼 4 块白色
  ctx.fillRect(70, 37, 9, 3);
  ctx.fillRect(70, 49, 9, 3);
  ctx.fillRect(67, 40, 3, 9);
  ctx.fillRect(79, 40, 3, 9);
  // 瞳孔：整块黑色 9×9，整体随 eyeOffset 移动（不再散开错位）
  ctx.fillStyle = '#111';
  ctx.fillRect(43 + ex, 40 + ey, 9, 9);
  ctx.fillRect(70 + ex, 40 + ey, 9, 9);
}

function drawFrame(idx) {
  const frame = frames[idx % frames.length];
  if (!frame.complete || frame.naturalWidth === 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  // 打字红温后处理层。
  applyHeatEffects();
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
  // 记录本次敲击时间戳（滑动窗口统计当前打字速率）。
  const now = Date.now();
  keyTimes.push(now);
  // 只保留最近 1 秒内的敲击，统计出「每秒敲击次数」。
  while (keyTimes.length > 0 && now - keyTimes[0] > HEAT_RATE_WINDOW_MS) {
    keyTimes.shift();
  }
  updateHeat();
  advanceOneFrame();
  setPetState('typing');
  clearTimeout(typingStateTimer);
  typingStateTimer = setTimeout(() => {
    if (petState === 'typing') setPetState('idle');
  }, TYPING_VISIBLE_MS);
}

// ---- 打字红温实现 ----
// 由滑动窗口打字速率计算红温强度：速率 ≤ 阈值 → 0（完全不红）；
// 速率达到 HEAT_RATE_MAX → 100（满红温）；之间线性渐变。
function updateHeat() {
  const now = Date.now();
  // 清理窗口外的旧敲击记录。
  while (keyTimes.length > 0 && now - keyTimes[0] > HEAT_RATE_WINDOW_MS) {
    keyTimes.shift();
  }
  const rate = keyTimes.length; // 最近 1 秒内的敲击次数 = 每秒速率
  if (rate <= HEAT_RATE_THRESHOLD) {
    petHeat = 0;
  } else {
    petHeat = Math.min(
      HEAT_MAX,
      ((rate - HEAT_RATE_THRESHOLD) / (HEAT_RATE_MAX - HEAT_RATE_THRESHOLD)) * HEAT_MAX
    );
  }
}

// 把当前红温强度映射到画面后处理：仅猫身像素叠加红色，眼睛（眼白+瞳孔）保持原色。
// 速率 ≤ 阈值时 petHeat=0 完全不渲染；超过后红色从 0 平滑渐显，满强度达到 HEAT_MAX_ALPHA。
function applyHeatEffects() {
  if (petHeat <= 0) return;
  const alpha = (petHeat / HEAT_MAX) * HEAT_MAX_ALPHA;
  if (alpha <= 0) return;

  // 1) 备份当前干净帧（原猫）。
  if (!heatScratchCanvas) {
    heatScratchCanvas = document.createElement('canvas');
    heatScratchCanvas.width = canvas.width;
    heatScratchCanvas.height = canvas.height;
    heatScratchCtx = heatScratchCanvas.getContext('2d');
  }
  heatScratchCtx.clearRect(0, 0, canvas.width, canvas.height);
  heatScratchCtx.drawImage(canvas, 0, 0);

  // 2) 在猫自身像素上叠加红色：source-atop 把所有不透明区域染色，
  //    黑色猫身→暗红、白色描边→淡粉，完全透明背景不受影响。
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(235, 50, 35, ${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // 3) 眼睛保护区：把原猫像素贴回眼睛矩形，红色不染眼白与瞳孔。
  const rects = petState === 'typing' ? HEAT_EYE_RECTS_TYPING : HEAT_EYE_RECTS_IDLE;
  for (const r of rects) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(
      heatScratchCanvas,
      0, 0, canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );
    ctx.restore();
  }
}

// 热度主循环：冷却 + 有热度时重绘当前帧（红色叠加随热度平滑变化）。
function heatLoop() {
  updateHeat();
  if (petHeat > 0) {
    if (petState === 'typing') drawFrame(frameIndex);
    else drawIdleFrame();
  }
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

  // 1) 运动速度驱动：本次与上次光标的位移（每 100ms 一次 ≈ 速度向量）。
  let velX = 0;
  let velY = 0;
  if (lastCursorRawX !== null) {
    velX = point.x - lastCursorRawX;
    velY = point.y - lastCursorRawY;
    if (velX !== 0 || velY !== 0) lastCursorMoveTime = Date.now();
  }
  lastCursorRawX = point.x;
  lastCursorRawY = point.y;

  // 2) 期望瞳孔偏移：速度 ÷ 灵敏度，方向即鼠标运动方向；
  //    鼠标静止超过 IDLE_RETURN_MS 后目标回中（眼睛自然凝望）。
  let tx, ty;
  if (Date.now() - lastCursorMoveTime > EYE_IDLE_RETURN_MS) {
    tx = 0;
    ty = 0;
  } else {
    tx = Math.max(-EYE_RADIUS_X, Math.min(EYE_RADIUS_X, velX / EYE_VEL_SCALE));
    ty = Math.max(-EYE_RADIUS_Y, Math.min(EYE_RADIUS_Y, velY / EYE_VEL_SCALE));
  }

  // 3) 椭圆环绕约束：超出椭圆半径则沿方向压缩回边界。
  const nx = tx / EYE_RADIUS_X;
  const ny = ty / EYE_RADIUS_Y;
  const norm = Math.hypot(nx, ny);
  if (norm > 1) {
    tx = (nx / norm) * EYE_RADIUS_X;
    ty = (ny / norm) * EYE_RADIUS_Y;
  }
  eyeOffsetX += (tx - eyeOffsetX) * EYE_FOLLOW_SMOOTH;
  eyeOffsetY += (ty - eyeOffsetY) * EYE_FOLLOW_SMOOTH;
  if (petState !== 'typing') drawIdleFrame();
}

// ---- Toast ----
// extraDown：为某些提示额外下移（如「番茄钟已取消」再下调 20px）。
function showToast(msg, extraDown) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('toast-extra-down', !!extraDown);
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('show');
    el.classList.remove('toast-extra-down');
  }, 2500);
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
  return trimmed;
}

// 打开名字弹窗：窗口固定 300×340 永不移动，输入框直接在猫正下方显示。
function openNameDialog() {
  if (!nameDialog || !nameInput) return;
  nameInput.value = getPetName();
  nameDialog.classList.add('open');
  nameInput.focus();
  nameInput.select();
}

// 关闭名字弹窗：直接隐藏（窗口从不移动）。
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
  // 窗口固定 300×340 永不移动：猫在窗口内从 128 平滑放大到 256×256（scale(2)），
  // 顶部 96px 气泡区 + 窗口 340px 足够容纳放大后的猫，气泡仍显示在猫头顶上方。
  document.body.classList.add('water-active');
  const name = getPetName();
  showToast(name ? `${name}，该喝水啦，起来接一杯水吧` : '该喝水啦，起来接一杯水吧');
  advanceOneFrame();
  clearTimeout(waterReminderRestoreTimer);
  waterReminderRestoreTimer = setTimeout(() => {
    document.body.classList.remove('water-active');
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
  const name = getPetName();
  showToast(name ? `${name}，起来拉伸一下吧！久坐容易疲劳` : '🧘 起来拉伸一下吧！久坐容易疲劳');
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
const pomodoroPauseBtn = document.getElementById('pomodoro-pause-btn');
const pomodoroCancelBtn = document.getElementById('pomodoro-cancel-btn');

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
  // 暂停/继续按钮图标随状态切换
  if (pomodoroPauseBtn) {
    pomodoroPauseBtn.textContent = pomodoroState === 'paused' ? '▶' : '⏸';
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
      showToast(`番茄完成！休息 5 分钟`);
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

function cancelPomodoro() {
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
  pomodoroState = 'idle';
  pomodoroPausedFrom = 'work';
  pomodoroRemaining = POMODORO_WORK;
  updateDisplay();
  setPanelExpanded(false);
  showToast('番茄钟已取消', true);
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

// 暂停/继续按钮
if (pomodoroPauseBtn) {
  pomodoroPauseBtn.addEventListener('click', () => {
    if (pomodoroState === 'paused') startPomodoro();
    else pausePomodoro();
  });
}

// 取消按钮
if (pomodoroCancelBtn) {
  pomodoroCancelBtn.addEventListener('click', cancelPomodoro);
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
      startPomodoro();
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
  setInterval(heatLoop, 100);
  startWaterReminder();
  startStretchReminder();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}