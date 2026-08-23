# src-tauri/bin

此目录存放随应用捆绑的 **yt-dlp 独立二进制**（sidecar）。

## 当前策略（重要）

| 平台 | 是否捆绑 | 原因 |
|------|---------|------|
| **Windows** | ✅ 捆绑 | 用户普遍缺 Python；`yt-dlp.exe` 是自足单文件，无需额外运行时 |
| **macOS** | ❌ 不捆绑 | `yt-dlp_macos` 单文件版缺内置 JS 运行时，搜索走慢速降级（实测 ~22s）；完整版(zip) 是目录结构，Tauri externalBin 无法捆绑。macOS 用户系统普遍已有 Python yt-dlp（~5s），用系统版最快 |

macOS 打包时不下载任何二进制，Rust 的 `ytdlp_cmd()` 找不到捆绑版会自动回退到系统 PATH 中的 `yt-dlp`。

## Windows 捆绑命名

Tauri 的 `bundle.externalBin`（`tauri.conf.json`）按 target-triple 查找二进制：

| 平台 | 文件名 |
|------|--------|
| Windows x64 | `yt-dlp-x86_64-pc-windows-msvc.exe` |

CI 在构建时自动从 yt-dlp GitHub Release 下载（见 `.github/workflows/build.yml`）。体积较大（~17MB），已加入 `.gitignore` 不入库。

本地手动下载：

```bash
curl -L -o src-tauri/bin/yt-dlp-x86_64-pc-windows-msvc.exe \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
```

