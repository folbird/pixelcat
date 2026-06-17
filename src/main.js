// ============================================================
// Desktop Pet 动画逻辑
// ------------------------------------------------------------
// 1) 每打一个字 -> 前进一帧（不循环）。打完最后回到第 0 帧。
// 2) 拖动：使用 Tauri 原生 startDragging()，平滑可靠、不跳角落。
// 3) 全局键盘由后端 rdev 提供；浏览器调试用 keydown。
// ============================================================

// ---- 精灵图参数 ----
const FRAME_W = 18;
const FRAME_H = 14;
const COLS = 4;
const FRAME_COUNT = 14;
const SCALE = 8;
const IDLE_DELAY = 2000; // 停止打字 2 秒后回到第 0 帧

const canvas = document.getElementById('pet');
canvas.width = FRAME_W * SCALE;
canvas.height = FRAME_H * SCALE;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let frameIndex = 0;
let idleTimer = null;

const sheet = new Image();
sheet.src = './sprite.png';

function drawFrame(idx) {
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    sheet,
    col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H,
    0, 0, canvas.width, canvas.height
  );
}

// 每打一个字，前进一帧；到最后一帧后回到 0 重新开始
function advanceOneFrame() {
  frameIndex = (frameIndex + 1) % FRAME_COUNT;
  drawFrame(frameIndex);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    frameIndex = 0;
    drawFrame(0);
  }, IDLE_DELAY);
}

sheet.onload = () => {
  drawFrame(0);
};

// ============================================================
// Tauri 全局 API（withGlobalTauri: true 时由 window.__TAURI__ 暴露）
// ------------------------------------------------------------
// Tauri 2 中：
//   - 事件:        window.__TAURI__.event.listen
//   - 当前窗口:    window.__TAURI__.window.getCurrentWindow()
//   - 原生拖动:    currentWindow.startDragging()
// ============================================================
function init() {
  const T = window.__TAURI__;
  const win = T && T.window ? T.window.getCurrentWindow() : null;

  // ---- 触发源 1：Tauri 全局键盘事件（后端 rdev）----
  if (T && T.event && T.event.listen) {
    T.event.listen('typing', () => advanceOneFrame());
  }

  // ---- 触发源 2：页面键盘事件（浏览器调试用）----
  document.addEventListener('keydown', () => advanceOneFrame());

  // ---- 窗口拖动：使用 Tauri 原生 startDragging() ----
  // 这是 Tauri 提供的原生拖动接口，由系统接管拖动手势，
  // 不会出现「跳到角落」的 bug，鼠标释放即停。
  if (win && typeof win.startDragging === 'function') {
    canvas.addEventListener('pointerdown', (e) => {
      // 鼠标左键按下时开始原生拖动
      if (e.button === 0) {
        win.startDragging();
      }
    });
  } else {
    // 兜底：无 Tauri 环境（浏览器调试）时，不可拖动，仅提示
    console.log('当前环境不支持窗口拖动（浏览器预览模式）');
  }
}

// 确保 DOM 与 Tauri 注入都就绪后再初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
