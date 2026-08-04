# 像素猫 Desktop Pet

一个运行在 macOS 桌面上的像素风小猫，基于 Tauri 2、Rust 和 Vanilla JS 构建。小猫会监听全局键盘输入，每次按键前进一帧动画，并提供右键菜单、菜单栏 Tray、置顶切换、隐藏/显示和番茄钟面板。

## 当前功能

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 透明无边框窗口 | 已实现 | 默认紧凑尺寸为 128x128，只显示小猫 |
| macOS 全屏覆盖 | 已实现 | 通过 `tauri-nspanel` 将窗口转换为浮动 NSPanel |
| 桌面置顶 | 已实现 | 可在右键菜单或 Tray 菜单中切换 |
| Accessory 模式 | 已实现 | 不显示 Dock 图标，且 `skipTaskbar` 启用 |
| 原生窗口拖动 | 已实现 | 左键拖动小猫触发 Tauri `startDragging()` |
| 全局键盘监听 | 已实现 | 使用 `keytap`，需要 macOS 辅助功能权限 |
| 打字逐帧动画 | 已实现 | 16 帧精灵图，每次按键推进 1 帧，空闲后回到第 0 帧 |
| 右键菜单 | 已实现 | 提供番茄钟、设置、隐藏、退出等操作 |
| Tray 菜单 | 已实现 | 左键显示宠物，右键打开菜单 |
| Toast 提示 | 已实现 | 用于未完成菜单项和计时提醒 |
| 番茄钟 | 已实现 | 打开时动态扩展透明窗口，关闭后恢复小猫尺寸 |
| 喝水提醒 | 已实现 | 程序启动后每 45 分钟提醒一次 |

## 项目结构

```text
pixelcat/
├── package.json
├── README.md
├── 项目交接文档.md
├── src/
│   ├── index.html      # 透明页面、Toast、番茄钟面板样式
│   ├── main.js         # 小猫动画、Tauri 事件、番茄钟逻辑
│   └── sprite.png      # 512x512 精灵图，4x4 共 16 帧
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    └── src/
        ├── main.rs
        └── lib.rs      # 窗口、NSPanel、菜单、Tray、全局键盘监听
```

## 运行要求

- Node.js 18 或更高版本
- Rust 1.70 或更高版本
- macOS
- 辅助功能权限，用于全局键盘监听

## 本地运行

```bash
npm install
npm run dev:signed
```

`dev:signed` 会先编译调试版本，再把 `target/debug/tauri-app` 重新签名为稳定标识 `com.jun.desktop-pet` 后运行。全局键盘监听权限请授权这个稳定标识对应的调试程序；直接使用 `npm run tauri dev` 时，macOS 可能把每次构建后的临时签名当成不同应用。

构建发布版本：

```bash
npm run tauri build
```

## macOS 权限

`keytap` 需要辅助功能权限。首次运行后，如果按键无法触发动画，请打开：

```text
系统设置 -> 隐私与安全性 -> 辅助功能
```

把开发或构建出的应用加入列表并启用。开发模式下应用通常位于 `src-tauri/target/debug/`。

## 精灵图规格

- 文件：`src/sprite.png`
- 图片尺寸：512x512
- 单帧尺寸：128x128
- 布局：4 列 x 4 行
- 帧数：16
- 第 0 帧为待机帧

如需调整规格，同步修改 `src/main.js` 顶部的 `FRAME_W`、`FRAME_H`、`COLS` 和 `FRAME_COUNT`。

## 菜单

右键小猫可以打开上下文菜单：

- 喝水提醒：立即显示一次喝水提示；程序启动后也会每 45 分钟自动提醒
- 番茄钟：打开 25 分钟专注 / 5 分钟休息面板
- 休息拉伸：目前显示占位 Toast
- 设置 / 窗口置顶：切换置顶状态，并同步 Tray 菜单勾选
- 设置 / 回到屏幕中央：把窗口移动到主屏幕中央
- 设置 / 开机自启：目前显示占位 Toast
- 告诉我名字：目前显示占位 Toast
- 隐藏宠物
- 退出像素猫

菜单栏 Tray 图标支持：

- 左键：显示宠物
- 右键：打开 Tray 菜单

## 实现要点

macOS 的普通透明窗口无法稳定显示在全屏 Space 之上。项目使用 `tauri-nspanel` 将主窗口转换为 NSPanel，并设置浮动层级与 `collectionBehavior`，让小猫可以加入所有 Space 并显示在全屏应用上方。后台刷新线程每 2 秒重新应用一次配置，用来应对系统偶发重置。

番茄钟面板需要比小猫更大的可点击区域。应用默认保持 128x128 紧凑窗口，打开番茄钟时由 Rust 命令扩展为 260x360 的透明窗口，关闭面板后恢复为 128x128。

## 后续 TODO

- 实现休息拉伸提醒
- 实现小猫命名和持久化展示
- 实现开机自启
- 清理遗留文件：`src/styles.css`、`src/index1.html`、`src/assets/`、备份精灵图
- 评估 Windows 兼容方案
