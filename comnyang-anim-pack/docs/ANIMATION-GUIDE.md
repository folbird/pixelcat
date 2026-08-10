# Comnyang 动画资源包使用说明

> 一个自包含的桌面像素猫动画资源集。所有 SVG 已预注入耳朵/尾巴，**打开即可直接看到完整猫咪**。
> 纯 SVG + CSS @keyframes 实现，**零依赖**，可嵌入任何 HTML/网页/Electron 应用。

---

## 📦 资源包结构图

```
comnyang-anim-pack/
├── svg/                         # ★ 动画核心 — 10 个像素猫 SVG
│   ├── cat-idle-follow-v2.svg   # 主猫：idle(呼吸/眨眼/摆尾) + 狩猎 + 喝水 + 睡眠
│   ├── stretch-pose-default.svg # 拉伸提醒姿态（15 个关键帧动画）
│   ├── stretch-pose-ing.svg     # 拉伸进行附加姿态
│   ├── stretch-start.svg        # 拖拽拉伸前
│   ├── stretch-end.svg          # 拖拽拉伸后（拉长 1.5 倍，供弹簧变形）
│   ├── press-left.svg           # 打字左爪按压
│   ├── press-right.svg          # 打字右爪按压
│   ├── scroll-unroll.svg        # 滚动展开纸卷
│   ├── jump-start.svg           # 跳跃起跳
│   └── jump-ing.svg             # 跳跃进行
├── sound/                       # 音效（可选）
│   ├── meow.m4a                 # 完成任务喵
│   ├── meow-alert.m4a           # 提醒/通知喵（可连响）
│   └── purring.m4a              # 呼噜声（循环）
├── docs/
│   └── ANIMATION-GUIDE.md       # 本说明文档
├── demo.html                    # ★ 一键演示所有动画（浏览器直接打开）
└── README.md                    # 快速上手
```

---

## 🎨 一句话原理

每只猫 = **1 张像素画（SVG `<path>`）** + **1 套 CSS @keyframes 剧本**（嵌在 SVG 内部 `<style>` 标签里）。

触发方式 = 给 SVG 根元素（`<svg>`）**添加一个 class**，对应动画自动播放。**不换图，靠 CSS 变形。**

---

## 🚀 快速开始（3 种方式）

### 方式 1：直接打开 SVG 看静态猫
```bash
open svg/cat-idle-follow-v2.svg
```
> 默认显示站立猫（含耳朵尾巴）。想看动起来，见方式 2/3。

### 方式 2：浏览器控制台手动触发单个动画
1. 浏览器打开 `svg/cat-idle-follow-v2.svg`
2. 按 F12 → Console 执行：
```js
document.documentElement.classList.add('drinking')
```
猫立刻开始喝水动画（俯身 + 舌头舔水循环）。

可用的 class（不同 SVG 支持不同）：
```js
'drinking'    // 喝水（主猫）
'hunting'     // 狩猎俯身（主猫 + stretch-pose-default）
'sleeping'    // 睡觉（主猫）
'stretching'  // 拉伸（stretch-pose-default）
'purring'     // 呼噜（主猫）
```

### 方式 3：打开 demo.html 看全部动画
```bash
open demo.html
```
内置播放器：拉伸 / 喝水 / 跳跃 / 打字 / 滚动 / 狩猎 / 睡眠，全部可点播。

---

## 🎬 每个动画的触发方式

### 1. 拉伸提醒（stretch-pose-default.svg）
```js
const svg = document.querySelector('svg');
svg.classList.add('stretching');          // 播放 3 秒完整拉伸
svg.classList.remove('stretching');        // 立即停止
```
3 秒动作序列：
| 部位 | 动作 |
|---|---|
| 前腿 | `rotate(51deg) scaleY(0.69)` 绷直 |
| 后腿 | 上移 7px 绷直 |
| 身体/头 | 前移 5px / 上仰 4px |
| 眼睛 | 睁开 → 30~70%眯眼 → 睁开 |
| 全身 | 顶点区 ±0.4px 高频颤抖 |

> 搭配 `stretch-start.svg` + `stretch-end.svg` 可做**拖拽弹性链**（见 docs 下方"高级"）。

### 2. 喝水（cat-idle-follow-v2.svg）
```js
svg.classList.add('drinking');             // 0~0.7s 俯身+水碗滑入
setTimeout(() => svg.classList.remove('drinking'), 3000);  // 3s 后恢复
```
- 单选类，水碗/舌头均为 SVG 内置元素
- 舌头在 0.5s 后自动进入舔水循环（原版行为）

### 3. 狩猎（cat-idle-follow-v2.svg 或 stretch-pose-default.svg）
```js
svg.classList.add('hunting');              // 伏地 + 尾巴摇 + 瞳孔放大
svg.classList.remove('hunting');           // 恢复
```
> 狩猎"抖动检测"是 JS 算法（见 demo 的 hunting 演示简化版）。

### 4. 跳跃（jump-start.svg / jump-ing.svg 配合）
真机实现是用 JS 时间序列交替两个 SVG + 窗口位移。最简单静态版：
```html
<object data="svg/jump-start.svg"></object>
<object data="svg/jump-ing.svg"></object>
```
给 `<body>` 加 `data-jump="start"` / `data-jump="ing"` 切换（参考原版 poses.css）。

### 5. 打字/按压（press-left.svg / press-right.svg）
```js
// 每 70~110ms 交替给 body 设置 data-press="left"/"right"
document.body.dataset.press = 'left';     // 显示左爪按压
document.body.dataset.press = 'right';    // 显示右爪按压
```
> 原版还含"过热模式"：打字过快猫变红 + 蒸汽（依赖 typing-heat.js，详见 demo）。

### 6. 滚动（scroll-unroll.svg）
```js
document.body.dataset.scroll = 'unroll';  // 纸卷展开
document.body.dataset.scroll = '';        // 收起
```
> 内部 `#paper-strip-mask` 高度会从 17px 插值到 32.5px。

### 7. 睡眠（cat-idle-follow-v2.svg）
```js
svg.classList.add('sleeping');             // 闭眼 + 身体放大 + 尾巴垂下
svg.classList.remove('sleeping');          // 醒来
```

---

## 🧩 集成到网页/应用

### 最小示例：嵌入一个会喝水的猫
```html
<!-- 1. 用 <object> 内联 SVG（这样 JS 能访问其内部 class） -->
<object id="cat" data="svg/cat-idle-follow-v2.svg" type="image/svg+xml"></object>

<script>
  const obj = document.getElementById('cat');
  obj.addEventListener('load', () => {
    const svg = obj.contentDocument.documentElement;  // 内部 <svg>
    setTimeout(() => {
      svg.classList.add('drinking');                  // 触发喝水
      setTimeout(() => svg.classList.remove('drinking'), 3000);
    }, 500);
  });
</script>
```

### 颜色自定义
SVG 内部使用 CSS 变量，可通过 JS 修改：
```js
const root = obj.contentDocument.documentElement;
root.style.setProperty('--cat-color', '#FF9900');      // 猫身体颜色
root.style.setProperty('--cat-outline', '#000000');    // 描边
root.style.setProperty('--eye-color', '#222222');      // 眼睛
root.style.setProperty('--eye-bg-color', '#FFFFFF');   // 眼白
```

### 大小控制
```js
svg.setAttribute('width', '200');  // 任意尺寸，像素风自动保持锐利
svg.setAttribute('height', '200');
```

---

## ⚙️ 动画实现机制详解

### SVG 内部 CSS 动画架构

每个 SVG 的 `<style>` 内定义：
```
:root.stretching #leg-fl { animation-name: stretch-fl; }   ← 触发规则
@keyframes stretch-fl {
  0%, 100% { transform: translate(0,0) rotate(0) scaleY(1); }
  30%, 70% { transform: translate(4px,8.7px) rotate(51deg) scaleY(0.69); }
}                                                            ← 变形剧本
```

关键细节：
- **`transform-box: view-box` + 固定 `transform-origin`**：让各部位围绕指定关节旋转（腿根部、尾巴根部），不受图案 patch 影响
- **`forwards` / `steps()`**：一次性动画停在终点；舌头等循环用 `infinite`
- **大眼睛眯眼**：用两套 `#eyes-open` / `#eyes-closed` 图层，opacity 交叉切换

### 弹簧/弹性效果（拖拽拉伸，需 JS）

原版用 `requestAnimationFrame` 跑 6 段弹簧链：每个身体段有 `dx` 位移 + 弹簧力 + 阻尼 + 相邻耦合。核心公式：
```js
vel[i] += (dx[i-1] - dx[i]) * 0.28   // 耦合
vel[i] += -dx[i] * 0.10              // 弹簧回中
vel[i] *= 0.84                       // 阻尼
dx[i] += vel[i]                      // 积分
```
实现文件参考：原版 `stretch-chain.js`（见本包 docs/）

---

## 📄 音效使用

```js
const meow = new Audio('sound/meow.m4a');
meow.volume = 0.1;
meow.play();                          // 完成任务喵

const alert = new Audio('sound/meow-alert.m4a');
alert.play();                         // 提醒喵（可叠加）

const purr = new Audio('sound/purring.m4a');
purr.loop = true;                     // 呼噜声循环
purr.play();
```

---

## ❗ 常见问题

**Q: 为什么直接打开 SVG 猫是静止的？**
A: 动画由 class 触发（`:root.drinking` 等）。直接打开只显示默认姿态。要动起来请在浏览器 Console 加 class，或使用 demo.html。

**Q: 为什么耳朵/尾巴不显示？**
A: 本包 SVG 已**预注入**耳朵尾巴，正常情况下都会显示。如果你基于原始 asar 提取，需执行注入逻辑（参考 `build_enhanced_svgs.py`）。

**Q: 如何做拖拽弹性拉伸？**
A: 需要 3 个 SVG（start/end/pose）+ JS 弹簧物理。原版代码在 `stretch-chain.js`（本包 docs 附带精简版思路）。

**Q: 能商用吗？**
A: 本包改自 Comnyang（zhaoxuya520/reverse-skill 项目逆向分析产物）。**仅限学习研究**。商业使用请获取原作者授权。

---

## 🏷️ 动画速查表

| 动画 | SVG 文件 | 触发 class/data | 时长 | 是否循环 |
|---|---|---|---|---|
| 拉伸提醒 | stretch-pose-default.svg | `.stretching` | 3s | 单次 |
| 喝水 | cat-idle-follow-v2.svg | `.drinking` | 3s(俯身) + 舌头无限 | 舌头循环 |
| 狩猎 | cat-idle-follow-v2.svg | `.hunting` | ~1.1s | 期间循环摆动 |
| 睡眠 | cat-idle-follow-v2.svg | `.sleeping` | — | 保持 |
| 呼噜 | cat-idle-follow-v2.svg | `.purring` | — | 循环 |
| 跳跃 | jump-start/ing.svg | body `data-jump` | ~2.2s | 单次 |
| 打字 | press-left/right.svg | body `data-press` | 每 70-110ms 切换 | 无 |
| 滚动 | scroll-unroll.svg | body `data-scroll` | 展开 ~0.9s | 单次 + 脉冲 |