// ============================================================
// 喝水记录图表面板（独立窗口版，参考 water_log_pixel.html）
// 在独立透明窗口 water-log.html 内绘制：标题 + 总量 + 阶梯累计图 + 记录列表。
// 数据从主窗口 localStorage 读取（同一应用 WebView 共享 localStorage）。
//
// 视觉规范（用户要求）：
//   - 面板整体以黑色为主，字体/文字也是黑色系（浅灰/黑），
//   - **只有水的图像是蓝色**（阶梯线、水柱、水点），其余全部黑/灰。
//   - 字体与小猫界面一致：ArkPixel12CN / ArkPixel12 像素字体。
// ============================================================

const c = document.getElementById('c');
const ctx = c.getContext('2d');
ctx.imageSmoothingEnabled = false;

const W = c.width;   // 520
const H = c.height;  // 360
const WATER_DAILY_GOAL_ML = 2000;
const WATER_DRINK_ML = 200;
const WATER_STATE_KEY = 'pixelcat.water';

// ---- 黑色主题配色 ----
const COL_BG = '#0a0a0c';        // 面板底色（黑）
const COL_PANEL_LINE = '#3a3a42';// 面板描边（深灰）
const COL_AXIS = '#2c2c34';      // 坐标轴/网格线（深灰）
const COL_TEXT_DIM = '#6a6a72';  // 次要文字（中灰）
const COL_TEXT = '#a0a0a8';      // 主文字（浅灰，接近白但保持黑主题柔和）
const COL_TEXT_BRIGHT = '#e6e6ec'; // 标题/总量数字（亮灰白）
const COL_WATER = '#39d9ff';     // 水（阶梯线、图标）
const COL_WATER_LIGHT = '#75eaff'; // 水亮点
const COL_WATER_FILL = 'rgba(57, 217, 255, 0.25)'; // 水柱半透明填充

function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
function line(x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width || 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function txt(s, x, y, size, color, align) {
  ctx.fillStyle = color || COL_TEXT;
  ctx.font = size + 'px "ArkPixel12CN","ArkPixel12",monospace';
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 读取今日饮水记录（跨日自动重置；旧格式无 log 则容错）。
function loadWaterState() {
  try {
    const raw = localStorage.getItem(WATER_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === todayStr()) {
        return {
          drunkML: Math.max(0, Math.min(parsed.drunkML || 0, 99999)),
          log: Array.isArray(parsed.log) ? parsed.log : [],
        };
      }
    }
  } catch { /* 忽略 */ }
  return { drunkML: 0, log: [] };
}

// 重绘整个面板。
function draw() {
  const st = loadWaterState();

  rect(0, 0, W, H, COL_BG);

  // ---- 标题区（黑色系文字，水点用蓝）----
  rect(18, 10, 12, 12, COL_TEXT_BRIGHT);   // 像素角标（中性白）
  rect(22, 12, 4, 4, COL_WATER);           // 小水点（蓝）
  txt('WATER LOG', 42, 16, 20, COL_TEXT_BRIGHT);
  txt('今日喝水记录', 42, 42, 15, COL_TEXT);

  // ---- 今日总量（数字亮白，ml 灰色）----
  txt('今日总量', 360, 18, 13, COL_TEXT);
  txt(String(st.drunkML), 360, 48, 26, COL_TEXT_BRIGHT);
  txt('ml', 442, 48, 14, COL_TEXT);

  // ---- 阶梯累计图（黑色网格 + 只有水线/水柱是蓝）----
  const gx = 20, gy = 66, gw = W - 40, gh = 200;
  const x0 = gx + 22, y0 = gy + gh - 24;
  const maxMl = WATER_DAILY_GOAL_ML;
  const X = (hour) => x0 + (hour - 8) / (22 - 8) * (gw - 42);
  const Y = (ml) => y0 - (ml / maxMl) * (gh - 44);

  // 纵轴网格 0/500/1000/1500/2000（深灰）
  for (let v = 0; v <= maxMl; v += 500) {
    const yy = Y(v);
    line(x0, yy, x0 + gw - 42, yy, COL_AXIS, 1);
    txt(String(v), x0 - 10, yy, 12, COL_TEXT_DIM, 'right');
  }
  // 横轴小时 8/11/14/17/20/23（深灰）
  for (let h = 8; h <= 22; h += 3) {
    const xx = X(h);
    line(xx, gy + 14, xx, y0, COL_AXIS, 1);
    txt(String(h).padStart(2, '0') + ':00', xx, y0 + 17, 11, COL_TEXT_DIM, 'center');
  }
  txt('ml', x0 - 14, gy + 4, 11, COL_TEXT_DIM, 'right');
  txt('TIME', gx + gw - 4, y0 + 17, 10, COL_TEXT_DIM, 'right');

  // 累计阶梯点（水的部分 → 蓝色）
  const events = st.log.slice();
  let total = 0;
  const pts = [];
  for (const e of events) {
    total += (e.ml || WATER_DRINK_ML);
    const d = new Date(e.t);
    const hr = d.getHours() + d.getMinutes() / 60;
    pts.push({ x: X(hr), y: Y(total), t: e.t, ml: e.ml || WATER_DRINK_ML });
  }

  if (pts.length > 0) {
    // 蓝色水柱填充（半透明蓝，水的图像）
    ctx.beginPath();
    ctx.moveTo(pts[0].x, y0);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
      if (i < pts.length - 1) ctx.lineTo(pts[i + 1].x, pts[i].y);
    }
    ctx.lineTo(pts[pts.length - 1].x, y0);
    ctx.closePath();
    ctx.fillStyle = COL_WATER_FILL;
    ctx.fill();

    // 蓝色阶梯线 + 水点
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      line(p.x, p.y, p.x + (i < pts.length - 1 ? pts[i + 1].x - p.x : 10), p.y, COL_WATER, 3);
      if (i < pts.length - 1) line(pts[i + 1].x, p.y, pts[i + 1].x, pts[i + 1].y, COL_WATER, 3);
      rect(p.x - 3, p.y - 7, 7, 7, COL_WATER_LIGHT);
      rect(p.x - 3, p.y - 9, 3, 3, '#eefaff');
    }
  } else {
    txt('今天还没喝水哦，点猫猫喝一杯吧', x0 + (gw - 42) / 2, (gy + y0) / 2, 16, COL_TEXT_DIM, 'center');
  }

  // ---- 底部记录列表（黑色系文字 + 蓝色小水点图标）----
  rect(20, H - 84, W - 40, 4, COL_AXIS);
  txt('喝水记录 (ml)', 24, H - 66, 13, COL_TEXT);
  const cols = Math.max(1, Math.min(events.length, 10));
  const cw = (W - 48) / cols;
  for (let i = 0; i < cols; i++) {
    const e = events[i];
    const x = 24 + i * cw;
    if (i > 0) {
      for (let yy = H - 50; yy < H - 18; yy += 6) rect(x - 8, yy, 3, 8, COL_TEXT_DIM);
    }
    const d = new Date(e.t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    // 水点图标（蓝）——只有这里是水相关的蓝色
    rect(x + 10, H - 50, 10, 16, COL_WATER);
    rect(x + 6, H - 53, 18, 6, COL_WATER_LIGHT);
    // 时间/毫升文字（黑色系）
    txt(hh + ':' + mm, x + 30, H - 47, 12, COL_TEXT);
    txt(String(e.ml || WATER_DRINK_ML) + 'ml', x + 30, H - 30, 12, COL_TEXT_BRIGHT);
    if (i < cols - 1) line(x + cw - 1, H - 54, x + cw - 1, H - 16, COL_AXIS, 1);
  }
  if (events.length > 10) txt('…', 24 + 10 * cw, H - 40, 14, COL_TEXT, 'left');
}

// 右上角 ×：只隐藏本面板（调用 Rust 命令 hide_water_log），
// 绝不 close()——否则会连小猫主窗口一起退出整个应用。
document.getElementById('close').addEventListener('click', () => {
  const T = window.__TAURI__;
  if (T && T.core && T.core.invoke) {
    T.core.invoke('hide_water_log', {}).catch(() => {});
  }
});

// 主窗口每次喝水后 localStorage 变化，本窗口聚焦时刷新显示
window.addEventListener('focus', draw);
// 每秒轻量检查一次（跨日/外部变化兜底）
setInterval(draw, 2000);

draw();