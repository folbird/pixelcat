# 🐱 Desktop Pet — 桌面小猫

一个类似 [Comnyang](https://www.comnyang.com/) 的桌面宠物应用，基于 **Tauri 2 + Vanilla JS** 构建。

## 功能概述

| 功能 | 状态 | 说明 |
|------|------|------|
| 无边框透明窗口 | ✅ 已实现 | 窗口无标题栏、无阴影、背景透明，只显示小猫 |
| 桌面置顶 | ✅ 已实现 | 窗口始终在最前方，不被其他窗口遮挡 |
| 不显示 Dock 图标 | ✅ 已实现 | macOS 下以 Accessory 模式运行 |
| 不显示任务栏 | ✅ 已实现 | `skipTaskbar: true` |
| 窗口可拖动 | ✅ 已实现 | 通过 `data-tauri-drag-region` 支持拖动整个窗口 |
| 全局键盘监听 | ✅ 已实现 | 使用 `rdev` 监听所有按键，不仅限于应用内 |
| 打字动画 | ✅ 已实现 | 检测到键盘按键时，小猫播放打字动画 |
| 空闲待机 | ✅ 已实现 | 停止打字 400ms 后恢复静止待机姿态 |

## 技术架构

```
tauri-app/
├── src/                    # 前端
│   ├── index.html          # 入口页面（透明背景 + Canvas）
│   ├── main.js             # 动画逻辑（帧播放 + 事件监听）
│   └── sprite.png          # 小猫精灵图（18×18 像素/帧，4列×3行，11帧）
├── src-tauri/              # 后端 (Rust)
│   ├── src/
│   │   ├── main.rs         # 程序入口
│   │   └── lib.rs          # Tauri 应用配置 + 全局键盘监听
│   ├── tauri.conf.json     # Tauri 窗口配置（无边框、透明、置顶）
│   └── Cargo.toml          # Rust 依赖（tauri + rdev）
└── package.json            # 前端依赖（仅 @tauri-apps/api）
```

### 前端 (`src/main.js`)

- 从 `sprite.png` 精灵图中按 18×18 像素切割每一帧
- 以 10 倍缩放绘制到 Canvas 上（最终显示 180×180 像素）
- 两种状态：
  - **idle（待机）**：只显示第 0 帧
  - **typing（打字）**：循环播放全部 11 帧，每帧 90ms
- 监听 Tauri 的 `typing` 事件切换状态，停止打字 400ms 后回到待机

### 后端 (`src-tauri/src/lib.rs`)

- macOS 下设置为 `Accessory` 激活策略（不显示 Dock）
- 在独立线程中启动 `rdev::listen`，监听全局键盘事件
- 每次检测到 `KeyPress` 时通过 Tauri 的 `emit("typing", ())` 发送事件给前端

### 窗口配置 (`tauri.conf.json`)

| 配置项 | 值 | 作用 |
|--------|-----|------|
| `decorations` | `false` | 移除标题栏和窗口边框 |
| `transparent` | `true` | 窗口背景透明 |
| `alwaysOnTop` | `true` | 始终在最前方 |
| `skipTaskbar` | `true` | 不在任务栏/Dock 显示 |
| `shadow` | `false` | 无窗口阴影 |
| `center` | `true` | 启动时居中 |
| `macOSPrivateApi` | `true` | 允许使用 macOS 私有 API（透明窗口需要） |

## 运行要求

- **Node.js** ≥ 18
- **Rust** ≥ 1.70
- **macOS** 辅助功能权限（`rdev` 全局键盘监听需要）

## 运行步骤

```bash
# 安装前端依赖
npm install

# 开发模式运行
npm run tauri dev
```

## 已知问题

1. **macOS 辅助功能权限**：`rdev` 需要在「系统设置 → 隐私与安全性 → 辅助功能」中授权才能监听全局键盘。未授权时键盘动画不会触发。
2. **窗口可能不可见**：如果 180×180 的透明窗口难以发现，可尝试按 `Cmd+Tab` 切换窗口确认程序是否在运行。
