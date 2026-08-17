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
// ---- 喝水提醒（轻量优化：智能调度 + 点击打卡 + 进度水色 + 目标庆祝）----
const WATER_ACTIVE_START_HOUR = 8;     // 活跃提醒时段 08:00 开始
const WATER_ACTIVE_END_HOUR = 23;      // 23:00 结束（避免深夜打扰）
const WATER_COOLDOWN_MS = 20 * 60 * 1000; // 刚喝过 20 分钟内不自动打扰
const WATER_DRINK_ML = 200;            // 每次点击猫 = 喝 200ml
const WATER_DAILY_GOAL_ML = 2000;      // 每日目标 2000ml
const WATER_URGENT_MS = 90 * 60 * 1000; // 超过 90 分钟未喝 → 加强提醒
const WATER_STATE_KEY = 'pixelcat.water';
// 当日饮水状态（内存缓存 + localStorage 持久化）。声明必须放在文件顶部：
// drawIdleFrame() 在文件中部顶层调用 → applyHeatEffects() → getWaterTint() 会读取
// waterState；若声明在后面的喝水区块，此时它处于 TDZ 会抛 ReferenceError，
// 中断整个脚本导致 init()（拖动/右键/点击/眨眼）全部失效、只剩一只静态猫。
let waterState = { date: '', drunkML: 0, lastDrinkAt: 0, celebrated: false, log: [] };
let waterReminderTimer = null;
let waterReminderRestoreTimer = null;
const SLEEP_AFTER_IDLE_MS = 30 * 1000;
const STRETCH_INTERVAL = 60 * 60 * 1000; // 每小时提醒一次休息拉伸

// ---- 方向感知拖拽系统（手动拖动窗口 + rAF 实时形变）----
// 不用原生 startDragging（它会冻结 WebView 的 rAF，方向感知形变做不出来）。
// 改为：pointerdown/move 期间手动 setPosition 移动窗口（WebView 全程存活，
// rAF 60fps 正常运行），同时用鼠标速度驱动猫的实时形变（底部锚定）：
//   鼠标上移 → 身体从底部向上拉长（scaleY > 1，transform-origin 底部）
//   鼠标左/右移 → 身体朝该方向倾斜 + 横向滞后（rotate + translateX）
//   组合（左上/右上）→ 同时倾斜和拉长；静止 → 回正。
// 空闲与拖拽共用同一套物理模型，只是幅度不同（拖拽更大）。
const STRETCH_MAX_DRAG = 0.3;  // 拖拽时最大向上拉长 30%
const STRETCH_MAX_IDLE = 0.03; // 空闲时鼠标移动最大拉长 3%（极轻微，一丝伸长感）
const STRETCH_SPEED_SCALE = 2400; // 速度 px/s ÷ 系数 = 拉长量（2000px/s → 拖拽 ~0.3）
const STRETCH_SMOOTH = 0.2;    // 拉长量弹簧平滑
const STRETCH_DAMP = 0.82;     // 拉长量衰减
const TILT_MAX_DRAG = 16;      // 拖拽最大倾斜角（deg）
const TILT_MAX_IDLE = 2;       // 空闲最大倾斜角（deg，极轻微）
const TILT_SMOOTH = 0.35;      // 倾斜低通
const BODY_LAG_SMOOTH = 0.12;  // 身体横向滞后平滑（仅拖拽用）
const BODY_LAG_DAMP = 0.82;    // 身体滞后速度衰减
const petWrapper = document.getElementById('pet-wrapper');
const petCanvas = document.getElementById('pet');
// ---- 音效系统（Web Audio API，Howler.js/Phaser 专业方案）----
// HTMLAudioElement 的问题：play() 异步 + 同声道竞争，WKWebView 快速连点时会
// 静默吞掉部分播放 →「有时没声音」。Web Audio 方案：音频解码一次为 AudioBuffer
// 常驻内存，每次播放新建 BufferSource.start() —— 同步、零延迟、连点多少次响
// 多少次、永不丢失，且 stop() 可即时掐断（拖动静音）。
const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
const soundCtx = AudioContextCtor ? new AudioContextCtor() : null;
const soundBuffers = {};         // 名称 → AudioBuffer（解码后常驻内存）
const activeSlapSources = [];    // 播放中的 slap source（拖动时掐断用）
let audioWarmedUp = false;       // 音频是否已预热/解码（只做一次）
let dragging = false;          // 是否正在拖拽窗口
let dragWin = null;            // 当前 WebviewWindow
let dragStartPointerX = 0;     // 按下时鼠标屏幕坐标（CSS 像素）
let dragStartPointerY = 0;
let dragStartWinX = 0;         // 按下时窗口 outerPosition（CSS 像素）
let dragStartWinY = 0;
let lastPointerX = 0;          // 上次 pointermove 鼠标坐标
let lastPointerY = 0;
let dragVelX = 0;              // 平滑后的鼠标速度（px/s）
let dragVelY = 0;
let headTilt = 0;              // 身体倾斜角（deg，鼠标左右移动驱动）
let bodyOffsetX = 0;           // 身体横向滞后偏移（px）
let bodyOffsetXV = 0;          // 身体滞后速度
let stretchUp = 0;             // 向上拉长量（0~MAX，鼠标上移驱动）
let stretchUpV = 0;            // 向上拉长弹簧速度
let lastDragTime = Date.now();
let dragMoved = false;         // 本次按下后是否发生拖动移动（区分点击 vs 拖动，控制音效）

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
// 红温平滑渐变：petHeat 每帧向 targetHeat 缓慢逼近（lerp），
// 让「冒汗」慢慢出现、慢慢消退，避免速率突变导致的突兀跳变。
const HEAT_SMOOTH_UP = 0.06;      // 升温逼近系数（越小越慢，约 1.5s 到顶）
const HEAT_SMOOTH_DOWN = 0.04;    // 降温逼近系数（比升温更慢，消退更柔和）
// 冒汗效果：打字速率快时在小猫头顶出现汗滴（替代原红温染色）。
// petHeat 0~100 → 汗滴数量 1~3 滴，透明度与大小随热度增大。
const SWEAT_MAX_DROPS = 3;        // 最多 3 滴汗
const SWEAT_BASE_X = 52;          // 汗滴中心相对 canvas 的 x 基线（头顶中央）
const SWEAT_X_GAP = 13;           // 相邻汗滴水平间距
const SWEAT_Y_TOP = 4;            // 汗滴顶部 y（头顶上方）
const SWEAT_AMP = 2;              // 汗滴漂浮振幅（px）
const SWEAT_WAVE = 900;           // 汗滴浮动周期（ms）
let petHeat = 0;                  // 当前热度 0~100（平滑渐变后的显示值）
let targetHeat = 0;               // 目标热度（由敲击速率映射，petHeat 向其逼近）
let keyTimes = [];                // 最近敲击时间戳（滑动窗口统计速率）
let sweatT = 0;                   // 汗滴动画相位（随 heatLoop 推进，驱动上下浮动）

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
// 当前品种的眼睛屏幕矩形（drawIdleFrame 每帧更新，applyHeatEffects 用保护）。
let idleEyeRects = null;

// 瞳孔跟随椭圆约束：瞳孔 9×9 在 16×16 眼白框内，边距 3.5px，
// 椭圆半径 X=3 / Y=2.5 保证上下眼白不被遮挡，鼠标绕窗时瞳孔沿椭圆轨道环绕。
const EYE_RADIUS_X = 3;
const EYE_RADIUS_Y = 2.5;
// 瞳孔用「运动速度」驱动：鼠标每次事件之间的位移（≈速度向量）直接驱动瞳孔方向与幅度，
// 快速甩动瞳孔立刻看过去、鼠标静止瞳孔优雅回中。这比「位置差」灵动得多。
// 光标事件现在是 ~16ms 一帧，位移已折算为 px/s →
// EYE_VEL_SCALE=90 等价于原先 100ms 帧率下的 9（9×1000/100=90）。
const EYE_VEL_SCALE = 90;      // 速度 px/s ÷ 90 = 瞳孔偏移（1000px/s → 偏移 ~11px，clamp 到 3）
const EYE_FOLLOW_SMOOTH = 0.42; // 跟随速度（越大响应越快）
const EYE_RETURN_SMOOTH = 0.05; // 回中速度（更慢：驻留后极缓归位，凝视感更强）
const EYE_VEL_SMOOTH = 0.25;   // 瞳孔速度低通：16ms 帧单帧位移很小、噪声大，平滑后不抖
let eyeVelSmoothedX = 0;       // 平滑后的瞳孔速度（相对 EYE_VEL_SCALE 单位）
let eyeVelSmoothedY = 0;
// 鼠标静止多久后瞳孔才开始回中（ms）——驻留 2 秒再慢慢转回
const EYE_IDLE_RETURN_MS = 2000;
let lastCursorRawX = null;
let lastCursorRawY = null;
let lastCursorRawT = 0;
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
// 品种动画资源：打字=press-left/right 两张 PNG；喝水/拉伸=9列×4行 sprite sheet。
const SPRITE_DIR = './cat-sprite-sheets/';
let frames = [];
let drinkSpriteSheet = new Image();
let stretchSpriteSheet = new Image();
let drinkFrameW = 0, drinkFrameH = 0;
let stretchFrameW = 0, stretchFrameH = 0;

function loadBreedAnimations() {
  frames = ['press-left', 'press-right'].map((name) => {
    const image = new Image();
    image.src = SPRITE_DIR + currentBreed + '-' + name + '.png';
    return image;
  });
  drinkSpriteSheet = new Image();
  drinkSpriteSheet.src = SPRITE_DIR + currentBreed + '-drink-sprite.png';
  drinkSpriteSheet.onload = () => {
    if (drinkSpriteSheet.naturalWidth > 0) {
      drinkFrameW = Math.floor(drinkSpriteSheet.naturalWidth / 9);
      drinkFrameH = Math.floor(drinkSpriteSheet.naturalHeight / 4);
    }
  };
  stretchSpriteSheet = new Image();
  stretchSpriteSheet.src = SPRITE_DIR + currentBreed + '-stretch-sprite.png';
  stretchSpriteSheet.onload = () => {
    if (stretchSpriteSheet.naturalWidth > 0) {
      stretchFrameW = Math.floor(stretchSpriteSheet.naturalWidth / 9);
      stretchFrameH = Math.floor(stretchSpriteSheet.naturalHeight / 4);
    }
  };
}
// 用户可选的 7 种猫咪品种：数据来自 cat-pixel-matrix/（静态 idle 像素矩阵）。
// 每个品种 = rows（34 行 × 34 列字符矩阵）+ palette（配色表，字符 1-9 → palette[0-8]）。
// 字符 '0' = 透明；字符 n → palette[n-1] 颜色。由 src/cat-breeds.js 提供 window.CAT_BREEDS。
const BREED_KEY = 'pixelcat.breed';
const CAT_BREEDS = window.CAT_BREEDS || {};
const CAT_BREED_IDS = Object.keys(CAT_BREEDS);
const CAT_BREED_DEFAULT = CAT_BREED_IDS[0] || 'black-cat';

// 当前品种 id（localStorage 持久化，默认第一个品种）。
let currentBreed = CAT_BREED_DEFAULT;
try {
  const saved = localStorage.getItem(BREED_KEY);
  if (saved && CAT_BREEDS[saved]) currentBreed = saved;
} catch { /* localStorage 不可用则用默认 */ }

// currentBreed 就绪后才加载品种动画资源（避免 TDZ ReferenceError）。
loadBreedAnimations();

function getBreedRows() {
  const b = CAT_BREEDS[currentBreed];
  return (b && b.rows) ? b.rows : [];
}
function getBreedPalette() {
  const b = CAT_BREEDS[currentBreed];
  return (b && b.palette) ? b.palette : ['#FFFFFF', '#1C1C1C'];
}
function getBreedName() {
  const b = CAT_BREEDS[currentBreed];
  return (b && b.name) || currentBreed;
}
function setBreed(id) {
  if (!CAT_BREEDS[id]) return;
  currentBreed = id;
  try { localStorage.setItem(BREED_KEY, id); } catch { /* 仅内存生效 */ }
  loadBreedAnimations(); // 切换品种立刻换全部动画资源
  if (petState !== 'typing') drawIdleFrame();
}

function drawIdleFrame() {
  const rows = getBreedRows();
  if (rows.length === 0) return;
  const palette = getBreedPalette();
  const cell = 3;
  const width = rows[0].length * cell;
  const height = rows.length * cell;
  // 新矩阵 34×34，画布 128×128 → 猫主体 102×102，垂直居中对齐
  const originX = Math.round((canvas.width - width) / 2);
  const originY = Math.round((canvas.height - height) / 2);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 逐像素上色：字符 '0' 透明，字符 n → palette[n-1]。
  // 新矩阵的白色描边/眼睛/花纹都已在像素里，直接按调色板着色。
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const code = row.charCodeAt(x) - 48; // '0'=0, '1'=1 ...
      if (code === 0) continue;
      const color = palette[code - 1];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(originX + x * cell, originY + y * cell, cell, cell);
    }
  }

  // ---- 灵动眼睛：盖掉矩阵里的静态眼睛块 ----
  // 眼睛在 34×36 矩阵中为 3×3 像素（1-indexed：行 11-13，左眼列 9-11，右眼列 18-20）。
  // 原版观感：白眼球底 + 黑瞳孔，瞳孔随鼠标转动；眨眼=闭眼横线；瞌睡=细眯眼。
  const LE = { x: originX + 8 * cell, y: originY + 10 * cell, w: 3 * cell, h: 3 * cell };
  const RE = { x: originX + 17 * cell, y: originY + 10 * cell, w: 3 * cell, h: 3 * cell };
  idleEyeRects = [LE, RE]; // 供红温保护使用（眼睛不染红）
  const eyeWhite = palette[0] || '#FFFFFF';
  const eyeDark = palette[1] || '#1C1C1C';
  const sleeping = petState === 'sleep';
  const blinking = petState === 'blink' || sleeping;
  // 瞳孔 3×3 cell（9×9px = 眼白大小），跟随鼠标偏移 ±1px → 转动时两侧露出眼白边。
  const ex = Math.max(-1, Math.min(1, Math.round(eyeOffsetX * 0.35)));
  const ey = Math.max(-1, Math.min(1, Math.round(eyeOffsetY * 0.35)));
  const pupilW = cell * 3;
  const pupilH = cell * 3;
  // 闭眼时眼睛区域填充的「周围毛色」：取 palette 里第 3 个颜色（多数品种是脸部主毛色），
  // 若不存在则退化为 palette[1]（身体色）。黑猫 palette=[#FFFFFF,#1C1C1C]，退化为黑色 →
  // 眼睛区域被黑毛盖住，和脸融为一体。
  const furColor = palette[2] || palette[1] || eyeDark;
  // 眨眼时眼睛区域先用毛色填平（盖掉矩阵里的白眼球），再画一条深色闭合横线。
  // 瞌睡时用毛色填平后画两条淡色细横线（= 表示闭着的眼睛）。
  // closedLineY1/Y2、lineW 依赖 eye，必须在循环内计算。
  for (const eye of [LE, RE]) {
    const lineW = Math.max(1, Math.round(cell * 0.66));
    if (sleeping) {
      // 瞌睡：先用毛色覆盖「眼白 + 周围白色描边轮廓」整个区域（让眼睛完全融入脸部），
      // 再每只闭合眼睛中央画一条淡色细横线（左眼一条、右眼一条）。
      ctx.fillStyle = furColor;
      ctx.fillRect(eye.x - cell, eye.y - cell, eye.w + cell * 2, eye.h + cell * 2);
      ctx.fillStyle = eyeWhite;
      ctx.fillRect(eye.x + Math.round(cell * 0.5), eye.y + Math.round(eye.h * 0.45), eye.w - cell, lineW);
    } else if (blinking) {
      // 眨眼：同样先盖掉眼白与白色描边，再画一条深色横线。
      ctx.fillStyle = furColor;
      ctx.fillRect(eye.x - cell, eye.y - cell, eye.w + cell * 2, eye.h + cell * 2);
      ctx.fillStyle = eyeDark;
      ctx.fillRect(eye.x + Math.round(cell * 0.5), eye.y + Math.round(eye.h * 0.45), eye.w - cell, lineW);
    } else {
      // 睁眼：白眼球底 + 瞳孔 2×2 cell 居中，随鼠标转动（±1px 抖动感）
      ctx.fillStyle = eyeWhite;
      ctx.fillRect(eye.x, eye.y, eye.w, eye.h);
      ctx.fillStyle = eyeDark;
      ctx.fillRect(
        eye.x + Math.round((eye.w - pupilW) / 2) + ex,
        eye.y + Math.round((eye.h - pupilH) / 2) + ey,
        pupilW,
        pupilH
      );
    }
  }

  // 打字红温后处理层（眼睛区域保护，不染红）。
  applyHeatEffects();
}

// 像素猫眼睛：4 个白色矩形（上、下、左、右）围框 + 中央黑色瞳孔。
// 原版 drawPixelEyes 仅打字帧眼睛参考（待机眼睛已由 drawIdleFrame 灵动眼睛替代）。
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
  // 睡觉时循环呼噜声，醒来停止
  if (nextState === 'sleep') startPurr();
  else stopPurr();
  // 喝水/拉伸动画期间：状态照常切换（记录 petState），但不重绘，保持覆盖帧
  if (isOverlayActive()) return;
  if (nextState !== 'typing') drawIdleFrame();
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    if (petState === 'idle' && !isOverlayActive()) {
      setPetState('blink');
      setTimeout(() => {
        if (petState === 'blink') setPetState('idle');
      }, 160);
    }
    scheduleBlink();
  }, 3000 + Math.random() * 4000);
}

function updateIdleState() {
  if (isOverlayActive()) return; // 覆盖动画期间保持覆盖帧，不切睡眠
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
  // 覆盖动画期间：只叠加红温后处理，不覆盖覆盖帧
  if (isOverlayActive()) {
    if (petHeat > 0) redrawOverlay();
    return;
  }
  advanceOneFrame();
  setPetState('typing');
  clearTimeout(typingStateTimer);
  typingStateTimer = setTimeout(() => {
    if (petState === 'typing') setPetState('idle');
  }, TYPING_VISIBLE_MS);
}

// ---- 打字红温实现 ----
// 由滑动窗口打字速率计算「目标红温强度」：速率 ≤ 阈值 → 0（完全不红）；
// 速率达到 HEAT_RATE_MAX → 100（满红温）；之间线性渐变。
// 关键：速率只更新 targetHeat，petHeat 每帧向 targetHeat 缓慢逼近（lerp），
// 让红温「慢慢变红、慢慢消退」，避免速率突变导致的突兀跳变。
function updateHeat() {
  const now = Date.now();
  // 清理窗口外的旧敲击记录。
  while (keyTimes.length > 0 && now - keyTimes[0] > HEAT_RATE_WINDOW_MS) {
    keyTimes.shift();
  }
  const rate = keyTimes.length; // 最近 1 秒内的敲击次数 = 每秒速率
  if (rate <= HEAT_RATE_THRESHOLD) {
    targetHeat = 0;
  } else {
    targetHeat = Math.min(
      HEAT_MAX,
      ((rate - HEAT_RATE_THRESHOLD) / (HEAT_RATE_MAX - HEAT_RATE_THRESHOLD)) * HEAT_MAX
    );
  }
  // petHeat 向 targetHeat 平滑逼近：升温用 HEAT_SMOOTH_UP，降温用 HEAT_SMOOTH_DOWN。
  // 每帧（heatLoop 100ms）逼近一次，系数越小过渡越慢越柔和。
  const smooth = targetHeat > petHeat ? HEAT_SMOOTH_UP : HEAT_SMOOTH_DOWN;
  petHeat += (targetHeat - petHeat) * smooth;
  // 收敛到极小值时归零（避免残留极淡的红色）。
  if (petHeat < 0.5) petHeat = 0;
}

// 把当前热度映射为「头顶冒汗」效果：在 canvas 顶部绘制蓝色汗滴。
// 速率 ≤ 阈值时 petHeat=0 完全不渲染；超过后汗滴数量/透明度/大小随热度渐变，
// 逐渐浮现、逐渐消退（由 heatLoop 的 petHeat lerp 保证平滑）。
function applyHeatEffects() {
  if (petHeat <= 0) return;

  // 汗滴数量：0~100 热度 → 0/1/2/3 滴（前 35% 1 滴、70% 2 滴、满 3 滴）
  const t = Math.min(1, petHeat / HEAT_MAX);
  const dropCount = t <= 0.35 ? 1 : (t <= 0.7 ? 2 : SWEAT_MAX_DROPS);
  // 透明度：低热度淡、满热度实（汗滴是半透明水珠，不像红温那么浓）
  const alpha = 0.35 + 0.5 * t;
  const phase = (performance.now() / SWEAT_WAVE) * Math.PI * 2;

  // 汗滴大小随热度：满热度时稍大
  const radius = 3.5 + 1.2 * t;

  for (let i = 0; i < dropCount; i++) {
    // 汗滴沿头顶水平分布，居中偏右（避开猫耳朵），上下轻微浮动模拟「鼓出」的汗珠
    const cx = SWEAT_BASE_X + (i - (dropCount - 1) / 2) * SWEAT_X_GAP;
    const bob = Math.sin(phase + i * 1.3) * SWEAT_AMP;
    const cy = SWEAT_Y_TOP + radius + bob;

    // 汗滴本体：天蓝色半透明，圆形
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#7EC8FF';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    // 高光：左上一小块白色，增强水珠立体感
    ctx.globalAlpha = Math.min(1, alpha * 0.9);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx - radius * 0.35, cy - radius * 0.35, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// 热度主循环：冷却 + 有热度时重绘当前帧（冒汗随热度平滑渐变）。
// 喝水动画播放期间：保持喝水帧（heatLoop 不覆盖喝水帧内容）。
function heatLoop() {
  updateHeat();
  if (isOverlayActive()) {
    // 覆盖动画期间：只重绘冒汗，不重画帧
    if (petHeat > 0) redrawOverlay();
    return;
  }
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

  // 空闲（不拖拽）时：Rust 光标事件 ~16ms 一帧持续推送 x/y（屏幕坐标 CSS 像素），
  // 用它更新 lastPointerX/Y → dragLoop 计算空闲鼠标速度 → 身体朝鼠标移动方向拉伸。
  if (!dragging) {
    lastPointerX = point.x;
    lastPointerY = point.y;
  }

  // 1) 运动速度驱动：本次与上次光标的位移 ÷ 实际间隔 = 速度（px/s），驱动瞳孔方向。
  let velX = 0;
  let velY = 0;
  if (lastCursorRawX !== null) {
    const dt = Math.max(Date.now() - lastCursorRawT, 1);
    velX = (point.x - lastCursorRawX) * (1000 / dt);
    velY = (point.y - lastCursorRawY) * (1000 / dt);
    if (velX !== 0 || velY !== 0) lastCursorMoveTime = Date.now();
  }
  lastCursorRawX = point.x;
  lastCursorRawY = point.y;
  lastCursorRawT = Date.now();

  // 2) 期望瞳孔偏移：速度 ÷ 灵敏度，方向即鼠标运动方向。
  //    16ms 帧单帧位移噪声大 → 目标先过低通平滑，再 clamp。
  //    鼠标静止超过 IDLE_RETURN_MS 后目标回中（眼睛自然凝望）。
  let tx, ty;
  if (Date.now() - lastCursorMoveTime > EYE_IDLE_RETURN_MS) {
    tx = 0;
    ty = 0;
  } else {
    eyeVelSmoothedX += (velX / EYE_VEL_SCALE - eyeVelSmoothedX) * EYE_VEL_SMOOTH;
    eyeVelSmoothedY += (velY / EYE_VEL_SCALE - eyeVelSmoothedY) * EYE_VEL_SMOOTH;
    tx = Math.max(-EYE_RADIUS_X, Math.min(EYE_RADIUS_X, eyeVelSmoothedX));
    ty = Math.max(-EYE_RADIUS_Y, Math.min(EYE_RADIUS_Y, eyeVelSmoothedY));
  }

  // 3) 椭圆环绕约束：超出椭圆半径则沿方向压缩回边界。
  const nx = tx / EYE_RADIUS_X;
  const ny = ty / EYE_RADIUS_Y;
  const norm = Math.hypot(nx, ny);
  if (norm > 1) {
    tx = (nx / norm) * EYE_RADIUS_X;
    ty = (ny / norm) * EYE_RADIUS_Y;
  }
  // 目标为回中(0,0)时用慢速回中 → 眼睛驻留更久、缓缓归位；跟随鼠标时仍快速
  const followSmooth = (tx === 0 && ty === 0) ? EYE_RETURN_SMOOTH : EYE_FOLLOW_SMOOTH;
  eyeOffsetX += (tx - eyeOffsetX) * followSmooth;
  eyeOffsetY += (ty - eyeOffsetY) * followSmooth;
  // 覆盖动画期间：不重绘 idle（保持覆盖帧），仅当有红温时刷新后处理
  if (isOverlayActive()) {
    if (petHeat > 0) redrawOverlay();
    return;
  }
  if (petState !== 'typing') drawIdleFrame();
}

// ---- 身体底部锚定形变：rAF 物理 ----
// 与拖拽同款模型：猫底部钉在窗口内不动（transform-origin: 50% 100%），
// 鼠标上移 → 身体从底部向上拉长；左/右移 → 身体向该方向倾斜 + 横向滞后；
// 空闲与拖拽共用同一套模型，只是幅度更小、更柔。
let lastPointerXLast = 0;
let lastPointerYLast = 0;
let lastPointerLast = false;
let lastIdleMoveTime = 0; // 上次空闲鼠标移动时刻

function dragLoop() {
  // 速度：上一帧到本帧的鼠标位移 ÷ 间隔（拖动中由 pointermove 更新 lastPointerX/Y）
  const now = performance.now();
  const dt = Math.max(now - lastDragTime, 1);
  lastDragTime = now;
  let vxScreen = 0;
  let vyScreen = 0;
  if (lastPointerLast) {
    vxScreen = (lastPointerX - lastPointerXLast) / (dt / 1000);
    vyScreen = (lastPointerY - lastPointerYLast) / (dt / 1000);
  }
  lastPointerXLast = lastPointerX;
  lastPointerYLast = lastPointerY;
  lastPointerLast = true;

  // ---- 速度平滑（拖拽/空闲各自幅度）----
  // 拖拽：speed 平滑快、幅度上限大
  // 空闲：平滑慢、幅度上限小
  let maxStretch, maxTilt, lagSmooth, velSmooth;
  if (dragging) {
    maxStretch = STRETCH_MAX_DRAG;  // 0.3（更明显的拉长）
    maxTilt = TILT_MAX_DRAG;        // 16°（明显倾斜）
    lagSmooth = BODY_LAG_SMOOTH;    // 0.12
    velSmooth = 0.3;
  } else {
    maxStretch = STRETCH_MAX_IDLE;  // 0.03（极轻微拉长）
    maxTilt = TILT_MAX_IDLE;        // 2°（极轻微倾斜）
    lagSmooth = 0;                  // 空闲不产生横向位移 → 小猫位置完全不变（只绕底部倾斜+拉长）
    velSmooth = 0.35;
  }

  // 平滑屏幕速度（避免单帧抖动）
  dragVelX += (vxScreen - dragVelX) * velSmooth;
  dragVelY += (vyScreen - dragVelY) * velSmooth;
  // 空闲静止：驻留 2 秒后速度才开始缓慢衰减 → 身体形变保持更久、回正更慢
  if (!dragging && now - lastIdleMoveTime > 2000) {
    dragVelX *= 0.92;
    dragVelY *= 0.92;
  }

  // ---- 向上拉长（scaleY，底部锚定）----
  // 鼠标上移（vy < 0）→ 拉长；下移 → 回正；速度越快拉得越多（clamp 上限）
  // 触发阈值 50px/s：只有明显向上移动才有一丝形变，慢移不触发
  const velUp = -dragVelY; // 向上速度为正
  const targetStretch = velUp > 50 ? Math.min(maxStretch, velUp / STRETCH_SPEED_SCALE) : 0;
  stretchUpV += (targetStretch - stretchUp) * STRETCH_SMOOTH;
  stretchUpV *= STRETCH_DAMP;
  stretchUp += stretchUpV;
  // 向下移明确回正（不残留）
  if (dragVelY > 50) { stretchUp = 0; stretchUpV = 0; }

  // ---- 左右倾斜（rotate）----
  // 鼠标右移 → 头向右倾（+deg）；左移 → 左侧；触发阈值 50px/s
  const targetTilt = Math.max(-maxTilt, Math.min(maxTilt, dragVelX / 320));
  headTilt += (targetTilt - headTilt) * TILT_SMOOTH;

  // ---- 身体横向滞后（translateX，跟随但慢半拍；仅拖拽）----
  // 空闲时 lagSmooth=0 → 不产生横向位移，小猫锚在原地，只有倾斜/拉长形变。
  let targetBodyX = 0;
  if (dragging) {
    targetBodyX = dragVelX > 30 ? Math.min(14, dragVelX / 70) : dragVelX < -30 ? Math.max(-14, dragVelX / 70) : 0;
  }
  bodyOffsetXV += (targetBodyX - bodyOffsetX) * lagSmooth;
  bodyOffsetXV *= BODY_LAG_DAMP;
  bodyOffsetX += bodyOffsetXV;

  // 鼠标静止驻留 2 秒后，身体形变才慢速回正（回正比之前更慢）
  if (!dragging && Math.abs(vxScreen) < 5 && Math.abs(vyScreen) < 5 && now - lastIdleMoveTime > 2000) {
    bodyOffsetX *= 0.96;
    headTilt *= 0.965;
  }

  // ---- 组装 transform（底部锚定）----
  // translateX(身体滞后) rotate(倾斜) scaleY(1+拉长)
  // origin 底部：整个形变像猫脚钉在地上、身体向上/侧向延伸
  petWrapper.style.transformOrigin = '50% 100%';
  petWrapper.style.transform =
    `translateX(${bodyOffsetX.toFixed(2)}px) rotate(${headTilt.toFixed(2)}deg) scaleY(${(1 + stretchUp).toFixed(4)})`;

  // ---- 归零：彻底复位让 CSS 动画接管 ----
  if (stretchUp < 0.004 && Math.abs(headTilt) < 0.5 && Math.abs(bodyOffsetX) < 0.5) {
    stretchUp = 0; stretchUpV = 0;
    headTilt = 0;
    bodyOffsetX = 0; bodyOffsetXV = 0;
    petWrapper.style.transformOrigin = '';
    petWrapper.style.transform = 'none';
    requestAnimationFrame(dragLoop);
    return;
  }

  requestAnimationFrame(dragLoop);
}

// fetch + decodeAudioData：把 mp3 解码为 AudioBuffer 常驻内存。
// 解码完成后 soundBuffers[name] 就绪，此后播放**零延迟、永不丢声**。
function loadSound(name, url) {
  if (!soundCtx) return;
  fetch(url)
    .then((res) => res.arrayBuffer())
    .then((data) => decodeIntoBuffer(name, data))
    .catch(() => { /* 音频加载失败静默忽略 */ });
}

// 解码 AudioBuffer：兼容 Promise 与回调两种 WKWebView 实现。
// 关键：检测到 Promise 风格就只用 Promise，否则只走回调，绝不同时执行两遍。
function decodeIntoBuffer(name, data) {
  let promise = null;
  let callbackMode = false;
  try {
    promise = soundCtx.decodeAudioData(data);
  } catch (err) {
    callbackMode = true;
  }
  if (promise && typeof promise.then === 'function') {
    promise
      .then((buf) => { soundBuffers[name] = buf; })
      .catch(() => { /* 解码失败忽略 */ });
    return;
  }
  // 回调风格（旧版本 decodeAudioData 返回 undefined 且需传回调）
  if (!callbackMode && promise === undefined) {
    callbackMode = true;
  }
  if (callbackMode) {
    let settled = false;
    const finish = (buf) => {
      if (settled) return;
      settled = true;
      soundBuffers[name] = buf;
    };
    try {
      soundCtx.decodeAudioData(data, finish, () => { settled = true; });
    } catch (err) {
      settled = true;
    }
  }
}

// 循环播放的 source（呼噜声）：单例常驻，睡着循环、醒来即停。
let purrSource = null;
const PURR_VOLUME = 0.1; // 呼噜声音量（原声的 1/10，作为背景白噪音）
function startPurr() {
  if (!soundCtx || !soundBuffers['purring'] || purrSource) return;
  // 音量控制：GainNode 把 LoopSource 输出压到 0.1（1/10），
  // 这样呼噜声是轻柔背景，不盖过其他提示音。
  const src = soundCtx.createBufferSource();
  src.buffer = soundBuffers['purring'];
  src.loop = true;
  const gain = soundCtx.createGain();
  gain.gain.value = PURR_VOLUME;
  src.connect(gain);
  gain.connect(soundCtx.destination);
  src.start();
  purrSource = src;
}
function stopPurr() {
  if (!purrSource) return;
  try { purrSource.stop(); } catch (err) { /* 已停止则忽略 */ }
  purrSource = null;
}

// 播放已解码的 AudioBuffer：每次新建 BufferSource → 连点多少次响多少次，
// 互不打断、不丢声。限制最大并发 MAX_SOUND_CONCURRENCY：超过时自动
// 掐断最旧的声音再播新的（防极端连点爆音/内存堆积，同时保证最新一次必响）。
const MAX_SOUND_CONCURRENCY = 8;
function playBuffer(name) {
  if (!soundCtx || !soundBuffers[name]) return false;
  const src = soundCtx.createBufferSource();
  src.buffer = soundBuffers[name];
  src.connect(soundCtx.destination);
  src.start();
  return src;
}

// 播放并登记到并发池：超过上限时掐掉最旧的（保留最新）。
function playTracked(name) {
  if (!soundCtx) return null;
  const src = playBuffer(name);
  if (!src) return null;
  activeSlapSources.push(src);
  while (activeSlapSources.length > MAX_SOUND_CONCURRENCY) {
    const old = activeSlapSources.shift();
    try { old.stop(); } catch (err) { /* 已停止则忽略 */ }
  }
  return src;
}

// 播放敲击音效：Web Audio 同步播放，连点多少次响多少次、永不丢失。
async function playSlap() {
  if (!soundCtx) return;
  // 先 await resumeAudio()：首次点击（AudioContext suspended）时等 resume
  // 完成再 start()，确保第一下也立即出声（避免被 suspended 状态丢弃）。
  await resumeAudio();
  const src = playTracked('slap');
  if (src) {
    src.onended = () => {
      const i = activeSlapSources.indexOf(src);
      if (i >= 0) activeSlapSources.splice(i, 1);
    };
  }
}

// 判定为拖动时立即掐断已播放的音效（按下瞬间已响，拖动开始就静音）。
function stopSlap() {
  for (const src of activeSlapSources) {
    try { src.stop(); } catch (err) { /* 已停止则忽略 */ }
  }
  activeSlapSources.length = 0;
}

// 播放鼠标点击音效：Web Audio 同步播放，跟手零延迟。
async function playMouseClick() {
  if (!soundCtx) return;
  // 先 await resumeAudio()：番茄钟/名字按钮第一下点击（AudioContext suspended）
  // 时等 resume 完成再 start()，确保第一下立即有声（避免被 suspended 丢弃）。
  await resumeAudio();
  playBuffer('mouse-click');
}

// 预加载+解码音频：页面加载时就调用（decodeAudioData 不依赖用户手势，
// suspended 状态也可解码）。完成后 soundBuffers 常驻 → **首次点击就出声**，
// 永不因「首次解码慢」而丢声（这正是之前偶发无音的根因）。
function initSoundSystem() {
  if (!soundCtx) return;
  loadSound('slap', './slap.mp3');
  loadSound('mouse-click', './mouse-click.mp3');
  loadSound('meow-alert', './meow-alert.m4a');
  loadSound('meow', './meow.m4a');
  loadSound('purring', './purring.m4a');
}

// ---- 喝水动画（drink-sprite-sheet.png：原版 drinking 动画 36 帧序列帧）----
// 由 playwright 把 cat-idle-follow-v2.svg 的 drinking CSS 动画逐帧渲染成
// sprite sheet（9 列 × 4 行，FPS 12，3 秒 36 帧，单帧 257×180，白底已色键转透明）。
// 喝水提醒/打卡期间按 12fps 播放该序列，展示原版「俯身喝水 + 水碗 + 舌头舔水」。
const DRINK_COLS = 9;
const DRINK_ROWS = 4;
const DRINK_FRAME_COUNT = 36;
const DRINK_FPS = 12;
const DRINK_FRAME_MS = 1000 / DRINK_FPS;
let drinkFrameIndex = 0;   // 当前喝水帧 0~35
let drinkPhase = null;     // 'animating' 播放中 / null 停
function drawDrinkFrame() {
  if (!drinkSpriteSheet.complete || drinkFrameW === 0) return;
  const i = drinkFrameIndex % DRINK_FRAME_COUNT;
  const sx = (i % DRINK_COLS) * drinkFrameW;
  const sy = Math.floor(i / DRINK_COLS) * drinkFrameH;
  // 整帧清空后绘制：喝水动画期间 canvas 上只有喝水动画，没有原先小猫
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 按品种帧实际宽高等比缩放到 128×128 canvas 内（垂直居中）
  const dh = drinkFrameH * (canvas.width / drinkFrameW);
  const dy = Math.round((canvas.height - dh) / 2);
  ctx.drawImage(
    drinkSpriteSheet,
    sx, sy, drinkFrameW, drinkFrameH,
    0, dy, canvas.width, dh
  );
  // 红温后处理（猫身变红，眼睛保护区不染）
  applyHeatEffects();
}

// 喝水动画帧推进（drinkLoop 计时器）
function drinkTick() {
  if (drinkPhase !== 'animating') return;
  drinkFrameIndex += 1;
  drawDrinkFrame();
}

// 开始喝水动画：重置到第 0 帧，启动 12fps 帧推进。
// sprite sheet 未加载完成时回退到 existing 打字帧（保证不白屏）。
function startDrinkAnimation() {
  drinkPhase = 'animating';
  drinkFrameIndex = 0;
  if (drinkSpriteSheet.complete && drinkSpriteSheet.naturalWidth > 0) {
    drawDrinkFrame();
  } else {
    // 图片尚在加载：先显示打字帧兜底，加载完成后立即切回喝水帧
    advanceOneFrame();
    drinkSpriteSheet.onload = () => {
      if (drinkPhase === 'animating') drawDrinkFrame();
    };
  }
}

// 停止喝水动画：停表 + 恢复（喝水和拉伸覆盖同时存在时保持另一覆盖帧）。
function stopDrinkAnimation() {
  drinkPhase = null;
  if (stretchPhase !== null) drawStretchFrame();
  else if (petState === 'typing') drawFrame(frameIndex);
  else drawIdleFrame();
}

// ---- 拉伸动画（stretch-sprite-sheet.png：原版 stretch 动画 36 帧序列帧）----
// 与喝水动画同架构：拉伸提醒期间小猫消失，12fps 播放 36 帧；播完**停在最后一帧**
// （不循环），保持到提醒窗口结束再由 stopStretchAnimation 恢复小猫。
const STRETCH_COLS = 9;
const STRETCH_ROWS = 4;
const STRETCH_FRAME_COUNT = 36;
const STRETCH_FPS = 12;
const STRETCH_FRAME_MS = 1000 / STRETCH_FPS;
let stretchFrameIndex = 0;   // 当前拉伸帧 0~35
let stretchPhase = null;     // 'animating' 播放中 / 'finished' 停在最后一帧 / null 停

function drawStretchFrame() {
  if (!stretchSpriteSheet.complete || stretchFrameW === 0) return;
  const i = stretchFrameIndex % STRETCH_FRAME_COUNT;
  const sx = (i % STRETCH_COLS) * stretchFrameW;
  const sy = Math.floor(i / STRETCH_COLS) * stretchFrameH;
  // 整帧清空后绘制：拉伸动画期间 canvas 上只有拉伸动画，没有原先小猫
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 按品种帧实际宽高等比缩放到 128×128 canvas 内（垂直居中）
  const dh = stretchFrameH * (canvas.width / stretchFrameW);
  const dy = Math.round((canvas.height - dh) / 2);
  ctx.drawImage(
    stretchSpriteSheet,
    sx, sy, stretchFrameW, stretchFrameH,
    0, dy, canvas.width, dh
  );
  // 红温后处理（猫身变红，眼睛保护区不染）
  applyHeatEffects();
}

// 拉伸动画帧推进（12fps 由 init 的 setInterval 驱动）：播完停在最后一帧。
function stretchTick() {
  if (stretchPhase !== 'animating') return;
  stretchFrameIndex += 1;
  if (stretchFrameIndex >= STRETCH_FRAME_COUNT) {
    stretchPhase = 'finished'; // 停最后一帧，不再推进
    drawStretchFrame();
    return;
  }
  drawStretchFrame();
}

// 开始拉伸动画：重置到第 0 帧。sprite 未加载完成时回退打字体兜底。
function startStretchAnimation() {
  stretchPhase = 'animating';
  stretchFrameIndex = 0;
  if (stretchSpriteSheet.complete && stretchSpriteSheet.naturalWidth > 0) {
    drawStretchFrame();
  } else {
    advanceOneFrame();
    stretchSpriteSheet.onload = () => {
      if (stretchPhase !== null) drawStretchFrame();
    };
  }
}

// 停止拉伸动画：恢复原有小猫（喝水覆盖仍存在则保持喝水帧）。
function stopStretchAnimation() {
  stretchPhase = null;
  if (drinkPhase !== null) drawDrinkFrame();
  else if (petState === 'typing') drawFrame(frameIndex);
  else drawIdleFrame();
}

// 喝水/拉伸任一覆盖动画播放中（含拉伸停在最后一帧）→ 其余绘制全部让路。
function isOverlayActive() {
  return drinkPhase !== null || stretchPhase !== null;
}

// 重绘当前覆盖动画帧（喝水优先于拉伸停止逻辑，这里拉伸优先显示前者播完）。
function redrawOverlay() {
  if (stretchPhase !== null) drawStretchFrame();
  else if (drinkPhase !== null) drawDrinkFrame();
}

// 首次用户交互（pointerdown）时把 AudioContext 从 suspended 切到 running。
// 只有这一步需要用户手势；解码早已完成，此时播放立即出声。
function resumeAudio() {
  if (audioWarmedUp) return Promise.resolve();
  audioWarmedUp = true;
  if (!soundCtx || soundCtx.state !== 'suspended') {
    // 若已经 running（如某次播放已预热）且猫正在睡 → 补循环呼噜
    if (petState === 'sleep') startPurr();
    return Promise.resolve();
  }
  return soundCtx.resume().then(() => {
    // 首次交互预热完成：若猫正在睡 → 补循环呼噜
    if (petState === 'sleep') startPurr();
  }).catch(() => {});
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
// 小猫品种选择（中文弹窗）：右键菜单「更换小猫」→ 打开弹窗 → 点击品种
// ============================================================
const catDialog = document.getElementById('cat-dialog');
const catGrid = catDialog ? catDialog.querySelector('.cat-grid') : null;
const catCloseBtn = catDialog ? catDialog.querySelector('.cat-close') : null;

function buildCatGrid() {
  if (!catGrid) return;
  catGrid.innerHTML = '';
  for (const id of CAT_BREED_IDS) {
    const b = CAT_BREEDS[id];
    if (!b) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.name;
    btn.dataset.breed = id;
    btn.addEventListener('click', () => {
      setBreed(id);
      // 选中态高亮
      catGrid.querySelectorAll('button').forEach((el) => {
        el.classList.toggle('cat-selected', el.dataset.breed === id);
      });
      closeCatDialog();
      showToast(`已换成${b.name} 🐱`);
    });
    catGrid.appendChild(btn);
  }
}

function refreshCatSelection() {
  if (!catGrid) return;
  catGrid.querySelectorAll('button').forEach((el) => {
    el.classList.toggle('cat-selected', el.dataset.breed === currentBreed);
  });
}

function openCatDialog() {
  if (!catDialog) return;
  buildCatGrid();
  refreshCatSelection();
  catDialog.classList.add('open');
}

function closeCatDialog() {
  if (!catDialog) return;
  catDialog.classList.remove('open');
}

if (catDialog && catCloseBtn) {
  catCloseBtn.addEventListener('click', closeCatDialog);
  // 点弹窗外空白处关闭
  catDialog.addEventListener('click', (e) => {
    if (e.target === catDialog) closeCatDialog();
  });
}

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
  // OK/× 按钮：按下瞬间播放点击音效（pointerdown 提前，跟手同步）
  nameOkBtn.addEventListener('pointerdown', () => playMouseClick());
  nameCancelBtn.addEventListener('pointerdown', () => playMouseClick());
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
// 喝水提醒（轻量版：智能调度 + 点击打卡 + 进度水色 + 目标庆祝）
// ============================================================
// localStorage 持久化的当日饮水状态：
//   { date: 'YYYY-MM-DD', drunkML: 800, lastDrinkAt: 1712345678901, celebrated: false }
// 日期变更自动重置（每日目标重新从 0 开始），无需手动清零。
function invoke(command, args) {
  const T = window.__TAURI__;
  if (T && T.core && T.core.invoke) {
    return T.core.invoke(command, args).catch(() => {});
  }
  return Promise.resolve();
}

// 当前日期字符串（本地时区 'YYYY-MM-DD'，跨日判断用）。
function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 从 localStorage 载入今日饮水状态；换天/数据损坏时自动重置。
// 返回 { needRedraw }：跨日重置后需要重绘（清掉昨天的水色痕迹）。
function loadWaterState() {
  let needRedraw = false;
  try {
    const raw = localStorage.getItem(WATER_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === todayStr() && typeof parsed.drunkML === 'number') {
        waterState = {
          date: parsed.date,
          drunkML: Math.max(0, Math.min(parsed.drunkML, 99999)),
          lastDrinkAt: typeof parsed.lastDrinkAt === 'number' ? parsed.lastDrinkAt : 0,
          celebrated: !!parsed.celebrated,
          log: Array.isArray(parsed.log) ? parsed.log : [],
        };
        return needRedraw;
      }
    }
  } catch {
    // localStorage 不可用 → 保持默认空状态
  }
  waterState = { date: todayStr(), drunkML: 0, lastDrinkAt: 0, celebrated: false, log: [] };
  needRedraw = true;
  try {
    localStorage.setItem(WATER_STATE_KEY, JSON.stringify(waterState));
  } catch {
    // 写失败仅内存生效
  }
  return needRedraw;
}

function saveWaterState() {
  try {
    localStorage.setItem(WATER_STATE_KEY, JSON.stringify(waterState));
  } catch {
    // localStorage 不可用时仅内存生效
  }
}

// 今日饮水进度 0~1（按 WATER_DAILY_GOAL_ML 计算；超额 clamp 到 1）。
// 只读内存值；跨日时由 date 检查触发重置（避免每 100ms 反复读 localStorage）。
function getWaterProgress() {
  if (waterState.date !== todayStr()) loadWaterState();
  return Math.min(1, waterState.drunkML / WATER_DAILY_GOAL_ML);
}

// ---- 喝水记录图表面板（独立 NSPanel，参考 water_log_pixel.html）----
// 每次打卡把时间点记入 waterState.log；点击「喝水提醒」时调用 Rust 命令
// show_water_log 打开独立的 520×360 喝水记录面板（不挤占小猫主窗口）。
// 面板由 src-tauri/src/lib.rs 的 PanelBuilder 创建，页面为 water-log.html。
function openWaterLogPanel() {
  invoke('show_water_log', {});
}

function closeWaterLogPanel() {
  invoke('hide_water_log', {});
}

// 距上次喝水已过多少分钟；从未喝过 → -1（表示「今天还没开始喝」，应提醒）。
function minutesSinceLastDrink() {
  if (!waterState.lastDrinkAt) return -1;
  return (Date.now() - waterState.lastDrinkAt) / 60000;
}

// 是否已「太久没喝」需加强提醒（距上次喝水 > 90 分钟；从未喝过不算加强，只算首次）。
function isWaterUrgent() {
  const mins = minutesSinceLastDrink();
  return mins >= 0 && mins >= WATER_URGENT_MS / 60000;
}

// 当前处于活跃提醒时段（08:00~23:00）才会自动提醒。
function isWaterActiveHours() {
  const h = new Date().getHours();
  return h >= WATER_ACTIVE_START_HOUR && h < WATER_ACTIVE_END_HOUR;
}

// 是否应自动提醒：活跃时段 + 当日未达标 + 从未喝过（-1）或距上次喝水超冷却期。
function shouldWaterRemind() {
  if (!isWaterActiveHours()) return false;
  if (getWaterProgress() >= 1) return false; // 今日目标已达 → 不再打扰
  const mins = minutesSinceLastDrink();
  return mins < 0 || mins * 60000 >= WATER_COOLDOWN_MS;
}

// 展示喝水提醒：气泡 + 猫抖一下 + 点击猫 = 喝水打卡。
// 加强模式（距上次喝水 > 90 分钟）用更醒目的文案。
function showWaterReminder(urgent) {
  document.body.classList.add('water-active');
  // 注意：播放喝水动画时不弹图表面板（图表面板仅由右键菜单「喝水提醒」主动打开）
  const name = getPetName();
  const who = name ? name : '';
  const base = who ? `${who}，该喝水啦，起来接一杯水吧` : '该喝水啦，起来接一杯水吧';
  const urgentMsg = who ? `${who}，好久没喝水了！点我喝一杯吧` : '好久没喝水了！点我喝一杯吧';
  showToast(urgent ? urgentMsg : base);
  startDrinkAnimation();
  // 首次用户点击后才预热 AudioContext；若已预热则提醒喵声立即播放
  if (audioWarmedUp) playBuffer('meow-alert');
  clearTimeout(waterReminderRestoreTimer);
  waterReminderRestoreTimer = setTimeout(() => {
    document.body.classList.remove('water-active');
    stopDrinkAnimation();
  }, WATER_REMINDER_VISIBLE_MS);
}

// 读取外部触发的提醒强度：距上次喝水 > 90 分钟 → 加强文案。
function externalWaterRemind() {
  showWaterReminder(isWaterUrgent());
}

// 时间调度：在活跃时段内按固定间隔检查。每小时补偿一次跨日/
// 非活跃时间引起的「是否该提醒」，因此无需每天 00:00 的定时器。
function scheduleWaterReminder() {
  if (waterReminderTimer) clearInterval(waterReminderTimer);
  waterReminderTimer = setInterval(() => {
    if (shouldWaterRemind()) showWaterReminder(isWaterUrgent());
  }, WATER_REMINDER_INTERVAL);
}

// ---- 喝水打卡：点击猫 = 喝 200ml ----
// 提醒气泡显示期间点击猫 → 喝水打卡（喝水光晕 8 秒窗口内连点可连续喝多杯）。
function shouldDrinkOnClick() {
  return document.body.classList.contains('water-active') &&
    getWaterProgress() < 1 && // 今日未达标
    isWaterActiveHours();
}

// 打卡喝水：喝 200ml → 猫抖一下 + 进度水色加深；达成目标 → 庆祝气泡。
// 返回 true 表示「这是一次喝水点击」（不应再播放 slap 敲击音）。
function handleWaterDrink() {
  if (isWaterActiveHours()) {
    loadWaterState();
    if (waterState.drunkML < WATER_DAILY_GOAL_ML) {
      waterState.drunkML = Math.min(WATER_DAILY_GOAL_ML, waterState.drunkML + WATER_DRINK_ML);
      waterState.lastDrinkAt = Date.now();
      // 记录本次喝水时间点（图表面板横轴用它画阶梯累计）
      if (!waterState.log) waterState.log = [];
      waterState.log.push({ t: Date.now(), ml: WATER_DRINK_ML });
      const completed = waterState.drunkML >= WATER_DAILY_GOAL_ML;
      if (completed) {
        waterState.celebrated = true;
        saveWaterState();
        showToast('🎉 今日饮水目标达成！');
      } else {
        saveWaterState();
        showToast('💧 咕咚！喝了一杯水 (+200ml)');
      }
      document.body.classList.add('water-active');
      startDrinkAnimation();
      clearTimeout(waterReminderRestoreTimer);
      waterReminderRestoreTimer = setTimeout(() => {
        document.body.classList.remove('water-active');
        stopDrinkAnimation();
      }, WATER_REMINDER_VISIBLE_MS);
      return true;
    }
  }
  return false;
}

// ============================================================
// 休息拉伸提醒
// ============================================================
let stretchTimer = null;
let stretchRestoreTimer = null;

function showStretchReminder() {
  const name = getPetName();
  showToast(name ? `${name}，起来拉伸一下吧！久坐容易疲劳` : '🧘 起来拉伸一下吧！久坐容易疲劳');
  startStretchAnimation();
  // 首次用户点击后才预热 AudioContext；若已预热则拉伸喵声立即播放
  if (audioWarmedUp) playBuffer('meow');
  // 动画播完停在最后一帧，保持到提醒窗口结束再恢复小猫
  clearTimeout(stretchRestoreTimer);
  stretchRestoreTimer = setTimeout(() => {
    stopStretchAnimation();
  }, WATER_REMINDER_VISIBLE_MS);
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

// 暂停/继续按钮：按下瞬间播放点击音效（pointerdown 比 click 提前，跟手同步）
if (pomodoroPauseBtn) {
  pomodoroPauseBtn.addEventListener('pointerdown', () => playMouseClick());
  pomodoroPauseBtn.addEventListener('click', () => {
    if (pomodoroState === 'paused') startPomodoro();
    else pausePomodoro();
  });
}

// 取消按钮
if (pomodoroCancelBtn) {
  pomodoroCancelBtn.addEventListener('pointerdown', () => playMouseClick());
  pomodoroCancelBtn.addEventListener('click', cancelPomodoro);
}

// ============================================================
// Tauri API 初始化
// ============================================================
function init() {
  const T = window.__TAURI__;
  const win = T && T.window ? T.window.getCurrentWindow() : null;

  // 首次用户点击（任意位置）把 AudioContext 切到 running（解码已在 initSoundSystem 完成）
  document.addEventListener('pointerdown', resumeAudio, { once: true });

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
    // 「喝水提醒」菜单点击：播放喝水动画 + 在小猫左上方打开喝水记录图表面板（× 关闭）
    T.event.listen('water-reminder-now', () => {
      showWaterReminder(isWaterUrgent());
      openWaterLogPanel();
    });
    T.event.listen('stretch-reminder-now', () => showStretchReminder());
    T.event.listen('open-pomodoro', () => {
      startPomodoro();
    });
    T.event.listen('open-name-dialog', () => {
      // 点「告诉我名字」菜单项：直接打开名字输入框（无需音效）
      openNameDialog();
    });
    // 点「更换小猫」菜单项：打开中文品种选择弹窗
    T.event.listen('open-cat-dialog', () => {
      openCatDialog();
    });
  }

  // 手动拖动窗口：不用原生 startDragging（它会冻结 WebView 的 rAF，
  // 方向感知形变做不出来）。pointerdown 记录基准，拖动中自动 setPosition 移动窗口。
  const TW = T && T.window ? T.window : null;
  if (win && win.setPosition && TW) {
    dragWin = win;
    // 坐标换算：e.screenX/Y 是逻辑像素（CSS 像素）；Tauri 的
    // outerPosition()/PhysicalPosition 是物理像素 → 乘 devicePixelRatio 换算。
    // 注意 PhysicalPosition 等类是 T.window 命名空间的构造器，不是 win 上的方法。
    const dpr = window.devicePixelRatio || 1;
    canvas.addEventListener('pointerdown', async (e) => {
      if (e.button === 0) {
        // 不在按下时播放 slap（否则拖动会漏音）。
        // 改为 pointerup 时判断：未拖动（敲击）才播，拖动则完全不发声。
        // 左键点击瞬间：播放一次性果冻弹跳（掘金「果冻大法」jelly-jump 简化版）。
        // 只在按下瞬间触发（animation 0.9s 播完 animationend 移除 class → 长按不再触发）。
        canvas.classList.remove('click-jelly');
        void canvas.offsetWidth; // 强制 reflow 让动画每次点击都重新触发
        canvas.classList.add('click-jelly');

        // 捕获指针：鼠标移出窗口后仍能收到 pointermove（拖动持续）
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

        // 记录拖拽基准（屏幕逻辑坐标 + 窗口物理坐标）
        dragging = true;
        dragMoved = false; // 本次按下尚未移动 → 视为点击（敲击）
        try {
          const pos = await win.outerPosition();
          dragStartPointerX = e.screenX;
          dragStartPointerY = e.screenY;
          dragStartWinX = pos.x;
          dragStartWinY = pos.y;
          lastPointerX = e.screenX;
          lastPointerY = e.screenY;
        } catch (err) {
          // outerPosition 失败则放弃本次拖拽
          dragging = false;
        }
      }
    });
    // 拖动中：实时移动窗口 + 更新指针位置（供 dragLoop 计算速度 → 形变）
    // 监听在 canvas 上（配合 setPointerCapture，鼠标移出窗口也能收到）
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.screenX - dragStartPointerX;
      const dy = e.screenY - dragStartPointerY;
      // 移动超过 5px 视为拖拽，不算点击 → 立即掐断敲击音效
      if (Math.hypot(dx, dy) > 5) {
        dragMoved = true;
        stopSlap();
      }
      lastPointerX = e.screenX;
      lastPointerY = e.screenY;
      try {
        win.setPosition(
          new TW.PhysicalPosition(
            Math.round(dragStartWinX + dx * dpr),
            Math.round(dragStartWinY + dy * dpr)
          )
        );
      } catch (err) {
        // 忽略，下一页移动重试
      }
    });
    // 松开：结束拖拽，形变靠 dragLoop 物理阻尼回位
    canvas.addEventListener('pointerup', (e) => {
      if (dragging) {
        dragging = false;
        if (dragMoved) {
          // 拖动过 → 完全无声
          stopSlap();
        } else if (shouldDrinkOnClick()) {
          // 提醒气泡期间点击猫 = 喝水打卡（喝 200ml）
          handleWaterDrink();
        } else {
          // 普通点击猫 → 播放 slap 敲击
          playSlap();
        }
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
    });
    // 兜底：指针丢失（如系统取消）也结束拖拽
    canvas.addEventListener('pointercancel', (e) => {
      if (dragging) {
        dragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
    });
  }
  // 弹跳动画播放完：移除 class，恢复 body.pet-* 控制的待机/眨眼/睡觉/打字动画。
  if (canvas) {
    canvas.addEventListener('animationend', (e) => {
      if (e.animationName === 'pet-click-jelly') {
        canvas.classList.remove('click-jelly');
      }
    });
    // 兜底：animationend 若因动画被打断（连点/失去焦点）未触发，
    // 超时强制移除 class 并恢复原尺寸，避免猫卡在形变状态。
    setInterval(() => {
      if (canvas.classList.contains('click-jelly')) {
        canvas.classList.remove('click-jelly');
      }
    }, 1200);
  }
  setPetState('idle');
  scheduleBlink();
  setInterval(updateIdleState, 250);
  setInterval(heatLoop, 100);
  initSoundSystem();
  setInterval(drinkTick, DRINK_FRAME_MS);
  setInterval(stretchTick, STRETCH_FRAME_MS);
  loadWaterState();
  scheduleWaterReminder();
  startStretchReminder();

  // 拖拽方向感知形变主循环：rAF 常驻，拖动时计算形变写 wrapper transform。
  requestAnimationFrame(dragLoop);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}