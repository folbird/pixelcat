# 像素猫 Desktop Pet

一个运行在 macOS 桌面上的像素风小猫，基于 Tauri 2、Rust 和 Vanilla JS 构建。小猫会监听全局键盘输入，每次按键播放一帧动画，并提供右键菜单、菜单栏 Tray、置顶切换、隐藏/显示、番茄钟、喝水提醒、休息拉伸、开机自启和自定义名字等功能。

## 当前功能

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 透明无边框窗口 | 已实现 | 默认紧凑尺寸为 128x128，只显示小猫 |
| macOS 全屏覆盖 | 已实现 | 通过 `tauri-nspanel` 将窗口转换为浮动 NSPanel |
| 桌面置顶 | 已实现 | 可在右键菜单或 Tray 菜单中切换 |
| Accessory 模式 | 已实现 | 不显示 Dock 图标，且 `skipTaskbar` 启用 |
| 原生窗口拖动 | 已实现 | 左键拖动小猫触发 Tauri `startDragging()` |
| 全局键盘监听 | 已实现 | 使用 `keytap`，需要 macOS 辅助功能权限 |
| 打字动画 | 已实现 | 待机为程序化绘制的像素猫，打字时切换左右按压 SVG，带呼吸/眨眼/睡觉状态 |
| 右键菜单 | 已实现 | 提供番茄钟、喝水提醒、休息拉伸、设置、名字、隐藏、退出等操作 |
| Tray 菜单 | 已实现 | 左键显示宠物，右键打开菜单 |
| Toast 提示 | 已实现 | 用于功能反馈和定时提醒 |
| 番茄钟 | 已实现 | 25 分钟专注 / 5 分钟休息，窗口动态扩展，已完成番茄数持久化显示 |
| 喝水提醒 | 已实现 | 每 45 分钟自动提醒一次，窗口扩展至 256x256 |
| 休息拉伸 | 已实现 | 每小时自动提醒一次；右键菜单可手动触发 |
| 告诉我名字 | 已实现 | 弹出输入框给小猫起名，名字持久化显示在宠物下方 |
| 开机自启 | 已实现 | 右键菜单「设置 → 开机自启」勾选即可，使用 macOS LaunchAgent |

## 项目结构

```text
pixelcat/
├── package.json
├── README.md
├── 项目交接文档.md
├── scripts/
│   └── run-signed-dev.sh      # 开发模式 + 稳定签名
├── src/
│   ├── index.html             # 透明页面、Toast、番茄钟面板、名字弹窗样式
│   ├── main.js                # 小猫动画、Tauri 事件、番茄钟、喝水/拉伸提醒、名字
│   ├── comnyang-logo.svg      # 应用 Logo
│   ├── press-left.svg         # 打字动画帧（按压左）
│   └── press-right.svg        # 打字动画帧（按压右）
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    └── src/
        ├── main.rs
        └── lib.rs             # 窗口、NSPanel、菜单、Tray、全局键盘监听、开机自启
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

## 菜单

右键小猫可以打开上下文菜单：

- 喝水提醒：立即显示一次喝水提示；每 45 分钟也会自动提醒
- 番茄钟：打开 25 分钟专注 / 5 分钟休息面板，下方显示累计完成的番茄数
- 休息拉伸：立即触发一次拉伸提醒；每 1 小时也会自动提醒
- 设置 / 窗口置顶：切换置顶状态，并同步 Tray 菜单勾选
- 设置 / 回到屏幕中央：把窗口移动到主屏幕中央
- 设置 / 开机自启：勾选后登录时自动启动（macOS LaunchAgent）
- 告诉我名字：打开输入框给小猫起名，名字持久化显示
- 隐藏宠物
- 退出像素猫

菜单栏 Tray 图标支持：

- 左键：显示宠物
- 右键：打开 Tray 菜单

## 持久化数据

数据保存在 WebView 的 `localStorage` 中（Tauri 应用数据目录内）：

| 键 | 内容 |
| --- | --- |
| `pixelcat.pet.name` | 宠物名字 |
| `pixelcat.pomodoro.total` | 累计完成的番茄数 |

## 实现要点

macOS 的普通透明窗口无法稳定显示在全屏 Space 之上。项目使用 `tauri-nspanel` 将主窗口转换为 NSPanel，并设置浮动层级与 `collectionBehavior`，让小猫可以加入所有 Space 并显示在全屏应用上方。后台刷新线程每 2 秒重新应用一次配置，用来应对系统偶发重置。

番茄钟面板需要比小猫更大的可点击区域。应用默认保持 128x128 紧凑窗口，打开番茄钟时由 Rust 命令扩展为 128x160 的透明窗口，关闭面板后恢复为 128x128。

开机自启通过在 `~/Library/LaunchAgents/com.jun.desktop-pet.plist` 写入/删除 LaunchAgent 配置文件实现。在开发模式下，自启指向调试版可执行文件；构建发布版后请重新开启一次以指向发布版路径。

## 后续 TODO

- 番茄钟自定义时长（当前固定 25/5 分钟）
- 喝水提醒间隔自定义、提醒时段设置
- 多语言支持（当前仅中文菜单）
- 评估 Windows 兼容方案