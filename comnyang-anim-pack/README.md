# 🐱 Comnyang 动画资源包 (Comnyang Animation Pack)

> 来自 [zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill) 项目逆向分析产物。
> 把这个文件夹直接发送给别人——双击 `demo.html` 即可在浏览器中播放所有动画，复制到项目中即可直接调用。

## ✨ 特点

- **零依赖**：纯 SVG + CSS `@keyframes`，不需要 JavaScript 动画库
- **开箱即用**：所有 SVG 已预注入耳朵/尾巴，打开即可看到完整猫咪
- **即点即看**：`demo.html` 集合了全部动画点击演示
- **文档齐全**：`docs/ANIMATION-GUIDE.md` 详述触发方式、集成方法、机制解析

## 🗂️ 目录结构

```
comnyang-anim-pack/
├── svg/                     # 10 个像素猫 SVG（含耳朵+尾巴）
├── sound/                   # 3 个 m4a 音效
├── docs/                    # 说明文档
├── demo.html                # 一键播放演示页
└── README.md                # 快速上手
```

## 🚀 3 步使用

1. **看演示** → 双击 `demo.html`
2. **复制素材** → 把 `svg/` 里的文件拷进你的项目
3. **触发动画** → 参考 `docs/ANIMATION-GUIDE.md` 的"快速触发"章节

### 最快体验：浏览器控制台
```js
// 打开 svg/cat-idle-follow-v2.svg，在 Console 粘贴：
document.documentElement.classList.add('drinking')   // 猫开始喝水
```

### 代码集成最小示例
```html
<object id="cat" data="svg/cat-idle-follow-v2.svg" type="image/svg+xml"></object>
<script>
const svg = (await new Promise(r => {
  const o = document.getElementById('cat');
  o.onload = () => r(o.contentDocument.documentElement);
})).classList;

svg.add('drinking');                      // 触发喝水
setTimeout(() => svg.remove('drinking'), 3000);  // 3 秒后恢复
</script>
```

## 🎬 支持的动画

| 动画 | SVG | 触发方式 |
|---|---|---|
| 喝水 | `cat-idle-follow-v2.svg` | `.drinking` |
| 狩猎 | `cat-idle-follow-v2.svg` | `.hunting` |
| 睡觉 | `cat-idle-follow-v2.svg` | `.sleeping` |
| 呼噜 | `cat-idle-follow-v2.svg` | `.purring` |
| 拉伸 | `stretch-pose-default.svg` | `.stretching` |
| 打字 | `press-left/right.svg` | `body[data-press="left\|right"]` |
| 滚动 | `scroll-unroll.svg` | `body[data-scroll="unroll"]` |
| 跳跃 | `jump-start/ing.svg` | `body[data-jump="start\|ing"]` |

👉 **完整说明及集成代码见 `docs/ANIMATION-GUIDE.md`**

## 📄 版权声明

本资源包改自 Comnyang 项目，**仅供学习研究交流使用**。商业用途请联系原作者授权。
